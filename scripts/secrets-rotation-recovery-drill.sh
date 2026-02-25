#!/usr/bin/env bash
# ==============================================================
# Secrets Rotation + Recovery Drill
# ==============================================================
# Executes a deterministic secrets rotation drill with auditable output.
# Default mode is non-destructive and writes artifacts to evidence directory.
#
# Example:
#   ./scripts/secrets-rotation-recovery-drill.sh --environment staging --key postgres_password
#
# Optional destructive drill (applies and restores):
#   ./scripts/secrets-rotation-recovery-drill.sh --environment staging --key postgres_password --apply
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SECRETS_DIR="$PROJECT_DIR/secrets"
PARITY_SCRIPT="$SCRIPT_DIR/validate-secret-parity.sh"

ENVIRONMENT="staging"
KEY_NAME=""
EVIDENCE_ROOT="${SECRETS_DRILL_EVIDENCE_ROOT:-/tmp/pmdl-secrets-drills}"
APPLY_CHANGES=false
KEEP_TEMP=false
ENCRYPTED_FILE_OVERRIDE=""
SOPS_AGE_KEY_FILE_OVERRIDE=""

hash_value() {
    local input="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$input" | sha256sum | awk '{print $1}'
    else
        printf '%s' "$input" | shasum -a 256 | awk '{print $1}'
    fi
}

timestamp_utc() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

timestamp_compact() {
    date -u +"%Y%m%dT%H%M%SZ"
}

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --environment ENV   target environment: development|staging|production|dev|prod (default: staging)
  --key NAME          secret key to rotate in drill (required)
  --encrypted-file F  optional path to encrypted bundle (overrides env default)
  --sops-age-key-file F optional age key file path exported as SOPS_AGE_KEY_FILE
  --evidence-root DIR evidence output root (default: /tmp/pmdl-secrets-drills)
  --apply             destructive drill (applies candidate then restores backup)
  --keep-temp         keep temporary decrypted artifacts
  --help, -h          show this help
USAGE
}

normalize_env() {
    case "$1" in
        dev) echo "development" ;;
        production|prod) echo "production" ;;
        staging|development) echo "$1" ;;
        *) echo "" ;;
    esac
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --environment)
            ENVIRONMENT="${2:-}"
            [[ -n "$ENVIRONMENT" ]] || { echo "[ERROR] --environment requires a value"; exit 1; }
            shift 2
            ;;
        --key)
            KEY_NAME="${2:-}"
            [[ -n "$KEY_NAME" ]] || { echo "[ERROR] --key requires a value"; exit 1; }
            shift 2
            ;;
        --evidence-root)
            EVIDENCE_ROOT="${2:-}"
            [[ -n "$EVIDENCE_ROOT" ]] || { echo "[ERROR] --evidence-root requires a value"; exit 1; }
            shift 2
            ;;
        --encrypted-file)
            ENCRYPTED_FILE_OVERRIDE="${2:-}"
            [[ -n "$ENCRYPTED_FILE_OVERRIDE" ]] || { echo "[ERROR] --encrypted-file requires a value"; exit 1; }
            shift 2
            ;;
        --sops-age-key-file)
            SOPS_AGE_KEY_FILE_OVERRIDE="${2:-}"
            [[ -n "$SOPS_AGE_KEY_FILE_OVERRIDE" ]] || { echo "[ERROR] --sops-age-key-file requires a value"; exit 1; }
            shift 2
            ;;
        --apply)
            APPLY_CHANGES=true
            shift
            ;;
        --keep-temp)
            KEEP_TEMP=true
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

ENVIRONMENT="$(normalize_env "$ENVIRONMENT")"
if [[ -z "$ENVIRONMENT" ]]; then
    echo "[ERROR] Invalid environment. Use development|staging|production"
    exit 1
fi

if [[ -z "$KEY_NAME" ]]; then
    echo "[ERROR] --key is required"
    exit 1
