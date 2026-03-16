# Deployment Guide

Deploy PeerMeshCore Docker Lab to a commodity VPS ($20-50/month) running Ubuntu 22.04/24.04 LTS.

## Deployment Paths

PeerMeshCore Docker Lab supports two valid paths:

1. OpenTofu-managed infrastructure (recommended):
   - OpenTofu provisions VPS/network/firewall/DNS via provider API
   - Docker Lab runtime is deployed on that provisioned host
2. Manual VPS provisioning:
   - operator provisions host manually
   - Docker Lab runtime is deployed on that host

Canonical project preference is path 1 (OpenTofu-managed infrastructure), with Hetzner as the primary provider target.

Boundary rule:

1. OpenTofu manages infrastructure lifecycle.
2. Docker Lab manages runtime/container lifecycle.

References:

- [OpenTofu Deployment Model](OPENTOFU-DEPLOYMENT-MODEL.md)
- [OpenTofu Scaffold README](../infra/opentofu/README.md)

## OpenTofu-Driven Walkthrough (Hetzner-first)

Use this path when you want API-driven provisioning instead of manual VPS setup.

1. Prepare live OpenTofu input files (untracked):
   - `infra/opentofu/env/pilot-single-vps.auto.tfvars`
   - optional backend config in `infra/opentofu/backend/*.hcl`
2. Set provider values in var file:
   - `compute_provider = "hetzner"`
   - `dns_provider = "cloudflare"` (or your DNS provider)
3. Capture required provider credentials using the secure credential manager:
   - `infra/opentofu/scripts/pilot-credentials.sh setup --var-file /path/to/pilot-single-vps.auto.tfvars`
   - default credential file location: `${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env`
   - onboarding placeholder copy: `docs/examples/pilot-single-vps.credentials.env.example`
   - bootstrap placeholder template:
     ```bash
     mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu"
     cp ./infra/opentofu/env/pilot-single-vps.credentials.env.example \
       "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env"
     chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env"
     ```
   - placeholder contract in that file:
     ```env
     HCLOUD_TOKEN=REPLACE_WITH_HETZNER_API_TOKEN
     # CLOUDFLARE_API_TOKEN=REPLACE_WITH_CLOUDFLARE_API_TOKEN
     ```
4. Set approval controls in shell:
   - `OPENTOFU_PILOT_APPLY_APPROVED=true`
   - `OPENTOFU_PILOT_CHANGE_REF=<work-order>`
5. Run readiness and plan:
   - `infra/opentofu/scripts/pilot-apply-readiness.sh --var-file ... --env-file ...`
6. Apply reviewed plan and run idempotency check.
7. Deploy Docker Lab runtime on the provisioned host using the canonical deploy path.
8. Add profiles/modules and validate runtime health.

Important:

1. OpenTofu and runtime deploy are complementary, not competing paths.
2. OpenTofu handles infrastructure API operations.
3. Docker Lab scripts handle runtime/container operations.
4. "Provider" here means an API integration/plugin; it is not a background autoscaling service.

## Security Notice: Deployment Method

**This project uses webhook-based (pull) deployment exclusively.**

Push-based CI/CD (GitHub Actions SSHing into your VPS) is **disabled by default** because it requires storing SSH credentials in GitHub Secrets, which expands your attack surface. If your GitHub account is compromised, attackers would gain direct VPS access.

With webhook deployment:
- VPS pulls code when notified via HTTPS webhook
- SSH credentials never leave your VPS
- Attackers with webhook secret can only trigger deployments of existing code

**Setup webhook deployment**: See [WEBHOOK-DEPLOYMENT.md](WEBHOOK-DEPLOYMENT.md)
**Promotion runbook**: See [DEPLOYMENT-PROMOTION-RUNBOOK.md](DEPLOYMENT-PROMOTION-RUNBOOK.md)

## Observability Defaults

Current default observability profile is the low-ops overlay:

- `profiles/observability-lite/docker-compose.observability-lite.yml` (Netdata + Uptime Kuma)

Validation command:

```bash
./scripts/validate-observability-profile.sh
```

