# Webhook-Based Deployment Guide

Deploy automatically when you push to GitHub. No SSH keys in GitHub Secrets required.

## Overview

### What is Pull-Based Deployment?

Traditional CI/CD uses **push-based** deployment: GitHub Actions SSHes into your server with stored credentials. This means:
- SSH keys stored in GitHub Secrets
- If GitHub is compromised, attackers get server access
- Credentials exist outside your infrastructure

**Pull-based deployment inverts this**: Your VPS pulls code when notified. Credentials never leave your server.

```
Push-Based (traditional):           Pull-Based (this guide):

GitHub ─── SSH ──────> VPS          GitHub ─── webhook ──> VPS
   │                                    │                    │
   │  (SSH key in                       │  (just a           │
   │   GitHub Secrets)                  │   notification)    │
   └───────────────────                 └───────────────┘    │
                                                             │
                                        VPS pulls code using │
                                        local deploy key ────┘
```

### Why This Approach?

| Concern | Push-Based | Pull-Based (Webhook) |
|---------|------------|---------------------|
| Credentials location | GitHub Secrets | VPS only |
| GitHub compromise impact | Direct server access | Can only trigger deploys |
| Network exposure | SSH port open | Single HTTPS endpoint |
| Audit compliance | Acceptable | Preferred by auditors |

---

## Prerequisites

Before starting, ensure you have:

- [ ] VPS with Docker and Docker Compose installed
- [ ] Domain pointed to your VPS (A record + wildcard `*.domain.com`)
- [ ] Traefik running from base setup (handles TLS automatically)
- [ ] Repository cloned to `/opt/peermesh` on VPS

## Canonical Deployment Contract

Webhook deployment uses a wrapper (`deploy/webhook/deploy.sh`) that always calls the canonical deploy entrypoint:

- canonical deploy entrypoint: `./scripts/deploy.sh`
- webhook target environment: `production`
- required promotion source: `staging`
- evidence output root: `/tmp/deploy-logs/evidence` (override with `EVIDENCE_ROOT`)

This keeps operator and webhook deployment logic aligned.

---

## Quick Setup

Run the webhook profile and set the webhook secret on your VPS:

```bash
cd /opt/peermesh

# 1) Generate a webhook secret (hex string)
openssl rand -hex 32

# 2) Put it in your local VPS .env (untracked)
nano .env
# WEBHOOK_SECRET=<paste value>

# 3) Start webhook listener profile
docker compose -f docker-compose.yml -f docker-compose.webhook.yml --profile webhook up -d
```

### What This Setup Does

1. Configures webhook listener container from `docker-compose.webhook.yml`
2. Uses `deploy/webhook/hooks.json` for signature validation and branch filtering
3. Routes webhook trigger to `deploy/webhook/deploy.sh`
4. Calls canonical deployment path (`scripts/deploy.sh`) for apply and evidence capture

### Expected Output

```
<webhook profile starts>
<webhook container healthy>
```

---

## GitHub Configuration

### Step 1: Add the Deploy Key

The deploy key allows your VPS to pull code from your repository.

Create a key pair on the VPS if needed:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub
```

1. Go to your repository on GitHub
2. Navigate to **Settings** > **Deploy keys**
3. Click **Add deploy key**
4. Configure:
   - **Title**: `VPS Deploy Key` (or descriptive name)
   - **Key**: Paste the public key from `~/.ssh/deploy_key.pub`
   - **Allow write access**: Leave **unchecked** (read-only is more secure)
5. Click **Add key**

### Step 2: Add the Webhook

The webhook notifies your VPS when code is pushed.

1. Go to your repository on GitHub
2. Navigate to **Settings** > **Webhooks**
3. Click **Add webhook**
4. Configure:

| Field | Value |
|-------|-------|
| **Payload URL** | `https://webhook.YOURDOMAIN.COM/hooks/deploy` (replace with your domain) |
| **Content type** | `application/json` |
| **Secret** | `WEBHOOK_SECRET` value from your VPS `.env` |
| **SSL verification** | Enable (default) |
| **Which events?** | Just the push event |
| **Active** | Checked |

