package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// --- generateInstanceID tests ---

func TestGenerateInstanceID(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"url input", "https://example.com"},
		{"name input", "my-instance"},
		{"empty", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id := generateInstanceID(tt.input)
			if id == "" {
				t.Error("generateInstanceID returned empty string")
			}
			// Should be hex-encoded 8 bytes = 16 chars
			if len(id) != 16 {
				t.Errorf("ID length = %d, want 16", len(id))
			}
		})
	}

	// Same input should produce same output (deterministic)
	t.Run("deterministic", func(t *testing.T) {
		id1 := generateInstanceID("https://example.com")
		id2 := generateInstanceID("https://example.com")
		if id1 != id2 {
			t.Errorf("same input produced different IDs: %q vs %q", id1, id2)
		}
	})

	// Different inputs should produce different outputs
	t.Run("different inputs", func(t *testing.T) {
		id1 := generateInstanceID("https://example.com")
		id2 := generateInstanceID("https://other.com")
		if id1 == id2 {
			t.Error("different inputs produced same ID")
		}
	})
}

// --- hashToken tests ---

func TestHashToken(t *testing.T) {
	t.Run("produces hex string", func(t *testing.T) {
		hash := hashToken("my-secret-token")
		if hash == "" {
			t.Error("hashToken returned empty string")
		}
		// SHA-256 produces 32 bytes = 64 hex chars
		if len(hash) != 64 {
			t.Errorf("hash length = %d, want 64", len(hash))
		}
	})

	t.Run("deterministic", func(t *testing.T) {
		h1 := hashToken("token123")
		h2 := hashToken("token123")
		if h1 != h2 {
			t.Error("same token produced different hashes")
		}
	})

	t.Run("different tokens produce different hashes", func(t *testing.T) {
		h1 := hashToken("token-a")
		h2 := hashToken("token-b")
		if h1 == h2 {
			t.Error("different tokens produced same hash")
		}
	})
}

// --- verifyToken tests ---

func TestVerifyToken(t *testing.T) {
	token := "my-secret-token"
	hash := hashToken(token)

	tests := []struct {
		name  string
		token string
		want  bool
	}{
		{"correct token", token, true},
		{"wrong token", "wrong-token", false},
		{"empty token", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := verifyToken(tt.token, hash); got != tt.want {
				t.Errorf("verifyToken(%q, hash) = %v, want %v", tt.token, got, tt.want)
			}
		})
	}
}

// --- InstanceTokenMiddleware tests ---

func TestInstanceTokenMiddleware_NoSecretConfigured(t *testing.T) {
	origSecret := instanceSecret
	instanceSecret = ""
	defer func() { instanceSecret = origSecret }()

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := InstanceTokenMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should be called when no instance secret is configured")
	}
}

func TestInstanceTokenMiddleware_NoTokenHeader(t *testing.T) {
	origSecret := instanceSecret
	instanceSecret = "test-secret"
	defer func() { instanceSecret = origSecret }()

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := InstanceTokenMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should be called when no X-Instance-Token header (normal user request)")
	}
}

func TestInstanceTokenMiddleware_ValidToken(t *testing.T) {
	origSecret := instanceSecret
	instanceSecret = "test-secret"
	defer func() { instanceSecret = origSecret }()

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := InstanceTokenMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	req.Header.Set("X-Instance-Token", "test-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should be called with valid instance token")
	}
}

func TestInstanceTokenMiddleware_InvalidToken(t *testing.T) {
	origSecret := instanceSecret
	instanceSecret = "test-secret"
	defer func() { instanceSecret = origSecret }()

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	handler := InstanceTokenMiddleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/api/containers", nil)
	req.Header.Set("X-Instance-Token", "wrong-secret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if called {
		t.Error("inner handler should NOT be called with invalid instance token")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