Reference: [OBSERVABILITY-PROFILES.md](OBSERVABILITY-PROFILES.md)

## Supply-Chain Baseline Gates

Deployment preflight includes a supply-chain gate that runs:

1. image policy validation (`tag`/`digest` contract)
2. SBOM generation (CycloneDX)
3. vulnerability threshold checks

Version pinning policy:

- See [Enterprise Version Immutability Standard](ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md)
- See [Image Digest Baseline](IMAGE-DIGEST-BASELINE.md)

Manual execution:

```bash
./scripts/security/validate-supply-chain.sh --severity-threshold CRITICAL
```

Authenticated non-interactive execution (recommended for CI/operators):

```bash
DOCKER_SCOUT_USERNAME=your-user \
DOCKER_SCOUT_TOKEN_FILE=/run/secrets/docker_scout_pat \
./scripts/security/validate-supply-chain.sh --severity-threshold CRITICAL
```

Deploy default hardening:

1. `SUPPLY_CHAIN_STRICT=true` (default in `scripts/deploy.sh`)
2. `SUPPLY_CHAIN_FAIL_ON_LATEST=true` (default in `scripts/deploy.sh`)

Override example (typically unnecessary):

```bash
SUPPLY_CHAIN_STRICT=true \
SUPPLY_CHAIN_FAIL_ON_LATEST=true \
SUPPLY_CHAIN_SEVERITY_THRESHOLD=HIGH \
./scripts/deploy.sh --validate
```

If you intentionally need legacy degraded behavior in local workflows:

```bash
SUPPLY_CHAIN_ALLOW_AUTH_DEGRADED=true ./scripts/deploy.sh --validate
```

Reference: [SUPPLY-CHAIN-SECURITY.md](SUPPLY-CHAIN-SECURITY.md)

## Scalability And Resilience Wave-1

Wave-1 validation captures add-host vs scale-up decisions and non-functional baseline checks.

```bash
./scripts/scalability/run-wave1-validation.sh
```

Wave-2 capture and ingestion for 24h latency/error/RTO/RPO evidence:

```bash
./scripts/scalability/capture-wave2-metrics.sh \
  --ssh-host root@37.27.208.228 \
  --output-dir /tmp/pmdl-wave2

./scripts/scalability/run-wave1-validation.sh \
  --metrics-summary-file /tmp/pmdl-wave2/aggregated/wave2-metrics-summary.env
```

Reference: [SCALABILITY-RESILIENCE-WAVE1.md](SCALABILITY-RESILIENCE-WAVE1.md)

## VPS Provider Requirements

### Minimum Specifications

| Profile | vCPUs | RAM | Storage | Monthly Cost |
|---------|-------|-----|---------|--------------|
| `lite` | 1 | 2GB | 25GB SSD | ~$12 |
| `core` | 2 | 4GB | 50GB SSD | ~$24 |
| `full` | 4 | 8GB | 100GB SSD | ~$48 |

### Recommended Providers

Any provider offering Ubuntu 22.04/24.04 LTS with root access:

- DigitalOcean Droplets
- Linode/Akamai
- Vultr
- Hetzner Cloud
- OVH/OVHcloud

### VPS Feature Checklist

Before provisioning, verify your provider offers:

- [ ] SSH key authentication support
- [ ] Firewall/Security Groups
- [ ] Automated backups (optional but recommended)
- [ ] Private networking (for multi-server setups)
- [ ] IPv4 address included

---

## VPS Setup Checklist

Complete these steps after provisioning your VPS. All commands run as root or with sudo.

> **IMPORTANT**: Before starting deployment, complete [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md) first. It includes critical pre-flight checks such as Snap Docker detection (which causes silent bind mount failures) and FHS path validation. Skipping the checklist may result in hard-to-diagnose deployment issues.

### Step 1: Initial Access

```bash
# SSH with your key (replace with your VPS IP)
ssh root@YOUR_VPS_IP

# Create deploy user (never run services as root)
adduser deploy
usermod -aG sudo deploy

# Copy SSH key to deploy user
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Verify you can login as deploy user before continuing
```

