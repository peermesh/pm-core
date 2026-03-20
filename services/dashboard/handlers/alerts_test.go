package handlers

import (
	"testing"
)

// --- sanitizePath tests ---

func TestSanitizePath(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"/", "root"},
		{"/var/lib/docker", "var-lib-docker"},
		{"/tmp", "tmp"},
		{"", "root"},
		{"/home/user", "home-user"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := sanitizePath(tt.input); got != tt.want {
				t.Errorf("sanitizePath(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// --- formatPercent tests ---

func TestFormatPercent(t *testing.T) {
	tests := []struct {
		input float64
		want  string
	}{
		{0.0, "0.0"},
		{50.5, "50.5"},
		{99.9, "99.9"},
		{100.0, "100.0"},
		{85.3, "85.2"}, // truncation, not rounding
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := formatPercent(tt.input); got != tt.want {
				t.Errorf("formatPercent(%f) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// --- intToStr tests ---

func TestIntToStr(t *testing.T) {
	tests := []struct {
		input int
		want  string
	}{
		{0, "0"},
		{1, "1"},
		{42, "42"},
		{-5, "-5"},
		{100, "100"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := intToStr(tt.input); got != tt.want {
				t.Errorf("intToStr(%d) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// --- Alert threshold constants sanity check ---

func TestAlertThresholds(t *testing.T) {
	if MemoryWarningThreshold >= MemoryCriticalThreshold {
		t.Errorf("MemoryWarningThreshold (%f) should be < MemoryCriticalThreshold (%f)",
			MemoryWarningThreshold, MemoryCriticalThreshold)
	}
	if CPUWarningThreshold >= CPUCriticalThreshold {
		t.Errorf("CPUWarningThreshold (%f) should be < CPUCriticalThreshold (%f)",
			CPUWarningThreshold, CPUCriticalThreshold)
	}
	if DiskWarningThreshold >= DiskCriticalThreshold {
		t.Errorf("DiskWarningThreshold (%f) should be < DiskCriticalThreshold (%f)",
			DiskWarningThreshold, DiskCriticalThreshold)
	}
}
