#!/bin/bash
# ==============================================================
# Check Stale Image Digests
# ==============================================================
# Purpose: Find all pinned image digests in compose files and report
#          their current status. Helps identify digests that may need
#          updating due to upstream security patches.
#
# Usage:
#   ./scripts/check-stale-digests.sh              # Report only
#   ./scripts/check-stale-digests.sh --check      # Check for newer digests (requires docker/skopeo)
#   ./scripts/check-stale-digests.sh --json        # Output as JSON
#
# Exit codes:
#   0 - Report generated successfully
#   1 - Error during scan
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Options
CHECK_REMOTE=false
OUTPUT_JSON=false

for arg in "$@"; do
    case "$arg" in
        --check)  CHECK_REMOTE=true ;;
        --json)   OUTPUT_JSON=true ;;
        --help|-h)
            echo "Usage: $(basename "$0") [--check] [--json]"
            echo ""
            echo "  --check   Check remote registry for newer digests (requires docker or skopeo)"
            echo "  --json    Output results as JSON"
            echo ""
            exit 0
            ;;
    esac
done

# ==============================================================
# Scan Functions
# ==============================================================

# Find all compose files in the project (excluding reference repos and knowledge corpus)
find_compose_files() {
    find "$PROJECT_ROOT" \
        -name "docker-compose*.yml" \
        -not -path "*/reference-repos/*" \
        -not -path "*/.dev/reference-repos/*" \
        -not -path "*/knowledge-corpus/*" \
        -not -path "*/.dev/ai/*" \
        -not -path "*/node_modules/*" \
        -type f \
        | sort
}

# Extract image lines with @sha256: from a compose file
# Skips commented lines
extract_pinned_images() {
    local file="$1"
    grep -n 'image:.*@sha256:' "$file" 2>/dev/null \
        | grep -v '^\s*#' \
        | grep -v '^[0-9]*:\s*#' \
        || true
}

# Parse image reference into components
# Input: "nginx:1.27-alpine@sha256:abc123..."
# Output: image_name tag digest
parse_image_ref() {
    local ref="$1"
    # Remove any surrounding quotes and whitespace
    ref=$(echo "$ref" | sed 's/^[[:space:]]*image:[[:space:]]*//' | tr -d '"' | tr -d "'" | xargs)

    local image_name=""
    local tag=""
    local digest=""

    if [[ "$ref" == *"@sha256:"* ]]; then
        digest="${ref##*@sha256:}"
        local before_digest="${ref%%@sha256:*}"

        if [[ "$before_digest" == *":"* ]]; then
            image_name="${before_digest%%:*}"
            tag="${before_digest##*:}"
        else
            image_name="$before_digest"
            tag="latest"
        fi
    fi

    echo "${image_name}|${tag}|sha256:${digest}"
}

# ==============================================================
# Report Functions
# ==============================================================

