#!/bin/bash
# ==============================================================
# Aggregate Restore Orchestrator (Top-Level Operational)
# ==============================================================
# Purpose: Restore all database engines (PostgreSQL, MySQL,
#          MongoDB) from a backup directory in a single
#          coordinated operation.
#
# Usage:   ./scripts/restore-all.sh <backup_dir>
#          ./scripts/restore-all.sh /var/backups/pmdl/latest
#          ./scripts/restore-all.sh /var/backups/pmdl/pre-deploy
#
# Referenced by:
#   - docs/DEPLOYMENT.md
#   - docs/system-design-docs/06-operations/OPERATIONAL-RUNBOOK.md
#   - docs/system-design-docs/06-operations/BACKUP-RECOVERY-PROCEDURES.md
#   - docs/system-design-docs/06-operations/INCIDENT-RESPONSE-PLAN.md
# ==============================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ==============================================================
# Helper Functions
# ==============================================================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

error_exit() {
    log "ERROR: $*"
    exit 1
}

usage() {
    cat <<EOF
Usage: $0 <backup_dir>

Restore all database engines from backup files in a directory.
Calls restore-postgres.sh, restore-mysql.sh, and restore-mongodb.sh
sequentially with --no-confirm (confirmation happens once at the
aggregate level).

Arguments:
    backup_dir        Directory containing backup files, e.g.:
                        /var/backups/pmdl/latest
                        /var/backups/pmdl/pre-deploy

The script searches for the most recent backup file for each engine:
    PostgreSQL:  *.sql.gz or *.dump.gz in <backup_dir>/postgres/
    MySQL:       *.dump.gz or *.sql.gz in <backup_dir>/mysql/
    MongoDB:     *.archive.gz or *.gz   in <backup_dir>/mongodb/

If an engine's subdirectory or backup file is not found, that engine
is skipped (not treated as a fatal error).

Options:
    -h, --help        Show this help

Examples:
    $0 /var/backups/pmdl/latest
    $0 /var/backups/pmdl/pre-deploy

EOF
    exit 0
}

# Find the most recent file matching a glob pattern in a directory
find_latest_backup() {
    local dir="$1"
    shift
    local patterns=("$@")
    local latest=""

    for pattern in "${patterns[@]}"; do
        # Use ls -t to sort by modification time, take the first match
        local candidate
        candidate="$(ls -t "$dir"/$pattern 2>/dev/null | head -1 || true)"
        if [[ -n "$candidate" && -f "$candidate" ]]; then
            if [[ -z "$latest" ]]; then
                latest="$candidate"
            else
                # Compare modification times; keep the newer one
                if [[ "$candidate" -nt "$latest" ]]; then
                    latest="$candidate"
                fi
            fi
        fi
    done

    echo "$latest"
}

# ==============================================================
# Main Execution
# ==============================================================

