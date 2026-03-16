#!/bin/bash
# ==============================================================
# Hello Custom Module - HTML Renderer
# ==============================================================
# Purpose: Populate index.html from a template so HELLO_CUSTOM_NOTE
# settings are reflected before the container starts.
# ============================================================== 

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RENDERER="${MODULE_DIR}/html/render-html.sh"

if [[ -x "$RENDERER" ]]; then
    "$RENDERER"
else
    echo "Renderer not found or not executable: ${RENDERER}"
    exit 1
fi
