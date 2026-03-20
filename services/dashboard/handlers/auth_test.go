package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// --- Helper functions for auth tests ---

// setAuthCredentials sets the package-level auth credentials for testing.
// It returns a cleanup function that restores the original values.
func setAuthCredentials(username, password string) func() {
	origUser := authUsername
	origPass := authPassword
	authUsername = username
	authPassword = password
	return func() {
		authUsername = origUser
		authPassword = origPass
	}
}

// setDemoMode sets the package-level demo mode config for testing.
func setDemoMode(demo, guestEnabled bool) func() {
	origDemo := demoMode
	origGuest := demoModeGuestEnabled
	demoMode = demo
	demoModeGuestEnabled = guestEnabled
	return func() {
		demoMode = origDemo
		demoModeGuestEnabled = origGuest
	}
}

// createTestSession inserts a session into the in-memory store and returns the ID.
func createTestSession(username string, isGuest bool, ttl time.Duration) string {
	id := generateSessionID()
	sessionMutex.Lock()
	sessions[id] = sessionData{
		Username:  username,
		IsGuest:   isGuest,
		ExpiresAt: time.Now().Add(ttl),
	}
	sessionMutex.Unlock()
	return id
}

// clearSessions removes all sessions from the store.
func clearSessions() {
	sessionMutex.Lock()
	sessions = make(map[string]sessionData)
	sessionMutex.Unlock()
}

// --- LoginHandler tests ---

func TestLoginHandler_CorrectCredentials(t *testing.T) {
	cleanup := setAuthCredentials("admin", "secret123")
	defer cleanup()
	defer clearSessions()

	form := url.Values{}
	form.Set("username", "admin")
	form.Set("password", "secret123")

	req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()

	LoginHandler(rec, req)

	// Should redirect (302) to dashboard
	if rec.Code != http.StatusFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusFound)
	}

	location := rec.Header().Get("Location")
	if location != "/" {
		t.Errorf("Location = %q, want %q", location, "/")
	}

	// Should have set a session cookie
	cookies := rec.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatal("expected session cookie to be set")
	}
	if sessionCookie.Value == "" {
		t.Error("session cookie value should not be empty")
	}
	if !sessionCookie.HttpOnly {
		t.Error("session cookie should be HttpOnly")
	}
	if !sessionCookie.Secure {
		t.Error("session cookie should be Secure")
	}
}

func TestLoginHandler_WrongCredentials(t *testing.T) {
	cleanup := setAuthCredentials("admin", "secret123")
	defer cleanup()

	tests := []struct {
		name     string
		username string
		password string
	}{
		{"wrong password", "admin", "wrongpass"},
		{"wrong username", "baduser", "secret123"},
		{"both wrong", "baduser", "wrongpass"},
		{"empty credentials", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			form := url.Values{}
			form.Set("username", tt.username)
			form.Set("password", tt.password)

			req := httptest.NewRequest(http.MethodPost, "/api/login", strings.NewReader(form.Encode()))
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			rec := httptest.NewRecorder()

			LoginHandler(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestLoginHandler_MethodNotAllowed(t *testing.T) {
	methods := []string{http.MethodGet, http.MethodPut, http.MethodDelete, http.MethodPatch}
	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/api/login", nil)
			rec := httptest.NewRecorder()

			LoginHandler(rec, req)

			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
			}
		})
	}
}

// --- LogoutHandler tests ---

func TestLogoutHandler_ClearsCookieAndRedirects(t *testing.T) {
	defer clearSessions()

	sessionID := createTestSession("admin", false, 24*time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/api/logout", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionID})
	rec := httptest.NewRecorder()

	LogoutHandler(rec, req)

	// Should redirect to login page
	if rec.Code != http.StatusFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusFound)
	}

	location := rec.Header().Get("Location")
	if location != "/login.html" {
		t.Errorf("Location = %q, want %q", location, "/login.html")
	}

	// Session should be removed from store
	sessionMutex.RLock()
	_, exists := sessions[sessionID]
	sessionMutex.RUnlock()
	if exists {
		t.Error("session should be removed after logout")
	}

	// Cookie should be cleared (MaxAge -1)
	cookies := rec.Result().Cookies()
	for _, c := range cookies {
		if c.Name == "session" && c.MaxAge != -1 {
			t.Errorf("session cookie MaxAge = %d, want -1", c.MaxAge)
		}
	}
}

func TestLogoutHandler_NoSessionCookie(t *testing.T) {
	// Should not panic when no session cookie is present
	req := httptest.NewRequest(http.MethodPost, "/api/logout", nil)
	rec := httptest.NewRecorder()

	LogoutHandler(rec, req)

	if rec.Code != http.StatusFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusFound)
	}
}

// --- SessionHandler tests ---

