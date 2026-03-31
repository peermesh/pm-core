#!/usr/bin/env python3
"""Deterministic audit of foundation event bus noop contract and static provider inventory.

Default: print a JSON report and exit 0 (visibility only).
Strict: exit 1 when a required eventbus connection has no in-tree non-noop provider module.

Env:
  EVENT_BUS_NOOP_VISIBILITY_STRICT=1|true|yes|required — same as --strict
  EVENT_BUS_NOOP_VISIBILITY_STRICT=all — fail if any module declares an eventbus requirement
           but no in-tree module provides a real (non-noop) eventbus provider
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REAL_EVENTBUS_PROVIDERS = frozenset({"redis", "nats", "kafka", "memory"})


def _core_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _strict_mode_from_env() -> str | None:
    raw = os.environ.get("EVENT_BUS_NOOP_VISIBILITY_STRICT", "").strip().lower()
    if raw in ("", "0", "false", "no", "off"):
        return None
    if raw in ("1", "true", "yes", "required"):
        return "required"
    if raw == "all":
        return "all"
    return None


def _load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _noop_script_signals(core: Path) -> dict[str, object]:
    p = core / "foundation/lib/eventbus-noop.sh"
    if not p.is_file():
        return {"path": str(p.relative_to(core)), "present": False}
    text = p.read_text(encoding="utf-8", errors="replace")
    return {
        "path": str(p.relative_to(core)),
        "present": True,
        "defines_implementation_marker": "eventbus_implementation()" in text
        and 'echo "noop"' in text,
    }


def _schema_noop_enum(core: Path) -> dict[str, object]:
    path = core / "foundation/schemas/connection.schema.json"
    if not path.is_file():
        return {"path": str(path.relative_to(core)), "noop_listed": False, "error": "missing"}
    try:
        data = _load_json(path)
        defs = data.get("$defs") or {}
        eb = defs.get("eventbusProvider") or {}
        enum = eb.get("enum") or []
        return {
            "path": str(path.relative_to(core)),
            "noop_listed": "noop" in enum,
        }
    except (OSError, json.JSONDecodeError) as exc:
        return {"path": str(path.relative_to(core)), "noop_listed": False, "error": str(exc)}


def _connection_resolve_registers_noop(core: Path) -> dict[str, object]:
    path = core / "foundation/lib/connection-resolve.sh"
    if not path.is_file():
        return {"path": str(path.relative_to(core)), "registers_foundation_noop": False}
    text = path.read_text(encoding="utf-8", errors="replace")
    return {
        "path": str(path.relative_to(core)),
        "registers_foundation_noop": 'providers+=("noop:foundation")' in text,
    }


def _iter_module_manifests(modules_dir: Path) -> list[Path]:
    if not modules_dir.is_dir():
        return []
    out: list[Path] = []
    for child in sorted(modules_dir.iterdir()):
        if child.is_dir():
            mj = child / "module.json"
            if mj.is_file():
                out.append(mj)
    return out


def _parse_eventbus_requirements(manifest: Path, core: Path) -> list[dict[str, object]]:
    try:
        data = _load_json(manifest)
    except (OSError, json.JSONDecodeError):
        return []
    reqs = data.get("requires") or {}
    conns = reqs.get("connections") or []
    if not isinstance(conns, list):
        return []
    out: list[dict[str, object]] = []
    for item in conns:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "eventbus":
            continue
        providers = item.get("providers") or []
        if not isinstance(providers, list):
            providers = []
        plist = [str(p) for p in providers if isinstance(p, str) and p.strip()]
        required = item.get("required", True)
        if not isinstance(required, bool):
            required = True
        out.append(
            {
                "module_id": manifest.parent.name,
                "manifest": str(manifest.relative_to(core)),
                "alias": item.get("alias"),
                "providers_preferred": plist,
                "required": required,
            }
        )
    return out


def _parse_eventbus_providers(manifest: Path) -> list[dict[str, object]]:
    try:
        data = _load_json(manifest)
    except (OSError, json.JSONDecodeError):
        return []
    prov = data.get("provides") or {}
    conns = prov.get("connections") or []
    if not isinstance(conns, list):
        return []
    out: list[dict[str, object]] = []
    for item in conns:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "eventbus":
            continue
        provider = item.get("provider")
        if not isinstance(provider, str) or not provider.strip():
            continue
        out.append(
            {
                "module_id": manifest.parent.name,
                "provider": provider.strip(),
            }
        )
    return out


def build_report(core: Path) -> dict[str, object]:
    modules_dir = core / "modules"
    manifests = _iter_module_manifests(modules_dir)
    requirements: list[dict[str, object]] = []
    for m in manifests:
        requirements.extend(_parse_eventbus_requirements(m, core))

    real_providers: list[dict[str, object]] = []
    for m in manifests:
        real_providers.extend(_parse_eventbus_providers(m))

    non_noop_installed = [
        p for p in real_providers if p.get("provider") in REAL_EVENTBUS_PROVIDERS
    ]

    def _satisfies(req: dict[str, object]) -> bool:
        pref = req.get("providers_preferred") or []
        if not isinstance(pref, list):
            return False
        for mod in non_noop_installed:
            prov = mod.get("provider")
            if prov in pref:
                return True
        return False

    required_unsatisfied = [
        r for r in requirements if r.get("required") is True and not _satisfies(r)
    ]

    noop_only_snapshot = len(non_noop_installed) == 0

    return {
        "core_root": str(core),
        "foundation_noop_script": _noop_script_signals(core),
        "connection_schema_eventbus": _schema_noop_enum(core),
        "connection_resolve": _connection_resolve_registers_noop(core),
        "modules_declaring_eventbus_requirement": requirements,
        "modules_providing_non_noop_eventbus": non_noop_installed,
        "noop_only_provider_snapshot": noop_only_snapshot,
        "required_eventbus_without_in_tree_provider": required_unsatisfied,
    }


def _strict_should_fail(report: dict[str, object], mode: str) -> tuple[bool, str]:
    if mode == "required":
        bad = report.get("required_eventbus_without_in_tree_provider") or []
        if bad:
            return True, "strict(required): required eventbus connection(s) lack matching in-tree provider module"
        return False, ""
    if mode == "all":
        reqs = report.get("modules_declaring_eventbus_requirement") or []
        non_noop = report.get("modules_providing_non_noop_eventbus") or []
        if reqs and len(non_noop) == 0:
            return (
                True,
                "strict(all): eventbus requirements exist but no in-tree non-noop eventbus provider module",
            )
        return False, ""
    return False, ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="fail closed if required eventbus cannot be satisfied by in-tree provider modules",
    )
    parser.add_argument(
        "--strict-all",
        action="store_true",
        help="fail if any eventbus requirement exists but no non-noop eventbus provider module is in-tree",
    )
    args = parser.parse_args()

    core = _core_root()
    report = build_report(core)

    strict_mode: str | None = None
    if args.strict_all:
        strict_mode = "all"
    elif args.strict:
        strict_mode = "required"
    elif (env_mode := _strict_mode_from_env()) is not None:
        strict_mode = env_mode

    report["strict_mode_active"] = strict_mode
    fail, reason = _strict_should_fail(report, strict_mode) if strict_mode else (False, "")
    report["strict_failed"] = fail
    report["strict_failure_reason"] = reason

    text = json.dumps(report, indent=2, sort_keys=True)
    print(text)

    if fail:
        print(reason, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
