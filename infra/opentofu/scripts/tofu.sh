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

PASS_ENV_NAMES=(
    HCLOUD_TOKEN
    CLOUDFLARE_API_TOKEN
    DIGITALOCEAN_TOKEN
    AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY
    AWS_SESSION_TOKEN
    AWS_REGION
    AWS_DEFAULT_REGION
)

DOCKER_ENV_ARGS=()
for env_name in "${PASS_ENV_NAMES[@]}"; do
    if [[ -n "${!env_name:-}" ]]; then
        DOCKER_ENV_ARGS+=(-e "$env_name")
    fi
done

exec docker run --rm \
    "${DOCKER_ENV_ARGS[@]}" \
    -v "${PROJECT_ROOT}:${PROJECT_ROOT}" \
    -w "${PWD}" \
    "$IMAGE" "$@"
