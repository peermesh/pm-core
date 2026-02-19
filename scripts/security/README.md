# Security Scripts

Scripts for security testing and auditing Peer Mesh Docker Lab.

## Available Scripts

### run-docker-bench.sh

Runs the Docker Bench Security scanner against the infrastructure.

```bash
# Full scan (requires sudo for host checks)
sudo ./scripts/security/run-docker-bench.sh

# Quick scan (skip host checks)
./scripts/security/run-docker-bench.sh --quick

# Show help
./scripts/security/run-docker-bench.sh --help
```

**Output**: Reports saved to `../../.dev/ai/security/docker-bench-*.log`

### validate-image-policy.sh

Validates compose image references against baseline policy (explicit tag or digest, latest handling).

```bash
# Default policy (latest tag = warning)
./scripts/security/validate-image-policy.sh

# Strict policy (latest tag = failure)
./scripts/security/validate-image-policy.sh --fail-on-latest --strict
```

### generate-sbom.sh

Generates CycloneDX SBOM artifacts for compose-resolved images using `syft` or `docker sbom`.

```bash
# Default output path
./scripts/security/generate-sbom.sh

# Explicit output path
./scripts/security/generate-sbom.sh --output-dir /tmp/pmdl-sbom
```

### validate-supply-chain.sh

Runs the full supply-chain baseline gate: image policy + SBOM + vulnerability threshold scan.

```bash
# Baseline threshold (CRITICAL)
./scripts/security/validate-supply-chain.sh --severity-threshold CRITICAL

# Stricter gate
./scripts/security/validate-supply-chain.sh --severity-threshold HIGH --fail-on-latest --strict
```

## Documentation

- [DOCKER-BENCH-GUIDE.md](DOCKER-BENCH-GUIDE.md) - Expected findings and mitigations
- [Security Architecture](../../docs/SECURITY-ARCHITECTURE.md) - Full security design
- [Security Checklist](../../docs/SECURITY-CHECKLIST.md) - CIS/OWASP controls
- [Audit Preparation](../../docs/AUDIT-PREP.md) - Audit package

## Quick Commands

```bash
# Validate secrets exist and have correct permissions
./scripts/generate-secrets.sh --validate

# Check Docker Compose configuration
docker compose config --quiet

# List security-related container settings
docker inspect $(docker compose ps -q) | jq '.[].HostConfig.SecurityOpt'

# Check for privileged containers (should return empty)
docker inspect $(docker compose ps -q) | jq '.[].HostConfig.Privileged' | grep true

# Scan images for vulnerabilities
trivy image traefik:v2.11

# Run supply-chain baseline gate
./scripts/security/validate-supply-chain.sh --severity-threshold CRITICAL
```

## Adding New Security Scripts

1. Place scripts in this directory
2. Make executable: `chmod +x script.sh`
3. Document in this README
4. Update DOCKER-BENCH-GUIDE.md if relevant
