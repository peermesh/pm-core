#!/usr/bin/env bash
# ARCH-009 wave-6 baseline + wave-8 lifecycle: social_lab_reader isolation,
# consumer removal, provider continuity (shared surfaces + drift re-check).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"
workspace_root="$(cd "$core_root/../.." && pwd)"
if [[ -n "${ARCH009_REPORT_DIR:-}" ]]; then
  reports_dir="$ARCH009_REPORT_DIR"
elif [[ -d "$workspace_root/.dev/ai" ]]; then
  reports_dir="$workspace_root/.dev/ai/reports"
else
  reports_dir="${RUNNER_TEMP:-/tmp}/arch009-schema-acl-reports"
fi
ts="$(date -u +%Y-%m-%d-%H-%M-%SZ)"
mkdir -p "$reports_dir"
transcript="$reports_dir/${ts}-arch-009-wave8-schema-acl-lifecycle-transcript.txt"
report_md="$reports_dir/${ts}-arch-009-wave8-schema-acl-lifecycle-report.md"
exec > >(tee "$transcript") 2>&1

migration_sql="$core_root/modules/social/migrations/001_initial_schema.sql"
drift_py="$script_dir/validate-schema-acl-drift.py"

if [[ ! -f "$migration_sql" ]]; then
  echo "[acl-integration] error: missing migration $migration_sql" >&2
  exit 2
fi

if ! command -v docker &>/dev/null; then
  echo "[acl-integration] error: docker not found" >&2
  exit 2
fi

cid="pm-core-arch009-acl-$$"
pass=0
fail=0
trap 'docker rm -f "$cid" &>/dev/null || true' EXIT

echo "[acl-integration] starting postgres:16 container $cid"
docker run -d --name "$cid" -e POSTGRES_PASSWORD=acltest -e POSTGRES_HOST_AUTH_METHOD=scram-sha-256 postgres:16 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$cid" pg_isready -h 127.0.0.1 -U postgres &>/dev/null; then
    break
  fi
  sleep 1
done

if ! docker exec "$cid" pg_isready -h 127.0.0.1 -U postgres &>/dev/null; then
  echo "[acl-integration] error: postgres not ready" >&2
  exit 2
fi

psql_super=(docker exec "$cid" psql -v ON_ERROR_STOP=1 -U postgres -d postgres)

echo "[acl-integration] create database social_lab"
"${psql_super[@]}" -c "CREATE DATABASE social_lab;"

psql_db=(docker exec "$cid" psql -v ON_ERROR_STOP=1 -U postgres -d social_lab)

echo "[acl-integration] apply social 001_initial_schema.sql"
docker cp "$migration_sql" "$cid:/tmp/001_initial_schema.sql"
"${psql_db[@]}" -f /tmp/001_initial_schema.sql

echo "[acl-integration] create consumer login inheriting social_lab_reader"
"${psql_db[@]}" -c "CREATE ROLE pmdl_consumer_acl LOGIN PASSWORD 'pmdl_acl_consumer_pw' INHERIT;"
"${psql_db[@]}" -c "GRANT social_lab_reader TO pmdl_consumer_acl;"

psql_consumer=(docker exec "$cid" psql -v ON_ERROR_STOP=1 -U pmdl_consumer_acl -d social_lab)

expect_ok() {
  local name="$1"
  shift
  if "$@"; then
    echo "[acl-integration] PASS: $name"
    pass=$((pass + 1))
  else
    echo "[acl-integration] FAIL: $name" >&2
    fail=$((fail + 1))
  fi
}

expect_denied() {
  local name="$1"
  shift
  set +e
  out="$("$@" 2>&1)"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "[acl-integration] PASS: $name (denied as expected)"
    pass=$((pass + 1))
  else
    echo "[acl-integration] FAIL: $name (expected permission error, got success) output=$out" >&2
    fail=$((fail + 1))
  fi
}

