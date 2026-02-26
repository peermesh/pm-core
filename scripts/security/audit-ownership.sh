#!/usr/bin/env bash
# ==============================================================
# Ownership and Capability Audit Script
# ==============================================================
# Validates runtime container ownership, capabilities, and security
# settings against the documented hardening policy.
#
# Checks:
#   - Container user is non-root where expected
#   - cap_drop: ALL is applied
#   - no-new-privileges is enabled
#   - read_only root filesystem where expected
#   - Volume mount ownership matches expected UID:GID
#   - Required capabilities are present (and no extras)
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more failures
#   2 = no running containers found
#
# Usage:
#   ./scripts/security/audit-ownership.sh
#   ./scripts/security/audit-ownership.sh --json
#   ./scripts/security/audit-ownership.sh --fix-volumes
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# --- Configuration ---

# Service ownership policy: container_name:expected_uid:root_exception:description
# root_exception=yes means the service is allowed/expected to run as root
OWNERSHIP_POLICY=(
    "pmdl_socket-proxy:0:yes:Docker socket proxy (requires root for socket access)"
    "pmdl_traefik:0:deferred:Traefik reverse proxy (non-root target: 65534)"
    "pmdl_dashboard:1000:no:Dashboard web application"
    "pmdl_postgres:0:yes:PostgreSQL (entrypoint drops to uid 999 internally)"
    "pmdl_mysql:0:yes:MySQL (entrypoint drops to uid 999 internally)"
    "pmdl_mongodb:0:yes:MongoDB (entrypoint drops to uid 999 internally)"
    "pmdl_redis:999:no:Redis cache"
    "pmdl_minio:0:yes:MinIO object storage (runs internal user mapping)"
)

# Volume ownership policy: volume_name:expected_uid:expected_gid:description
VOLUME_POLICY=(
    "pmdl_traefik_acme:0:0:Traefik ACME certificate store"
    "pmdl_postgres_data:999:999:PostgreSQL data directory"
    "pmdl_mysql_data:999:999:MySQL data directory"
    "pmdl_mongodb_data:999:999:MongoDB data directory"
    "pmdl_redis_data:999:999:Redis append-only data"
    "pmdl_minio_data:1000:1000:MinIO object storage data"
)

# Expected capabilities beyond the dropped set
# service:capability:reason
CAPABILITY_POLICY=(
    "pmdl_traefik:NET_BIND_SERVICE:Bind to ports 80 and 443"
)

# Services that should have cap_drop: ALL
CAP_DROP_REQUIRED=(
    "pmdl_traefik"
    "pmdl_dashboard"
    "pmdl_redis"
)

# Services that should have no-new-privileges
NNP_REQUIRED=(
    "pmdl_traefik"
    "pmdl_dashboard"
    "pmdl_redis"
)

# --- Output formatting ---

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

JSON_MODE=false
FIX_VOLUMES=false
FAILURES=0
WARNINGS=0
PASSES=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)
            JSON_MODE=true
            shift
            ;;
        --fix-volumes)
            FIX_VOLUMES=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--json] [--fix-volumes] [--help]"
            echo ""
            echo "Options:"
            echo "  --json          Output results as JSON"
            echo "  --fix-volumes   Attempt to fix volume ownership mismatches"
            echo "  --help, -h      Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

log_pass() {
    PASSES=$((PASSES + 1))
    if [[ "$JSON_MODE" == false ]]; then
        echo -e "${GREEN}[PASS]${NC} $1"
    fi
}

log_warn() {
    WARNINGS=$((WARNINGS + 1))
    if [[ "$JSON_MODE" == false ]]; then
        echo -e "${YELLOW}[WARN]${NC} $1"
    fi
}

log_fail() {
    FAILURES=$((FAILURES + 1))
    if [[ "$JSON_MODE" == false ]]; then
        echo -e "${RED}[FAIL]${NC} $1"
    fi
}

log_info() {
    if [[ "$JSON_MODE" == false ]]; then
        echo -e "${BLUE}[INFO]${NC} $1"
    fi
}

log_section() {
    if [[ "$JSON_MODE" == false ]]; then
        echo ""
        echo "=== $1 ==="
        echo ""
    fi
}

# --- Check functions ---

