#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOFU="$SCRIPT_DIR/tofu.sh"

STACK_DIR="$ROOT_DIR/stacks/pilot-single-vps"
VAR_FILE="$ROOT_DIR/env/pilot-single-vps.auto.tfvars.example"
BACKEND_CONFIG=""
SUMMARY_FILE=""
PLAN_FILE="/tmp/pilot-single-vps-readiness-$(date -u +%Y%m%dT%H%M%SZ).tfplan"
DEFAULT_ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/core/opentofu/pilot-single-vps.credentials.env"
ENV_FILE="$DEFAULT_ENV_FILE"
ALLOW_EXAMPLE_INPUTS=false
SKIP_PLAN=false
PROMPT_MISSING_ENV=false
PERSIST_PROMPTED_ENV=false

REQUIRED_ENV=()
MISSING_ENV=()

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --stack-dir PATH          OpenTofu stack directory (default: stacks/pilot-single-vps)
  --var-file PATH           Variable file to use for readiness checks
  --backend-config PATH     Backend config profile for init (optional)
  --env-file PATH           Credential env file (default: \$XDG_CONFIG_HOME/core/opentofu/pilot-single-vps.credentials.env)
  --require-env NAME        Required environment variable (repeatable)
  --summary-file PATH       Write key/value summary output (.env format)
  --plan-file PATH          Plan output path
  --allow-example-inputs    Allow *.example var/backend files (for dry-run evidence only)
  --skip-plan               Skip plan execution after init/validate
  --prompt-missing-env      Prompt for missing required env vars (TTY only, hidden input)
  --persist-prompted-env    Persist prompted env vars into --env-file (mode 600)
  -h, --help                Show this help

Environment controls:
  OPENTOFU_PILOT_APPLY_APPROVED=true   required approval flag
  OPENTOFU_PILOT_CHANGE_REF=<value>    required change/work-order reference
  OPENTOFU_REQUIRED_ENV=name1,name2    optional additional required env vars
USAGE
}

trim() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
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

extract_var_assignment() {
    local key="$1"
    local file="$2"

    sed -nE "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\"([^\"]+)\".*/\1/p" "$file" | head -n1
}

join_by_comma() {
    local first=true
    local item=""

    for item in "$@"; do
        if [[ "$first" == true ]]; then
            printf '%s' "$item"
            first=false
        else
            printf ',%s' "$item"
        fi
    done
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

load_required_env_from_file() {
    local env_name=""
    local file_value=""

    if [[ ! -f "$ENV_FILE" ]]; then
        return
    fi

    ensure_private_permissions "$ENV_FILE"

    for env_name in "${REQUIRED_ENV[@]}"; do
        if [[ -n "${!env_name:-}" ]]; then
            continue
        fi
        file_value="$(read_env_file_value "$ENV_FILE" "$env_name")"
        if [[ -n "$file_value" ]]; then
            export "$env_name=$file_value"
        fi
    done
}

prompt_for_missing_env() {
    local env_name=""
    local secret_value=""

    if [[ ! -t 0 ]]; then
        echo "[ERROR] Cannot prompt for missing env vars without an interactive TTY." >&2
        exit 1
    fi

    for env_name in "$@"; do
        if [[ -n "${!env_name:-}" ]]; then
            continue
        fi

        while true; do
            read -r -s -p "Enter value for $env_name: " secret_value
            echo ""
            if [[ -n "$secret_value" ]]; then
                export "$env_name=$secret_value"
                break
            fi
            echo "[WARN] Empty value rejected for $env_name. Try again." >&2
        done
    done
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stack-dir)
            STACK_DIR="${2:-}"
            shift 2
            ;;
        --var-file)
            VAR_FILE="${2:-}"
            shift 2
            ;;
        --backend-config)
            BACKEND_CONFIG="${2:-}"
            shift 2
            ;;
        --env-file)
            ENV_FILE="${2:-}"
            shift 2
            ;;
        --require-env)
            add_required_env "${2:-}"
            shift 2
            ;;
        --summary-file)
            SUMMARY_FILE="${2:-}"
            shift 2
            ;;
        --plan-file)
            PLAN_FILE="${2:-}"
            shift 2
            ;;
        --allow-example-inputs)
            ALLOW_EXAMPLE_INPUTS=true
            shift
            ;;
        --skip-plan)
            SKIP_PLAN=true
            shift
            ;;
        --prompt-missing-env)
            PROMPT_MISSING_ENV=true
            shift
            ;;
        --persist-prompted-env)
            PERSIST_PROMPTED_ENV=true
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

if [[ ! -d "$STACK_DIR" ]]; then
    echo "[ERROR] Stack directory not found: $STACK_DIR" >&2
    exit 1
fi

if [[ ! -f "$VAR_FILE" ]]; then
    echo "[ERROR] Var file not found: $VAR_FILE" >&2
    exit 1
fi

if [[ -n "$BACKEND_CONFIG" && ! -f "$BACKEND_CONFIG" ]]; then
    echo "[ERROR] Backend config not found: $BACKEND_CONFIG" >&2
    exit 1
fi

if [[ -z "$ENV_FILE" ]]; then
    echo "[ERROR] --env-file cannot be empty." >&2
    exit 1
fi

if [[ "$PERSIST_PROMPTED_ENV" == true && "$PROMPT_MISSING_ENV" != true ]]; then
    echo "[ERROR] --persist-prompted-env requires --prompt-missing-env." >&2
    exit 1
fi

