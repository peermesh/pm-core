#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOFU="$SCRIPT_DIR/tofu.sh"
STACK_DIR="$ROOT_DIR/stacks/pilot-single-vps"
BACKUP_DIR="$ROOT_DIR/state-backups"
ALLOW_EMPTY=false
SUFFIX="manual"

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --stack-dir PATH      OpenTofu stack directory (default: stacks/pilot-single-vps)
  --backup-dir PATH     Backup output directory (default: state-backups)
  --suffix NAME         Backup filename suffix (default: manual)
  --allow-empty         Do not fail when no state exists yet
  -h, --help            Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stack-dir)
            STACK_DIR="${2:-}"
            shift 2
            ;;
        --backup-dir)
            BACKUP_DIR="${2:-}"
            shift 2
            ;;
        --suffix)
            SUFFIX="${2:-}"
            shift 2
            ;;
        --allow-empty)
            ALLOW_EMPTY=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "[ERROR] Unknown option: $1" >&2
            usage
            exit 1
            ;;
    esac
done

mkdir -p "$BACKUP_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
STATE_FILE="$BACKUP_DIR/pilot-single-vps-${TS}-${SUFFIX}.tfstate"
EMPTY_NOTE="$BACKUP_DIR/pilot-single-vps-${TS}-${SUFFIX}-EMPTY.txt"

if "$TOFU" -chdir="$STACK_DIR" state pull > "$STATE_FILE" 2>/dev/null; then
    if [[ -s "$STATE_FILE" ]]; then
        echo "Backup written: $STATE_FILE"
        exit 0
    fi
fi

rm -f "$STATE_FILE"

if [[ "$ALLOW_EMPTY" == true ]]; then
    cat > "$EMPTY_NOTE" <<NOTE
No state snapshot was available at backup time.
Stack: $STACK_DIR
Timestamp (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)
NOTE
    echo "No state available yet; wrote note: $EMPTY_NOTE"
    exit 0
fi

echo "[ERROR] Failed to pull state and --allow-empty was not provided." >&2
exit 1
