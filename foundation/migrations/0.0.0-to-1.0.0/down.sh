#!/usr/bin/env bash
#
# Rollback: 1.0.0 -> 0.0.0
#
# Reverses the bootstrap migration.
# This removes the version marker and returns to a pre-migration state.
#
# WARNING: This rollback essentially "uninstalls" the foundation versioning.
# It should only be used for testing or complete removal scenarios.
#

set -euo pipefail

# Determine paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(dirname "$SCRIPT_DIR")"
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$MIGRATIONS_DIR")}"

# Colors
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() {
    printf "%b→%b %s\n" "$BLUE" "$NC" "$1"
}

log_success() {
    printf "%b✓%b %s\n" "$GREEN" "$NC" "$1"
}

log_warn() {
    printf "%bWarning:%b %s\n" "$YELLOW" "$NC" "$1"
}

echo "=============================================="
echo "Foundation Rollback: 1.0.0 -> 0.0.0"
echo "=============================================="
echo ""
log_warn "This will remove the version marker from the foundation."
echo ""
echo "Foundation directory: $FOUNDATION_DIR"
echo ""

# =============================================================================
# 1. Remove Version Marker
# =============================================================================

log_step "Removing version marker..."

VERSION_FILE="$FOUNDATION_DIR/VERSION"
if [[ -f "$VERSION_FILE" ]]; then
    # Create backup before removal
    cp "$VERSION_FILE" "${VERSION_FILE}.backup.$(date +%s)" 2>/dev/null || true
    rm -f "$VERSION_FILE"
    log_success "Removed VERSION file"
else
    log_success "VERSION file already absent"
fi

# =============================================================================
# 2. Rollback Notes
# =============================================================================

echo ""
echo "=============================================="
log_success "Rollback complete!"
echo "=============================================="
echo ""
echo "The foundation is now at version 0.0.0 (uninitialized state)."
echo ""
echo "Note: Core foundation files (schemas, interfaces, docs) are NOT removed."
echo "      Only the version marker has been cleared."
echo ""
echo "To re-initialize, run: ./lib/migration.sh run"
echo ""

exit 0
