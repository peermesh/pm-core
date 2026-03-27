#!/usr/bin/env bash
# ==============================================================
# Upstream Update Check for Core Deployment Repos
# ==============================================================
# Checks if the local deployment repo is behind the upstream
# Core core repository. Reports available updates, new
# release tags, and critical/security releases.
#
# Designed to run from any deployment repo that follows the
# fork + upstream remote pattern (see docs/DEPLOYMENT-REPO-PATTERN.md).
#
# Usage:
#   ./scripts/check-upstream-updates.sh            # Normal check
#   ./scripts/check-upstream-updates.sh --quiet     # Machine-readable output
#   ./scripts/check-upstream-updates.sh --json      # JSON output
#
# Exit codes:
#   0 - Up to date (or check skipped gracefully)
#   1 - Updates available
#   2 - Critical updates available
#   3 - Not a git repo or upstream not configured (info only)
# ==============================================================
set -euo pipefail

# --------------------------------------------------------------
# Configuration
# --------------------------------------------------------------
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
QUIET=false
JSON=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# Parse options
shift || true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quiet|-q) QUIET=true; shift ;;
        --json)     JSON=true; shift ;;
        --remote)   UPSTREAM_REMOTE="$2"; shift 2 ;;
        --branch)   UPSTREAM_BRANCH="$2"; shift 2 ;;
        --help|-h)
            printf "Usage: %s [PROJECT_DIR] [--quiet] [--json] [--remote NAME] [--branch NAME]\n" "$0"
            exit 0
            ;;
        *) shift ;;
    esac
done

# --------------------------------------------------------------
# Helpers
# --------------------------------------------------------------
info()  { [[ "$QUIET" == true ]] && return 0; printf "%s\n" "$*"; }
warn()  { printf "WARNING: %s\n" "$*" >&2; }

# --------------------------------------------------------------
# Pre-flight: verify git repo exists
# --------------------------------------------------------------
if [[ ! -d "$PROJECT_DIR/.git" ]]; then
    if [[ "$JSON" == true ]]; then
        printf '{"status":"SKIPPED","reason":"not a git repository","path":"%s"}\n' "$PROJECT_DIR"
    else
        info "=== Core Core Update Check ==="
        info "Path:     $PROJECT_DIR"
        info "Status:   SKIPPED"
        info "Reason:   Not a git repository (files may have been SCP'd)"
        info ""
        info "To enable upstream checks, initialize git and add upstream remote:"
        info "  cd $PROJECT_DIR"
        info "  git init && git add -A && git commit -m 'initial'"
        info "  git remote add upstream https://github.com/peermesh/core.git"
    fi
    exit 3
fi

cd "$PROJECT_DIR"

# --------------------------------------------------------------
# Pre-flight: verify upstream remote exists
# --------------------------------------------------------------
if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
    if [[ "$JSON" == true ]]; then
        printf '{"status":"SKIPPED","reason":"no upstream remote","remote":"%s"}\n' "$UPSTREAM_REMOTE"
    else
        info "=== Core Core Update Check ==="
        info "Path:     $PROJECT_DIR"
        info "Status:   SKIPPED"
        info "Reason:   No '$UPSTREAM_REMOTE' remote configured"
        info ""
        info "To add the upstream remote:"
        info "  git remote add $UPSTREAM_REMOTE https://github.com/peermesh/core.git"
        info "  git fetch $UPSTREAM_REMOTE"
    fi
    exit 3
fi

# --------------------------------------------------------------
# Fetch upstream (handle offline gracefully)
# --------------------------------------------------------------
FETCH_FAILED=false
if ! git fetch "$UPSTREAM_REMOTE" --tags --quiet 2>/dev/null; then
    FETCH_FAILED=true
    warn "Could not fetch from $UPSTREAM_REMOTE (network may be unavailable)"
    warn "Reporting based on last known state"
fi

