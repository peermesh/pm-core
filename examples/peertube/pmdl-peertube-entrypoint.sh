#!/usr/bin/env bash
set -euo pipefail

# Load secrets from Docker secrets files into environment variables.
# PeerTube does not currently support *_FILE variants for these keys.
export PEERTUBE_DB_PASSWORD="$(tr -d '\n' < /run/secrets/peertube_db_password)"
export PEERTUBE_SECRET="$(tr -d '\n' < /run/secrets/peertube_secret)"

exec /usr/local/bin/docker-entrypoint.sh "$@"
