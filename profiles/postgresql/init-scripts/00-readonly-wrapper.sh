#!/usr/bin/env bash
set -euo pipefail

# read_only mode: writable paths must be backed by tmpfs/volume mounts.
mkdir -p /var/run/postgresql /tmp
chown postgres:postgres /var/run/postgresql /tmp || true
chmod 1777 /tmp || true

exec /usr/local/bin/docker-entrypoint.sh "$@"