check_container_user() {
    local container="$1"
    local expected_uid="$2"
    local root_exception="$3"
    local desc="$4"

    if ! docker inspect "$container" >/dev/null 2>&1; then
        log_info "SKIP: $container not running ($desc)"
        return 0
    fi

    local actual_uid
    actual_uid=$(docker exec "$container" id -u 2>/dev/null || echo "error")

    if [[ "$actual_uid" == "error" ]]; then
        log_warn "$container: could not determine UID (container may lack 'id' command)"
        return 0
    fi

    if [[ "$actual_uid" == "0" && "$root_exception" == "yes" ]]; then
        log_pass "$container: runs as root (documented exception: $desc)"
        return 0
    fi

    if [[ "$actual_uid" == "0" && "$root_exception" == "deferred" ]]; then
        log_warn "$container: runs as root (non-root migration deferred: $desc)"
        return 0
    fi

    if [[ "$actual_uid" == "$expected_uid" ]]; then
        log_pass "$container: runs as UID $actual_uid (expected: $expected_uid)"
        return 0
    fi

    log_fail "$container: runs as UID $actual_uid (expected: $expected_uid) - $desc"
    return 1
}

check_cap_drop() {
    local container="$1"

    if ! docker inspect "$container" >/dev/null 2>&1; then
        return 0
    fi

    local cap_drop
    cap_drop=$(docker inspect "$container" --format '{{json .HostConfig.CapDrop}}' 2>/dev/null || echo "null")

    if [[ "$cap_drop" == *"ALL"* ]] || [[ "$cap_drop" == *"all"* ]]; then
        log_pass "$container: cap_drop ALL applied"
        return 0
    fi

    log_fail "$container: cap_drop ALL not applied (got: $cap_drop)"
    return 1
}