5. Click **Add webhook**

GitHub will send a ping to verify the webhook is working. Check for a green checkmark.

---

## Testing

### Trigger a Test Deployment

```bash
# From your local machine, push a change
git commit --allow-empty -m "test deployment"
git push

# On the VPS, check if deployment was triggered
docker compose -f docker-compose.yml -f docker-compose.webhook.yml logs webhook --tail 50
```

### Verify Deployment Worked

```bash
# Check container status
docker compose ps

# View recent deployment logs
docker compose -f docker-compose.yml -f docker-compose.webhook.yml logs webhook --tail 50

# Manually trigger a deployment (for testing)
cd /opt/peermesh
./deploy/webhook/deploy.sh refs/heads/main manual-test
```

### Check Webhook Delivery Status

On GitHub:
1. Go to **Settings** > **Webhooks**
2. Click on your webhook
3. Scroll to **Recent Deliveries**
4. Check for green checkmarks (success) or red X marks (failure)

---

## Troubleshooting

### Common Issues

#### Webhook Delivery Fails (GitHub shows error)

```bash
# Check if webhook container is running
docker compose ps webhook

# View webhook container logs
docker compose logs webhook --tail 100

# Verify TLS certificate is valid
curl -I https://webhook.yourdomain.com/hooks/deploy
```

**Common causes**:
- Webhook container not running
- TLS certificate not issued yet (wait for Traefik)
- Firewall blocking port 443

#### Signature Validation Fails

```
Error: Hook rules were not satisfied
```

This means the webhook secret on GitHub does not match the VPS.

```bash
# View current secret on VPS
cd /opt/peermesh
grep '^WEBHOOK_SECRET=' .env

# Regenerate if needed
openssl rand -hex 32
# Replace WEBHOOK_SECRET in .env, then restart webhook profile:
docker compose -f docker-compose.yml -f docker-compose.webhook.yml --profile webhook up -d
```

Then update the secret in GitHub webhook settings.

#### Deploy Key Permission Denied

```
Permission denied (publickey)
```

```bash
# Test the deploy key
ssh -T git@github.com -i ~/.ssh/deploy_key

# Check key is added to GitHub
# The key fingerprint should match
ssh-keygen -lf ~/.ssh/deploy_key.pub
```

#### Deployment Script Fails

```bash
# Check deployment logs
ls -la /tmp/deploy-logs/

# Run deployment manually to see errors
cd /opt/peermesh
./deploy/webhook/deploy.sh refs/heads/main manual-debug
```

### Manual Deployment Trigger

If webhooks are not working, you can trigger deployment manually:

```bash
# Pull and deploy without webhook
cd /opt/peermesh
./deploy/webhook/deploy.sh refs/heads/main manual-trigger

# Or the full manual process
cd /opt/peermesh
git fetch --all
git checkout -f origin/main
./scripts/deploy.sh \
  --deploy-mode operator \
  --environment production \
  --promotion-from staging \
  --promotion-id manual-$(date -u +%Y%m%dT%H%M%SZ) \
  --evidence-root /tmp/pmdl-deploy-evidence \
  -f docker-compose.yml
```

### Viewing Logs

```bash
# Webhook receiver logs
docker compose -f docker-compose.yml -f docker-compose.webhook.yml logs webhook --tail 100

# Deployment execution logs
ls -la /tmp/deploy-logs/

# Most recent deployment (bounded tail + evidence hint)
./scripts/view-deploy-log.sh --tail 120

# Same workflow via just
just deploy-log
```

---

## Security Notes

### Why No SSH Keys in GitHub

Storing SSH keys in GitHub Secrets creates risk:

1. **Blast radius**: If your repository or GitHub account is compromised, attackers gain direct server access
2. **Credential sprawl**: SSH keys exist in two places (GitHub and VPS)
3. **Audit complexity**: Harder to track credential usage

