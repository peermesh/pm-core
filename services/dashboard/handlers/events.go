package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"
)

const (
	containerPollInterval = 10 * time.Second
	keepaliveInterval     = 30 * time.Second
)

// SSE events reuse ContainerDetail from containers.go for consistency
type ContainersSSEEvent struct {
	Containers     []ContainerDetail      `json:"containers"`
	CapacityGroups []CapacityGroupSummary `json:"capacity_groups"`
	Timestamp      int64                `json:"timestamp"`
}

type SystemStats struct {
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryPercent float64 `json:"memory_percent"`
	MemoryUsedMB  uint64  `json:"memory_used_mb"`
	MemoryTotalMB uint64  `json:"memory_total_mb"`
}

type SystemEvent struct {
	Stats     SystemStats `json:"stats"`
	Timestamp int64       `json:"timestamp"`
}

// fetchContainersForSSE reuses the containers client to get detailed container info
func fetchContainersForSSE() ([]ContainerDetail, error) {
	client := newContainersClient()

	containers, err := client.listContainers()
	if err != nil {
		return nil, err
	}

	details := make([]ContainerDetail, 0, len(containers))
	for _, container := range containers {
		info := buildContainerDetail(client, container)
		details = append(details, info)
	}

	return details, nil
}

// fetchSystemStatsForSSE gets basic system stats
func fetchSystemStatsForSSE() (*SystemStats, error) {
	client := newContainersClient()

	resp, err := client.httpClient.Get(client.baseURL + "/info")
	if err != nil {
		return nil, fmt.Errorf("failed to get system info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("docker API error (status %d)", resp.StatusCode)
	}

	var info struct {
		NCPU     int   `json:"NCPU"`
		MemTotal int64 `json:"MemTotal"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to decode info: %w", err)
	}

	memTotalMB := uint64(info.MemTotal) / (1024 * 1024)

	return &SystemStats{
		CPUPercent:    0, // Would need aggregation from container stats
		MemoryPercent: 0,
		MemoryUsedMB:  0,
		MemoryTotalMB: memTotalMB,
	}, nil
}

func EventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	// Clear write deadline for SSE to prevent timeout on long-lived connections
	rc := http.NewResponseController(w)
	if err := rc.SetWriteDeadline(time.Time{}); err != nil {
		http.Error(w, "Failed to configure SSE", http.StatusInternalServerError)
		return
	}

	ctx := r.Context()

	pollTicker := time.NewTicker(containerPollInterval)
	defer pollTicker.Stop()

	keepaliveTicker := time.NewTicker(keepaliveInterval)
	defer keepaliveTicker.Stop()

	sendContainersEvent := func() {
		containers, err := fetchContainersForSSE()
		if err != nil {
			writeSSEEvent(w, "error", map[string]string{"message": err.Error()})
			flusher.Flush()
			return
		}

		sort.Slice(containers, func(i, j int) bool {
			return containers[i].Name < containers[j].Name
		})

		event := ContainersSSEEvent{
			Containers:     containers,
			CapacityGroups: aggregateCapacityGroups(containers),
			Timestamp:      time.Now().Unix(),
		}
		writeSSEEvent(w, "containers", event)
		flusher.Flush()
	}

	sendSystemEvent := func() {
		stats, err := fetchSystemStatsForSSE()
		if err != nil {
			writeSSEEvent(w, "error", map[string]string{"message": err.Error()})
			flusher.Flush()
			return
		}

		event := SystemEvent{
			Stats:     *stats,
			Timestamp: time.Now().Unix(),
		}
		writeSSEEvent(w, "system", event)
		flusher.Flush()
	}

	sendContainersEvent()
	sendSystemEvent()

	for {
		select {
		case <-ctx.Done():
			return
		case <-pollTicker.C:
			sendContainersEvent()
			sendSystemEvent()
		case <-keepaliveTicker.C:
			writeSSEComment(w, "keepalive")
			flusher.Flush()
		}
	}
}

func writeSSEEvent(w http.ResponseWriter, eventType string, data interface{}) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		fmt.Fprintf(w, "event: error\ndata: {\"message\":\"failed to marshal data\"}\n\n")
		return
	}

	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, string(jsonData))
}

func writeSSEComment(w http.ResponseWriter, comment string) {
	fmt.Fprintf(w, ": %s\n\n", comment)
}
