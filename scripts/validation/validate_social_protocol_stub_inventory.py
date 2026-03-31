#!/usr/bin/env python3
# deterministic inventory of stub markers under social routes + protocol adapters (WO-PMDL-211).
import argparse
import json
import re
import sys
from pathlib import Path

RE_STATUS_STUB = re.compile(r"""status\s*:\s*['"]stub['"]""")
RE_UNDERSCORE_STUB_PROP = re.compile(r"\b_stub[A-Za-z0-9_]*\s*:")
RE_PHASE1_META_KEY = re.compile(r"""['\"]phase-1['\"]\s*:""")
# same-line signal: phase 1 / phase-1 co-occurring with "stub" (comments or string literals)
RE_PHASE1_STUB_SIGNAL = re.compile(
    r"(?i)(phase[-\s]?1|['\"]phase-1['\"]).{0,160}stub|stub.{0,160}(phase[-\s]?1|['\"]phase-1['\"])"
)

ROOTS_REL = (
    "modules/social/app/routes",
    "modules/social/app/lib/adapters",
)


def scan_file(path: Path, core_root: Path) -> list[dict]:
    rel = path.relative_to(core_root).as_posix()
    lines = path.read_text(encoding="utf-8").splitlines()
    findings: list[dict] = []
    for i, line in enumerate(lines, start=1):
        excerpt = line.strip()
        if len(excerpt) > 200:
            excerpt = excerpt[:197] + "..."
        kinds: list[str] = []
        if RE_STATUS_STUB.search(line):
            kinds.append("status_stub_literal")
        if RE_UNDERSCORE_STUB_PROP.search(line):
            kinds.append("underscore_stub_property")
        if RE_PHASE1_META_KEY.search(line):
            kinds.append("phase1_metadata_key")
        if RE_PHASE1_STUB_SIGNAL.search(line):
            kinds.append("phase1_stub_signal")
        for kind in kinds:
            findings.append(
                {"path": rel, "line": i, "kind": kind, "excerpt": excerpt}
            )
    return findings


def scan_tree(core_root: Path) -> list[dict]:
    out: list[dict] = []
    for root_rel in ROOTS_REL:
        root = core_root / root_rel
        if not root.is_dir():
            continue
        for path in sorted(root.glob("*.js")):
            out.extend(scan_file(path, core_root))
    out.sort(key=lambda x: (x["path"], x["line"], x["kind"]))
    return out


def contract_path(core_root: Path) -> Path:
    return (
        core_root
        / "scripts"
        / "validation"
        / "contracts"
        / "social-protocol-stub-inventory.contract.json"
    )


def normalize_entries(entries: list[dict]) -> list[dict]:
    return sorted(entries, key=lambda x: (x["path"], x["line"], x["kind"]))


def main() -> int:
    ap = argparse.ArgumentParser(
        description="scan social routes/adapters for stub markers; gate vs committed contract"
    )
    ap.add_argument(
        "--update-contract",
        action="store_true",
        help="rewrite the committed contract from the current tree (explicit drift resolution)",
    )
    ap.add_argument(
        "--json-out",
        type=Path,
        default=None,
        help="write full scan payload (schema_version, roots, entries) to this path",
    )
    ap.add_argument(
        "--core-root",
        type=Path,
        default=None,
        help="peermesh core repo root (default: parent of scripts/validation)",
    )
    args = ap.parse_args()
    core_root = (args.core_root or Path(__file__).resolve().parent.parent.parent).resolve()

    entries = scan_tree(core_root)
    payload = {
        "schema_version": 1,
        "scan_roots": list(ROOTS_REL),
        "entries": entries,
    }

    if args.json_out is not None:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(
            json.dumps(payload, indent=2) + "\n", encoding="utf-8"
        )

    cp = contract_path(core_root)
    if args.update_contract:
        cp.parent.mkdir(parents=True, exist_ok=True)
        cp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        rel = cp.relative_to(core_root)
        print(f"[social-protocol-stub-inventory] wrote contract {rel}")
        return 0

    if not cp.is_file():
        print(f"[social-protocol-stub-inventory] missing contract: {cp}", file=sys.stderr)
        return 1

    expected = json.loads(cp.read_text(encoding="utf-8"))
    exp_entries = normalize_entries(expected.get("entries", []))
    got_entries = normalize_entries(entries)

    if exp_entries != got_entries:
        print("[social-protocol-stub-inventory] drift: scan != contract", file=sys.stderr)
        exp_set = {json.dumps(e, sort_keys=True) for e in exp_entries}
        got_set = {json.dumps(e, sort_keys=True) for e in got_entries}
        for g in sorted(got_set - exp_set):
            print(f"  + {g}", file=sys.stderr)
        for e in sorted(exp_set - got_set):
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"[social-protocol-stub-inventory] ok: {len(got_entries)} marker row(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
