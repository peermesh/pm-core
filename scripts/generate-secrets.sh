#!/bin/bash
# ==============================================================
# Secret Generation Script
# ==============================================================
# Generates cryptographically secure secrets for all services.
# Safe to run multiple times - only creates missing secrets.
#
# Usage:
#   ./scripts/generate-secrets.sh             # Generate missing secrets
#   ./scripts/generate-secrets.sh --validate  # Validate existing secrets
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

SECRETS_DIR="./secrets"
SECRET_LENGTH=32  # 32 bytes = 256 bits, hex encoded = 64 characters

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
VALIDATE_ONLY=false
if [ "${1:-}" = "--validate" ] || [ "${1:-}" = "-v" ]; then
    VALIDATE_ONLY=true
fi

# Create secrets directory if it doesn't exist
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

# Function to generate a secret if it doesn't exist
generate_secret() {
    local name=$1
    local min_length=${2:-32}
    local file="$SECRETS_DIR/$name"

    if [ -f "$file" ]; then
        # Validate existing secret
        local actual_length
        actual_length=$(wc -c < "$file" | tr -d ' ')

        if [ ! -s "$file" ]; then
            echo -e "  ${RED}[EMPTY]${NC} $name - regenerating"
            openssl rand -hex $SECRET_LENGTH > "$file"
            chmod 600 "$file"
            echo -e "  ${GREEN}[REGENERATED]${NC} $name"
        elif [ "$actual_length" -lt "$min_length" ]; then
            echo -e "  ${YELLOW}[WARN]${NC} $name exists but is short ($actual_length < $min_length chars)"
        else
            echo -e "  ${GREEN}[EXISTS]${NC} $name (${actual_length} chars)"
        fi
    else
        if [ "$VALIDATE_ONLY" = true ]; then
            echo -e "  ${RED}[MISSING]${NC} $name"
            return 1
        fi
        openssl rand -hex $SECRET_LENGTH > "$file"
        chmod 600 "$file"
        echo -e "  ${GREEN}[CREATED]${NC} $name"
    fi
    return 0
}

# Function to generate a username (shorter, alphanumeric)
generate_username() {
    local name=$1
    local file="$SECRETS_DIR/$name"

    if [ -f "$file" ]; then
        if [ ! -s "$file" ]; then
            echo -e "  ${RED}[EMPTY]${NC} $name - regenerating"
            openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 16 > "$file"
            chmod 600 "$file"
            echo -e "  ${GREEN}[REGENERATED]${NC} $name"
        else
            local actual_length
            actual_length=$(wc -c < "$file" | tr -d ' ')
            echo -e "  ${GREEN}[EXISTS]${NC} $name (${actual_length} chars)"
        fi
    else
        if [ "$VALIDATE_ONLY" = true ]; then
            echo -e "  ${RED}[MISSING]${NC} $name"
            return 1
        fi
        openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 16 > "$file"
        chmod 600 "$file"
        echo -e "  ${GREEN}[CREATED]${NC} $name"
    fi
    return 0
}

