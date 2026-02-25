#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VAR_FILE="$ROOT_DIR/env/pilot-single-vps.auto.tfvars.example"
DEFAULT_ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/docker-lab/opentofu/pilot-single-vps.credentials.env"
ENV_FILE="$DEFAULT_ENV_FILE"
ALLOW_EXAMPLE_INPUTS=false

REQUIRED_ENV=()
COMPUTE_PROVIDER=""
DNS_PROVIDER=""

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS] <command>

Commands:
  setup                  Prompt for required provider credentials and store in env file
  status                 Show required credentials and where each is sourced
  remove <ENV_NAME>      Remove one credential key from env file
  path                   Print credential env file path

Options:
  --var-file PATH        Variable file used to derive required provider env vars
  --env-file PATH        Credential env file path (default: \$XDG_CONFIG_HOME/docker-lab/opentofu/pilot-single-vps.credentials.env)
  --allow-example-inputs Allow *.example var file for setup/status (dry-run evidence)
  -h, --help             Show this help
USAGE
}

trim() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
}

extract_var_assignment() {
    local key="$1"
    local file="$2"

    sed -nE "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\"([^\"]+)\".*/\1/p" "$file" | head -n1
}

add_required_env() {
    local name="$1"
    local existing=""

    if [[ -z "$name" ]]; then
        return
    fi

    for existing in "${REQUIRED_ENV[@]}"; do
        if [[ "$existing" == "$name" ]]; then
            return
        fi
    done

    REQUIRED_ENV+=("$name")
}

get_file_mode() {
    local file="$1"
    local mode=""

    mode="$(stat -f "%Lp" "$file" 2>/dev/null || true)"
    if [[ -z "$mode" ]]; then
        mode="$(stat -c "%a" "$file" 2>/dev/null || true)"
    fi
    printf '%s' "$mode"
}

