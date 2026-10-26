#!/usr/bin/env python3
"""Compare explicit local deployment snapshots without collecting or printing values."""
from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
from typing import TypeAlias, Union

JSONValue: TypeAlias = Union[None, bool, str, Decimal, list['JSONValue'], dict[str, 'JSONValue']]
Snapshot: TypeAlias = dict[str, dict[str, JSONValue]]
SCHEMA = 'peermesh.deployment-snapshot.v1'
COLLECTIONS = ('routers', 'middlewares', 'dynamic_files')


class InvalidSnapshot(ValueError):
    """Carry only fixed error codes, never user-supplied input text."""


def _unique_object(pairs: list[tuple[str, JSONValue]]) -> dict[str, JSONValue]:
    """Reject duplicate JSON keys at every nesting level."""
    result: dict[str, JSONValue] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidSnapshot('duplicate_json_key')
        result[key] = value
    return result


def _reject_constant(_value: str) -> JSONValue:
    """Reject non-JSON numeric constants without echoing them."""
    raise InvalidSnapshot('non_json_number')


def _validate_strings(value: JSONValue) -> None:
    """Reject lone Unicode surrogates; preserve all valid string contents."""
    if isinstance(value, str):
        value.encode('utf-8')
    elif isinstance(value, dict):
        for key, child in value.items():
            key.encode('utf-8')
            _validate_strings(child)
    elif isinstance(value, list):
        for child in value:
            _validate_strings(child)


def _valid_name(value: JSONValue) -> bool:
    """Require a nonempty unambiguous identifier, without normalizing it."""
    return isinstance(value, str) and bool(value) and value.strip() == value and all(
        ord(character) >= 32 and ord(character) != 127 for character in value)


def _named_inventory(items: JSONValue) -> dict[str, JSONValue]:
    """Index complete named configuration objects without discarding fields."""
    if not isinstance(items, dict):
        raise InvalidSnapshot('invalid_named_inventory')
    result: dict[str, JSONValue] = {}
    for name, config in items.items():
        if not _valid_name(name):
            raise InvalidSnapshot('invalid_name')
        if not isinstance(config, dict) or not config:
            raise InvalidSnapshot('missing_configuration')
        result[name] = config
    return result


def _dynamic_inventory(items: JSONValue) -> dict[str, JSONValue]:
    """Validate canonical relative POSIX paths and lowercase SHA-256 values."""
    if not isinstance(items, dict):
        raise InvalidSnapshot('invalid_dynamic_inventory')
    for name, digest in items.items():
        path = PurePosixPath(name)
        if (not _valid_name(name) or path.is_absolute() or str(path) != name
                or name == '.' or '..' in path.parts or '\\' in name
                or re.match(r'^[A-Za-z]:', name)):
            raise InvalidSnapshot('invalid_relative_path')
        if not isinstance(digest, str) or re.fullmatch(r'[0-9a-f]{64}', digest) is None:
            raise InvalidSnapshot('invalid_sha256')
    return items


def load_snapshot(path: Path) -> tuple[str, Snapshot]:
    """Load one strictly versioned local snapshot.

    Args:
        path: Explicit local JSON snapshot file; never treated as a URL.
    Returns:
        Source kind and normalized named inventories, preserving every config value.
    Raises:
        InvalidSnapshot: Fixed-code structural, capture or parsing error.
    """
    try:
        text = path.read_text(encoding='utf-8')
    except (OSError, UnicodeError):
        raise InvalidSnapshot('unreadable_input') from None
    try:
        raw: JSONValue = json.loads(text, object_pairs_hook=_unique_object,
            parse_int=Decimal, parse_float=Decimal, parse_constant=_reject_constant)
        _validate_strings(raw)
    except InvalidSnapshot:
        raise
    except (ValueError, InvalidOperation, UnicodeError, RecursionError):
        raise InvalidSnapshot('invalid_json') from None
    if not isinstance(raw, dict) or set(raw) != {'schema', 'source_kind', *COLLECTIONS}:
        raise InvalidSnapshot('invalid_snapshot_fields')
    if raw['schema'] != SCHEMA:
        raise InvalidSnapshot('unsupported_schema')
    kind = raw['source_kind']
    if not isinstance(kind, str) or kind not in ('synthetic', 'captured'):
        raise InvalidSnapshot('invalid_source_kind')
    result: Snapshot = {}
    for name in COLLECTIONS:
        collection = raw[name]
        if not isinstance(collection, dict) or set(collection) != {'capture_status', 'items'}:
            raise InvalidSnapshot('invalid_capture_fields')
        if collection['capture_status'] != 'complete':
            raise InvalidSnapshot('capture_not_complete')
        result[name] = (_dynamic_inventory(collection['items']) if name == 'dynamic_files'
                        else _named_inventory(collection['items']))
    return kind, result


