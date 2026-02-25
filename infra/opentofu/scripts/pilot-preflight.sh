#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOFU="$SCRIPT_DIR/tofu.sh"
BACKUP="$SCRIPT_DIR/state-backup.sh"
STACK_DIR="$ROOT_DIR/stacks/pilot-single-vps"
VAR_FILE="$ROOT_DIR/env/pilot-single-vps.auto.tfvars.example"

if [[ ! -f "$VAR_FILE" ]]; then
    echo "[ERROR] Missing var file: $VAR_FILE" >&2
    exit 1
fi

echo "[INFO] Stack: $STACK_DIR"
echo "[INFO] Var file: $VAR_FILE"

"$TOFU" -chdir="$STACK_DIR" fmt -check -recursive
"$TOFU" -chdir="$STACK_DIR" init -backend=false
"$TOFU" -chdir="$STACK_DIR" validate
"$BACKUP" --stack-dir "$STACK_DIR" --backup-dir "$ROOT_DIR/state-backups" --suffix preflight --allow-empty

cat <<OUT
[OK] OpenTofu pilot preflight completed.
[INFO] Next step: run pilot-credentials.sh setup, then pilot-apply-readiness.sh with live var file.
OUT
