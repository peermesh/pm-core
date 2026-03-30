#!/usr/bin/env bash
# ARCH-009 follow-on: universal-manifest shared-surface ACL integration checks
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"
workspace_root="$(cd "$core_root/../.." && pwd)"
if [[ -n "${ARCH009_REPORT_DIR:-}" ]]; then
  reports_dir="$ARCH009_REPORT_DIR"
elif [[ -d "$workspace_root/.dev/ai" ]]; then
  reports_dir="$workspace_root/.dev/ai/reports"
else
  reports_dir="${RUNNER_TEMP:-/tmp}/arch009-um-schema-acl-reports"
fi
ts="$(date -u +%Y-%m-%d-%H-%M-%SZ)"
mkdir -p "$reports_dir"
transcript="$reports_dir/${ts}-arch-009-wave7-um-schema-acl-integration-transcript.txt"
report_md="$reports_dir/${ts}-arch-009-wave7-um-schema-acl-integration-report.md"
exec > >(tee "$transcript") 2>&1

migration_sql="$core_root/modules/universal-manifest/migrations/001_initial.sql"
drift_py="$script_dir/validate-schema-acl-drift.py"

if [[ ! -f "$migration_sql" ]]; then
  echo "[um-acl-integration] error: missing migration $migration_sql" >&2
  exit 2
fi
if ! command -v docker &>/dev/null; then
  echo "[um-acl-integration] error: docker not found" >&2
  exit 2
fi

cid="pm-core-arch009-um-acl-$$"
pass=0
fail=0
trap 'docker rm -f "$cid" &>/dev/null || true' EXIT

echo "[um-acl-integration] starting postgres:16 container $cid"
docker run -d --name "$cid" -e POSTGRES_PASSWORD=acltest -e POSTGRES_HOST_AUTH_METHOD=scram-sha-256 postgres:16 >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$cid" pg_isready -h 127.0.0.1 -U postgres &>/dev/null; then
    break
  fi
  sleep 1
done
docker exec "$cid" pg_isready -h 127.0.0.1 -U postgres >/dev/null

psql_super=(docker exec "$cid" psql -v ON_ERROR_STOP=1 -U postgres -d postgres)
"${psql_super[@]}" -c "CREATE DATABASE universal_manifest;"
psql_db=(docker exec "$cid" psql -v ON_ERROR_STOP=1 -U postgres -d universal_manifest)
docker cp "$migration_sql" "$cid:/tmp/001_initial.sql"
"${psql_db[@]}" -f /tmp/001_initial.sql

"${psql_db[@]}" -c "CREATE ROLE pmdl_consumer_um LOGIN PASSWORD 'pmdl_consumer_um_pw' INHERIT;"
"${psql_db[@]}" -c "GRANT universal_manifest_api_reader TO pmdl_consumer_um;"
psql_consumer=(docker exec "$cid" psql -v ON_ERROR_STOP=1 -U pmdl_consumer_um -d universal_manifest)

expect_ok() {
  local name="$1"; shift
  if "$@"; then
    echo "[um-acl-integration] PASS: $name"
    pass=$((pass + 1))
  else
    echo "[um-acl-integration] FAIL: $name" >&2
    fail=$((fail + 1))
  fi
}

expect_denied() {
  local name="$1"; shift
  set +e
  out="$("$@" 2>&1)"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "[um-acl-integration] PASS: $name (denied as expected)"
    pass=$((pass + 1))
  else
    echo "[um-acl-integration] FAIL: $name (expected permission error) output=$out" >&2
    fail=$((fail + 1))
  fi
}

expect_ok "shared read universal_manifest_api.manifests" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM universal_manifest_api.manifests LIMIT 1;"
expect_ok "shared read universal_manifest_api.facet_registry" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM universal_manifest_api.facet_registry LIMIT 1;"
expect_ok "shared read universal_manifest_api.facet_writes" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM universal_manifest_api.facet_writes LIMIT 1;"

expect_denied "private read um.signing_keys" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM um.signing_keys LIMIT 1;"
expect_denied "private read um.schema_migrations" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM um.schema_migrations LIMIT 1;"

expect_denied "shared insert universal_manifest_api.manifests" \
  "${psql_consumer[@]}" -c "INSERT INTO universal_manifest_api.manifests (umid, subject, issued_at, expires_at) VALUES ('x','y',NOW(),NOW());"
expect_denied "shared update universal_manifest_api.manifests" \
  "${psql_consumer[@]}" -c "UPDATE universal_manifest_api.manifests SET status='x' WHERE false;"
expect_denied "shared delete universal_manifest_api.manifests" \
  "${psql_consumer[@]}" -c "DELETE FROM universal_manifest_api.manifests WHERE false;"

_reg="$("${psql_db[@]}" -tAc "SELECT 1 FROM um.schema_migrations WHERE version = '001';" | tr -d '[:space:]')"
if [[ "$_reg" == "1" ]]; then
  echo "[um-acl-integration] PASS: migration registry has version 001"
  pass=$((pass + 1))
else
  echo "[um-acl-integration] FAIL: migration registry missing version 001 (got '${_reg}')" >&2
  fail=$((fail + 1))
fi

snapshot_sql="
SELECT * FROM (
  SELECT DISTINCT 'SCHEMA:' || nsp.nspname || ':USAGE' AS line
  FROM pg_namespace nsp
  WHERE nsp.nspname = 'universal_manifest_api'
    AND has_schema_privilege('universal_manifest_api_reader'::name, nsp.nspname, 'USAGE')
  UNION ALL
  SELECT DISTINCT 'TABLE:' || n.nspname || '.' || c.relname || ':SELECT' AS line
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'universal_manifest_api'
    AND c.relkind IN ('r', 'v', 'm')
    AND has_table_privilege('universal_manifest_api_reader'::name, c.oid, 'SELECT')
) s ORDER BY 1;
"
snap_file="$(mktemp)"
"${psql_db[@]}" -tAc "$snapshot_sql" | sed '/^$/d' | sort -u >"$snap_file"
set +e
python3 "$drift_py" --profile um --snapshot-file "$snap_file"
drift_rc=$?
set -e
rm -f "$snap_file"
if [[ $drift_rc -eq 0 ]]; then
  echo "[um-acl-integration] PASS: acl drift baseline"
  pass=$((pass + 1))
else
  echo "[um-acl-integration] FAIL: acl drift baseline (exit $drift_rc)" >&2
  fail=$((fail + 1))
fi

total=$((pass + fail))
exit_code=0
if [[ $fail -ne 0 ]]; then
  exit_code=1
fi
echo "[um-acl-integration] summary pass=$pass fail=$fail total=$total exit_code=$exit_code"

{
  printf "# ARCH-009 Wave 7 — UM Schema ACL and consumer isolation\n\n"
  printf "Date (UTC): %s\n" "$ts"
  printf "Work order: WO-PMDL-2026-03-30-174\n\n"
  printf "## Summary\n\n"
  printf -- "- pass=%s\n- fail=%s\n- total=%s\n- exit_code=%s\n\n" "$pass" "$fail" "$total" "$exit_code"
  printf "## Artifacts\n\n"
  printf -- "- transcript: \`%s\`\n" "$transcript"
  printf -- "- postgres image: \`postgres:16\` (ephemeral container)\n"
  printf -- "- migration: \`modules/universal-manifest/migrations/001_initial.sql\`\n"
} > "$report_md"

exit "$exit_code"
