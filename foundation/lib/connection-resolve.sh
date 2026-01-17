#!/usr/bin/env bash
#
# PeerMesh Foundation - Connection Resolution Script
#
# This script resolves module connection requirements to available providers.
# It reads module manifests, finds installed provider modules, and matches
# requirements to providers.
#
# Usage:
#   ./connection-resolve.sh <module-id> [--json] [--quiet]
#
# Arguments:
#   module-id   - ID of the module to resolve connections for
#   --json      - Output in JSON format (default: human-readable)
#   --quiet     - Suppress warnings, only output errors
#
# Exit codes:
#   0 - All required connections resolved
#   1 - One or more required connections could not be resolved
#   2 - Module not found or invalid manifest
#
# Environment:
#   FOUNDATION_DIR - Path to foundation directory (default: script's parent)
#   MODULES_DIR    - Path to modules directory (default: foundation/modules)
#
# Example:
#   ./connection-resolve.sh my-module
#   ./connection-resolve.sh my-module --json
#
#   Output (human-readable):
#     Resolving connections for module: my-module
#     ✓ primary-db -> postgres (provider-postgres)
#     ✓ session-cache -> redis (provider-redis)
#     ✗ search-engine -> [elasticsearch, opensearch] - No provider available
#
#   Output (JSON):
#     {
#       "success": true,
#       "resolved": [...],
#       "unresolved": [...],
#       "warnings": [...]
#     }

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Foundation directory (parent of lib/)
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$SCRIPT_DIR")}"

# Modules directory
MODULES_DIR="${MODULES_DIR:-$(dirname "$FOUNDATION_DIR")/modules}"

# Output format
OUTPUT_JSON=false
QUIET=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
MODULE_ID=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --json)
            OUTPUT_JSON=true
            shift
            ;;
        --quiet)
            QUIET=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 <module-id> [--json] [--quiet]"
            echo ""
            echo "Resolve connection requirements for a module."
            echo ""
            echo "Arguments:"
            echo "  module-id   Module ID to resolve connections for"
            echo "  --json      Output in JSON format"
            echo "  --quiet     Suppress warnings"
            echo ""
            echo "Exit codes:"
            echo "  0 - All required connections resolved"
            echo "  1 - One or more required connections could not be resolved"
            echo "  2 - Module not found or invalid manifest"
            exit 0
            ;;
        *)
            if [[ -z "$MODULE_ID" ]]; then
                MODULE_ID="$1"
            else
                echo "Error: Unknown argument: $1" >&2
                exit 2
            fi
            shift
            ;;
    esac
done

if [[ -z "$MODULE_ID" ]]; then
    echo "Error: Module ID required" >&2
    echo "Usage: $0 <module-id> [--json] [--quiet]" >&2
    exit 2
fi

# Logging functions
log_info() {
    if [[ "$OUTPUT_JSON" == "false" ]]; then
        echo "$1"
    fi
}

log_warn() {
    if [[ "$QUIET" == "false" && "$OUTPUT_JSON" == "false" ]]; then
        echo -e "${YELLOW}Warning:${NC} $1" >&2
    fi
}

log_error() {
    if [[ "$OUTPUT_JSON" == "false" ]]; then
        echo -e "${RED}Error:${NC} $1" >&2
    fi
}

log_success() {
    if [[ "$OUTPUT_JSON" == "false" ]]; then
        echo -e "${GREEN}✓${NC} $1"
    fi
}

log_failure() {
    if [[ "$OUTPUT_JSON" == "false" ]]; then
        echo -e "${RED}✗${NC} $1"
    fi
}

# Find module manifest
find_module_manifest() {
    local module_id="$1"

    # Check multiple possible locations
    local locations=(
        "$MODULES_DIR/$module_id/module.json"
        "$MODULES_DIR/$module_id/module.yaml"
        "$MODULES_DIR/$module_id/module.yml"
    )

    for loc in "${locations[@]}"; do
        if [[ -f "$loc" ]]; then
            echo "$loc"
            return 0
        fi
    done

    return 1
}

