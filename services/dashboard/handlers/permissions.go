package handlers

import (
	"net/http"
	"strings"
)

// PermissionMiddleware checks if the current user has permission to access the endpoint
// Guest users are restricted from "dangerous" write operations
func PermissionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip permission check for non-API endpoints
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		// Get the current session
		session := GetSessionFromRequest(r)

		// If no session or not a guest, allow everything
		if session == nil || !session.IsGuest {
			next.ServeHTTP(w, r)
			return
		}

		// For guest users, check if endpoint is safe (read-only)
		if !isSafeEndpoint(r.Method, r.URL.Path) {
			http.Error(w, "Forbidden: Guest users cannot perform write operations", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// isSafeEndpoint returns true if the endpoint is safe for guest users
// Safe endpoints are read-only operations that don't modify state
func isSafeEndpoint(method, path string) bool {
	// Only GET methods are safe for guests
	if method != http.MethodGet {
		return false
	}

	// Define safe (read-only) API endpoints
	safeEndpoints := []string{
		"/api/containers",
		"/api/events",
		"/api/system",
		"/api/session",
	}

	// Check if the path matches any safe endpoint
	for _, safe := range safeEndpoints {
		if path == safe || strings.HasPrefix(path, safe+"?") {
			return true
		}
	}

	return false
}

// DangerousEndpoints lists endpoints that modify state
// These are blocked for guest users
var DangerousEndpoints = []string{
	// Container control operations (future implementation)
	"/api/containers/start",
	"/api/containers/stop",
	"/api/containers/restart",
	"/api/containers/remove",

	// Configuration operations (future implementation)
	"/api/config",
	"/api/settings",

	// Profile/module operations (future implementation)
	"/api/profiles",
	"/api/modules",
}

// IsGuestUser checks if the current request is from a guest user
func IsGuestUser(r *http.Request) bool {
	session := GetSessionFromRequest(r)
	return session != nil && session.IsGuest
}
