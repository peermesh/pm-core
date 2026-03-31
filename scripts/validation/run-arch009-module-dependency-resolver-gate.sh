#!/usr/bin/env bash
# arch009 gate: executable proof for foundation module dependency resolver
# (requires.modules[] topological order, fail-closed on cycles).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"
resolver="$core_root/foundation/lib/dependency-resolve.sh"

cd "$core_root"

if ! command -v jq >/dev/null 2>&1; then
    echo "[arch009-module-dependency-resolver-gate] error: jq is required" >&2
    exit 2
fi

if [[ ! -x "$resolver" ]]; then
    echo "[arch009-module-dependency-resolver-gate] error: resolver missing or not executable: $resolver" >&2
    exit 2
fi

echo "[arch009-module-dependency-resolver-gate] bash -n dependency-resolve.sh"
bash -n "$resolver"

echo "[arch009-module-dependency-resolver-gate] dry-run against repo modules (social)"
if ! "$resolver" social --modules-dir "$core_root/modules" --dry-run >/dev/null; then
    echo "[arch009-module-dependency-resolver-gate] error: dry-run for social failed" >&2
    exit 1
fi

echo "[arch009-module-dependency-resolver-gate] order-only for social (no module-module edges in baseline manifests)"
mapfile -t lines < <("$resolver" social --modules-dir "$core_root/modules" --order-only)
if [[ ${#lines[@]} -lt 1 ]]; then
    echo "[arch009-module-dependency-resolver-gate] error: expected non-empty order" >&2
    exit 1
fi
if [[ "${lines[-1]}" != "social" ]]; then
    echo "[arch009-module-dependency-resolver-gate] error: expected target module last in order, got: ${lines[*]}" >&2
    exit 1
fi

echo "[arch009-module-dependency-resolver-gate] synthetic cycle must fail closed"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
modroot="$tmp/fixture-modules"
mkdir -p "$modroot/cycle-a" "$modroot/cycle-b"
cat >"$modroot/cycle-a/module.json" <<'EOF'
{
  "id": "cycle-a",
  "version": "1.0.0",
  "name": "cycle-a",
  "foundation": { "minVersion": "1.0.0" },
  "requires": { "modules": [ { "id": "cycle-b" } ] }
}
EOF
cat >"$modroot/cycle-b/module.json" <<'EOF'
{
  "id": "cycle-b",
  "version": "1.0.0",
  "name": "cycle-b",
  "foundation": { "minVersion": "1.0.0" },
  "requires": { "modules": [ { "id": "cycle-a" } ] }
}
EOF
set +e
"$resolver" cycle-a --modules-dir "$modroot" --order-only >/dev/null 2>&1
cycle_rc=$?
set -e
if [[ "$cycle_rc" -eq 0 ]]; then
    echo "[arch009-module-dependency-resolver-gate] error: circular graph should exit non-zero" >&2
    exit 1
fi

echo "[arch009-module-dependency-resolver-gate] success"