def _path_token(key: str) -> str:
    """Identify a supplied key without emitting its raw contents."""
    return 'k-' + hashlib.sha256(key.encode('utf-8')).hexdigest()


def _changed_paths(expected: JSONValue, observed: JSONValue, path: str) -> list[str]:
    """Walk full values, preserving array order and scalar JSON types."""
    if type(expected) is not type(observed):
        return [path]
    if isinstance(expected, dict) and isinstance(observed, dict):
        changes = []
        for key in sorted(set(expected) | set(observed)):
            child = path + '/' + _path_token(key)
            if key not in expected or key not in observed:
                changes.append(child)
            else:
                changes.extend(_changed_paths(expected[key], observed[key], child))
        return changes
    if isinstance(expected, list) and isinstance(observed, list):
        changes = []
        for index in range(max(len(expected), len(observed))):
            child = path + '/' + str(index)
            if index >= len(expected) or index >= len(observed):
                changes.append(child)
            else:
                changes.extend(_changed_paths(expected[index], observed[index], child))
        return changes
    return [] if expected == observed else [path]


def compare_snapshots(expected: Snapshot, observed: Snapshot) -> list[str]:
    """Return deterministic opaque changed paths for validated inventories.

    Args:
        expected: Normalized expected snapshot returned by load_snapshot.
        observed: Normalized observed snapshot returned by load_snapshot.
    Returns:
        Sorted paths, without any raw names, settings, hashes or body values.
    """
    return sorted(path for category in COLLECTIONS
                  for path in _changed_paths(expected[category], observed[category], '/' + category))


def main() -> int:
    """Read two local inputs; emit JSON stdout and a short stderr summary.

    Returns:
        Zero for valid equivalence, one for drift, two for invalid input.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('expected', type=Path, help='expected local JSON snapshot')
    parser.add_argument('observed', type=Path, help='observed local JSON snapshot')
    args = parser.parse_args()
    loaded = []
    for label in ('expected', 'observed'):
        try:
            loaded.append(load_snapshot(getattr(args, label)))
        except InvalidSnapshot as error:
            print(json.dumps({'status': 'invalid', 'input': label, 'error': str(error)}, sort_keys=True))
            print(f'INVALID: {label} snapshot ({error}).', file=sys.stderr)
            return 2
    if loaded[0][0] != loaded[1][0]:
        print(json.dumps({'status': 'invalid', 'input': 'pair', 'error': 'source_kind_mismatch'}, sort_keys=True))
        print('INVALID: snapshot source kinds differ.', file=sys.stderr)
        return 2
    try:
        changed = compare_snapshots(loaded[0][1], loaded[1][1])
    except RecursionError:
        print(json.dumps({'status': 'invalid', 'input': 'pair', 'error': 'nesting_limit'}, sort_keys=True))
        print('INVALID: snapshot nesting limit.', file=sys.stderr)
        return 2
    status = 'drift' if changed else 'equivalent'
    print(json.dumps({'status': status, 'changed_paths': changed}, sort_keys=True))
    print(f'{status.upper()}: {len(changed)} changed paths.', file=sys.stderr)
    return 1 if changed else 0


if __name__ == '__main__':
    raise SystemExit(main())