### Step 2: System Updates

```bash
# Update package lists
apt update

# Upgrade all packages
apt upgrade -y

# Install essential tools
apt install -y \
    curl \
    wget \
    git \
    htop \
    ncdu \
    unzip \
    fail2ban \
    ufw
```

### Step 3: SSH Hardening

Edit `/etc/ssh/sshd_config`:

```bash
# Disable password authentication
PasswordAuthentication no
PubkeyAuthentication yes

# Disable root login
PermitRootLogin no

# Limit login attempts
MaxAuthTries 3

# Use SSH Protocol 2 only
Protocol 2
```

Apply changes:

```bash
# Validate configuration
sshd -t

# Restart SSH (in a separate terminal, verify you can still connect)
systemctl restart sshd
```

### Step 4: Install Docker

```bash
# Remove any old Docker versions
apt remove docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install prerequisites
apt install -y ca-certificates curl gnupg

# Add Docker GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add deploy user to docker group
usermod -aG docker deploy

# Verify installation
docker --version
docker compose version
```

### Step 5: Docker Daemon Hardening

Create `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true,
  "no-new-privileges": true,
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 65536,
      "Soft": 65536
    }
  }
}
```

> **WARNING -- Daemon settings intentionally omitted**:
>
> - **`"icc": false`** -- Do NOT set this. It disables inter-container communication globally, breaking Docker Compose internal networks. Network isolation is achieved via `internal: true` on compose networks. See [SECURITY.md](SECURITY.md).
>
> - **`"userns-remap": "default"`** -- Omitted because it causes UID namespace remapping that breaks bind mounts with fixed ownership. If you use only Docker-managed volumes (not bind mounts), you may enable this for additional security.

Apply changes:

```bash
systemctl restart docker
systemctl enable docker
```

### Step 6: Configure Swap (Recommended)

```bash
# Check if swap exists
swapon --show

# If no swap, create 4GB swap file
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Make persistent
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Optimize swappiness for server workloads
echo 'vm.swappiness=10' >> /etc/sysctl.conf
sysctl -p
```

---

## Firewall Configuration

### UFW Setup (Recommended)

```bash
# Reset to defaults
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (IMPORTANT: do this before enabling)
ufw allow 22/tcp

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow Matrix Federation (if using Synapse)
ufw allow 8448/tcp

# Enable firewall
ufw enable

# Verify rules
ufw status verbose
```

### Docker and UFW Integration

Docker modifies iptables directly, bypassing UFW. Use the DOCKER-USER chain to enforce filtering rules on Docker traffic without disabling Docker's iptables management:

> **CRITICAL**: NEVER set `"iptables": false` in daemon.json. This completely breaks Docker container networking (containers will not be able to communicate or reach the internet). Use the DOCKER-USER chain approach below instead.

```bash
# Append DOCKER-USER chain rules to /etc/ufw/after.rules
cat >> /etc/ufw/after.rules << 'EOF'
# Docker UFW integration via DOCKER-USER chain
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -j RETURN -s 10.0.0.0/8
-A DOCKER-USER -j RETURN -s 172.16.0.0/12
-A DOCKER-USER -j RETURN -s 192.168.0.0/16
-A DOCKER-USER -j DROP -p tcp -m tcp --dport 5432
-A DOCKER-USER -j DROP -p tcp -m tcp --dport 3306
-A DOCKER-USER -j DROP -p tcp -m tcp --dport 27017
-A DOCKER-USER -j DROP -p tcp -m tcp --dport 6379
COMMIT
EOF

# Reload UFW
ufw reload
```

This ensures:
- Internal Docker networks function normally
- Database ports (PostgreSQL, MySQL, MongoDB, Redis) are blocked from external access
- Only Traefik-proxied services are accessible externally
- Docker's own iptables rules remain intact (do NOT set `"iptables": false`)

### Firewall Rules Summary

