#!/usr/bin/env bash
# security evolution trend scorecard — deterministic baseline signals (WO-PMDL-2026-03-30-189)
# emits json, tsv, and markdown summary for audit checklist rows, gotchas, and security ci/script coverage.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"

usage() {
    printf 'usage: %s --out-dir DIR\n' "$(basename "$0")" >&2
    printf '  writes baseline.json, baseline.tsv, SUMMARY.md under DIR (created if missing)\n' >&2
}

out_dir=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --out-dir)
            out_dir="${2:-}"
            shift 2
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            printf 'unknown arg: %s\n' "$1" >&2
            usage
            exit 1
            ;;
    esac
done

if [[ -z "$out_dir" ]]; then
    usage
    exit 1
fi

mkdir -p "$out_dir"
export CORE_ROOT="$core_root"
export SCORECARD_OUT_JSON="$out_dir/baseline.json"
export SCORECARD_OUT_TSV="$out_dir/baseline.tsv"
export SCORECARD_OUT_MD="$out_dir/SUMMARY.md"

python3 <<'PY'
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

root = Path(os.environ["CORE_ROOT"]).resolve()
out_json = Path(os.environ["SCORECARD_OUT_JSON"])
out_tsv = Path(os.environ["SCORECARD_OUT_TSV"])
out_md = Path(os.environ["SCORECARD_OUT_MD"])

checklist = root / "docs" / "security" / "AUDIT-READINESS-CHECKLIST.md"
gotchas = root / "docs" / "GOTCHAS.md"
sec_scripts_dir = root / "scripts" / "security"
workflows_dir = root / ".github" / "workflows"

status_re = re.compile(r"\| (\[✓\]|\[~\]|\[ \]|\[N/A\]) \|")
gotcha_heading_re = re.compile(r"^## \d+\)")

def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")

audit_text = read_text(checklist) if checklist.is_file() else ""
audit_lines = [ln for ln in audit_text.splitlines() if status_re.search(ln)]
audit_total = len(audit_lines)

status_breakdown = {"implemented": 0, "partial": 0, "not_implemented": 0, "not_applicable": 0}
for ln in audit_lines:
    if "[✓]" in ln:
        status_breakdown["implemented"] += 1
    elif "[~]" in ln:
        status_breakdown["partial"] += 1
    elif "[N/A]" in ln:
        status_breakdown["not_applicable"] += 1
    elif "[ ]" in ln:
        status_breakdown["not_implemented"] += 1

gotcha_text = read_text(gotchas) if gotchas.is_file() else ""
gotcha_count = sum(1 for ln in gotcha_text.splitlines() if gotcha_heading_re.match(ln))

sec_scripts = sorted(p.name for p in sec_scripts_dir.glob("*.sh") if p.is_file())
sec_script_count = len(sec_scripts)

# workflow files under core repo only (not nested test libs)
wf_security_pattern = re.compile(
    r"scripts/security/|aquasecurity/trivy|security-scan:|name: Security |"
    r"Security Drift|security-drift|validate-dockerfile|check-stale-digests",
    re.I,
)
wf_files = sorted(p for p in workflows_dir.glob("*.yml") if p.is_file())
wf_touching = [p.name for p in wf_files if wf_security_pattern.search(read_text(p))]
wf_touch_count = len(wf_touching)

snippet_lines = 0
for p in wf_files:
    for ln in read_text(p).splitlines():
        if "scripts/security/" in ln or "trivy" in ln.lower():
            snippet_lines += 1

generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

payload = {
    "schema_version": "security_evolution_scorecard_baseline.v1",
    "generated_at_utc": generated,
    "repo_root": str(root),
    "signals": {
        "security_audit_checklist_row_count": audit_total,
        "security_audit_status_breakdown": status_breakdown,
        "gotchas_documented_count": gotcha_count,
        "scripts_security_shell_count": sec_script_count,
        "workflows_with_security_automation_reference_count": wf_touch_count,
        "workflow_lines_security_script_or_trivy_count": snippet_lines,
    },
    "sources": {
        "audit_readiness_checklist": "docs/security/AUDIT-READINESS-CHECKLIST.md",
        "gotchas": "docs/GOTCHAS.md",
        "security_scripts_glob": "scripts/security/*.sh",
        "workflows_glob": ".github/workflows/*.yml",
    },
    "detail": {
        "security_shell_scripts_sorted": sec_scripts,
        "workflows_touching_security_sorted": wf_touching,
    },
}

out_json.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

tsv_rows = [
    "signal\tvalue",
    f"security_audit_checklist_row_count\t{audit_total}",
    f"gotchas_documented_count\t{gotcha_count}",
    f"scripts_security_shell_count\t{sec_script_count}",
    f"workflows_with_security_automation_reference_count\t{wf_touch_count}",
    f"workflow_lines_security_script_or_trivy_count\t{snippet_lines}",
]
out_tsv.write_text("\n".join(tsv_rows) + "\n", encoding="utf-8")

md = f"""# security evolution scorecard baseline

**generated (utc)**: {generated}

## signals

| signal | value |
|--------|-------|
| security audit checklist row count | {audit_total} |
| gotchas documented count | {gotcha_count} |
| scripts/security shell scripts | {sec_script_count} |
| workflows referencing security automation | {wf_touch_count} |
| workflow lines (scripts/security or trivy) | {snippet_lines} |

## audit status breakdown (checklist rows)

| bucket | count |
|--------|-------|
| implemented [✓] | {status_breakdown['implemented']} |
| partial [~] | {status_breakdown['partial']} |
| not implemented [ ] | {status_breakdown['not_implemented']} |
| not applicable [N/A] | {status_breakdown['not_applicable']} |

## sources

- `{payload['sources']['audit_readiness_checklist']}`
- `{payload['sources']['gotchas']}`
- `{payload['sources']['security_scripts_glob']}`
- `{payload['sources']['workflows_glob']}`
"""
out_md.write_text(md, encoding="utf-8")

print(json.dumps({"ok": True, "written": [str(out_json), str(out_tsv), str(out_md)]}))
PY

printf '\n--- machine-readable: %s ---\n' "$out_dir/baseline.json"
cat "$out_dir/baseline.json"
printf '\n--- summary: %s ---\n' "$out_dir/SUMMARY.md"
cat "$out_dir/SUMMARY.md"
