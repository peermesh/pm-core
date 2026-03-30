package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

type ContainerResourceInfo struct {
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryMB      uint64  `json:"memory_mb"`
	MemoryLimitMB uint64  `json:"memory_limit_mb"`
}

type ContainerDetail struct {
	ID             string                `json:"id"`
	Name           string                `json:"name"`
	Image          string                `json:"image"`
	Profile        string                `json:"profile"`
	ComposeProject string                `json:"compose_project,omitempty"`
	Status         string                `json:"status"`
	Health         string                `json:"health"`
	Uptime         string                `json:"uptime"`
	Resources      ContainerResourceInfo `json:"resources"`
	Ports          []string              `json:"ports"`
	Networks       []string              `json:"networks"`
}

// CapacityGroupSummary rolls up CPU/memory for running containers by Docker Compose project label.
type CapacityGroupSummary struct {
	ComposeProject  string  `json:"compose_project"`
	ContainerCount  int     `json:"container_count"`
	RunningCount    int     `json:"running_count"`
	CPUPercentTotal float64 `json:"cpu_percent_total"`
	MemoryMB        uint64  `json:"memory_mb"`
	MemoryLimitMB   uint64  `json:"memory_limit_mb"`
}

type ContainersResponse struct {
	Containers     []ContainerDetail        `json:"containers"`
	CapacityGroups []CapacityGroupSummary   `json:"capacity_groups"`
}

type dockerAPIContainer struct {
	ID      string            `json:"Id"`
	Names   []string          `json:"Names"`
	Image   string            `json:"Image"`
	State   string            `json:"State"`
	Status  string            `json:"Status"`
	Created int64             `json:"Created"`
	Labels  map[string]string `json:"Labels"`
	Ports   []struct {
		PrivatePort int    `json:"PrivatePort"`
		PublicPort  int    `json:"PublicPort"`
		Type        string `json:"Type"`
	} `json:"Ports"`
	NetworkSettings struct {
		Networks map[string]struct {
			NetworkID string `json:"NetworkID"`
		} `json:"Networks"`
	} `json:"NetworkSettings"`
}

type dockerAPIInspect struct {
	ID    string `json:"Id"`
	State struct {
		Status     string    `json:"Status"`
		StartedAt  time.Time `json:"StartedAt"`
		Health     *struct {
			Status string `json:"Status"`
			Log    []struct {
				Start    time.Time `json:"Start"`
				End      time.Time `json:"End"`
				ExitCode int       `json:"ExitCode"`
				Output   string    `json:"Output"`
			} `json:"Log"`
		} `json:"Health"`
	} `json:"State"`
	Created    string            `json:"Created"`
	Image      string            `json:"Image"`
	Name       string            `json:"Name"`
	RestartCount int             `json:"RestartCount"`
	Config     struct {
		Cmd        []string          `json:"Cmd"`
		Entrypoint []string          `json:"Entrypoint"`
		Env        []string          `json:"Env"`
		Image      string            `json:"Image"`
		Labels     map[string]string `json:"Labels"`
	} `json:"Config"`
	HostConfig struct {
		Memory     int64  `json:"Memory"`
		NanoCpus   int64  `json:"NanoCpus"`
		CpuShares  int64  `json:"CpuShares"`
		CpuQuota   int64  `json:"CpuQuota"`
		CpuPeriod  int64  `json:"CpuPeriod"`
		CapAdd     []string `json:"CapAdd"`
		CapDrop    []string `json:"CapDrop"`
		SecurityOpt []string `json:"SecurityOpt"`
		ReadonlyRootfs bool `json:"ReadonlyRootfs"`
		Privileged     bool `json:"Privileged"`
	} `json:"HostConfig"`
	Mounts []struct {
		Type        string `json:"Type"`
		Name        string `json:"Name"`
		Source      string `json:"Source"`
		Destination string `json:"Destination"`
		RW          bool   `json:"RW"`
	} `json:"Mounts"`
	NetworkSettings struct {
		Networks map[string]struct {
			IPAddress string `json:"IPAddress"`
			Gateway   string `json:"Gateway"`
			NetworkID string `json:"NetworkID"`
		} `json:"Networks"`
	} `json:"NetworkSettings"`
}

