package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"time"
)

// SystemInfo represents system information returned by the API
type SystemInfo struct {
	Hostname      string         `json:"hostname"`
	OS            string         `json:"os"`
	Architecture  string         `json:"architecture"`
	DockerVersion string         `json:"docker_version"`
	Uptime        string         `json:"uptime"`
	Resources     SystemResources `json:"resources"`
}

// SystemResources represents resource information
type SystemResources struct {
	CPUCount      int    `json:"cpu_count"`
	MemoryTotalMB uint64 `json:"memory_total_mb"`
}

var startTime = time.Now()

// SystemHandler handles the /api/system endpoint
func SystemHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}

	uptime := formatUptime(time.Since(startTime))

	// Get memory stats
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	info := SystemInfo{
		Hostname:      hostname,
		OS:            runtime.GOOS,
		Architecture:  runtime.GOARCH,
		DockerVersion: getDockerVersion(),
		Uptime:        uptime,
		Resources: SystemResources{
			CPUCount:      runtime.NumCPU(),
			MemoryTotalMB: getSystemMemoryMB(),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")

	if err := json.NewEncoder(w).Encode(info); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// getDockerVersion returns the Docker version
// TODO: Implement actual Docker API call via socket-proxy
func getDockerVersion() string {
	// Placeholder - will be implemented when Docker client is added
	return "pending"
}

// getSystemMemoryMB returns total system memory in MB
// This is a simplified implementation; actual values require platform-specific code
func getSystemMemoryMB() uint64 {
	// Placeholder - actual implementation varies by OS
	// On Linux: read /proc/meminfo
	// On macOS: use sysctl
	return 0
}

// formatUptime formats a duration into a human-readable string
func formatUptime(d time.Duration) string {
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60

	if days > 0 {
		return formatDuration(days, "d", hours, "h", minutes, "m")
	}
	if hours > 0 {
		return formatDuration(hours, "h", minutes, "m", 0, "")
	}
	return formatDuration(minutes, "m", 0, "", 0, "")
}

func formatDuration(v1 int, u1 string, v2 int, u2 string, v3 int, u3 string) string {
	result := ""
	if v1 > 0 {
		result += string(rune('0'+v1/10)) + string(rune('0'+v1%10))
		if v1 < 10 {
			result = string(rune('0' + v1))
		} else {
			result = intToString(v1)
		}
		result += u1
	}
	if v2 > 0 && u2 != "" {
		result += " " + intToString(v2) + u2
	}
	if v3 > 0 && u3 != "" {
		result += " " + intToString(v3) + u3
	}
	if result == "" {
		return "0m"
	}
	return result
}

func intToString(n int) string {
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
