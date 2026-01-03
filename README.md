# Peer Mesh Docker Lab

A production-ready Docker Compose template for deploying web applications with reverse proxy, databases, caching, and automated backups. Clone it, configure it, deploy it.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/peer-mesh-docker-lab.git
cd peer-mesh-docker-lab

# Copy environment template
cp .env.example .env

# Generate secrets
./scripts/generate-secrets.sh

# Start services
docker compose up -d

# Verify
docker compose ps
```

Your services are now running with Traefik reverse proxy at ports 80/443.

## What's Included

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
- [Configuration Reference](docs/CONFIGURATION.md) - Environment variables and options
- [Profiles Guide](docs/PROFILES.md) - Choosing and customizing profiles
- [Security Guide](docs/SECURITY.md) - Security architecture and hardening
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions

## Requirements

- Docker Engine 24.0+
- Docker Compose 2.20+
- 2GB RAM minimum (4GB+ recommended)
- Linux, macOS, or Windows with WSL2

## License

MIT License - Use it for anything.

## Contributing

See `.dev/` directory for development documentation and contribution guidelines.