if [[ "$ALLOW_EXAMPLE_INPUTS" != true ]]; then
    if [[ "$VAR_FILE" == *.example ]]; then
        echo "[ERROR] Refusing to use example var file in strict mode: $VAR_FILE" >&2
        echo "        Provide a real untracked var file or use --allow-example-inputs for dry-run evidence." >&2
        exit 1
    fi

    if [[ -n "$BACKEND_CONFIG" && "$BACKEND_CONFIG" == *.example ]]; then
        echo "[ERROR] Refusing to use example backend config in strict mode: $BACKEND_CONFIG" >&2
        echo "        Provide a real backend config or use --allow-example-inputs for dry-run evidence." >&2
        exit 1
    fi
fi

if [[ "${OPENTOFU_PILOT_APPLY_APPROVED:-}" != "true" ]]; then
    echo "[ERROR] OPENTOFU_PILOT_APPLY_APPROVED must be set to 'true'." >&2
    exit 1
fi

if [[ -z "${OPENTOFU_PILOT_CHANGE_REF:-}" ]]; then
    echo "[ERROR] OPENTOFU_PILOT_CHANGE_REF is required (work-order or change reference)." >&2
    exit 1
fi

COMPUTE_PROVIDER="$(extract_var_assignment "compute_provider" "$VAR_FILE")"
DNS_PROVIDER="$(extract_var_assignment "dns_provider" "$VAR_FILE")"

COMPUTE_PROVIDER_NORMALIZED="$(printf '%s' "$COMPUTE_PROVIDER" | tr '[:upper:]' '[:lower:]')"
DNS_PROVIDER_NORMALIZED="$(printf '%s' "$DNS_PROVIDER" | tr '[:upper:]' '[:lower:]')"

case "$COMPUTE_PROVIDER_NORMALIZED" in
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

case "$DNS_PROVIDER_NORMALIZED" in
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

if [[ -n "${OPENTOFU_REQUIRED_ENV:-}" ]]; then
    IFS=',' read -r -a REQUIRED_FROM_ENV <<< "${OPENTOFU_REQUIRED_ENV}"
    for env_name in "${REQUIRED_FROM_ENV[@]}"; do
        add_required_env "$(trim "$env_name")"
    done
fi

if [[ ${#REQUIRED_ENV[@]} -eq 0 ]]; then
    echo "[ERROR] No required provider credential env vars were derived." >&2
    echo "        Use known providers in var file or pass --require-env / OPENTOFU_REQUIRED_ENV." >&2
    exit 1
fi

load_required_env_from_file

for env_name in "${REQUIRED_ENV[@]}"; do
    if [[ -z "${!env_name:-}" ]]; then
        MISSING_ENV+=("$env_name")
    fi
done

if [[ ${#MISSING_ENV[@]} -gt 0 && "$PROMPT_MISSING_ENV" == true ]]; then
    prompt_for_missing_env "${MISSING_ENV[@]}"

    if [[ "$PERSIST_PROMPTED_ENV" == true ]]; then
        for env_name in "${MISSING_ENV[@]}"; do
            upsert_env_file_value "$ENV_FILE" "$env_name" "${!env_name:-}"
        done
    fi

    MISSING_ENV=()
    for env_name in "${REQUIRED_ENV[@]}"; do
        if [[ -z "${!env_name:-}" ]]; then
            MISSING_ENV+=("$env_name")
        fi
    done
fi

if [[ ${#MISSING_ENV[@]} -gt 0 ]]; then
    echo "[ERROR] Missing required environment variables:" >&2
    for env_name in "${MISSING_ENV[@]}"; do
        echo "  - $env_name" >&2
    done
    echo "        You can set them in shell, or run:" >&2
    echo "        ./infra/opentofu/scripts/pilot-credentials.sh setup --var-file \"$VAR_FILE\" --env-file \"$ENV_FILE\"" >&2
    exit 1
fi

if [[ -n "$BACKEND_CONFIG" ]]; then
    "$TOFU" -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG"
else
    "$TOFU" -chdir="$STACK_DIR" init -backend=false
fi

"$TOFU" -chdir="$STACK_DIR" validate

if [[ "$SKIP_PLAN" != true ]]; then
    "$TOFU" -chdir="$STACK_DIR" plan -refresh=false -var-file="$VAR_FILE" -out="$PLAN_FILE"
fi

if [[ -n "$SUMMARY_FILE" ]]; then
    mkdir -p "$(dirname "$SUMMARY_FILE")"
    {
        echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "stack_dir=$STACK_DIR"
        echo "var_file=$VAR_FILE"
        echo "backend_config=${BACKEND_CONFIG:-none}"
        echo "env_file=${ENV_FILE:-none}"
        echo "compute_provider=$COMPUTE_PROVIDER"
        echo "dns_provider=$DNS_PROVIDER"
        echo "required_env=$(join_by_comma "${REQUIRED_ENV[@]}")"
        echo "change_ref=$OPENTOFU_PILOT_CHANGE_REF"
        echo "plan_ran=$([[ "$SKIP_PLAN" == true ]] && echo false || echo true)"
        echo "plan_file=$([[ "$SKIP_PLAN" == true ]] && echo none || echo "$PLAN_FILE")"
    } > "$SUMMARY_FILE"
fi

echo "[OK] OpenTofu apply readiness gate passed."
echo "[INFO] Stack: $STACK_DIR"
echo "[INFO] Var file: $VAR_FILE"
echo "[INFO] Env file: $ENV_FILE"
echo "[INFO] Required env: $(join_by_comma "${REQUIRED_ENV[@]}")"
if [[ "$SKIP_PLAN" != true ]]; then
    echo "[INFO] Plan file: $PLAN_FILE"
fi
if [[ -n "$SUMMARY_FILE" ]]; then
    echo "[INFO] Summary file: $SUMMARY_FILE"
fi
