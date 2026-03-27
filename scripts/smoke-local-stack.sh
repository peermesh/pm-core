#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Running local stack smoke checks..."

docker compose ps

./launch_core.sh health -v

echo "Verifying Traefik ping endpoint..."
docker compose exec -T traefik wget --no-verbose --tries=1 --spider "http://localhost:8080/ping"

echo "Verifying Dashboard health endpoint..."
docker compose exec -T dashboard wget --no-verbose --tries=1 --spider "http://localhost:8080/health"

echo "Verifying PostgreSQL readiness..."
docker compose exec -T postgres pg_isready -U postgres -d postgres

echo "Verifying Redis authentication from secret..."
docker compose exec -T redis sh -lc 'redis-cli -a "$(cat /run/secrets/redis_password)" ping' | rg "^PONG$"

echo "Smoke checks passed."