With webhook deployment:
- The webhook secret can only trigger deployments of code already in the repo
- Attackers cannot get shell access even with the webhook secret
- All credentials remain on your infrastructure

### Webhook Secret Rotation

Rotate the webhook secret every 90 days:

```bash
# Generate new secret and update config
cd /opt/peermesh
openssl rand -hex 32
# Update WEBHOOK_SECRET in .env
docker compose -f docker-compose.yml -f docker-compose.webhook.yml --profile webhook up -d
```

After rotation:
1. Copy the new secret value
2. Go to GitHub > Settings > Webhooks
3. Edit your webhook
4. Update the Secret field
5. Save changes

### Deploy Key Permissions

The deploy key is intentionally **read-only**:

- Can clone and pull from the repository
- Cannot push, create branches, or modify code
- Cannot access other repositories

If the key is compromised, the worst case is someone can read your code (which is often already public anyway for open source projects).

To rotate the deploy key:

```bash
# Generate new key
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key.new -N ""

# Add the new key to GitHub (Settings > Deploy keys)
# Remove the old key after verifying the new one works
```

### Network Security

The webhook endpoint:
- Uses HTTPS with valid TLS (via Traefik + Let's Encrypt)
- Validates HMAC-SHA256 signatures on every request
- Only accepts POST requests to specific path
- Runs as a non-root user in a container

Additional hardening (optional):
```bash
# Restrict to GitHub IP ranges (changes periodically)
# See: https://api.github.com/meta
```

---

## Command Reference

| Command | Description |
|---------|-------------|
| `./deploy/webhook/deploy.sh refs/heads/main <sha>` | Manual webhook-equivalent deployment trigger |
| `./scripts/deploy.sh --environment production --promotion-from staging ...` | Canonical operator deployment path |
| `docker compose -f docker-compose.yml -f docker-compose.webhook.yml logs webhook --tail 100` | View webhook receiver logs |
| `ls -la /tmp/deploy-logs/` | View webhook deployment logs and evidence root |
| `./scripts/view-deploy-log.sh --tail 120` | View latest deployment log with evidence-bundle hint |
| `just deploy-log` | Convenience wrapper for deployment log viewer |

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────┐
│                       GitHub                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  Repository                          │    │
│  │  ┌──────────┐         ┌────────────────────────┐    │    │
│  │  │ git push │────────>│ Webhook Configuration  │    │    │
│  │  └──────────┘         │ - URL: webhook.domain  │    │    │
│  │                       │ - Secret: (HMAC key)   │    │    │
│  │                       └───────────┬────────────┘    │    │
│  └───────────────────────────────────│─────────────────┘    │
└──────────────────────────────────────│──────────────────────┘
                                       │
                                       │ HTTPS POST
                                       │ X-Hub-Signature-256
                                       ▼
┌─────────────────────────────────────────────────────────────┐
│                         VPS                                  │
│  ┌───────────────┐    ┌─────────────────────────────────┐   │
│  │    Traefik    │───>│      Webhook Container          │   │
│  │  (TLS, port   │    │  - Validates HMAC signature     │   │
│  │   443)        │    │  - Triggers deploy script       │   │
│  └───────────────┘    └─────────────┬───────────────────┘   │
│                                     │                        │
│                                     ▼                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               Deployment Script                       │   │
│  │  1. git fetch/reset to origin/main                    │   │
│  │  2. wrapper verifies sensitive-file policy            │   │
│  │  3. wrapper calls ./scripts/deploy.sh                 │   │
│  │  4. deploy.sh runs gates + emits evidence             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md) - VPS setup and base configuration
- [Secrets Management](SECRETS-MANAGEMENT.md) - Application secrets with SOPS+age
- [Security Guide](SECURITY.md) - Hardening and best practices
- [Troubleshooting Guide](TROUBLESHOOTING.md) - Common issues and solutions
