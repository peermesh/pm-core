# Pre-Deployment Checklist

Universal checks to run before deploying ANY application on Docker Lab.

Use this checklist before deploying new applications or troubleshooting failed deployments. Each item is verifiable with the command shown.

---

## Host Environment

### Required Software

- [ ] **Docker installed (version 24+)**
  ```bash
  docker --version
  # Expected: Docker version 24.x or higher
  ```

- [ ] **Docker Compose installed (version 2.20+)**
  ```bash
  docker compose version
  # Expected: Docker Compose version v2.20.x or higher
  ```

- [ ] **Required CLI tools installed**
  ```bash
  # Check all required tools
  command -v sops && command -v age && command -v just && command -v jq
  # All should return paths; missing = install needed
  ```

### Network Configuration

- [ ] **Domain DNS pointing to VPS**
  ```bash
  dig +short yourdomain.com
  # Expected: Your VPS IP address
  ```

- [ ] **Firewall allows HTTP/HTTPS**
  ```bash
  # Check if ports are open (from external machine)
  nc -zv your-vps-ip 80
  nc -zv your-vps-ip 443
  # Expected: Connection succeeded
  ```

- [ ] **No conflicting services on ports 80/443**
  ```bash
  lsof -i :80 -i :443
  # Expected: Empty or only Docker/Traefik processes
  ```

---

## Core Infrastructure

### Traefik Reverse Proxy

- [ ] **Traefik container running and healthy**
  ```bash
  docker compose ps traefik
  # Expected: Status "Up" and "healthy"
  ```

- [ ] **Traefik certificate resolver configured**
  ```bash
  docker compose logs traefik | grep -i "acme"
  # Expected: Certificate acquisition messages, no errors
  ```

### Docker Networks

- [ ] **Required networks exist**
  ```bash
  docker network ls | grep -E "proxy-external|db-internal"
  # Expected: Both networks listed
  ```

- [ ] **Networks are attachable (for compose services)**
  ```bash
  docker network inspect proxy-external | grep -i attachable
  # Expected: "Attachable": true
  ```

### Secrets Infrastructure

- [ ] **Secrets directory exists with correct permissions**
  ```bash
  ls -la secrets/ && stat -c "%a" secrets/
  # Expected: Directory exists, permissions 700
  ```

- [ ] **Secret files have correct permissions**
  ```bash
  find secrets/ -type f -exec stat -c "%a %n" {} \;
  # Expected: All files show 600
  ```

---

## Volumes

### Pre-Deployment Volume Check

- [ ] **No directory-where-file-expected corruption**
  ```bash
  # Check for common corruption patterns
  for vol in $(docker volume ls -q); do
    path="/var/lib/docker/volumes/${vol}/_data"
    # Look for directories with config file names
    sudo find "$path" -maxdepth 2 -type d \( -name "*.yaml" -o -name "*.yml" -o -name "*.conf" -o -name "*.config" \) 2>/dev/null
  done
  # Expected: No output (no directories with file-like names)
  ```

- [ ] **Volume permissions correct for non-root containers**
  ```bash
  # Check common non-root UIDs
  # PostgreSQL (uid 70), MySQL (uid 999), Node apps (uid 1000)
  ls -la ./data/
  # Verify ownership matches container user requirements
  ```

### Post-Failure Recovery

If a previous deployment failed, check for corruption:

```bash
# Example: Check Synapse config volume
sudo ls -la /var/lib/docker/volumes/synapse_data/_data/
# If homeserver.yaml is a directory, remove it:
sudo rm -rf /var/lib/docker/volumes/synapse_data/_data/homeserver.yaml
```

---

## Scripts

### Shell Compatibility

- [ ] **Script shebang matches runtime requirements**
  ```bash
  # Canonical entrypoint is Bash:
  head -n 1 scripts/deploy.sh
  # Expected: #!/usr/bin/env bash

  # Webhook wrapper stays POSIX:
  head -n 1 deploy/webhook/deploy.sh
  # Expected: #!/bin/sh
  ```

- [ ] **Scripts pass shellcheck**
  ```bash
  shellcheck -s bash scripts/deploy.sh
  shellcheck -s sh deploy/webhook/deploy.sh scripts/init-volumes.sh scripts/generate-secrets.sh
  # Expected: No errors (warnings acceptable)
  ```