type dockerAPIStats struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     int    `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	MemoryStats struct {
		Usage    uint64            `json:"usage"`
		Limit    uint64            `json:"limit"`
		Stats    map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RxBytes   uint64 `json:"rx_bytes"`
		TxBytes   uint64 `json:"tx_bytes"`
		RxPackets uint64 `json:"rx_packets"`
		TxPackets uint64 `json:"tx_packets"`
	} `json:"networks"`
	BlkioStats struct {
		IoServiceBytesRecursive []struct {
			Op    string `json:"op"`
			Value uint64 `json:"value"`
		} `json:"io_service_bytes_recursive"`
	} `json:"blkio_stats"`
	PidsStats struct {
		Current uint64 `json:"current"`
		Limit   uint64 `json:"limit"`
	} `json:"pids_stats"`
}

type containersClient struct {
	baseURL    string
	httpClient *http.Client
}

func newContainersClient() *containersClient {
	socketProxyURL := os.Getenv("DOCKER_HOST")
	if socketProxyURL == "" {
		socketProxyURL = "http://socket-proxy:2375"
	}
	// Convert tcp:// to http:// for Go's http client
	socketProxyURL = strings.Replace(socketProxyURL, "tcp://", "http://", 1)

	return &containersClient{
		baseURL: socketProxyURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				DialContext: (&net.Dialer{
					Timeout:   5 * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				MaxIdleConns:       10,
				IdleConnTimeout:    90 * time.Second,
				DisableCompression: true,
			},
		},
	}
}

func (c *containersClient) listContainers() ([]dockerAPIContainer, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/containers/json?all=true")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Docker API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Docker API error: %s (status %d)", string(body), resp.StatusCode)
	}

	var containers []dockerAPIContainer
	if err := json.NewDecoder(resp.Body).Decode(&containers); err != nil {
		return nil, fmt.Errorf("failed to decode containers: %w", err)
	}

	return containers, nil
}

func (c *containersClient) inspectContainer(containerID string) (*dockerAPIInspect, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/containers/" + containerID + "/json")
	if err != nil {
		return nil, fmt.Errorf("failed to inspect container: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Docker API error: %s (status %d)", string(body), resp.StatusCode)
	}

	var inspect dockerAPIInspect
	if err := json.NewDecoder(resp.Body).Decode(&inspect); err != nil {
		return nil, fmt.Errorf("failed to decode inspect: %w", err)
	}

	return &inspect, nil
}

func (c *containersClient) getContainerStats(containerID string) (*dockerAPIStats, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/containers/"+containerID+"/stats?stream=false", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create stats request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get container stats: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Docker API error: %s (status %d)", string(body), resp.StatusCode)
	}

	var stats dockerAPIStats
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return nil, fmt.Errorf("failed to decode stats: %w", err)
	}

	return &stats, nil
}

func ContainersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	client := newContainersClient()

	containers, err := client.listContainers()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to list containers: %v", err), http.StatusInternalServerError)
		return
	}

	response := ContainersResponse{
		Containers: make([]ContainerDetail, 0, len(containers)),
	}

	for _, container := range containers {
		info := buildContainerDetail(client, container)
		response.Containers = append(response.Containers, info)
	}

	sort.Slice(response.Containers, func(i, j int) bool {
		return response.Containers[i].Name < response.Containers[j].Name
	})

	response.CapacityGroups = aggregateCapacityGroups(response.Containers)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

func buildContainerDetail(client *containersClient, container dockerAPIContainer) ContainerDetail {
	name := ""
	if len(container.Names) > 0 {
		name = container.Names[0]
		if len(name) > 0 && name[0] == '/' {
			name = name[1:]
		}
	}

	profile := detectProfile(container.Labels)

	ports := make([]string, 0, len(container.Ports))
	for _, p := range container.Ports {
		portStr := fmt.Sprintf("%d/%s", p.PrivatePort, p.Type)
		ports = append(ports, portStr)
	}

	networks := make([]string, 0, len(container.NetworkSettings.Networks))
	for networkName := range container.NetworkSettings.Networks {
		networks = append(networks, networkName)
	}
	sort.Strings(networks)

	info := ContainerDetail{
		ID:             truncateID(container.ID),
		Name:           name,
		Image:          container.Image,
		Profile:        profile,
		ComposeProject: composeProjectFromLabels(container.Labels),
		Status:         container.State,
		Health:   "unknown",
		Uptime:   "unknown",
		Ports:    ports,
		Networks: networks,
		Resources: ContainerResourceInfo{
			CPUPercent:    0,
			MemoryMB:      0,
			MemoryLimitMB: 0,
		},
	}

	inspect, err := client.inspectContainer(container.ID)
	if err == nil {
		if inspect.State.Health != nil {
			info.Health = inspect.State.Health.Status
		} else if container.State == "running" {
			info.Health = "healthy"
		} else {
			info.Health = "none"
		}

		if !inspect.State.StartedAt.IsZero() {
			info.Uptime = formatContainerUptime(time.Since(inspect.State.StartedAt))
		}

		if inspect.HostConfig.Memory > 0 {
			info.Resources.MemoryLimitMB = uint64(inspect.HostConfig.Memory) / (1024 * 1024)
		}
	}

	if container.State == "running" {
		stats, err := client.getContainerStats(container.ID)
		if err == nil {
			info.Resources.CPUPercent = calculateCPUPercent(stats)
			info.Resources.MemoryMB = stats.MemoryStats.Usage / (1024 * 1024)
			if stats.MemoryStats.Limit > 0 && info.Resources.MemoryLimitMB == 0 {
				info.Resources.MemoryLimitMB = stats.MemoryStats.Limit / (1024 * 1024)
			}
		}
	}

	return info
}

// composeProjectFromLabels returns com.docker.compose.project when set (canonical site/stack key).
func composeProjectFromLabels(labels map[string]string) string {
	if labels == nil {
		return ""
	}
	return strings.TrimSpace(labels["com.docker.compose.project"])
}

func aggregateCapacityGroups(containers []ContainerDetail) []CapacityGroupSummary {
	type acc struct {
		containerCount int
		runningCount   int
		cpuTotal       float64
		memoryMB       uint64
		memoryLimitMB  uint64
	}
	byKey := make(map[string]*acc)
	for _, c := range containers {
		key := strings.TrimSpace(c.ComposeProject)
		if key == "" {
			key = "(unlabeled)"
		}
		a := byKey[key]
		if a == nil {
			a = &acc{}
			byKey[key] = a
		}
		a.containerCount++
		if c.Status == "running" {
			a.runningCount++
			a.cpuTotal += c.Resources.CPUPercent
			a.memoryMB += c.Resources.MemoryMB
			a.memoryLimitMB += c.Resources.MemoryLimitMB
		}
	}
	keys := make([]string, 0, len(byKey))
	for k := range byKey {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]CapacityGroupSummary, 0, len(keys))
	for _, k := range keys {
		a := byKey[k]
		out = append(out, CapacityGroupSummary{
			ComposeProject:  k,
			ContainerCount:  a.containerCount,
			RunningCount:    a.runningCount,
			CPUPercentTotal: a.cpuTotal,
			MemoryMB:        a.memoryMB,
			MemoryLimitMB:   a.memoryLimitMB,
		})
	}
	return out
}

func detectProfile(labels map[string]string) string {
	if service, ok := labels["com.docker.compose.service"]; ok {
		return service
	}
	if project, ok := labels["com.docker.compose.project"]; ok {
		return project
	}
	if profile, ok := labels["pmdl.profile"]; ok {
		return profile
	}
	return "unknown"
}

func truncateID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func calculateCPUPercent(stats *dockerAPIStats) float64 {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemCPUUsage - stats.PreCPUStats.SystemCPUUsage)

	if systemDelta > 0 && cpuDelta > 0 {
		cpuCount := stats.CPUStats.OnlineCPUs
		if cpuCount == 0 {
			cpuCount = 1
		}
		return (cpuDelta / systemDelta) * float64(cpuCount) * 100.0
	}

	return 0.0
}

func formatContainerUptime(d time.Duration) string {
	if d < 0 {
		return "0s"
	}

	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh", days, hours)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%ds", int(d.Seconds()))
}

// --- Container Detail Endpoint ---

// HealthCheckResult represents a single health check log entry
type HealthCheckResult struct {
	Timestamp string `json:"timestamp"`
	ExitCode  int    `json:"exit_code"`
	Output    string `json:"output"`
}

// ContainerMount represents a mount/volume on a container
type ContainerMount struct {
	Type        string `json:"type"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	ReadWrite   bool   `json:"rw"`
	Name        string `json:"name,omitempty"`
}

