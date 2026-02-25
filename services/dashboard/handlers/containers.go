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
	ID        string                `json:"id"`
	Name      string                `json:"name"`
	Image     string                `json:"image"`
	Profile   string                `json:"profile"`
	Status    string                `json:"status"`
	Health    string                `json:"health"`
	Uptime    string                `json:"uptime"`
	Resources ContainerResourceInfo `json:"resources"`
	Ports     []string              `json:"ports"`
	Networks  []string              `json:"networks"`
}

type ContainersResponse struct {
	Containers []ContainerDetail `json:"containers"`
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
	State struct {
		Status     string    `json:"Status"`
		StartedAt  time.Time `json:"StartedAt"`
		Health     *struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
	HostConfig struct {
		Memory int64 `json:"Memory"`
	} `json:"HostConfig"`
	Mounts []struct {
		Type        string `json:"Type"`
		Name        string `json:"Name"`
		Source      string `json:"Source"`
		Destination string `json:"Destination"`
	} `json:"Mounts"`
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
		Usage uint64 `json:"usage"`
		Limit uint64 `json:"limit"`
	} `json:"memory_stats"`
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
		ID:       truncateID(container.ID),
		Name:     name,
		Image:    container.Image,
		Profile:  profile,
		Status:   container.State,
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
