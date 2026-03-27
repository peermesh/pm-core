# PeerMesh Social

Social identity and profile backbone module for the PeerMesh ecosystem. Provides profile creation,
lifecycle management, federated protocol participation (ActivityPub, Solid), and omni-account
generation as a composable Core module.

## Overview

Social runs as a Node.js application inside Core's module system. It connects to the
foundation PostgreSQL instance for persistent storage and routes HTTPS traffic through Traefik.

Key capabilities (phased rollout):
- **Phase 1**: Module scaffold, health endpoint, database schema, deployment pipeline
- **Phase 2**: Profile CRUD API, Solid Pod sync, social graph
- **Phase 3**: ActivityPub federation, WebFinger discovery

## Requirements

### Foundation Version
- Minimum: 1.0.0

### Dependencies
- **PostgreSQL** (required) -- via foundation `postgresql` profile on `pmdl_db-internal` network
- **Redis** (optional) -- via foundation `redis` profile, for caching in later phases
- **Traefik** -- foundation reverse proxy on `pmdl_proxy-external` network

## Installation

From the Core root directory:

```bash
# 1. Create .env from template
cd modules/social
cp .env.example .env

# 2. Create the database secret
mkdir -p secrets
openssl rand -base64 32 > secrets/social_lab_db_password
chmod 600 secrets/social_lab_db_password

# 3. Enable the module (runs install + start hooks)
cd ../..
./launch_docker_lab_core.sh module enable social
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DOMAIN` | Root domain for Traefik routing | required |
| `SOCIAL_LAB_SUBDOMAIN` | Subdomain prefix (empty for root-domain deployment) | `` (empty) |
| `SOCIAL_LAB_PORT` | HTTP port inside container | `3000` |
| `SOCIAL_LAB_DB_HOST` | PostgreSQL hostname | `postgres` |
| `SOCIAL_LAB_DB_PORT` | PostgreSQL port | `5432` |
| `SOCIAL_LAB_DB_NAME` | Database name | `social_lab` |
| `SOCIAL_LAB_DB_USER` | Database user | `social_lab` |
| `NODE_ENV` | Node.js environment | `production` |

### Secrets

Database password is stored as a file-based secret at `secrets/social_lab_db_password`.
See `secrets-required.txt` for creation instructions.

## Usage

### Health Check

```bash
# Via hook
./hooks/health.sh

# Via HTTP (once deployed)
curl https://peers.social/health
```

### Lifecycle Hooks

```bash
./hooks/install.sh    # Validate environment, create DB, run migrations
./hooks/start.sh      # Start the container
./hooks/stop.sh       # Stop the container
./hooks/health.sh     # Check module health
./hooks/uninstall.sh  # Remove module resources
```

### Events

This module emits the following events (implementation pending event bus):

| Event | Description |
|-------|-------------|
| `social.profile.created` | New profile registered |
| `social.profile.updated` | Profile data changed |
| `social.profile.deleted` | Profile removed |
| `social.follow.created` | New follow relationship |
| `social.follow.removed` | Follow relationship removed |
| `social.federation.synced` | Federation data synchronized |
| `social.migration.started` | Database migration began |
| `social.migration.completed` | Database migration finished |

## Project Structure

```
social/
├── module.json           # Module manifest
├── docker-compose.yml    # Service definitions
├── .env.example          # Environment variable template
├── secrets-required.txt  # Required secret files list
├── hooks/
│   ├── install.sh        # Installation and migration
│   ├── start.sh          # Service startup
│   ├── stop.sh           # Graceful shutdown
│   ├── health.sh         # Health check
│   └── uninstall.sh      # Cleanup
├── secrets/
│   └── .gitkeep          # Placeholder (secrets never committed)
└── README.md             # This file
```

## Troubleshooting

**Traefik returns 404**: Verify `DOMAIN` and `SOCIAL_LAB_SUBDOMAIN` are set correctly in `.env`.
Restart Traefik after changes.

**Database connection fails**: Confirm the foundation PostgreSQL profile is running and the
`pmdl_db-internal` network exists. Check that `SOCIAL_LAB_DB_HOST` matches the PostgreSQL
container name.

**Container fails to start**: Check `docker compose logs social-app` for errors. Ensure
secrets files exist and have correct permissions.

## License

MIT License -- see LICENSE file for details.
