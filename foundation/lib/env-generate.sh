#!/usr/bin/env bash
#
# PeerMesh Foundation - Environment File Generator
#
# This script generates .env files from module configuration schemas.
# It reads the config section from a module's module.json manifest
# and produces a well-documented .env.example file.
#
# Usage:
#   ./env-generate.sh <module-path> [options]
#
# Arguments:
#   module-path     Path to module directory containing module.json
#
# Options:
#   --output, -o    Output path (default: <module-path>/.env.example)
#   --format        Output format: env, docker (default: env)
#   --no-comments   Suppress description comments
#   --no-defaults   Don't include default values
#   --secrets-only  Only output secret (BYOK) fields
#   --help, -h      Show this help message
#
# Exit codes:
#   0 - Success
#   1 - Module not found or invalid
#   2 - No configuration defined
#   3 - Missing dependencies (jq)
#
# Example:
#   ./env-generate.sh ./modules/my-module
#   ./env-generate.sh ./modules/my-module --output /tmp/my-module.env
#   ./env-generate.sh ./modules/my-module --secrets-only
#
# Output format:
#   # Property description
#   # Type: string | Default: "value"
#   MY_MODULE_SETTING="value"
#
#   # SECRET: Do not commit actual value
#   # API key for authentication (user must provide)
#   # Type: string | Required
#   MY_MODULE_API_KEY=
#

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values
OUTPUT_PATH=""
OUTPUT_FORMAT="env"
INCLUDE_COMMENTS=true
INCLUDE_DEFAULTS=true
SECRETS_ONLY=false
MODULE_PATH=""

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print usage
usage() {
    cat << 'EOF'
Usage: env-generate.sh <module-path> [options]

Generate .env files from module configuration schemas.

Arguments:
  module-path     Path to module directory containing module.json

Options:
  --output, -o    Output path (default: <module-path>/.env.example)
  --format        Output format: env, docker (default: env)
  --no-comments   Suppress description comments
  --no-defaults   Don't include default values
  --secrets-only  Only output secret (BYOK) fields
  --help, -h      Show this help message

Examples:
  ./env-generate.sh ./modules/my-module
  ./env-generate.sh ./modules/my-module --output /tmp/my-module.env
  ./env-generate.sh ./modules/my-module --secrets-only
EOF
}

# Log functions
log_info() {
    printf "%b\n" "$1"
}

log_error() {
    printf "%bError:%b %s\n" "$RED" "$NC" "$1" >&2
}

log_success() {
    printf "%b✓%b %s\n" "$GREEN" "$NC" "$1"
}

log_warn() {
    printf "%bWarning:%b %s\n" "$YELLOW" "$NC" "$1" >&2
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --output|-o)
                OUTPUT_PATH="$2"
                shift 2
                ;;
            --format)
                OUTPUT_FORMAT="$2"
                if [[ "$OUTPUT_FORMAT" != "env" && "$OUTPUT_FORMAT" != "docker" ]]; then
                    log_error "Invalid format: $OUTPUT_FORMAT. Must be 'env' or 'docker'"
                    exit 1
                fi
                shift 2
                ;;
            --no-comments)
                INCLUDE_COMMENTS=false
                shift
                ;;
            --no-defaults)
                INCLUDE_DEFAULTS=false
                shift
                ;;
            --secrets-only)
                SECRETS_ONLY=true
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
            *)
                if [[ -z "$MODULE_PATH" ]]; then
                    MODULE_PATH="$1"
                else
                    log_error "Unexpected argument: $1"
                    usage
                    exit 1
                fi
                shift
                ;;
        esac
    done

    # Validate required arguments
    if [[ -z "$MODULE_PATH" ]]; then
        log_error "Module path is required"
        usage
        exit 1
    fi

    # Set default output path
    if [[ -z "$OUTPUT_PATH" ]]; then
        OUTPUT_PATH="$MODULE_PATH/.env.example"
    fi
}

# Check dependencies
check_dependencies() {
    if ! command -v jq &>/dev/null; then
        log_error "jq is required but not installed. Install with: brew install jq"
        exit 3
    fi
}

# Find module manifest
find_manifest() {
    local module_path="$1"

    # Check for module.json
    if [[ -f "$module_path/module.json" ]]; then
        echo "$module_path/module.json"
        return 0
    fi

    # Check for module.yaml (future support)
    if [[ -f "$module_path/module.yaml" ]]; then
        log_error "YAML manifests are not yet supported. Please use module.json"
        exit 1
    fi

    log_error "No module.json found in: $module_path"
    exit 1
}

# Get type string for display
get_type_display() {
    local prop_json="$1"
    local prop_type
    prop_type=$(echo "$prop_json" | jq -r '.type // "string"')

    # Check for format
    local format
    format=$(echo "$prop_json" | jq -r '.format // empty')
    if [[ -n "$format" ]]; then
        echo "${prop_type} (${format})"
        return
    fi

    # Check for enum
    local enum_values
    enum_values=$(echo "$prop_json" | jq -r 'if .enum then .enum | join(", ") else empty end')
    if [[ -n "$enum_values" ]]; then
        echo "${prop_type} [${enum_values}]"
        return
    fi

    echo "$prop_type"
}