# --------------------------------------------------------------
# Gather local state
# --------------------------------------------------------------
LOCAL_HEAD=$(git rev-parse --short HEAD 2>/dev/null || printf "unknown")
LOCAL_HEAD_FULL=$(git rev-parse HEAD 2>/dev/null || printf "unknown")

# Find the most recent upstream tag that is an ancestor of HEAD
LOCAL_LAST_TAG=""
LOCAL_LAST_TAG=$(git describe --tags --abbrev=0 --match 'v*' HEAD 2>/dev/null) || true

# --------------------------------------------------------------
# Gather upstream state
# --------------------------------------------------------------
UPSTREAM_REF="${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
if ! git rev-parse "$UPSTREAM_REF" >/dev/null 2>&1; then
    if [[ "$JSON" == true ]]; then
        printf '{"status":"SKIPPED","reason":"upstream branch not found","ref":"%s"}\n' "$UPSTREAM_REF"
    else
        info "=== Core Core Update Check ==="
        info "Path:     $PROJECT_DIR"
        info "Status:   SKIPPED"
        info "Reason:   Upstream branch '$UPSTREAM_REF' not found"
        info ""
        info "Try: git fetch $UPSTREAM_REMOTE"
    fi
    exit 3
fi

UPSTREAM_HEAD=$(git rev-parse --short "$UPSTREAM_REF" 2>/dev/null || printf "unknown")
UPSTREAM_HEAD_FULL=$(git rev-parse "$UPSTREAM_REF" 2>/dev/null || printf "unknown")

# Latest tag on upstream
UPSTREAM_LATEST_TAG=""
UPSTREAM_LATEST_TAG=$(git describe --tags --abbrev=0 --match 'v*' "$UPSTREAM_REF" 2>/dev/null) || true

# --------------------------------------------------------------
# Calculate how far behind
# --------------------------------------------------------------
COMMITS_BEHIND=0
if [[ "$LOCAL_HEAD_FULL" != "unknown" && "$UPSTREAM_HEAD_FULL" != "unknown" ]]; then
    COMMITS_BEHIND=$(git rev-list --count "${LOCAL_HEAD_FULL}..${UPSTREAM_HEAD_FULL}" 2>/dev/null) || COMMITS_BEHIND=0
fi

# --------------------------------------------------------------
# Find new tags since last merge/local state
# --------------------------------------------------------------
NEW_TAGS=()
NEW_TAG_DETAILS=()
HAS_CRITICAL=false

# Get all tags reachable from upstream but not from local HEAD
if [[ "$LOCAL_HEAD_FULL" != "unknown" && "$UPSTREAM_HEAD_FULL" != "unknown" ]]; then
    while IFS= read -r tag_ref; do
        [[ -z "$tag_ref" ]] && continue
        tag_name=$(git describe --tags --exact-match "$tag_ref" 2>/dev/null) || continue
        # Only include v* tags (release tags)
        [[ "$tag_name" != v* ]] && continue

        # Get tag date
        tag_date=$(git log -1 --format='%ci' "$tag_ref" 2>/dev/null | cut -d' ' -f1) || tag_date="unknown"

        # Check tag annotation for critical/security keywords
        tag_message=$(git tag -l --format='%(contents)' "$tag_name" 2>/dev/null) || tag_message=""
        tag_is_critical=false
        if printf '%s' "$tag_message" | grep -qi -E '(security|critical|cve-|vulnerability)'; then
            tag_is_critical=true
            HAS_CRITICAL=true
        fi

        NEW_TAGS+=("$tag_name")
        if [[ "$tag_is_critical" == true ]]; then
            NEW_TAG_DETAILS+=("$tag_name ($tag_date) [CRITICAL]")
        else
            NEW_TAG_DETAILS+=("$tag_name ($tag_date)")
        fi
    done < <(git rev-list "${LOCAL_HEAD_FULL}..${UPSTREAM_HEAD_FULL}" 2>/dev/null | git rev-list --no-walk --tags --stdin 2>/dev/null || true)