# Function to generate dashboard auth credentials (htpasswd format)
generate_dashboard_auth() {
    local username_file="$SECRETS_DIR/dashboard_username"
    local password_file="$SECRETS_DIR/dashboard_password"
    local auth_file="$SECRETS_DIR/dashboard_auth"

    # Generate username and password if they don't exist
    if [ ! -f "$username_file" ]; then
        echo "admin" > "$username_file"
        chmod 600 "$username_file"
        echo -e "  ${GREEN}[CREATED]${NC} dashboard_username (admin)"
    else
        echo -e "  ${GREEN}[EXISTS]${NC} dashboard_username"
    fi

    if [ ! -f "$password_file" ]; then
        openssl rand -base64 24 | tr -d '\n' > "$password_file"
        chmod 600 "$password_file"
        echo -e "  ${GREEN}[CREATED]${NC} dashboard_password"
    else
        echo -e "  ${GREEN}[EXISTS]${NC} dashboard_password"
    fi

    # Generate htpasswd auth string
    local username password hash

    username=$(cat "$username_file")
    password=$(cat "$password_file")

    # Check if htpasswd is available
    if command -v htpasswd &> /dev/null; then
        # Use htpasswd with bcrypt (-B)
        hash=$(htpasswd -nbB "$username" "$password" 2>/dev/null)
    elif command -v openssl &> /dev/null; then
        # Fallback: use apr1 (MD5) via openssl - less secure but widely available
        local salt
        salt=$(openssl rand -base64 8 | tr -dc 'a-zA-Z0-9' | head -c 8)
        hash=$(openssl passwd -apr1 -salt "$salt" "$password")
        hash="${username}:${hash}"
        echo -e "  ${YELLOW}[WARN]${NC} Using apr1 hash (install apache2-utils for bcrypt)"
    else
        echo -e "  ${RED}[ERROR]${NC} Neither htpasswd nor openssl available"
        return 1
    fi

    # Escape $ for .env file (each $ becomes $$)
    local escaped_hash
    escaped_hash=$(echo "$hash" | sed 's/\$/\$\$/g')
    echo "$escaped_hash" > "$auth_file"
    chmod 600 "$auth_file"

    echo -e "  ${GREEN}[CREATED]${NC} dashboard_auth (htpasswd format)"
    echo ""
    echo -e "  ${BLUE}Add this line to your .env file:${NC}"
    echo -e "  ${YELLOW}DASHBOARD_AUTH=${escaped_hash}${NC}"
    echo ""
    echo -e "  ${BLUE}Credentials (save these!):${NC}"
    echo -e "  Username: ${GREEN}${username}${NC}"
    echo -e "  Password: ${GREEN}${password}${NC}"
}

# Validation function for pre-flight checks
validate_secrets() {
    local required_secrets=(
        "postgres_password"
        "mysql_root_password"
        "mongodb_root_password"
        "minio_root_user"
        "minio_root_password"
        "dashboard_username"
        "dashboard_password"
        "dashboard_auth"
    )

    local missing=0
    local invalid=0

    echo "=== Validating Required Secrets ==="
    echo ""

    for secret in "${required_secrets[@]}"; do
        local file="$SECRETS_DIR/$secret"
        if [ ! -f "$file" ]; then
            echo -e "  ${RED}[MISSING]${NC} $secret"
            ((missing++))
        elif [ ! -s "$file" ]; then
            echo -e "  ${RED}[EMPTY]${NC} $secret"
            ((invalid++))
        else
            echo -e "  ${GREEN}[OK]${NC} $secret"
        fi
    done

    echo ""
    if [ $missing -gt 0 ] || [ $invalid -gt 0 ]; then
        echo -e "${RED}=== Validation FAILED ===${NC}"
        echo "Missing: $missing, Invalid: $invalid"
        echo "Run: ./scripts/generate-secrets.sh to fix"
        return 1
    else
        echo -e "${GREEN}=== Validation PASSED ===${NC}"
        return 0
    fi
}

# Validate only mode
if [ "$VALIDATE_ONLY" = true ]; then
    validate_secrets
    exit $?
fi

# Full generation mode
echo "=== Generating Secrets ==="
echo ""

echo "Foundation - PostgreSQL:"
generate_secret "postgres_password"

echo ""
echo "Foundation - MySQL:"
generate_secret "mysql_root_password"

echo ""
echo "Foundation - MongoDB:"
generate_secret "mongodb_root_password"

echo ""
echo "Foundation - MinIO:"
generate_username "minio_root_user"
generate_secret "minio_root_password"

echo ""
echo "Foundation - Dashboard Authentication:"
generate_dashboard_auth

echo ""
echo "=== Example Application Secrets ==="
echo ""

echo "Ghost (example):"
generate_secret "ghost_db_password"
generate_secret "ghost_mail_password"

echo ""
echo "LibreChat (example):"
generate_secret "librechat_db_password"
generate_secret "librechat_creds_key"
generate_secret "librechat_creds_iv"
generate_secret "librechat_jwt_secret"

echo ""
echo "Matrix/Synapse (example):"
generate_secret "synapse_db_password"
generate_secret "synapse_signing_key"
generate_secret "synapse_registration_shared_secret"

echo ""
echo "PeerTube (example):"
generate_secret "peertube_db_password"
generate_secret "peertube_secret" 64  # PeerTube needs longer secret

echo ""
echo "=== Secret Generation Complete ==="
echo ""
echo "Secrets stored in: $SECRETS_DIR/"
echo "Permissions: 600 (owner read/write only)"
echo ""
echo "Validate with: ./scripts/generate-secrets.sh --validate"
