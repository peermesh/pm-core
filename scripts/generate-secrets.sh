#!/usr/bin/env bash
# ==============================================================
# Secret Generation and Validation Script
# ==============================================================
# Generates cryptographically secure secrets for active profiles.
# Safe to run multiple times - only creates missing/empty secrets.
#
# Usage:
#   ./scripts/generate-secrets.sh
#   ./scripts/generate-secrets.sh --validate
#   ./scripts/generate-secrets.sh --profiles postgresql,ghost
#   ./scripts/generate-secrets.sh --all
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SECRETS_DIR="$PROJECT_DIR/secrets"
ENV_FILE="$PROJECT_DIR/.env"
SECRET_LENGTH=32

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

VALIDATE_ONLY=false
GENERATE_ALL=false
PROFILES_OVERRIDE=""

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --validate, -v          Validate required secrets only
  --profiles, -p LIST     Comma-separated profiles (overrides .env COMPOSE_PROFILES)
  --all, -a               Generate all known secrets (ignore profile filtering)
  --help, -h              Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --validate|-v)
            VALIDATE_ONLY=true
            shift
            ;;
        --profiles|-p)
            PROFILES_OVERRIDE="${2:-}"
            if [[ -z "$PROFILES_OVERRIDE" ]]; then
                log_error "--profiles requires a value"
                exit 1
            fi
            shift 2
            ;;
        --all|-a)
            GENERATE_ALL=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if ! command -v openssl >/dev/null 2>&1; then
    log_error "openssl is required"
    exit 1
fi

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

cd "$PROJECT_DIR"

if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
fi

# Normalize comma/space-separated profiles into newline-separated unique list.
normalize_profiles() {
    local raw="$1"
    printf '%s' "$raw" \
        | tr ',' '\n' \
        | tr ' ' '\n' \
        | sed '/^$/d' \
        | awk '!seen[$0]++'
}

if [[ -n "$PROFILES_OVERRIDE" ]]; then
    ACTIVE_PROFILES="$(normalize_profiles "$PROFILES_OVERRIDE")"
elif [[ -n "${COMPOSE_PROFILES:-}" ]]; then
    ACTIVE_PROFILES="$(normalize_profiles "$COMPOSE_PROFILES")"
else
    ACTIVE_PROFILES=""
fi

has_profile() {
    local needle="$1"
    if [[ -z "$ACTIVE_PROFILES" ]]; then
        return 1
    fi
    while IFS= read -r profile; do
        [[ "$profile" == "$needle" ]] && return 0
    done <<< "$ACTIVE_PROFILES"
    return 1
}

show_active_profiles() {
    if [[ "$GENERATE_ALL" == true ]]; then
        echo "all"
        return
    fi

    if [[ -z "$ACTIVE_PROFILES" ]]; then
        echo "none (foundation-only)"
        return
    fi

    echo "$ACTIVE_PROFILES" | paste -sd ',' -
}

append_unique() {
    local item="$1"
    shift || true
    local existing
    for existing in "$@"; do
        [[ "$existing" == "$item" ]] && return 1
    done
    return 0
}

# Generate/validate secret file.
# Types: secret (hex), username (alnum), auth (dashboard htpasswd)
ensure_secret() {
    local name="$1"
    local kind="${2:-secret}"
    local min_length="${3:-32}"
    local file="$SECRETS_DIR/$name"

    if [[ "$kind" == "auth" ]]; then
        ensure_dashboard_auth
        return $?
    fi

    if [[ -f "$file" ]]; then
        if [[ ! -s "$file" ]]; then
            if [[ "$VALIDATE_ONLY" == true ]]; then
                log_error "[EMPTY] $name"
                return 1
            fi
            log_warn "[EMPTY] $name - regenerating"
            if [[ "$kind" == "username" ]]; then
                openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 16 > "$file"
            else
                openssl rand -hex "$SECRET_LENGTH" > "$file"
            fi
            chmod 600 "$file"
            log_ok "[REGENERATED] $name"
            return 0
        fi

        local actual_length
        actual_length=$(wc -c < "$file" | tr -d ' ')
        if [[ "$actual_length" -lt "$min_length" ]]; then
            if [[ "$VALIDATE_ONLY" == true ]]; then
                log_error "[SHORT] $name ($actual_length < $min_length)"
                return 1
            fi
            log_warn "[SHORT] $name ($actual_length < $min_length)"
        else
            log_ok "[EXISTS] $name ($actual_length chars)"
        fi
        return 0
    fi

    if [[ "$VALIDATE_ONLY" == true ]]; then
        log_error "[MISSING] $name"
        return 1
    fi

    if [[ "$kind" == "username" ]]; then
        openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 16 > "$file"
    else
        openssl rand -hex "$SECRET_LENGTH" > "$file"
    fi
    chmod 600 "$file"
    log_ok "[CREATED] $name"
    return 0
}

