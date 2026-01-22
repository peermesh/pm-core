# GitHub Actions Workflows

This directory contains CI/CD workflows for the Peer Mesh Docker Lab project.

## Active Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `validate.yml` | Push to main, PRs | YAML lint, compose syntax validation, security scanning |
| `integration.yml` | PRs | Container health checks across profiles and architectures |
| `release.yml` | Git tags (v*.*.*) | Create GitHub releases with changelog |

## Deployment Strategy

**This project uses webhook-based (pull) deployment, NOT GitHub Actions deployment.**

### Why No Push-Based Deployment?

Push-based deployment (GitHub Actions SSHing into VPS) requires storing SSH private keys in GitHub Secrets. This creates security risks:

1. **Credential exposure**: If GitHub account is compromised, attackers gain direct VPS access
2. **Credential sprawl**: SSH keys exist in two places (GitHub and VPS)
3. **Larger blast radius**: A single compromise affects both code and infrastructure

### Webhook Deployment (Recommended)

Instead, we use a pull-based webhook model:

```
Push-Based (NOT used):              Pull-Based (USED):

GitHub ─── SSH ──────> VPS          GitHub ─── webhook ──> VPS
   │                                    │                    │
   │  (SSH key in                       │  (just a           │
   │   GitHub Secrets)                  │   notification)    │
   └───────────────────                 └───────────────┘    │
                                                             │
                                        VPS pulls code using │
                                        local deploy key ────┘
```

With webhook deployment:
- The VPS has a webhook listener that responds to GitHub push events
- When notified, the VPS pulls code using a locally-stored deploy key
- SSH credentials never leave the VPS
- Even if webhook secret is compromised, attackers can only trigger deployments of code already in the repo

**Setup Guide**: See [docs/WEBHOOK-DEPLOYMENT.md](../../docs/WEBHOOK-DEPLOYMENT.md)

## Disabled Workflows

### `deploy.yml.DISABLED`

The original push-based deployment workflow has been disabled. It remains in the repository for reference but will not run.

**To understand the security concerns**: See FIND-008 documentation.

**To re-enable (NOT RECOMMENDED)**:
1. Rename `deploy.yml.DISABLED` to `deploy.yml`
2. Configure GitHub Secrets (SSH_PRIVATE_KEY, VPS_HOST, VPS_USER)
3. Understand the security tradeoffs before proceeding

## Adding New Workflows

When adding new workflows:

1. **Never store VPS SSH credentials in GitHub Secrets** for deployment
2. Use webhook-based deployment for production changes
3. GitHub Actions should be limited to:
   - Validation (linting, syntax checking)
   - Testing (in ephemeral containers)
   - Building (compile, package)
   - Release management (tagging, changelog)

## Related Documentation

- [Deployment Guide](../../docs/DEPLOYMENT.md) - VPS setup
- [Webhook Deployment](../../docs/WEBHOOK-DEPLOYMENT.md) - Production deployment
- [Security Guide](../../docs/SECURITY.md) - Hardening and best practices
