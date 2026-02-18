# Docker Lab

Production-ready Docker Compose boilerplate for self-hosted applications. Clone it, configure it, deploy it.

## What This Repository Is

**A production-grade Docker infrastructure foundation.** This repository provides:

- Battle-tested Docker Compose configurations for common deployment patterns
- Traefik reverse proxy with automatic TLS certificate management
- Docker secrets-based credential management
- Resource-based profiles (lite/core/full) for different deployment targets
- Database profiles (PostgreSQL, MySQL, MongoDB, Redis) as composable modules
- Healthcheck-based startup ordering for reliable deployments
- Network isolation patterns for security

This is infrastructure boilerplate - a starting point you clone and customize for your specific application needs.

## What This Repository Is NOT

- **Not app-specific automation** - You bring your own application containers
- **Not magic** - You still need to understand Docker, networking, and your application requirements
- **Not a one-size-fits-all solution** - Some configurations will need adjustment for your use case
- **Not a managed service** - You are responsible for updates, backups, and monitoring

## Quick Start

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

Your services are now running with Traefik reverse proxy at ports 80/443.

## Unified CLI

The `launch_peermesh.sh` script provides a single entry point for all deployment operations:

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

See `examples/` for complete configurations.

## Documentation

- [Quick Start Guide](docs/QUICKSTART.md) - Get running in 5 minutes
- [System Architecture](docs/ARCHITECTURE.md) - Four-tier modular architecture overview
- [Configuration Reference](docs/CONFIGURATION.md) - Environment variables and options
- [Profiles Guide](docs/PROFILES.md) - Choosing and customizing profiles
- [Security Guide](docs/SECURITY.md) - Security architecture and hardening
- [Secrets Management](docs/SECRETS-MANAGEMENT.md) - Docker secrets patterns
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment guidance
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions
- [Gotchas](docs/GOTCHAS.md) - High-friction deployment pitfalls and fixes
- [Secrets Per App](docs/SECRETS-PER-APP.md) - Required keys per example app
- [Multi-Domain Pattern](docs/MULTI-DOMAIN.md) - Domain override strategy and usage
- [Public Repo Manifest](docs/PUBLIC-REPO-MANIFEST.md) - Public/private file boundaries
- [Architecture Decisions](docs/decisions/) - ADR documentation
- [Foundation Reference](foundation/README.md) - Module system documentation

## Requirements

- Docker Engine 24.0+
- Docker Compose 2.20+
- 2GB RAM minimum (4GB+ recommended)
- Linux, macOS, or Windows with WSL2

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, validation commands, and secrets safety requirements.

## License

MIT License - Use it for anything.
