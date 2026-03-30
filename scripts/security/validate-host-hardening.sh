#!/usr/bin/env bash
# ==============================================================
# Host Hardening Validator
# ==============================================================
# Checks minimum host-level hardening signals for deployment:
# - ufw active (when installed)
# - iptables INPUT policy not ACCEPT
# - DOCKER-USER chain has at least one rule beyond default return
#
# By default this script is advisory and returns 0.
# Use --strict to fail when hardening failures are detected.
# ==============================================================

set -euo pipefail

STRICT=false
FAILURES=0
WARNINGS=0
PASSES=0

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --strict      Exit non-zero when hardening failures are detected
  --help, -h    Show this help message
USAGE
}

log_pass() {
    PASSES=$((PASSES + 1))
    echo "[PASS] $1"
}

log_warn() {
    WARNINGS=$((WARNINGS + 1))
    echo "[WARN] $1"
}

log_fail() {
    FAILURES=$((FAILURES + 1))
    echo "[FAIL] $1"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --strict)
            STRICT=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "[ERROR] Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

echo "== Host Hardening Validation =="

if command -v ufw >/dev/null 2>&1; then
    ufw_status="$(ufw status 2>/dev/null || true)"
    if printf '%s' "$ufw_status" | grep -qi "Status: active"; then
        log_pass "UFW is active"
    else
        log_fail "UFW is installed but not active"
    fi
else
    log_warn "UFW not installed; skipping UFW status check"
fi

if command -v iptables >/dev/null 2>&1; then
    input_policy="$(iptables -S INPUT 2>/dev/null | awk '/^-P INPUT / {print $3; exit}' || true)"
    if [[ -z "$input_policy" ]]; then
        log_warn "Could not read iptables INPUT policy"
    elif [[ "$input_policy" == "ACCEPT" ]]; then
        log_fail "iptables INPUT policy is ACCEPT"
    else
        log_pass "iptables INPUT policy is $input_policy"
    fi

    docker_user_rules="$(iptables -S DOCKER-USER 2>/dev/null || true)"
    if [[ -z "$docker_user_rules" ]]; then
        log_warn "DOCKER-USER chain is missing or inaccessible"
    else
        # Count non-default rules; default return-only chain is weak baseline.
        non_default_rule_count="$(printf '%s\n' "$docker_user_rules" | awk '
            /^-A DOCKER-USER / {
                if ($0 !~ /-j RETURN$/) count++
            }
            END { print count + 0 }
        ')"
        if [[ "$non_default_rule_count" -gt 0 ]]; then
            log_pass "DOCKER-USER has $non_default_rule_count custom rule(s)"
        else
            log_fail "DOCKER-USER has no custom rules beyond default RETURN"
        fi
    fi
else
    log_warn "iptables not available; skipping firewall chain checks"
fi

echo ""
echo "Host hardening summary: FAILURES=${FAILURES} WARNINGS=${WARNINGS} PASSES=${PASSES} STRICT=${STRICT}"

if [[ "$STRICT" == true && "$FAILURES" -gt 0 ]]; then
    exit 1
fi

exit 0
