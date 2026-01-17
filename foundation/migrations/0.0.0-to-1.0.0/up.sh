#!/usr/bin/env bash
#
# Migration: 0.0.0 -> 1.0.0
#
# Bootstrap migration for fresh foundation installations.
# This creates the required directory structure and sets the initial version marker.
#
# This migration runs automatically on first install when no migration state exists.
#

set -euo pipefail

# Determine paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(dirname "$SCRIPT_DIR")"
FOUNDATION_DIR="${FOUNDATION_DIR:-$(dirname "$MIGRATIONS_DIR")}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() {
    printf "%b→%b %s\n" "$BLUE" "$NC" "$1"
}

log_success() {
    printf "%b✓%b %s\n" "$GREEN" "$NC" "$1"
}

echo "=============================================="
echo "Foundation Migration: 0.0.0 -> 1.0.0"
echo "=============================================="
echo ""
echo "This is the bootstrap migration for fresh installations."
echo "Foundation directory: $FOUNDATION_DIR"
echo ""

# =============================================================================
# 1. Create Required Directories
# =============================================================================

log_step "Creating required directories..."

# Ensure migrations directory exists (it should, since we're running from it)
if [[ ! -d "$MIGRATIONS_DIR" ]]; then
    mkdir -p "$MIGRATIONS_DIR"
    log_success "Created migrations directory"
fi

# Create VERSION file if it doesn't exist
VERSION_FILE="$FOUNDATION_DIR/VERSION"
if [[ ! -f "$VERSION_FILE" ]]; then
    echo "1.0.0" > "$VERSION_FILE"
    log_success "Created VERSION file (1.0.0)"
else
    log_success "VERSION file already exists"
fi

# =============================================================================
# 2. Validate Foundation Structure
# =============================================================================

log_step "Validating foundation structure..."

# Check for essential directories and files
REQUIRED_DIRS=(
    "lib"
    "schemas"
    "docs"
    "templates"
    "interfaces"
)

REQUIRED_FILES=(
    "README.md"
    "docker-compose.base.yml"
)

missing_items=()

for dir in "${REQUIRED_DIRS[@]}"; do
    if [[ ! -d "$FOUNDATION_DIR/$dir" ]]; then
        missing_items+=("directory: $dir")
    fi
done

for file in "${REQUIRED_FILES[@]}"; do
    if [[ ! -f "$FOUNDATION_DIR/$file" ]]; then
        missing_items+=("file: $file")
    fi
done

if [[ ${#missing_items[@]} -gt 0 ]]; then
    echo ""
    echo "Warning: The following foundation components are missing:"
    for item in "${missing_items[@]}"; do
        echo "  - $item"
    done
    echo ""
    echo "The foundation may be incomplete. Consider re-installing."
    echo "Continuing with migration..."
    echo ""
fi

# =============================================================================
# 3. Set Initial Version Marker
# =============================================================================

log_step "Setting version marker..."

# The VERSION file was created above, ensure it has correct content
echo "1.0.0" > "$VERSION_FILE"
log_success "Version set to 1.0.0"

# =============================================================================
# 4. Migration Complete
# =============================================================================

echo ""
echo "=============================================="
log_success "Bootstrap migration complete!"
echo "=============================================="
echo ""
echo "Foundation is now at version 1.0.0"
echo ""

exit 0
