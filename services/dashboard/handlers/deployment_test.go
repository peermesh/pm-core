package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// --- normalizeEnvironment tests ---

func TestNormalizeEnvironment(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"prod", "production"},
		{"production", "production"},
		{"PRODUCTION", "production"},
		{"Production", "production"},
		{"stage", "staging"},
		{"staging", "staging"},
		{"dev", "development"},
		{"development", "development"},
		{"test", "testing"},
		{"testing", "testing"},
		{"local", "local"},
		{"localhost", "local"},
		{"custom", "custom"},
		{"  prod  ", "production"}, // whitespace trimmed
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := normalizeEnvironment(tt.input); got != tt.want {
				t.Errorf("normalizeEnvironment(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// --- parseUnixTimestamp tests ---

func TestParseUnixTimestamp(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"valid timestamp", "1700000000", false},
		{"timestamp with trailing", "1700000000abc", false},
		{"zero", "0", true},
		{"empty", "", true},
		{"non-numeric", "abc", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := parseUnixTimestamp(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseUnixTimestamp(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if err == nil && result.Unix() <= 0 {
				t.Errorf("parseUnixTimestamp(%q) returned zero time", tt.input)
			}
		})
	}
}

// --- formatRelativeTime tests ---

func TestFormatRelativeTime(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name string
		t    time.Time
		want string
	}{
		{"just now", now.Add(-3 * time.Second), "just now"},
		{"seconds ago", now.Add(-30 * time.Second), "30 seconds ago"},
		{"1 minute ago", now.Add(-1 * time.Minute), "1 minute ago"},
		{"minutes ago", now.Add(-5 * time.Minute), "5 minutes ago"},
		{"1 hour ago", now.Add(-1 * time.Hour), "1 hour ago"},
		{"hours ago", now.Add(-3 * time.Hour), "3 hours ago"},
		{"1 day ago", now.Add(-24 * time.Hour), "1 day ago"},
		{"days ago", now.Add(-3 * 24 * time.Hour), "3 days ago"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatRelativeTime(tt.t); got != tt.want {
				t.Errorf("formatRelativeTime() = %q, want %q", got, tt.want)
			}
		})
	}
}

// --- formatInt tests ---

func TestFormatInt(t *testing.T) {
	tests := []struct {
		input int
		want  string
	}{
		{0, "0"},
		{1, "1"},
		{42, "42"},
		{100, "100"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := formatInt(tt.input); got != tt.want {
				t.Errorf("formatInt(%d) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// --- DeploymentHandler tests ---

func TestDeploymentHandler_MethodNotAllowed(t *testing.T) {
	methods := []string{http.MethodPut, http.MethodDelete, http.MethodPatch}
	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/api/deployment", nil)
			rec := httptest.NewRecorder()

			DeploymentHandler(rec, req)

			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
			}
		})
	}
}

func TestDeploymentHandler_GET_ReturnsJSON(t *testing.T) {
	// Invalidate cache to force fresh build
	deploymentCacheMu.Lock()
	deploymentCache = nil
	deploymentCacheMu.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/api/deployment", nil)
	rec := httptest.NewRecorder()

	DeploymentHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var info DeploymentInfo
	if err := json.NewDecoder(rec.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should have some environment value
	if info.Environment == "" {
		t.Error("Environment should not be empty")
	}
	// Should have a version
	if info.Version == "" {
		t.Error("Version should not be empty")
	}
}

func TestDeploymentHandler_POST_RequiresAuth(t *testing.T) {
	defer clearSessions()

	req := httptest.NewRequest(http.MethodPost, "/api/deployment", nil)
	rec := httptest.NewRecorder()

	DeploymentHandler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d (unauthenticated sync attempt)", rec.Code, http.StatusUnauthorized)
	}
}

func TestDeploymentHandler_POST_GuestForbidden(t *testing.T) {
	defer clearSessions()

	sessionID := createTestSession("guest", true, 24*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/api/deployment", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionID})
	rec := httptest.NewRecorder()

	DeploymentHandler(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d (guest sync attempt)", rec.Code, http.StatusForbidden)
	}
}

// --- detectEnvironment tests ---

func TestDetectEnvironment_FromEnvVars(t *testing.T) {
	tests := []struct {
		name    string
		envKey  string
		envVal  string
		want    string
	}{
		{"ENVIRONMENT=prod", "ENVIRONMENT", "prod", "production"},
		{"ENV=staging", "ENV", "staging", "staging"},
		{"APP_ENV=dev", "APP_ENV", "dev", "development"},
		{"NODE_ENV=test", "NODE_ENV", "test", "testing"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(tt.envKey, tt.envVal)
			// Clear other env vars to avoid interference
			if tt.envKey != "ENVIRONMENT" {
				t.Setenv("ENVIRONMENT", "")
			}
			if tt.envKey != "ENV" {
				t.Setenv("ENV", "")
			}
			if tt.envKey != "APP_ENV" {
				t.Setenv("APP_ENV", "")
			}
			if tt.envKey != "NODE_ENV" {
				t.Setenv("NODE_ENV", "")
			}

			got := detectEnvironment()
			if got != tt.want {
				t.Errorf("detectEnvironment() = %q, want %q", got, tt.want)
			}
		})
	}
}

// --- getVersion tests ---

func TestGetVersion_Default(t *testing.T) {
	t.Setenv("APP_VERSION", "")
	t.Setenv("VERSION", "")

	got := getVersion()
	if got != "0.1.0-mvp" {
		t.Errorf("getVersion() = %q, want %q", got, "0.1.0-mvp")
	}
}

func TestGetVersion_FromEnv(t *testing.T) {
	t.Setenv("APP_VERSION", "2.0.0")

	got := getVersion()
	if got != "2.0.0" {
		t.Errorf("getVersion() = %q, want %q", got, "2.0.0")
	}
}
