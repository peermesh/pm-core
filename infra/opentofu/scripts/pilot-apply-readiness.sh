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
ALLOW_EXAMPLE_INPUTS=false
SKIP_PLAN=false

REQUIRED_ENV=()
MISSING_ENV=()

usage() {
    cat <<USAGE
Usage: $0 [OPTIONS]

Options:
  --stack-dir PATH          OpenTofu stack directory (default: stacks/pilot-single-vps)
  --var-file PATH           Variable file to use for readiness checks
  --backend-config PATH     Backend config profile for init (optional)
  --require-env NAME        Required environment variable (repeatable)
  --summary-file PATH       Write key/value summary output (.env format)
  --plan-file PATH          Plan output path
  --allow-example-inputs    Allow *.example var/backend files (for dry-run evidence only)
  --skip-plan               Skip plan execution after init/validate
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

for env_name in "${REQUIRED_ENV[@]}"; do
    if [[ -z "${!env_name:-}" ]]; then
        MISSING_ENV+=("$env_name")
    fi
done

if [[ ${#MISSING_ENV[@]} -gt 0 ]]; then
    echo "[ERROR] Missing required environment variables:" >&2
    for env_name in "${MISSING_ENV[@]}"; do
        echo "  - $env_name" >&2
    done
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
echo "[INFO] Required env: $(join_by_comma "${REQUIRED_ENV[@]}")"
if [[ "$SKIP_PLAN" != true ]]; then
    echo "[INFO] Plan file: $PLAN_FILE"
fi
if [[ -n "$SUMMARY_FILE" ]]; then
    echo "[INFO] Summary file: $SUMMARY_FILE"
fi
