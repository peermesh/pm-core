package internal

import (
	"strings"
)

const (
	HealthStatusHealthy   = "healthy"
	HealthStatusUnhealthy = "unhealthy"
	HealthStatusDegraded  = "degraded"
	HealthStatusUnknown   = "unknown"

	LabelComposeProfiles = "com.docker.compose.profiles"
	LabelComposeProject  = "com.docker.compose.project"
	LabelComposeService  = "com.docker.compose.service"

	DefaultProfileName = "default"
)

type ContainerInfo struct {
	ID           string
	Name         string
	State        string
	Health       string
	MemoryMB     int64
	CPUPercent   float64
	Labels       map[string]string
}

type Profile struct {
	Name            string   `json:"name"`
	Containers      []string `json:"containers"`
	TotalMemoryMB   int64    `json:"total_memory_mb"`
	TotalCPUPercent float64  `json:"total_cpu_percent"`
	HealthStatus    string   `json:"health_status"`
}

type ProfileDetector struct {
	profiles map[string]*Profile
}

func NewProfileDetector() *ProfileDetector {
	return &ProfileDetector{
		profiles: make(map[string]*Profile),
	}
}

func (pd *ProfileDetector) DetectFromContainers(containers []ContainerInfo) []Profile {
	pd.profiles = make(map[string]*Profile)

	for _, container := range containers {
		profileNames := pd.extractProfileNames(container)

		for _, profileName := range profileNames {
			pd.addContainerToProfile(profileName, container)
		}
	}

	pd.calculateHealthStatuses()

	return pd.getProfiles()
}

func (pd *ProfileDetector) extractProfileNames(container ContainerInfo) []string {
	if profiles, ok := container.Labels[LabelComposeProfiles]; ok && profiles != "" {
		return pd.parseProfilesLabel(profiles)
	}

	if project, ok := container.Labels[LabelComposeProject]; ok && project != "" {
		return []string{project}
	}

	return []string{DefaultProfileName}
}

func (pd *ProfileDetector) parseProfilesLabel(value string) []string {
	var profiles []string
	for _, p := range strings.Split(value, ",") {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			profiles = append(profiles, trimmed)
		}
	}
	if len(profiles) == 0 {
		return []string{DefaultProfileName}
	}
	return profiles
}

func (pd *ProfileDetector) addContainerToProfile(profileName string, container ContainerInfo) {
	profile, exists := pd.profiles[profileName]
	if !exists {
		profile = &Profile{
			Name:       profileName,
			Containers: []string{},
		}
		pd.profiles[profileName] = profile
	}

	profile.Containers = append(profile.Containers, container.ID)
	profile.TotalMemoryMB += container.MemoryMB
	profile.TotalCPUPercent += container.CPUPercent
}

func (pd *ProfileDetector) calculateHealthStatuses() {
	for name := range pd.profiles {
		pd.profiles[name].HealthStatus = HealthStatusUnknown
	}
}

func (pd *ProfileDetector) calculateHealthStatus(containers []ContainerInfo, containerIDs []string) string {
	if len(containerIDs) == 0 {
		return HealthStatusUnknown
	}

	idSet := make(map[string]bool)
	for _, id := range containerIDs {
		idSet[id] = true
	}

	var healthyCount, unhealthyCount, runningCount int

	for _, container := range containers {
		if !idSet[container.ID] {
			continue
		}

		if container.State == "running" {
			runningCount++
		}

		switch container.Health {
		case "healthy":
			healthyCount++
		case "unhealthy":
			unhealthyCount++
		}
	}

	if unhealthyCount > 0 {
		return HealthStatusDegraded
	}

	if healthyCount == len(containerIDs) && runningCount == len(containerIDs) {
		return HealthStatusHealthy
	}

	if runningCount == 0 {
		return HealthStatusUnhealthy
	}

	if runningCount < len(containerIDs) {
		return HealthStatusDegraded
	}

	return HealthStatusHealthy
}

func (pd *ProfileDetector) getProfiles() []Profile {
	profiles := make([]Profile, 0, len(pd.profiles))
	for _, profile := range pd.profiles {
		profiles = append(profiles, *profile)
	}
	return profiles
}

func DetectProfiles(containers []ContainerInfo) []Profile {
	detector := NewProfileDetector()
	profiles := detector.DetectFromContainers(containers)

	for i := range profiles {
		profiles[i].HealthStatus = detector.calculateHealthStatus(containers, profiles[i].Containers)
	}

	return profiles
}

func DetectProfilesWithStats(containers []ContainerInfo) ([]Profile, map[string][]ContainerInfo) {
	profiles := DetectProfiles(containers)

	containersByProfile := make(map[string][]ContainerInfo)
	for _, profile := range profiles {
		idSet := make(map[string]bool)
		for _, id := range profile.Containers {
			idSet[id] = true
		}

		var profileContainers []ContainerInfo
		for _, container := range containers {
			if idSet[container.ID] {
				profileContainers = append(profileContainers, container)
			}
		}
		containersByProfile[profile.Name] = profileContainers
	}

	return profiles, containersByProfile
}
