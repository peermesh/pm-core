#!/usr/bin/env bash
# bounded compose smoke for lite profile: config, up --wait, health verify, teardown.
# does not use EXIT traps (they reset $? in bash); always calls teardown before exit.
# usage: ./scripts/validation/validate-compose-smoke-lite.sh
# env: COMPOSE_WAIT_TIMEOUT (default 90), COMPOSE_FILE, DOMAIN, ADMIN_EMAIL, TRAEFIK_DASHBOARD_AUTH
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
compose_file="${COMPOSE_FILE:-$repo_root/docker-compose.yml}"
wait_timeout="${COMPOSE_WAIT_TIMEOUT:-90}"

export DOMAIN="${DOMAIN:-ci-smoke.example.test}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-ci-smoke@example.test}"
if [[ -z "${TRAEFIK_DASHBOARD_AUTH:-}" ]]; then
  export TRAEFIK_DASHBOARD_AUTH="admin:$(printf '%s' 'pmdl-ci-smoke' | openssl passwd -apr1 -stdin)"
fi
# sub-repos/core compose references caserver; default avoids empty flag issues
export TRAEFIK_ACME_CASERVER="${TRAEFIK_ACME_CASERVER:-https://acme-v02.api.letsencrypt.org/directory}"

cd "$repo_root"

teardown() {
  docker compose -f "$compose_file" --profile lite down -v --remove-orphans || true
}

failed=0
if ! docker compose -f "$compose_file" --profile lite config --quiet; then
  failed=1
fi

if [[ "$failed" -eq 0 ]]; then
  if ! docker compose -f "$compose_file" --profile lite up -d --wait --wait-timeout "$wait_timeout"; then
    failed=1
  fi
fi

if [[ "$failed" -eq 0 ]]; then
  ts="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' pmdl_traefik 2>/dev/null || echo unknown)"
  if [[ "$ts" != "healthy" ]]; then
    printf '::error::pmdl_traefik health=%s (expected healthy)\n' "$ts"
    failed=1
  fi
fi

if [[ "$failed" -eq 0 ]]; then
  sp="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' pmdl_socket-proxy 2>/dev/null || echo unknown)"
  if [[ "$sp" != "healthy" ]]; then
    printf '::error::pmdl_socket-proxy health=%s (expected healthy)\n' "$sp"
    failed=1
  fi
fi

if [[ "$failed" -ne 0 ]]; then
  docker compose -f "$compose_file" --profile lite ps -a || true
fi

teardown
exit "$failed"