generate_report() {
    local total_files=0
    local total_pinned=0
    local unique_images=()

    echo "=============================================================="
    echo "  Image Digest Staleness Report"
    echo "  Generated: $(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
    echo "  Project: $(basename "$PROJECT_ROOT")"
    echo "=============================================================="
    echo ""

    while IFS= read -r compose_file; do
        local relative_path="${compose_file#"$PROJECT_ROOT"/}"
        local matches
        matches=$(extract_pinned_images "$compose_file")

        if [[ -z "$matches" ]]; then
            continue
        fi

        ((total_files++))
        echo "File: ${relative_path}"
        echo "--------------------------------------------------------------"

        while IFS= read -r match; do
            ((total_pinned++))
            local line_num="${match%%:*}"
            local image_line="${match#*:}"
            # Clean up the image line (strip leading whitespace)
            image_line="${image_line#"${image_line%%[![:space:]]*}"}"

            local parsed
            parsed=$(parse_image_ref "$image_line")
            local img_name="${parsed%%|*}"
            local rest="${parsed#*|}"
            local img_tag="${rest%%|*}"
            local img_digest="${rest##*|}"

            printf "  Line %3s: %-45s :%s\n" "$line_num" "$img_name" "$img_tag"
            printf "            Digest: %.20s...\n" "$img_digest"

            # Track unique images
            local found=false
            for existing in "${unique_images[@]+"${unique_images[@]}"}"; do
                if [[ "$existing" == "${img_name}:${img_tag}@${img_digest}" ]]; then
                    found=true
                    break
                fi
            done
            if [[ "$found" == false ]]; then
                unique_images+=("${img_name}:${img_tag}@${img_digest}")
            fi

        done <<< "$matches"

        echo ""

    done < <(find_compose_files)

    echo "=============================================================="
    echo "  Summary"
    echo "=============================================================="
    echo "  Compose files scanned:    $(find_compose_files | wc -l | tr -d ' ')"
    echo "  Files with pinned images: ${total_files}"
    echo "  Total pinned references:  ${total_pinned}"
    echo "  Unique image+digest pairs: ${#unique_images[@]}"
    echo ""

    if [[ ${#unique_images[@]} -gt 0 ]]; then
        echo "  Unique Pinned Images:"
        for img in "${unique_images[@]}"; do
            local name_tag="${img%%@*}"
            echo "    - ${name_tag}"
        done
    fi

    echo ""
    echo "=============================================================="
    echo "  Recommendations"
    echo "=============================================================="
    echo ""
    echo "  To keep digests current, consider one of these approaches:"
    echo ""
    echo "  1. Renovate Bot (RECOMMENDED for GitHub repos)"
    echo "     - Automatically detects digest pins in compose files"
    echo "     - Creates PRs when newer digests are available"
    echo "     - Add renovate.json to the repo root"
    echo ""
    echo "  2. Manual check with this script + --check flag"
    echo "     - Requires docker or skopeo to be available"
    echo "     - Run: ./scripts/check-stale-digests.sh --check"
    echo ""
    echo "  3. GitHub Actions scheduled workflow"
    echo "     - Run this script weekly in CI"
    echo "     - Create issues for stale digests"
    echo ""
    echo "=============================================================="

    if [[ "$CHECK_REMOTE" == true ]]; then
        echo ""
        echo "=============================================================="
        echo "  Remote Digest Check"
        echo "=============================================================="
        echo ""

        if command -v skopeo &> /dev/null; then
            echo "  Using skopeo for remote checks..."
            echo ""
            for img in "${unique_images[@]}"; do
                local name_tag="${img%%@*}"
                local current_digest="${img##*@}"
                echo "  Checking: ${name_tag}"

                local remote_digest
                remote_digest=$(skopeo inspect --format '{{.Digest}}' "docker://${name_tag}" 2>/dev/null || echo "ERROR")

                if [[ "$remote_digest" == "ERROR" ]]; then
                    echo "    Status: UNABLE TO CHECK (registry error)"
                elif [[ "$remote_digest" == "$current_digest" ]]; then
                    echo "    Status: CURRENT (digest matches)"
                else
                    echo "    Status: STALE (newer digest available)"
                    echo "    Current: ${current_digest}"
                    echo "    Latest:  ${remote_digest}"
                fi
                echo ""
            done
        elif command -v docker &> /dev/null; then
            echo "  Using docker for remote checks (slower, pulls manifests)..."
            echo "  Note: Install 'skopeo' for faster checks without pulling."
            echo ""
            for img in "${unique_images[@]}"; do
                local name_tag="${img%%@*}"
                local current_digest="${img##*@}"
                echo "  Checking: ${name_tag}"

                local remote_digest
                remote_digest=$(docker manifest inspect "${name_tag}" 2>/dev/null | grep -o '"digest": "sha256:[a-f0-9]*"' | head -1 | cut -d'"' -f4 || echo "ERROR")

                if [[ "$remote_digest" == "ERROR" || -z "$remote_digest" ]]; then
                    echo "    Status: UNABLE TO CHECK (manifest inspect failed)"
                elif [[ "$remote_digest" == "$current_digest" ]]; then
                    echo "    Status: CURRENT (digest matches)"
                else
                    echo "    Status: STALE (newer digest available)"
                    echo "    Current: ${current_digest}"
                    echo "    Latest:  ${remote_digest}"
                fi
                echo ""
            done
        else
            echo "  Neither skopeo nor docker available."
            echo "  Install one of them to enable remote digest checking."
        fi
    fi
}

generate_json() {
    local first_entry=true

    echo "{"
    echo "  \"generated\": \"$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)\","
    echo "  \"project\": \"$(basename "$PROJECT_ROOT")\","
    echo "  \"images\": ["

    while IFS= read -r compose_file; do
        local relative_path="${compose_file#"$PROJECT_ROOT"/}"
        local matches
        matches=$(extract_pinned_images "$compose_file")

        if [[ -z "$matches" ]]; then
            continue
        fi

        while IFS= read -r match; do
            local line_num="${match%%:*}"
            local image_line="${match#*:}"
            image_line="${image_line#"${image_line%%[![:space:]]*}"}"

            local parsed
            parsed=$(parse_image_ref "$image_line")
            local img_name="${parsed%%|*}"
            local rest="${parsed#*|}"
            local img_tag="${rest%%|*}"
            local img_digest="${rest##*|}"

            if [[ "$first_entry" == true ]]; then
                first_entry=false
            else
                echo "    ,"
            fi

            printf '    {"file": "%s", "line": %s, "image": "%s", "tag": "%s", "digest": "%s"}' \
                "$relative_path" "$line_num" "$img_name" "$img_tag" "$img_digest"

        done <<< "$matches"

    done < <(find_compose_files)

    echo ""
    echo "  ]"
    echo "}"
}

# ==============================================================
# Main
# ==============================================================

main() {
    if [[ "$OUTPUT_JSON" == true ]]; then
        generate_json
    else
        generate_report
    fi
}

main
