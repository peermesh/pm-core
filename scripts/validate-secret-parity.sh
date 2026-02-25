#!/usr/bin/env bash
# ==============================================================
# Secret Keyset Parity Validator
# ==============================================================
# Verifies canonical/compatibility keyset parity across:
# - keyset contract files
# - root docker-compose secrets declarations
# - encrypted environment bundles
# - app secret contract files
# - generate-secrets script references
#
# Exit code:
#   0 = no CRITICAL drift
#   1 = CRITICAL drift detected
#   2 = warnings detected in --strict mode
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SECRETS_DIR="$PROJECT_DIR/secrets"
KEYSET_DIR="$SECRETS_DIR/keysets"
EXAMPLES_DIR="$PROJECT_DIR/examples"
GENERATE_SCRIPT="$SCRIPT_DIR/generate-secrets.sh"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"

ENVIRONMENT="production"
STRICT=false

CRITICAL_COUNT=0
WARNING_COUNT=0
INFO_COUNT=0

log_critical() {
    CRITICAL_COUNT=$((CRITICAL_COUNT + 1))
    echo "[CRITICAL] $1"
}

log_warning() {
    WARNING_COUNT=$((WARNING_COUNT + 1))
    echo "[WARNING] $1"
}

log_info() {
    INFO_COUNT=$((INFO_COUNT + 1))
    echo "[INFO] $1"
}

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --environment ENV   target environment: development|staging|production|dev|prod
  --strict            fail when warnings are present
  --help, -h          show this help
USAGE
}

normalize_env() {
    case "$1" in
        dev) echo "development" ;;
        production|prod) echo "production" ;;
        staging|development) echo "$1" ;;
        *)
            echo ""
            ;;
    esac
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --environment)
            ENVIRONMENT="${2:-}"
            if [[ -z "$ENVIRONMENT" ]]; then
                echo "[ERROR] --environment requires a value"
                exit 1
            fi
            shift 2
            ;;
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

ENVIRONMENT="$(normalize_env "$ENVIRONMENT")"
if [[ -z "$ENVIRONMENT" ]]; then
    echo "[ERROR] Invalid environment. Use development|staging|production"
    exit 1
fi

read_key_list() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        echo "[ERROR] Missing keyset file: $file" >&2
        return 1
    fi

    awk '
        /^[[:space:]]*#/ {next}
        /^[[:space:]]*$/ {next}
        {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); print $0}
    ' "$file"
}

contains_key() {
    local needle="$1"
    shift
    local item
    for item in "$@"; do
        [[ "$item" == "$needle" ]] && return 0
    done
    return 1
}

parse_compose_secrets() {
    awk '
        BEGIN {in_secrets = 0}
        /^secrets:[[:space:]]*$/ {in_secrets = 1; next}
        in_secrets && /^[^[:space:]]/ {in_secrets = 0}
        in_secrets && /^[[:space:]]{2}[a-zA-Z0-9_]+:[[:space:]]*$/ {
            key = $1
            gsub(":", "", key)
            print key
        }
    ' "$COMPOSE_FILE"
}

parse_bundle_keys() {
    local file="$1"
    awk -F: '
        /^[A-Za-z0-9_]+:[[:space:]]*/ {
            key = $1
            if (key != "sops") {
                print key
            }
        }
    ' "$file"
}

