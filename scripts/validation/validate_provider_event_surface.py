#!/usr/bin/env python3
# arch-009: gate provider-declared event surface (provides.events) on baseline module manifests.
import json
import os
import re
import sys
from pathlib import Path

# mirrors foundation/schemas/module.schema.json provides.events.items.pattern
EVENT_ID_PATTERN = re.compile(r"^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$")

DEFAULT_MANIFESTS = (
    "modules/social/module.json",
    "modules/universal-manifest/module.json",
)


def validate_manifest(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [f"{path}: cannot read file: {exc}"]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return [f"{path}: invalid json: {exc}"]

    provides = data.get("provides")
    if provides is None:
        return [f"{path}: missing top-level 'provides'"]
    if not isinstance(provides, dict):
        return [f"{path}: 'provides' must be an object"]

    events = provides.get("events")
    if events is None:
        return [f"{path}: missing provides.events"]
    if not isinstance(events, list):
        return [f"{path}: provides.events must be an array"]
    if len(events) == 0:
        return [f"{path}: provides.events must be non-empty"]

    seen: set[str] = set()
    for i, item in enumerate(events):
        if not isinstance(item, str):
            errors.append(
                f"{path}: provides.events[{i}] must be a string, got {type(item).__name__}"
            )
            continue
        if not item.strip():
            errors.append(f"{path}: provides.events[{i}] must be a non-empty string")
            continue
        if item != item.strip():
            errors.append(f"{path}: provides.events[{i}] must not have leading or trailing whitespace")
            continue
        if not EVENT_ID_PATTERN.fullmatch(item):
            errors.append(
                f"{path}: provides.events[{i}] invalid event id {item!r} "
                "(expected domain.entity.action: lowercase letters, digits, hyphens, two dots)"
            )
        if item in seen:
            errors.append(f"{path}: duplicate event id {item!r}")
        seen.add(item)

    return errors


def manifest_paths(core_root: Path) -> list[Path]:
    raw = os.environ.get("ARCH009_EVENT_SURFACE_MANIFESTS", "").strip()
    if raw:
        rels = [p.strip() for p in raw.split(":") if p.strip()]
        return [core_root / rel for rel in rels]
    return [core_root / rel for rel in DEFAULT_MANIFESTS]


def main() -> int:
    core_root = Path(__file__).resolve().parent.parent.parent
    all_errors: list[str] = []
    paths = manifest_paths(core_root)
    for rel in paths:
        if not rel.is_file():
            all_errors.append(f"{rel}: manifest file not found")
            continue
        all_errors.extend(validate_manifest(rel))

    if all_errors:
        print("[provider-event-surface-gate] validation failed", file=sys.stderr)
        for line in all_errors:
            print(line, file=sys.stderr)
        return 1

    print("[provider-event-surface-gate] ok: checked", len(paths), "manifest(s)")
    for p in paths:
        print("  -", p.relative_to(core_root))
    return 0


if __name__ == "__main__":
    sys.exit(main())
