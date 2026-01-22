package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"syscall"
	"time"
)

type AlertSeverity string

const (
	AlertSeverityInfo     AlertSeverity = "info"
	AlertSeverityWarning  AlertSeverity = "warning"
	AlertSeverityCritical AlertSeverity = "critical"
)

type AlertType string

const (
	AlertTypeContainerUnhealthy AlertType = "container_unhealthy"
	AlertTypeContainerStopped   AlertType = "container_stopped"
	AlertTypeHighMemory         AlertType = "high_memory"
	AlertTypeHighCPU            AlertType = "high_cpu"
	AlertTypeHighDisk           AlertType = "high_disk"
	AlertTypeVolumeOrphan       AlertType = "volume_orphan"
)

type Alert struct {
	ID          string        `json:"id"`
	Type        AlertType     `json:"type"`
	Severity    AlertSeverity `json:"severity"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Resource    string        `json:"resource"`
	Timestamp   int64         `json:"timestamp"`
	Details     interface{}   `json:"details,omitempty"`
}

type AlertsResponse struct {
	Alerts   []Alert `json:"alerts"`
	Summary  AlertSummary `json:"summary"`
}

type AlertSummary struct {
	Total    int `json:"total"`
	Critical int `json:"critical"`
	Warning  int `json:"warning"`
	Info     int `json:"info"`
}

// Alert thresholds
const (
	MemoryWarningThreshold  = 80.0  // percent
	MemoryCriticalThreshold = 90.0  // percent
	CPUWarningThreshold     = 80.0  // percent
	CPUCriticalThreshold    = 95.0  // percent
	DiskWarningThreshold    = 80.0  // percent
	DiskCriticalThreshold   = 90.0  // percent
)

func AlertsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	client := newContainersClient()
	alerts := make([]Alert, 0)
	now := time.Now().Unix()

	// Check container health alerts
	containers, err := client.listContainers()
	if err == nil {
		for _, container := range containers {
			name := ""
			if len(container.Names) > 0 {
				name = container.Names[0]
				if len(name) > 0 && name[0] == '/' {
					name = name[1:]
				}
			}

			// Check for stopped containers
			if container.State == "exited" || container.State == "dead" {
				alerts = append(alerts, Alert{
					ID:          "container-stopped-" + truncateID(container.ID),
					Type:        AlertTypeContainerStopped,
					Severity:    AlertSeverityWarning,
					Title:       "Container Stopped",
					Description: "Container " + name + " is not running",
					Resource:    name,
					Timestamp:   now,
					Details: map[string]interface{}{
						"container_id": truncateID(container.ID),
						"state":        container.State,
						"status":       container.Status,
					},
				})
			}

			// Check for unhealthy containers
			inspect, err := client.inspectContainer(container.ID)
			if err == nil && inspect.State.Health != nil {
				if inspect.State.Health.Status == "unhealthy" {
					alerts = append(alerts, Alert{
						ID:          "container-unhealthy-" + truncateID(container.ID),
						Type:        AlertTypeContainerUnhealthy,
						Severity:    AlertSeverityCritical,
						Title:       "Container Unhealthy",
						Description: "Container " + name + " health check is failing",
						Resource:    name,
						Timestamp:   now,
						Details: map[string]interface{}{
							"container_id": truncateID(container.ID),
							"health":       inspect.State.Health.Status,
						},
					})
				}
			}

			// Check resource usage for running containers
			if container.State == "running" {
				stats, err := client.getContainerStats(container.ID)
				if err == nil {
					cpuPercent := calculateCPUPercent(stats)
					memoryMB := stats.MemoryStats.Usage / (1024 * 1024)
					memoryLimitMB := stats.MemoryStats.Limit / (1024 * 1024)
					memoryPercent := 0.0
					if memoryLimitMB > 0 {
						memoryPercent = float64(memoryMB) / float64(memoryLimitMB) * 100
					}

					// High CPU alert
					if cpuPercent >= CPUCriticalThreshold {
						alerts = append(alerts, Alert{
							ID:          "high-cpu-" + truncateID(container.ID),
							Type:        AlertTypeHighCPU,
							Severity:    AlertSeverityCritical,
							Title:       "Critical CPU Usage",
							Description: name + " is using high CPU",
							Resource:    name,
							Timestamp:   now,
							Details: map[string]interface{}{
								"cpu_percent": cpuPercent,
								"threshold":   CPUCriticalThreshold,
							},
						})
					} else if cpuPercent >= CPUWarningThreshold {
						alerts = append(alerts, Alert{
							ID:          "high-cpu-" + truncateID(container.ID),
							Type:        AlertTypeHighCPU,
							Severity:    AlertSeverityWarning,
							Title:       "High CPU Usage",
							Description: name + " is using elevated CPU",
							Resource:    name,
							Timestamp:   now,
							Details: map[string]interface{}{
								"cpu_percent": cpuPercent,
								"threshold":   CPUWarningThreshold,
							},
						})
					}

					// High memory alert
					if memoryPercent >= MemoryCriticalThreshold {
						alerts = append(alerts, Alert{
							ID:          "high-memory-" + truncateID(container.ID),
							Type:        AlertTypeHighMemory,
							Severity:    AlertSeverityCritical,
							Title:       "Critical Memory Usage",
							Description: name + " is using high memory",
							Resource:    name,
							Timestamp:   now,
							Details: map[string]interface{}{
								"memory_percent": memoryPercent,
								"memory_mb":      memoryMB,
								"memory_limit":   memoryLimitMB,
								"threshold":      MemoryCriticalThreshold,
							},
						})
					} else if memoryPercent >= MemoryWarningThreshold {
						alerts = append(alerts, Alert{
							ID:          "high-memory-" + truncateID(container.ID),
							Type:        AlertTypeHighMemory,
							Severity:    AlertSeverityWarning,
							Title:       "High Memory Usage",
							Description: name + " is using elevated memory",
							Resource:    name,
							Timestamp:   now,
							Details: map[string]interface{}{
								"memory_percent": memoryPercent,
								"memory_mb":      memoryMB,
								"memory_limit":   memoryLimitMB,
								"threshold":      MemoryWarningThreshold,
							},
						})
					}
				}
			}
		}
	}

	// Check disk usage alerts
	diskAlerts := checkDiskUsage(now)
	alerts = append(alerts, diskAlerts...)

	// Build summary
	summary := AlertSummary{Total: len(alerts)}
	for _, alert := range alerts {
		switch alert.Severity {
		case AlertSeverityCritical:
			summary.Critical++
		case AlertSeverityWarning:
			summary.Warning++
		case AlertSeverityInfo:
			summary.Info++
		}
	}

	response := AlertsResponse{
		Alerts:  alerts,
		Summary: summary,
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// checkDiskUsage checks disk space on key mount points and returns alerts
func checkDiskUsage(now int64) []Alert {
	alerts := make([]Alert, 0)

	// Check common mount points
	mountPoints := []string{"/", "/var/lib/docker"}
	if runtime.GOOS == "darwin" {
		mountPoints = []string{"/"}
	}

	for _, mountPoint := range mountPoints {
		usedPercent, totalGB, usedGB, err := getDiskUsage(mountPoint)
		if err != nil {
			continue
		}

		if usedPercent >= DiskCriticalThreshold {
			alerts = append(alerts, Alert{
				ID:          "high-disk-" + sanitizePath(mountPoint),
				Type:        AlertTypeHighDisk,
				Severity:    AlertSeverityCritical,
				Title:       "Critical Disk Usage",
				Description: mountPoint + " is at " + formatPercent(usedPercent) + "% capacity",
				Resource:    mountPoint,
				Timestamp:   now,
				Details: map[string]interface{}{
					"mount_point":  mountPoint,
					"used_percent": usedPercent,
					"used_gb":      usedGB,
					"total_gb":     totalGB,
					"threshold":    DiskCriticalThreshold,
				},
			})
		} else if usedPercent >= DiskWarningThreshold {
			alerts = append(alerts, Alert{
				ID:          "high-disk-" + sanitizePath(mountPoint),
				Type:        AlertTypeHighDisk,
				Severity:    AlertSeverityWarning,
				Title:       "High Disk Usage",
				Description: mountPoint + " is at " + formatPercent(usedPercent) + "% capacity",
				Resource:    mountPoint,
				Timestamp:   now,
				Details: map[string]interface{}{
					"mount_point":  mountPoint,
					"used_percent": usedPercent,
					"used_gb":      usedGB,
					"total_gb":     totalGB,
					"threshold":    DiskWarningThreshold,
				},
			})
		}
	}

	return alerts
}

// getDiskUsage returns disk usage percentage and sizes for a mount point
func getDiskUsage(path string) (usedPercent float64, totalGB float64, usedGB float64, err error) {
	// Check if path exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return 0, 0, 0, err
	}

	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, 0, err
	}

	// Calculate sizes
	totalBytes := stat.Blocks * uint64(stat.Bsize)
	freeBytes := stat.Bfree * uint64(stat.Bsize)
	usedBytes := totalBytes - freeBytes

	totalGB = float64(totalBytes) / (1024 * 1024 * 1024)
	usedGB = float64(usedBytes) / (1024 * 1024 * 1024)

	if totalBytes > 0 {
		usedPercent = (float64(usedBytes) / float64(totalBytes)) * 100
	}

	return usedPercent, totalGB, usedGB, nil
}

// sanitizePath converts a path to a safe ID component
func sanitizePath(path string) string {
	result := ""
	for _, c := range path {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			result += string(c)
		} else if c == '/' && result != "" && result[len(result)-1] != '-' {
			result += "-"
		}
	}
	if result == "" || result == "-" {
		return "root"
	}
	return result
}

// formatPercent formats a percentage to a string with 1 decimal place
func formatPercent(p float64) string {
	whole := int(p)
	frac := int((p - float64(whole)) * 10)
	return intToStr(whole) + "." + intToStr(frac)
}

// intToStr converts an int to string without strconv
func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	if n < 0 {
		return "-" + intToStr(-n)
	}
	result := ""
	for n > 0 {
		result = string(rune('0'+n%10)) + result
		n /= 10
	}
	return result
}