func TestSessionHandler_NoSession(t *testing.T) {
	defer clearSessions()

	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	rec := httptest.NewRecorder()

	SessionHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var info SessionInfo
	if err := json.NewDecoder(rec.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if info.Authenticated {
		t.Error("expected Authenticated=false")
	}
	if info.Username != "" {
		t.Errorf("expected empty Username, got %q", info.Username)
	}
}

func TestSessionHandler_ValidSession(t *testing.T) {
	defer clearSessions()

	sessionID := createTestSession("admin", false, 24*time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionID})
	rec := httptest.NewRecorder()

	SessionHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var info SessionInfo
	if err := json.NewDecoder(rec.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !info.Authenticated {
		t.Error("expected Authenticated=true")
	}
	if info.Username != "admin" {
		t.Errorf("expected Username=admin, got %q", info.Username)
	}
	if info.IsGuest {
		t.Error("expected IsGuest=false")
	}
}

func TestSessionHandler_ExpiredSession(t *testing.T) {
	defer clearSessions()

	// Create a session that already expired
	id := generateSessionID()
	sessionMutex.Lock()
	sessions[id] = sessionData{
		Username:  "admin",
		ExpiresAt: time.Now().Add(-1 * time.Hour), // expired
	}
	sessionMutex.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: id})
	rec := httptest.NewRecorder()

	SessionHandler(rec, req)

	var info SessionInfo
	if err := json.NewDecoder(rec.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if info.Authenticated {
		t.Error("expired session should not be authenticated")
	}
}

func TestSessionHandler_GuestSession(t *testing.T) {
	defer clearSessions()
	cleanup := setDemoMode(true, true)
	defer cleanup()

	sessionID := createTestSession("guest", true, 24*time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionID})
	rec := httptest.NewRecorder()

	SessionHandler(rec, req)

	var info SessionInfo
	if err := json.NewDecoder(rec.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !info.Authenticated {
		t.Error("expected Authenticated=true for guest session")
	}
	if !info.IsGuest {
		t.Error("expected IsGuest=true")
	}
	if info.Username != "guest" {
		t.Errorf("expected Username=guest, got %q", info.Username)
	}
	if !info.DemoMode {
		t.Error("expected DemoMode=true")
	}
}

func TestSessionHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/session", nil)
	rec := httptest.NewRecorder()

	SessionHandler(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

// --- GuestLoginHandler tests ---

func TestGuestLoginHandler_DemoModeEnabled(t *testing.T) {
	cleanup := setDemoMode(true, true)
	defer cleanup()
	defer clearSessions()

	req := httptest.NewRequest(http.MethodPost, "/api/guest-login", nil)
	rec := httptest.NewRecorder()

	GuestLoginHandler(rec, req)

	if rec.Code != http.StatusFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusFound)
	}

	location := rec.Header().Get("Location")
	if location != "/" {
		t.Errorf("Location = %q, want %q", location, "/")
	}

	// Should have set a session cookie
	cookies := rec.Result().Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == "session" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected session cookie to be set for guest login")
	}
}

func TestGuestLoginHandler_DemoModeDisabled(t *testing.T) {
	cleanup := setDemoMode(false, false)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/guest-login", nil)
	rec := httptest.NewRecorder()

	GuestLoginHandler(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestGuestLoginHandler_GuestDisabled(t *testing.T) {
	cleanup := setDemoMode(true, false)
	defer cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/guest-login", nil)
	rec := httptest.NewRecorder()

	GuestLoginHandler(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestGuestLoginHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/guest-login", nil)
	rec := httptest.NewRecorder()

	GuestLoginHandler(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

// --- AuthMiddleware tests ---

func TestAuthMiddleware_NoPasswordConfigured(t *testing.T) {
	// When no password is set, all requests should pass through
	cleanup := setAuthCredentials("admin", "")
	defer cleanup()

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := AuthMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should have been called when no password is configured")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestAuthMiddleware_HealthEndpointAlwaysAllowed(t *testing.T) {
	cleanup := setAuthCredentials("admin", "secret123")
	defer cleanup()

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := AuthMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should have been called for /health")
	}
}

func TestAuthMiddleware_LoginEndpointsAllowed(t *testing.T) {
	cleanup := setAuthCredentials("admin", "secret123")
	defer cleanup()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := AuthMiddleware(inner)

	paths := []string{"/login", "/login.html", "/api/login", "/api/guest-login", "/api/session"}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Errorf("status = %d, want %d for path %s", rec.Code, http.StatusOK, path)
			}
		})
	}
}

func TestAuthMiddleware_StaticAssetsAllowed(t *testing.T) {
	cleanup := setAuthCredentials("admin", "secret123")
	defer cleanup()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := AuthMiddleware(inner)

	paths := []string{"/css/style.css", "/js/app.js"}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Errorf("status = %d, want %d for path %s", rec.Code, http.StatusOK, path)
			}
		})
	}
}

