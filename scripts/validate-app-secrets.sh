#!/usr/bin/env bash
set -euo pipefail

APP="${1:-}"
ENV_NAME="${2:-production}"

if [[ -z "$APP" ]]; then
  echo "Usage: $0 <app> [environment]"
  echo "Example: $0 ghost production"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQUIRED_FILE="$PROJECT_DIR/examples/$APP/secrets-required.txt"
ENCRYPTED_FILE="$PROJECT_DIR/secrets/${ENV_NAME}.enc.yaml"

if [[ ! -f "$REQUIRED_FILE" ]]; then
  echo "[ERROR] Missing app contract: $REQUIRED_FILE"
  exit 1
fi

if [[ ! -f "$ENCRYPTED_FILE" ]]; then
  echo "[ERROR] Missing encrypted secrets file: $ENCRYPTED_FILE"
  exit 1
fi

if ! command -v sops >/dev/null 2>&1; then
  echo "[ERROR] sops is required for validation"
  exit 1
fi

export SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"

tmp_file="$(mktemp)"
cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT

if ! sops -d "$ENCRYPTED_FILE" > "$tmp_file"; then
  echo "[ERROR] Failed to decrypt $ENCRYPTED_FILE"
  exit 1
fi

echo "Validating app=$APP env=$ENV_NAME"

missing=0
while IFS= read -r key; do
  key="$(echo "$key" | xargs)"
  [[ -z "$key" ]] && continue
  [[ "$key" == \#* ]] && continue

  line="$(grep -E "^${key}:" "$tmp_file" || true)"
  if [[ -z "$line" ]]; then
    echo "  [MISSING] $key"
    missing=$((missing + 1))
    continue
  fi

  value="$(echo "$line" | sed -E "s/^${key}:[[:space:]]*//")"
  value="$(echo "$value" | sed -E 's/^"|"$//g')"

  if [[ -z "$value" || "$value" == "CHANGE_ME" ]]; then
    echo "  [INVALID] $key"
    missing=$((missing + 1))
  else
    echo "  [OK] $key"
  fi

done < "$REQUIRED_FILE"

if [[ $missing -gt 0 ]]; then
  echo "Validation failed: $missing key(s) missing/invalid"
  exit 1
fi

echo "Validation passed"