- [ ] **Baseline script/unit/smoke tests execute**
  ```bash
  # Script harness checks (usage/exit contracts for critical scripts)
  just script-tests

  # Dashboard unit tests
  make dashboard-test

  # Generic HTTP smoke check
  just smoke-http http://127.0.0.1:8080 200

  # Example app smoke contract (when app is deployed)
  just smoke-example-app ghost https://ghost.example.com
  ```

### Common Bash-isms To Avoid In POSIX Scripts

If shellcheck finds issues in POSIX scripts, fix these common problems:

| Bash-ism | POSIX Alternative |
|----------|-------------------|
| `#!/bin/bash` | `#!/bin/sh` |
| `set -o pipefail` | Remove (use explicit checks) |
| `[[ ]]` | `[ ]` |
| `$((i++))` | `i=$((i + 1))` |
| `echo -e` | `printf` |
| `array=(a b c)` | Use positional parameters |

---

## Application-Specific Checks

### Healthcheck Configuration

- [ ] **Healthcheck uses correct tool for base image**
  ```bash
  # Check if image is Alpine-based
  docker run --rm <image-name> cat /etc/os-release | grep -i alpine
  # If Alpine: use wget
  # If Debian/Ubuntu: use curl
  ```

- [ ] **Healthcheck uses IPv4 explicitly**
  ```yaml
  # BAD - may resolve to IPv6
  test: ["CMD-SHELL", "wget http://localhost:3000/health"]

  # GOOD - explicit IPv4
  test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:3000/health || exit 1"]
  ```

- [ ] **Health endpoint exists for the application**
  ```bash
  # Common health endpoints to try:
  # /health, /healthz, /api/health, /.well-known/nodeinfo
  docker compose exec <service> wget -q --spider http://127.0.0.1:<port>/health
  ```

### Reverse Proxy Configuration

- [ ] **Trusted proxy config set (if behind Traefik)**
  ```yaml
  # Add Docker network CIDRs to trusted proxies
  environment:
    GTS_TRUSTED_PROXIES: "172.16.0.0/12,10.0.0.0/8"
    # Or app-specific equivalent (TRUSTED_PROXIES, etc.)
  ```

- [ ] **Service on proxy-external network**
  ```bash
  docker network inspect proxy-external | grep <service-container-name>
  # Expected: Container listed in network
  ```

### Environment Variables

- [ ] **App-specific env var names used (not generic)**
  ```bash
  # Check app documentation for required variable names
  # Example: ActivityPods needs SEMAPPS_QUEUE_SERVICE_URL, not REDIS_URL
  docker compose config | grep -A20 <service> | grep -i redis
  ```

### Secrets Handling

- [ ] **Secrets method matches app requirements**
  ```yaml
  # Method 1: Docker secrets with _FILE suffix (preferred)
  secrets:
    - app_secret_key
  environment:
    SECRET_KEY_BASE_FILE: /run/secrets/app_secret_key

  # Method 2: Direct environment variable (if app doesn't support _FILE)
  environment:
    SECRET_KEY_BASE: ${SECRET_KEY_BASE}
  ```

### Secret Contract Parity

- [ ] **Canonical keyset parity passes**
  ```bash
  ./scripts/validate-secret-parity.sh --environment production
  # Expected: Secret parity summary with CRITICAL=0
  ```

- [ ] **Rotation + recovery drill is runnable**
  ```bash
  ./scripts/secrets-rotation-recovery-drill.sh --environment staging --key postgres_password
  # Expected: Drill complete with evidence path in /tmp/pmdl-secrets-drills/
  ```

### Federation Adapter Boundary

- [ ] **Core runtime is stable without adapter**
  ```bash
  docker compose -f docker-compose.yml config -q
  # Expected: exit 0 with no adapter requirement
  ```

- [ ] **Adapter boundary validation passes**
  ```bash
  ./scripts/validate-federation-adapter-boundary.sh
  # Expected: failures=0
  ```

### Observability Profile Baseline

- [ ] **Observability-lite profile validation passes**
  ```bash
  ./scripts/validate-observability-profile.sh
  # Expected: Observability profile summary: failures=0
  ```

### Supply-Chain Baseline

- [ ] **Image policy gate passes**
  ```bash
  ./scripts/security/validate-image-policy.sh
  # Expected: FAILURES=0
  ```

