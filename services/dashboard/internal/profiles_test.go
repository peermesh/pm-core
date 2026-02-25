package internal

import "testing"

func TestDetectProfilesUsesDefaultWhenNoComposeLabels(t *testing.T) {
	containers := []ContainerInfo{
		{
			ID:       "c1",
			State:    "running",
			Health:   "healthy",
			MemoryMB: 64,
			Labels:   map[string]string{},
		},
	}

	profiles := DetectProfiles(containers)
	if len(profiles) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(profiles))
	}

	if profiles[0].Name != DefaultProfileName {
		t.Fatalf("expected profile %q, got %q", DefaultProfileName, profiles[0].Name)
	}

	if profiles[0].HealthStatus != HealthStatusHealthy {
		t.Fatalf("expected health %q, got %q", HealthStatusHealthy, profiles[0].HealthStatus)
	}
}

func TestDetectProfilesHandlesMultipleComposeProfiles(t *testing.T) {
	containers := []ContainerInfo{
		{
			ID:         "c2",
			State:      "running",
			Health:     "healthy",
			MemoryMB:   128,
			CPUPercent: 1.5,
			Labels: map[string]string{
				LabelComposeProfiles: "postgresql, redis",
			},
		},
	}

	profiles := DetectProfiles(containers)
	if len(profiles) != 2 {
		t.Fatalf("expected 2 profiles, got %d", len(profiles))
	}

	seen := map[string]bool{}
	for _, p := range profiles {
		seen[p.Name] = true
		if p.HealthStatus != HealthStatusHealthy {
			t.Fatalf("expected profile %q to be healthy, got %q", p.Name, p.HealthStatus)
		}
	}

	if !seen["postgresql"] || !seen["redis"] {
		t.Fatalf("expected postgresql and redis profiles, got %+v", seen)
	}
}