expect_connect_fail() {
  local name="$1"
  shift
  set +e
  out="$("$@" 2>&1)"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "[acl-integration] PASS: $name (session rejected as expected)"
    pass=$((pass + 1))
  else
    echo "[acl-integration] FAIL: $name (expected failure, got success) output=$out" >&2
    fail=$((fail + 1))
  fi
}

expect_ok "shared read social_profiles.profile_index" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM social_profiles.profile_index LIMIT 1;"

expect_ok "shared read social_graph.social_graph" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM social_graph.social_graph LIMIT 1;"

expect_denied "private read social_federation.ap_actors" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM social_federation.ap_actors LIMIT 1;"

expect_denied "private read social_keys.key_metadata" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM social_keys.key_metadata LIMIT 1;"

expect_denied "private read social_pipeline.schema_migrations" \
  "${psql_consumer[@]}" -c "SELECT 1 FROM social_pipeline.schema_migrations LIMIT 1;"

expect_denied "shared insert social_profiles.profile_index" \
  "${psql_consumer[@]}" -c "INSERT INTO social_profiles.profile_index (id, webid, omni_account_id, source_pod_uri) VALUES ('t','https://ex/w','o','https://pod/');"

expect_denied "shared update social_profiles.profile_index" \
  "${psql_consumer[@]}" -c "UPDATE social_profiles.profile_index SET display_name='x' WHERE false;"

expect_denied "shared delete social_profiles.profile_index" \
  "${psql_consumer[@]}" -c "DELETE FROM social_profiles.profile_index WHERE false;"

_reg="$("${psql_db[@]}" -tAc "SELECT 1 FROM social_pipeline.schema_migrations WHERE version = '001';" | tr -d '[:space:]')"
if [[ "$_reg" == "1" ]]; then
  echo "[acl-integration] PASS: migration registry has version 001"
  pass=$((pass + 1))
else
  echo "[acl-integration] FAIL: migration registry missing version 001 (got '${_reg}')" >&2
  fail=$((fail + 1))
fi

# postgres does not expose information_schema.schema_privileges; use privilege functions
snapshot_sql="
SELECT * FROM (
  SELECT DISTINCT 'SCHEMA:' || nsp.nspname || ':USAGE' AS line
  FROM pg_namespace nsp
  WHERE nsp.nspname IN ('social_profiles', 'social_graph')
    AND has_schema_privilege('social_lab_reader'::name, nsp.nspname, 'USAGE')
  UNION ALL
  SELECT DISTINCT 'TABLE:' || n.nspname || '.' || c.relname || ':SELECT' AS line
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('social_profiles', 'social_graph')
    AND c.relkind = 'r'
    AND NOT c.relispartition
    AND has_table_privilege('social_lab_reader'::name, c.oid, 'SELECT')
) s ORDER BY 1;
"

snap_file="$(mktemp)"
"${psql_db[@]}" -tAc "$snapshot_sql" | sed '/^$/d' | sort -u >"$snap_file"

echo "[acl-integration] ACL drift check (validate-schema-acl-drift.py)"
set +e
python3 "$drift_py" --snapshot-file "$snap_file"
drift_rc=$?
set -e
rm -f "$snap_file"

if [[ $drift_rc -eq 0 ]]; then
  echo "[acl-integration] PASS: acl drift baseline (pre-lifecycle)"
  pass=$((pass + 1))
else
  echo "[acl-integration] FAIL: acl drift baseline (exit $drift_rc)" >&2
  fail=$((fail + 1))
fi

echo "[acl-integration] === wave8 lifecycle: drop consumer, re-validate provider surfaces ==="
"${psql_db[@]}" -c "DROP ROLE IF EXISTS pmdl_consumer_acl;"

expect_connect_fail "consumer login rejected after role drop" \
  docker exec "$cid" psql -v ON_ERROR_STOP=1 -U pmdl_consumer_acl -d social_lab -c "SELECT 1;"

psql_provider=(docker exec "$cid" psql -v ON_ERROR_STOP=1 -U postgres -d social_lab)

