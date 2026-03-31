#!/usr/bin/env bash
# ARCH-009 wave 9: static D1/SQLite migration compatibility baseline for module SQL.
# Scans registered module migration directories for PostgreSQL / D1-hostile patterns.
# Default: structural problems -> FAIL (exit 1); dialect findings -> WARN (exit 0).
# Set ARCH009_SQLITE_COMPAT_STRICT=1 to treat every dialect finding as FAIL.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"
workspace_root="$(cd "$core_root/../.." && pwd)"

strict_mode="${ARCH009_SQLITE_COMPAT_STRICT:-0}"
if [[ "${CI:-}" == "true" ]]; then
  ci_mode="true"
else
  ci_mode="false"
fi

if [[ -n "${ARCH009_SQLITE_REPORT_DIR:-}" ]]; then
  reports_dir="$ARCH009_SQLITE_REPORT_DIR"
elif [[ -d "$workspace_root/.dev/ai" ]]; then
  reports_dir="$workspace_root/.dev/ai/reports"
else
  reports_dir="${RUNNER_TEMP:-/tmp}/arch009-sqlite-migration-compat-reports"
fi

ts="$(date -u +%Y-%m-%d-%H-%M-%SZ)"
mkdir -p "$reports_dir"
transcript="$reports_dir/${ts}-arch009-sqlite-migration-compat-transcript.txt"
report_md="$reports_dir/${ts}-arch009-sqlite-migration-compat-report.md"
report_json="$reports_dir/${ts}-arch009-sqlite-migration-compat.json"

exec > >(tee "$transcript") 2>&1

cd "$core_root"

echo "[sqlite-migration-compat] core_root=$core_root"
echo "[sqlite-migration-compat] strict_mode=$strict_mode ci_mode=$ci_mode"
echo "[sqlite-migration-compat] reports: transcript=$transcript"

# shellcheck disable=SC2034
pass_files=0
warn_files=0
fail_files=0
total_warn_findings=0
total_fail_findings=0

findings_tsv="$(mktemp)"
trap 'rm -f "$findings_tsv"' EXIT

log_finding() {
  local module_id="$1" rel_path="$2" severity="$3" code="$4" line_no="$5" detail="$6"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$module_id" "$rel_path" "$severity" "$code" "$line_no" "$detail" >>"$findings_tsv"
}

# id|relative_dir — extend by appending lines
module_registry=(
  "social|modules/social/migrations"
  "um|modules/universal-manifest/migrations"
)

scan_file() {
  local module_id="$1" rel_path="$2"
  local f="$core_root/$rel_path"
  local base_sev="WARN"
  if [[ "$strict_mode" == "1" ]]; then
    base_sev="FAIL"
  fi

  # pattern|code (extended regex; case-sensitive where it matters)
  local -a rules=(
    $'[[:space:]]JSONB[[:space:]]|SQLITE_PG_JSONB'
    $'\\bSERIAL\\b|SQLITE_PG_SERIAL'
    $'\\bBIGSERIAL\\b|SQLITE_PG_BIGSERIAL'
    $'CREATE[[:space:]]+SCHEMA|SQLITE_PG_CREATE_SCHEMA'
    $'COMMENT[[:space:]]+ON|SQLITE_PG_COMMENT_ON'
    $'TIMESTAMPTZ|SQLITE_PG_TIMESTAMPTZ'
    $'\\bBYTEA\\b|SQLITE_PG_BYTEA'
    $'\\bNOW[[:space:]]*\\(\\)|SQLITE_PG_NOW_PAREN'
    $'CREATE[[:space:]]+EXTENSION|SQLITE_PG_CREATE_EXTENSION'
    $'\\bDO[[:space:]]+\\$\\$|SQLITE_PG_DO_BLOCK'
    $'\\bGRANT[[:space:]]|SQLITE_PG_GRANT'
    $'\\bREVOKE[[:space:]]|SQLITE_PG_REVOKE'
    $'CREATE[[:space:]]+ROLE\\b|SQLITE_PG_CREATE_ROLE'
    $'ALTER[[:space:]]+DEFAULT[[:space:]]+PRIVILEGES|SQLITE_PG_ALTER_DEFAULT_PRIV'
    $'\\bILIKE\\b|SQLITE_PG_ILIKE'
    $'::[a-zA-Z_][a-zA-Z0-9_]*|SQLITE_PG_CAST_OPERATOR'
    $'ALTER[[:space:]]+TABLE[^;]{0,400}ADD[[:space:]]+COLUMN|SQLITE_D1_ALTER_ADD_COLUMN'
    $'\\bINHERITS[[:space:]]*\\(|SQLITE_PG_INHERITS'
  )

  local had_issue=0
  local entry pattern code line_out
  for entry in "${rules[@]}"; do
    pattern="${entry%%|*}"
    code="${entry#*|}"
    # shellcheck disable=SC2086
    line_out="$(grep -nE "$pattern" "$f" 2>/dev/null || true)"
    if [[ -n "$line_out" ]]; then
      had_issue=1
      while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local ln="${line%%:*}"
        local rest="${line#*:}"
        log_finding "$module_id" "$rel_path" "$base_sev" "$code" "$ln" "$rest"
        if [[ "$base_sev" == "FAIL" ]]; then
          total_fail_findings=$((total_fail_findings + 1))
        else
          total_warn_findings=$((total_warn_findings + 1))
        fi
      done <<<"$line_out"
    fi
  done

  if [[ $had_issue -eq 0 ]]; then
    echo "[sqlite-migration-compat] PASS file=$rel_path (no baseline dialect flags)"
    log_finding "$module_id" "$rel_path" "PASS" "SQLITE_BASELINE_CLEAN" "-" "no matching patterns"
    pass_files=$((pass_files + 1))
  else
    if [[ "$base_sev" == "FAIL" ]]; then
      echo "[sqlite-migration-compat] FAIL file=$rel_path (strict dialect flags)"
      fail_files=$((fail_files + 1))
    else
      echo "[sqlite-migration-compat] WARN file=$rel_path (see findings)"
      warn_files=$((warn_files + 1))
    fi
  fi
}

