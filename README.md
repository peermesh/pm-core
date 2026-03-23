# PeerMeshCore Docker Lab

PeerMeshCore's runtime foundation for self-hosted applications. Clone it, configure it, deploy it.

## What This Repository Is

**A production-grade PeerMeshCore runtime foundation.** This repository provides:

- Battle-tested Docker Compose configurations for common deployment patterns
- A foundation runtime stack (not a single app container) that other module containers layer onto
- Traefik reverse proxy with automatic TLS certificate management
- Docker secrets-based credential management
- Resource-based profiles (lite/core/full) for different deployment targets
- Database profiles (PostgreSQL, MySQL, MongoDB, Redis) as composable modules
- Healthcheck-based startup ordering for reliable deployments
- Network isolation patterns for security

This is infrastructure boilerplate for PeerMeshCore – clone it and layer your own modules on top.

## Public Boundary

This repository is the PeerMeshCore public boundary, exposed at https://github.com/peermesh/docker-lab. It hosts the public documentation, automation, and runtime assets, so follow the canonical quick-start guide in `docs/QUICKSTART.md` whenever you need public install or onboarding instructions.

## Canonical Deployment Model

PeerMeshCore Docker Lab uses a two-layer model:

1. OpenTofu provisions infrastructure through provider APIs (for example, Hetzner VPS + DNS prerequisites).
2. Docker Lab deploys and operates the runtime foundation and modules on that infrastructure.

This means:

1. OpenTofu is the infrastructure control plane.
2. Docker Lab is the runtime/container control plane.
3. Modules are layered onto the foundation after the base runtime is up.
4. OpenTofu providers are API connectors used during plan/apply, not always-on autoscaling agents.

See [OpenTofu Deployment Model](docs/OPENTOFU-DEPLOYMENT-MODEL.md) for the full walkthrough and options.
See [Enterprise Version Immutability Standard](docs/ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md) for dependency pinning and upgrade controls.

## Start Your Project

Docker Lab is designed to be forked. The recommended way to build on Docker Lab is the **fork + upstream remote** pattern: fork this repo into your own, add your modules, and periodically merge upstream improvements.

```bash
# Fork peermesh/docker-lab on GitHub, then:
git clone https://github.com/YOUR-ORG/your-project-deploy.git
cd your-project-deploy
git remote add upstream https://github.com/peermesh/docker-lab.git
cp .env.example .env && ./scripts/generate-secrets.sh
./launch_peermesh.sh module create my-app
```

See [Deployment Repo Pattern](docs/DEPLOYMENT-REPO-PATTERN.md) for the complete step-by-step guide, conflict avoidance rules, and a real-world example (peers.social).

## What This Repository Is NOT

- **Not app-specific automation** - You bring your own application containers
- **Not magic** - You still need to understand Docker, networking, and your application requirements
- **Not a one-size-fits-all solution** - Some configurations will need adjustment for your use case
- **Not a managed service** - You are responsible for updates, backups, and monitoring

## Quick Start

The canonical public install path is maintained in [docs/QUICKSTART.md](docs/QUICKSTART.md). That guide walks through cloning `https://github.com/peermesh/docker-lab.git`, configuring your `.env`, generating secrets, and starting the foundation services so you can treat it as the single source of truth for onboarding the `docker-lab` public repository.

```bash
# Clone the repository
git clone https://github.com/peermesh/docker-lab.git
cd docker-lab

# Initialize configuration
./launch_peermesh.sh config init

# Start services
./launch_peermesh.sh up --profile=postgresql,redis

# Check status
./launch_peermesh.sh status
```

Your PeerMeshCore runtime is now running with Traefik reverse proxy at ports 80/443.

## Unified CLI

The `launch_peermesh.sh` script is the PeerMeshCore CLI and provides a single entry point for all deployment operations:

```bash
# Interactive menu (run without arguments)
./launch_peermesh.sh

# Direct commands
./launch_peermesh.sh status              # Show deployment status
./launch_peermesh.sh up --profile=redis  # Start with specific profiles
./launch_peermesh.sh down                # Stop services
./launch_peermesh.sh logs traefik -f     # Follow service logs
./launch_peermesh.sh health -v           # Run health checks
./launch_peermesh.sh deploy --target=prod # Deploy to production
./launch_peermesh.sh backup run          # Run backup
./launch_peermesh.sh module list         # List available modules
./launch_peermesh.sh config validate     # Validate configuration

# Help
./launch_peermesh.sh --help
```

See [CLI Documentation](docs/cli.md) for complete usage.

## Features

