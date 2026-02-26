# Volume Management Patterns

## The Problem

Failed deployments can corrupt Docker volumes, leaving directories where files should exist. Subsequent deployments fail with cryptic errors.

This was discovered during Element/Matrix (Synapse) deployment when previous failed attempts left directories named `homeserver.yaml` and `log.config` in the volume instead of the expected configuration files.

## How to Identify

Error messages indicating volume corruption:

```
error mounting ".../homeserver.yaml" to rootfs at "/data/homeserver.yaml":
Are you trying to mount a directory onto a file (or vice-versa)?
```

Other symptoms:
- "Is a directory" when expecting a file
- Config file appears empty or missing
- Container fails to start with mount errors
- Permission denied on volume paths

## Prevention

Before deployment, verify volume state:

```bash
# Check for directory-instead-of-file corruption
check_volume_corruption() {
  local volume_name=$1
  shift
  local expected_files=("$@")

  local volume_path
  volume_path=$(docker volume inspect "$volume_name" --format '{{ .Mountpoint }}' 2>/dev/null)

  if [ -z "$volume_path" ]; then
    echo "[SKIP] Volume $volume_name does not exist yet"
    return 0
  fi

  local has_corruption=0
  for file in "${expected_files[@]}"; do
    local path="$volume_path/$file"
    if [ -d "$path" ]; then
      echo "ERROR: $path is a directory, should be a file"
      has_corruption=1
    fi
  done

  return $has_corruption
}

# Example usage for Synapse
check_volume_corruption "pmdl_synapse_data" "homeserver.yaml" "log.config" "signing.key"
```

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| Config file is directory | Failed init created dirs | `rm -rf <path>`, reinit |
| Permission denied | Wrong owner | `chown` to container user |
| Volume empty | Not initialized | Run init script |
| Mount path mismatch | Wrong volume in compose | Fix compose volume paths |
| Stale config | Old config persists | Remove volume, recreate |

## Correct Patterns

### Pre-deployment Check

Add this to deployment scripts before `docker compose up`:

```bash
#!/bin/bash
# pre-deploy-check.sh

set -euo pipefail

# Define expected file paths (not directories)
EXPECTED_FILES=(
  "homeserver.yaml"
  "log.config"
  "signing.key"
)

VOLUME_NAME="pmdl_synapse_data"

volume_path=$(docker volume inspect "$VOLUME_NAME" --format '{{ .Mountpoint }}' 2>/dev/null) || {
  echo "[INFO] Volume $VOLUME_NAME not created yet - will be initialized on first deploy"
  exit 0
}

echo "Checking volume integrity: $VOLUME_NAME"

for file in "${EXPECTED_FILES[@]}"; do
  path="$volume_path/$file"
  if [ -d "$path" ]; then
    echo "[ERROR] Corruption detected: $path is a directory, should be a file"
    echo "[FIX] Run: sudo rm -rf '$path'"
    exit 1
  elif [ -f "$path" ]; then
    echo "[OK] $file exists as file"
  else
    echo "[INFO] $file not yet created"
  fi
done

echo "Volume integrity check passed"
```

### Volume Initialization

Use the project's `scripts/init-volumes.sh` pattern for ownership:

```bash
#!/bin/bash
# scripts/init-volumes.sh

set -euo pipefail

# Volume ownership requirements
# Format: volume_name uid:gid
declare -A VOLUME_OWNERS=(
    ["pmdl_synapse_data"]="991:991"
    ["pmdl_peertube_data"]="1000:1000"
    ["pmdl_peertube_config"]="1000:1000"
    ["pmdl_redis_data"]="999:999"
)

init_volume() {
    local volume=$1
    local owner=$2

    # Check if volume exists
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
        echo "[SKIP] $volume - not created yet"
        return 0
    fi

    local volume_path
    volume_path=$(docker volume inspect "$volume" --format '{{ .Mountpoint }}')

    # Get current owner
    local current_owner
    current_owner=$(stat -c '%u:%g' "$volume_path" 2>/dev/null || \
                    stat -f '%u:%g' "$volume_path" 2>/dev/null)

    if [ "$current_owner" = "$owner" ]; then
        echo "[OK] $volume ($owner)"
        return 0
    fi

    # Fix ownership
    echo "[FIX] $volume: $current_owner -> $owner"
    sudo chown -R "$owner" "$volume_path"
}

for volume in "${!VOLUME_OWNERS[@]}"; do
    init_volume "$volume" "${VOLUME_OWNERS[$volume]}"
done
```

