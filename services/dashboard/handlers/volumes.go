package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
)

type VolumeDetail struct {
	Name       string   `json:"name"`
	Driver     string   `json:"driver"`
	SizeBytes  int64    `json:"size_bytes"`
	MountPoint string   `json:"mount_point"`
	InUse      bool     `json:"in_use"`
	UsedBy     []string `json:"used_by"`
	CreatedAt  string   `json:"created_at"`
	Labels     map[string]string `json:"labels,omitempty"`
}

type VolumesResponse struct {
	Volumes    []VolumeDetail `json:"volumes"`
	TotalCount int            `json:"total_count"`
	TotalSize  int64          `json:"total_size_bytes"`
}

type dockerAPIVolume struct {
	Name       string            `json:"Name"`
	Driver     string            `json:"Driver"`
	Mountpoint string            `json:"Mountpoint"`
	CreatedAt  string            `json:"CreatedAt"`
	Labels     map[string]string `json:"Labels"`
	Scope      string            `json:"Scope"`
	Options    map[string]string `json:"Options"`
	UsageData  *struct {
		Size     int64 `json:"Size"`
		RefCount int   `json:"RefCount"`
	} `json:"UsageData"`
}

type dockerAPIVolumesResponse struct {
	Volumes  []dockerAPIVolume `json:"Volumes"`
	Warnings []string          `json:"Warnings"`
}

func (c *containersClient) listVolumes() ([]dockerAPIVolume, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/volumes")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Docker API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Docker API error: %s (status %d)", string(body), resp.StatusCode)
	}

	var volumesResp dockerAPIVolumesResponse
	if err := json.NewDecoder(resp.Body).Decode(&volumesResp); err != nil {
		return nil, fmt.Errorf("failed to decode volumes: %w", err)
	}

	return volumesResp.Volumes, nil
}

func VolumesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	client := newContainersClient()

	// Get volumes
	volumes, err := client.listVolumes()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to list volumes: %v", err), http.StatusInternalServerError)
		return
	}

	// Get containers to determine which volumes are in use
	containers, _ := client.listContainers()
	volumeUsage := buildVolumeUsageMap(client, containers)

	response := VolumesResponse{
		Volumes:    make([]VolumeDetail, 0, len(volumes)),
		TotalCount: len(volumes),
		TotalSize:  0,
	}

	for _, volume := range volumes {
		detail := buildVolumeDetail(volume, volumeUsage)
		response.Volumes = append(response.Volumes, detail)
		response.TotalSize += detail.SizeBytes
	}

	// Sort volumes alphabetically by name
	sort.Slice(response.Volumes, func(i, j int) bool {
		return response.Volumes[i].Name < response.Volumes[j].Name
	})

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

func buildVolumeUsageMap(client *containersClient, containers []dockerAPIContainer) map[string][]string {
	usage := make(map[string][]string)

	for _, container := range containers {
		// Skip non-running containers for mount detection
		if container.State != "running" {
			continue
		}

		name := ""
		if len(container.Names) > 0 {
			name = container.Names[0]
			if len(name) > 0 && name[0] == '/' {
				name = name[1:]
			}
		}

		// Inspect container to get actual mounts
		inspect, err := client.inspectContainer(container.ID)
		if err != nil {
			continue
		}

		// Extract volume names from mounts
		for _, mount := range inspect.Mounts {
			if mount.Type == "volume" && mount.Name != "" {
				// Add container to volume's usage list
				if !containsString(usage[mount.Name], name) {
					usage[mount.Name] = append(usage[mount.Name], name)
				}
			}
		}
	}

	return usage
}

// containsString checks if a string slice contains a specific string
func containsString(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}

func buildVolumeDetail(volume dockerAPIVolume, usageMap map[string][]string) VolumeDetail {
	detail := VolumeDetail{
		Name:       volume.Name,
		Driver:     volume.Driver,
		MountPoint: volume.Mountpoint,
		CreatedAt:  volume.CreatedAt,
		Labels:     volume.Labels,
		SizeBytes:  0,
		InUse:      false,
		UsedBy:     []string{},
	}

	// Get size if available
	if volume.UsageData != nil {
		detail.SizeBytes = volume.UsageData.Size
		detail.InUse = volume.UsageData.RefCount > 0
	}

	// Check usage map
	if containers, ok := usageMap[volume.Name]; ok && len(containers) > 0 {
		detail.UsedBy = containers
		detail.InUse = true
	}

	return detail
}

// FormatVolumeSize formats bytes into human-readable size
func FormatVolumeSize(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
		TB = GB * 1024
	)

	switch {
	case bytes >= TB:
		return fmt.Sprintf("%.2f TB", float64(bytes)/float64(TB))
	case bytes >= GB:
		return fmt.Sprintf("%.2f GB", float64(bytes)/float64(GB))
	case bytes >= MB:
		return fmt.Sprintf("%.2f MB", float64(bytes)/float64(MB))
	case bytes >= KB:
		return fmt.Sprintf("%.2f KB", float64(bytes)/float64(KB))
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}
