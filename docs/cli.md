# PeerMeshCore CLI

The `launch_docker_lab_core.sh` script is the unified command-line interface for managing PeerMeshCore deployments.

## Installation

The CLI is included in the repository. No additional installation required.

```bash
# Make executable (if needed)
chmod +x launch_docker_lab_core.sh

# Verify
./launch_docker_lab_core.sh --version
```

### Shell Completions

For tab completion support, install the completion scripts:

**Bash:**
```bash
source scripts/completions/launch_docker_lab_core.bash
# Or add to ~/.bashrc for persistent completion
```

**Zsh:**
```zsh
fpath=(scripts/completions $fpath)
autoload -Uz compinit && compinit
```

See [scripts/completions/README.md](../scripts/completions/README.md) for detailed installation options.

## Usage

### Interactive Mode

Run without arguments to launch the interactive menu:

```bash
./launch_docker_lab_core.sh
```

This presents a menu-driven interface for all operations.

### Command Mode

Run with commands for direct execution:

```bash
./launch_docker_lab_core.sh [command] [options]
```

## Commands

### status

Show current deployment status including environment, Docker, services, networks, and volumes.

```bash
./launch_docker_lab_core.sh status
```

### up

Start services with optional profiles.

```bash
# Start with default profiles
./launch_docker_lab_core.sh up

# Start with specific profiles
./launch_docker_lab_core.sh up --profile=postgresql,redis

# Start with build
./launch_docker_lab_core.sh up --profile=postgresql --build

# Wait for healthy state
./launch_docker_lab_core.sh up --wait

# Include additional compose file
./launch_docker_lab_core.sh up -f docker-compose.webhook.yml
```

**Options:**
| Option | Description |
|--------|-------------|
| `--profile=NAME` | Enable profiles (comma-separated) |
| `-p NAME` | Short form for --profile |
| `--build` | Build images before starting |
| `--wait` | Wait for services to be healthy |
| `--no-detach` | Run in foreground |
| `-f FILE` | Include additional compose file |

### down

Stop services.

```bash
# Stop services
./launch_docker_lab_core.sh down

# Stop and remove volumes
./launch_docker_lab_core.sh down --volumes

# Custom timeout
./launch_docker_lab_core.sh down --timeout=30
```

**Options:**
| Option | Description |
|--------|-------------|
| `-v, --volumes` | Remove volumes |
| `--timeout=N` | Timeout in seconds (default: 10) |
| `--keep-orphans` | Keep orphan containers |

### deploy

Deploy to a target environment.

```bash
# Deploy locally (default)
./launch_docker_lab_core.sh deploy

# Deploy to staging
./launch_docker_lab_core.sh deploy --target=staging

# Deploy to production
./launch_docker_lab_core.sh deploy --target=production

# Skip pre-deployment backup
./launch_docker_lab_core.sh deploy --target=prod --skip-backup
```

**Options:**
| Option | Description |
|--------|-------------|
| `--target=TARGET` | Target: local, staging, prod |
| `-t TARGET` | Short form for --target |
| `--skip-backup` | Skip pre-deployment backup |
| `--profile=NAME` | Override target profiles |

**Targets:**
- `local` - Local development (runs docker compose directly)
- `staging` - Staging environment (webhook deployment)
- `production/prod` - Production environment (webhook deployment)

### sync

Trigger synchronization on a remote target.

```bash
# Sync using configured target
./launch_docker_lab_core.sh sync --target=staging

# Direct webhook call
./launch_docker_lab_core.sh sync --url=https://webhook.example.com/hooks/deploy --secret=TOKEN
```

**Options:**
| Option | Description |
|--------|-------------|
| `--target=TARGET` | Target name from config |
| `-t TARGET` | Short form for --target |
| `--url=URL` | Direct webhook URL |
| `--secret=TOKEN` | Webhook authentication token |

### logs

View service logs.

```bash
# All services
./launch_docker_lab_core.sh logs

# Specific service
./launch_docker_lab_core.sh logs traefik

# Follow logs
./launch_docker_lab_core.sh logs traefik -f

# Last 50 lines with timestamps
./launch_docker_lab_core.sh logs traefik -n 50 -t
```

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --follow` | Follow log output |
| `-n, --tail N` | Number of lines (default: 100) |
| `-t, --timestamps` | Show timestamps |

### health

Run health checks on services.

```bash
# Basic health check
./launch_docker_lab_core.sh health

# Verbose with endpoint checks
./launch_docker_lab_core.sh health -v

# Check specific service
./launch_docker_lab_core.sh health postgres
```

**Options:**
| Option | Description |
|--------|-------------|
| `-v, --verbose` | Show detailed endpoint checks |

### backup

Manage backups.

```bash
# Run backup
./launch_docker_lab_core.sh backup run

# Backup PostgreSQL only
./launch_docker_lab_core.sh backup run --target=postgres

# Backup volumes only
./launch_docker_lab_core.sh backup run --target=volumes

# Show backup status
./launch_docker_lab_core.sh backup status

