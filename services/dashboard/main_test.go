package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthHandler(t *testing.T) {
	tests := []struct {
		name           string
		method         string
		wantStatus     int
		wantBody       string
		wantContentType string
	}{
		{
			name:            "GET returns healthy JSON",
			method:          http.MethodGet,
			wantStatus:      http.StatusOK,
			wantBody:        `{"status":"healthy"}`,
			wantContentType: "application/json",
		},
		{
			name:            "POST also works (no method restriction)",
			method:          http.MethodPost,
			wantStatus:      http.StatusOK,
			wantBody:        `{"status":"healthy"}`,
			wantContentType: "application/json",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/health", nil)
			rec := httptest.NewRecorder()

			healthHandler(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if got := rec.Body.String(); got != tt.wantBody {
				t.Errorf("body = %q, want %q", got, tt.wantBody)
			}

			if ct := rec.Header().Get("Content-Type"); ct != tt.wantContentType {
				t.Errorf("Content-Type = %q, want %q", ct, tt.wantContentType)
			}
		})
	}
}

func TestHealthHandlerReturnsValidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	healthHandler(rec, req)

	var result map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}

	if status, ok := result["status"]; !ok || status != "healthy" {
		t.Errorf("expected status=healthy, got %v", result)
	}
}
