# Multi-Environment Deployment Guide

Core supports three deployment environments: **local development**, **staging**, and **production**. Each environment uses its own `.env` template with appropriate defaults for domain, TLS, logging, and resource allocation.

## Environments

### Local Development

- **Domain**: `localhost`
- **TLS**: Let's Encrypt staging CA (or disabled / self-signed via mkcert)
- **Logging**: `DEBUG` — verbose output for troubleshooting
- **Resource profile**: `lite` — minimal memory footprint
- **Use when**: Building and testing modules on your machine

### Staging

- **Domain**: `staging.peers.social` (or your staging subdomain)
- **TLS**: Let's Encrypt staging CA — issues real certificates that browsers warn about, but does not count against LE rate limits
- **Logging**: `INFO` — standard operational logging
- **Resource profile**: `core` — production-like resource allocation
- **Use when**: Validating deployments before promoting to production

### Production

- **Domain**: `peers.social` (or your production domain)
- **TLS**: Let's Encrypt production — trusted certificates
- **Logging**: `WARN` — minimal noise, only actionable messages
- **Resource profile**: `core` or `full` depending on VPS sizing
- **Use when**: Running live, public-facing services

## Switching Environments

Use the `env` command in `launch_docker_lab_core.sh`:

```bash
# Switch to local development
./launch_docker_lab_core.sh env local

# Switch to staging
./launch_docker_lab_core.sh env staging

# Switch to production
./launch_docker_lab_core.sh env production

# List available environments
./launch_docker_lab_core.sh env
```

The `env` command:
1. Checks that `.env.<name>.example` exists
2. Backs up the current `.env` to `.env.backup` (if one exists)
3. Copies `.env.<name>.example` to `.env`
4. Reminds you to review secrets before starting services

After switching, always review `.env` and set any required secrets (passwords, API keys, `TRAEFIK_DASHBOARD_AUTH`, etc.).

## What Changes Between Environments

| Setting | Local | Staging | Production |
|---------|-------|---------|------------|
| `DOMAIN` | `localhost` | `staging.peers.social` | `peers.social` |
| `TRAEFIK_LOG_LEVEL` | `DEBUG` | `INFO` | `WARN` |
| `RESOURCE_PROFILE` | `lite` | `core` | `core` |
| `TRAEFIK_ACME_CASERVER` | LE staging | LE staging | LE production (empty) |
| `DOCKERLAB_DEMO_MODE` | `true` | `false` | `false` |
| `COMPOSE_PROFILES` | Minimal | `postgresql,redis` | `postgresql,redis` |

## TLS and the ACME CA Server

Traefik obtains TLS certificates from Let's Encrypt by default. The `TRAEFIK_ACME_CASERVER` variable controls which CA server Traefik uses:

- **Empty / unset**: Production Let's Encrypt (trusted certificates, rate-limited)
- **`https://acme-staging-v02.api.letsencrypt.org/directory`**: LE staging (browsers warn, no rate limits)

The staging CA is recommended for local development and staging environments to avoid hitting Let's Encrypt production rate limits during testing.

For local development where DNS does not resolve, you may also:
- Disable TLS entirely and access services over HTTP
- Use [mkcert](https://github.com/FiloSottile/mkcert) for locally trusted certificates

## Secrets Per Environment

All environments use the same `secrets/` directory structure. The secret *values* differ per environment, but the *files* are the same:

```
secrets/
  postgres_password
  redis_password
  dashboard_username
  dashboard_password
  ...
```

When you switch environments:
1. Run `./scripts/generate-secrets.sh` to generate new secrets, OR
2. Manually update secret files with environment-appropriate values

Secrets are never committed to version control (enforced by `.gitignore`).

**Production secrets** should be:
- Generated with strong randomness (`openssl rand -hex 32`)
- Rotated on a regular schedule
- Never reused across environments

## How Modules Inherit the Environment

When you enable a module via `./launch_docker_lab_core.sh module enable <name>`, the foundation's `DOMAIN` is automatically propagated to the module's `.env` file. This means:

- Switching to `staging` sets `DOMAIN=staging.peers.social` in `.env`
- Enabling a module after the switch propagates `staging.peers.social` to the module
- Traefik router rules using `Host(\`subdomain.${DOMAIN}\`)` automatically resolve to the correct domain

Modules do not need separate environment awareness — they inherit it from the foundation's `.env`.

## Workflow: Development to Production

```
1. Local Development
   ./launch_docker_lab_core.sh env local
   # Build, test, iterate
   # Validate: docker compose config --quiet

2. Deploy to Staging
   ./launch_docker_lab_core.sh env staging
   # Set secrets, deploy to staging VPS
   # Run health checks, smoke tests

3. Promote to Production
   ./launch_docker_lab_core.sh env production
   # Set production secrets
   # Deploy to production VPS
   # Verify health, monitor
```

## Adding Custom Environments

Create a new `.env.<name>.example` file in the project root:

```bash
cp .env.staging.example .env.myenv.example
# Edit .env.myenv.example with your values
```

The `env` command auto-discovers any `.env.*.example` file, so custom environments work immediately:

```bash
./launch_docker_lab_core.sh env myenv
```
