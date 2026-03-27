#!/usr/bin/env bash
# ==============================================================
# Nightly Security Audit - Cron Wrapper
# ==============================================================
# Runs run-full-audit.sh on schedule, saves output, compares
# finding counts against the previous day, and alerts on
# regressions. Rotates old audit logs (keeps 30 days).
#
# Installation:
#   crontab -e
#   0 1 * * * /opt/core/scripts/security/nightly-audit-cron.sh
#
# Or via /etc/cron.d/pmdl-security:
#   0 1 * * * root /opt/core/scripts/security/nightly-audit-cron.sh
#
# Dependencies:
#   - scripts/security/run-full-audit.sh (same directory)
#
# Exit codes:
#   0 - Audit completed (regardless of finding count)
#   1 - Audit script not found or execution error
# ==============================================================
set -euo pipefail

# --------------------------------------------------------------
# Configuration
# --------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${PMDL_DEPLOY_DIR:-/opt/core}"
LOG_DIR="${PMDL_LOG_DIR:-/var/log/security-audit}"
RETAIN_DAYS=30

TODAY=$(date +%Y-%m-%d)
REPORT="${LOG_DIR}/audit-${TODAY}.md"

# --------------------------------------------------------------
# Setup
# --------------------------------------------------------------
mkdir -p "$LOG_DIR"

# --------------------------------------------------------------
# Pre-flight: check that run-full-audit.sh exists
# --------------------------------------------------------------
AUDIT_SCRIPT="${SCRIPT_DIR}/run-full-audit.sh"
if [[ ! -f "$AUDIT_SCRIPT" ]]; then
    AUDIT_SCRIPT="${DEPLOY_DIR}/scripts/security/run-full-audit.sh"
fi

if [[ ! -f "$AUDIT_SCRIPT" ]]; then
    printf "%s [nightly-audit] ERROR: run-full-audit.sh not found\n" "$TODAY" \
        >> "${LOG_DIR}/cron.log"
    exit 1
fi

# --------------------------------------------------------------
# Run the audit
# --------------------------------------------------------------
# Determine mode: if running on the VPS (localhost), use --remote localhost;
# otherwise use --local.
AUDIT_MODE="--local"
if [[ -d "$DEPLOY_DIR" ]] && [[ "$(hostname -I 2>/dev/null | awk '{print $1}')" != "" ]]; then
    # Running on VPS — use remote localhost to get runtime checks
    AUDIT_MODE="--remote localhost"
fi

cd "$DEPLOY_DIR" 2>/dev/null || cd "$SCRIPT_DIR/../.."

# shellcheck disable=SC2086
bash "$AUDIT_SCRIPT" $AUDIT_MODE --output "$REPORT" >> "${LOG_DIR}/cron.log" 2>&1 || true

# Verify report was created
if [[ ! -f "$REPORT" ]]; then
    printf "%s [nightly-audit] WARN: Audit completed but no report file created\n" "$TODAY" \
        >> "${LOG_DIR}/cron.log"
    exit 0
fi

# --------------------------------------------------------------
# Compare against previous day
# --------------------------------------------------------------
# Find the most recent report BEFORE today
PREV_REPORT=""
PREV_REPORT=$(find "$LOG_DIR" -maxdepth 1 -name 'audit-*.md' -not -name "audit-${TODAY}.md" \
    2>/dev/null | sort | tail -1) || true

