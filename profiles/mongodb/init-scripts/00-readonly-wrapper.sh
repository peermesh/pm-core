#!/usr/bin/env bash
set -euo pipefail

# read_only mode: writable runtime paths are provided by tmpfs.
mkdir -p /var/run/mongodb /tmp
chown mongodb:mongodb /var/run/mongodb /tmp || true
chmod 1777 /tmp || true

exec /usr/local/bin/docker-entrypoint.sh "$@"
