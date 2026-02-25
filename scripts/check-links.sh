#!/usr/bin/env bash
# check-links.sh - Automated link checker for markdown documentation
#
# This script scans all markdown files and validates internal cross-references,
# relative paths, and anchor links. It does NOT check external URLs.
#
# Usage:
#   ./scripts/check-links.sh [--json] [--verbose]
#
# Options:
#   --json      Output results in JSON format
#   --verbose   Show detailed progress information
#
# Exit codes:
#   0 - All links valid or fewer than 10 broken links
#   1 - 10 or more broken links found
#   2 - Script error

set -euo pipefail

# Configuration
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_JSON=false
VERBOSE=false
REPORT_FILE="/tmp/link-check-report-$(date +%s).json"

# Exclusion patterns
EXCLUDE_PATTERNS=(
    ".terraform"
    "node_modules"
    ".dev/ai/handoffs"
    ".dev/ai/proposals"
    "tests/"
    "profiles/nats"
)

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json)
            OUTPUT_JSON=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            grep "^#" "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 2
            ;;
    esac
done

# Logging functions
log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo "$@" >&2
    fi
}

log_error() {
    echo "ERROR: $*" >&2
}

# Initialize report structure
init_report() {
    cat > "$REPORT_FILE" <<EOF
{
  "scan_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "repository_root": "$REPO_ROOT",
  "broken_links": {
    "internal_cross_references": [],
    "relative_paths": [],
    "anchor_links": [],
    "other": []
  },
  "statistics": {
    "total_files_scanned": 0,
    "total_links_checked": 0,
    "broken_links_count": 0
  }
}
EOF
}

# Find all markdown files, excluding specific patterns
find_markdown_files() {
    local exclude_args=()
    for pattern in "${EXCLUDE_PATTERNS[@]}"; do
        exclude_args+=(-not -path "*/$pattern/*")
    done

    find "$REPO_ROOT" -type f -name "*.md" "${exclude_args[@]}" 2>/dev/null
}

# Extract links from a markdown file
extract_links() {
    local file="$1"

    # Extract markdown links: [text](url)
    # Extract markdown reference links: [text][ref]
    # Extract HTML links: <a href="url">
    # Extract bare links in angle brackets: <url>

    {
        # Standard markdown links
        grep -oE '\[([^\]]+)\]\(([^)]+)\)' "$file" | sed -E 's/\[([^\]]+)\]\(([^)]+)\)/\2/' || true

        # HTML href links
        grep -oE 'href="([^"]+)"' "$file" | sed -E 's/href="([^"]+)"/\1/' || true

        # Angle bracket links
        grep -oE '<(https?://[^>]+)>' "$file" | sed -E 's/<([^>]+)>/\1/' || true
    }
}

