#!/usr/bin/env sh
# ==============================================================
# Hello Custom Module - HTML Renderer (Template)
# ==============================================================
# Purpose: Replace the HELLO_CUSTOM_NOTE placeholder inside the
# template so the configured note appears in the served page.
# This script is intentionally POSIX-compatible so it can run inside
# both the host hooks and the nginx container at startup.
# ==============================================================

set -e

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

awk -v note="$NOTE" '{
  gsub(/\{\{HELLO_CUSTOM_NOTE\}\}/, note)
  print
}' "$TEMPLATE" > "$OUTPUT"
