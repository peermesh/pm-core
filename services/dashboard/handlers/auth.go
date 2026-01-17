package handlers

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
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
)

type sessionData struct {
	Username  string
	ExpiresAt time.Time
}

func init() {
	// Load credentials from environment (preferred) or secrets file (fallback)
	authUsername = os.Getenv("DASHBOARD_USERNAME")
	if authUsername == "" {
		authUsername = getEnvOrFile("", "/run/secrets/dashboard_username", "admin")
	}

	authPassword = os.Getenv("DASHBOARD_PASSWORD")
	if authPassword == "" {
		authPassword = getEnvOrFile("", "/run/secrets/dashboard_password", "")
	}

	if authPassword == "" {
		log.Println("WARNING: No DASHBOARD_PASSWORD set - authentication disabled")
	} else {
		log.Println("Authentication enabled")
	}
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

		// Allow login page and login API without auth
		if r.URL.Path == "/login" || r.URL.Path == "/login.html" || r.URL.Path == "/api/login" {
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
