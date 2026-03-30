#!/usr/bin/env python3
"""
Static lint for ARCH-009 migration contract signals.

Heuristic checks:
- migration file naming order
- schema naming hints follow {module}_{domain}
- idempotency hints present (IF NOT EXISTS / IF EXISTS) when CREATE/DROP appears
"""

from __future__ import annotations

import pathlib
import re
import sys


MIGRATION_NAME_RE = re.compile(r"^\d+_.*\.sql$")
SCHEMA_NAME_RE = re.compile(r"\b([a-z0-9]+_[a-z0-9_]+)\b")


def lint_sql(module_id: str, path: pathlib.Path) -> list[str]:
    issues: list[str] = []
    text = path.read_text(encoding="utf-8", errors="ignore")
    upper = text.upper()

    if "CREATE SCHEMA" in upper and "IF NOT EXISTS" not in upper:
        issues.append(f"{module_id}:{path.name}: WARN CREATE SCHEMA without IF NOT EXISTS")
    if "CREATE TABLE" in upper and "IF NOT EXISTS" not in upper:
        issues.append(f"{module_id}:{path.name}: WARN CREATE TABLE without IF NOT EXISTS")
    if "DROP TABLE" in upper and "IF EXISTS" not in upper:
        issues.append(f"{module_id}:{path.name}: WARN DROP TABLE without IF EXISTS")
    if "DROP SCHEMA" in upper and "IF EXISTS" not in upper:
        issues.append(f"{module_id}:{path.name}: WARN DROP SCHEMA without IF EXISTS")

    # Schema name pattern hint check when schema-qualified names exist.
    qualified_names = re.findall(r"\b([a-z0-9_]+)\.([a-z0-9_]+)\b", text)
    for schema, _table in qualified_names:
        if schema in {"public"}:
            continue
        if "_" not in schema:
            issues.append(
                f"{module_id}:{path.name}: WARN schema '{schema}' does not look like {{module}}_{{domain}}"
            )

    return issues


def main() -> int:
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    modules_dir = repo_root / "modules"
    manifests = sorted(modules_dir.glob("*/module.json"))

    print("ARCH009_MIGRATION_LINT_BEGIN")
    modules_scanned = 0
    migration_files_scanned = 0
    warn_count = 0
    fail_count = 0

    for manifest in manifests:
        module_dir = manifest.parent
        module_id = module_dir.name
        modules_scanned += 1
        migrations = sorted((module_dir / "migrations").glob("*.sql"))
        if not migrations:
            print(f"{module_id}: PASS (no migrations directory)")
            continue

        module_issues: list[str] = []
        for mig in migrations:
            migration_files_scanned += 1
            if not MIGRATION_NAME_RE.match(mig.name):
                module_issues.append(f"{module_id}:{mig.name}: WARN migration filename not numeric-prefix format")
            module_issues.extend(lint_sql(module_id, mig))

        if not module_issues:
            print(f"{module_id}: PASS")
        else:
            for issue in module_issues:
                print(issue)
                if ": FAIL " in issue:
                    fail_count += 1
                elif ": WARN " in issue:
                    warn_count += 1

    print(f"modules_scanned={modules_scanned}")
    print(f"migration_files_scanned={migration_files_scanned}")
    print(f"warn_count={warn_count}")
    print(f"fail_count={fail_count}")
    print("ARCH009_MIGRATION_LINT_END")
    return 0


if __name__ == "__main__":
    sys.exit(main())
