#!/usr/bin/env bash
# ==============================================================
# deploy-vps.sh — Safe docker compose invocation for the VPS
# ==============================================================
#
# PURPOSE
#   Single source of truth for the full set of `-f` flags and
#   `--profile` flags required to represent the *complete* state
#   of the root `docker-lab` compose project on the VPS.
#
#   Running `docker compose up -d --remove-orphans` with only the
#   root `docker-compose.yml` is DANGEROUS — it will mark every
#   service defined in profile overlay files (observability-lite,
#   observability-full, postgresql, ...) as an orphan and stop
#   their containers. This is exactly what happened in T63 when
#   traefik was brought up standalone and nuked prometheus,
#   grafana, loki, netdata, uptime-kuma, and the dashboard.
#
#   This script enumerates every compose file and profile that is
#   currently considered active on the VPS, runs the canonical
#   deploy-guard preflight, validates the merged configuration,
#   optionally runs a dry-run preview, and then executes the real
#   `up -d --remove-orphans` so that true orphans (e.g.
#   pmdl_catchall) are removed without collateral damage.
#
# USAGE
#   ./deploy-vps.sh prereqs          # print VPS package prerequisites
#   ./deploy-vps.sh config            # validate merged config
#   ./deploy-vps.sh dry-run           # preview what would happen
#   ./deploy-vps.sh reconcile         # owner-gated, remove orphans only (--no-recreate)
#   ./deploy-vps.sh reconcile --yes   # same, skip confirmation after gate
#   ./deploy-vps.sh up                # owner-gated, apply + recreate on config drift
#   ./deploy-vps.sh up --yes          # same, skip confirmation after gate
#   ./deploy-vps.sh ps                # list services in this project
#
# RECONCILE VS UP
#   `reconcile` uses `--no-recreate` — it only removes true orphans
#   and starts any missing services. It never touches a running
#   container whose config has drifted. Use this for the T63-style
#   fix where you want orphan cleanup without any other side
#   effects.
#
#   `up` is a normal `docker compose up` — it will recreate any
#   container whose config hash no longer matches its compose
#   definition. Use this for full deployments.
#
# NOTES
#   - Module compose projects (hello-core, hello-custom, social-lab,
#     universal-manifest, spatial-fabric, backup) use DIFFERENT
#     `com.docker.compose.project` labels, so they are not orphans
#     of the root project and are never touched by this script.
#   - If new profiles are activated on the VPS, add them to the
#     ACTIVE_COMPOSE_FILES and ACTIVE_PROFILES arrays below.
#   - Production mutation commands are blocked unless the caller sets
#     PEERMESH_PRODUCTION_AUTHENTIK_APPLY_APPROVAL to the revised plan ID.
# ==============================================================

set -euo pipefail

# --------------------------------------------------------------
# Configuration — EDIT HERE when the active profile set changes
# --------------------------------------------------------------

# Project directory on the VPS. Override with DOCKER_LAB_DIR=...
readonly DOCKER_LAB_DIR="${DOCKER_LAB_DIR:-/opt/docker-lab}"

# Every compose file that must be layered to describe the full
# current state of the `docker-lab` root project. Order matters:
# later files override earlier ones.
readonly ACTIVE_COMPOSE_FILES=(
    "docker-compose.yml"
    "docker-compose.production.yml"
    "docker-compose.authentik-production.yml"
    "profiles/observability-lite/docker-compose.observability-lite.yml"
    "profiles/observability-full/docker-compose.observability-full.yml"
)

# Compose profiles currently active. Services gated behind
# `profiles:` directives are only visible when their profile is
# passed via `--profile`.
readonly ACTIVE_PROFILES=(
    "postgresql"
)

# Explicit owner approval gate for future production mutation under the revised
# Authentik-preservation plan. Config and dry-run remain non-mutating; reconcile
# and up are blocked until the owner supplies the plan ID out-of-band.
readonly PRODUCTION_AUTHENTIK_PLAN_ID="PLAN-CORE-RECONCILE-001-REV-AUTHENTIK-PRESERVE"
readonly PRODUCTION_AUTHENTIK_APPROVAL_VAR="PEERMESH_PRODUCTION_AUTHENTIK_APPLY_APPROVAL"

# --------------------------------------------------------------
# Internals
# --------------------------------------------------------------

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
log() { printf '[deploy-vps] %s\n' "$*"; }

