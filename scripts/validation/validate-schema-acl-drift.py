#!/usr/bin/env python3
"""
Compare a captured Postgres ACL snapshot against the ARCH-009 baseline for
`social_lab_reader` on the Social module shared surfaces (social_profiles,
social_graph). Exits non-zero on drift.

Snapshot format (one line per privilege, sorted):
  SCHEMA:schema_name:PRIVILEGE
  TABLE:schema_name.table_name:PRIVILEGE

Usage:
  Capture a snapshot with psql (same query as run-arch009-schema-acl-integration.sh) and pipe:
    python3 validate-schema-acl-drift.py --stdin

  python3 validate-schema-acl-drift.py --snapshot-file /path/to/snapshot.txt

  Snapshot lines are SCHEMA:name:USAGE and TABLE:schema.table:SELECT for grantee-equivalent
  checks (integration script uses has_schema_privilege / has_table_privilege for social_lab_reader).
"""

from __future__ import annotations

import argparse
import sys


# baseline after modules/social/migrations/001_initial_schema.sql (shared surfaces only)
EXPECTED_LINES = frozenset(
    {
        "SCHEMA:social_graph:USAGE",
        "SCHEMA:social_profiles:USAGE",
        "TABLE:social_graph.social_graph:SELECT",
        "TABLE:social_profiles.bio_links:SELECT",
        "TABLE:social_profiles.platform_enrichment:SELECT",
        "TABLE:social_profiles.profile_index:SELECT",
    }
)


def _normalize_lines(text: str) -> frozenset[str]:
    lines: set[str] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        lines.add(line)
    return frozenset(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="ARCH-009 schema ACL drift check (social_lab_reader)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--stdin", action="store_true", help="read snapshot lines from stdin")
    group.add_argument("--snapshot-file", type=str, help="path to snapshot file")
    args = parser.parse_args()

    if args.stdin:
        data = sys.stdin.read()
    else:
        path = args.snapshot_file
        with open(path, encoding="utf-8") as f:
            data = f.read()

    actual = _normalize_lines(data)

    missing = sorted(EXPECTED_LINES - actual)
    extra = sorted(actual - EXPECTED_LINES)

    print("ARCH009_ACL_DRIFT_BEGIN")
    print(f"expected_count={len(EXPECTED_LINES)}")
    print(f"actual_count={len(actual)}")
    if not missing and not extra:
        print("drift_status=PASS")
        print("ARCH009_ACL_DRIFT_END")
        return 0

    print("drift_status=FAIL")
    for line in missing:
        print(f"missing={line}")
    for line in extra:
        print(f"extra={line}")
    print("ARCH009_ACL_DRIFT_END")
    return 1


if __name__ == "__main__":
    sys.exit(main())