fi

if ! command -v sops >/dev/null 2>&1; then
    echo "[ERROR] sops is required"
    exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
    echo "[ERROR] openssl is required"
    exit 1
fi

TARGET_FILE="$SECRETS_DIR/${ENVIRONMENT}.enc.yaml"
if [[ -n "$ENCRYPTED_FILE_OVERRIDE" ]]; then
    TARGET_FILE="$ENCRYPTED_FILE_OVERRIDE"
fi

if [[ ! -f "$TARGET_FILE" ]]; then
    echo "[ERROR] Missing encrypted file: $TARGET_FILE"
    exit 1
fi

if [[ -n "$SOPS_AGE_KEY_FILE_OVERRIDE" ]]; then
    export SOPS_AGE_KEY_FILE="$SOPS_AGE_KEY_FILE_OVERRIDE"
fi

mkdir -p "$EVIDENCE_ROOT"
DRILL_ID="$(timestamp_compact)-${ENVIRONMENT}-${KEY_NAME}"
EVIDENCE_DIR="$EVIDENCE_ROOT/$DRILL_ID"
mkdir -p "$EVIDENCE_DIR"

ORIGINAL_DEC_FILE="$(mktemp)"
ROTATED_DEC_FILE="$(mktemp)"
ROTATED_ENC_FILE="$(mktemp)"
RECOVERY_DEC_FILE="$(mktemp)"

cleanup() {
    if [[ "$KEEP_TEMP" == false ]]; then
        rm -f "$ORIGINAL_DEC_FILE" "$ROTATED_DEC_FILE" "$ROTATED_ENC_FILE" "$RECOVERY_DEC_FILE"
    fi
}
trap cleanup EXIT

REPORT_FILE="$EVIDENCE_DIR/SECRETS-ROTATION-RECOVERY-DRILL.md"
MANIFEST_FILE="$EVIDENCE_DIR/manifest.env"
BACKUP_FILE="$EVIDENCE_DIR/${ENVIRONMENT}.enc.backup.yaml"
CANDIDATE_FILE="$EVIDENCE_DIR/${ENVIRONMENT}.enc.candidate.yaml"

cp "$TARGET_FILE" "$BACKUP_FILE"

sops -d "$TARGET_FILE" > "$ORIGINAL_DEC_FILE"

line="$(grep -E "^${KEY_NAME}:" "$ORIGINAL_DEC_FILE" || true)"
if [[ -z "$line" ]]; then
    echo "[ERROR] Key '$KEY_NAME' not found in $TARGET_FILE"
    exit 1
fi

current_value="${line#*:}"
current_value="$(echo "$current_value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^"//;s/"$//')"
if [[ -z "$current_value" ]]; then
    echo "[ERROR] Key '$KEY_NAME' has empty value in decrypted bundle"
    exit 1
fi

current_hash="$(hash_value "$current_value")"
new_value="$(openssl rand -hex 32)"
new_hash="$(hash_value "$new_value")"

awk -v k="$KEY_NAME" -v v="$new_value" '
    BEGIN {updated = 0}
    $0 ~ ("^" k ":") {
        print k ": \"" v "\""
        updated = 1
        next
    }
    {print}
    END {
        if (updated == 0) {
            exit 2
        }
    }
' "$ORIGINAL_DEC_FILE" > "$ROTATED_DEC_FILE"

recipients="$(awk '/recipient:/ {print $NF}' "$TARGET_FILE" | paste -sd, -)"
if [[ -n "$recipients" ]]; then
    sops --encrypt --age "$recipients" "$ROTATED_DEC_FILE" > "$ROTATED_ENC_FILE"
else
    sops -e "$ROTATED_DEC_FILE" > "$ROTATED_ENC_FILE"
fi
cp "$ROTATED_ENC_FILE" "$CANDIDATE_FILE"

