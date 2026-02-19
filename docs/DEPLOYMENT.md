# Deployment Guide

Deploy Peer Mesh Docker Lab to a commodity VPS ($20-50/month) running Ubuntu 22.04/24.04 LTS.

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

Manual execution:

```bash
./scripts/security/validate-supply-chain.sh --severity-threshold CRITICAL
```

Strict example:

```bash
SUPPLY_CHAIN_STRICT=true \
SUPPLY_CHAIN_FAIL_ON_LATEST=true \
SUPPLY_CHAIN_SEVERITY_THRESHOLD=HIGH \
./scripts/deploy.sh --validate
```

Reference: [SUPPLY-CHAIN-SECURITY.md](SUPPLY-CHAIN-SECURITY.md)

## Scalability And Resilience Wave-1

Wave-1 validation captures add-host vs scale-up decisions and non-functional baseline checks.

```bash
./scripts/scalability/run-wave1-validation.sh
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
  "userns-remap": "default",
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

Docker modifies iptables directly, bypassing UFW. To enforce UFW rules on Docker:

Create `/etc/docker/daemon.json` with:

```json
{
  "iptables": false
}
```

Then configure iptables manually for Docker:

```bash
# Create DOCKER-USER chain rules file
cat > /etc/ufw/after.rules << 'EOF'
# Docker UFW integration
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
docker compose pull

# This may take several minutes depending on connection speed
```

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
ls -la /var/backups/peermesh/

# Note the timestamp for potential rollback
```

### Rollback Procedures

Use the rollback artifacts generated by the canonical deploy script:

```bash
# Inspect rollback pointer and plan from the failed run
cat /tmp/pmdl-deploy-evidence/<run-id>/rollback-pointer.env
cat /tmp/pmdl-deploy-evidence/<run-id>/rollback-plan.md

# Reset code to pre-deploy commit (if git pointer exists)
git reset --hard <pre_deploy_commit>

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
./scripts/restore-all.sh /var/backups/peermesh/latest
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
| AI Workspace | `.dev/` | Work orders, findings, development notes |
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
find /opt/peermesh -name "*.key" -o -type d -name ".dev"

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
- [Operational Runbook](system-design-docs/06-operations/OPERATIONAL-RUNBOOK.md) - Day-to-day operations
