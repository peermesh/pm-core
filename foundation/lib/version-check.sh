#!/usr/bin/env bash
#
# PeerMesh Foundation - Version Compatibility Checker
#
# This script provides semantic version comparison and compatibility checking.
# It can be sourced as a library or run directly as a command-line tool.
#
# Usage (CLI):
#   ./version-check.sh compare <version1> <version2>
#   ./version-check.sh compatible <version> <min> [max]
#   ./version-check.sh parse <version>
#   ./version-check.sh range <version> <range-expression>
#   ./version-check.sh module <module-id> [--foundation-version <version>]
#
# Usage (Library):
#   source ./version-check.sh
#   version_compare "1.0.0" "2.0.0"   # Returns -1, 0, or 1
#   version_compatible "1.5.0" "1.0.0" "2.0.0"  # Returns 0 (true) or 1 (false)
#   version_parse "1.2.3-alpha.1+build.456"  # Outputs parsed components
#
# Exit codes:
#   0 - Success / Compatible / Version1 equals Version2
#   1 - Incompatible / Version1 less than Version2 / Parse error
#   2 - Version1 greater than Version2
#   3 - Invalid version format
#   4 - Invalid arguments
#
# Environment:
#   FOUNDATION_DIR     - Path to foundation directory
#   FOUNDATION_VERSION - Current foundation version (default: read from foundation)
#   MODULES_DIR        - Path to modules directory
#

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Foundation directory (parent of lib/)
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$SCRIPT_DIR")}"

# Modules directory
MODULES_DIR="${MODULES_DIR:-$(dirname "$FOUNDATION_DIR")/modules}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Output format
OUTPUT_JSON=false
QUIET=false

# -----------------------------------------------------------------------------
# Semver Regex Pattern
# -----------------------------------------------------------------------------

# Full semver regex (POSIX extended)
# Format: MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
SEMVER_REGEX='^([0-9]+)\.([0-9]+)\.([0-9]+)(-([a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*))?(\+([a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*))?$'

# Version constraint regex (with optional operator)
CONSTRAINT_REGEX='^(=|>=?|<=?|\^|~)?([0-9]+)\.([0-9]+)\.([0-9]+)(-([a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*))?(\+([a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*))?$'

# -----------------------------------------------------------------------------
# Core Functions (Library API)
# -----------------------------------------------------------------------------

# Parse a semantic version string into components
# Usage: version_parse "1.2.3-alpha.1+build.456"
# Output: MAJOR MINOR PATCH PRERELEASE BUILD (space-separated)
# Returns: 0 on success, 3 on invalid format
version_parse() {
    local version="$1"

    if [[ ! "$version" =~ $SEMVER_REGEX ]]; then
        return 3
    fi

    local major="${BASH_REMATCH[1]}"
    local minor="${BASH_REMATCH[2]}"
    local patch="${BASH_REMATCH[3]}"
    local prerelease="${BASH_REMATCH[5]:-}"
    local build="${BASH_REMATCH[8]:-}"

    echo "$major $minor $patch $prerelease $build"
    return 0
}

# Parse a version constraint (operator + version)
# Usage: version_parse_constraint ">=1.2.3"
# Output: OPERATOR MAJOR MINOR PATCH PRERELEASE BUILD
# Returns: 0 on success, 3 on invalid format
version_parse_constraint() {
    local constraint="$1"

    if [[ ! "$constraint" =~ $CONSTRAINT_REGEX ]]; then
        return 3
    fi

    local operator="${BASH_REMATCH[1]:-=}"
    local major="${BASH_REMATCH[2]}"
    local minor="${BASH_REMATCH[3]}"
    local patch="${BASH_REMATCH[4]}"
    local prerelease="${BASH_REMATCH[6]:-}"
    local build="${BASH_REMATCH[9]:-}"

    echo "$operator $major $minor $patch $prerelease $build"
    return 0
}

