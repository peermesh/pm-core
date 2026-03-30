#!/usr/bin/env python3
"""
Audit module manifests for ARCH-009 composition contract baseline.

This script is intentionally non-blocking for existing modules: it reports
PASS/WARN/FAIL with enough detail to plan remediation waves.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Any


SCHEMA_NAME_RE = re.compile(r"^[a-z0-9]+_[a-z0-9_]+$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")

ALLOWED_ACCESS = {"read_only"}
ALLOWED_STABILITY = {"experimental", "stable", "deprecated"}
ALLOWED_ACCESS_POLICY = {"read_only_shared", "private"}


def load_json(path: pathlib.Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def check_requires(module_id: str, requires: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    connections = requires.get("connections", [])
    if not isinstance(connections, list):
        return [f"{module_id}: FAIL requires.connections is not an array"]

    for idx, conn in enumerate(connections):
        if not isinstance(conn, dict):
            warnings.append(f"{module_id}: FAIL requires.connections[{idx}] is not an object")
            continue

        missing = [field for field in ("provider", "surface", "contractVersion", "access") if field not in conn]
        if missing:
            warnings.append(
                f"{module_id}: WARN requires.connections[{idx}] missing ARCH-009 fields: {', '.join(missing)}"
            )
            continue

        if conn.get("access") not in ALLOWED_ACCESS:
            warnings.append(
                f"{module_id}: WARN requires.connections[{idx}] access='{conn.get('access')}' (expected read_only)"
            )
        if not SEMVER_RE.match(str(conn.get("contractVersion", ""))):
            warnings.append(
                f"{module_id}: WARN requires.connections[{idx}] contractVersion='{conn.get('contractVersion')}' not semver"
            )

    return warnings


def check_provides(module_id: str, provides: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    connections = provides.get("connections", [])
    if not isinstance(connections, list):
        return [f"{module_id}: FAIL provides.connections is not an array"]

    for idx, conn in enumerate(connections):
        if not isinstance(conn, dict):
            warnings.append(f"{module_id}: FAIL provides.connections[{idx}] is not an object")
            continue

        missing = [
            field for field in ("surface", "contractVersion", "schemaName", "stability", "accessPolicy")
            if field not in conn
        ]
        if missing:
            warnings.append(
                f"{module_id}: WARN provides.connections[{idx}] missing ARCH-009 fields: {', '.join(missing)}"
            )
            continue

        schema_name = str(conn.get("schemaName", ""))
        if not SCHEMA_NAME_RE.match(schema_name):
            warnings.append(
                f"{module_id}: WARN provides.connections[{idx}] schemaName='{schema_name}' not {module}_{domain} pattern"
            )

        contract_version = str(conn.get("contractVersion", ""))
        if not SEMVER_RE.match(contract_version):
            warnings.append(
                f"{module_id}: WARN provides.connections[{idx}] contractVersion='{contract_version}' not semver"
            )

        stability = str(conn.get("stability"))
        if stability not in ALLOWED_STABILITY:
            warnings.append(
                f"{module_id}: WARN provides.connections[{idx}] stability='{stability}' not in {sorted(ALLOWED_STABILITY)}"
            )

        access_policy = str(conn.get("accessPolicy"))
        if access_policy not in ALLOWED_ACCESS_POLICY:
            warnings.append(
                f"{module_id}: WARN provides.connections[{idx}] accessPolicy='{access_policy}' not in {sorted(ALLOWED_ACCESS_POLICY)}"
            )

    return warnings


def audit_manifest(manifest_path: pathlib.Path) -> tuple[str, list[str]]:
    doc = load_json(manifest_path)
    module_id = str(doc.get("id", manifest_path.parent.name))

    warnings: list[str] = []
    requires = doc.get("requires", {})
    provides = doc.get("provides", {})

    if not isinstance(requires, dict):
        warnings.append(f"{module_id}: FAIL requires section missing or invalid")
    else:
        warnings.extend(check_requires(module_id, requires))

    if not isinstance(provides, dict):
        warnings.append(f"{module_id}: FAIL provides section missing or invalid")
    else:
        warnings.extend(check_provides(module_id, provides))

    return module_id, warnings


def main() -> int:
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    modules_dir = repo_root / "modules"
    manifests = sorted(modules_dir.glob("*/module.json"))

    print("ARCH009_AUDIT_BEGIN")
    print(f"manifests_scanned={len(manifests)}")

    total_warn = 0
    total_fail = 0

    for manifest in manifests:
        module_id, issues = audit_manifest(manifest)
        if not issues:
            print(f"{module_id}: PASS")
            continue

        module_has_fail = any(": FAIL " in issue for issue in issues)
        module_has_warn = any(": WARN " in issue for issue in issues)
        if module_has_fail:
            total_fail += 1
        elif module_has_warn:
            total_warn += 1

        for issue in issues:
            print(issue)

    print(f"modules_with_warn={total_warn}")
    print(f"modules_with_fail={total_fail}")
    print("ARCH009_AUDIT_END")
    return 0


if __name__ == "__main__":
    sys.exit(main())
