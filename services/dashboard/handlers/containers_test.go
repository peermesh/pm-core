package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// --- truncateID tests ---

func TestTruncateID(t *testing.T) {
	tests := []struct {
		name string
		id   string
		want string
	}{
		{"full 64-char sha", "abc123def456abc123def456abc123def456abc123def456abc123def456abcd", "abc123def456"},
		{"already 12 chars", "abc123def456", "abc123def456"},
		{"short id", "abc", "abc"},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := truncateID(tt.id); got != tt.want {
				t.Errorf("truncateID(%q) = %q, want %q", tt.id, got, tt.want)
			}
		})
	}
}

// --- detectProfile tests ---

func TestDetectProfile(t *testing.T) {
	tests := []struct {
		name   string
		labels map[string]string
		want   string
	}{
		{
			"compose service label",
			map[string]string{"com.docker.compose.service": "traefik"},
			"traefik",
		},
		{
			"compose project label (no service)",
			map[string]string{"com.docker.compose.project": "myproject"},
			"myproject",
		},
		{
			"pmdl.profile label",
			map[string]string{"pmdl.profile": "monitoring"},
			"monitoring",
		},
		{
			"service takes priority over project",
			map[string]string{
				"com.docker.compose.service": "nginx",
				"com.docker.compose.project": "myproject",
			},
			"nginx",
		},
		{
			"no labels",
			map[string]string{},
			"unknown",
		},
		{
			"nil labels",
			nil,
			"unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := detectProfile(tt.labels); got != tt.want {
				t.Errorf("detectProfile() = %q, want %q", got, tt.want)
			}
		})
	}
}

// --- calculateCPUPercent tests ---

func TestCalculateCPUPercent(t *testing.T) {
	tests := []struct {
		name     string
		stats    *dockerAPIStats
		wantZero bool
	}{
		{
			"valid stats",
			&dockerAPIStats{
				CPUStats: struct {
					CPUUsage struct {
						TotalUsage uint64 `json:"total_usage"`
					} `json:"cpu_usage"`
					SystemCPUUsage uint64 `json:"system_cpu_usage"`
					OnlineCPUs     int    `json:"online_cpus"`
				}{
					CPUUsage: struct {
						TotalUsage uint64 `json:"total_usage"`
					}{TotalUsage: 2000000},
					SystemCPUUsage: 20000000,
					OnlineCPUs:     4,
				},
				PreCPUStats: struct {
					CPUUsage struct {
						TotalUsage uint64 `json:"total_usage"`
					} `json:"cpu_usage"`
					SystemCPUUsage uint64 `json:"system_cpu_usage"`
				}{
					CPUUsage: struct {
						TotalUsage uint64 `json:"total_usage"`
					}{TotalUsage: 1000000},
					SystemCPUUsage: 10000000,
				},
			},
			false,
		},
		{
			"zero deltas",
			&dockerAPIStats{},
			true,
		},
		{
			"zero online cpus defaults to 1",
			&dockerAPIStats{
				CPUStats: struct {
					CPUUsage struct {
						TotalUsage uint64 `json:"total_usage"`
					} `json:"cpu_usage"`
					SystemCPUUsage uint64 `json:"system_cpu_usage"`
					OnlineCPUs     int    `json:"online_cpus"`
				}{
					CPUUsage: struct {
						TotalUsage uint64 `json:"total_usage"`
					}{TotalUsage: 2000000},
					SystemCPUUsage: 20000000,
					OnlineCPUs:     0,
				},
				PreCPUStats: struct {
					CPUUsage struct {
						TotalUsage uint64 `json:"total_usage"`
					} `json:"cpu_usage"`
					SystemCPUUsage uint64 `json:"system_cpu_usage"`
				}{
					CPUUsage: struct {
						TotalUsage uint64 `json:"total_usage"`
					}{TotalUsage: 1000000},
					SystemCPUUsage: 10000000,
				},
			},
			false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := calculateCPUPercent(tt.stats)
			if tt.wantZero && got != 0 {
				t.Errorf("calculateCPUPercent() = %f, want 0", got)
			}
			if !tt.wantZero && got <= 0 {
				t.Errorf("calculateCPUPercent() = %f, want > 0", got)
			}
		})
	}
}

// --- formatContainerUptime tests ---

func TestFormatContainerUptime(t *testing.T) {
	tests := []struct {
		name     string
		duration time.Duration
		want     string
	}{
		{"seconds only", 30 * time.Second, "30s"},
		{"minutes", 5 * time.Minute, "5m"},
		{"hours and minutes", 3*time.Hour + 15*time.Minute, "3h 15m"},
		{"days and hours", 2*24*time.Hour + 5*time.Hour, "2d 5h"},
		{"zero", 0, "0s"},
		{"negative", -5 * time.Second, "0s"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatContainerUptime(tt.duration); got != tt.want {
				t.Errorf("formatContainerUptime(%v) = %q, want %q", tt.duration, got, tt.want)
			}
		})
	}
}

// --- isSensitiveEnvVar tests ---