check_cap_add() {
    local container="$1"

    if ! docker inspect "$container" >/dev/null 2>&1; then
        return 0
    fi

    local cap_add
    cap_add=$(docker inspect "$container" --format '{{json .HostConfig.CapAdd}}' 2>/dev/null || echo "null")

    # Build expected list for this container
    local expected_caps=()
    local spec cap reason
    for spec in "${CAPABILITY_POLICY[@]}"; do
        IFS=':' read -r svc cap reason <<< "$spec"
        if [[ "$svc" == "$container" ]]; then
            expected_caps+=("$cap")
        fi
    done

    if [[ "$cap_add" == "null" || "$cap_add" == "[]" ]]; then
        if [[ ${#expected_caps[@]} -eq 0 ]]; then
            log_pass "$container: no capabilities added (none expected)"
        else
            log_warn "$container: no capabilities added, but expected: ${expected_caps[*]}"
        fi
        return 0
    fi

    # Check for unexpected capabilities
    local clean_caps
    clean_caps=$(echo "$cap_add" | tr -d '[]"' | tr ',' '\n')
    local unexpected=()
    local found_cap
    while IFS= read -r found_cap; do
        [[ -z "$found_cap" ]] && continue
        local is_expected=false
        local exp
        for exp in "${expected_caps[@]}"; do
            if [[ "$found_cap" == "$exp" ]]; then
                is_expected=true
                break
            fi
        done
        if [[ "$is_expected" == false ]]; then
            unexpected+=("$found_cap")
        fi
    done <<< "$clean_caps"

    if [[ ${#unexpected[@]} -gt 0 ]]; then
        log_fail "$container: unexpected capabilities added: ${unexpected[*]}"
        return 1
    fi

    log_pass "$container: capabilities match policy (${expected_caps[*]:-none})"
    return 0
}

check_no_new_privileges() {
    local container="$1"

    if ! docker inspect "$container" >/dev/null 2>&1; then
        return 0
    fi

    local sec_opt
    sec_opt=$(docker inspect "$container" --format '{{json .HostConfig.SecurityOpt}}' 2>/dev/null || echo "null")

    if [[ "$sec_opt" == *"no-new-privileges"* ]]; then
        log_pass "$container: no-new-privileges enabled"
        return 0
    fi

    log_fail "$container: no-new-privileges not enabled (got: $sec_opt)"
    return 1
}

check_read_only_rootfs() {
    local container="$1"

    if ! docker inspect "$container" >/dev/null 2>&1; then
        return 0
    fi

    local readonly_rootfs
    readonly_rootfs=$(docker inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}' 2>/dev/null || echo "false")

    if [[ "$readonly_rootfs" == "true" ]]; then
        log_pass "$container: read-only root filesystem"
    else
        log_info "$container: writable root filesystem (harden via docker-compose.hardening.yml)"
    fi
    return 0
}

check_volume_ownership() {
    local volume="$1"
    local expected_uid="$2"
    local expected_gid="$3"
    local desc="$4"

    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
        log_info "SKIP: volume $volume does not exist ($desc)"
        return 0
    fi

    # Use a minimal container to stat the volume root
    local actual_owner
    actual_owner=$(docker run --rm -v "${volume}:/audit:ro" alpine:3.20 stat -c '%u:%g' /audit 2>/dev/null || echo "error")

    if [[ "$actual_owner" == "error" ]]; then
        log_warn "$volume: could not determine ownership"
        return 0
    fi

    local expected="${expected_uid}:${expected_gid}"

    if [[ "$actual_owner" == "$expected" ]]; then
        log_pass "$volume: ownership $actual_owner matches policy ($desc)"
        return 0
    fi

    if [[ "$FIX_VOLUMES" == true ]]; then
        log_info "$volume: fixing ownership from $actual_owner to $expected"
        if docker run --rm -v "${volume}:/target" alpine:3.20 chown -R "${expected}" /target 2>/dev/null; then
            log_pass "$volume: ownership fixed to $expected ($desc)"
            return 0
        fi
        log_fail "$volume: could not fix ownership ($desc)"
        return 1
    fi

    log_fail "$volume: ownership $actual_owner does not match expected $expected ($desc)"
    return 1
}

# --- Main ---

main() {
    echo ""
    echo "=========================================="
    echo "  Ownership and Capability Audit"
    echo "  Peer Mesh Docker Lab"
    echo "=========================================="

    # Check if Docker is available
    if ! docker info >/dev/null 2>&1; then
        echo "ERROR: Docker is not available or not running"
        exit 2
    fi

    # Check running containers
    local running
    running=$(docker ps --format '{{.Names}}' --filter "name=pmdl_" 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$running" -eq 0 ]]; then
        log_info "No pmdl_ containers running. Volume checks only."
    fi

    # --- Section 1: Container User Audit ---
    log_section "Container User Audit"
    local spec container uid root_exc desc
    for spec in "${OWNERSHIP_POLICY[@]}"; do
        IFS=':' read -r container uid root_exc desc <<< "$spec"
        check_container_user "$container" "$uid" "$root_exc" "$desc" || true
    done

    # --- Section 2: Capability Audit ---
    log_section "Capability Audit (cap_drop / cap_add)"
    for svc in "${CAP_DROP_REQUIRED[@]}"; do
        check_cap_drop "$svc" || true
    done

    # Check cap_add for all running pmdl containers
    local cname
    while IFS= read -r cname; do
        [[ -z "$cname" ]] && continue
        check_cap_add "$cname" || true
    done < <(docker ps --format '{{.Names}}' --filter "name=pmdl_" 2>/dev/null)

    # --- Section 3: no-new-privileges Audit ---
    log_section "no-new-privileges Audit"
    for svc in "${NNP_REQUIRED[@]}"; do
        check_no_new_privileges "$svc" || true
    done

    # --- Section 4: Read-only Filesystem Audit ---
    log_section "Read-Only Filesystem Audit"
    while IFS= read -r cname; do
        [[ -z "$cname" ]] && continue
        check_read_only_rootfs "$cname" || true
    done < <(docker ps --format '{{.Names}}' --filter "name=pmdl_" 2>/dev/null)

    # --- Section 5: Volume Ownership Audit ---
    log_section "Volume Ownership Audit"
    for spec in "${VOLUME_POLICY[@]}"; do
        IFS=':' read -r vol uid gid desc <<< "$spec"
        check_volume_ownership "$vol" "$uid" "$gid" "$desc" || true
    done

    # --- Summary ---
    echo ""
    echo "=========================================="
    echo "  Audit Summary"
    echo "=========================================="
    echo "  PASS:     $PASSES"
    echo "  WARN:     $WARNINGS"
    echo "  FAIL:     $FAILURES"
    echo "=========================================="
    echo ""

    if [[ "$JSON_MODE" == true ]]; then
        printf '{"passes":%d,"warnings":%d,"failures":%d}\n' "$PASSES" "$WARNINGS" "$FAILURES"
    fi

    if [[ "$FAILURES" -gt 0 ]]; then
        exit 1
    fi

    exit 0
}

main "$@"
