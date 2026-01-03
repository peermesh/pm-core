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
- [ ] `just` command runner installed (`apt install just` or `brew install just`)

---

## Quick Setup

Run this single command on your VPS:

```bash
cd /opt/peermesh
just webhook-setup
```

### What This Command Does

1. Generates a secure webhook secret (32 random bytes, hex-encoded)
2. Creates a read-only deploy key for GitHub access
3. Configures the webhook listener container
4. Sets up the deployment script
5. Outputs configuration values for GitHub

### Expected Output

```
Webhook Setup Complete
=====================

Deploy Key (add to GitHub):
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... deploy@your-vps

Webhook Secret (add to GitHub):
a1b2c3d4e5f6...

Webhook URL:
https://webhook.yourdomain.com/hooks/deploy

(Where yourdomain.com matches DOMAIN in your .env file)

Next Steps:
1. Add deploy key to: Settings > Deploy keys
2. Add webhook to: Settings > Webhooks
3. Test with: just webhook-test
```

Save these values for the GitHub configuration steps below.

---

## GitHub Configuration

### Step 1: Add the Deploy Key

The deploy key allows your VPS to pull code from your repository.

1. Go to your repository on GitHub
2. Navigate to **Settings** > **Deploy keys**
3. Click **Add deploy key**
4. Configure:
   - **Title**: `VPS Deploy Key` (or descriptive name)
   - **Key**: Paste the public key from `just webhook-setup` output
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
| **Secret** | The webhook secret from `just webhook-setup` output |
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
just webhook-logs
```

### Verify Deployment Worked

```bash
# Check container status
docker compose ps

# View recent deployment logs
just webhook-logs --tail 50

# Manually trigger a deployment (for testing)
just webhook-trigger
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
just webhook-show-secret

# Regenerate if needed
just webhook-rotate-secret
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
cat /var/log/deploy/latest.log

# Run deployment manually to see errors
just webhook-deploy --verbose
```

### Manual Deployment Trigger

If webhooks are not working, you can trigger deployment manually:

```bash
# Pull and deploy without webhook
just webhook-deploy

# Or the full manual process
cd /opt/peermesh
git fetch --all
git checkout -f origin/main
docker compose pull
docker compose up -d
```

### Viewing Logs

```bash
# Webhook receiver logs
just webhook-logs

# Deployment execution logs
ls -la /var/log/deploy/

# Most recent deployment
cat /var/log/deploy/latest.log
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
just webhook-rotate-secret

# Output shows new secret - update in GitHub webhook settings
```

After rotation:
1. Copy the new secret from command output
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
just webhook-rotate-key

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
| `just webhook-setup` | Initial setup: create keys, secrets, configuration |
| `just webhook-deploy` | Manually trigger deployment |
| `just webhook-logs` | View webhook receiver logs |
| `just webhook-test` | Send test webhook to verify setup |
| `just webhook-status` | Check webhook container health |
| `just webhook-rotate-secret` | Generate new webhook secret |
| `just webhook-rotate-key` | Generate new deploy key |
| `just webhook-show-secret` | Display current webhook secret |

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
│  │  1. git fetch --all (using local deploy key)         │   │
│  │  2. git checkout origin/main                         │   │
│  │  3. docker compose pull                              │   │
│  │  4. docker compose up -d                             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md) - VPS setup and base configuration
- [Secrets Management](SECRETS-MANAGEMENT.md) - Application secrets with SOPS+age
- [Security Guide](SECURITY.md) - Hardening and best practices
- [Troubleshooting Guide](TROUBLESHOOTING.md) - Common issues and solutions