# Check if a file exists relative to a base path
check_file_exists() {
    local base_dir="$1"
    local link="$2"

    # Remove anchor if present
    local file_path="${link%%#*}"

    # Handle absolute paths from repo root
    if [[ "$file_path" == /* ]]; then
        file_path="$REPO_ROOT$file_path"
    else
        # Relative path from base directory
        file_path="$base_dir/$file_path"
    fi

    # Normalize path
    file_path="$(cd "$(dirname "$file_path")" 2>/dev/null && pwd)/$(basename "$file_path")" 2>/dev/null || echo "$file_path"

    [[ -f "$file_path" ]]
}

# Check if an anchor exists in a file
check_anchor_exists() {
    local file="$1"
    local anchor="$2"

    # Convert anchor to expected heading format
    # GitHub-style: lowercase, spaces to hyphens, remove special chars
    local expected_id
    expected_id="$(echo "$anchor" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]/-/g' | sed -E 's/-+/-/g' | sed -E 's/^-|-$//')"

    # Check for heading with matching ID
    grep -qiE "^#{1,6} .*" "$file" && \
        grep -E "^#{1,6} " "$file" | sed -E 's/^#{1,6} //' | \
        while read -r heading; do
            local heading_id
            heading_id="$(echo "$heading" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]/-/g' | sed -E 's/-+/-/g' | sed -E 's/^-|-$//')"
            if [[ "$heading_id" == "$expected_id" ]]; then
                return 0
            fi
        done

    return 1
}

# Classify and check a link
check_link() {
    local source_file="$1"
    local link="$2"
    local source_dir
    source_dir="$(dirname "$source_file")"

    # Skip external URLs (we don't check these per requirements)
    if [[ "$link" =~ ^https?:// ]] || [[ "$link" =~ ^mailto: ]] || [[ "$link" =~ ^ftp:// ]]; then
        return 0
    fi

    # Skip data URLs and javascript
    if [[ "$link" =~ ^data: ]] || [[ "$link" =~ ^javascript: ]]; then
        return 0
    fi

    # Check for anchor-only links (same file)
    if [[ "$link" =~ ^# ]]; then
        local anchor="${link#\#}"
        if ! check_anchor_exists "$source_file" "$anchor"; then
            echo "anchor:$source_file:$link"
            return 1
        fi
        return 0
    fi

    # Check for file with anchor
    if [[ "$link" =~ \# ]]; then
        local file_part="${link%%#*}"
        local anchor_part="${link#*#}"

        if ! check_file_exists "$source_dir" "$file_part"; then
            echo "file:$source_file:$link"
            return 1
        fi

        # Get absolute path for anchor check
        local target_file
        if [[ "$file_part" == /* ]]; then
            target_file="$REPO_ROOT$file_part"
        else
            target_file="$source_dir/$file_part"
        fi
        target_file="$(cd "$(dirname "$target_file")" 2>/dev/null && pwd)/$(basename "$target_file")" 2>/dev/null || echo "$target_file"

        if ! check_anchor_exists "$target_file" "$anchor_part"; then
            echo "anchor:$source_file:$link (in $target_file)"
            return 1
        fi
        return 0
    fi

    # Check plain file reference
    if ! check_file_exists "$source_dir" "$link"; then
        echo "file:$source_file:$link"
        return 1
    fi

    return 0
}

# Main scanning function
scan_links() {
    local files
    local total_files=0
    local total_links=0
    local broken_links=0

    mapfile -t files < <(find_markdown_files)
    total_files="${#files[@]}"

    log_verbose "Scanning $total_files markdown files..."

    local broken_file_links=()
    local broken_anchor_links=()

    for file in "${files[@]}"; do
        log_verbose "Checking: ${file#$REPO_ROOT/}"

        local links
        mapfile -t links < <(extract_links "$file" | sort -u)

        for link in "${links[@]}"; do
            [[ -z "$link" ]] && continue
            ((total_links++))

            local result
            if ! result=$(check_link "$file" "$link" 2>&1); then
                ((broken_links++))

                if [[ "$result" =~ ^anchor: ]]; then
                    broken_anchor_links+=("$result")
                elif [[ "$result" =~ ^file: ]]; then
                    broken_file_links+=("$result")
                fi
            fi
        done
    done

    # Update report
    {
        echo "{"
        echo "  \"scan_date\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
        echo "  \"repository_root\": \"$REPO_ROOT\","
        echo "  \"broken_links\": {"
        echo "    \"internal_cross_references\": ["
        for link in "${broken_file_links[@]}"; do
            echo "      \"$link\","
        done | sed '$ s/,$//'
        echo "    ],"
        echo "    \"anchor_links\": ["
        for link in "${broken_anchor_links[@]}"; do
            echo "      \"$link\","
        done | sed '$ s/,$//'
        echo "    ]"
        echo "  },"
        echo "  \"statistics\": {"
        echo "    \"total_files_scanned\": $total_files,"
        echo "    \"total_links_checked\": $total_links,"
        echo "    \"broken_links_count\": $broken_links"
        echo "  }"
        echo "}"
    } > "$REPORT_FILE"

    # Output results
    if [[ "$OUTPUT_JSON" == "true" ]]; then
        cat "$REPORT_FILE"
    else
        echo ""
        echo "Link Check Report"
        echo "================="
        echo "Scanned: $total_files files"
        echo "Checked: $total_links links"
        echo "Broken:  $broken_links links"
        echo ""

        if [[ $broken_links -gt 0 ]]; then
            echo "Broken Internal File References:"
            printf '%s\n' "${broken_file_links[@]}" | sed 's/^file:/  - /' || echo "  None"
            echo ""
            echo "Broken Anchor Links:"
            printf '%s\n' "${broken_anchor_links[@]}" | sed 's/^anchor:/  - /' || echo "  None"
            echo ""
            echo "Full report saved to: $REPORT_FILE"
        fi
    fi

    # Exit code based on threshold
    if [[ $broken_links -ge 10 ]]; then
        return 1
    fi

    return 0
}

# Main execution
main() {
    init_report
    scan_links
}

main "$@"