expect_ok "provider continuity: shared read social_profiles.profile_index as social_lab_reader" \
  "${psql_provider[@]}" -c "SET ROLE social_lab_reader; SELECT 1 FROM social_profiles.profile_index LIMIT 1;"

expect_ok "provider continuity: shared read social_graph.social_graph as social_lab_reader" \
  "${psql_provider[@]}" -c "SET ROLE social_lab_reader; SELECT 1 FROM social_graph.social_graph LIMIT 1;"

expect_denied "provider continuity: private read still denied (social_federation)" \
  "${psql_provider[@]}" -c "SET ROLE social_lab_reader; SELECT 1 FROM social_federation.ap_actors LIMIT 1;"

expect_denied "provider continuity: private read still denied (social_keys)" \
  "${psql_provider[@]}" -c "SET ROLE social_lab_reader; SELECT 1 FROM social_keys.key_metadata LIMIT 1;"

_reg_post="$("${psql_db[@]}" -tAc "SELECT 1 FROM social_pipeline.schema_migrations WHERE version = '001';" | tr -d '[:space:]')"
if [[ "$_reg_post" == "1" ]]; then
  echo "[acl-integration] PASS: migration registry intact after consumer drop"
  pass=$((pass + 1))
else
  echo "[acl-integration] FAIL: migration registry missing 001 after lifecycle (got '${_reg_post}')" >&2
  fail=$((fail + 1))
fi

snap_file_post="$(mktemp)"
"${psql_db[@]}" -tAc "$snapshot_sql" | sed '/^$/d' | sort -u >"$snap_file_post"
set +e
python3 "$drift_py" --snapshot-file "$snap_file_post"
drift_post_rc=$?
set -e
rm -f "$snap_file_post"
if [[ $drift_post_rc -eq 0 ]]; then
  echo "[acl-integration] PASS: acl drift baseline (post-lifecycle)"
  pass=$((pass + 1))
else
  echo "[acl-integration] FAIL: acl drift post-lifecycle (exit $drift_post_rc)" >&2
  fail=$((fail + 1))
fi

total=$((pass + fail))
exit_code=0
if [[ $fail -ne 0 ]]; then
  exit_code=1
fi
echo "[acl-integration] summary pass=$pass fail=$fail total=$total exit_code=$exit_code"

# markdown report (written outside tee would duplicate; write via absolute path)
{
  printf '%s\n' "# ARCH-009 Wave 8 — Schema ACL, consumer lifecycle, provider resilience (social)"
  printf '%s\n' ""
  printf '%s\n' "Date (UTC): $ts"
  printf '%s\n' "Work order: WO-PMDL-2026-03-30-179 (extends wave-6 baseline)"
  printf '%s\n' ""
  printf '%s\n' "## Summary"
  printf '%s\n' ""
  printf '%s\n' "- pass=$pass"
  printf '%s\n' "- fail=$fail"
  printf '%s\n' "- total=$total"
  printf '%s\n' "- exit_code=$exit_code"
  printf '%s\n' ""
  printf '%s\n' "## Wave 8 lifecycle phases"
  printf '%s\n' ""
  printf '%s\n' "- pre-removal: consumer boundary checks + ACL drift (baseline)"
  printf '%s\n' "- \`DROP ROLE\` consumer login; expect subsequent consumer connection failure"
  printf '%s\n' "- post-removal: \`SET ROLE social_lab_reader\` shared reads + private denial + registry + drift re-check"
  printf '%s\n' ""
  printf '%s\n' "## Artifacts"
  printf '%s\n' ""
  printf '%s\n' "- transcript: \`$transcript\`"
  printf '%s\n' "- postgres image: \`postgres:16\` (ephemeral container)"
  printf '%s\n' "- migration: \`modules/social/migrations/001_initial_schema.sql\`"
  printf '%s\n' ""
} >"$report_md"

if [[ $fail -ne 0 ]]; then
  exit 1
fi
exit 0
