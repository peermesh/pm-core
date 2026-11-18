#!/usr/bin/env bash
# Fixture hook: records that it ran. Starts nothing.
set -euo pipefail
: "${GATE_MARKER_DIR:?GATE_MARKER_DIR must be set by the test}"
mkdir -p "$GATE_MARKER_DIR"
echo "install ran" > "$GATE_MARKER_DIR/gate-dep-parent.install"
