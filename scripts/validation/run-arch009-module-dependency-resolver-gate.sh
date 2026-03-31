#!/usr/bin/env bash
# arch009 gate: executable proof for foundation module dependency resolver
# (requires.modules[] topological order, fail-closed on cycles).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"
resolver="$core_root/foundation/lib/dependency-resolve.sh"

cd "$core_root"

select_bash4_plus() {
    local candidate=""
    local major=""
    local candidates=()

    if [[ -n "${BASH:-}" ]]; then
        candidates+=("${BASH}")
    fi
    candidates+=("$(command -v bash 2>/dev/null || true)")
    candidates+=("/opt/homebrew/bin/bash")
    candidates+=("/usr/local/bin/bash")

    for candidate in "${candidates[@]}"; do
        if [[ -z "$candidate" || ! -x "$candidate" ]]; then
            continue
        fi
        major="$("$candidate" -c 'printf "%s" "${BASH_VERSINFO[0]:-0}"' 2>/dev/null || true)"
        if [[ "$major" =~ ^[0-9]+$ ]] && [[ "$major" -ge 4 ]]; then
            printf '%s' "$candidate"
            return 0
        fi
    done

    return 1
}

if ! command -v jq >/dev/null 2>&1; then
    echo "[arch009-module-dependency-resolver-gate] error: jq is required" >&2
    exit 2
fi

if [[ ! -f "$resolver" ]]; then
    echo "[arch009-module-dependency-resolver-gate] error: resolver file not found: $resolver" >&2
    exit 2
fi

if ! resolver_bash="$(select_bash4_plus)"; then
    echo "[arch009-module-dependency-resolver-gate] error: bash >=4 is required for resolver associative arrays" >&2
    exit 2
fi

echo "[arch009-module-dependency-resolver-gate] resolver interpreter: $resolver_bash"
echo "[arch009-module-dependency-resolver-gate] bash -n dependency-resolve.sh"
"$resolver_bash" -n "$resolver"

echo "[arch009-module-dependency-resolver-gate] dry-run against repo modules (social)"
if ! "$resolver_bash" "$resolver" social --modules-dir "$core_root/modules" --dry-run >/dev/null; then
    echo "[arch009-module-dependency-resolver-gate] error: dry-run for social failed" >&2
    exit 1
fi

echo "[arch009-module-dependency-resolver-gate] order-only for social (no module-module edges in baseline manifests)"
lines=()
while IFS= read -r line; do
    lines+=("$line")
done < <("$resolver_bash" "$resolver" social --modules-dir "$core_root/modules" --order-only)
if [[ ${#lines[@]} -lt 1 ]]; then
    echo "[arch009-module-dependency-resolver-gate] error: expected non-empty order" >&2
    exit 1
fi
last_index=$(( ${#lines[@]} - 1 ))
if [[ "${lines[$last_index]}" != "social" ]]; then
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
"$resolver_bash" "$resolver" cycle-a --modules-dir "$modroot" --order-only >/dev/null 2>&1
cycle_rc=$?
set -e
if [[ "$cycle_rc" -eq 0 ]]; then
    echo "[arch009-module-dependency-resolver-gate] error: circular graph should exit non-zero" >&2
    exit 1
fi

echo "[arch009-module-dependency-resolver-gate] success"