func TestAuthMiddleware_ProtectedRouteWithoutSession_APIRequest(t *testing.T) {
	cleanup := setAuthCredentials("admin", "secret123")
	defer cleanup()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := AuthMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	req.Header.Set("Accept", "application/json")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_ProtectedRouteWithoutSession_HTMLRequest(t *testing.T) {
	cleanup := setAuthCredentials("admin", "secret123")
	defer cleanup()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := AuthMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept", "text/html")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Errorf("status = %d, want %d (redirect to login)", rec.Code, http.StatusFound)
	}

	location := rec.Header().Get("Location")
	if location != "/login.html" {
		t.Errorf("Location = %q, want %q", location, "/login.html")
	}
}

func TestAuthMiddleware_ProtectedRouteWithValidSession(t *testing.T) {
	cleanup := setAuthCredentials("admin", "secret123")
	defer cleanup()
	defer clearSessions()

	sessionID := createTestSession("admin", false, 24*time.Hour)

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := AuthMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionID})
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should have been called with valid session")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	// Should set anti-cache headers
	if cc := rec.Header().Get("Cache-Control"); cc == "" {
		t.Error("expected Cache-Control header to be set on authenticated response")
	}
}

func TestAuthMiddleware_ProtectedRouteWithExpiredSession(t *testing.T) {
	cleanup := setAuthCredentials("admin", "secret123")
	defer cleanup()
	defer clearSessions()

	// Create an expired session directly
	id := generateSessionID()
	sessionMutex.Lock()
	sessions[id] = sessionData{
		Username:  "admin",
		ExpiresAt: time.Now().Add(-1 * time.Hour),
	}
	sessionMutex.Unlock()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := AuthMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	req.Header.Set("Accept", "application/json")
	req.AddCookie(&http.Cookie{Name: "session", Value: id})
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

// --- isValidSession tests ---

func TestIsValidSession(t *testing.T) {
	defer clearSessions()

	validID := createTestSession("admin", false, 24*time.Hour)

	expiredID := generateSessionID()
	sessionMutex.Lock()
	sessions[expiredID] = sessionData{
		Username:  "admin",
		ExpiresAt: time.Now().Add(-1 * time.Hour),
	}
	sessionMutex.Unlock()

	tests := []struct {
		name string
		id   string
		want bool
	}{
		{"valid session", validID, true},
		{"expired session", expiredID, false},
		{"nonexistent session", "fake-id-12345", false},
		{"empty session", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isValidSession(tt.id); got != tt.want {
				t.Errorf("isValidSession(%q) = %v, want %v", tt.id, got, tt.want)
			}
		})
	}
}

// --- GetSessionFromRequest tests ---

func TestGetSessionFromRequest(t *testing.T) {
	defer clearSessions()

	sessionID := createTestSession("admin", false, 24*time.Hour)

	t.Run("valid session", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(&http.Cookie{Name: "session", Value: sessionID})

		session := GetSessionFromRequest(req)
		if session == nil {
			t.Fatal("expected session, got nil")
		}
		if session.Username != "admin" {
			t.Errorf("Username = %q, want %q", session.Username, "admin")
		}
	})

	t.Run("no cookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)

		session := GetSessionFromRequest(req)
		if session != nil {
			t.Error("expected nil session when no cookie")
		}
	})

	t.Run("invalid session id", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(&http.Cookie{Name: "session", Value: "nonexistent"})

		session := GetSessionFromRequest(req)
		if session != nil {
			t.Error("expected nil session for invalid id")
		}
	})
}

// --- IsDemoMode / IsGuestEnabled tests ---

func TestIsDemoModeAndIsGuestEnabled(t *testing.T) {
	tests := []struct {
		name               string
		demo               bool
		guestEnabled       bool
		wantDemoMode       bool
		wantGuestEnabled   bool
	}{
		{"both enabled", true, true, true, true},
		{"demo on guest off", true, false, true, false},
		{"demo off guest on", false, true, false, false},
		{"both disabled", false, false, false, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleanup := setDemoMode(tt.demo, tt.guestEnabled)
			defer cleanup()

			if got := IsDemoMode(); got != tt.wantDemoMode {
				t.Errorf("IsDemoMode() = %v, want %v", got, tt.wantDemoMode)
			}
			if got := IsGuestEnabled(); got != tt.wantGuestEnabled {
				t.Errorf("IsGuestEnabled() = %v, want %v", got, tt.wantGuestEnabled)
			}
		})
	}
}

// --- generateSessionID tests ---

func TestGenerateSessionID_Unique(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := generateSessionID()
		if id == "" {
			t.Fatal("generateSessionID returned empty string")
		}
		if seen[id] {
			t.Fatalf("generateSessionID produced duplicate: %s", id)
		}
		seen[id] = true
	}
}

func TestGenerateSessionID_Length(t *testing.T) {
	id := generateSessionID()
	// 32 random bytes encoded as hex = 64 characters
	if len(id) != 64 {
		t.Errorf("session ID length = %d, want 64", len(id))
	}
}
