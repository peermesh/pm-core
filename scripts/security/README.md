# Security Scripts

Scripts for security testing and auditing PeerMesh Docker Lab.

## Quick Start: Full Audit

The single entry point for all scriptable security tests:

```bash
# Local-only audit (codebase + compose analysis, no VPS)
./scripts/security/run-full-audit.sh --local

# Full audit including remote VPS scans
./scripts/security/run-full-audit.sh --remote root@46.225.188.213

# With custom target and markdown report output
./scripts/security/run-full-audit.sh --local --target https://dockerlab.peermesh.org --output audit-report.md
```

Exit code 0 = no CRITICAL/HIGH findings. Exit code 1 = remediation needed.

## Available Scripts

### run-full-audit.sh (comprehensive, start here)

Runs ALL scriptable security tests in one command. Covers static analysis (gosec, shellcheck, pattern search), compose hardening audit, endpoint security tests (auth bypass, CRLF, XSS, security headers, timing), and optionally remote VPS scans (trivy, container hardening, network isolation, open ports, firewall).

```bash
# Codebase-only checks
./scripts/security/run-full-audit.sh --local

# Include remote VPS scans via SSH
./scripts/security/run-full-audit.sh --remote root@46.225.188.213

# Override target URL
./scripts/security/run-full-audit.sh --local --target http://localhost:8080

# Write markdown report
./scripts/security/run-full-audit.sh --local --output /tmp/security-audit.md
```

**Sections covered**:
1. Static Analysis: gosec, shellcheck, vulnerability pattern search
2. Compose Security: service hardening (cap_drop, no-new-privileges, memory limits, healthchecks), image pinning
3. Endpoint Security: auth bypass, CRLF injection, XSS reflection, security headers, request timing
4. Remote VPS (--remote only): trivy image scans, container hardening, network isolation, open ports, firewall, Docker daemon config
5. Summary with CRITICAL/HIGH/MEDIUM/LOW/PASS/SKIP counts and PASS/FAIL verdict

**Safety**: Read-only, no mutations. Safe to run against production.

### run-sqlmap-scan.sh

SQL injection scanner. Discovers API endpoints from Go source and runs sqlmap against each with safe defaults.

```bash
# Scan local dashboard
./scripts/security/run-sqlmap-scan.sh http://localhost:8080

# Scan with authentication cookie
./scripts/security/run-sqlmap-scan.sh https://dockerlab.peermesh.org --cookie "session=abc123"

# Custom output directory
./scripts/security/run-sqlmap-scan.sh http://localhost:8080 --output /tmp/sqlmap-report
```

**Requires**: sqlmap (`brew install sqlmap` / `pip install sqlmap`)
**Safety**: Uses `--batch --level=1 --risk=1` (lowest settings). No data exfiltration.

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

Validates compose image references against baseline policy (explicit tag or digest, hardened latest handling).

```bash
# Default policy (latest tag = failure)
./scripts/security/validate-image-policy.sh

# Legacy compatibility mode (latest tag = warning)
./scripts/security/validate-image-policy.sh --allow-latest

# Legacy compatibility mode (allow external tags without digest)
./scripts/security/validate-image-policy.sh --allow-external-tags
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

# Hardened gate
./scripts/security/validate-supply-chain.sh --severity-threshold HIGH --strict

# Authenticated non-interactive mode (recommended for CI/operators)
./scripts/security/validate-supply-chain.sh \
  --scout-username "$DOCKER_SCOUT_USERNAME" \
  --scout-token-file /run/secrets/docker_scout_pat

# Legacy degraded mode (explicit opt-in only)
./scripts/security/validate-supply-chain.sh --allow-auth-degraded

# Legacy compatibility mode for floating latest tags (temporary only)
./scripts/security/validate-supply-chain.sh --allow-latest

# Legacy compatibility mode for external tags without digest (temporary only)
./scripts/security/validate-supply-chain.sh --allow-external-tags
```

### audit-ownership.sh

Validates runtime container ownership, capabilities, and security settings against the documented hardening policy.

```bash
# Full audit (requires running containers)
./scripts/security/audit-ownership.sh

# Fix volume ownership mismatches
./scripts/security/audit-ownership.sh --fix-volumes

# JSON output for CI pipelines
./scripts/security/audit-ownership.sh --json
```

**Checks**:
- Container runtime UID matches ownership policy
- `cap_drop: ALL` applied to required services
- No unexpected capabilities added
- `no-new-privileges` enabled
- `read_only` root filesystem where expected
- Volume ownership matches UID:GID policy

## Documentation

- [DOCKER-BENCH-GUIDE.md](DOCKER-BENCH-GUIDE.md) - Expected findings and mitigations
- [Security Architecture](../../docs/SECURITY-ARCHITECTURE.md) - Full security design
- [Security Checklist](../../docs/SECURITY-CHECKLIST.md) - CIS/OWASP controls
- [Audit Preparation](../../docs/AUDIT-PREP.md) - Audit package

## Quick Commands

```bash
# Run the full security audit (single command, start here)
./scripts/security/run-full-audit.sh --local

# Run full audit with remote VPS scans
./scripts/security/run-full-audit.sh --remote root@46.225.188.213

# SQL injection scan
./scripts/security/run-sqlmap-scan.sh http://localhost:8080

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

# Run ownership and capability audit
./scripts/security/audit-ownership.sh
```

## Adding New Security Scripts

1. Place scripts in this directory
2. Make executable: `chmod +x script.sh`
3. Document in this README
4. Update DOCKER-BENCH-GUIDE.md if relevant
