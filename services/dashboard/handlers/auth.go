package handlers

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

var (
	// Session store - in production, use Redis or similar
	sessions     = make(map[string]sessionData)
	sessionMutex sync.RWMutex

	// Credentials from environment
	authUsername string
	authPassword string

	// Demo mode configuration
	demoMode             bool
	demoModeGuestEnabled bool
)

type sessionData struct {
	Username  string
	IsGuest   bool
	ExpiresAt time.Time
}

// SessionInfo represents the session info returned by GET /api/session
type SessionInfo struct {
	Authenticated bool   `json:"authenticated"`
	IsGuest       bool   `json:"is_guest"`
	Username      string `json:"username"`
	DemoMode      bool   `json:"demo_mode"`
}

func init() {
	// Load credentials from environment (preferred) or secrets file (fallback)
	// New naming: DOCKERLAB_* (see docs/GLOSSARY.md)
	// Backwards compatible: DASHBOARD_* still works but is deprecated
	authUsername = os.Getenv("DOCKERLAB_USERNAME")
	if authUsername == "" {
		authUsername = os.Getenv("DASHBOARD_USERNAME") // deprecated
	}
	if authUsername == "" {
		authUsername = getEnvOrFile("", "/run/secrets/dashboard_username", "admin")
	}

	authPassword = os.Getenv("DOCKERLAB_PASSWORD")
	if authPassword == "" {
		authPassword = os.Getenv("DASHBOARD_PASSWORD") // deprecated
	}
	if authPassword == "" {
		authPassword = getEnvOrFile("", "/run/secrets/dashboard_password", "")
	}

	// Load demo mode configuration
	// New naming: DOCKERLAB_DEMO_MODE (see docs/GLOSSARY.md)
	demoMode = os.Getenv("DOCKERLAB_DEMO_MODE") == "true"
	if !demoMode {
		demoMode = os.Getenv("DEMO_MODE") == "true" // deprecated
	}
	// Guest is enabled by default when demo mode is on, unless explicitly disabled
	demoModeGuestEnabled = true
	if guestEnv := os.Getenv("DEMO_MODE_GUEST_ENABLED"); guestEnv != "" {
		demoModeGuestEnabled = guestEnv == "true"
	}

	if authPassword == "" {
		log.Println("WARNING: No DASHBOARD_PASSWORD set - authentication disabled")
	} else {
		log.Println("Authentication enabled")
	}

	if demoMode {
		log.Printf("Demo mode enabled (guest access: %v)", demoModeGuestEnabled)
	}
}

// IsDemoMode returns whether demo mode is enabled
func IsDemoMode() bool {
	return demoMode
}

// IsGuestEnabled returns whether guest access is enabled
func IsGuestEnabled() bool {
	return demoMode && demoModeGuestEnabled
}

func getEnvOrFile(envKey, filePath, defaultVal string) string {
	if val := os.Getenv(envKey); val != "" {
		return val
	}
	if data, err := os.ReadFile(filePath); err == nil {
		return strings.TrimSpace(string(data))
	}
	return defaultVal
}

