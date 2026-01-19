# Demo Mode Backend Implementation Summary

**Work Order:** WO-PMDL-2026-01-19-001
**Subtask:** Backend Demo Mode Implementation
**Status:** Complete
**Date:** 2026-01-18

## Files Changed

### 1. `services/dashboard/handlers/auth.go`

**Changes Made:**
- Added `encoding/json` import for session endpoint
- Added demo mode configuration variables:
  - `demoMode` - enables demo mode features
  - `demoModeGuestEnabled` - controls guest access (default true when demo mode enabled)
- Extended `sessionData` struct with `IsGuest bool` field
- Added `SessionInfo` struct for `/api/session` response
- Updated `init()` to read environment variables:
  - `DEMO_MODE` (default: false)
  - `DEMO_MODE_GUEST_ENABLED` (default: true when DEMO_MODE=true)
- Added helper functions:
  - `IsDemoMode()` - returns demo mode status
  - `IsGuestEnabled()` - returns guest access status
  - `GetSessionFromRequest()` - extracts session from request cookie
- Added new handlers:
  - `GuestLoginHandler` - POST /api/guest-login
  - `SessionHandler` - GET /api/session
- Updated `AuthMiddleware` to allow `/api/guest-login` and `/api/session` without auth

**Key Code Snippets:**

```go
// Demo mode configuration in init()
demoMode = os.Getenv("DEMO_MODE") == "true"
demoModeGuestEnabled = true
if guestEnv := os.Getenv("DEMO_MODE_GUEST_ENABLED"); guestEnv != "" {
    demoModeGuestEnabled = guestEnv == "true"
}
```

```go
// Guest session with 1-year expiry (effectively no expiry)
sessions[sessionID] = sessionData{
    Username:  "guest",
    IsGuest:   true,
    ExpiresAt: time.Now().Add(365 * 24 * time.Hour),
}
```

```go
// Session info response
type SessionInfo struct {
    Authenticated bool   `json:"authenticated"`
    IsGuest       bool   `json:"is_guest"`
    Username      string `json:"username"`
    DemoMode      bool   `json:"demo_mode"`
}
```

### 2. `services/dashboard/handlers/permissions.go` (NEW)

**Purpose:** Middleware to restrict guest users from dangerous operations.

**Key Components:**
- `PermissionMiddleware` - HTTP middleware that checks guest restrictions
- `isSafeEndpoint()` - determines if endpoint is read-only safe
- `DangerousEndpoints` - list of blocked endpoints for guests
- `IsGuestUser()` - helper to check if request is from guest

**Safe Endpoints (allowed for guests):**
- GET /api/containers
- GET /api/events
- GET /api/system
- GET /api/session

**Blocked for guests:**
- Any non-GET method
- Future container control endpoints (start/stop/restart/remove)
- Future configuration endpoints

**Key Code:**
```go
func PermissionMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !strings.HasPrefix(r.URL.Path, "/api/") {
            next.ServeHTTP(w, r)
            return
        }

        session := GetSessionFromRequest(r)
        if session == nil || !session.IsGuest {
            next.ServeHTTP(w, r)
            return
        }

        if !isSafeEndpoint(r.Method, r.URL.Path) {
            http.Error(w, "Forbidden: Guest users cannot perform write operations",
                      http.StatusForbidden)
            return
        }

        next.ServeHTTP(w, r)
    })
}
```

### 3. `services/dashboard/main.go`

**Changes Made:**
- Registered new endpoints:
  - `/api/guest-login` -> `handlers.GuestLoginHandler`
  - `/api/session` -> `handlers.SessionHandler`
- Updated middleware chain to include `PermissionMiddleware`

**Key Code:**
```go
// Auth endpoints
mux.HandleFunc("/api/login", handlers.LoginHandler)
mux.HandleFunc("/api/logout", handlers.LogoutHandler)
mux.HandleFunc("/api/guest-login", handlers.GuestLoginHandler)
mux.HandleFunc("/api/session", handlers.SessionHandler)

// Middleware chain: Auth -> Permissions -> Handler
handler := handlers.AuthMiddleware(handlers.PermissionMiddleware(mux))
```

## API Endpoints

### POST /api/guest-login
Creates a guest session when demo mode is enabled.

**Requirements:**
- `DEMO_MODE=true` must be set
- `DEMO_MODE_GUEST_ENABLED` must not be `false`

**Response:**
- 302 redirect to `/` on success
- 403 Forbidden if demo mode disabled
- 403 Forbidden if guest access disabled

### GET /api/session
Returns current session information.

**Response:**
```json
{
  "authenticated": true,
  "is_guest": true,
  "username": "guest",
  "demo_mode": true
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEMO_MODE` | `false` | Enables demo mode features |
| `DEMO_MODE_GUEST_ENABLED` | `true` (when DEMO_MODE=true) | Allows guest login |

## Design Decisions

1. **Guest Session Expiry:** Set to 1 year instead of never-expiring to maintain session store cleanup behavior while effectively being permanent.

2. **Permission Middleware Order:** Placed after AuthMiddleware so that session data is available for permission checks.

3. **Safe Endpoint Detection:** Uses explicit allowlist rather than blocklist for security - only specifically listed endpoints are accessible to guests.

4. **API-Only Permission Checks:** Non-API paths (static files) bypass permission checks as they're already read-only.

## Verification

- Code compiles successfully: `go build` passes
- Code passes `go vet` with no issues
- No new dependencies added

## Next Steps (Frontend)

The frontend should:
1. Check `/api/session` on page load to determine demo mode status
2. Show "Enter as Guest" button when `demo_mode: true`
3. Call POST `/api/guest-login` when guest button clicked
4. Hide/disable dangerous controls when `is_guest: true`