| Port | Protocol | Purpose | Access |
|------|----------|---------|--------|
| 22 | TCP | SSH | Allowed (consider limiting to your IP) |
| 80 | TCP | HTTP (redirects to HTTPS) | Allowed |
| 443 | TCP | HTTPS | Allowed |
| 8448 | TCP | Matrix Federation | Allowed (if needed) |
| 5432 | TCP | PostgreSQL | Blocked externally |
| 3306 | TCP | MySQL | Blocked externally |
| 27017 | TCP | MongoDB | Blocked externally |
| 6379 | TCP | Redis | Blocked externally |
| 9000/9001 | TCP | MinIO | Via Traefik only |

---

## DNS Configuration

### Required DNS Records

Configure these records with your DNS provider before deployment:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `@` | `YOUR_VPS_IP` | 300 |
| A | `*` | `YOUR_VPS_IP` | 300 |
| CNAME | `www` | `@` | 3600 |

### Subdomain Routing

With wildcard DNS (`*.example.com`), Traefik routes subdomains automatically:

| Subdomain | Service |
|-----------|---------|
| `traefik.example.com` | Traefik dashboard (if enabled) |
| `s3.example.com` | MinIO API |
| `minio.example.com` | MinIO console |
| `app.example.com` | Your application |

### DNS Propagation Verification

```bash
# Check A record
dig +short example.com

# Check wildcard
dig +short test.example.com

# Check from multiple locations (use online tools)
# - https://dnschecker.org
# - https://mxtoolbox.com/DNSLookup.aspx
```

Wait for DNS propagation (typically 5-30 minutes) before running Let's Encrypt certificate generation.

---

## First Deployment Steps

Complete this section after VPS setup, firewall, and DNS configuration.

### Step 1: Clone Repository

```bash
# Switch to deploy user
su - deploy

# Clone to standard location
cd /opt
sudo git clone https://github.com/your-org/peer-mesh-docker-lab.git peermesh
sudo chown -R deploy:deploy /opt/peermesh
cd /opt/peermesh
```

### Step 2: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit with your values
nano .env
```

Required configuration:

```env
# Your domain (must match DNS configuration)
DOMAIN=example.com

# Email for Let's Encrypt certificate notifications
ADMIN_EMAIL=admin@example.com

# Profile activation (comma-separated)
# Options: postgresql, mysql, mongodb, redis, minio
COMPOSE_PROFILES=postgresql,redis

# Resource profile (lite, core, full)
RESOURCE_PROFILE=core
```

Important:

1. For real ACME issuance, `ADMIN_EMAIL` must be a valid non-placeholder email domain.
2. Placeholder domains such as `example.com` can cause ACME account registration failure.
3. Some free wildcard dynamic DNS domains may hit Let's Encrypt rate limits; if this happens, switch to a different domain family or an owned domain.

### Step 3: Generate Secrets

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Generate all required secrets
./scripts/generate-secrets.sh

# Verify secrets created with correct permissions
ls -la secrets/
# Expected: 700 for directory, 600 for files
```

### Step 4: Validate Configuration

```bash
# Syntax check
docker compose config --quiet
# No output = success

# Secret contract parity check
./scripts/validate-secret-parity.sh --environment production
# Exit code 0 = no CRITICAL keyset drift

# View resolved configuration
docker compose config

# Verify profile services
docker compose config --services
```

### Step 5: Initial Pull

```bash
# Pull all required images
docker compose pull --ignore-buildable

# This may take several minutes depending on connection speed
```

`--ignore-buildable` is required because Docker Lab includes local build services (for example `dashboard`) that are not expected to exist in a public registry.

### Step 6: Start Services

```bash
# Start foundation services first
docker compose up -d traefik socket-proxy

# Wait for Traefik to be healthy
docker compose ps traefik

# Start remaining services
docker compose up -d
```

### Step 7: Verify Deployment

```bash
# Check all services are healthy
docker compose ps

# Expected output shows all services as "healthy"
NAME                 STATUS              PORTS
pmdl_socket-proxy    running             2375/tcp
pmdl_traefik         running (healthy)   80/tcp, 443/tcp, 8448/tcp
pmdl_postgres        running (healthy)   5432/tcp
pmdl_redis           running (healthy)   6379/tcp

# Verify TLS certificate
curl -vI https://your-domain.com 2>&1 | grep "issuer"
# Should show "Let's Encrypt"

# Check Traefik dashboard (local access only)
curl http://localhost:8080/ping
# Expected: OK
```