- **Reverse Proxy** (Traefik) - Automatic HTTPS via Let's Encrypt, request routing
- **Authentication** (Authelia) - Single sign-on, 2FA support
- **Databases** - PostgreSQL, MySQL, MongoDB profiles ready to use
- **Caching** (Redis) - Session storage, application caching
- **Object Storage** (MinIO) - S3-compatible file storage
- **Automated Backups** - Scheduled database dumps with retention policies
- **Security Hardening** - Non-root containers, network isolation, secret management

## Profiles

Select the resource profile matching your deployment environment:

| Profile | RAM | CPU | Use Case |
|---------|-----|-----|----------|
| `lite` | 512MB | 0.5 | CI/CD, testing, development laptops |
| `core` | 2GB | 2 | Development servers, staging |
| `full` | 8GB | 4 | Production with monitoring stack |

Activate a profile:

```bash
docker compose --profile core up -d
```

## Supporting Tech Profiles

Add database and infrastructure services as needed:

| Profile | Purpose |
|---------|---------|
| `postgresql` | Relational database with pgvector support |
| `mysql` | Traditional web application database |
| `mongodb` | Document database for NoSQL workloads |
| `redis` | Caching, sessions, pub/sub |
| `minio` | S3-compatible object storage |

Include a profile:

```bash
docker compose -f docker-compose.yml \
               -f profiles/postgresql/docker-compose.postgresql.yml \
               up -d
```

## Example Applications

Ready-to-deploy application configurations:

| Application | Description | Profiles Used |
|-------------|-------------|---------------|
| Ghost | Publishing platform | MySQL |
| LibreChat | AI chat interface | MongoDB, PostgreSQL |
| Matrix | Federated messaging | PostgreSQL |
| WordPress | CMS/blog platform | MySQL |
| Python API (HTTPBin) | API workload baseline | Foundation |

See `examples/` for complete configurations.

## Documentation

- [Deployment Repo Pattern](docs/DEPLOYMENT-REPO-PATTERN.md) - Fork + upstream remote setup for your project
- [Quick Start Guide](docs/QUICKSTART.md) - Get running in 5 minutes
- [Public Quick Start Tutorial](docs/community/QUICK-START-TUTORIAL.md) - Public onboarding walkthrough
- [System Architecture](docs/ARCHITECTURE.md) - Four-tier modular architecture overview
- [Configuration Reference](docs/CONFIGURATION.md) - Environment variables and options
- [Profiles Guide](docs/PROFILES.md) - Choosing and customizing profiles
- [Security Guide](docs/SECURITY.md) - Security architecture and hardening
- [OpenBao No-TPM Fallback Strategy](docs/security/OPENBAO-NO-TPM-FALLBACK-STRATEGY.md) - Fail-closed fallback tiers for unseal workflows
- [Secrets Management](docs/SECRETS-MANAGEMENT.md) - Docker secrets patterns
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment guidance
- [Enterprise Version Immutability Standard](docs/ENTERPRISE-VERSION-IMMUTABILITY-STANDARD.md) - Mandatory version pinning and digest policy
- [Image Digest Baseline](docs/IMAGE-DIGEST-BASELINE.md) - Current locked image references
- [OpenTofu Deployment Model](docs/OPENTOFU-DEPLOYMENT-MODEL.md) - Infra via API + runtime on-host model
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions
- [Gotchas](docs/GOTCHAS.md) - High-friction deployment pitfalls and fixes
- [Secrets Per App](docs/SECRETS-PER-APP.md) - Required keys per example app
- [Multi-Domain Pattern](docs/MULTI-DOMAIN.md) - Domain override strategy and usage
- [Public Repo Manifest](docs/PUBLIC-REPO-MANIFEST.md) - Public/private file boundaries
- [Architecture Decisions](docs/decisions/) - ADR documentation
- [Foundation Reference](foundation/README.md) - Module system documentation
- [Launch Strategy](docs/community/LAUNCH-STRATEGY.md) - Public launch sequencing and channels
- [Community Engagement Plan](docs/community/COMMUNITY-ENGAGEMENT-PLAN.md) - SLA and triage model
- [Good First Issues Backlog](docs/community/GOOD-FIRST-ISSUES.md) - New-contributor task queue
- [Demo Materials](docs/community/DEMO-MATERIALS.md) - Screenshot + onboarding walkthrough set

## Requirements

- Docker Engine 24.0+
- Docker Compose 2.20+
- 2GB RAM minimum (4GB+ recommended)
- Linux, macOS, or Windows with WSL2

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, validation commands, and secrets safety requirements.

## License

MIT License - Use it for anything.
