#!/usr/bin/env bash
#
# PeerMesh Foundation - Dashboard Registration Script
#
# This script registers a module's UI components with the dashboard.
# It reads the module manifest, extracts dashboard configuration, and
# registers routes, widgets, and config panels with the dashboard if installed.
#
# If no dashboard module is installed, this script is a no-op.
#
# Usage:
#   ./dashboard-register.sh <module-id> [--json] [--quiet] [--unregister]
#
# Arguments:
#   module-id     - ID of the module to register
#   --json        - Output in JSON format (default: human-readable)
#   --quiet       - Suppress warnings, only output errors
#   --unregister  - Unregister the module instead of registering
#
# Exit codes:
#   0 - Registration successful (or no-op if dashboard not installed)
#   1 - Registration failed
#   2 - Module not found or invalid manifest
#
# Environment:
#   FOUNDATION_DIR    - Path to foundation directory (default: script's parent)
#   MODULES_DIR       - Path to modules directory (default: foundation/modules)
#   DASHBOARD_API_URL - Dashboard API URL (default: http://localhost:3000/api/registry)
#
# Example:
#   ./dashboard-register.sh backup-module
#   ./dashboard-register.sh backup-module --json
#   ./dashboard-register.sh backup-module --unregister
#
#   Output (human-readable):
#     Registering dashboard components for: backup-module
#     Dashboard module: not installed (no-op)
#     -- or --
#     Dashboard module: available
#     Routes registered: 2
#     Widgets registered: 1
#     Config panels registered: 1
#     Registration successful.
#
#   Output (JSON):
#     {
#       "success": true,
#       "moduleId": "backup-module",
#       "dashboardAvailable": false,
#       "routesRegistered": 0,
#       "widgetsRegistered": 0,
#       "configPanelsRegistered": 0,
#       "warnings": ["Dashboard module not installed; registration ignored"]
#     }

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Foundation directory (parent of lib/)
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$SCRIPT_DIR")}"

# Modules directory
MODULES_DIR="${MODULES_DIR:-$(dirname "$FOUNDATION_DIR")/modules}"

# Dashboard API URL
DASHBOARD_API_URL="${DASHBOARD_API_URL:-http://localhost:3000/api/registry}"

# Output format
OUTPUT_JSON=false
QUIET=false
UNREGISTER=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track if we've warned about no dashboard
_DASHBOARD_WARNED=${_DASHBOARD_WARNED:-false}

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
        --unregister)
            UNREGISTER=true
            shift
            ;;
        -h|--help)
            cat <<EOF
Usage: $0 <module-id> [--json] [--quiet] [--unregister]

Register a module's dashboard components (routes, widgets, config panels).

Arguments:
  module-id     Module ID to register
  --json        Output in JSON format
  --quiet       Suppress warnings
  --unregister  Unregister the module

Exit codes:
  0 - Registration successful (or no-op if dashboard not installed)
  1 - Registration failed
  2 - Module not found or invalid manifest

Environment:
  FOUNDATION_DIR    Path to foundation directory
  MODULES_DIR       Path to modules directory
  DASHBOARD_API_URL Dashboard API URL for registration

EOF
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
    echo "Usage: $0 <module-id> [--json] [--quiet] [--unregister]" >&2
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
        echo -e "${GREEN}$1${NC}"
    fi
}

log_debug() {
    if [[ "$OUTPUT_JSON" == "false" && "${DEBUG:-false}" == "true" ]]; then
        echo -e "${BLUE}[DEBUG]${NC} $1" >&2
    fi
}

# Internal function to emit warning once about no dashboard
_dashboard_warn_once() {
    if [[ "$_DASHBOARD_WARNED" == "false" && "$QUIET" == "false" ]]; then
        log_warn "Dashboard module not installed. Registration has no effect."
        export _DASHBOARD_WARNED=true
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

# Check if dashboard module is installed
check_dashboard_available() {
    # Method 1: Check if dashboard module directory exists
    if [[ -d "$MODULES_DIR/dashboard" ]]; then
        # Check if it has a valid manifest
        if [[ -f "$MODULES_DIR/dashboard/module.json" ]]; then
            return 0
        fi
    fi

    # Method 2: Try to reach dashboard API (if running)
    if command -v curl &>/dev/null; then
        if curl -s --connect-timeout 2 "$DASHBOARD_API_URL/health" >/dev/null 2>&1; then
            return 0
        fi
    fi

    return 1
}

# Extract dashboard config from module manifest
extract_dashboard_config() {
    local manifest_path="$1"

    if ! command -v jq &>/dev/null; then
        log_error "jq is required for JSON parsing"
        return 1
    fi

    # Extract dashboard section from manifest
    local dashboard_config
    dashboard_config=$(jq -c '.dashboard // {}' "$manifest_path" 2>/dev/null)

    if [[ -z "$dashboard_config" || "$dashboard_config" == "{}" ]]; then
        # Try alternate location in 'provides' section
        dashboard_config=$(jq -c '.provides.dashboard // {}' "$manifest_path" 2>/dev/null)
    fi

    echo "$dashboard_config"
}

# Build registration payload
build_registration_payload() {
    local module_id="$1"
    local manifest_path="$2"

    local display_name icon version
    display_name=$(jq -r '.name // .id // ""' "$manifest_path" 2>/dev/null)
    icon=$(jq -r '.icon // ""' "$manifest_path" 2>/dev/null)
    version=$(jq -r '.version // ""' "$manifest_path" 2>/dev/null)

    local dashboard_config
    dashboard_config=$(extract_dashboard_config "$manifest_path")

    # Extract routes, widgets, configPanels from dashboard config
    local routes widgets config_panels
    routes=$(echo "$dashboard_config" | jq -c '.routes // []')
    widgets=$(echo "$dashboard_config" | jq -c '.widgets // []')
    config_panels=$(echo "$dashboard_config" | jq -c '.configPanels // []')

    # Build full registration payload
    jq -n \
        --arg moduleId "$module_id" \
        --arg displayName "$display_name" \
        --arg icon "$icon" \
        --arg version "$version" \
        --argjson routes "$routes" \
        --argjson widgets "$widgets" \
        --argjson configPanels "$config_panels" \
        '{
            moduleId: $moduleId,
            displayName: (if $displayName == "" then null else $displayName end),
            icon: (if $icon == "" then null else $icon end),
            version: (if $version == "" then null else $version end),
            routes: $routes,
            widgets: $widgets,
            configPanels: $configPanels
        }'
}