### Step 8: Post-Deployment Security

```bash
# Verify database ports are not externally accessible
# From a different machine:
nc -zv YOUR_VPS_IP 5432
# Expected: Connection refused

# Verify HTTPS redirect works
curl -I http://your-domain.com
# Expected: 301 redirect to https://

# Check container security
docker ps --format "table {{.Names}}\t{{.Status}}"
```

---

## Updates and Rollback Procedures

### Routine Updates

Use the canonical deployment entrypoint so preflight, promotion gates, and evidence output stay consistent:

```bash
cd /opt/peermesh

# Validate only (no apply)
./scripts/deploy.sh \
  --validate \
  --deploy-mode operator \
  --environment staging \
  --promotion-from dev \
  --evidence-root /tmp/pmdl-deploy-evidence \
  -f docker-compose.yml

# Apply staging promotion
./scripts/deploy.sh \
  --deploy-mode operator \
  --environment staging \
  --promotion-from dev \
  --promotion-id stage-$(date -u +%Y%m%dT%H%M%SZ) \
  --evidence-root /tmp/pmdl-deploy-evidence \
  -f docker-compose.yml

# Apply production promotion
./scripts/deploy.sh \
  --deploy-mode operator \
  --environment production \
  --promotion-from staging \
  --promotion-id prod-$(date -u +%Y%m%dT%H%M%SZ) \
  --evidence-root /tmp/pmdl-deploy-evidence \
  -f docker-compose.yml
```

### Pre-Update Backup

Always backup before major updates:

```bash
# Create pre-deploy backup
./scripts/backup.sh

# Verify backup completed
ls -la /var/backups/pmdl/

# Note the timestamp for potential rollback
```

### Rollback Procedures

Use the rollback artifacts generated by the canonical deploy script:

```bash
# Inspect rollback pointer and plan from the failed run
cat /tmp/pmdl-deploy-evidence/<run-id>/rollback-pointer.env
cat /tmp/pmdl-deploy-evidence/<run-id>/rollback-plan.md

# Optional: inspect captured source reference (if provided by orchestrator)
grep '^PRE_DEPLOY_SOURCE_REF=' /tmp/pmdl-deploy-evidence/<run-id>/rollback-pointer.env || true

# Restore source revision using your source orchestrator (outside deploy.sh)
# deploy.sh is runtime-only and does not perform source-control resets.

# Re-apply known-good runtime
./scripts/deploy.sh \
  --deploy-mode manual \
  --environment production \
  --promotion-from staging \
  --promotion-id rollback-$(date -u +%Y%m%dT%H%M%SZ) \
  --skip-pull \
  --evidence-root /tmp/pmdl-deploy-evidence \
  -f docker-compose.yml
```

### Database-Specific Updates

Database updates require extra care due to data persistence:

```bash
# 1. Create backup
./scripts/backup.sh

# 2. Check current version
docker compose exec postgres psql -U postgres -c "SELECT version();"

# 3. Stop database
docker compose stop postgres

# 4. Update image version in compose file or .env

# 5. Start with new version
docker compose up -d postgres

# 6. Verify database accessible
docker compose exec postgres pg_isready -U postgres

# 7. Run any required migrations
```

### Emergency Rollback

If services are completely down:

```bash
# Quick restart all services
docker compose down
docker compose up -d

# If that fails, check logs
docker compose logs --tail=100

# Force recreate from fresh state
docker compose down -v  # WARNING: Destroys volumes
docker compose up -d

# Restore data from backup
./scripts/restore-all.sh /var/backups/pmdl/latest
```

---

## Monitoring Deployment Health

### Quick Health Check

```bash
# All-in-one status
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# Resource usage
docker stats --no-stream

# Recent logs across all services
docker compose logs --tail=20
```

### Automated Health Monitoring

Add to deploy user's crontab (`crontab -e`):