# Compare two prerelease strings
# Returns: -1 if a < b, 0 if a == b, 1 if a > b
# Empty prerelease > any prerelease (1.0.0 > 1.0.0-alpha)
_compare_prerelease() {
    local a="$1"
    local b="$2"

    # No prerelease beats having prerelease
    if [[ -z "$a" && -n "$b" ]]; then
        echo 1
        return
    fi
    if [[ -n "$a" && -z "$b" ]]; then
        echo -1
        return
    fi
    if [[ -z "$a" && -z "$b" ]]; then
        echo 0
        return
    fi

    # Split by dots and compare each identifier
    IFS='.' read -ra a_parts <<< "$a"
    IFS='.' read -ra b_parts <<< "$b"

    local max_len=${#a_parts[@]}
    if [[ ${#b_parts[@]} -gt $max_len ]]; then
        max_len=${#b_parts[@]}
    fi

    for ((i = 0; i < max_len; i++)); do
        local a_part="${a_parts[$i]:-}"
        local b_part="${b_parts[$i]:-}"

        # Missing part loses
        if [[ -z "$a_part" ]]; then
            echo -1
            return
        fi
        if [[ -z "$b_part" ]]; then
            echo 1
            return
        fi

        # Numeric comparison if both are numbers
        if [[ "$a_part" =~ ^[0-9]+$ && "$b_part" =~ ^[0-9]+$ ]]; then
            if [[ $a_part -lt $b_part ]]; then
                echo -1
                return
            elif [[ $a_part -gt $b_part ]]; then
                echo 1
                return
            fi
        else
            # String comparison (numeric < string in semver)
            if [[ "$a_part" =~ ^[0-9]+$ ]]; then
                echo -1
                return
            elif [[ "$b_part" =~ ^[0-9]+$ ]]; then
                echo 1
                return
            elif [[ "$a_part" < "$b_part" ]]; then
                echo -1
                return
            elif [[ "$a_part" > "$b_part" ]]; then
                echo 1
                return
            fi
        fi
    done

    echo 0
}

# Compare two semantic versions
# Usage: version_compare "1.0.0" "2.0.0"
# Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
# Exit code: 1 if v1 < v2, 0 if v1 == v2, 2 if v1 > v2, 3 on error
version_compare() {
    local v1="$1"
    local v2="$2"

    local parsed1 parsed2
    if ! parsed1=$(version_parse "$v1"); then
        echo "Error: Invalid version format: $v1" >&2
        return 3
    fi
    if ! parsed2=$(version_parse "$v2"); then
        echo "Error: Invalid version format: $v2" >&2
        return 3
    fi

    read -r v1_major v1_minor v1_patch v1_pre v1_build <<< "$parsed1"
    read -r v2_major v2_minor v2_patch v2_pre v2_build <<< "$parsed2"

    # Compare major
    if [[ $v1_major -lt $v2_major ]]; then
        echo -1
        return 1
    elif [[ $v1_major -gt $v2_major ]]; then
        echo 1
        return 2
    fi

    # Compare minor
    if [[ $v1_minor -lt $v2_minor ]]; then
        echo -1
        return 1
    elif [[ $v1_minor -gt $v2_minor ]]; then
        echo 1
        return 2
    fi

    # Compare patch
    if [[ $v1_patch -lt $v2_patch ]]; then
        echo -1
        return 1
    elif [[ $v1_patch -gt $v2_patch ]]; then
        echo 1
        return 2
    fi

    # Compare prerelease
    local pre_cmp
    pre_cmp=$(_compare_prerelease "$v1_pre" "$v2_pre")

    if [[ $pre_cmp -lt 0 ]]; then
        echo -1
        return 1
    elif [[ $pre_cmp -gt 0 ]]; then
        echo 1
        return 2
    fi

    echo 0
    return 0
}

# Check if a version is within a range (min <= version < max)
# Usage: version_compatible "1.5.0" "1.0.0" ["2.0.0"] [--max-inclusive]
# Returns: 0 if compatible, 1 if not compatible
version_compatible() {
    local version="$1"
    local min_version="$2"
    local max_version="${3:-}"
    local max_inclusive="${4:-false}"

    # Check minimum version
    local cmp_min cmp_exit
    set +e
    cmp_min=$(version_compare "$version" "$min_version")
    cmp_exit=$?
    set -e

    # Exit code 3 means invalid format
    if [[ $cmp_exit -eq 3 ]]; then
        return 1
    fi

    if [[ $cmp_min -lt 0 ]]; then
        return 1  # version < min
    fi

    # Check maximum version if specified
    if [[ -n "$max_version" ]]; then
        local cmp_max
        set +e
        cmp_max=$(version_compare "$version" "$max_version")
        cmp_exit=$?
        set -e

        if [[ $cmp_exit -eq 3 ]]; then
            return 1
        fi

        if [[ "$max_inclusive" == "true" || "$max_inclusive" == "--max-inclusive" ]]; then
            if [[ $cmp_max -gt 0 ]]; then
                return 1  # version > max
            fi
        else
            if [[ $cmp_max -ge 0 ]]; then
                return 1  # version >= max (exclusive)
            fi
        fi
    fi

    return 0
}

# Check version against a constraint expression
# Usage: version_satisfies "1.5.0" ">=1.0.0"
# Operators: = (exact), > (gt), < (lt), >= (gte), <= (lte), ^ (compatible), ~ (approximately)
# Returns: 0 if satisfies, 1 if not
version_satisfies() {
    local version="$1"
    local constraint="$2"

    local parsed
    if ! parsed=$(version_parse_constraint "$constraint"); then
        echo "Error: Invalid constraint format: $constraint" >&2
        return 3
    fi

    read -r operator c_major c_minor c_patch c_pre c_build <<< "$parsed"
    local constraint_version="${c_major}.${c_minor}.${c_patch}"
    if [[ -n "$c_pre" ]]; then
        constraint_version="${constraint_version}-${c_pre}"
    fi

    local cmp cmp_exit
    set +e
    cmp=$(version_compare "$version" "$constraint_version")
    cmp_exit=$?
    set -e

    if [[ $cmp_exit -eq 3 ]]; then
        return 1
    fi

    case "$operator" in
        "="|"")
            [[ $cmp -eq 0 ]] && return 0
            ;;
        ">")
            [[ $cmp -gt 0 ]] && return 0
            ;;
        "<")
            [[ $cmp -lt 0 ]] && return 0
            ;;
        ">=")
            [[ $cmp -ge 0 ]] && return 0
            ;;
        "<=")
            [[ $cmp -le 0 ]] && return 0
            ;;
        "^")
            # Compatible: same major, >= constraint
            local v_parsed
            if ! v_parsed=$(version_parse "$version"); then
                return 1
            fi
            read -r v_major v_minor v_patch _ _ <<< "$v_parsed"

            if [[ $v_major -eq $c_major && $cmp -ge 0 ]]; then
                # For 0.x versions, minor must also match
                if [[ $c_major -eq 0 && $v_minor -ne $c_minor ]]; then
                    return 1
                fi
                return 0
            fi
            ;;
        "~")
            # Approximately: same major.minor, >= constraint
            local v_parsed
            if ! v_parsed=$(version_parse "$version"); then
                return 1
            fi
            read -r v_major v_minor v_patch _ _ <<< "$v_parsed"

            if [[ $v_major -eq $c_major && $v_minor -eq $c_minor && $cmp -ge 0 ]]; then
                return 0
            fi
            ;;
    esac

    return 1
}