// ContainerNetwork represents a network attached to a container
type ContainerNetwork struct {
	Name      string `json:"name"`
	IPAddress string `json:"ip_address"`
	Gateway   string `json:"gateway"`
}

// ContainerPort represents a port mapping
type ContainerPort struct {
	Container int    `json:"container"`
	Host      int    `json:"host,omitempty"`
	Protocol  string `json:"protocol"`
}

// ContainerSecurity represents the security posture of a container
type ContainerSecurity struct {
	CapAdd         []string `json:"cap_add"`
	CapDrop        []string `json:"cap_drop"`
	SecurityOpt    []string `json:"security_opt"`
	ReadOnlyRootfs bool     `json:"read_only_rootfs"`
	Privileged     bool     `json:"privileged"`
	User           string   `json:"user,omitempty"`
}

// ContainerResourceLimits represents configured resource limits
type ContainerResourceLimits struct {
	MemoryBytes int64 `json:"memory_bytes"`
	NanoCPUs    int64 `json:"nano_cpus"`
	CPUShares   int64 `json:"cpu_shares"`
	CPUQuota    int64 `json:"cpu_quota"`
	CPUPeriod   int64 `json:"cpu_period"`
}

// NetworkIO represents network I/O counters
type NetworkIO struct {
	RxBytes   uint64 `json:"rx_bytes"`
	TxBytes   uint64 `json:"tx_bytes"`
	RxPackets uint64 `json:"rx_packets"`
	TxPackets uint64 `json:"tx_packets"`
}

// BlockIO represents block I/O counters
type BlockIO struct {
	ReadBytes  uint64 `json:"read_bytes"`
	WriteBytes uint64 `json:"write_bytes"`
}

// MemoryBreakdown represents detailed memory stats
type MemoryBreakdown struct {
	RSS      uint64 `json:"rss"`
	Cache    uint64 `json:"cache"`
	Swap     uint64 `json:"swap"`
	Usage    uint64 `json:"usage"`
	Limit    uint64 `json:"limit"`
}

// ContainerDetailResponse is the full detail response for a single container
type ContainerDetailResponse struct {
	// Overview tab
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	Image        string              `json:"image"`
	Created      string              `json:"created"`
	Started      string              `json:"started"`
	Uptime       string              `json:"uptime"`
	Status       string              `json:"status"`
	Health       string              `json:"health"`
	HealthChecks []HealthCheckResult `json:"health_checks"`
	RestartCount int                 `json:"restart_count"`
	Command      string              `json:"command"`
	Entrypoint   string              `json:"entrypoint"`
	Profile      string              `json:"profile"`

	// Resources tab (live)
	CPUPercent      float64         `json:"cpu_percent"`
	MemoryBreakdown MemoryBreakdown `json:"memory_breakdown"`
	NetworkIO       NetworkIO       `json:"network_io"`
	BlockIO         BlockIO         `json:"block_io"`
	PIDCount        uint64          `json:"pid_count"`

	// Configuration tab
	Environment    []EnvVar                `json:"environment"`
	Mounts         []ContainerMount        `json:"mounts"`
	Networks       []ContainerNetwork      `json:"networks"`
	Ports          []ContainerPort         `json:"ports"`
	Security       ContainerSecurity       `json:"security"`
	ResourceLimits ContainerResourceLimits `json:"resource_limits"`
}

// EnvVar represents an environment variable with optional masking
type EnvVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// sensitiveEnvPatterns are patterns that indicate a sensitive environment variable
var sensitiveEnvPatterns = []string{
	"PASSWORD",
	"SECRET",
	"KEY",
	"TOKEN",
	"CREDENTIAL",
	"PRIVATE",
	"AUTH",
}

// isSensitiveEnvVar checks if an environment variable key matches sensitive patterns
func isSensitiveEnvVar(key string) bool {
	upper := strings.ToUpper(key)
	for _, pattern := range sensitiveEnvPatterns {
		if strings.Contains(upper, pattern) {
			return true
		}
	}
	return false
}

