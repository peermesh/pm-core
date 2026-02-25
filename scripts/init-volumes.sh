#!/usr/bin/env bash
# ==============================================================
# Volume and Bind-File Initialization Script
# ==============================================================
# Prepares Docker volumes with correct ownership for non-root containers
# and pre-creates bind-mounted config files to avoid "directory instead
# of file" mount issues.
#
# Usage:
#   ./scripts/init-volumes.sh
#   ./scripts/init-volumes.sh --check
# ============================================================== 

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

CHECK_ONLY=false
if [[ "${1:-}" == "--check" || "${1:-}" == "-c" ]]; then
    CHECK_ONLY=true
fi

# volume:uid:gid:description
VOLUME_SPECS=(
    "pmdl_synapse_data:991:991:Synapse Matrix server"
    "pmdl_peertube_data:1000:1000:PeerTube data"
    "pmdl_peertube_config:1000:1000:PeerTube config"
    "pmdl_redis_data:999:999:Redis cache"
    "pmdl_peertube_redis:999:999:PeerTube Redis"
)

# file_path:seed_line
BIND_FILE_SPECS=(
    "examples/matrix/config/homeserver.yaml:# generate with examples/matrix/README.md"
    "examples/matrix/config/log.config:# generate with examples/matrix/README.md"
    "examples/matrix/config/signing.key:# generate with examples/matrix/README.md"
    "examples/matrix/config/element-config.json:{}"
)

ensure_bind_files() {
    local issues=0
    local spec path seed dir

    log_info "Ensuring bind-mounted config files exist..."

    for spec in "${BIND_FILE_SPECS[@]}"; do
        path="${spec%%:*}"
        seed="${spec#*:}"
        dir="$(dirname "$path")"

        mkdir -p "$dir"

        if [[ ! -f "$path" ]]; then
            if [[ "$CHECK_ONLY" == true ]]; then
                log_warn "[NEEDS FILE] $path"
                issues=1
                continue
            fi

            if [[ -n "$seed" ]]; then
                printf '%s\n' "$seed" > "$path"
            else
                : > "$path"
            fi
            log_ok "[CREATED] $path"
        else
            log_ok "[OK] $path"
        fi
    done

    return $issues
}

current_owner() {
    local volume="$1"
    local mountpoint
    mountpoint=$(docker volume inspect "$volume" --format '{{ .Mountpoint }}' 2>/dev/null || true)

    if [[ -z "$mountpoint" || ! -d "$mountpoint" ]]; then
        echo "unknown"
        return
    fi

    # macOS + Linux compatibility
    if stat -f '%u:%g' "$mountpoint" >/dev/null 2>&1; then
        stat -f '%u:%g' "$mountpoint"
    else
        stat -c '%u:%g' "$mountpoint"
    fi
}

fix_volume_owner() {
    local volume="$1"
    local uid="$2"
    local gid="$3"
    local desc="$4"
    local expected="${uid}:${gid}"

    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
        if [[ "$CHECK_ONLY" == true ]]; then
            log_warn "[MISSING VOLUME] $volume ($desc)"
            return 1
        fi

        docker volume create "$volume" >/dev/null
        log_info "[CREATED VOLUME] $volume"
    fi

    local owner
    owner=$(current_owner "$volume")

    if [[ "$owner" == "$expected" ]]; then
        log_ok "[OK] $volume owner=$owner"
        return 0
    fi

    if [[ "$CHECK_ONLY" == true ]]; then
        log_warn "[NEEDS FIX] $volume current=${owner} expected=${expected}"
        return 1
    fi

    log_info "[CHOWN] $volume -> ${expected} (${desc})"
    if docker run --rm -v "${volume}:/target" alpine:3.20 sh -c "chown -R ${expected} /target" >/dev/null; then
        log_ok "[FIXED] $volume"
        return 0
    fi

    log_error "[FAILED] Could not set owner for $volume"
    return 1
}

main() {
    local failures=0

    echo ""
    echo "=========================================="
    echo "  Peer Mesh Docker Lab - Volume Init"
    echo "=========================================="
    echo ""

    ensure_bind_files || failures=$((failures + 1))
    echo ""

    log_info "Checking volume ownership for non-root services..."
    local spec volume uid gid desc
    for spec in "${VOLUME_SPECS[@]}"; do
        IFS=':' read -r volume uid gid desc <<< "$spec"
        if ! fix_volume_owner "$volume" "$uid" "$gid" "$desc"; then
            failures=$((failures + 1))
        fi
    done

    echo ""
    if [[ "$CHECK_ONLY" == true ]]; then
        if [[ $failures -gt 0 ]]; then
            log_warn "Check completed with ${failures} issue(s)"
            exit 1
        fi
        log_ok "Check completed: no issues"
        exit 0
    fi

    if [[ $failures -gt 0 ]]; then
        log_warn "Initialization completed with ${failures} issue(s)"
        exit 1
    fi

    log_ok "Initialization completed"
}

main "$@"
