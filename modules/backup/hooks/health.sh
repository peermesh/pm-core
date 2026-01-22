#!/bin/bash
# ==============================================================
# Backup Module - Health Check Hook
# ==============================================================
# Purpose: Check backup module health and freshness
# Called: Periodically or on-demand via pmdl module health backup
#
# Exit codes:
#   0 - Healthy
#   1 - Unhealthy (critical issue)
#   2 - Degraded (non-critical warning)
#
# Output format: JSON for dashboard integration
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_LOCAL_PATH="${BACKUP_LOCAL_PATH:-/var/backups/pmdl}"

# Output mode: "json" or "text"
OUTPUT_MODE="${1:-text}"

# Health status tracking
HEALTH_STATUS="healthy"
HEALTH_MESSAGES=()
LAST_POSTGRES_BACKUP=""
LAST_VOLUME_BACKUP=""
LAST_OFFSITE_SYNC=""
NEXT_BACKUP=""
STORAGE_USED=""

# ==============================================================
# Check Functions
# ==============================================================

check_service_running() {
    local container="pmdl_backup"

    if docker ps --filter "name=${container}" --filter "status=running" --format '{{.Names}}' | grep -q "$container"; then
        return 0
    else
        HEALTH_STATUS="unhealthy"
        HEALTH_MESSAGES+=("Backup service not running")
        return 1
    fi
}

