#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${LOG_DIR:-/tmp/deploy-logs}"
LOG_FILE=""
TAIL_LINES=200
LIST_ONLY=false
SHOW_EVIDENCE=true
SHOW_METADATA=true
SHOW_ALL=false

usage() {
  cat <<EOF
Usage: $0 [options]

View deployment logs produced by deploy/webhook/deploy.sh.

Options:
  --log-dir DIR       Deployment log directory (default: /tmp/deploy-logs)
  --file FILE         Specific deploy log file (absolute path or name inside --log-dir)
  --tail N            Number of lines to tail when showing latest/specified log (default: 200)
  --all               Print the full selected log instead of tail output
  --list              List available deploy logs and exit
  --no-evidence       Do not print inferred evidence bundle path
  --no-metadata       Do not print file metadata header
  -h, --help          Show this help

Examples:
  $0
  $0 --tail 80
  $0 --file deploy-20260222-000000.log
  $0 --log-dir /var/log/pmdl/deploy --list
EOF
}

require_integer() {
  local value="$1"
  local label="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] ${label} must be a non-negative integer: $value" >&2
    exit 1
  fi
}

resolve_mtime_epoch() {
  local file="$1"
  local ts=""
  ts="$(stat -f "%m" "$file" 2>/dev/null || true)"
  if [[ -z "$ts" ]]; then
    ts="$(stat -c "%Y" "$file" 2>/dev/null || true)"
  fi
  echo "${ts:-0}"
}

resolve_human_time() {
  local file="$1"
  local ts=""
  ts="$(stat -f "%Sm" -t "%Y-%m-%dT%H:%M:%SZ" "$file" 2>/dev/null || true)"
  if [[ -z "$ts" ]]; then
    ts="$(date -u -r "$(resolve_mtime_epoch "$file")" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || true)"
  fi
  echo "${ts:-unknown}"
}

resolve_file_size_bytes() {
  local file="$1"
  local size=""
  size="$(stat -f "%z" "$file" 2>/dev/null || true)"
  if [[ -z "$size" ]]; then
    size="$(stat -c "%s" "$file" 2>/dev/null || true)"
  fi
  echo "${size:-unknown}"
}

list_logs() {
  if [[ ! -d "$LOG_DIR" ]]; then
    echo "[ERROR] Log directory not found: $LOG_DIR" >&2
    exit 1
  fi

  local count=0
  while IFS= read -r file; do
    count=$((count + 1))
    printf "%s\t%s\t%s\n" \
      "$(resolve_human_time "$file")" \
      "$(resolve_file_size_bytes "$file")" \
      "$file"
  done < <(find "$LOG_DIR" -maxdepth 1 -type f -name "deploy-*.log" | sort -r)

  if [[ "$count" -eq 0 ]]; then
    echo "[WARN] No deploy logs found in $LOG_DIR" >&2
    exit 1
  fi
}

select_latest_log() {
  local latest=""
  local latest_epoch=-1
  local candidate

  while IFS= read -r candidate; do
    local epoch
    epoch="$(resolve_mtime_epoch "$candidate")"
    if (( epoch > latest_epoch )); then
      latest_epoch="$epoch"
      latest="$candidate"
    fi
  done < <(find "$LOG_DIR" -maxdepth 1 -type f -name "deploy-*.log" | sort)

  if [[ -z "$latest" ]]; then
    echo "[ERROR] No deploy-*.log files found in $LOG_DIR" >&2
    exit 1
  fi

  echo "$latest"
}

resolve_log_file() {
  if [[ -n "$LOG_FILE" ]]; then
    if [[ -f "$LOG_FILE" ]]; then
      echo "$LOG_FILE"
      return
    fi

    if [[ -f "${LOG_DIR%/}/$LOG_FILE" ]]; then
      echo "${LOG_DIR%/}/$LOG_FILE"
      return
    fi

    echo "[ERROR] Log file not found: $LOG_FILE" >&2
    exit 1
  fi

  select_latest_log
}

print_evidence_hint() {
  local log_file="$1"
  local extracted=""
  extracted="$(grep -F "Evidence bundle:" "$log_file" | tail -n 1 | sed -E 's/^.*Evidence bundle: //')"

  if [[ -n "$extracted" ]]; then
    echo "Evidence bundle: $extracted"
    return
  fi

  if [[ -d "${LOG_DIR%/}/evidence" ]]; then
    local latest_evidence=""
    latest_evidence="$(find "${LOG_DIR%/}/evidence" -maxdepth 1 -mindepth 1 -type d | sort -r | head -n 1)"
    if [[ -n "$latest_evidence" ]]; then
      echo "Evidence bundle (latest detected): $latest_evidence"
      return
    fi
  fi

  echo "Evidence bundle: not detected in log output"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --log-dir)
      LOG_DIR="${2:-}"
      [[ -n "$LOG_DIR" ]] || { echo "[ERROR] --log-dir requires a value" >&2; exit 1; }
      shift 2
      ;;
    --file)
      LOG_FILE="${2:-}"
      [[ -n "$LOG_FILE" ]] || { echo "[ERROR] --file requires a value" >&2; exit 1; }
      shift 2
      ;;
    --tail)
      TAIL_LINES="${2:-}"
      [[ -n "$TAIL_LINES" ]] || { echo "[ERROR] --tail requires a value" >&2; exit 1; }
      require_integer "$TAIL_LINES" "--tail"
      shift 2
      ;;
    --list)
      LIST_ONLY=true
      shift
      ;;
    --all)
      SHOW_ALL=true
      shift
      ;;
    --no-evidence)
      SHOW_EVIDENCE=false
      shift
      ;;
    --no-metadata)
      SHOW_METADATA=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$LIST_ONLY" == true ]]; then
  list_logs
  exit 0
fi

selected_log="$(resolve_log_file)"

if [[ "$SHOW_METADATA" == true ]]; then
  echo "Log file: $selected_log"
  echo "Modified: $(resolve_human_time "$selected_log")"
  echo "Size (bytes): $(resolve_file_size_bytes "$selected_log")"
fi

if [[ "$SHOW_EVIDENCE" == true ]]; then
  print_evidence_hint "$selected_log"
fi

echo "-----"
if [[ "$SHOW_ALL" == true ]]; then
  cat "$selected_log"
else
  tail -n "$TAIL_LINES" "$selected_log"
fi