// maskEnvVars processes environment variable strings and masks sensitive values
func maskEnvVars(envStrings []string) []EnvVar {
	vars := make([]EnvVar, 0, len(envStrings))
	for _, env := range envStrings {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := parts[0]
		value := parts[1]
		if isSensitiveEnvVar(key) {
			value = "***"
		}
		vars = append(vars, EnvVar{Key: key, Value: value})
	}
	return vars
}

// ContainerDetailHandler handles GET /api/containers/{id}
// It returns combined inspect + stats data for a single container
func ContainerDetailHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract container ID from path: /api/containers/{id}
	path := strings.TrimPrefix(r.URL.Path, "/api/containers/")
	containerID := strings.TrimSpace(path)
	if containerID == "" {
		http.Error(w, "Container ID is required", http.StatusBadRequest)
		return
	}

	// Validate container ID (hex chars only, 12 or 64 chars typical)
	if len(containerID) > 64 {
		http.Error(w, "Invalid container ID", http.StatusBadRequest)
		return
	}
	for _, c := range containerID {
		if !((c >= 'a' && c <= 'f') || (c >= '0' && c <= '9')) {
			http.Error(w, "Invalid container ID", http.StatusBadRequest)
			return
		}
	}

	client := newContainersClient()

	// First, find the full container ID by listing and matching
	containers, err := client.listContainers()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to list containers: %v", err), http.StatusInternalServerError)
		return
	}

	var fullID string
	var listEntry *dockerAPIContainer
	for i, c := range containers {
		if c.ID == containerID || strings.HasPrefix(c.ID, containerID) {
			fullID = c.ID
			listEntry = &containers[i]
			break
		}
	}

	if fullID == "" {
		http.Error(w, "Container not found", http.StatusNotFound)
		return
	}

	// Get detailed inspect data
	inspect, err := client.inspectContainer(fullID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to inspect container: %v", err), http.StatusInternalServerError)
		return
	}

	// Build the detail response
	response := buildContainerDetailResponse(inspect, listEntry)

	// Get live stats if running
	if inspect.State.Status == "running" {
		stats, err := client.getContainerStats(fullID)
		if err == nil {
			populateStatsData(&response, stats)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// buildContainerDetailResponse constructs the full detail response from inspect data
func buildContainerDetailResponse(inspect *dockerAPIInspect, listEntry *dockerAPIContainer) ContainerDetailResponse {
	name := inspect.Name
	if len(name) > 0 && name[0] == '/' {
		name = name[1:]
	}

	profile := detectProfile(inspect.Config.Labels)

	// Health status
	health := "none"
	var healthChecks []HealthCheckResult
	if inspect.State.Health != nil {
		health = inspect.State.Health.Status
		if inspect.State.Health.Log != nil {
			// Take last 5 entries
			logs := inspect.State.Health.Log
			start := 0
			if len(logs) > 5 {
				start = len(logs) - 5
			}
			for _, entry := range logs[start:] {
				output := entry.Output
				// Truncate long output
				if len(output) > 200 {
					output = output[:200] + "..."
				}
				healthChecks = append(healthChecks, HealthCheckResult{
					Timestamp: entry.Start.Format(time.RFC3339),
					ExitCode:  entry.ExitCode,
					Output:    strings.TrimSpace(output),
				})
			}
		}
	} else if inspect.State.Status == "running" {
		health = "healthy"
	}
	if healthChecks == nil {
		healthChecks = []HealthCheckResult{}
	}

	// Uptime
	uptime := "unknown"
	started := ""
	if !inspect.State.StartedAt.IsZero() {
		uptime = formatContainerUptime(time.Since(inspect.State.StartedAt))
		started = inspect.State.StartedAt.Format(time.RFC3339)
	}

	// Command and entrypoint
	command := strings.Join(inspect.Config.Cmd, " ")
	entrypoint := strings.Join(inspect.Config.Entrypoint, " ")

	// Environment variables (masked)
	envVars := maskEnvVars(inspect.Config.Env)

	// Mounts
	mounts := make([]ContainerMount, 0, len(inspect.Mounts))
	for _, m := range inspect.Mounts {
		mounts = append(mounts, ContainerMount{
			Type:        m.Type,
			Source:      m.Source,
			Destination: m.Destination,
			ReadWrite:   m.RW,
			Name:        m.Name,
		})
	}

	// Networks
	networks := make([]ContainerNetwork, 0, len(inspect.NetworkSettings.Networks))
	for netName, netInfo := range inspect.NetworkSettings.Networks {
		networks = append(networks, ContainerNetwork{
			Name:      netName,
			IPAddress: netInfo.IPAddress,
			Gateway:   netInfo.Gateway,
		})
	}
	sort.Slice(networks, func(i, j int) bool {
		return networks[i].Name < networks[j].Name
	})

	// Ports from list entry
	ports := make([]ContainerPort, 0)
	if listEntry != nil {
		for _, p := range listEntry.Ports {
			ports = append(ports, ContainerPort{
				Container: p.PrivatePort,
				Host:      p.PublicPort,
				Protocol:  p.Type,
			})
		}
	}

	// Security
	security := ContainerSecurity{
		CapAdd:         inspect.HostConfig.CapAdd,
		CapDrop:        inspect.HostConfig.CapDrop,
		SecurityOpt:    inspect.HostConfig.SecurityOpt,
		ReadOnlyRootfs: inspect.HostConfig.ReadonlyRootfs,
		Privileged:     inspect.HostConfig.Privileged,
	}
	if security.CapAdd == nil {
		security.CapAdd = []string{}
	}
	if security.CapDrop == nil {
		security.CapDrop = []string{}
	}
	if security.SecurityOpt == nil {
		security.SecurityOpt = []string{}
	}

	// Resource limits
	limits := ContainerResourceLimits{
		MemoryBytes: inspect.HostConfig.Memory,
		NanoCPUs:    inspect.HostConfig.NanoCpus,
		CPUShares:   inspect.HostConfig.CpuShares,
		CPUQuota:    inspect.HostConfig.CpuQuota,
		CPUPeriod:   inspect.HostConfig.CpuPeriod,
	}

	return ContainerDetailResponse{
		ID:             truncateID(inspect.ID),
		Name:           name,
		Image:          inspect.Config.Image,
		Created:        inspect.Created,
		Started:        started,
		Uptime:         uptime,
		Status:         inspect.State.Status,
		Health:         health,
		HealthChecks:   healthChecks,
		RestartCount:   inspect.RestartCount,
		Command:        command,
		Entrypoint:     entrypoint,
		Profile:        profile,
		Environment:    envVars,
		Mounts:         mounts,
		Networks:       networks,
		Ports:          ports,
		Security:       security,
		ResourceLimits: limits,
		// Stats fields default to zero values
		MemoryBreakdown: MemoryBreakdown{},
		NetworkIO:       NetworkIO{},
		BlockIO:         BlockIO{},
	}
}

// populateStatsData fills in the live resource stats from Docker stats API
func populateStatsData(response *ContainerDetailResponse, stats *dockerAPIStats) {
	response.CPUPercent = calculateCPUPercent(stats)

	// Memory breakdown
	response.MemoryBreakdown.Usage = stats.MemoryStats.Usage
	response.MemoryBreakdown.Limit = stats.MemoryStats.Limit
	if stats.MemoryStats.Stats != nil {
		response.MemoryBreakdown.RSS = stats.MemoryStats.Stats["rss"]
		response.MemoryBreakdown.Cache = stats.MemoryStats.Stats["cache"]
		response.MemoryBreakdown.Swap = stats.MemoryStats.Stats["swap"]
	}

	// Network I/O (aggregate all interfaces)
	for _, netStats := range stats.Networks {
		response.NetworkIO.RxBytes += netStats.RxBytes
		response.NetworkIO.TxBytes += netStats.TxBytes
		response.NetworkIO.RxPackets += netStats.RxPackets
		response.NetworkIO.TxPackets += netStats.TxPackets
	}

	// Block I/O
	for _, entry := range stats.BlkioStats.IoServiceBytesRecursive {
		switch strings.ToLower(entry.Op) {
		case "read":
			response.BlockIO.ReadBytes += entry.Value
		case "write":
			response.BlockIO.WriteBytes += entry.Value
		}
	}

	// PIDs
	response.PIDCount = stats.PidsStats.Current
}
