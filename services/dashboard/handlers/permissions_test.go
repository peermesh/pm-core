package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// --- isSafeEndpoint tests ---

func TestIsSafeEndpoint(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   bool
	}{
		// Safe endpoints (GET)
		{"GET containers", http.MethodGet, "/api/containers", true},
		{"GET containers subpath", http.MethodGet, "/api/containers/abc123", true},
		{"GET events", http.MethodGet, "/api/events", true},
		{"GET system", http.MethodGet, "/api/system", true},
		{"GET session", http.MethodGet, "/api/session", true},
		{"GET deployment", http.MethodGet, "/api/deployment", true},
		{"GET volumes", http.MethodGet, "/api/volumes", true},
		{"GET alerts", http.MethodGet, "/api/alerts", true},
		{"GET instances", http.MethodGet, "/api/instances", true},
		{"GET instances subpath", http.MethodGet, "/api/instances/abc123", true},
		{"GET containers with query", http.MethodGet, "/api/containers?all=true", true},

		// Unsafe (non-GET methods)
		{"POST containers", http.MethodPost, "/api/containers", false},
		{"DELETE instances", http.MethodDelete, "/api/instances/abc123", false},
		{"POST deployment (sync)", http.MethodPost, "/api/deployment", false},
		{"PUT containers", http.MethodPut, "/api/containers", false},

		// Unsafe (unknown paths)
		{"GET unknown path", http.MethodGet, "/api/settings", false},
		{"GET config", http.MethodGet, "/api/config", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isSafeEndpoint(tt.method, tt.path); got != tt.want {
				t.Errorf("isSafeEndpoint(%q, %q) = %v, want %v", tt.method, tt.path, got, tt.want)
			}
		})
	}
}

// --- PermissionMiddleware tests ---

func TestPermissionMiddleware_NonAPIEndpoint(t *testing.T) {
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := PermissionMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should be called for non-API endpoints")
	}
}

func TestPermissionMiddleware_NoSession(t *testing.T) {
	defer clearSessions()

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := PermissionMiddleware(inner)

	req := httptest.NewRequest(http.MethodPost, "/api/deployment", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should be called when no session (no guest restrictions)")
	}
}

func TestPermissionMiddleware_AdminSessionAllowsWrite(t *testing.T) {
	defer clearSessions()

	sessionID := createTestSession("admin", false, 24*time.Hour)

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := PermissionMiddleware(inner)

	req := httptest.NewRequest(http.MethodPost, "/api/deployment", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionID})
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should be called for admin sessions on write operations")
	}
}

func TestPermissionMiddleware_GuestBlockedFromWrite(t *testing.T) {
	defer clearSessions()

	sessionID := createTestSession("guest", true, 24*time.Hour)

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := PermissionMiddleware(inner)

	req := httptest.NewRequest(http.MethodPost, "/api/deployment", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionID})
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if called {
		t.Error("inner handler should NOT be called for guest write operations")
	}
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestPermissionMiddleware_GuestAllowedToRead(t *testing.T) {
	defer clearSessions()

	sessionID := createTestSession("guest", true, 24*time.Hour)

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := PermissionMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionID})
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should be called for guest read operations")
	}
}

// --- IsGuestUser tests ---

func TestIsGuestUser(t *testing.T) {
	defer clearSessions()

	guestID := createTestSession("guest", true, 24*time.Hour)
	adminID := createTestSession("admin", false, 24*time.Hour)

	tests := []struct {
		name      string
		sessionID string
		want      bool
	}{
		{"guest user", guestID, true},
		{"admin user", adminID, false},
		{"no session", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.sessionID != "" {
				req.AddCookie(&http.Cookie{Name: "session", Value: tt.sessionID})
			}

			if got := IsGuestUser(req); got != tt.want {
				t.Errorf("IsGuestUser() = %v, want %v", got, tt.want)
			}
		})
	}
}
