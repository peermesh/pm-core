#!/usr/bin/env bash
# canonical documented entry point; forwards to launch_core.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/launch_core.sh" "$@"