check_backup_freshness() {
    local marker_file="${BACKUP_LOCAL_PATH}/.last_successful_backup"
    local max_age_hours=48  # Alert if no backup in 48 hours

    if [[ -f "$marker_file" ]]; then
        local last_backup=$(cat "$marker_file" 2>/dev/null)
        LAST_POSTGRES_BACKUP="$last_backup"

        # Check age in hours
        local age_seconds=$(($(date +%s) - $(date -d "$last_backup" +%s 2>/dev/null || echo 0)))
        local age_hours=$((age_seconds / 3600))

        if [[ $age_hours -gt $max_age_hours ]]; then
            HEALTH_STATUS="degraded"
            HEALTH_MESSAGES+=("Last backup is ${age_hours} hours old (threshold: ${max_age_hours}h)")
        fi
    else
        # No backup marker - might be first run
        if [[ -d "${BACKUP_LOCAL_PATH}/postgres/daily" ]] && ls "${BACKUP_LOCAL_PATH}/postgres/daily"/*.gz &> /dev/null; then
            # Backups exist but no marker - degrade status
            HEALTH_STATUS="degraded"
            HEALTH_MESSAGES+=("Backup marker file missing")
        fi
    fi
}

check_postgres_backups() {
    local backup_dir="${BACKUP_LOCAL_PATH}/postgres/daily"

    if [[ -d "$backup_dir" ]]; then
        local latest=$(ls -t "${backup_dir}"/*.gz 2>/dev/null | head -1)
        if [[ -n "$latest" ]]; then
            local filename=$(basename "$latest")
            local mtime=$(stat -c %Y "$latest" 2>/dev/null || stat -f %m "$latest" 2>/dev/null || echo 0)
            local age_hours=$(( ($(date +%s) - mtime) / 3600 ))

            if [[ -z "$LAST_POSTGRES_BACKUP" ]]; then
                LAST_POSTGRES_BACKUP=$(date -d "@$mtime" -Iseconds 2>/dev/null || date -r "$mtime" +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo "unknown")
            fi

            # Check for very old backups (> 7 days)
            if [[ $age_hours -gt 168 ]]; then
                HEALTH_STATUS="degraded"
                HEALTH_MESSAGES+=("PostgreSQL backup is ${age_hours} hours old")
            fi
        else
            HEALTH_MESSAGES+=("No PostgreSQL backups found")
        fi
    fi
}

check_volume_backups() {
    local backup_dir="${BACKUP_LOCAL_PATH}/volumes/tar"

    if [[ -d "$backup_dir" ]]; then
        local latest=$(ls -t "${backup_dir}"/*.tar.gz 2>/dev/null | head -1)
        if [[ -n "$latest" ]]; then
            local mtime=$(stat -c %Y "$latest" 2>/dev/null || stat -f %m "$latest" 2>/dev/null || echo 0)
            LAST_VOLUME_BACKUP=$(date -d "@$mtime" -Iseconds 2>/dev/null || date -r "$mtime" +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo "unknown")
        fi
    fi
}

check_offsite_sync() {
    local marker_file="${BACKUP_LOCAL_PATH}/.last_offsite_sync"

    if [[ -f "$marker_file" ]]; then
        LAST_OFFSITE_SYNC=$(cat "$marker_file" 2>/dev/null)
    else
        # Off-site sync is optional
        LAST_OFFSITE_SYNC="not configured"
    fi
}

check_storage_usage() {
    if [[ -d "$BACKUP_LOCAL_PATH" ]]; then
        STORAGE_USED=$(du -sh "$BACKUP_LOCAL_PATH" 2>/dev/null | cut -f1 || echo "unknown")

        # Check available disk space
        local available_mb=$(df -m "$BACKUP_LOCAL_PATH" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
        if [[ $available_mb -lt 1024 ]]; then
            HEALTH_STATUS="degraded"
            HEALTH_MESSAGES+=("Low disk space: ${available_mb}MB available")
        fi
    fi
}

calculate_next_backup() {
    # Parse cron schedule to estimate next backup time
    # This is a simplification - actual cron parsing is complex
    local schedule="${BACKUP_SCHEDULE_POSTGRES:-0 2 * * *}"
    local hour=$(echo "$schedule" | awk '{print $2}')

    local now_hour=$(date +%H)
    if [[ $now_hour -ge $hour ]]; then
        # Next backup is tomorrow
        NEXT_BACKUP=$(date -d "tomorrow $hour:00" -Iseconds 2>/dev/null || echo "tomorrow ${hour}:00")
    else
        # Next backup is today
        NEXT_BACKUP=$(date -d "today $hour:00" -Iseconds 2>/dev/null || echo "today ${hour}:00")
    fi
}

# ==============================================================
# Output Functions
# ==============================================================

output_json() {
    local status_code=0
    [[ "$HEALTH_STATUS" == "degraded" ]] && status_code=2
    [[ "$HEALTH_STATUS" == "unhealthy" ]] && status_code=1

    local messages_json="[]"
    if [[ ${#HEALTH_MESSAGES[@]} -gt 0 ]]; then
        messages_json=$(printf '%s\n' "${HEALTH_MESSAGES[@]}" | jq -R . | jq -s .)
    fi

    cat << EOF
{
  "status": "${HEALTH_STATUS}",
  "statusCode": ${status_code},
  "timestamp": "$(date -Iseconds)",
  "module": "backup",
  "checks": {
    "serviceRunning": $(docker ps --filter "name=pmdl_backup" --filter "status=running" -q | grep -q . && echo "true" || echo "false"),
    "backupFresh": $([ "$HEALTH_STATUS" == "healthy" ] && echo "true" || echo "false")
  },
  "lastBackups": {
    "postgres": "${LAST_POSTGRES_BACKUP:-never}",
    "volumes": "${LAST_VOLUME_BACKUP:-never}",
    "offsiteSync": "${LAST_OFFSITE_SYNC:-not configured}"
  },
  "nextScheduled": "${NEXT_BACKUP:-unknown}",
  "storageUsed": "${STORAGE_USED:-unknown}",
  "messages": ${messages_json}
}
EOF
}

output_text() {
    echo "========================================"
    echo "Backup Module Health Check"
    echo "========================================"
    echo ""
    echo "Status: ${HEALTH_STATUS^^}"
    echo ""
    echo "Last Backups:"
    echo "  PostgreSQL:  ${LAST_POSTGRES_BACKUP:-never}"
    echo "  Volumes:     ${LAST_VOLUME_BACKUP:-never}"
    echo "  Off-site:    ${LAST_OFFSITE_SYNC:-not configured}"
    echo ""
    echo "Next Scheduled: ${NEXT_BACKUP:-unknown}"
    echo "Storage Used:   ${STORAGE_USED:-unknown}"
    echo ""

    if [[ ${#HEALTH_MESSAGES[@]} -gt 0 ]]; then
        echo "Messages:"
        for msg in "${HEALTH_MESSAGES[@]}"; do
            echo "  - $msg"
        done
        echo ""
    fi

    echo "========================================"
}

# ==============================================================
# Main
# ==============================================================

main() {
    # Run all checks
    check_service_running
    check_backup_freshness
    check_postgres_backups
    check_volume_backups
    check_offsite_sync
    check_storage_usage
    calculate_next_backup

    # Output results
    if [[ "$OUTPUT_MODE" == "json" ]]; then
        output_json
    else
        output_text
    fi

    # Return appropriate exit code
    case "$HEALTH_STATUS" in
        healthy)
            exit 0
            ;;
        degraded)
            exit 2
            ;;
        unhealthy)
            exit 1
            ;;
    esac
}

main "$@"