ensure_dashboard_auth() {
    local username_file="$SECRETS_DIR/dashboard_username"
    local password_file="$SECRETS_DIR/dashboard_password"
    local auth_file="$SECRETS_DIR/dashboard_auth"

    if [[ "$VALIDATE_ONLY" == true ]]; then
        local failed=0
        [[ -s "$username_file" ]] || { log_error "[MISSING] dashboard_username"; failed=1; }
        [[ -s "$password_file" ]] || { log_error "[MISSING] dashboard_password"; failed=1; }
        [[ -s "$auth_file" ]] || { log_error "[MISSING] dashboard_auth"; failed=1; }
        return $failed
    fi

    if [[ ! -f "$username_file" ]]; then
        printf "admin" > "$username_file"
        chmod 600 "$username_file"
        log_ok "[CREATED] dashboard_username"
    else
        log_ok "[EXISTS] dashboard_username"
    fi

    if [[ ! -f "$password_file" ]] || [[ ! -s "$password_file" ]]; then
        openssl rand -base64 24 | tr -d '\n' > "$password_file"
        chmod 600 "$password_file"
        log_ok "[CREATED] dashboard_password"
    else
        log_ok "[EXISTS] dashboard_password"
    fi

    local username password hash passhash salt escaped_hash
    username=$(tr -d '\n' < "$username_file")
    password=$(tr -d '\n' < "$password_file")
    hash=""

    if command -v htpasswd >/dev/null 2>&1; then
        hash=$(htpasswd -nbB "$username" "$password" 2>/dev/null || true)
        if [[ -z "$hash" ]]; then
            hash=$(htpasswd -nb "$username" "$password" 2>/dev/null || true)
        fi
    fi

    if [[ -z "$hash" ]]; then
        salt=$(openssl rand -hex 4)
        passhash=$(openssl passwd -apr1 -salt "$salt" "$password" 2>/dev/null || true)
        if [[ -z "$passhash" ]]; then
            passhash=$(openssl passwd -1 -salt "$salt" "$password" 2>/dev/null || true)
        fi
        if [[ -z "$passhash" ]]; then
            log_error "Failed to generate dashboard_auth hash"
            return 1
        fi
        hash="${username}:${passhash}"
    fi

    escaped_hash=$(printf '%s' "$hash" | sed 's/\$/\$\$/g')
    printf '%s' "$escaped_hash" > "$auth_file"
    chmod 600 "$auth_file"
    log_ok "[CREATED] dashboard_auth"
}

validate_environment() {
    local failed=0

    if [[ -z "${DOMAIN:-}" || "${DOMAIN}" == "example.com" ]]; then
        log_error "DOMAIN is not configured (.env still uses example.com)"
        failed=1
    else
        log_ok "DOMAIN=${DOMAIN}"
    fi

    if has_profile "ghost"; then
        if [[ -z "${GHOST_URL:-}" || "${GHOST_URL}" == "https://ghost.localhost" ]]; then
            log_error "GHOST_URL must be set when profile 'ghost' is active"
            failed=1
        else
            log_ok "GHOST_URL=${GHOST_URL}"
        fi
    fi

    if has_profile "matrix"; then
        if [[ -z "${SYNAPSE_SERVER_NAME:-}" || "${SYNAPSE_SERVER_NAME}" == "matrix.localhost" ]]; then
            log_error "SYNAPSE_SERVER_NAME must be set when profile 'matrix' is active"
            failed=1
        else
            log_ok "SYNAPSE_SERVER_NAME=${SYNAPSE_SERVER_NAME}"
        fi
    fi

    if has_profile "solid"; then
        if [[ -z "${SOLID_BASE_URL:-}" ]]; then
            log_warn "SOLID_BASE_URL not set; solid will use compose default"
        fi
    fi

    if has_profile "peertube"; then
        if [[ -n "${PEERTUBE_HOSTNAME:-}" && "${PEERTUBE_HOSTNAME}" == "peertube.localhost" ]]; then
            log_error "PEERTUBE_HOSTNAME placeholder detected"
            failed=1
        fi
    fi

    return $failed
}

