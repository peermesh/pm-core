package handlers

import (
	"testing"
)

// --- FormatVolumeSize tests ---

func TestFormatVolumeSize(t *testing.T) {
	tests := []struct {
		name  string
		bytes int64
		want  string
	}{
		{"zero bytes", 0, "0 B"},
		{"500 bytes", 500, "500 B"},
		{"1 KB", 1024, "1.00 KB"},
		{"1.5 KB", 1536, "1.50 KB"},
		{"1 MB", 1024 * 1024, "1.00 MB"},
		{"1 GB", 1024 * 1024 * 1024, "1.00 GB"},
		{"1 TB", 1024 * 1024 * 1024 * 1024, "1.00 TB"},
		{"2.5 GB", int64(2.5 * 1024 * 1024 * 1024), "2.50 GB"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatVolumeSize(tt.bytes); got != tt.want {
				t.Errorf("FormatVolumeSize(%d) = %q, want %q", tt.bytes, got, tt.want)
			}
		})
	}
}

// --- containsString tests ---

func TestContainsString(t *testing.T) {
	tests := []struct {
		name  string
		slice []string
		s     string
		want  bool
	}{
		{"found", []string{"a", "b", "c"}, "b", true},
		{"not found", []string{"a", "b", "c"}, "d", false},
		{"empty slice", []string{}, "a", false},
		{"nil slice", nil, "a", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := containsString(tt.slice, tt.s); got != tt.want {
				t.Errorf("containsString(%v, %q) = %v, want %v", tt.slice, tt.s, got, tt.want)
			}
		})
	}
}

// --- buildVolumeDetail tests ---

func TestBuildVolumeDetail(t *testing.T) {
	t.Run("basic volume with no usage", func(t *testing.T) {
		vol := dockerAPIVolume{
			Name:       "test-volume",
			Driver:     "local",
			Mountpoint: "/var/lib/docker/volumes/test-volume/_data",
			CreatedAt:  "2024-01-01T00:00:00Z",
		}

		detail := buildVolumeDetail(vol, nil)

		if detail.Name != "test-volume" {
			t.Errorf("Name = %q, want %q", detail.Name, "test-volume")
		}
		if detail.Driver != "local" {
			t.Errorf("Driver = %q, want %q", detail.Driver, "local")
		}
		if detail.InUse {
			t.Error("expected InUse=false")
		}
		if len(detail.UsedBy) != 0 {
			t.Errorf("UsedBy should be empty, got %v", detail.UsedBy)
		}
	})

	t.Run("volume with usage data", func(t *testing.T) {
		vol := dockerAPIVolume{
			Name:   "data-volume",
			Driver: "local",
			UsageData: &struct {
				Size     int64 `json:"Size"`
				RefCount int   `json:"RefCount"`
			}{
				Size:     1024 * 1024, // 1MB
				RefCount: 2,
			},
		}

		detail := buildVolumeDetail(vol, nil)

		if detail.SizeBytes != 1024*1024 {
			t.Errorf("SizeBytes = %d, want %d", detail.SizeBytes, 1024*1024)
		}
		if !detail.InUse {
			t.Error("expected InUse=true when RefCount > 0")
		}
	})

	t.Run("volume in usage map", func(t *testing.T) {
		vol := dockerAPIVolume{
			Name:   "shared-vol",
			Driver: "local",
		}

		usageMap := map[string][]string{
			"shared-vol": {"container-a", "container-b"},
		}

		detail := buildVolumeDetail(vol, usageMap)

		if !detail.InUse {
			t.Error("expected InUse=true when in usage map")
		}
		if len(detail.UsedBy) != 2 {
			t.Errorf("UsedBy length = %d, want 2", len(detail.UsedBy))
		}
	})
}
