#!/usr/bin/env bash
# ==============================================================
# Host Firewall Enforcement Helper
# ==============================================================
# Purpose:
# - provide an operator-safe plan/apply workflow for host firewall hardening
# - configure a minimal UFW baseline for PeerMesh Core hosts
# - provide verification output suitable for audit evidence
#
# Safety:
# - default mode is --plan (read-only, prints intended commands)
# - apply mode requires both --apply and --yes
# ==============================================================

set -euo pipefail

MODE="plan"
CONFIRMED=false
ALLOW_MATRIX_8448=false

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --plan            Show commands without applying changes (default)
  --apply           Apply firewall changes (requires --yes)
  --yes             Required confirmation flag when using --apply
  --allow-8448      Open TCP/8448 (Matrix federation) in addition to 22/80/443
  --help, -h        Show this help message

Examples:
  $0 --plan
  sudo $0 --apply --yes
  sudo $0 --apply --yes --allow-8448
USAGE
}

log_info() { echo "[INFO] $1"; }
log_ok() { echo "[OK] $1"; }
log_warn() { echo "[WARN] $1"; }
log_error() { echo "[ERROR] $1"; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --plan)
            MODE="plan"
            shift
            ;;
        --apply)
            MODE="apply"
            shift
            ;;
        --yes)
            CONFIRMED=true
            shift
            ;;
        --allow-8448)
            ALLOW_MATRIX_8448=true
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

if [[ "$MODE" == "apply" && "$CONFIRMED" != true ]]; then
    log_error "--apply requires --yes"
    exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
    log_error "ufw is not installed on this host"
    exit 1
fi

commands=(
    "ufw default deny incoming"
    "ufw default allow outgoing"
    "ufw allow OpenSSH"
    "ufw allow 80/tcp"
    "ufw allow 443/tcp"
)
if [[ "$ALLOW_MATRIX_8448" == true ]]; then
    commands+=("ufw allow 8448/tcp")
fi
commands+=(
    "ufw --force enable"
    "ufw status verbose"
)

echo "== PeerMesh Host Firewall Baseline =="
echo "mode: $MODE"
echo "allow_8448: $ALLOW_MATRIX_8448"
echo ""

if [[ "$MODE" == "plan" ]]; then
    log_info "Plan mode; no changes will be applied."
    for cmd in "${commands[@]}"; do
        echo "  $cmd"
    done
    echo ""
    log_info "Verification commands:"
    echo "  ufw status verbose"
    echo "  iptables -S INPUT"
    echo "  iptables -S DOCKER-USER"
    exit 0
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_error "apply mode requires root (run with sudo)"
    exit 1
fi

log_warn "Applying firewall baseline now..."
for cmd in "${commands[@]}"; do
    log_info "Running: $cmd"
    bash -lc "$cmd"
done

echo ""
log_ok "Firewall baseline apply complete."
log_info "Rollback (if needed):"
echo "  sudo ufw --force disable"