# List available backups
./launch_docker_lab_core.sh backup list
```

**Actions:**
| Action | Description |
|--------|-------------|
| `run` | Run backup now |
| `status` | Show backup status |
| `list` | List available backups |
| `restore` | Instructions for restore |

**Options:**
| Option | Description |
|--------|-------------|
| `--target=TYPE` | postgres, volumes, or all |

### module

Manage modules. For the full module architecture (what modules are, how they integrate with the foundation, manifest specification, lifecycle hooks), see [MODULE-ARCHITECTURE.md](MODULE-ARCHITECTURE.md).

```bash
# List modules
./launch_docker_lab_core.sh module list

# Enable a module
./launch_docker_lab_core.sh module enable backup

# Disable a module
./launch_docker_lab_core.sh module disable backup

# Show module status
./launch_docker_lab_core.sh module status backup

# Validate module structure and manifest
./launch_docker_lab_core.sh module validate backup

# Emit contract compliance report block (machine-readable TSV)
./launch_docker_lab_core.sh module validate --contract

# Emit contract compliance report block (machine-readable JSON)
./launch_docker_lab_core.sh module validate --contract-json
```

**Actions:**
| Action | Description |
|--------|-------------|
| `list` | List available modules |
| `enable NAME` | Enable a module |
| `disable NAME` | Disable a module |
| `status NAME` | Show module status |
| `health [NAME]` | Run module health checks |
| `validate [NAME] [--contract|--contract-json]` | Validate modules and optionally emit contract report |
| `create NAME` | Scaffold a new module |
| `update NAME` | Update a running module |

### config

Manage configuration.

```bash
# Show configuration
./launch_docker_lab_core.sh config show

# Initialize configuration
./launch_docker_lab_core.sh config init

# Validate configuration
./launch_docker_lab_core.sh config validate

# Edit configuration
./launch_docker_lab_core.sh config edit
./launch_docker_lab_core.sh config edit config/targets.yml
```

**Actions:**
| Action | Description |
|--------|-------------|
| `show` | Show current configuration |
| `init` | Initialize configuration files |
| `validate` | Validate configuration |
| `edit [FILE]` | Edit configuration file |

## Configuration Files

The CLI reads configuration from these locations (in order of precedence):

1. `.peermesh.yml` - Project root (preferred)
2. `config/targets.yml` - Project config directory
3. `~/.config/peermesh/targets.yml` - User config directory

### .peermesh.yml

Main project configuration file. Copy from example:

```bash
cp .peermesh.yml.example .peermesh.yml
```

See [.peermesh.yml.example](../.peermesh.yml.example) for all options.

### config/targets.yml

Deployment target configuration. Copy from example:

```bash
cp config/targets.yml.example config/targets.yml
```

See [config/targets.yml.example](../config/targets.yml.example) for all options.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DOMAIN` | Primary domain for services |
| `COMPOSE_PROFILES` | Active profiles (comma-separated) |
| `ADMIN_EMAIL` | Admin email for Let's Encrypt |
| `DEBUG=true` | Enable debug output |

## Examples

### Development Workflow

```bash
# Initialize new deployment
./launch_docker_lab_core.sh config init
./launch_docker_lab_core.sh config validate

# Start with dev profile
./launch_docker_lab_core.sh up --profile=postgresql,redis,dev

# Check health
./launch_docker_lab_core.sh health -v

# View logs
./launch_docker_lab_core.sh logs -f

# Stop when done
./launch_docker_lab_core.sh down
```

### Production Deployment

```bash
# Configure target
vim config/targets.yml

# Deploy to staging first
./launch_docker_lab_core.sh deploy --target=staging

# Check staging health
./launch_docker_lab_core.sh health -v

# Deploy to production
./launch_docker_lab_core.sh deploy --target=production

# Monitor logs
./launch_docker_lab_core.sh logs traefik -f
```

### Backup Operations

```bash
# Enable backup module
./launch_docker_lab_core.sh module enable backup

# Run manual backup
./launch_docker_lab_core.sh backup run

# Check backup status
./launch_docker_lab_core.sh backup status

# List backups
./launch_docker_lab_core.sh backup list
```

## Troubleshooting

### Prerequisites Check Failed

Ensure Docker and Docker Compose v2 are installed:

```bash
docker --version
docker compose version
```

### Configuration Validation Failed

Run validation to see specific errors:

```bash
./launch_docker_lab_core.sh config validate
```

Common issues:
- DOMAIN still set to `example.com`
- Missing secrets directory
- Invalid compose file syntax

### Webhook Deployment Failed

Check webhook configuration:

```bash
# Test webhook manually
curl -X POST https://webhook.example.com/hooks/deploy \
     -H "X-Webhook-Token: YOUR_SECRET"
```

### Services Not Starting

Check service logs:

```bash
./launch_docker_lab_core.sh logs <service> -n 200
```

Check Docker daemon:

```bash
docker info
```

## See Also

- [Quick Start Guide](QUICKSTART.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Configuration Reference](CONFIGURATION.md)
- [Troubleshooting](TROUBLESHOOTING.md)