fi

# Fallback: if no tags found via rev-list, compare tag lists
if [[ ${#NEW_TAGS[@]} -eq 0 && -n "$LOCAL_LAST_TAG" && -n "$UPSTREAM_LATEST_TAG" ]]; then
    if [[ "$LOCAL_LAST_TAG" != "$UPSTREAM_LATEST_TAG" ]]; then
        tag_date=$(git log -1 --format='%ci' "$UPSTREAM_LATEST_TAG" 2>/dev/null | cut -d' ' -f1) || tag_date="unknown"
        tag_message=$(git tag -l --format='%(contents)' "$UPSTREAM_LATEST_TAG" 2>/dev/null) || tag_message=""
        if printf '%s' "$tag_message" | grep -qi -E '(security|critical|cve-|vulnerability)'; then
            HAS_CRITICAL=true
            NEW_TAG_DETAILS+=("$UPSTREAM_LATEST_TAG ($tag_date) [CRITICAL]")
        else
            NEW_TAG_DETAILS+=("$UPSTREAM_LATEST_TAG ($tag_date)")
        fi
        NEW_TAGS+=("$UPSTREAM_LATEST_TAG")
    fi
fi

# --------------------------------------------------------------
# Determine status
# --------------------------------------------------------------
if [[ "$COMMITS_BEHIND" -eq 0 ]]; then
    STATUS="UP TO DATE"
    EXIT_CODE=0
elif [[ "$HAS_CRITICAL" == true ]]; then
    STATUS="CRITICAL UPDATE"
    EXIT_CODE=2
else
    STATUS="UPDATES AVAILABLE"
    EXIT_CODE=1
fi

# --------------------------------------------------------------
# Output
# --------------------------------------------------------------
if [[ "$JSON" == true ]]; then
    # JSON output for programmatic consumption
    tags_json="[]"
    if [[ ${#NEW_TAG_DETAILS[@]} -gt 0 ]]; then
        tags_json="["
        for i in "${!NEW_TAG_DETAILS[@]}"; do
            [[ $i -gt 0 ]] && tags_json+=","
            tags_json+="\"${NEW_TAG_DETAILS[$i]}\""
        done
        tags_json+="]"
    fi

    printf '{"status":"%s","local_head":"%s","upstream_head":"%s",' "$STATUS" "$LOCAL_HEAD" "$UPSTREAM_HEAD"
    printf '"local_tag":"%s","upstream_tag":"%s",' "${LOCAL_LAST_TAG:-none}" "${UPSTREAM_LATEST_TAG:-none}"
    printf '"commits_behind":%d,"new_tags":%s,' "$COMMITS_BEHIND" "$tags_json"
    printf '"has_critical":%s,"fetch_failed":%s}\n' "$HAS_CRITICAL" "$FETCH_FAILED"
    exit $EXIT_CODE
fi

info "=== Core Core Update Check ==="
info "Local:    $LOCAL_HEAD (merged upstream at ${LOCAL_LAST_TAG:-unknown})"
info "Upstream: $UPSTREAM_HEAD (latest: ${UPSTREAM_LATEST_TAG:-unknown})"
info "Status:   $STATUS"

if [[ "$COMMITS_BEHIND" -gt 0 ]]; then
    info "Behind:   $COMMITS_BEHIND commits"
fi

if [[ "$FETCH_FAILED" == true ]]; then
    info "Network:  OFFLINE (using cached upstream state)"
fi

if [[ ${#NEW_TAG_DETAILS[@]} -gt 0 ]]; then
    info "New tags:"
    for tag_detail in "${NEW_TAG_DETAILS[@]}"; do
        info "  $tag_detail"
    done
fi

if [[ "$COMMITS_BEHIND" -gt 0 ]]; then
    info ""
    info "To update:"
    info "  git fetch $UPSTREAM_REMOTE"
    info "  git merge ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
    info "  # Review changes, then redeploy"
fi

exit $EXIT_CODE
