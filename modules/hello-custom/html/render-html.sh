#!/usr/bin/env bash
# ==============================================================
# Hello Custom Module - HTML Renderer (Template)
# ==============================================================
# Purpose: Replace the HELLO_CUSTOM_NOTE placeholder so the
# configured note appears in the served page.
# Uses bash because set -o pipefail is not POSIX.
# ==============================================================

set -euo pipefail

MODULE_HTML_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE_DIR="$(cd "${MODULE_HTML_DIR}/.." && pwd)"
ENV_FILE="${MODULE_DIR}/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

NOTE="${HELLO_CUSTOM_NOTE:-Custom variant engaged}"
TEMPLATE="${MODULE_HTML_DIR}/index.tpl.html"
OUTPUT="${MODULE_HTML_DIR}/index.html"

if [ ! -f "$TEMPLATE" ]; then
  echo "Template not found: ${TEMPLATE}"
  exit 1
fi

{
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//\{\{HELLO_CUSTOM_NOTE\}\}/$NOTE}"
    printf '%s\n' "$line"
  done
} < "$TEMPLATE" > "$OUTPUT"