### Recovery Steps

When volume corruption is detected:

```bash
# 1. Stop all containers using the volume
docker compose down

# 2. Identify corrupted paths
VOLUME_PATH=$(docker volume inspect pmdl_synapse_data --format '{{ .Mountpoint }}')
ls -la "$VOLUME_PATH"

# 3. Remove corrupted directories (where files should be)
sudo rm -rf "$VOLUME_PATH/homeserver.yaml"   # Was directory, should be file
sudo rm -rf "$VOLUME_PATH/log.config"        # Was directory, should be file

# 4. Verify cleanup
ls -la "$VOLUME_PATH"

# 5. Redeploy (config files will be mounted/copied)
docker compose up -d

# 6. Verify container starts
docker compose logs -f synapse
```

### Complete Cleanup (Nuclear Option)

When recovery fails, remove and recreate the volume:

```bash
# WARNING: This destroys all data in the volume

# 1. Stop containers
docker compose down

# 2. Remove the volume
docker volume rm pmdl_synapse_data

# 3. Recreate and deploy
docker compose up -d

# 4. Run initialization
./scripts/init-volumes.sh
```

## Non-Root Containers

Many applications run as non-root users. Volume permissions must match:

| Application | Container UID | Volume Permission |
|-------------|---------------|-------------------|
| Synapse     | 991           | `991:991` |
| PeerTube    | 1000          | `1000:1000` |
| Redis       | 999           | `999:999` |
| PostgreSQL  | 999           | `999:999` |
| MongoDB     | 999           | `999:999` |

Fix permissions for non-root containers:

```bash
# Fix permissions for Synapse (UID 991)
sudo chown -R 991:991 /var/lib/docker/volumes/pmdl_synapse_data/_data/

# Fix permissions for PeerTube (UID 1000)
sudo chown -R 1000:1000 /var/lib/docker/volumes/pmdl_peertube_data/_data/

# Generic pattern
fix_volume_permissions() {
  local volume=$1
  local uid=$2
  local gid=${3:-$uid}

  local path
  path=$(docker volume inspect "$volume" --format '{{ .Mountpoint }}')

  if [ -d "$path" ]; then
    sudo chown -R "$uid:$gid" "$path"
    echo "Fixed: $volume -> $uid:$gid"
  else
    echo "Warning: Volume path not found: $path"
  fi
}
```

## Test Commands

Verify volumes are correctly initialized:

```bash
# 1. List all project volumes
docker volume ls | grep pmdl

# 2. Check volume contents
docker volume inspect pmdl_synapse_data --format '{{ .Mountpoint }}' | xargs ls -la

# 3. Verify file vs directory
docker run --rm -v pmdl_synapse_data:/data alpine sh -c '
  for f in homeserver.yaml log.config; do
    if [ -d "/data/$f" ]; then
      echo "ERROR: /data/$f is directory"
    elif [ -f "/data/$f" ]; then
      echo "OK: /data/$f is file"
    else
      echo "MISSING: /data/$f"
    fi
  done
'

# 4. Check ownership
docker run --rm -v pmdl_synapse_data:/data alpine stat -c '%u:%g %n' /data/*

# 5. Validate container can read config
docker compose exec synapse cat /data/homeserver.yaml | head -5
```

## Automation

Add volume checks to deployment workflow:

```bash
# deploy.sh

#!/bin/bash
set -euo pipefail

echo "=== Pre-deployment Volume Check ==="
./scripts/check-volumes.sh || {
  echo "Volume issues detected. Fix before deploying."
  exit 1
}

echo "=== Starting Deployment ==="
docker compose up -d

echo "=== Post-deployment Volume Init ==="
./scripts/init-volumes.sh

echo "=== Deployment Complete ==="
```

## References

- Research: `../../.dev/ai/research/2026-01-03-universal-patterns-from-app-testing.md`
- Element handoff: `../../.dev/ai/handoffs/2026-01-01-18-03-58Z-handoff-element-deployment-blocked.md`
- Init script: `scripts/init-volumes.sh`
