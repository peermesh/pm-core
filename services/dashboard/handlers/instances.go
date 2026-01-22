package handlers

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Instance represents a registered PeerMesh dashboard instance
type Instance struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	URL         string    `json:"url"`
	Description string    `json:"description,omitempty"`
	Token       string    `json:"token,omitempty"` // Shared secret for authentication (hidden in responses)
	TokenHash   string    `json:"-"`               // Internal: hashed token for comparison
	CreatedAt   time.Time `json:"created_at"`
	LastSeen    time.Time `json:"last_seen,omitempty"`
	Health      string    `json:"health"` // healthy, unhealthy, unknown
	Version     string    `json:"version,omitempty"`
	Environment string    `json:"environment,omitempty"`
}

// InstanceRegistration is the request body for registering a new instance
type InstanceRegistration struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description,omitempty"`
	Token       string `json:"token,omitempty"` // Shared secret for secure communication
}

// InstanceHealthResponse represents the health check response from a remote instance
type InstanceHealthResponse struct {
	Status      string `json:"status"`
	Environment string `json:"environment,omitempty"`
	Version     string `json:"version,omitempty"`
	Uptime      string `json:"uptime,omitempty"`
}

// InstancesResponse is the response for GET /api/instances
type InstancesResponse struct {
	Instances    []Instance `json:"instances"`
	TotalCount   int        `json:"total_count"`
	HealthyCount int        `json:"healthy_count"`
	ThisInstance Instance   `json:"this_instance"`
}

// InstanceActionResponse is the response for remote instance actions
type InstanceActionResponse struct {
	Success  bool   `json:"success"`
	Message  string `json:"message"`
	Instance string `json:"instance,omitempty"`
}

var (
	// In-memory instance registry with file persistence
	instanceRegistry     = make(map[string]*Instance)
	instanceRegistryMu   sync.RWMutex
	instanceDataPath     string
	instanceHealthClient *http.Client

	// This instance's identity
	thisInstanceID   string
	thisInstanceName string
	instanceSecret   string
)

func init() {
	// Initialize HTTP client for health checks
	instanceHealthClient = &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   5 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			MaxIdleConns:        10,
			IdleConnTimeout:     30 * time.Second,
			DisableCompression:  true,
			TLSHandshakeTimeout: 5 * time.Second,
		},
	}

	// Initialize this instance's identity
	thisInstanceName = os.Getenv("INSTANCE_NAME")
	if thisInstanceName == "" {
		hostname, err := os.Hostname()
		if err == nil {
			thisInstanceName = hostname
		} else {
			thisInstanceName = "primary"
		}
	}

	// Generate or load instance ID
	thisInstanceID = os.Getenv("INSTANCE_ID")
	if thisInstanceID == "" {
		thisInstanceID = generateInstanceID(thisInstanceName)
	}

	// Load shared secret for instance-to-instance communication
	instanceSecret = os.Getenv("INSTANCE_SECRET")
	if instanceSecret == "" {
		instanceSecret = getEnvOrFile("", "/run/secrets/instance_secret", "")
	}

	// Set data path for persistence
	instanceDataPath = os.Getenv("INSTANCE_DATA_PATH")
	if instanceDataPath == "" {
		instanceDataPath = "/data/instances.json"
	}

	// Load existing instances from file
	loadInstances()

	// Start background health checker
	go instanceHealthChecker()
}

// InstancesHandler handles the /api/instances endpoints
func InstancesHandler(w http.ResponseWriter, r *http.Request) {
	// Extract path suffix for routing
	path := strings.TrimPrefix(r.URL.Path, "/api/instances")

	switch {
	case path == "" || path == "/":
		switch r.Method {
		case http.MethodGet:
			handleListInstances(w, r)
		case http.MethodPost:
			handleRegisterInstance(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	case strings.HasPrefix(path, "/"):
		// Extract instance ID and action
		parts := strings.SplitN(path[1:], "/", 2)
		instanceID := parts[0]
		action := ""
		if len(parts) > 1 {
			action = parts[1]
		}

		switch action {
		case "":
			if r.Method == http.MethodDelete {
				handleRemoveInstance(w, r, instanceID)
			} else if r.Method == http.MethodGet {
				handleGetInstance(w, r, instanceID)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		case "health":
			if r.Method == http.MethodGet {
				handleCheckInstanceHealth(w, r, instanceID)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		case "sync":
			if r.Method == http.MethodPost {
				handleTriggerRemoteSync(w, r, instanceID)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		case "containers":
			if r.Method == http.MethodGet {
				handleGetRemoteContainers(w, r, instanceID)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		default:
			http.Error(w, "Unknown action", http.StatusNotFound)
		}
	default:
		http.Error(w, "Not found", http.StatusNotFound)
	}
}

// handleListInstances handles GET /api/instances
func handleListInstances(w http.ResponseWriter, r *http.Request) {
	instanceRegistryMu.RLock()
	instances := make([]Instance, 0, len(instanceRegistry))
	healthyCount := 0

	for _, inst := range instanceRegistry {
		// Create copy without exposing token
		instanceCopy := *inst
		instanceCopy.Token = ""
		instances = append(instances, instanceCopy)

		if inst.Health == "healthy" {
			healthyCount++
		}
	}
	instanceRegistryMu.RUnlock()

	// Build this instance info
	thisInstance := Instance{
		ID:          thisInstanceID,
		Name:        thisInstanceName,
		URL:         getThisInstanceURL(),
		Health:      "healthy",
		Environment: detectEnvironment(),
		Version:     getVersion(),
	}

	response := InstancesResponse{
		Instances:    instances,
		TotalCount:   len(instances),
		HealthyCount: healthyCount,
		ThisInstance: thisInstance,
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// handleRegisterInstance handles POST /api/instances
func handleRegisterInstance(w http.ResponseWriter, r *http.Request) {
	// Check authentication - only non-guests can register instances
	session := GetSessionFromRequest(r)
	if session == nil {
		http.Error(w, "Unauthorized: Authentication required", http.StatusUnauthorized)
		return
	}
	if session.IsGuest {
		http.Error(w, "Forbidden: Guest users cannot register instances", http.StatusForbidden)
		return
	}

	var reg InstanceRegistration
	if err := json.NewDecoder(r.Body).Decode(&reg); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if reg.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	if reg.URL == "" {
		http.Error(w, "URL is required", http.StatusBadRequest)
		return
	}

	// Normalize URL
	reg.URL = strings.TrimRight(reg.URL, "/")
	if !strings.HasPrefix(reg.URL, "http://") && !strings.HasPrefix(reg.URL, "https://") {
		reg.URL = "https://" + reg.URL
	}

	// Generate instance ID from URL
	instanceID := generateInstanceID(reg.URL)

	// Check for duplicates
	instanceRegistryMu.RLock()
	_, exists := instanceRegistry[instanceID]
	instanceRegistryMu.RUnlock()

	if exists {
		http.Error(w, "Instance already registered", http.StatusConflict)
		return
	}

	// Create new instance
	instance := &Instance{
		ID:          instanceID,
		Name:        reg.Name,
		URL:         reg.URL,
		Description: reg.Description,
		CreatedAt:   time.Now(),
		Health:      "unknown",
	}

	// Store token hash if provided
	if reg.Token != "" {
		instance.TokenHash = hashToken(reg.Token)
	}

	// Register the instance
	instanceRegistryMu.Lock()
	instanceRegistry[instanceID] = instance
	instanceRegistryMu.Unlock()

	// Persist to file
	saveInstances()

	// Trigger initial health check
	go checkInstanceHealth(instance)

	// Return the registered instance (without token)
	instanceCopy := *instance
	instanceCopy.Token = ""

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)

	if err := json.NewEncoder(w).Encode(instanceCopy); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// handleRemoveInstance handles DELETE /api/instances/{id}
func handleRemoveInstance(w http.ResponseWriter, r *http.Request, instanceID string) {
	// Check authentication
	session := GetSessionFromRequest(r)
	if session == nil {
		http.Error(w, "Unauthorized: Authentication required", http.StatusUnauthorized)
		return
	}
	if session.IsGuest {
		http.Error(w, "Forbidden: Guest users cannot remove instances", http.StatusForbidden)
		return
	}

	instanceRegistryMu.Lock()
	_, exists := instanceRegistry[instanceID]
	if exists {
		delete(instanceRegistry, instanceID)
	}
	instanceRegistryMu.Unlock()

	if !exists {
		http.Error(w, "Instance not found", http.StatusNotFound)
		return
	}

	// Persist to file
	saveInstances()

	response := InstanceActionResponse{
		Success:  true,
		Message:  "Instance removed successfully",
		Instance: instanceID,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// handleGetInstance handles GET /api/instances/{id}
func handleGetInstance(w http.ResponseWriter, r *http.Request, instanceID string) {
	instanceRegistryMu.RLock()
	instance, exists := instanceRegistry[instanceID]
	instanceRegistryMu.RUnlock()

	if !exists {
		http.Error(w, "Instance not found", http.StatusNotFound)
		return
	}

	// Create copy without token
	instanceCopy := *instance
	instanceCopy.Token = ""

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(instanceCopy); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// handleCheckInstanceHealth handles GET /api/instances/{id}/health
func handleCheckInstanceHealth(w http.ResponseWriter, r *http.Request, instanceID string) {
	instanceRegistryMu.RLock()
	instance, exists := instanceRegistry[instanceID]
	instanceRegistryMu.RUnlock()

	if !exists {
		http.Error(w, "Instance not found", http.StatusNotFound)
		return
	}

	// Perform health check
	checkInstanceHealth(instance)

	// Return updated instance info
	instanceRegistryMu.RLock()
	instanceCopy := *instanceRegistry[instanceID]
	instanceRegistryMu.RUnlock()
	instanceCopy.Token = ""

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(instanceCopy); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// handleTriggerRemoteSync handles POST /api/instances/{id}/sync
func handleTriggerRemoteSync(w http.ResponseWriter, r *http.Request, instanceID string) {
	// Check authentication
	session := GetSessionFromRequest(r)
	if session == nil {
		http.Error(w, "Unauthorized: Authentication required", http.StatusUnauthorized)
		return
	}
	if session.IsGuest {
		http.Error(w, "Forbidden: Guest users cannot trigger remote sync", http.StatusForbidden)
		return
	}

	instanceRegistryMu.RLock()
	instance, exists := instanceRegistry[instanceID]
	instanceRegistryMu.RUnlock()

	if !exists {
		http.Error(w, "Instance not found", http.StatusNotFound)
		return
	}

	// Create request to remote instance
	req, err := http.NewRequest("POST", instance.URL+"/api/deployment", nil)
	if err != nil {
		response := InstanceActionResponse{
			Success:  false,
			Message:  "Failed to create request: " + err.Error(),
			Instance: instanceID,
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(response)
		return
	}

	// Add authentication header if token is configured
	if instance.TokenHash != "" && instanceSecret != "" {
		req.Header.Set("X-Instance-Token", instanceSecret)
	}

	// Execute request
	resp, err := instanceHealthClient.Do(req)
	if err != nil {
		response := InstanceActionResponse{
			Success:  false,
			Message:  "Failed to connect to remote instance: " + err.Error(),
			Instance: instanceID,
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(response)
		return
	}
	defer resp.Body.Close()

	// Read response
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		response := InstanceActionResponse{
			Success:  true,
			Message:  "Remote sync triggered successfully",
			Instance: instanceID,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	} else {
		response := InstanceActionResponse{
			Success:  false,
			Message:  fmt.Sprintf("Remote sync failed: %s (status %d)", string(body), resp.StatusCode),
			Instance: instanceID,
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(response)
	}
}

// handleGetRemoteContainers handles GET /api/instances/{id}/containers
func handleGetRemoteContainers(w http.ResponseWriter, r *http.Request, instanceID string) {
	instanceRegistryMu.RLock()
	instance, exists := instanceRegistry[instanceID]
	instanceRegistryMu.RUnlock()

	if !exists {
		http.Error(w, "Instance not found", http.StatusNotFound)
		return
	}

	// Create request to remote instance
	req, err := http.NewRequest("GET", instance.URL+"/api/containers", nil)
	if err != nil {
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}

	// Add authentication header if configured
	if instance.TokenHash != "" && instanceSecret != "" {
		req.Header.Set("X-Instance-Token", instanceSecret)
	}

	resp, err := instanceHealthClient.Do(req)
	if err != nil {
		http.Error(w, "Failed to connect to remote instance", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Forward the response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// checkInstanceHealth performs a health check on a remote instance
func checkInstanceHealth(instance *Instance) {
	req, err := http.NewRequest("GET", instance.URL+"/health", nil)
	if err != nil {
		updateInstanceHealth(instance.ID, "unhealthy", "", "")
		return
	}

	resp, err := instanceHealthClient.Do(req)
	if err != nil {
		updateInstanceHealth(instance.ID, "unhealthy", "", "")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		updateInstanceHealth(instance.ID, "unhealthy", "", "")
		return
	}

	// Try to get more info from deployment endpoint
	depReq, err := http.NewRequest("GET", instance.URL+"/api/deployment", nil)
	if err == nil {
		if instance.TokenHash != "" && instanceSecret != "" {
			depReq.Header.Set("X-Instance-Token", instanceSecret)
		}
		depResp, err := instanceHealthClient.Do(depReq)
		if err == nil {
			defer depResp.Body.Close()
			if depResp.StatusCode == http.StatusOK {
				var depInfo DeploymentInfo
				if err := json.NewDecoder(depResp.Body).Decode(&depInfo); err == nil {
					updateInstanceHealth(instance.ID, "healthy", depInfo.Version, depInfo.Environment)
					return
				}
			}
		}
	}

	updateInstanceHealth(instance.ID, "healthy", "", "")
}

// updateInstanceHealth updates the health status of an instance
func updateInstanceHealth(instanceID, health, version, environment string) {
	instanceRegistryMu.Lock()
	defer instanceRegistryMu.Unlock()

	if inst, exists := instanceRegistry[instanceID]; exists {
		inst.Health = health
		inst.LastSeen = time.Now()
		if version != "" {
			inst.Version = version
		}
		if environment != "" {
			inst.Environment = environment
		}
	}
}

// instanceHealthChecker runs periodic health checks on all instances
func instanceHealthChecker() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		instanceRegistryMu.RLock()
		instances := make([]*Instance, 0, len(instanceRegistry))
		for _, inst := range instanceRegistry {
			instances = append(instances, inst)
		}
		instanceRegistryMu.RUnlock()

		for _, inst := range instances {
			go checkInstanceHealth(inst)
		}
	}
}

// loadInstances loads instances from the persistence file
func loadInstances() {
	data, err := os.ReadFile(instanceDataPath)
	if err != nil {
		if !os.IsNotExist(err) {
			fmt.Printf("Warning: Failed to load instances: %v\n", err)
		}
		return
	}

	var instances []*Instance
	if err := json.Unmarshal(data, &instances); err != nil {
		fmt.Printf("Warning: Failed to parse instances file: %v\n", err)
		return
	}

	instanceRegistryMu.Lock()
	for _, inst := range instances {
		instanceRegistry[inst.ID] = inst
	}
	instanceRegistryMu.Unlock()
}

// saveInstances persists instances to file
func saveInstances() {
	instanceRegistryMu.RLock()
	instances := make([]*Instance, 0, len(instanceRegistry))
	for _, inst := range instanceRegistry {
		instances = append(instances, inst)
	}
	instanceRegistryMu.RUnlock()

	data, err := json.MarshalIndent(instances, "", "  ")
	if err != nil {
		fmt.Printf("Warning: Failed to serialize instances: %v\n", err)
		return
	}

	// Ensure directory exists
	dir := filepath.Dir(instanceDataPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Printf("Warning: Failed to create data directory: %v\n", err)
		return
	}

	if err := os.WriteFile(instanceDataPath, data, 0600); err != nil {
		fmt.Printf("Warning: Failed to save instances: %v\n", err)
	}
}

// generateInstanceID creates a unique ID for an instance based on its URL or name
func generateInstanceID(input string) string {
	hash := sha256.Sum256([]byte(input))
	return hex.EncodeToString(hash[:8])
}

// hashToken creates a secure hash of a token
func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

// verifyToken checks if a provided token matches the stored hash
func verifyToken(token, storedHash string) bool {
	providedHash := hashToken(token)
	return subtle.ConstantTimeCompare([]byte(providedHash), []byte(storedHash)) == 1
}

// getThisInstanceURL returns the URL of this instance
func getThisInstanceURL() string {
	url := os.Getenv("INSTANCE_URL")
	if url != "" {
		return url
	}
	// Try to construct from hostname
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "localhost"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	return "http://" + hostname + ":" + port
}

// InstanceTokenMiddleware validates instance-to-instance tokens
// This can be used to protect endpoints that receive calls from other instances
func InstanceTokenMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip if no instance secret is configured
		if instanceSecret == "" {
			next.ServeHTTP(w, r)
			return
		}

		// Check if this is an inter-instance request
		token := r.Header.Get("X-Instance-Token")
		if token == "" {
			// No token provided - might be a regular user request
			// Let normal auth middleware handle it
			next.ServeHTTP(w, r)
			return
		}

		// Verify the instance token
		if subtle.ConstantTimeCompare([]byte(token), []byte(instanceSecret)) != 1 {
			http.Error(w, "Invalid instance token", http.StatusUnauthorized)
			return
		}

		// Token valid - proceed
		next.ServeHTTP(w, r)
	})
}