# Get default value for display
get_default_display() {
    local prop_json="$1"
    local prop_type
    prop_type=$(echo "$prop_json" | jq -r '.type // "string"')

    # Check if default exists
    local has_default
    has_default=$(echo "$prop_json" | jq 'has("default")')
    if [[ "$has_default" != "true" ]]; then
        echo ""
        return
    fi

    local default_val
    default_val=$(echo "$prop_json" | jq -r '.default')

    case "$prop_type" in
        string)
            echo "\"$default_val\""
            ;;
        array)
            # JSON array to comma-separated for env
            echo "$prop_json" | jq -r '.default | if type == "array" then join(",") else . end'
            ;;
        object)
            # JSON object as-is
            echo "$prop_json" | jq -c '.default'
            ;;
        *)
            echo "$default_val"
            ;;
    esac
}

# Format value for .env file
format_env_value() {
    local value="$1"
    local prop_type="$2"

    # Empty values
    if [[ -z "$value" || "$value" == "null" ]]; then
        echo ""
        return
    fi

    case "$prop_type" in
        string)
            # Quote strings
            echo "\"$value\""
            ;;
        array)
            # Arrays as comma-separated, quoted
            echo "\"$value\""
            ;;
        object)
            # JSON objects quoted
            echo "'$value'"
            ;;
        boolean)
            # Lowercase booleans
            echo "$value" | tr '[:upper:]' '[:lower:]'
            ;;
        *)
            echo "$value"
            ;;
    esac
}

# Generate the .env content
generate_env() {
    local manifest_path="$1"
    local module_id
    local module_name
    local config_version
    local has_config

    # Extract module info
    module_id=$(jq -r '.id' "$manifest_path")
    module_name=$(jq -r '.name' "$manifest_path")
    config_version=$(jq -r '.config.version // "1.0"' "$manifest_path")

    # Check if config exists
    has_config=$(jq 'has("config") and (.config.properties | length > 0)' "$manifest_path")
    if [[ "$has_config" != "true" ]]; then
        log_warn "No configuration properties defined in module"
        exit 2
    fi

    # Get required fields
    local required_fields
    required_fields=$(jq -r '.config.required // [] | .[]' "$manifest_path" 2>/dev/null || true)

    # Start output
    local output=""

    if [[ "$INCLUDE_COMMENTS" == "true" ]]; then
        output+="# =============================================================================\n"
        output+="# ${module_name} Configuration\n"
        output+="# Module ID: ${module_id}\n"
        output+="# Config Version: ${config_version}\n"
        output+="# Generated by: env-generate.sh\n"
        output+="# Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")\n"
        output+="# =============================================================================\n"
        output+="\n"

        # Check for secrets
        local has_secrets
        has_secrets=$(jq '[.config.properties | to_entries[] | select(.value.secret == true)] | length > 0' "$manifest_path")
        if [[ "$has_secrets" == "true" ]]; then
            output+="# -----------------------------------------------------------------------------\n"
            output+="# SECURITY NOTICE (BYOK - Bring Your Own Keys)\n"
            output+="# -----------------------------------------------------------------------------\n"
            output+="# This file contains SECRET fields marked with 'SECRET:' comments.\n"
            output+="# - Do NOT commit actual secret values to version control\n"
            output+="# - Copy this file to .env and fill in your own credentials\n"
            output+="# - Use a secrets manager in production (SOPS, Vault, etc.)\n"
            output+="# -----------------------------------------------------------------------------\n"
            output+="\n"
        fi
    fi

    # Process properties
    local properties
    properties=$(jq -c '.config.properties | to_entries | sort_by(.key)' "$manifest_path")

    local first_property=true

    echo "$properties" | jq -c '.[]' | while IFS= read -r entry; do
        local prop_name
        local prop_json
        local env_var
        local description
        local is_secret
        local is_required
        local prop_type
        local default_val
        local type_display

        prop_name=$(echo "$entry" | jq -r '.key')
        prop_json=$(echo "$entry" | jq '.value')

        # Get env var name
        env_var=$(echo "$prop_json" | jq -r '.env // empty')
        if [[ -z "$env_var" ]]; then
            # Generate default env var name
            env_var=$(echo "${module_id}_${prop_name}" | tr '[:lower:]-' '[:upper:]_')
        fi

        # Get property details
        description=$(echo "$prop_json" | jq -r '.description // empty')
        is_secret=$(echo "$prop_json" | jq -r '.secret // false')
        prop_type=$(echo "$prop_json" | jq -r '.type // "string"')

        # Check if required
        is_required="false"
        if echo "$required_fields" | grep -q "^${prop_name}$"; then
            is_required="true"
        fi

        # Filter secrets-only if requested
        if [[ "$SECRETS_ONLY" == "true" && "$is_secret" != "true" ]]; then
            continue
        fi

        # Get type display and default
        type_display=$(get_type_display "$prop_json")

        # Build property output
        local prop_output=""

        if [[ "$INCLUDE_COMMENTS" == "true" ]]; then
            # Add blank line between properties (except first)
            if [[ "$first_property" != "true" ]]; then
                prop_output+="\n"
            fi
            first_property=false

            # Secret warning
            if [[ "$is_secret" == "true" ]]; then
                prop_output+="# SECRET: Do not commit actual value\n"
            fi

            # Description
            if [[ -n "$description" ]]; then
                prop_output+="# ${description}\n"
            fi

            # Type and constraints info
            local constraints=""

            # Required flag
            if [[ "$is_required" == "true" ]]; then
                constraints+="Required"
            fi

            # Default value
            if [[ "$INCLUDE_DEFAULTS" == "true" ]]; then
                default_val=$(get_default_display "$prop_json")
                if [[ -n "$default_val" ]]; then
                    if [[ -n "$constraints" ]]; then
                        constraints+=" | "
                    fi
                    constraints+="Default: ${default_val}"
                fi
            fi

            # Validation constraints
            local min_val max_val min_len max_len pattern
            min_val=$(echo "$prop_json" | jq -r '.minimum // empty')
            max_val=$(echo "$prop_json" | jq -r '.maximum // empty')
            min_len=$(echo "$prop_json" | jq -r '.minLength // empty')
            max_len=$(echo "$prop_json" | jq -r '.maxLength // empty')
            pattern=$(echo "$prop_json" | jq -r '.pattern // empty')

            if [[ -n "$min_val" || -n "$max_val" ]]; then
                if [[ -n "$constraints" ]]; then
                    constraints+=" | "
                fi
                if [[ -n "$min_val" && -n "$max_val" ]]; then
                    constraints+="Range: ${min_val}-${max_val}"
                elif [[ -n "$min_val" ]]; then
                    constraints+="Min: ${min_val}"
                else
                    constraints+="Max: ${max_val}"
                fi
            fi

            if [[ -n "$min_len" || -n "$max_len" ]]; then
                if [[ -n "$constraints" ]]; then
                    constraints+=" | "
                fi
                if [[ -n "$min_len" && -n "$max_len" ]]; then
                    constraints+="Length: ${min_len}-${max_len}"
                elif [[ -n "$min_len" ]]; then
                    constraints+="Min length: ${min_len}"
                else
                    constraints+="Max length: ${max_len}"
                fi
            fi

            if [[ -n "$pattern" ]]; then
                if [[ -n "$constraints" ]]; then
                    constraints+=" | "
                fi
                constraints+="Pattern: ${pattern}"
            fi

            prop_output+="# Type: ${type_display}"
            if [[ -n "$constraints" ]]; then
                prop_output+=" | ${constraints}"
            fi
            prop_output+="\n"
        fi

        # The actual env var line
        if [[ "$INCLUDE_DEFAULTS" == "true" ]]; then
            default_val=$(get_default_display "$prop_json")
            local formatted_val
            formatted_val=$(format_env_value "$default_val" "$prop_type")

            if [[ "$is_secret" == "true" ]]; then
                # Secrets are always empty in .env.example
                prop_output+="${env_var}=\n"
            elif [[ -n "$formatted_val" ]]; then
                prop_output+="${env_var}=${formatted_val}\n"
            else
                prop_output+="${env_var}=\n"
            fi
        else
            prop_output+="${env_var}=\n"
        fi

        printf "%b" "$prop_output"
    done
}

