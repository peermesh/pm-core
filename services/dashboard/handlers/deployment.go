package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// DeploymentInfo represents deployment information returned by the API
type DeploymentInfo struct {
	Environment     string `json:"environment"`
	GitCommitSHA    string `json:"git_commit_sha"`
	GitCommitShort  string `json:"git_commit_short"`
	DeployedAt      string `json:"deployed_at"`
	DeployedAtISO   string `json:"deployed_at_iso"`
	Version         string `json:"version"`
	CanSync         bool   `json:"can_sync"`
	LastSyncStatus  string `json:"last_sync_status,omitempty"`
	LastSyncMessage string `json:"last_sync_message,omitempty"`
}

// SyncResponse represents the response from a sync operation
type SyncResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

var (
	// Cache deployment info to avoid repeated exec calls
	deploymentCache     *DeploymentInfo
	deploymentCacheMu   sync.RWMutex
	deploymentCacheTime time.Time
	deploymentCacheTTL  = 60 * time.Second

	// Last sync status
	lastSyncStatus  string
	lastSyncMessage string
	lastSyncMu      sync.RWMutex
)

// DeploymentHandler handles the /api/deployment endpoint
func DeploymentHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handleGetDeployment(w, r)
	case http.MethodPost:
		handleTriggerSync(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetDeployment returns deployment information
func handleGetDeployment(w http.ResponseWriter, r *http.Request) {
	info := getDeploymentInfo()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")

	if err := json.NewEncoder(w).Encode(info); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// handleTriggerSync handles POST requests to trigger a sync operation
// Only authenticated (non-guest) users can trigger sync
func handleTriggerSync(w http.ResponseWriter, r *http.Request) {
	// Check if user is authenticated and not a guest
	session := GetSessionFromRequest(r)
	if session == nil {
		http.Error(w, "Unauthorized: Authentication required", http.StatusUnauthorized)
		return
	}

	if session.IsGuest {
		http.Error(w, "Forbidden: Guest users cannot trigger sync", http.StatusForbidden)
		return
	}

	// Trigger sync operation
	success, message := triggerSync()

	// Update last sync status
	lastSyncMu.Lock()
	if success {
		lastSyncStatus = "success"
	} else {
		lastSyncStatus = "failed"
	}
	lastSyncMessage = message
	lastSyncMu.Unlock()

	// Invalidate deployment cache to reflect any changes
	deploymentCacheMu.Lock()
	deploymentCache = nil
	deploymentCacheMu.Unlock()

	response := SyncResponse{
		Success: success,
		Message: message,
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")

	if !success {
		w.WriteHeader(http.StatusInternalServerError)
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// getDeploymentInfo returns cached or fresh deployment information
func getDeploymentInfo() *DeploymentInfo {
	deploymentCacheMu.RLock()
	if deploymentCache != nil && time.Since(deploymentCacheTime) < deploymentCacheTTL {
		info := *deploymentCache
		deploymentCacheMu.RUnlock()
		return &info
	}
	deploymentCacheMu.RUnlock()

	// Build fresh deployment info
	info := buildDeploymentInfo()

	// Cache it
	deploymentCacheMu.Lock()
	deploymentCache = info
	deploymentCacheTime = time.Now()
	deploymentCacheMu.Unlock()

	return info
}

// buildDeploymentInfo constructs deployment information from environment and git
func buildDeploymentInfo() *DeploymentInfo {
	info := &DeploymentInfo{
		Environment:    detectEnvironment(),
		GitCommitSHA:   getGitCommitSHA(),
		GitCommitShort: "",
		DeployedAt:     "",
		DeployedAtISO:  "",
		Version:        getVersion(),
		CanSync:        canUserSync(),
	}

	// Create short commit SHA
	if len(info.GitCommitSHA) >= 7 {
		info.GitCommitShort = info.GitCommitSHA[:7]
	} else if info.GitCommitSHA != "" {
		info.GitCommitShort = info.GitCommitSHA
	}

	// Get deployment timestamp
	deployedAt := getDeployedAt()
	if !deployedAt.IsZero() {
		info.DeployedAt = formatRelativeTime(deployedAt)
		info.DeployedAtISO = deployedAt.Format(time.RFC3339)
	}

	// Add last sync status
	lastSyncMu.RLock()
	info.LastSyncStatus = lastSyncStatus
	info.LastSyncMessage = lastSyncMessage
	lastSyncMu.RUnlock()

	return info
}

// detectEnvironment determines the current environment from env vars or hostname
func detectEnvironment() string {
	// Check explicit environment variable first
	if env := os.Getenv("ENVIRONMENT"); env != "" {
		return normalizeEnvironment(env)
	}
	if env := os.Getenv("ENV"); env != "" {
		return normalizeEnvironment(env)
	}
	if env := os.Getenv("APP_ENV"); env != "" {
		return normalizeEnvironment(env)
	}
	if env := os.Getenv("NODE_ENV"); env != "" {
		return normalizeEnvironment(env)
	}

	// Check hostname for environment hints
	hostname, err := os.Hostname()
	if err == nil {
		hostLower := strings.ToLower(hostname)
		if strings.Contains(hostLower, "prod") {
			return "production"
		}
		if strings.Contains(hostLower, "staging") || strings.Contains(hostLower, "stage") {
			return "staging"
		}
		if strings.Contains(hostLower, "dev") {
			return "development"
		}
	}

	// Check if running in Docker
	if _, err := os.Stat("/.dockerenv"); err == nil {
		// Running in Docker, check container name or labels
		if containerName := os.Getenv("HOSTNAME"); containerName != "" {
			nameLower := strings.ToLower(containerName)
			if strings.Contains(nameLower, "prod") {
				return "production"
			}
			if strings.Contains(nameLower, "staging") {
				return "staging"
			}
		}
	}

	// Default to local development
	return "local"
}

// normalizeEnvironment standardizes environment names
func normalizeEnvironment(env string) string {
	envLower := strings.ToLower(strings.TrimSpace(env))
	switch envLower {
	case "prod", "production":
		return "production"
	case "stage", "staging":
		return "staging"
	case "dev", "development":
		return "development"
	case "test", "testing":
		return "testing"
	case "local", "localhost":
		return "local"
	default:
		return envLower
	}
}

// getGitCommitSHA returns the current git commit SHA
func getGitCommitSHA() string {
	// First check environment variable (set during build/deploy)
	if sha := os.Getenv("GIT_COMMIT"); sha != "" {
		return sha
	}
	if sha := os.Getenv("GIT_COMMIT_SHA"); sha != "" {
		return sha
	}
	if sha := os.Getenv("COMMIT_SHA"); sha != "" {
		return sha
	}

	// Try to get from git command
	cmd := exec.Command("git", "rev-parse", "HEAD")
	output, err := cmd.Output()
	if err == nil {
		return strings.TrimSpace(string(output))
	}

	// Try reading from .git/HEAD file (works in containers with .git mounted)
	if data, err := os.ReadFile(".git/HEAD"); err == nil {
		content := strings.TrimSpace(string(data))
		// Check if it's a ref or direct SHA
		if strings.HasPrefix(content, "ref: ") {
			// It's a reference, resolve it
			refPath := ".git/" + strings.TrimPrefix(content, "ref: ")
			if refData, err := os.ReadFile(refPath); err == nil {
				return strings.TrimSpace(string(refData))
			}
		} else {
			// Direct SHA
			return content
		}
	}

	return "unknown"
}

// getDeployedAt returns the deployment timestamp
func getDeployedAt() time.Time {
	// Check environment variable (set during deploy)
	if ts := os.Getenv("DEPLOYED_AT"); ts != "" {
		if t, err := time.Parse(time.RFC3339, ts); err == nil {
			return t
		}
		// Try Unix timestamp
		if t, err := parseUnixTimestamp(ts); err == nil {
			return t
		}
	}

	// Try to get git commit date
	cmd := exec.Command("git", "log", "-1", "--format=%cI")
	output, err := cmd.Output()
	if err == nil {
		if t, err := time.Parse(time.RFC3339, strings.TrimSpace(string(output))); err == nil {
			return t
		}
	}

	// Fall back to binary modification time
	if execPath, err := os.Executable(); err == nil {
		if stat, err := os.Stat(execPath); err == nil {
			return stat.ModTime()
		}
	}

	return time.Time{}
}

// parseUnixTimestamp parses a Unix timestamp string
func parseUnixTimestamp(s string) (time.Time, error) {
	var ts int64
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= '0' && c <= '9' {
			ts = ts*10 + int64(c-'0')
		} else {
			break
		}
	}
	if ts == 0 {
		return time.Time{}, os.ErrInvalid
	}
	return time.Unix(ts, 0), nil
}

// getVersion returns the application version
func getVersion() string {
	if v := os.Getenv("APP_VERSION"); v != "" {
		return v
	}
	if v := os.Getenv("VERSION"); v != "" {
		return v
	}
	return "0.1.0-mvp"
}

// canUserSync returns true if sync capability is available
func canUserSync() bool {
	// Check if sync script or command is available
	syncScript := os.Getenv("SYNC_SCRIPT")
	if syncScript != "" {
		if _, err := os.Stat(syncScript); err == nil {
			return true
		}
	}

	// Check for docker-compose availability
	if _, err := exec.LookPath("docker-compose"); err == nil {
		return true
	}
	if _, err := exec.LookPath("docker"); err == nil {
		return true
	}

	return false
}

// triggerSync executes a sync operation
func triggerSync() (bool, string) {
	// Check for custom sync script first
	syncScript := os.Getenv("SYNC_SCRIPT")
	if syncScript != "" {
		cmd := exec.Command(syncScript)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return false, "Sync script failed: " + string(output)
		}
		return true, "Sync completed successfully"
	}

	// Default: try docker compose pull
	var cmd *exec.Cmd
	if _, err := exec.LookPath("docker-compose"); err == nil {
		cmd = exec.Command("docker-compose", "pull")
	} else if _, err := exec.LookPath("docker"); err == nil {
		cmd = exec.Command("docker", "compose", "pull")
	} else {
		return false, "No sync method available"
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return false, "Sync failed: " + string(output)
	}

	return true, "Images pulled successfully. Restart containers to apply updates."
}

// formatRelativeTime formats a time as a human-readable relative string
func formatRelativeTime(t time.Time) string {
	diff := time.Since(t)
	if diff < 0 {
		diff = -diff
	}

	seconds := int(diff.Seconds())
	minutes := seconds / 60
	hours := minutes / 60
	days := hours / 24

	if days > 0 {
		if days == 1 {
			return "1 day ago"
		}
		return formatInt(days) + " days ago"
	}
	if hours > 0 {
		if hours == 1 {
			return "1 hour ago"
		}
		return formatInt(hours) + " hours ago"
	}
	if minutes > 0 {
		if minutes == 1 {
			return "1 minute ago"
		}
		return formatInt(minutes) + " minutes ago"
	}
	if seconds < 10 {
		return "just now"
	}
	return formatInt(seconds) + " seconds ago"
}

// formatInt converts an integer to string without using strconv
func formatInt(n int) string {
	if n == 0 {
		return "0"
	}
	result := ""
	for n > 0 {
		result = string(rune('0'+n%10)) + result
		n /= 10
	}
	return result
}
