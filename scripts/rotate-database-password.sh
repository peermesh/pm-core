#!/usr/bin/env bash
# ==============================================================
# Database Password Rotation
# ==============================================================
# Rotates the root/admin password for a specified database engine.
# Supports PostgreSQL, MySQL, and MongoDB. Archives old password,
# updates the running database, and restarts dependent services.
#
# WARNING: This causes brief service downtime during restart.
#
# Usage:
#   ./scripts/rotate-database-password.sh postgres
#   ./scripts/rotate-database-password.sh mysql
#   ./scripts/rotate-database-password.sh mongodb
#   ./scripts/rotate-database-password.sh --dry-run postgres
#   ./scripts/rotate-database-password.sh --help
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SECRETS_DIR="${SECRETS_DIR:-$PROJECT_ROOT/secrets}"

DRY_RUN=false
DB_ENGINE=""
DATE_STAMP="$(date -u +"%Y%m%d")"

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS] <postgres|mysql|mongodb>

Rotate the root/admin password for a database engine.

Arguments:
  postgres    Rotate PostgreSQL password (container: pmdl_postgres)
  mysql       Rotate MySQL root password (container: pmdl_mysql)
  mongodb     Rotate MongoDB admin password (container: pmdl_mongodb)

Options:
  --dry-run     Show what would happen without making changes
  --help, -h    Show this help

Examples:
  $0 postgres              # Rotate PostgreSQL password
  $0 --dry-run mysql       # Preview MySQL rotation without changes
  $0 mongodb               # Rotate MongoDB password
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        -*)
            echo "[ERROR] Unknown option: $1"
            usage
            exit 1
            ;;
        *)
            if [[ -z "$DB_ENGINE" ]]; then
                DB_ENGINE="$1"
            else
                echo "[ERROR] Only one database engine argument is allowed"
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$DB_ENGINE" ]]; then
    echo "[ERROR] Database engine argument is required"
    usage
    exit 1
fi

# Map engine to container name, secret file, and update command
case "$DB_ENGINE" in
    postgres)
        CONTAINER_NAME="pmdl_postgres"
        SECRET_FILE="postgres_password"
        ;;
    mysql)
        CONTAINER_NAME="pmdl_mysql"
        SECRET_FILE="mysql_root_password"
        ;;
    mongodb)
        CONTAINER_NAME="pmdl_mongodb"
        SECRET_FILE="mongodb_root_password"
        ;;
    *)
        echo "[ERROR] Unsupported database engine: $DB_ENGINE"
        echo "Supported engines: postgres, mysql, mongodb"
        exit 1
        ;;
esac

if ! command -v openssl >/dev/null 2>&1; then
    echo "[ERROR] openssl is required"
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "[ERROR] docker is required"
    exit 1
fi

if [[ ! -d "$SECRETS_DIR" ]]; then
    echo "[ERROR] Secrets directory not found: $SECRETS_DIR"
    exit 1
fi

SECRET_PATH="$SECRETS_DIR/$SECRET_FILE"
if [[ ! -f "$SECRET_PATH" ]]; then
    echo "[ERROR] Secret file not found: $SECRET_PATH"
    exit 1
fi

echo ""
echo "=== Database Password Rotation: $DB_ENGINE ==="
echo ""

if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY RUN] No changes will be made."
    echo ""
    echo "[DRY RUN] Would warn about brief downtime and prompt for confirmation."
    echo "[DRY RUN] Would run pre-rotation backup: ./scripts/backup-predeploy.sh"
    echo "[DRY RUN] Would read old password from: $SECRET_PATH"
    echo "[DRY RUN] Would generate new password: openssl rand -hex 24 (48 hex chars)"
    echo "[DRY RUN] Would update password in running $DB_ENGINE container ($CONTAINER_NAME)"
    echo "[DRY RUN] Would archive old password to: secrets.archive/$DATE_STAMP/$SECRET_FILE"
    echo "[DRY RUN] Would write new password to: $SECRET_PATH (chmod 600)"
    echo "[DRY RUN] Would restart dependent services: docker compose restart"
    echo ""
    echo "No changes were made."
    exit 0
fi

# --- Step 1: Interactive confirmation ---

echo "WARNING: This will cause brief downtime."
printf "Continue? (yes/no): "
read -r CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted."
    exit 0
fi

echo ""

# --- Step 2: Pre-rotation backup ---

BACKUP_SCRIPT="$SCRIPT_DIR/backup-predeploy.sh"
if [[ -x "$BACKUP_SCRIPT" ]]; then
    echo "Running pre-rotation backup..."
    "$BACKUP_SCRIPT"
    echo ""
else
    echo "[WARN] backup-predeploy.sh not found or not executable, skipping pre-rotation backup."
fi

# --- Step 3: Read old password ---

OLD_PASSWORD="$(tr -d '\n' < "$SECRET_PATH")"

# --- Step 4: Generate new password ---

NEW_PASSWORD="$(openssl rand -hex 24)"

# --- Step 5: Update password in running database ---

echo "Updating password in $DB_ENGINE ($CONTAINER_NAME)..."

case "$DB_ENGINE" in
    postgres)
        docker exec "$CONTAINER_NAME" psql -U postgres -c \
            "ALTER USER postgres WITH PASSWORD '$NEW_PASSWORD';"
        ;;
    mysql)
        docker exec "$CONTAINER_NAME" mysql -u root -p"$OLD_PASSWORD" -e \
            "ALTER USER 'root'@'%' IDENTIFIED BY '$NEW_PASSWORD'; FLUSH PRIVILEGES;"
        ;;
    mongodb)
        docker exec "$CONTAINER_NAME" mongosh --quiet -u mongo -p "$OLD_PASSWORD" --authenticationDatabase admin --eval \
            "db.getSiblingDB('admin').changeUserPassword('mongo', '$NEW_PASSWORD')"
        ;;
esac

echo "[OK] Password updated in running database."
echo ""

# --- Step 6: Archive old password ---

ARCHIVE_DIR="$PROJECT_ROOT/secrets.archive/$DATE_STAMP"
mkdir -p "$ARCHIVE_DIR"
printf '%s' "$OLD_PASSWORD" > "$ARCHIVE_DIR/$SECRET_FILE"
chmod 600 "$ARCHIVE_DIR/$SECRET_FILE"
echo "[ARCHIVED] Old password -> $ARCHIVE_DIR/$SECRET_FILE"

# --- Step 7: Update secret file ---

NEW_FILE="${SECRET_PATH}.new"
printf '%s' "$NEW_PASSWORD" > "$NEW_FILE"
chmod 600 "$NEW_FILE"
mv "$NEW_FILE" "$SECRET_PATH"
chmod 600 "$SECRET_PATH"
echo "[ROTATED] $SECRET_FILE"
echo ""

# --- Step 8: Restart dependent services ---

echo "Restarting dependent services..."
cd "$PROJECT_ROOT"
docker compose restart
echo ""

echo "=== Rotation Complete ==="
echo "Old password archived: secrets.archive/$DATE_STAMP/$SECRET_FILE"
