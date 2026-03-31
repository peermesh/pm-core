#!/usr/bin/env python3
"""Static conformance gate for Social stub-surface runtime metadata (WO-PMDL-223)."""
import argparse
import json
import re
import sys
from pathlib import Path

RE_JSON_200 = re.compile(r"\bjson\s*\(\s*res\s*,\s*200\b")
RE_JSON_WITH_TYPE_200 = re.compile(r"\bjsonWithType\s*\(\s*res\s*,\s*200\b")
RE_STUB_SURFACE_200 = re.compile(r"\bjsonStubSurface\s*\(\s*res\s*,\s*200\b")
RE_STUB_TYPE_200 = re.compile(r"\bjsonWithTypeStubSurface\s*\(\s*res\s*,\s*200\b")
RE_BODY_STUB_TRUE = re.compile(r"_stub\s*:\s*true\b")


def contract_path(core_root: Path) -> Path:
    return (
        core_root
        / "scripts"
        / "validation"
        / "contracts"
        / "social-stub-surface-metadata.contract.json"
    )


def validate_helpers(core_root: Path, spec: dict) -> list[str]:
    errs: list[str] = []
    hp = core_root / spec["helpers_module"]
    if not hp.is_file():
        errs.append(f"missing helpers module: {spec['helpers_module']}")
        return errs
    text = hp.read_text(encoding="utf-8")
    hname = spec["header_name"]
    hval = spec["header_value"]
    if hname not in text:
        errs.append(f"helpers missing header name literal {hname!r}")
    if f"'{hval}'" not in text and f'"{hval}"' not in text:
        errs.append(f"helpers missing header value literal {hval!r}")
    if "function jsonStubSurface" not in text and "jsonStubSurface(" not in text:
        errs.append("helpers missing jsonStubSurface")
    if "function jsonWithTypeStubSurface" not in text and "jsonWithTypeStubSurface(" not in text:
        errs.append("helpers missing jsonWithTypeStubSurface")
    return errs


def validate_route_file(core_root: Path, entry: dict) -> list[str]:
    errs: list[str] = []
    rel = entry["path"]
    path = core_root / rel
    if not path.is_file():
        return [f"missing route module: {rel}"]
    text = path.read_text(encoding="utf-8")
    if RE_JSON_200.search(text):
        errs.append(f"{rel}: forbidden json(res, 200, ...) — use jsonStubSurface")
    if RE_JSON_WITH_TYPE_200.search(text):
        errs.append(
            f"{rel}: forbidden jsonWithType(res, 200, ...) — use jsonWithTypeStubSurface"
        )
    n_stub_200 = len(RE_STUB_SURFACE_200.findall(text)) + len(RE_STUB_TYPE_200.findall(text))
    if n_stub_200 < 1:
        errs.append(f"{rel}: expected at least one jsonStubSurface/jsonWithTypeStubSurface 200 response")
    min_true = entry.get("min_body_stub_true")
    if min_true is not None:
        n_true = len(RE_BODY_STUB_TRUE.findall(text))
        if n_true < min_true:
            errs.append(
                f"{rel}: expected at least {min_true} _stub: true (found {n_true})"
            )
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--core-root",
        type=Path,
        default=None,
        help="peermesh core root (default: parent of scripts/validation)",
    )
    ap.add_argument(
        "--json-out",
        type=Path,
        default=None,
        help="write validation result JSON to this path",
    )
    args = ap.parse_args()
    core_root = (args.core_root or Path(__file__).resolve().parent.parent.parent).resolve()

    cp = contract_path(core_root)
    if not cp.is_file():
        print(f"[social-stub-surface-metadata] missing contract: {cp}", file=sys.stderr)
        return 1

    spec = json.loads(cp.read_text(encoding="utf-8"))
    all_errs: list[str] = []
    all_errs.extend(validate_helpers(core_root, spec))
    for entry in spec.get("route_modules", []):
        all_errs.extend(validate_route_file(core_root, entry))

    payload = {
        "ok": len(all_errs) == 0,
        "errors": all_errs,
        "contract": str(cp.relative_to(core_root)),
    }
    if args.json_out is not None:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    if all_errs:
        print("[social-stub-surface-metadata] failed:", file=sys.stderr)
        for e in all_errs:
            print(f"  {e}", file=sys.stderr)
        return 1

    print("[social-stub-surface-metadata] ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