# Register with dashboard API
register_with_dashboard() {
    local payload="$1"

    if ! command -v curl &>/dev/null; then
        log_error "curl is required for dashboard registration"
        return 1
    fi

    local response
    response=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "$payload" \
        "$DASHBOARD_API_URL/register" 2>/dev/null)

    echo "$response"
}

# Unregister from dashboard API
unregister_from_dashboard() {
    local module_id="$1"

    if ! command -v curl &>/dev/null; then
        log_error "curl is required for dashboard unregistration"
        return 1
    fi

    local response
    response=$(curl -s -X DELETE \
        "$DASHBOARD_API_URL/unregister/$module_id" 2>/dev/null)

    echo "$response"
}

# Main registration logic
main() {
    local module_id="$1"
    local manifest_path

    # Find module manifest
    if ! manifest_path=$(find_module_manifest "$module_id"); then
        log_error "Module not found: $module_id"
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            echo '{"success": false, "error": "Module not found", "moduleId": "'"$module_id"'"}'
        fi
        return 2
    fi

    if [[ "$UNREGISTER" == "true" ]]; then
        log_info "Unregistering dashboard components for: $module_id"
    else
        log_info "Registering dashboard components for: $module_id"
    fi

    # Check if jq is available
    if ! command -v jq &>/dev/null; then
        log_error "jq is required for JSON parsing"
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            echo '{"success": false, "error": "jq not available", "moduleId": "'"$module_id"'"}'
        fi
        return 2
    fi

    # Check if dashboard is available
    local dashboard_available=false
    if check_dashboard_available; then
        dashboard_available=true
        log_info "Dashboard module: available"
    else
        _dashboard_warn_once
        log_info "Dashboard module: not installed (no-op)"
    fi

    # Handle unregistration
    if [[ "$UNREGISTER" == "true" ]]; then
        if [[ "$dashboard_available" == "true" ]]; then
            local response
            response=$(unregister_from_dashboard "$module_id")
            if [[ "$OUTPUT_JSON" == "true" ]]; then
                echo "$response"
            else
                log_success "Unregistration successful."
            fi
        else
            if [[ "$OUTPUT_JSON" == "true" ]]; then
                jq -n \
                    --arg moduleId "$module_id" \
                    '{
                        success: true,
                        moduleId: $moduleId,
                        dashboardAvailable: false,
                        warnings: ["Dashboard module not installed; unregistration ignored"]
                    }'
            fi
        fi
        return 0
    fi

    # Build registration payload
    local payload
    payload=$(build_registration_payload "$module_id" "$manifest_path")

    log_debug "Registration payload: $payload"

    # Count components
    local route_count widget_count config_panel_count
    route_count=$(echo "$payload" | jq '.routes | length')
    widget_count=$(echo "$payload" | jq '.widgets | length')
    config_panel_count=$(echo "$payload" | jq '.configPanels | length')

    # If dashboard is not available, return no-op result
    if [[ "$dashboard_available" == "false" ]]; then
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n \
                --arg moduleId "$module_id" \
                --argjson routeCount "$route_count" \
                --argjson widgetCount "$widget_count" \
                --argjson configPanelCount "$config_panel_count" \
                '{
                    success: true,
                    moduleId: $moduleId,
                    dashboardAvailable: false,
                    routesRegistered: 0,
                    widgetsRegistered: 0,
                    configPanelsRegistered: 0,
                    routesDeclared: $routeCount,
                    widgetsDeclared: $widgetCount,
                    configPanelsDeclared: $configPanelCount,
                    warnings: ["Dashboard module not installed; registration ignored"]
                }'
        else
            log_info "Routes declared: $route_count (not registered)"
            log_info "Widgets declared: $widget_count (not registered)"
            log_info "Config panels declared: $config_panel_count (not registered)"
        fi
        return 0
    fi

    # Register with dashboard
    local response
    response=$(register_with_dashboard "$payload")

    if [[ "$OUTPUT_JSON" == "true" ]]; then
        # Enhance response with dashboard availability
        echo "$response" | jq --argjson available "$dashboard_available" '. + {dashboardAvailable: $available}'
    else
        local success
        success=$(echo "$response" | jq -r '.success // false')

        if [[ "$success" == "true" ]]; then
            local routes_reg widgets_reg panels_reg
            routes_reg=$(echo "$response" | jq -r '.routesRegistered // 0')
            widgets_reg=$(echo "$response" | jq -r '.widgetsRegistered // 0')
            panels_reg=$(echo "$response" | jq -r '.configPanelsRegistered // 0')

            log_info "Routes registered: $routes_reg"
            log_info "Widgets registered: $widgets_reg"
            log_info "Config panels registered: $panels_reg"
            log_success "Registration successful."
        else
            local error_msg
            error_msg=$(echo "$response" | jq -r '.errors[]? // .error // "Unknown error"')
            log_error "Registration failed: $error_msg"
            return 1
        fi
    fi

    return 0
}

# Run main
main "$MODULE_ID"