# Get available providers from installed modules
get_available_providers() {
    local providers=()

    # Check for provider modules
    if [[ -d "$MODULES_DIR" ]]; then
        for module_dir in "$MODULES_DIR"/*/; do
            if [[ -d "$module_dir" ]]; then
                local manifest="$module_dir/module.json"
                if [[ -f "$manifest" ]]; then
                    # Check if module provides connections
                    if command -v jq &>/dev/null; then
                        local provided
                        provided=$(jq -r '.provides.connections[]? // empty' "$manifest" 2>/dev/null)
                        if [[ -n "$provided" ]]; then
                            local module_name
                            module_name=$(basename "$module_dir")
                            while IFS= read -r provider; do
                                providers+=("$provider:$module_name")
                            done <<< "$provided"
                        fi
                    fi
                fi
            fi
        done
    fi

    # Also check for foundation's built-in no-op providers
    # The noop eventbus is always available
    providers+=("noop:foundation")

    printf '%s\n' "${providers[@]}"
}

# Check if a provider satisfies a requirement
provider_satisfies() {
    local provider="$1"
    local required_providers="$2"

    # Split required providers and check each
    for req in $required_providers; do
        if [[ "$provider" == "$req" ]]; then
            return 0
        fi
    done

    return 1
}

# Main resolution logic
resolve_connections() {
    local module_id="$1"
    local manifest_path

    # Find module manifest
    if ! manifest_path=$(find_module_manifest "$module_id"); then
        log_error "Module not found: $module_id"
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            echo '{"success": false, "error": "Module not found", "resolved": [], "unresolved": [], "warnings": []}'
        fi
        return 2
    fi

    log_info "Resolving connections for module: $module_id"

    # Check if jq is available for JSON parsing
    if ! command -v jq &>/dev/null; then
        log_error "jq is required for JSON parsing"
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            echo '{"success": false, "error": "jq not available", "resolved": [], "unresolved": [], "warnings": []}'
        fi
        return 2
    fi

    # Parse requirements from manifest
    local requirements
    requirements=$(jq -c '.requires.connections // []' "$manifest_path" 2>/dev/null)

    if [[ "$requirements" == "[]" || -z "$requirements" ]]; then
        log_info "No connection requirements declared"
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            echo '{"success": true, "resolved": [], "unresolved": [], "warnings": []}'
        fi
        return 0
    fi

    # Get available providers
    local available_providers
    available_providers=$(get_available_providers)

    # Resolution results
    local resolved_json="[]"
    local unresolved_json="[]"
    local warnings_json="[]"
    local all_resolved=true

    # Process each requirement
    while IFS= read -r req; do
        local req_type req_providers req_required req_name
        req_type=$(echo "$req" | jq -r '.type')
        req_providers=$(echo "$req" | jq -r '.providers | join(" ")')
        req_required=$(echo "$req" | jq -r '.required // true')
        req_name=$(echo "$req" | jq -r '.name // .type')

        local found=false
        local matched_provider=""
        local matched_module=""

        # Try to find a matching provider
        while IFS=: read -r provider module; do
            if [[ -n "$provider" ]] && provider_satisfies "$provider" "$req_providers"; then
                found=true
                matched_provider="$provider"
                matched_module="$module"
                break
            fi
        done <<< "$available_providers"

        if [[ "$found" == "true" ]]; then
            log_success "$req_name -> $matched_provider ($matched_module)"

            # Add to resolved
            resolved_json=$(echo "$resolved_json" | jq --arg name "$req_name" \
                --arg provider "$matched_provider" \
                --arg module "$matched_module" \
                --arg type "$req_type" \
                '. + [{
                    "requirementName": $name,
                    "providerModule": $module,
                    "providerName": $provider,
                    "type": $type,
                    "config": {}
                }]')
        else
            log_failure "$req_name -> [$req_providers] - No provider available"

            # Add to unresolved
            unresolved_json=$(echo "$unresolved_json" | jq --arg name "$req_name" \
                --arg providers "$req_providers" \
                --arg type "$req_type" \
                '. + [{
                    "requirement": {
                        "name": $name,
                        "type": $type,
                        "providers": ($providers | split(" "))
                    },
                    "reason": "No matching provider installed"
                }]')

            if [[ "$req_required" == "true" ]]; then
                all_resolved=false
            else
                warnings_json=$(echo "$warnings_json" | jq --arg msg "Optional connection '$req_name' not available" \
                    '. + [$msg]')
                log_warn "Optional connection '$req_name' not available"
            fi
        fi
    done < <(echo "$requirements" | jq -c '.[]')

    # Output results
    if [[ "$OUTPUT_JSON" == "true" ]]; then
        jq -n --argjson success "$([[ "$all_resolved" == "true" ]] && echo "true" || echo "false")" \
            --argjson resolved "$resolved_json" \
            --argjson unresolved "$unresolved_json" \
            --argjson warnings "$warnings_json" \
            '{
                success: $success,
                resolved: $resolved,
                unresolved: $unresolved,
                warnings: $warnings
            }'
    fi

    if [[ "$all_resolved" == "true" ]]; then
        log_info ""
        log_info "All required connections resolved successfully."
        return 0
    else
        log_info ""
        log_error "One or more required connections could not be resolved."
        return 1
    fi
}

# Run resolution
resolve_connections "$MODULE_ID"