# Check version against a range expression
# Usage: version_in_range "1.5.0" ">=1.0.0 <2.0.0"
# Returns: 0 if in range, 1 if not
version_in_range() {
    local version="$1"
    local range="$2"

    # Split range by spaces and check each constraint
    local constraints
    read -ra constraints <<< "$range"

    for constraint in "${constraints[@]}"; do
        if ! version_satisfies "$version" "$constraint"; then
            return 1
        fi
    done

    return 0
}

# Get foundation version from foundation directory
get_foundation_version() {
    local version_file="$FOUNDATION_DIR/VERSION"
    local package_file="$FOUNDATION_DIR/package.json"

    if [[ -f "$version_file" ]]; then
        cat "$version_file"
    elif [[ -f "$package_file" ]] && command -v jq &>/dev/null; then
        jq -r '.version // "1.0.0"' "$package_file"
    else
        # Default version if not found
        echo "1.0.0"
    fi
}

# Check if a module is compatible with foundation version
# Usage: check_module_compatibility <module-id> [foundation-version]
# Returns: 0 if compatible, 1 if not, 2 if module not found
check_module_compatibility() {
    local module_id="$1"
    local foundation_version="${2:-$(get_foundation_version)}"

    local manifest="$MODULES_DIR/$module_id/module.json"

    if [[ ! -f "$manifest" ]]; then
        echo "Error: Module not found: $module_id" >&2
        return 2
    fi

    if ! command -v jq &>/dev/null; then
        echo "Error: jq is required for JSON parsing" >&2
        return 2
    fi

    local min_version max_version
    min_version=$(jq -r '.foundation.minVersion // "0.0.0"' "$manifest")
    max_version=$(jq -r '.foundation.maxVersion // ""' "$manifest")

    if version_compatible "$foundation_version" "$min_version" "$max_version"; then
        return 0
    else
        return 1
    fi
}

# -----------------------------------------------------------------------------
# CLI Commands
# -----------------------------------------------------------------------------

cmd_compare() {
    local v1="$1"
    local v2="$2"

    local result exit_code
    set +e  # Temporarily disable errexit to capture exit code
    result=$(version_compare "$v1" "$v2")
    exit_code=$?
    set -e  # Re-enable errexit

    # Exit code 3 means invalid version format
    if [[ $exit_code -eq 3 ]]; then
        echo "Error comparing versions" >&2
        exit 3
    fi

    if [[ "$OUTPUT_JSON" == "true" ]]; then
        jq -n --arg v1 "$v1" --arg v2 "$v2" --argjson result "$result" \
            '{"version1": $v1, "version2": $v2, "result": $result, "comparison": (if $result < 0 then "less" elif $result > 0 then "greater" else "equal" end)}'
    else
        case $result in
            -1) echo "$v1 < $v2" ;;
            0)  echo "$v1 = $v2" ;;
            1)  echo "$v1 > $v2" ;;
        esac
    fi

    case $result in
        -1) exit 1 ;;
        0)  exit 0 ;;
        1)  exit 2 ;;
    esac
}

cmd_compatible() {
    local version="$1"
    local min="$2"
    local max="${3:-}"
    local max_inclusive="${4:-false}"

    if version_compatible "$version" "$min" "$max" "$max_inclusive"; then
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n --arg v "$version" --arg min "$min" --arg max "$max" \
                '{"version": $v, "minVersion": $min, "maxVersion": (if $max == "" then null else $max end), "compatible": true}'
        else
            echo -e "${GREEN}Compatible:${NC} $version is within range [$min, ${max:-*})"
        fi
        exit 0
    else
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n --arg v "$version" --arg min "$min" --arg max "$max" \
                '{"version": $v, "minVersion": $min, "maxVersion": (if $max == "" then null else $max end), "compatible": false}'
        else
            echo -e "${RED}Incompatible:${NC} $version is NOT within range [$min, ${max:-*})"
        fi
        exit 1
    fi
}

cmd_parse() {
    local version="$1"

    local parsed
    if ! parsed=$(version_parse "$version"); then
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n --arg v "$version" '{"version": $v, "valid": false, "error": "Invalid version format"}'
        else
            echo -e "${RED}Error:${NC} Invalid version format: $version"
        fi
        exit 3
    fi

    read -r major minor patch prerelease build <<< "$parsed"

    if [[ "$OUTPUT_JSON" == "true" ]]; then
        jq -n --arg v "$version" \
            --argjson major "$major" \
            --argjson minor "$minor" \
            --argjson patch "$patch" \
            --arg pre "$prerelease" \
            --arg build "$build" \
            '{
                "version": $v,
                "valid": true,
                "major": $major,
                "minor": $minor,
                "patch": $patch,
                "prerelease": (if $pre == "" then null else $pre end),
                "build": (if $build == "" then null else $build end)
            }'
    else
        echo "Version: $version"
        echo "  Major:      $major"
        echo "  Minor:      $minor"
        echo "  Patch:      $patch"
        [[ -n "$prerelease" ]] && echo "  Prerelease: $prerelease"
        [[ -n "$build" ]] && echo "  Build:      $build"
    fi

    exit 0
}

cmd_range() {
    local version="$1"
    local range="$2"

    if version_in_range "$version" "$range"; then
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n --arg v "$version" --arg r "$range" \
                '{"version": $v, "range": $r, "satisfies": true}'
        else
            echo -e "${GREEN}Satisfies:${NC} $version matches range '$range'"
        fi
        exit 0
    else
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n --arg v "$version" --arg r "$range" \
                '{"version": $v, "range": $r, "satisfies": false}'
        else
            echo -e "${RED}Does not satisfy:${NC} $version does NOT match range '$range'"
        fi
        exit 1
    fi
}

cmd_module() {
    local module_id="$1"
    local foundation_version="${2:-$(get_foundation_version)}"

    local manifest="$MODULES_DIR/$module_id/module.json"

    if [[ ! -f "$manifest" ]]; then
        if [[ "$OUTPUT_JSON" == "true" ]]; then
            jq -n --arg id "$module_id" \
                '{"moduleId": $id, "found": false, "error": "Module not found"}'
        else
            echo -e "${RED}Error:${NC} Module not found: $module_id"
        fi
        exit 2
    fi

    if ! command -v jq &>/dev/null; then
        echo "Error: jq is required for JSON parsing" >&2
        exit 2
    fi

    local min_version max_version module_version module_name
    min_version=$(jq -r '.foundation.minVersion // "0.0.0"' "$manifest")
    max_version=$(jq -r '.foundation.maxVersion // ""' "$manifest")
    module_version=$(jq -r '.version // "unknown"' "$manifest")
    module_name=$(jq -r '.name // .id' "$manifest")

    local compatible=false
    local reason=""

    if version_compatible "$foundation_version" "$min_version" "$max_version"; then
        compatible=true
    else
        local cmp_min
        cmp_min=$(version_compare "$foundation_version" "$min_version" 2>/dev/null || echo "0")

        if [[ $cmp_min -lt 0 ]]; then
            reason="Foundation version $foundation_version is below minimum $min_version"
        elif [[ -n "$max_version" ]]; then
            reason="Foundation version $foundation_version is at or above maximum $max_version"
        fi
    fi

    if [[ "$OUTPUT_JSON" == "true" ]]; then
        jq -n --arg id "$module_id" \
            --arg name "$module_name" \
            --arg mv "$module_version" \
            --arg fv "$foundation_version" \
            --arg min "$min_version" \
            --arg max "$max_version" \
            --argjson compat "$compatible" \
            --arg reason "$reason" \
            '{
                "moduleId": $id,
                "moduleName": $name,
                "moduleVersion": $mv,
                "foundationVersion": $fv,
                "requiredRange": {
                    "min": $min,
                    "max": (if $max == "" then null else $max end)
                },
                "compatible": $compat,
                "reason": (if $reason == "" then null else $reason end)
            }'
    else
        echo "Module: $module_name ($module_id)"
        echo "  Module Version:     $module_version"
        echo "  Foundation Version: $foundation_version"
        echo "  Required Range:     [$min_version, ${max_version:-*})"
        if [[ "$compatible" == "true" ]]; then
            echo -e "  Status:             ${GREEN}Compatible${NC}"
        else
            echo -e "  Status:             ${RED}Incompatible${NC}"
            [[ -n "$reason" ]] && echo "  Reason:             $reason"
        fi
    fi

    [[ "$compatible" == "true" ]] && exit 0 || exit 1
}

show_help() {
    cat << 'EOF'
PeerMesh Foundation - Version Compatibility Checker

USAGE:
    version-check.sh <command> [options] [arguments]

COMMANDS:
    compare <v1> <v2>           Compare two semantic versions
    compatible <v> <min> [max]  Check if version is within range
    parse <version>             Parse and display version components
    range <version> <range>     Check version against range expression
    module <id> [--foundation-version <v>]
                                Check module compatibility with foundation

OPTIONS:
    --json          Output in JSON format
    --quiet         Suppress informational messages
    -h, --help      Show this help message

EXAMPLES:
    # Compare versions
    version-check.sh compare 1.0.0 2.0.0

    # Check compatibility range
    version-check.sh compatible 1.5.0 1.0.0 2.0.0

    # Parse a version
    version-check.sh parse 1.2.3-alpha.1+build.456

    # Check version against range expression
    version-check.sh range 1.5.0 ">=1.0.0 <2.0.0"

    # Check module compatibility
    version-check.sh module my-module
    version-check.sh module my-module --foundation-version 1.5.0

EXIT CODES:
    compare:
        0 - Versions are equal
        1 - Version1 < Version2
        2 - Version1 > Version2
        3 - Invalid version format

    compatible/range/module:
        0 - Compatible / Satisfies
        1 - Incompatible / Does not satisfy
        2 - Module/file not found
        3 - Invalid format

VERSION OPERATORS:
    =   Exact match (default if no operator)
    >   Greater than
    <   Less than
    >=  Greater than or equal
    <=  Less than or equal
    ^   Compatible (same major, >= version)
    ~   Approximately (same major.minor, >= version)

RANGE EXPRESSIONS:
    Combine constraints with spaces:
    ">=1.0.0 <2.0.0"  - Version 1.x (not 2.0+)
    "^1.2.0"          - Compatible with 1.2.0
    "~1.2.0"          - Patch updates only (1.2.x)

LIBRARY USAGE:
    Source this script to use functions directly:

    source ./version-check.sh

    # Compare versions
    result=$(version_compare "1.0.0" "2.0.0")
    # result is -1, 0, or 1

    # Check compatibility
    if version_compatible "1.5.0" "1.0.0" "2.0.0"; then
        echo "Compatible"
    fi

    # Parse version
    read major minor patch pre build <<< "$(version_parse "1.2.3")"
EOF
}

# -----------------------------------------------------------------------------
# Main Entry Point
# -----------------------------------------------------------------------------

main() {
    local command=""
    local args=()
    local foundation_version=""

    # Parse global options
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
                show_help
                exit 0
                ;;
            --foundation-version)
                foundation_version="$2"
                shift 2
                ;;
            -*)
                echo "Unknown option: $1" >&2
                exit 4
                ;;
            *)
                if [[ -z "$command" ]]; then
                    command="$1"
                else
                    args+=("$1")
                fi
                shift
                ;;
        esac
    done

    # Execute command
    case "$command" in
        compare)
            if [[ ${#args[@]} -lt 2 ]]; then
                echo "Usage: $0 compare <version1> <version2>" >&2
                exit 4
            fi
            cmd_compare "${args[0]}" "${args[1]}"
            ;;
        compatible)
            if [[ ${#args[@]} -lt 2 ]]; then
                echo "Usage: $0 compatible <version> <min> [max]" >&2
                exit 4
            fi
            cmd_compatible "${args[0]}" "${args[1]}" "${args[2]:-}" "${args[3]:-false}"
            ;;
        parse)
            if [[ ${#args[@]} -lt 1 ]]; then
                echo "Usage: $0 parse <version>" >&2
                exit 4
            fi
            cmd_parse "${args[0]}"
            ;;
        range)
            if [[ ${#args[@]} -lt 2 ]]; then
                echo "Usage: $0 range <version> <range-expression>" >&2
                exit 4
            fi
            cmd_range "${args[0]}" "${args[1]}"
            ;;
        module)
            if [[ ${#args[@]} -lt 1 ]]; then
                echo "Usage: $0 module <module-id> [--foundation-version <version>]" >&2
                exit 4
            fi
            cmd_module "${args[0]}" "$foundation_version"
            ;;
        "")
            show_help
            exit 0
            ;;
        *)
            echo "Unknown command: $command" >&2
            echo "Run '$0 --help' for usage information." >&2
            exit 4
            ;;
    esac
}

# Only run main if script is executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