// AuthMiddleware wraps handlers to require authentication
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth if no password configured
		if authPassword == "" {
			next.ServeHTTP(w, r)
			return
		}

		// Allow health check without auth
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		// Allow login page and login/session APIs without auth
		if r.URL.Path == "/login" || r.URL.Path == "/login.html" ||
			r.URL.Path == "/api/login" || r.URL.Path == "/api/guest-login" ||
			r.URL.Path == "/api/session" {
			next.ServeHTTP(w, r)
			return
		}

		// Allow static assets for login page
		if strings.HasPrefix(r.URL.Path, "/css/") || strings.HasPrefix(r.URL.Path, "/js/") {
			next.ServeHTTP(w, r)
			return
		}

		// Check session cookie
		cookie, err := r.Cookie("session")
		if err != nil || !isValidSession(cookie.Value) {
			// Redirect to login page for HTML requests
			if strings.Contains(r.Header.Get("Accept"), "text/html") {
				http.Redirect(w, r, "/login.html", http.StatusFound)
				return
			}
			// Return 401 for API requests
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// LoginHandler handles POST /api/login
func LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseForm(); err != nil {
		http.Error(w, "Invalid form data", http.StatusBadRequest)
		return
	}

	username := r.FormValue("username")
	password := r.FormValue("password")

	// Constant-time comparison to prevent timing attacks
	usernameMatch := subtle.ConstantTimeCompare([]byte(username), []byte(authUsername)) == 1
	passwordMatch := subtle.ConstantTimeCompare([]byte(password), []byte(authPassword)) == 1

	if !usernameMatch || !passwordMatch {
		// Small delay to slow brute force
		time.Sleep(500 * time.Millisecond)
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	// Create session
	sessionID := generateSessionID()
	sessionMutex.Lock()
	sessions[sessionID] = sessionData{
		Username:  username,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}
	sessionMutex.Unlock()

	// Set cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   86400, // 24 hours
	})

	// Redirect to dashboard
	http.Redirect(w, r, "/", http.StatusFound)
}

// LogoutHandler handles POST /api/logout
func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("session")
	if err == nil {
		sessionMutex.Lock()
		delete(sessions, cookie.Value)
		sessionMutex.Unlock()
	}

	// Clear cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})

	http.Redirect(w, r, "/login.html", http.StatusFound)
}

// GuestLoginHandler handles POST /api/guest-login
// Creates a guest session when DEMO_MODE=true and guest access is enabled
func GuestLoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if demo mode and guest access are enabled
	if !demoMode {
		http.Error(w, "Demo mode not enabled", http.StatusForbidden)
		return
	}

	if !demoModeGuestEnabled {
		http.Error(w, "Guest access not enabled", http.StatusForbidden)
		return
	}

	// Create guest session with very long expiry (effectively no expiry)
	sessionID := generateSessionID()
	sessionMutex.Lock()
	sessions[sessionID] = sessionData{
		Username:  "guest",
		IsGuest:   true,
		ExpiresAt: time.Now().Add(365 * 24 * time.Hour), // 1 year expiry
	}
	sessionMutex.Unlock()

	// Set cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   365 * 24 * 60 * 60, // 1 year
	})

	// Redirect to dashboard
	http.Redirect(w, r, "/", http.StatusFound)
}

// SessionHandler handles GET /api/session
// Returns current session information
func SessionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	info := SessionInfo{
		Authenticated: false,
		IsGuest:       false,
		Username:      "",
		DemoMode:      demoMode,
	}

	// Check if user has valid session
	cookie, err := r.Cookie("session")
	if err == nil {
		sessionMutex.RLock()
		session, exists := sessions[cookie.Value]
		sessionMutex.RUnlock()

		if exists && time.Now().Before(session.ExpiresAt) {
			info.Authenticated = true
			info.IsGuest = session.IsGuest
			info.Username = session.Username
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")

	if err := json.NewEncoder(w).Encode(info); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// GetSessionFromRequest extracts session data from request cookie
// Returns nil if no valid session exists
func GetSessionFromRequest(r *http.Request) *sessionData {
	cookie, err := r.Cookie("session")
	if err != nil {
		return nil
	}

	sessionMutex.RLock()
	session, exists := sessions[cookie.Value]
	sessionMutex.RUnlock()

	if !exists || time.Now().After(session.ExpiresAt) {
		return nil
	}

	return &session
}

func isValidSession(sessionID string) bool {
	sessionMutex.RLock()
	defer sessionMutex.RUnlock()

	session, exists := sessions[sessionID]
	if !exists {
		return false
	}

	if time.Now().After(session.ExpiresAt) {
		// Session expired - clean up
		go func() {
			sessionMutex.Lock()
			delete(sessions, sessionID)
			sessionMutex.Unlock()
		}()
		return false
	}

	return true
}

func generateSessionID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		// Fallback to less secure but still random
		return base64.StdEncoding.EncodeToString([]byte(time.Now().String()))
	}
	return hex.EncodeToString(b)
}
