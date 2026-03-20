package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// --- formatUptime tests ---

func TestFormatUptime(t *testing.T) {
	tests := []struct {
		name     string
		duration time.Duration
		want     string
	}{
		{"zero", 0, "0m"},
		{"just minutes", 5 * time.Minute, "5m"},
		{"hours and minutes", 3*time.Hour + 15*time.Minute, "3h 15m"},
		{"days hours and minutes", 2*24*time.Hour + 5*time.Hour + 30*time.Minute, "2d 5h 30m"},
		{"one day", 24 * time.Hour, "1d"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatUptime(tt.duration)
			if got != tt.want {
				t.Errorf("formatUptime(%v) = %q, want %q", tt.duration, got, tt.want)
			}
		})
	}
}

// --- extractNumber tests ---

func TestExtractNumber(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"  12345 kB", "12345"},
		{"abc", ""},
		{"", ""},
		{"  0  ", "0"},
		{"42abc99", "42"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := extractNumber(tt.input); got != tt.want {
				t.Errorf("extractNumber(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// --- parseUint64 tests ---

func TestParseUint64(t *testing.T) {
	tests := []struct {
		input string
		want  uint64
	}{
		{"12345", 12345},
		{"  42  ", 42},
		{"0", 0},
		{"", 0},
		{"abc", 0},
		{"100\n", 100},
		{"999999999999", 999999999999},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := parseUint64(tt.input); got != tt.want {
				t.Errorf("parseUint64(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

// --- splitLines tests ---

func TestSplitLines(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  int
	}{
		{"empty", "", 0},
		{"single line", "hello", 1},
		{"two lines", "hello\nworld", 2},
		{"trailing newline", "hello\n", 1},
		{"three lines", "a\nb\nc", 3},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lines := splitLines(tt.input)
			if len(lines) != tt.want {
				t.Errorf("splitLines(%q) produced %d lines, want %d", tt.input, len(lines), tt.want)
			}
		})
	}
}

// --- intToString tests ---

func TestIntToString(t *testing.T) {
	tests := []struct {
		input int
		want  string
	}{
		{0, "0"},
		{1, "1"},
		{42, "42"},
		{100, "100"},
		{9999, "9999"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := intToString(tt.input); got != tt.want {
				t.Errorf("intToString(%d) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// --- SystemHandler tests ---

func TestSystemHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/system", nil)
	rec := httptest.NewRecorder()

	SystemHandler(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestSystemHandler_ReturnsJSON(t *testing.T) {
	// Set DOCKER_HOST to a non-existent address so getDockerVersion returns "unavailable"
	// This avoids hanging on the default socket-proxy:2375
	t.Setenv("DOCKER_HOST", "http://127.0.0.1:1")

	req := httptest.NewRequest(http.MethodGet, "/api/system", nil)
	rec := httptest.NewRecorder()

	SystemHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var info SystemInfo
	if err := json.NewDecoder(rec.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should have reasonable values
	if info.OS == "" {
		t.Error("OS should not be empty")
	}
	if info.Architecture == "" {
		t.Error("Architecture should not be empty")
	}
	if info.Resources.CPUCount <= 0 {
		t.Error("CPUCount should be > 0")
	}
}

func TestSystemHandler_DockerVersionWithMock(t *testing.T) {
	// Mock Docker API that returns version
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/version" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"Version": "24.0.7"})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	t.Setenv("DOCKER_HOST", server.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/system", nil)
	rec := httptest.NewRecorder()

	SystemHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var info SystemInfo
	if err := json.NewDecoder(rec.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if info.DockerVersion != "24.0.7" {
		t.Errorf("DockerVersion = %q, want %q", info.DockerVersion, "24.0.7")
	}
}