- [ ] **SBOM artifacts are generated**
  ```bash
  ./scripts/security/generate-sbom.sh --output-dir /tmp/pmdl-sbom
  ls -la /tmp/pmdl-sbom
  # Expected: SBOM-INDEX.tsv and CycloneDX JSON files (for local images)
  ```

- [ ] **Vulnerability threshold gate passes at chosen severity**
  ```bash
  # Authenticated mode (recommended)
  DOCKER_SCOUT_USERNAME=your-user \
  DOCKER_SCOUT_TOKEN_FILE=/run/secrets/docker_scout_pat \
  ./scripts/security/validate-supply-chain.sh --severity-threshold CRITICAL
  # Expected: Supply-chain summary with FAILURES=0
  ```

- [ ] **Auth-degraded mode is disabled unless explicitly intentional**
  ```bash
  # Expected default: SUPPLY_CHAIN_ALLOW_AUTH_DEGRADED is false/unset
  env | grep '^SUPPLY_CHAIN_ALLOW_AUTH_DEGRADED=' || true
  ```

### Scalability/Resilience Wave-1

- [ ] **Wave-1 trigger matrix and non-functional checks are generated**
  ```bash
  ./scripts/scalability/run-wave1-validation.sh
  # Expected: wave1-summary.env + trigger-matrix.tsv + nonfunctional-checks.tsv
  ```

- [ ] **Wave-2 metrics capture removes UNKNOWN telemetry dimensions**
  ```bash
  ./scripts/scalability/capture-wave2-metrics.sh --ssh-host root@37.27.208.228 --output-dir /tmp/pmdl-wave2
  ./scripts/scalability/run-wave1-validation.sh --metrics-summary-file /tmp/pmdl-wave2/aggregated/wave2-metrics-summary.env
  # Expected: trigger-matrix has no UNKNOWN rows for latency_p99_ms, error_rate_pct, rto_min, rpo_hours
  ```

---

## Deployment Script Safety

### Race Condition Prevention

- [ ] **Deployment script uses file locking**
  ```sh
  # Add to deployment scripts:
  LOCK_FILE="/tmp/deploy-${APP_NAME}.lock"
  exec 200>"$LOCK_FILE"
  if ! flock -n 200; then
    echo "ERROR: Deployment already in progress"
    exit 1
  fi
  ```

### Required Tools in Container

- [ ] **Container has required tools for automation**
  ```bash
  # For webhook/deployment containers:
  docker compose exec webhook which git docker jq
  # Expected: All paths returned
  ```

---

## Quick Reference: App Type Patterns

### ActivityPub Applications (GoToSocial, Mastodon, etc.)

- Trusted proxy config required for federation
- Health endpoint often at `/.well-known/nodeinfo`
- May need specific WebSocket path routing

### Node.js Applications (ActivityPods, etc.)

- Often Alpine-based: use `wget` not `curl`
- May bind to localhost only: check `0.0.0.0` binding
- Specific Redis URL variable names required

### Ruby Applications (Mastodon, etc.)

- Need SECRET_KEY_BASE as file or env
- Often Debian-based: `curl` available
- May need asset precompilation on first run

### PHP Applications (Castopod, etc.)

- Check PHP-FPM socket vs TCP configuration
- May need writable storage directories
- Often Alpine-based

---

## Verification After Deployment

After completing deployment, verify:

```bash
# 1. Container status
docker compose ps
# All services should show "Up" and "healthy"

# 2. Logs for errors
docker compose logs --tail=50 | grep -i -E "error|fail|warn"
# Expected: No critical errors

# 2b. Deployment execution log (webhook/operator evidence context)
./scripts/view-deploy-log.sh --tail 120
# Expected: Latest deployment log tail with evidence bundle hint

# 3. External accessibility
curl -I https://your-app.yourdomain.com
# Expected: HTTP 200 or redirect

# 4. TLS certificate
echo | openssl s_client -connect your-app.yourdomain.com:443 2>/dev/null | openssl x509 -noout -dates
# Expected: Valid certificate dates
```

---

## Related Documentation

- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions
- [SECRETS-MANAGEMENT.md](./SECRETS-MANAGEMENT.md) - Secrets handling guide
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Full deployment procedures
- [SECURITY.md](./SECURITY.md) - Security configuration