# Main function
main() {
    parse_args "$@"
    check_dependencies

    # Resolve module path
    MODULE_PATH=$(cd "$MODULE_PATH" 2>/dev/null && pwd || echo "$MODULE_PATH")

    if [[ ! -d "$MODULE_PATH" ]]; then
        log_error "Module directory not found: $MODULE_PATH"
        exit 1
    fi

    # Find manifest
    local manifest_path
    manifest_path=$(find_manifest "$MODULE_PATH")

    log_info "Generating environment file from: $manifest_path"

    # Generate content
    local content
    content=$(generate_env "$manifest_path")

    # Ensure output directory exists
    local output_dir
    output_dir=$(dirname "$OUTPUT_PATH")
    if [[ ! -d "$output_dir" ]]; then
        mkdir -p "$output_dir"
    fi

    # Write output
    printf "%b" "$content" > "$OUTPUT_PATH"

    log_success "Generated: $OUTPUT_PATH"

    # Show summary
    local total_props secret_props required_props
    total_props=$(jq '.config.properties | length' "$manifest_path")
    secret_props=$(jq '[.config.properties | to_entries[] | select(.value.secret == true)] | length' "$manifest_path")
    required_props=$(jq '.config.required | length // 0' "$manifest_path")

    log_info ""
    log_info "Summary:"
    log_info "  Total properties: $total_props"
    log_info "  Secret properties (BYOK): $secret_props"
    log_info "  Required properties: $required_props"

    if [[ "$secret_props" -gt 0 ]]; then
        log_info ""
        log_warn "This module has $secret_props secret field(s) that require user-provided values."
        log_info "  Copy .env.example to .env and fill in your credentials."
    fi
}

# Run main
main "$@"