```cron
# Check service health every 5 minutes
*/5 * * * * /opt/peermesh/scripts/health-check.sh >> /var/log/peermesh-health.log 2>&1

# Send alert if unhealthy (requires mail configured)
*/5 * * * * docker compose -f /opt/peermesh/docker-compose.yml ps | grep -v "healthy" | grep -v "NAME" && echo "Service unhealthy" | mail -s "PMDL Alert" admin@example.com
```

### Certificate Expiration Monitoring

```bash
# Check days until certificate expiry
echo | openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null | \
  openssl x509 -noout -enddate

# Add to cron for weekly check
0 0 * * 0 /opt/peermesh/scripts/check-certs.sh
```

---

---

## Deployment Security: .deployignore

The `.deployignore` file specifies files and directories that should **never** be present on production VPS servers. This provides defense-in-depth against sensitive data leakage.

### Files Excluded from Deployment

| Category | Files/Patterns | Reason |
|----------|---------------|--------|
| Secrets | `.env`, `secrets/`, `*.key`, `*.pem` | Contain credentials |
| AI Workspace | Development workspace artifacts | Work orders, findings, development notes |
| Local Overrides | `*.local.*`, `docker-compose.override.yml` | Dev-specific configs |
| IDE Config | `.vscode/`, `.idea/` | Developer settings |
| Test Fixtures | `**/test/fixtures/`, `*.test.env` | May contain mock credentials |
| Git/CI | `.git/`, `.github/` | Not needed when pulling via git |

### How It Works

The webhook deployment script includes a security verification step that:

1. Checks for sensitive file patterns after `git pull`
2. Blocks deployment if sensitive files are detected
3. Logs warnings for manual investigation

```bash
# From deploy/webhook/deploy.sh
verify_no_sensitive_files() {
    # Blocks tracked .env files and sensitive patterns.
    # Allows local VPS .env only when untracked.
}
```

### Manual Verification

To verify your deployment doesn't contain sensitive files:

```bash
# On VPS, check for files that shouldn't exist
find /opt/peermesh -name "*.key" -o -type d -name "*workspace*"

# Ensure .env is present but untracked
cd /opt/peermesh
test -f .env
git ls-files --error-unmatch .env && echo "ERROR: .env is tracked"

# Using rsync dry-run with .deployignore
rsync -av --exclude-from='.deployignore' --dry-run ./ /tmp/deploy-test/
```

### Production .env Management

The production `.env` file should be:
1. Created directly on the VPS (never committed to git)
2. Stored outside the git-managed directory, symlinked in
3. Backed up separately with encryption

```bash
# Example: Store .env outside git directory
/opt/peermesh/.env -> /opt/secrets/peermesh.env

# Verify .env is not tracked
cd /opt/peermesh
git status  # .env should not appear
```

---

## Next Steps

After successful deployment:

1. **Add your application** - See [examples/](../examples/) for deployment templates
2. **Configure backups** - Enable the backup profile and configure off-site storage
3. **Set up monitoring** - Enable the monitoring profile for Prometheus/Grafana
4. **Review security** - Complete the hardening checklist in [SECURITY.md](SECURITY.md)

## Related Documentation

- [Quick Start Guide](QUICKSTART.md) - Local development setup
- [Configuration Reference](CONFIGURATION.md) - All environment variables
- [Security Guide](SECURITY.md) - Hardening and best practices
- [Profiles Guide](PROFILES.md) - Resource and tech profiles
- [Troubleshooting Guide](TROUBLESHOOTING.md) - Common issues and solutions
- [Webhook Deployment](WEBHOOK-DEPLOYMENT.md) - Automated deployment setup
- [Deployment Promotion Runbook](DEPLOYMENT-PROMOTION-RUNBOOK.md) - Canonical promotion and rollback workflow
- [Federation Adapter Boundary](FEDERATION-ADAPTER-BOUNDARY.md) - Optional federation module boundary rules
<!-- TODO: Add operational runbook documentation -->
<!-- - [Operational Runbook](system-design-docs/06-operations/OPERATIONAL-RUNBOOK.md) - Day-to-day operations -->