if [[ -n "$PREV_REPORT" && -f "$PREV_REPORT" ]]; then
    # Count CRITICAL and HIGH lines (case-insensitive, various formats)
    prev_critical=$(grep -ci 'CRITICAL' "$PREV_REPORT" 2>/dev/null || printf '0')
    curr_critical=$(grep -ci 'CRITICAL' "$REPORT" 2>/dev/null || printf '0')
    prev_high=$(grep -ci 'HIGH' "$PREV_REPORT" 2>/dev/null || printf '0')
    curr_high=$(grep -ci 'HIGH' "$REPORT" 2>/dev/null || printf '0')

    prev_total=$((prev_critical + prev_high))
    curr_total=$((curr_critical + curr_high))

    if [[ "$curr_total" -gt "$prev_total" ]]; then
        ALERT_FILE="${LOG_DIR}/ALERT-${TODAY}.txt"
        {
            printf "ALERT: CRITICAL+HIGH finding count increased\n"
            printf "Date: %s\n" "$TODAY"
            printf "Previous (%s): CRITICAL=%s HIGH=%s TOTAL=%s\n" \
                "$(basename "$PREV_REPORT")" "$prev_critical" "$prev_high" "$prev_total"
            printf "Current  (%s): CRITICAL=%s HIGH=%s TOTAL=%s\n" \
                "$(basename "$REPORT")" "$curr_critical" "$curr_high" "$curr_total"
            printf "\nReview: %s\n" "$REPORT"
        } > "$ALERT_FILE"

        printf "%s [nightly-audit] ALERT written: %s\n" "$TODAY" "$ALERT_FILE" \
            >> "${LOG_DIR}/cron.log"
    fi
fi

# --------------------------------------------------------------
# Upstream update check (skip if not a git repo)
# --------------------------------------------------------------
UPSTREAM_CHECK_SCRIPT="${SCRIPT_DIR}/../check-upstream-updates.sh"
if [[ ! -f "$UPSTREAM_CHECK_SCRIPT" ]]; then
    UPSTREAM_CHECK_SCRIPT="${DEPLOY_DIR}/scripts/check-upstream-updates.sh"
fi

if [[ -f "$UPSTREAM_CHECK_SCRIPT" ]]; then
    if [[ -d "${DEPLOY_DIR}/.git" ]]; then
        UPSTREAM_OUTPUT=""
        UPSTREAM_EXIT=0
        UPSTREAM_OUTPUT=$(bash "$UPSTREAM_CHECK_SCRIPT" "$DEPLOY_DIR" --quiet 2>&1) || UPSTREAM_EXIT=$?

        if [[ $UPSTREAM_EXIT -eq 1 || $UPSTREAM_EXIT -eq 2 ]]; then
            # Updates available -- append to alert file
            ALERT_FILE="${LOG_DIR}/ALERT-${TODAY}.txt"
            {
                if [[ $UPSTREAM_EXIT -eq 2 ]]; then
                    printf "\nCRITICAL UPSTREAM UPDATE AVAILABLE\n"
                else
                    printf "\nUPSTREAM UPDATES AVAILABLE\n"
                fi
                printf "%s\n" "$UPSTREAM_OUTPUT"
            } >> "$ALERT_FILE"

            printf "%s [nightly-audit] Upstream updates detected (exit %s)\n" "$TODAY" "$UPSTREAM_EXIT" \
                >> "${LOG_DIR}/cron.log"
        else
            printf "%s [nightly-audit] Upstream check: up to date\n" "$TODAY" \
                >> "${LOG_DIR}/cron.log"
        fi
    else
        printf "%s [nightly-audit] Upstream check skipped: %s is not a git repo\n" "$TODAY" "$DEPLOY_DIR" \
            >> "${LOG_DIR}/cron.log"
    fi
else
    printf "%s [nightly-audit] Upstream check skipped: check-upstream-updates.sh not found\n" "$TODAY" \
        >> "${LOG_DIR}/cron.log"
fi

# --------------------------------------------------------------
# Rotate old audit logs (keep RETAIN_DAYS days)
# --------------------------------------------------------------
find "$LOG_DIR" -maxdepth 1 -name 'audit-*.md' -mtime +"$RETAIN_DAYS" -delete 2>/dev/null || true
find "$LOG_DIR" -maxdepth 1 -name 'ALERT-*.txt' -mtime +"$RETAIN_DAYS" -delete 2>/dev/null || true

printf "%s [nightly-audit] Completed. Report: %s\n" "$TODAY" "$REPORT" \
    >> "${LOG_DIR}/cron.log"

exit 0