ensure_private_permissions() {
    local file="$1"
    local mode=""
    local mode_decimal=0

    if [[ ! -f "$file" ]]; then
        return
    fi

    mode="$(get_file_mode "$file")"
    if [[ -z "$mode" || ! "$mode" =~ ^[0-7]{3,4}$ ]]; then
        echo "[ERROR] Unable to determine permissions for credential file: $file" >&2
        exit 1
    fi

    mode_decimal=$((8#$mode))
    if (( (mode_decimal & 077) != 0 )); then
        echo "[ERROR] Credential file is too permissive (mode $mode): $file" >&2
        echo "        Run: chmod 600 \"$file\"" >&2
        exit 1
    fi
}

read_env_file_value() {
    local file="$1"
    local target_key="$2"
    local line=""
    local line_key=""
    local line_value=""

    [[ -f "$file" ]] || return 0

    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
            line_key="$(trim "${BASH_REMATCH[1]}")"
            line_value="$(trim "${BASH_REMATCH[2]}")"
            if [[ "$line_key" == "$target_key" ]]; then
                if [[ "$line_value" =~ ^\"(.*)\"$ ]]; then
                    line_value="${BASH_REMATCH[1]}"
                elif [[ "$line_value" =~ ^\'(.*)\'$ ]]; then
                    line_value="${BASH_REMATCH[1]}"
                fi
                printf '%s' "$line_value"
                return 0
            fi
        fi
    done < "$file"
}

upsert_env_file_value() {
    local file="$1"
    local key="$2"
    local value="$3"
    local tmp_file=""
    local line=""
    local found=false

    if [[ "$value" == *$'\n'* ]]; then
        echo "[ERROR] Refusing to write multiline value for $key to credential file." >&2
        exit 1
    fi

    mkdir -p "$(dirname "$file")"
    if [[ ! -f "$file" ]]; then
        touch "$file"
        chmod 600 "$file"
    fi
    ensure_private_permissions "$file"

    tmp_file="$(mktemp)"

    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*= ]]; then
            printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
            found=true
        else
            printf '%s\n' "$line" >> "$tmp_file"
        fi
    done < "$file"

    if [[ "$found" == false ]]; then
        printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
    fi

    mv "$tmp_file" "$file"
    chmod 600 "$file"
}

remove_env_file_key() {
    local file="$1"
    local key="$2"
    local tmp_file=""
    local line=""
    local removed=false

    if [[ ! -f "$file" ]]; then
        echo "[WARN] Credential file does not exist: $file"
        return
    fi

    ensure_private_permissions "$file"
    tmp_file="$(mktemp)"

    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*= ]]; then
            removed=true
            continue
        fi
        printf '%s\n' "$line" >> "$tmp_file"
    done < "$file"

    mv "$tmp_file" "$file"
    chmod 600 "$file"

    if [[ "$removed" == true ]]; then
        echo "[OK] Removed $key from $file"
    else
        echo "[INFO] Key not present in $file: $key"
    fi
}

derive_required_env_from_var_file() {
    REQUIRED_ENV=()

    if [[ ! -f "$VAR_FILE" ]]; then
        echo "[ERROR] Var file not found: $VAR_FILE" >&2
        exit 1
    fi

    if [[ "$ALLOW_EXAMPLE_INPUTS" != true && "$VAR_FILE" == *.example ]]; then
        echo "[ERROR] Refusing to use example var file in strict mode: $VAR_FILE" >&2
        echo "        Provide a real untracked var file or pass --allow-example-inputs for dry-run evidence." >&2
        exit 1
    fi

    COMPUTE_PROVIDER="$(extract_var_assignment "compute_provider" "$VAR_FILE")"
    DNS_PROVIDER="$(extract_var_assignment "dns_provider" "$VAR_FILE")"

    case "$(printf '%s' "$COMPUTE_PROVIDER" | tr '[:upper:]' '[:lower:]')" in
        hetzner|hcloud|hetzner-cloud)
            add_required_env "HCLOUD_TOKEN"
            ;;
        digitalocean|do)
            add_required_env "DIGITALOCEAN_TOKEN"
            ;;
        aws|ec2|amazon)
            add_required_env "AWS_ACCESS_KEY_ID"
            add_required_env "AWS_SECRET_ACCESS_KEY"
            ;;
    esac

    case "$(printf '%s' "$DNS_PROVIDER" | tr '[:upper:]' '[:lower:]')" in
        cloudflare|cf)
            add_required_env "CLOUDFLARE_API_TOKEN"
            ;;
        route53|aws-route53)
            add_required_env "AWS_ACCESS_KEY_ID"
            add_required_env "AWS_SECRET_ACCESS_KEY"
            ;;
        digitalocean|do)
            add_required_env "DIGITALOCEAN_TOKEN"
            ;;
    esac

    if [[ ${#REQUIRED_ENV[@]} -eq 0 ]]; then
        echo "[ERROR] No provider credential env vars were derived from: $VAR_FILE" >&2
        echo "        Check compute_provider/dns_provider values." >&2
        exit 1
    fi
}

prompt_secret_value() {
    local key="$1"
    local value=""

    if [[ ! -t 0 ]]; then
        echo "[ERROR] Cannot prompt for $key without interactive TTY input." >&2
        exit 1
    fi

    while true; do
        read -r -s -p "Enter value for $key: " value
        echo ""
        if [[ -n "$value" ]]; then
            printf '%s' "$value"
            return 0
        fi
        echo "[WARN] Empty value rejected for $key. Try again." >&2
    done
}

command_setup() {
    local env_name=""
    local value=""

    derive_required_env_from_var_file
    mkdir -p "$(dirname "$ENV_FILE")"

    for env_name in "${REQUIRED_ENV[@]}"; do
        value="${!env_name:-}"
        if [[ -z "$value" ]]; then
            value="$(read_env_file_value "$ENV_FILE" "$env_name")"
        fi
        if [[ -z "$value" ]]; then
            value="$(prompt_secret_value "$env_name")"
        fi
        upsert_env_file_value "$ENV_FILE" "$env_name" "$value"
    done

    echo "[OK] Credential file updated: $ENV_FILE"
    echo "[INFO] Required keys captured: ${REQUIRED_ENV[*]}"
    echo "[INFO] Next step:"
    echo "       OPENTOFU_PILOT_APPLY_APPROVED=true OPENTOFU_PILOT_CHANGE_REF=<work-order> \\"
    echo "       ./infra/opentofu/scripts/pilot-apply-readiness.sh --var-file \"$VAR_FILE\" --env-file \"$ENV_FILE\""
}

command_status() {
    local env_name=""
    local file_value=""
    local source=""

    derive_required_env_from_var_file

    echo "[INFO] Var file: $VAR_FILE"
    echo "[INFO] Credential file: $ENV_FILE"
    if [[ -f "$ENV_FILE" ]]; then
        ensure_private_permissions "$ENV_FILE"
        echo "[INFO] Credential file permissions: private"
    else
        echo "[INFO] Credential file: missing (run setup to create)"
    fi
    echo "[INFO] Required keys:"

    for env_name in "${REQUIRED_ENV[@]}"; do
        source="missing"
        if [[ -n "${!env_name:-}" ]]; then
            source="shell-env"
        else
            file_value="$(read_env_file_value "$ENV_FILE" "$env_name")"
            if [[ -n "$file_value" ]]; then
                source="credential-file"
            fi
        fi
        echo "  - $env_name: $source"
    done
}

COMMAND=""
POSITIONAL=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --var-file)
            VAR_FILE="${2:-}"
            shift 2
            ;;
        --env-file)
            ENV_FILE="${2:-}"
            shift 2
            ;;
        --allow-example-inputs)
            ALLOW_EXAMPLE_INPUTS=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            POSITIONAL+=("$1")
            shift
            ;;
    esac
done

set -- "${POSITIONAL[@]}"
COMMAND="${1:-status}"

if [[ -z "$ENV_FILE" ]]; then
    echo "[ERROR] --env-file cannot be empty." >&2
    exit 1
fi

case "$COMMAND" in
    setup)
        command_setup
        ;;
    status)
        command_status
        ;;
    remove)
        if [[ $# -lt 2 ]]; then
            echo "[ERROR] remove requires ENV_NAME argument." >&2
            usage
            exit 1
        fi
        remove_env_file_key "$ENV_FILE" "$2"
        ;;
    path)
        echo "$ENV_FILE"
        ;;
    *)
        echo "[ERROR] Unknown command: $COMMAND" >&2
        usage
        exit 1
        ;;
esac