func TestIsSensitiveEnvVar(t *testing.T) {
	tests := []struct {
		key  string
		want bool
	}{
		{"DATABASE_PASSWORD", true},
		{"SECRET_KEY", true},
		{"API_TOKEN", true},
		{"PRIVATE_KEY", true},
		{"AUTH_SECRET", true},
		{"CREDENTIAL_FILE", true},
		{"HOME", false},
		{"PATH", false},
		{"PORT", false},
		{"HOSTNAME", false},
		{"GO_ENV", false},
	}

	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			if got := isSensitiveEnvVar(tt.key); got != tt.want {
				t.Errorf("isSensitiveEnvVar(%q) = %v, want %v", tt.key, got, tt.want)
			}
		})
	}
}

// --- maskEnvVars tests ---

func TestMaskEnvVars(t *testing.T) {
	input := []string{
		"HOME=/root",
		"DATABASE_PASSWORD=supersecret",
		"PORT=8080",
		"API_TOKEN=abc123",
		"INVALID_NO_EQUALS",
	}

	result := maskEnvVars(input)

	// "INVALID_NO_EQUALS" should be skipped (no = sign)
	if len(result) != 4 {
		t.Fatalf("expected 4 env vars, got %d", len(result))
	}

	expected := map[string]string{
		"HOME":              "/root",
		"DATABASE_PASSWORD": "***",
		"PORT":              "8080",
		"API_TOKEN":         "***",
	}

	for _, v := range result {
		want, ok := expected[v.Key]
		if !ok {
			t.Errorf("unexpected env var key: %s", v.Key)
			continue
		}
		if v.Value != want {
			t.Errorf("env var %s = %q, want %q", v.Key, v.Value, want)
		}
	}
}

// --- ContainersHandler with mock Docker API ---

func TestContainersHandler_DockerAPIUnreachable(t *testing.T) {
	// Start a server that immediately closes connections
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	// Override DOCKER_HOST to point to our mock server
	t.Setenv("DOCKER_HOST", server.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	rec := httptest.NewRecorder()

	ContainersHandler(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestContainersHandler_EmptyContainerList(t *testing.T) {
	// Mock Docker API that returns empty container list
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
	}))
	defer server.Close()

	t.Setenv("DOCKER_HOST", server.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	rec := httptest.NewRecorder()

	ContainersHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var response ContainersResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(response.Containers) != 0 {
		t.Errorf("expected 0 containers, got %d", len(response.Containers))
	}
}

func TestContainersHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/containers", nil)
	rec := httptest.NewRecorder()

	ContainersHandler(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestContainersHandler_WithMockContainers(t *testing.T) {
	// Mock Docker API that returns containers + inspect + stats
	mux := http.NewServeMux()

	// List containers
	mux.HandleFunc("/containers/json", func(w http.ResponseWriter, r *http.Request) {
		containers := []dockerAPIContainer{
			{
				ID:    "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
				Names: []string{"/test-container"},
				Image: "nginx:latest",
				State: "running",
				Labels: map[string]string{
					"com.docker.compose.service": "web",
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(containers)
	})

	// Inspect container
	mux.HandleFunc("/containers/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path[len(r.URL.Path)-5:] == "/json" {
			inspect := dockerAPIInspect{
				ID:   "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
				Name: "/test-container",
				State: struct {
					Status    string    `json:"Status"`
					StartedAt time.Time `json:"StartedAt"`
					Health    *struct {
						Status string `json:"Status"`
						Log    []struct {
							Start    time.Time `json:"Start"`
							End      time.Time `json:"End"`
							ExitCode int       `json:"ExitCode"`
							Output   string    `json:"Output"`
						} `json:"Log"`
					} `json:"Health"`
				}{
					Status:    "running",
					StartedAt: time.Now().Add(-1 * time.Hour),
				},
				Config: struct {
					Cmd        []string          `json:"Cmd"`
					Entrypoint []string          `json:"Entrypoint"`
					Env        []string          `json:"Env"`
					Image      string            `json:"Image"`
					Labels     map[string]string `json:"Labels"`
				}{
					Image:  "nginx:latest",
					Labels: map[string]string{"com.docker.compose.service": "web"},
				},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(inspect)
			return
		}

		// Stats endpoint
		stats := dockerAPIStats{}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats)
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	t.Setenv("DOCKER_HOST", server.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	rec := httptest.NewRecorder()

	ContainersHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var response ContainersResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(response.Containers) != 1 {
		t.Fatalf("expected 1 container, got %d", len(response.Containers))
	}

	c := response.Containers[0]
	if c.Name != "test-container" {
		t.Errorf("container name = %q, want %q", c.Name, "test-container")
	}
	if c.Image != "nginx:latest" {
		t.Errorf("container image = %q, want %q", c.Image, "nginx:latest")
	}
	if c.Profile != "web" {
		t.Errorf("container profile = %q, want %q", c.Profile, "web")
	}
	if c.ID != "abc123def456" {
		t.Errorf("container ID = %q, want truncated %q", c.ID, "abc123def456")
	}
}

// --- ContainerDetailHandler tests ---

func TestContainerDetailHandler_InvalidID(t *testing.T) {
	tests := []struct {
		name string
		path string
	}{
		{"empty ID", "/api/containers/"},
		{"invalid chars", "/api/containers/XXXX-invalid!"},
		{"uppercase hex", "/api/containers/ABCDEF123456"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()

			ContainerDetailHandler(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want %d for path %s", rec.Code, http.StatusBadRequest, tt.path)
			}
		})
	}
}

func TestContainerDetailHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/containers/abc123def456", nil)
	rec := httptest.NewRecorder()

	ContainerDetailHandler(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
