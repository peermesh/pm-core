# ADR-0301: Deployment Scripts

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

Deploying the Docker stack requires several preparatory steps:

1. Creating the secrets directory with correct permissions
2. Generating cryptographically secure secrets
3. Creating data directories with correct ownership
4. Validating configuration before starting
5. Understanding the deployment sequence

These steps must be:

- Idempotent (safe to run multiple times)
- Platform-compatible (Linux VPS, macOS development)
- Documented for users who want to understand them
- Automatable for CI/CD pipelines

---

## Decision

**We will provide a set of deployment scripts** in the `scripts/` directory:

| Script | Purpose |
|--------|---------|
| `generate-secrets.sh` | Create cryptographic secrets for all services |
| `init-volumes.sh` | Create data directories with correct ownership |
| `deploy.sh` | Orchestrate full deployment sequence |
| `validate.sh` | Check configuration before deployment |

Scripts are bash-based, POSIX-compatible where possible, and use `set -euo pipefail` for safety.

---

## Alternatives Considered

### Option A: Makefile Only

**Description**: Use Makefile targets for all operations.

**Pros**:
- Single entry point
- Familiar to developers
- Good for simple commands

**Cons**:
- Complex logic difficult in make
- Error handling limited
- Not all environments have make

**Why not chosen**: Complex bootstrapping logic (permission checks, conditional creation) is clearer in bash. We provide Makefile as a convenience wrapper around scripts.

### Option B: Docker-Based Initialization

**Description**: Run initialization in a container that mounts host directories.

**Pros**:
- Consistent environment
- No host dependencies beyond Docker

**Cons**:
- Permission model complex with volume mounts
- Container must run as root to chown directories
- Adds complexity for simple file operations

**Why not chosen**: Host-level scripts are simpler for file/directory operations. Docker adds unnecessary complexity for permission management.

### Option C: No Scripts - Documentation Only

**Description**: Document all commands, users run manually.

**Pros**:
- Maximum transparency
- Users understand every step

**Cons**:
- Error-prone manual execution
- Long sequences hard to remember
- No idempotency guarantees

**Why not chosen**: Users would make mistakes. Scripts encode best practices and ensure idempotency.

---

## Consequences

### Positive

- One command deployment after initial configuration
- Idempotent scripts safe to run multiple times
- Clear separation of concerns (secrets vs volumes vs deployment)
- Scripts serve as executable documentation

### Negative

- Users must have bash available
- Scripts need maintenance as configuration evolves
- Additional files in repository

### Neutral

- Makefile provides convenience layer for common operations

---

## Implementation Notes

### generate-secrets.sh

```bash
#!/bin/bash
set -euo pipefail

SECRETS_DIR="./secrets"

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

generate_secret() {
    local name=$1
    local file="$SECRETS_DIR/$name"

    if [ -f "$file" ]; then
        echo "  [EXISTS] $name"
        return 0
    fi

    openssl rand -hex 32 > "$file"
    chmod 600 "$file"
    echo "  [CREATED] $name"
}

echo "=== Generating Secrets ==="
generate_secret "postgres_password"
generate_secret "mysql_root_password"
generate_secret "mongodb_root_password"
# ... additional secrets
echo "=== Complete ==="
```

### init-volumes.sh

```bash
#!/bin/bash
set -euo pipefail

# Create directories with correct ownership for containers
# Run with sudo if needed for chown

create_volume() {
    local path=$1
    local uid=$2
    local gid=$3

    mkdir -p "$path"
    chown "$uid:$gid" "$path"
    echo "  [OK] $path ($uid:$gid)"
}

echo "=== Initializing Volumes ==="
create_volume "./data/postgres" 999 999
create_volume "./data/ghost" 1000 1000
create_volume "./data/traefik" 65534 65534
echo "=== Complete ==="
```

### deploy.sh

```bash
#!/bin/bash
set -euo pipefail

echo "=== Peer Mesh Docker Lab Deployment ==="

# Step 1: Validate configuration
echo "Step 1: Validating configuration..."
./scripts/validate.sh

# Step 2: Generate secrets if missing
echo "Step 2: Checking secrets..."
./scripts/generate-secrets.sh

# Step 3: Initialize volumes
echo "Step 3: Initializing volumes..."
./scripts/init-volumes.sh

# Step 4: Pull images
echo "Step 4: Pulling images..."
docker compose pull --ignore-buildable

# Step 5: Start services
echo "Step 5: Starting services..."
docker compose up -d

# Step 6: Wait for health
echo "Step 6: Waiting for services to be healthy..."
sleep 10
docker compose ps

echo "=== Deployment Complete ==="
```

### validate.sh

```bash
#!/bin/bash
set -euo pipefail

echo "=== Validating Configuration ==="

# Check .env exists
if [ ! -f .env ]; then
    echo "ERROR: .env file not found. Copy from .env.example"
    exit 1
fi

# Check required variables
for var in DOMAIN ADMIN_EMAIL; do
    if ! grep -q "^${var}=" .env; then
        echo "ERROR: $var not set in .env"
        exit 1
    fi
done

# Validate compose syntax
if ! docker compose config --quiet 2>/dev/null; then
    echo "ERROR: Compose file has syntax errors"
    docker compose config
    exit 1
fi

echo "=== Validation Passed ==="
```

### Makefile Integration

```makefile
.PHONY: secrets init deploy validate up down logs

secrets:
	./scripts/generate-secrets.sh

init:
	./scripts/init-volumes.sh

validate:
	./scripts/validate.sh

deploy:
	./scripts/deploy.sh

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f
```

### Usage

```bash
# Full deployment (first time)
make deploy

# Or step by step
make secrets
make init
make up

# Quick restart
make down
make up

# View logs
make logs
```

---

## References

### Documentation

- [Bash Best Practices](https://google.github.io/styleguide/shellguide.html) - Google Shell Style Guide

### Related ADRs

- [ADR-0003: File-Based Secrets](./0003-file-based-secrets.md) - Secret generation approach

### Internal Reference

- D13-CORE-DEPLOYMENT.md - Deployment architecture
- D15-RELEASE-STRUCTURE.md - Script organization

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |
