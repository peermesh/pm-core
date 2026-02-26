#!/usr/bin/env bash
#
# PeerMesh Foundation - Module Dependency Resolver
#
# Resolves requires.modules[] dependencies from module manifests and returns
# a safe topological order (dependencies first). Fails closed on:
# - missing required dependencies
# - version constraint failures for required dependencies
# - circular dependency graphs
#
# Usage:
#   ./dependency-resolve.sh <module-id> [--modules-dir PATH] [--dry-run] [--order-only]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$SCRIPT_DIR")}"
MODULES_DIR="${MODULES_DIR:-$(dirname "$FOUNDATION_DIR")/modules}"
VERSION_CHECK_SCRIPT="$SCRIPT_DIR/version-check.sh"

TARGET_MODULE=""
DRY_RUN=false
ORDER_ONLY=false

declare -A MANIFEST_PATHS
declare -A MODULE_VERSIONS
declare -A MODULE_DEPENDENCIES
declare -A MODULE_OPTIONAL_EDGES
declare -A GRAPH_INCLUDED
declare -A DFS_STATE
declare -A COLLECTED

ORDERED_MODULES=()
ERRORS=()
WARNINGS=()
DFS_STACK=()
CYCLE_MESSAGE=""

usage() {
    cat <<'EOF'
Usage: dependency-resolve.sh <module-id> [OPTIONS]

Resolve module dependencies from requires.modules[] and output install/start order.

Options:
  --modules-dir PATH   Override modules directory
  --dry-run            Print human-readable execution plan
  --order-only         Print resolved order only (one module id per line)
  -h, --help           Show this help

Exit codes:
  0  Success
  1  Dependency graph invalid (missing deps/version mismatch/cycle)
  2  Invalid usage or target module not found
EOF
}

add_error() {
    ERRORS+=("$1")
}

add_warning() {
    WARNINGS+=("$1")
}

has_jq() {
    command -v jq >/dev/null 2>&1
}

contains_word() {
    local list="$1"
    local item="$2"
    [[ " $list " == *" $item "* ]]
}

append_unique_word() {
    local current="$1"
    local item="$2"
    if contains_word "$current" "$item"; then
        printf '%s' "$current"
    elif [[ -z "$current" ]]; then
        printf '%s' "$item"
    else
        printf '%s %s' "$current" "$item"
    fi
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --modules-dir)
                MODULES_DIR="${2:-}"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --order-only)
                ORDER_ONLY=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            --*)
                echo "Error: Unknown option: $1" >&2
                usage >&2
                exit 2
                ;;
            *)
                if [[ -z "$TARGET_MODULE" ]]; then
                    TARGET_MODULE="$1"
                else
                    echo "Error: Unexpected argument: $1" >&2
                    usage >&2
                    exit 2
                fi
                shift
                ;;
        esac
    done

    if [[ -z "$TARGET_MODULE" ]]; then
        echo "Error: module-id is required." >&2
        usage >&2
        exit 2
    fi
}

index_manifests() {
    local manifest=""
    local module_id=""
    local version=""

    if [[ ! -d "$MODULES_DIR" ]]; then
        add_error "modules directory not found: $MODULES_DIR"
        return
    fi

    while IFS= read -r manifest; do
        module_id="$(jq -r '.id // empty' "$manifest" 2>/dev/null || true)"
        version="$(jq -r '.version // empty' "$manifest" 2>/dev/null || true)"

        if [[ -z "$module_id" ]]; then
            continue
        fi

        if [[ -n "${MANIFEST_PATHS[$module_id]:-}" ]]; then
            add_error "duplicate module id detected: $module_id"
            continue
        fi

        MANIFEST_PATHS["$module_id"]="$manifest"
        MODULE_VERSIONS["$module_id"]="$version"
    done < <(find "$MODULES_DIR" -maxdepth 2 -type f -name module.json | sort)
}

dependency_exists() {
    local dep_id="$1"
    [[ -n "${MANIFEST_PATHS[$dep_id]:-}" ]]
}

check_min_version() {
    local dep_id="$1"
    local min_version="$2"
    local dep_version="${MODULE_VERSIONS[$dep_id]:-}"

    if [[ -z "$min_version" || "$min_version" == "null" ]]; then
        return 0
    fi

    if [[ -z "$dep_version" || "$dep_version" == "null" ]]; then
        return 1
    fi

    "$VERSION_CHECK_SCRIPT" compatible "$dep_version" "$min_version" >/dev/null 2>&1
}

collect_graph() {
    local module_id="$1"
    local manifest_path="${MANIFEST_PATHS[$module_id]:-}"
    local dep_entries=""
    local dep_line=""
    local dep_id=""
    local dep_optional="false"
    local dep_min_version=""

    if [[ -n "${COLLECTED[$module_id]:-}" ]]; then
        return 0
    fi

    if [[ -z "$manifest_path" ]]; then
        add_error "module not found: $module_id"
        return 0
    fi

    GRAPH_INCLUDED["$module_id"]=1
    COLLECTED["$module_id"]=1

    dep_entries="$(jq -c '.requires.modules // [] | .[]' "$manifest_path" 2>/dev/null || true)"

    while IFS= read -r dep_line; do
        [[ -z "$dep_line" ]] && continue

        dep_id="$(jq -r '.id // empty' <<<"$dep_line" 2>/dev/null || true)"
        dep_optional="$(jq -r '.optional // false' <<<"$dep_line" 2>/dev/null || true)"
        dep_min_version="$(jq -r '.minVersion // empty' <<<"$dep_line" 2>/dev/null || true)"

        if [[ -z "$dep_id" ]]; then
            add_error "module '$module_id' has a dependency entry without id"
            continue
        fi

        if ! dependency_exists "$dep_id"; then
            if [[ "$dep_optional" == "true" ]]; then
                add_warning "optional dependency missing: $module_id -> $dep_id"
                continue
            fi
            add_error "required dependency missing: $module_id -> $dep_id"
            continue
        fi

        if [[ -n "$dep_min_version" ]]; then
            if ! check_min_version "$dep_id" "$dep_min_version"; then
                if [[ "$dep_optional" == "true" ]]; then
                    add_warning "optional dependency version mismatch: $module_id -> $dep_id (need >= $dep_min_version, found ${MODULE_VERSIONS[$dep_id]:-unknown})"
                    continue
                fi
                add_error "dependency version mismatch: $module_id -> $dep_id (need >= $dep_min_version, found ${MODULE_VERSIONS[$dep_id]:-unknown})"
                continue
            fi
        fi

        MODULE_DEPENDENCIES["$module_id"]="$(append_unique_word "${MODULE_DEPENDENCIES[$module_id]:-}" "$dep_id")"
        if [[ "$dep_optional" == "true" ]]; then
            MODULE_OPTIONAL_EDGES["$module_id"]="$(append_unique_word "${MODULE_OPTIONAL_EDGES[$module_id]:-}" "$dep_id")"
        fi

        GRAPH_INCLUDED["$dep_id"]=1
        collect_graph "$dep_id"
    done <<<"$dep_entries"
}

build_cycle_message() {
    local start="$1"
    local idx=0
    local found=0
    local cycle_nodes=()
    local msg=""
    local i=0

    for idx in "${!DFS_STACK[@]}"; do
        if [[ "${DFS_STACK[$idx]}" == "$start" ]]; then
            found=1
            break
        fi
    done

    if [[ "$found" -eq 1 ]]; then
        cycle_nodes=("${DFS_STACK[@]:$idx}")
        cycle_nodes+=("$start")
        msg="${cycle_nodes[0]}"
        for ((i = 1; i < ${#cycle_nodes[@]}; i++)); do
            msg+=" -> ${cycle_nodes[$i]}"
        done
        CYCLE_MESSAGE="$msg"
    else
        CYCLE_MESSAGE="$start -> ... -> $start"
    fi
}

dfs_visit() {
    local module_id="$1"
    local dep=""
    local deps=""

    DFS_STATE["$module_id"]=1
    DFS_STACK+=("$module_id")

    deps="${MODULE_DEPENDENCIES[$module_id]:-}"
    if [[ -n "$deps" ]]; then
        while IFS= read -r dep; do
            [[ -z "$dep" ]] && continue

            case "${DFS_STATE[$dep]:-0}" in
                0)
                    if ! dfs_visit "$dep"; then
                        return 1
                    fi
                    ;;
                1)
                    build_cycle_message "$dep"
                    return 1
                    ;;
            esac
        done < <(tr ' ' '\n' <<<"$deps" | sort -u)
    fi

    unset 'DFS_STACK[${#DFS_STACK[@]}-1]'
    DFS_STATE["$module_id"]=2
    ORDERED_MODULES+=("$module_id")
    return 0
}

topological_sort() {
    ORDERED_MODULES=()
    DFS_STACK=()
    CYCLE_MESSAGE=""

    if ! dfs_visit "$TARGET_MODULE"; then
        add_error "circular dependency detected: $CYCLE_MESSAGE"
        return 1
    fi

    return 0
}

print_human_plan() {
    local idx=1
    local module_id=""

    echo "Dependency resolution plan for module: $TARGET_MODULE"
    echo "Modules directory: $MODULES_DIR"
    echo ""
    echo "Resolved order (dependencies first):"
    for module_id in "${ORDERED_MODULES[@]}"; do
        printf "  %d. %s\n" "$idx" "$module_id"
        idx=$((idx + 1))
    done

    if [[ ${#WARNINGS[@]} -gt 0 ]]; then
        echo ""
        echo "Warnings:"
        for module_id in "${WARNINGS[@]}"; do
            echo "  - $module_id"
        done
    fi
}

print_errors() {
    local err=""
    for err in "${ERRORS[@]}"; do
        echo "Error: $err" >&2
    done
}

main() {
    parse_args "$@"

    if ! has_jq; then
        echo "Error: jq is required for dependency resolution." >&2
        exit 2
    fi

    if [[ ! -x "$VERSION_CHECK_SCRIPT" ]]; then
        echo "Error: version check script not executable: $VERSION_CHECK_SCRIPT" >&2
        exit 2
    fi

    index_manifests
    collect_graph "$TARGET_MODULE"

    if [[ ${#ERRORS[@]} -eq 0 ]]; then
        topological_sort || true
    fi

    if [[ ${#ERRORS[@]} -gt 0 ]]; then
        print_errors
        exit 1
    fi

    if [[ "$ORDER_ONLY" == "true" ]]; then
        printf '%s\n' "${ORDERED_MODULES[@]}"
        exit 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        print_human_plan
        exit 0
    fi

    # Default output (non-dry-run, non-order-only): human-readable plan.
    print_human_plan
    exit 0
}

main "$@"