build_required_secrets() {
    REQUIRED_SECRETS=()

    # Foundation defaults
    REQUIRED_SECRETS+=("dashboard_username:username:4")
    REQUIRED_SECRETS+=("dashboard_password:secret:32")
    REQUIRED_SECRETS+=("dashboard_auth:auth:20")

    if [[ "$GENERATE_ALL" == true ]]; then
        REQUIRED_SECRETS+=(
            "postgres_password:secret:32"
            "mysql_root_password:secret:32"
            "mysql_app_password:secret:32"
            "mongodb_root_password:secret:32"
            "minio_root_user:username:4"
            "minio_root_password:secret:32"
            "ghost_db_password:secret:32"
            "ghost_mail_password:secret:32"
            "librechat_db_password:secret:32"
            "librechat_creds_key:secret:32"
            "librechat_creds_iv:secret:32"
            "librechat_jwt_secret:secret:32"
            "synapse_db_password:secret:32"
            "synapse_signing_key:secret:32"
            "synapse_registration_shared_secret:secret:32"
            "peertube_db_password:secret:32"
            "peertube_secret:secret:64"
            "listmonk_db_password:secret:32"
        )
        return
    fi

    if has_profile "postgresql"; then
        REQUIRED_SECRETS+=("postgres_password:secret:32")
    fi
    if has_profile "mysql"; then
        REQUIRED_SECRETS+=("mysql_root_password:secret:32")
        REQUIRED_SECRETS+=("mysql_app_password:secret:32")
    fi
    if has_profile "mongodb"; then
        REQUIRED_SECRETS+=("mongodb_root_password:secret:32")
    fi
    if has_profile "minio"; then
        REQUIRED_SECRETS+=("minio_root_user:username:4")
        REQUIRED_SECRETS+=("minio_root_password:secret:32")
    fi

    if has_profile "ghost"; then
        REQUIRED_SECRETS+=("mysql_root_password:secret:32")
        REQUIRED_SECRETS+=("ghost_db_password:secret:32")
        REQUIRED_SECRETS+=("ghost_mail_password:secret:32")
    fi

    if has_profile "librechat"; then
        REQUIRED_SECRETS+=("postgres_password:secret:32")
        REQUIRED_SECRETS+=("mongodb_root_password:secret:32")
        REQUIRED_SECRETS+=("librechat_db_password:secret:32")
        REQUIRED_SECRETS+=("librechat_creds_key:secret:32")
        REQUIRED_SECRETS+=("librechat_creds_iv:secret:32")
        REQUIRED_SECRETS+=("librechat_jwt_secret:secret:32")
    fi

    if has_profile "matrix"; then
        REQUIRED_SECRETS+=("postgres_password:secret:32")
        REQUIRED_SECRETS+=("synapse_db_password:secret:32")
        REQUIRED_SECRETS+=("synapse_signing_key:secret:32")
        REQUIRED_SECRETS+=("synapse_registration_shared_secret:secret:32")
    fi

    if has_profile "peertube"; then
        REQUIRED_SECRETS+=("postgres_password:secret:32")
        REQUIRED_SECRETS+=("peertube_db_password:secret:32")
        REQUIRED_SECRETS+=("peertube_secret:secret:64")
    fi

    if has_profile "listmonk"; then
        REQUIRED_SECRETS+=("postgres_password:secret:32")
        REQUIRED_SECRETS+=("listmonk_db_password:secret:32")
    fi
}

dedupe_required_secrets() {
    DEDUPED_SECRETS=()
    local item
    local seen_names=""

    for item in "${REQUIRED_SECRETS[@]}"; do
        local name="${item%%:*}"
        if grep -q "^${name}$" <<< "$seen_names"; then
            continue
        fi
        DEDUPED_SECRETS+=("$item")
        seen_names+="${name}"$'\n'
    done
}

run_secret_pass() {
    local failed=0
    local item name kind min

    for item in "${DEDUPED_SECRETS[@]}"; do
        IFS=':' read -r name kind min <<< "$item"
        if ! ensure_secret "$name" "$kind" "$min"; then
            failed=1
        fi
    done

    return $failed
}

echo ""
echo "=========================================="
echo "  Peer Mesh Docker Lab - Secrets"
echo "=========================================="
echo ""

log_info "Active profiles: $(show_active_profiles)"

build_required_secrets
dedupe_required_secrets

if [[ "$VALIDATE_ONLY" == true ]]; then
    echo ""
    log_info "Validating environment configuration..."
    env_failed=0
    validate_environment || env_failed=1

    echo ""
    log_info "Validating required secrets..."
    secrets_failed=0
    run_secret_pass || secrets_failed=1

    echo ""
    if [[ $env_failed -eq 0 && $secrets_failed -eq 0 ]]; then
        log_ok "Validation passed"
        exit 0
    fi

    log_error "Validation failed"
    if [[ $secrets_failed -ne 0 ]]; then
        echo "Run: ./scripts/generate-secrets.sh $( [[ -n "$PROFILES_OVERRIDE" ]] && printf -- '--profiles %s' "$PROFILES_OVERRIDE" )"
    fi
    exit 1
fi

echo ""
log_info "Generating required secrets..."
run_secret_pass

echo ""
log_ok "Secret generation complete"
echo "Secrets directory: $SECRETS_DIR"
echo "Validate with: ./scripts/generate-secrets.sh --validate"