sops -d "$ROTATED_ENC_FILE" > "$RECOVERY_DEC_FILE"
new_line="$(grep -E "^${KEY_NAME}:" "$RECOVERY_DEC_FILE" || true)"
if [[ -z "$new_line" ]]; then
    echo "[ERROR] Rotated candidate missing key '$KEY_NAME'"
    exit 1
fi
rotated_value="${new_line#*:}"
rotated_value="$(echo "$rotated_value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^"//;s/"$//')"
rotated_hash="$(hash_value "$rotated_value")"

if [[ "$current_hash" == "$rotated_hash" ]]; then
    echo "[ERROR] Rotation drill did not change key hash"
    exit 1
fi

apply_result="not-applied"
recovery_result="not-required"
parity_after_apply="not-run"
parity_after_recovery="not-run"

if [[ "$APPLY_CHANGES" == true ]]; then
    cp "$ROTATED_ENC_FILE" "$TARGET_FILE"
    apply_result="applied"

    if "$PARITY_SCRIPT" --environment "$ENVIRONMENT" > "$EVIDENCE_DIR/parity-after-apply.log" 2>&1; then
        parity_after_apply="pass"
    else
        parity_after_apply="fail"
    fi

    cp "$BACKUP_FILE" "$TARGET_FILE"
    recovery_result="restored"

    if "$PARITY_SCRIPT" --environment "$ENVIRONMENT" > "$EVIDENCE_DIR/parity-after-recovery.log" 2>&1; then
        parity_after_recovery="pass"
    else
        parity_after_recovery="fail"
    fi
fi

{
    echo "DRILL_ID=$DRILL_ID"
    echo "RUN_TIMESTAMP_UTC=$(timestamp_utc)"
    echo "ENVIRONMENT=$ENVIRONMENT"
    echo "KEY_NAME=$KEY_NAME"
    echo "APPLY_CHANGES=$APPLY_CHANGES"
    echo "EVIDENCE_DIR=$EVIDENCE_DIR"
    echo "TARGET_FILE=$TARGET_FILE"
    echo "BACKUP_FILE=$BACKUP_FILE"
    echo "CANDIDATE_FILE=$CANDIDATE_FILE"
    echo "CURRENT_HASH=$current_hash"
    echo "NEW_HASH=$new_hash"
    echo "ROTATED_HASH=$rotated_hash"
    echo "APPLY_RESULT=$apply_result"
    echo "RECOVERY_RESULT=$recovery_result"
    echo "PARITY_AFTER_APPLY=$parity_after_apply"
    echo "PARITY_AFTER_RECOVERY=$parity_after_recovery"
} > "$MANIFEST_FILE"

cat > "$REPORT_FILE" <<EOF_REPORT
# Secrets Rotation + Recovery Drill Report

- Timestamp (UTC): $(timestamp_utc)
- Drill ID: $DRILL_ID
- Environment: $ENVIRONMENT
- Key: $KEY_NAME
- Mode: $( [[ "$APPLY_CHANGES" == true ]] && echo "destructive-apply+restore" || echo "non-destructive-simulation" )

## Artifacts

- Manifest: $MANIFEST_FILE
- Backup bundle: $BACKUP_FILE
- Candidate rotated bundle: $CANDIDATE_FILE

## Hash Evidence

- Current value hash: $current_hash
- Generated candidate hash: $new_hash
- Rotated decrypted hash: $rotated_hash
- Rotation changed value: $( [[ "$current_hash" != "$rotated_hash" ]] && echo "yes" || echo "no" )

## Apply + Recovery Outcome

- Apply result: $apply_result
- Recovery result: $recovery_result
- Parity after apply: $parity_after_apply
- Parity after recovery: $parity_after_recovery

## Notes

- Plaintext secret values are intentionally not recorded.
- Candidate encryption uses existing SOPS policy and recipients.
EOF_REPORT

echo "Drill complete. Evidence: $EVIDENCE_DIR"
