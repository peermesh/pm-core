#!/usr/bin/env python3
"""
ARCH-008 import boundary gate for modules/social/app (Node ESM).

- @inrupt/* specifiers only in solid adapter modules (lib/solid-adapter.js or
  lib/adapters/* with 'solid' in the filename stem).
- SQL driver imports (pg, mysql2, better-sqlite3, sqlite3) only in db.js or
  lib/adapters/* with sql/postgres in the stem.
- Known P2P / DHT client packages only in lib/adapters/* whose stem matches
  p2p, ssb, hyper, scuttle, or feed.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys


# Match from "pkg" / from 'pkg' anywhere in file (multiline imports).
FROM_SPEC_RE = re.compile(r"""\bfrom\s+['"](?P<spec>[^'"]+)['"]""")
REQUIRE_SPEC_RE = re.compile(r"""require\s*\(\s*['"](?P<spec>[^'"]+)['"]\s*\)""")
DYNAMIC_IMPORT_RE = re.compile(r"""import\s*\(\s*['"](?P<spec>[^'"]+)['"]\s*\)""")
IMPORT_SIDE_RE = re.compile(r"""^\s*import\s+['"](?P<spec>[^'"]+)['"]""", re.MULTILINE)

INRUPT_PREFIX = "@inrupt/"

SQL_CLIENT_PREFIXES = (
    "pg",
    "mysql2",
    "better-sqlite3",
    "sqlite3",
)

P2P_SPEC_PREFIXES = (
    "hyperswarm",
    "hypercore",
    "hyperbee",
    "@hyperswarm/",
    "ssb-client",
    "ssb-db",
    "ssb-config",
    "secret-stack",
    "muxrpc",
)


def _strip_line_comment(line: str) -> str:
    in_string = False
    quote = ""
    i = 0
    while i < len(line):
        ch = line[i]
        if not in_string:
            if ch in "\"'":
                in_string = True
                quote = ch
            elif ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
                return line[:i].rstrip()
        else:
            if ch == "\\" and i + 1 < len(line):
                i += 2
                continue
            if ch == quote:
                in_string = False
                quote = ""
        i += 1
    return line.rstrip()


def _iter_logical_lines(path: pathlib.Path) -> list[tuple[int, str]]:
    """Return (1-based line number, content) for non-comment-only lines."""
    text = path.read_text(encoding="utf-8", errors="replace")
    out: list[tuple[int, str]] = []
    for i, line in enumerate(text.splitlines(), start=1):
        stripped = _strip_line_comment(line).strip()
        if not stripped or stripped.startswith("//"):
            continue
        # skip jsdoc / block-comment lines (e.g. import('pg') in @param types)
        if stripped.startswith("*"):
            continue
        out.append((i, stripped))
    return out


def _specifiers_in_line(line: str) -> set[str]:
    found: set[str] = set()
    for rx in (FROM_SPEC_RE, REQUIRE_SPEC_RE, DYNAMIC_IMPORT_RE):
        for m in rx.finditer(line):
            found.add(m.group("spec"))
    for m in IMPORT_SIDE_RE.finditer(line):
        found.add(m.group("spec"))
    return found


def collect_specifiers(path: pathlib.Path) -> list[tuple[int, str]]:
    pairs: list[tuple[int, str]] = []
    for lineno, line in _iter_logical_lines(path):
        for spec in _specifiers_in_line(line):
            pairs.append((lineno, spec))
    return pairs


def is_solid_adapter_module(relpath: pathlib.Path) -> bool:
    parts = relpath.parts
    if len(parts) >= 2 and parts[0] == "lib" and parts[1] == "solid-adapter.js":
        return True
    if len(parts) >= 3 and parts[0] == "lib" and parts[1] == "adapters":
        return "solid" in relpath.stem.lower()
    return False


def is_sql_client_allowed_path(relpath: pathlib.Path) -> bool:
    if relpath.name == "db.js" and len(relpath.parts) == 1:
        return True
    parts = relpath.parts
    if len(parts) >= 3 and parts[0] == "lib" and parts[1] == "adapters":
        stem = relpath.stem.lower()
        return "sql" in stem or "postgres" in stem
    return False


def is_p2p_client_allowed_path(relpath: pathlib.Path) -> bool:
    parts = relpath.parts
    if len(parts) < 3 or parts[0] != "lib" or parts[1] != "adapters":
        return False
    stem = relpath.stem.lower()
    return any(
        k in stem
        for k in (
            "p2p",
            "ssb",
            "hyper",
            "scuttle",
            "feed",
        )
    )


def is_sql_client_spec(spec: str) -> bool:
    if spec in SQL_CLIENT_PREFIXES or spec == "pg":
        return True
    return spec.startswith("mysql2")


def is_p2p_client_spec(spec: str) -> bool:
    return any(spec == p or spec.startswith(p) for p in P2P_SPEC_PREFIXES)


def scan_social_app(app_root: pathlib.Path) -> list[str]:
    violations: list[str] = []
    for path in sorted(app_root.rglob("*.js")):
        rel = path.relative_to(app_root)
        if "node_modules" in rel.parts:
            continue
        for lineno, spec in collect_specifiers(path):
            rel_s = rel.as_posix()
            if spec.startswith(INRUPT_PREFIX) and not is_solid_adapter_module(rel):
                violations.append(
                    f"{rel_s}:{lineno}: @inrupt import only allowed in solid adapter modules (got {spec!r})"
                )
            if is_sql_client_spec(spec) and not is_sql_client_allowed_path(rel):
                violations.append(
                    f"{rel_s}:{lineno}: SQL client {spec!r} only allowed in db.js or lib/adapters/*sql*"
                )
            if is_p2p_client_spec(spec) and not is_p2p_client_allowed_path(rel):
                violations.append(
                    f"{rel_s}:{lineno}: P2P client {spec!r} only allowed in matching lib/adapters module"
                )
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--app-root",
        type=pathlib.Path,
        default=None,
        help="Override social app root (default: <repo>/modules/social/app)",
    )
    args = parser.parse_args()

    repo_root = pathlib.Path(__file__).resolve().parents[2]
    app_root = args.app_root or (repo_root / "modules" / "social" / "app")
    if not app_root.is_dir():
        print(f"ARCH008_ADAPTER_BOUNDARY_FAIL: app root missing: {app_root}", file=sys.stderr)
        return 2

    print("ARCH008_ADAPTER_BOUNDARY_BEGIN")
    print(f"scan_root={app_root}")
    violations = scan_social_app(app_root)
    if violations:
        print(f"violations={len(violations)}")
        for v in violations:
            print(v)
        print("ARCH008_ADAPTER_BOUNDARY_FAIL")
        return 1
    print("violations=0")
    print("ARCH008_ADAPTER_BOUNDARY_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
