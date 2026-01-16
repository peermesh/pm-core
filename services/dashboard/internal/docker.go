// Package internal provides internal utilities for the dashboard service
package internal

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// DockerClient wraps communication with the Docker API via socket-proxy
type DockerClient struct {
	baseURL    string
	httpClient *http.Client
}

// DockerInfo represents basic Docker daemon information
type DockerInfo struct {
	ServerVersion string `json:"ServerVersion"`
	Containers    int    `json:"Containers"`
	Images        int    `json:"Images"`
	Driver        string `json:"Driver"`
	MemoryLimit   bool   `json:"MemoryLimit"`
	SwapLimit     bool   `json:"SwapLimit"`
	CPUSet        bool   `json:"CpuCfsQuota"`
}

// NewDockerClient creates a new Docker client
// In production, this connects via the socket-proxy service
// The socket-proxy provides read-only access to the Docker API
//
// Connection options:
// - Via socket-proxy: http://socket-proxy:2375 (recommended for security)
// - Via Unix socket: /var/run/docker.sock (requires mounting, less secure)
func NewDockerClient(socketProxyURL string) *DockerClient {
	if socketProxyURL == "" {
		// Default to socket-proxy service name in Docker network
		socketProxyURL = "http://socket-proxy:2375"
	}

	return &DockerClient{
		baseURL: socketProxyURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				DialContext: (&net.Dialer{
					Timeout:   5 * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				MaxIdleConns:        10,
				IdleConnTimeout:     90 * time.Second,
				DisableCompression:  true,
			},
		},
	}
}

// GetInfo retrieves Docker daemon information
// This is equivalent to `docker info`
func (c *DockerClient) GetInfo() (*DockerInfo, error) {
	resp, err := c.httpClient.Get(c.baseURL + "/info")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Docker API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Docker API error: %s (status %d)", string(body), resp.StatusCode)
	}

	var info DockerInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to decode Docker info: %w", err)
	}

	return &info, nil
}

// GetVersion retrieves the Docker version
// Returns the server version string or an error
func (c *DockerClient) GetVersion() (string, error) {
	info, err := c.GetInfo()
	if err != nil {
		return "", err
	}
	return info.ServerVersion, nil
}

// Ping checks if the Docker API is accessible
// Returns nil if the connection is successful
func (c *DockerClient) Ping() error {
	resp, err := c.httpClient.Get(c.baseURL + "/_ping")
	if err != nil {
		return fmt.Errorf("failed to ping Docker API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Docker API ping failed with status: %d", resp.StatusCode)
	}

	return nil
}

// Note: Additional methods will be added in Phase 2:
// - ListContainers() - Get all containers with status and resource usage
// - ListVolumes() - Get all volumes with sizes
// - GetContainerStats() - Get real-time container metrics
//
// Security: All operations are READ-ONLY. The socket-proxy is configured
// to block write operations (container start/stop/delete, image pull, etc.)