parse_app_contract_keys() {
    local contract key
    while IFS= read -r contract; do
        if [[ "$contract" == *"/examples/_template/"* ]]; then
            continue
        fi
        while IFS= read -r key; do
            key="$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
            [[ -z "$key" ]] && continue
            [[ "$key" == \#* ]] && continue
            echo "$key"
        done < "$contract"
    done < <(find "$EXAMPLES_DIR" -maxdepth 3 -name 'secrets-required.txt' | sort)
}

canonical_runtime_keys=()
while IFS= read -r key; do
    canonical_runtime_keys+=("$key")
done < <(read_key_list "$KEYSET_DIR/canonical-runtime-keys.txt")

canonical_compose_keys=()
while IFS= read -r key; do
    canonical_compose_keys+=("$key")
done < <(read_key_list "$KEYSET_DIR/canonical-compose-keys.txt")

compatibility_keys=()
while IFS= read -r key; do
    compatibility_keys+=("$key")
done < <(read_key_list "$KEYSET_DIR/compatibility-only-keys.txt")

compose_keys=()
while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    compose_keys+=("$key")
done < <(parse_compose_secrets)

app_contract_keys=()
while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    if ! contains_key "$key" "${app_contract_keys[@]}"; then
        app_contract_keys+=("$key")
    fi
done < <(parse_app_contract_keys)

log_info "Environment: $ENVIRONMENT"
log_info "Canonical runtime keys: ${#canonical_runtime_keys[@]}"
log_info "Canonical compose keys: ${#canonical_compose_keys[@]}"
log_info "Compatibility-only keys: ${#compatibility_keys[@]}"

for key in "${canonical_runtime_keys[@]}"; do
    if contains_key "$key" "${compatibility_keys[@]}"; then
        log_critical "Key '$key' appears in both canonical and compatibility lists"
    fi
done

for key in "${canonical_compose_keys[@]}"; do
    if ! contains_key "$key" "${canonical_runtime_keys[@]}"; then
        log_critical "Compose key '$key' not present in canonical runtime keyset"
    fi
    if ! contains_key "$key" "${compose_keys[@]}"; then
        log_critical "Compose key '$key' missing from docker-compose secrets block"
    fi
done

for key in "${compose_keys[@]}"; do
    if ! contains_key "$key" "${canonical_compose_keys[@]}"; then
        log_critical "docker-compose declares non-canonical secret '$key'"
    fi
    if contains_key "$key" "${compatibility_keys[@]}"; then
        log_critical "Compatibility-only key '$key' leaked into canonical docker-compose secrets"
    fi
done

for key in "${canonical_runtime_keys[@]}" "${compatibility_keys[@]}"; do
    if ! grep -Fq "$key" "$GENERATE_SCRIPT"; then
        log_critical "generate-secrets script does not reference contract key '$key'"
    fi
done

for key in "${app_contract_keys[@]}"; do
    if ! contains_key "$key" "${canonical_runtime_keys[@]}" && ! contains_key "$key" "${compatibility_keys[@]}"; then
        log_critical "App contract key '$key' is not declared in canonical or compatibility keysets"
    fi
done

for env_file in development staging production; do
    bundle="$SECRETS_DIR/${env_file}.enc.yaml"
    if [[ ! -f "$bundle" ]]; then
        log_critical "Missing encrypted bundle: ${env_file}.enc.yaml"
        continue
    fi

    bundle_keys=()
    while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        bundle_keys+=("$key")
    done < <(parse_bundle_keys "$bundle")

    for key in "${canonical_runtime_keys[@]}"; do
        if ! contains_key "$key" "${bundle_keys[@]}"; then
            log_critical "${env_file}.enc.yaml missing canonical key '$key'"
        fi
    done

    for key in "${compatibility_keys[@]}"; do
        if ! contains_key "$key" "${bundle_keys[@]}"; then
            log_warning "${env_file}.enc.yaml missing compatibility key '$key'"
        fi
    done

    for key in "${bundle_keys[@]}"; do
        if ! contains_key "$key" "${canonical_runtime_keys[@]}" && ! contains_key "$key" "${compatibility_keys[@]}"; then
            log_warning "${env_file}.enc.yaml has undeclared key '$key'"
        fi
    done

done

echo ""
echo "Secret parity summary: CRITICAL=${CRITICAL_COUNT} WARNING=${WARNING_COUNT} INFO=${INFO_COUNT}"

if [[ "$CRITICAL_COUNT" -gt 0 ]]; then
    exit 1
fi

if [[ "$STRICT" == true && "$WARNING_COUNT" -gt 0 ]]; then
    exit 2
fi

exit 0
