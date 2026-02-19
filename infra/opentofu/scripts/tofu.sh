#!/usr/bin/env bash
set -euo pipefail

if command -v tofu >/dev/null 2>&1; then
    exec tofu "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "[ERROR] Neither tofu nor docker is available. Install OpenTofu or Docker." >&2
    exit 1
fi

IMAGE="${OPENTOFU_IMAGE:-ghcr.io/opentofu/opentofu:1.9.0}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec docker run --rm \
    -v "${PROJECT_ROOT}:${PROJECT_ROOT}" \
    -w "${PWD}" \
    "$IMAGE" "$@"
