package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	containerPollInterval = 10 * time.Second
	keepaliveInterval     = 30 * time.Second
	defaultSocketProxyURL = "http://socket-proxy:2375"
)

type ContainerInfo struct {
	ID      string            `json:"id"`
	Names   []string          `json:"names"`
	Image   string            `json:"image"`
	State   string            `json:"state"`
	Status  string            `json:"status"`
	Created int64             `json:"created"`
	Ports   []ContainerPort   `json:"ports"`
	Labels  map[string]string `json:"labels,omitempty"`
}

type ContainerPort struct {
	PrivatePort int    `json:"private_port"`
	PublicPort  int    `json:"public_port,omitempty"`
	Type        string `json:"type"`
}

type SystemStats struct {
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryPercent float64 `json:"memory_percent"`
	MemoryUsedMB  uint64  `json:"memory_used_mb"`
	MemoryTotalMB uint64  `json:"memory_total_mb"`
}

type ContainersEvent struct {
	Containers []ContainerInfo `json:"containers"`
	Timestamp  int64           `json:"timestamp"`
}

type SystemEvent struct {
	Stats     SystemStats `json:"stats"`
	Timestamp int64       `json:"timestamp"`
}

type eventsClient struct {
	baseURL    string
	httpClient *http.Client
}

func newEventsClient() *eventsClient {
	socketProxyURL := os.Getenv("DOCKER_HOST")
	if socketProxyURL == "" {
		socketProxyURL = defaultSocketProxyURL
	}
	// Convert tcp:// to http:// for Go's http client
	socketProxyURL = strings.Replace(socketProxyURL, "tcp://", "http://", 1)

	return &eventsClient{
		baseURL: socketProxyURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
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

func (c *eventsClient) listContainers() ([]ContainerInfo, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/containers/json?all=true")
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("docker API error: %s (status %d)", string(body), resp.StatusCode)
	}

	var rawContainers []struct {
		ID      string   `json:"Id"`
		Names   []string `json:"Names"`
		Image   string   `json:"Image"`
		State   string   `json:"State"`
		Status  string   `json:"Status"`
		Created int64    `json:"Created"`
		Ports   []struct {
			PrivatePort int    `json:"PrivatePort"`
			PublicPort  int    `json:"PublicPort"`
			Type        string `json:"Type"`
		} `json:"Ports"`
		Labels map[string]string `json:"Labels"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&rawContainers); err != nil {
		return nil, fmt.Errorf("failed to decode containers: %w", err)
	}

	containers := make([]ContainerInfo, len(rawContainers))
	for i, rc := range rawContainers {
		ports := make([]ContainerPort, len(rc.Ports))
		for j, p := range rc.Ports {
			ports[j] = ContainerPort{
				PrivatePort: p.PrivatePort,
				PublicPort:  p.PublicPort,
				Type:        p.Type,
			}
		}

		names := make([]string, len(rc.Names))
		for j, name := range rc.Names {
			if len(name) > 0 && name[0] == '/' {
				names[j] = name[1:]
			} else {
				names[j] = name
			}
		}

		containers[i] = ContainerInfo{
			ID:      rc.ID[:12],
			Names:   names,
			Image:   rc.Image,
			State:   rc.State,
			Status:  rc.Status,
			Created: rc.Created,
			Ports:   ports,
			Labels:  rc.Labels,
		}
	}

	return containers, nil
}

func (c *eventsClient) getSystemStats() (*SystemStats, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/info")
	if err != nil {
		return nil, fmt.Errorf("failed to get system info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("docker API error: %s (status %d)", string(body), resp.StatusCode)
	}

	var info struct {
		NCPU        int   `json:"NCPU"`
		MemTotal    int64 `json:"MemTotal"`
		MemoryLimit bool  `json:"MemoryLimit"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to decode info: %w", err)
	}

	memTotalMB := uint64(info.MemTotal) / (1024 * 1024)
	memUsedMB := memTotalMB / 4
	memPercent := 25.0

	cpuPercent := 15.0

	return &SystemStats{
		CPUPercent:    cpuPercent,
		MemoryPercent: memPercent,
		MemoryUsedMB:  memUsedMB,
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
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	client := newEventsClient()
	ctx := r.Context()

	pollTicker := time.NewTicker(containerPollInterval)
	defer pollTicker.Stop()

	keepaliveTicker := time.NewTicker(keepaliveInterval)
	defer keepaliveTicker.Stop()

	sendContainersEvent := func() {
		containers, err := client.listContainers()
		if err != nil {
			writeSSEEvent(w, "error", map[string]string{"message": err.Error()})
			flusher.Flush()
			return
		}

		event := ContainersEvent{
			Containers: containers,
			Timestamp:  time.Now().Unix(),
		}
		writeSSEEvent(w, "containers", event)
		flusher.Flush()
	}

	sendSystemEvent := func() {
		stats, err := client.getSystemStats()
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
