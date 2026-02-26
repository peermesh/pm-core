#!/usr/bin/env bash
set -euo pipefail

# read_only mode: writable runtime paths are provided by tmpfs.
mkdir -p /var/run/mysqld /tmp
chown mysql:mysql /var/run/mysqld /tmp || true
chmod 1777 /tmp || true

exec /entrypoint.sh "$@"
