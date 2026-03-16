#!/bin/bash
# ==============================================================
# Hello Custom Module - HTML Renderer
# ==============================================================
# Purpose: Populate index.html from a template and the HELLO_CUSTOM_NOTE
# environment variable so the note is refreshed before the container starts.
# ==============================================================

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_PATH="${MODULE_DIR}/html/index.tpl.html"
OUTPUT_PATH="${MODULE_DIR}/html/index.html"
ENV_FILE="${MODULE_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

export HELLO_CUSTOM_NOTE="${HELLO_CUSTOM_NOTE:-Custom variant engaged}"
export MODULE_DIR

python3 - <<'PY'
import os
from pathlib import Path

module_dir = Path(os.environ["MODULE_DIR"])
template = Path(module_dir / "html" / "index.tpl.html")
output = Path(module_dir / "html" / "index.html")

if not template.exists():
    raise SystemExit(f"Template not found: {template}")

content = template.read_text()
content = content.replace("{{HELLO_CUSTOM_NOTE}}", os.environ["HELLO_CUSTOM_NOTE"])
output.write_text(content)
PY