require_production_mutation_approval() {
    local approval="${PEERMESH_PRODUCTION_AUTHENTIK_APPLY_APPROVAL:-}"
    if [[ "$approval" != "$PRODUCTION_AUTHENTIK_PLAN_ID" ]]; then
        die "production mutation blocked: set ${PRODUCTION_AUTHENTIK_APPROVAL_VAR}=${PRODUCTION_AUTHENTIK_PLAN_ID} only after fresh owner approval"
    fi
}

build_compose_args() {
    local args=()
    for p in "${ACTIVE_PROFILES[@]}"; do
        args+=("--profile" "$p")
    done
    for f in "${ACTIVE_COMPOSE_FILES[@]}"; do
        [[ -f "$DOCKER_LAB_DIR/$f" ]] || die "missing compose file: $DOCKER_LAB_DIR/$f"
        args+=("-f" "$f")
    done
    printf '%s\n' "${args[@]}"
}

compose() {
    local args
    local -a _args
    # Process substitution hides builder failures from mapfile.
    args="$(build_compose_args)" || return
    mapfile -t _args <<< "$args"
    ( cd "$DOCKER_LAB_DIR" && docker compose "${_args[@]}" "$@" )
}

run_guard_check() {
    local guard_args=("--env-file" "${DOCKER_LAB_DIR}/.env")
    local profile
    for profile in "${ACTIVE_PROFILES[@]}"; do
        guard_args+=("--profile" "$profile")
    done

    [[ -x "${DOCKER_LAB_DIR}/scripts/deploy-guard.sh" ]] || \
        die "missing deploy guard: ${DOCKER_LAB_DIR}/scripts/deploy-guard.sh"

    log "running deploy-guard preflight..."
    ( cd "$DOCKER_LAB_DIR" && ./scripts/deploy-guard.sh "${guard_args[@]}" )
}

cmd_config() {
    run_guard_check
    log "validating merged compose configuration..."
    compose config --quiet
    log "OK — merged config is valid"
    log "services in project:"
    compose config --services | sed 's/^/  - /'
}

cmd_prereqs() {
    cat <<'EOF'
VPS package prerequisites:
  - docker / docker compose plugin
  - apache2-utils (provides `htpasswd` for TRAEFIK_DASHBOARD_AUTH generation)
  - openssl (password generation / TLS inspection)
  - curl (HTTP verification)

Debian/Ubuntu example:
  apt update
  apt install -y apache2-utils openssl curl

Generate dashboard auth before deploy:
  htpasswd -nbB admin "$(openssl rand -base64 24)"
EOF
}

cmd_ps() {
    compose ps --format 'table {{.Name}}\t{{.Service}}\t{{.Status}}'
}

cmd_dry_run() {
    run_guard_check
    log "dry-run: up -d --remove-orphans"
    compose --dry-run up -d --remove-orphans
}

_confirm() {
    local assume_yes="${1:-}"
    if [[ "$assume_yes" != "--yes" && "$assume_yes" != "-y" ]]; then
        read -r -p "proceed with real apply? [y/N] " reply
        [[ "$reply" =~ ^[Yy]$ ]] || die "aborted"
    fi
}

cmd_reconcile() {
    local assume_yes="${1:-}"
    require_production_mutation_approval
    run_guard_check
    log "validating merged compose configuration..."
    compose config --quiet
    log "OK — merged config is valid"
    log "dry-run preview (--no-recreate):"
    compose --dry-run up -d --remove-orphans --no-recreate || true
    _confirm "$assume_yes"
    log "applying: up -d --remove-orphans --no-recreate"
    compose up -d --remove-orphans --no-recreate
    log "done. current state:"
    cmd_ps
}

cmd_up() {
    local assume_yes="${1:-}"
    require_production_mutation_approval
    run_guard_check
    log "validating merged compose configuration..."
    compose config --quiet
    log "OK — merged config is valid"
    log "dry-run preview:"
    compose --dry-run up -d --remove-orphans || true
    _confirm "$assume_yes"
    log "applying: up -d --remove-orphans"
    compose up -d --remove-orphans
    log "done. current state:"
    cmd_ps
}

main() {
    local sub="${1:-}"
    shift || true
    case "$sub" in
        prereqs)   cmd_prereqs ;;
        config)     cmd_config ;;
        ps)         cmd_ps ;;
        dry-run)    cmd_dry_run ;;
        reconcile)  cmd_reconcile "${1:-}" ;;
        up)         cmd_up "${1:-}" ;;
        ""|help|-h|--help)
            sed -n '2,55p' "$0"
            ;;
        *)
            die "unknown subcommand: $sub (try: prereqs | config | ps | dry-run | reconcile | up)"
            ;;
    esac
}

main "$@"