main() {
    local backup_dir=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                usage
                ;;
            -*)
                error_exit "Unknown option: $1"
                ;;
            *)
                backup_dir="$1"
                shift
                ;;
        esac
    done

    if [[ -z "$backup_dir" ]]; then
        echo "Usage: $0 <backup_dir>"
        echo ""
        echo "Run '$0 --help' for details."
        exit 1
    fi

    [[ -d "$backup_dir" ]] || error_exit "Backup directory not found: $backup_dir"

    # Locate backup files for each engine
    local pg_file="" mysql_file="" mongo_file=""
    local engines_found=0

    if [[ -d "$backup_dir/postgres" ]]; then
        pg_file="$(find_latest_backup "$backup_dir/postgres" "*.sql.gz" "*.dump.gz")"
    fi
    if [[ -d "$backup_dir/mysql" ]]; then
        mysql_file="$(find_latest_backup "$backup_dir/mysql" "*.dump.gz" "*.sql.gz")"
    fi
    if [[ -d "$backup_dir/mongodb" ]]; then
        mongo_file="$(find_latest_backup "$backup_dir/mongodb" "*.archive.gz" "*.gz")"
    fi

    echo ""
    echo "=========================================="
    echo "  Aggregate Database Restore"
    echo "=========================================="
    echo ""
    echo "Backup directory: $backup_dir"
    echo ""

    # Display what was found
    if [[ -n "$pg_file" ]]; then
        local pg_size
        pg_size="$(du -h "$pg_file" | cut -f1)"
        echo "  PostgreSQL: $pg_file ($pg_size)"
        engines_found=$((engines_found + 1))
    else
        echo "  PostgreSQL: (no backup found)"
    fi

    if [[ -n "$mysql_file" ]]; then
        local mysql_size
        mysql_size="$(du -h "$mysql_file" | cut -f1)"
        echo "  MySQL:      $mysql_file ($mysql_size)"
        engines_found=$((engines_found + 1))
    else
        echo "  MySQL:      (no backup found)"
    fi

    if [[ -n "$mongo_file" ]]; then
        local mongo_size
        mongo_size="$(du -h "$mongo_file" | cut -f1)"
        echo "  MongoDB:    $mongo_file ($mongo_size)"
        engines_found=$((engines_found + 1))
    else
        echo "  MongoDB:    (no backup found)"
    fi

    echo ""

    if [[ "$engines_found" -eq 0 ]]; then
        error_exit "No backup files found in $backup_dir. Expected subdirectories: postgres/, mysql/, mongodb/"
    fi

    # Interactive confirmation (single confirmation for all engines)
    echo "WARNING: This will restore ALL databases listed above."
    echo "         Existing data in each engine will be overwritten."
    echo ""
    read -p "Type RESTORE to confirm: " confirm
    if [[ "$confirm" != "RESTORE" ]]; then
        log "Restore cancelled by user"
        exit 0
    fi
    echo ""

    # Track results
    local total=0 succeeded=0 failed=0 skipped=0

    # --- PostgreSQL ---
    total=$((total + 1))
    if [[ -n "$pg_file" ]]; then
        echo ""
        echo "=== PostgreSQL Recovery ==="
        echo "Backup file: $pg_file"
        echo ""
        if "$SCRIPT_DIR/restore-postgres.sh" --no-confirm "$pg_file"; then
            succeeded=$((succeeded + 1))
        else
            failed=$((failed + 1))
            log "PostgreSQL restore FAILED"
        fi
    else
        skipped=$((skipped + 1))
        log "PostgreSQL restore skipped (no backup file)"
    fi

    # --- MySQL ---
    total=$((total + 1))
    if [[ -n "$mysql_file" ]]; then
        echo ""
        echo "=== MySQL Recovery ==="
        echo "Backup file: $mysql_file"
        echo ""
        if "$SCRIPT_DIR/restore-mysql.sh" --no-confirm "$mysql_file"; then
            succeeded=$((succeeded + 1))
        else
            failed=$((failed + 1))
            log "MySQL restore FAILED"
        fi
    else
        skipped=$((skipped + 1))
        log "MySQL restore skipped (no backup file)"
    fi

    # --- MongoDB ---
    total=$((total + 1))
    if [[ -n "$mongo_file" ]]; then
        echo ""
        echo "=== MongoDB Recovery ==="
        echo "Backup file: $mongo_file"
        echo ""
        if "$SCRIPT_DIR/restore-mongodb.sh" --no-confirm "$mongo_file"; then
            succeeded=$((succeeded + 1))
        else
            failed=$((failed + 1))
            log "MongoDB restore FAILED"
        fi
    else
        skipped=$((skipped + 1))
        log "MongoDB restore skipped (no backup file)"
    fi

    # Summary
    echo ""
    echo "=========================================="
    echo "  Aggregate Restore Summary"
    echo "=========================================="
    echo ""
    echo "  Engines attempted: $total"
    echo "  Succeeded:         $succeeded"
    echo "  Failed:            $failed"
    echo "  Skipped:           $skipped"
    echo ""

    if [[ "$failed" -gt 0 ]]; then
        error_exit "One or more database restores failed. Review output above."
    fi

    log "All database restores completed successfully"
    echo ""
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