for row in "${module_registry[@]}"; do
  mod="${row%%|*}"
  dir="${row#*|}"
  abs="$core_root/$dir"
  if [[ ! -d "$abs" ]]; then
    echo "[sqlite-migration-compat] FAIL: migration directory missing: $dir" >&2
    log_finding "$mod" "$dir" "FAIL" "SQLITE_MISSING_MIGRATION_DIR" "-" "directory not found"
    total_fail_findings=$((total_fail_findings + 1))
    continue
  fi
  mapfile -t sql_files < <(find "$abs" -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort)
  if [[ ${#sql_files[@]} -eq 0 ]]; then
    echo "[sqlite-migration-compat] FAIL: no .sql migrations under $dir" >&2
    log_finding "$mod" "$dir" "FAIL" "SQLITE_EMPTY_MIGRATION_DIR" "-" "no sql files"
    total_fail_findings=$((total_fail_findings + 1))
    continue
  fi
  echo "[sqlite-migration-compat] module=$mod files=${#sql_files[@]}"
  for fpath in "${sql_files[@]}"; do
    rel="${fpath#"$core_root"/}"
    scan_file "$mod" "$rel"
  done
done

echo ""
echo "[sqlite-migration-compat] SUMMARY pass_files=$pass_files warn_files=$warn_files fail_files=$fail_files"
echo "[sqlite-migration-compat] SUMMARY findings warn=$total_warn_findings fail=$total_fail_findings strict=$strict_mode"

python3 - "$findings_tsv" "$report_json" "$report_md" "$pass_files" "$warn_files" "$fail_files" "$total_warn_findings" "$total_fail_findings" "$strict_mode" "$ci_mode" "$core_root" "$ts" <<'PY'
import json
import sys
from pathlib import Path

tsv_path, json_path, md_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
pass_files = int(sys.argv[4])
warn_files = int(sys.argv[5])
fail_files = int(sys.argv[6])
total_warn = int(sys.argv[7])
total_fail = int(sys.argv[8])
strict = sys.argv[9]
ci_mode = sys.argv[10]
core_root = sys.argv[11]
report_ts = sys.argv[12]

findings = []
if tsv_path.exists() and tsv_path.stat().st_size > 0:
    text = tsv_path.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        parts = line.split("\t", 5)
        if len(parts) < 6:
            continue
        mod, rel, sev, code, ln, detail = parts
        findings.append(
            {
                "module": mod,
                "file": rel,
                "severity": sev,
                "code": code,
                "line": ln,
                "detail": detail[:500],
            }
        )

exit_fail = total_fail > 0 or (strict == "1" and total_warn > 0)
status = "FAIL" if exit_fail else "PASS"

payload = {
    "validator": "arch009-sqlite-migration-compat",
    "core_root": core_root,
    "ci_mode": ci_mode,
    "strict_mode": strict == "1",
    "summary": {
        "status": status,
        "pass_files": pass_files,
        "warn_files": warn_files,
        "fail_files": fail_files,
        "finding_count_warn": total_warn,
        "finding_count_fail": total_fail,
    },
    "findings": findings,
}

json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

lines = [
    "# arch009 sqlite migration compatibility baseline report",
    "",
    f"**timestamp (utc)**: {report_ts}",
    "",
    f"**strict_mode**: {strict}",
    f"**ci_mode**: {ci_mode}",
    "",
    "## summary",
    "",
    f"- overall: **{status}** (exit 1 if FAIL findings or strict+warn)",
    f"- pass_files: {pass_files}",
    f"- warn_files: {warn_files}",
    f"- fail_files: {fail_files}",
    f"- dialect findings (warn tier): {total_warn}",
    f"- structural / strict failures: {total_fail}",
    "",
    "## traceability",
    "",
    "- ARCH009-QM-3 / ARCH009-QM-5 / ARCH009-TEST-5: executable static baseline for engine deltas",
    "",
    "## machine json",
    "",
    f"written: `{json_path.name}`",
    "",
    "## findings (tsv)",
    "",
    "```text",
]
for f in findings[:200]:
    lines.append(
        "\t".join(
            [
                f["severity"],
                f["module"],
                f["file"],
                f["code"],
                f["line"],
                f["detail"].replace("\t", " ")[:200],
            ]
        )
    )
if len(findings) > 200:
    lines.append(f"... truncated {len(findings) - 200} additional rows (see json)")
lines.append("```")
lines.append("")

md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"[sqlite-migration-compat] wrote {json_path}")
print(f"[sqlite-migration-compat] wrote {md_path}")
PY

echo "[sqlite-migration-compat] transcript: $transcript"

if [[ "$total_fail_findings" -gt 0 ]]; then
  echo "[sqlite-migration-compat] EXIT=1 (structural or strict failures)" >&2
  exit 1
fi
if [[ "$strict_mode" == "1" && "$total_warn_findings" -gt 0 ]]; then
  echo "[sqlite-migration-compat] EXIT=1 (strict mode: warnings treated as failures)" >&2
  exit 1
fi

echo "[sqlite-migration-compat] EXIT=0"
exit 0
