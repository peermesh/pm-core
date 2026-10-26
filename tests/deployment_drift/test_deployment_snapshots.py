"""Focused offline drift contract tests, using synthetic data only."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

SCRIPT_DIR = Path(__file__).resolve().parents[2] / 'scripts/validation'
sys.path.insert(0, str(SCRIPT_DIR))
import compare_deployment_snapshots as comparator

FIXTURE_SECRET = 'SYNTHETIC-SECRET-NEVER-PRINT-719c'
FIXTURE_KEY = 'SYNTHETIC-PRIVATE-KEY-083d'


def synthetic_snapshot() -> dict:
    """Return a nonempty input with ordered chains and opaque extension fields."""
    return {
        'schema': comparator.SCHEMA, 'source_kind': 'synthetic',
        'routers': {'capture_status': 'complete', 'items': {
            'api@docker': {'rule': 'Host(`fixture.invalid`)',
             'service': 'api@docker', 'middlewares': ['auth@file', 'limit@file'],
             'tls': {'certResolver': 'fixture'}, 'priority': 100},
            FIXTURE_SECRET: {'rule': 'Path(`/private`)',
             'service': 'private@docker', 'extension': {FIXTURE_KEY: FIXTURE_SECRET}}}},
        'middlewares': {'capture_status': 'complete', 'items': {
            'auth@file': {'basicAuth': {'users': [FIXTURE_SECRET]}},
            'limit@file': {'rateLimit': {'average': 20, 'burst': 5}}}},
        'dynamic_files': {'capture_status': 'complete', 'items': {'security.yml': 'a' * 64}}
    }


def contract_cases() -> list[tuple[str, str, str, int]]:
    """Build specific expected/observed JSON controls from the nonempty baseline."""
    base = synthetic_snapshot()
    encoded = json.dumps(base)
    cases = [('equal', encoded, encoded, 0),
             ('key-order', encoded, json.dumps(base, sort_keys=True), 0)]
    for field, value in [('rule', 'Host(`changed.invalid`)'), ('service', 'other@docker'),
                         ('tls', {'certResolver': 'different'}),
                         ('middlewares', ['limit@file', 'auth@file']),
                         ('priority', True), ('newNativeSetting', {'enabled': True})]:
        observed = copy.deepcopy(base)
        observed['routers']['items']['api@docker'][field] = value
        cases.append(('router-' + field, encoded, json.dumps(observed), 1))
    for category in ['routers', 'middlewares']:
        removed = copy.deepcopy(base)
        removed[category]['items'].pop(next(iter(removed[category]['items'])))
        cases.append((category + '-removed', encoded, json.dumps(removed), 1))
        added = copy.deepcopy(base)
        added[category]['items']['added@file'] = {'enabled': True}
        cases.append((category + '-added', encoded, json.dumps(added), 1))
    observed = copy.deepcopy(base)
    observed['middlewares']['items']['auth@file']['basicAuth']['users'][0] = 'SYNTHETIC-CHANGED-SECRET'
    cases.append(('middleware-secret-change', encoded, json.dumps(observed), 1))
    observed = copy.deepcopy(base)
    observed['routers']['items'][FIXTURE_SECRET]['extension'][FIXTURE_KEY] = 'SYNTHETIC-CHANGED-SECRET'
    cases.append(('unknown-config-change', encoded, json.dumps(observed), 1))
    for label, items in [('hash', {'security.yml': 'b' * 64}), ('removed', {}),
                         ('added', {'security.yml': 'a' * 64, 'nested/extra.yml': 'c' * 64})]:
        observed = copy.deepcopy(base)
        observed['dynamic_files']['items'] = items
        cases.append(('file-' + label, encoded, json.dumps(observed), 1))
    empty = copy.deepcopy(base)
    for category in comparator.COLLECTIONS:
        empty[category]['items'] = {}
    cases.extend([('explicit-empty', json.dumps(empty), json.dumps(empty), 0),
                  ('all-providers-removed', encoded, json.dumps(empty), 1)])
    for category in comparator.COLLECTIONS:
        observed = copy.deepcopy(base)
        del observed[category]
        cases.append(('missing-' + category, encoded, json.dumps(observed), 2))
        for status in [None, 'failed', 'partial']:
            observed = copy.deepcopy(base)
            if status is None:
                del observed[category]['capture_status']
            else:
                observed[category]['capture_status'] = status
            cases.append((category + '-capture-' + str(status), encoded, json.dumps(observed), 2))
    for category in ['routers', 'middlewares']:
        name = next(iter(base[category]['items']))
        fragment = json.dumps(name) + ':' + json.dumps(base[category]['items'][name]) + ','
        collection = json.dumps(base[category])
        duplicate = collection.replace('"items": {', '"items": {' + fragment, 1)
        cases.append((category + '-duplicate-name', encoded, encoded.replace(collection, duplicate), 2))
    cases.extend([
        ('malformed-json', encoded, '{"' + FIXTURE_SECRET + '":', 2),
        ('duplicate-top-key', encoded, encoded[:-1] + ',"schema":"ignored"}', 2),
        ('duplicate-config-key', encoded, encoded.replace('"priority": 100', '"priority": 100, "priority": 100'), 2),
        ('duplicate-path', encoded, encoded.replace('"security.yml": "' + 'a' * 64 + '"',
             '"security.yml": "' + 'a' * 64 + '", "security.yml": "' + 'a' * 64 + '"'), 2),
        ('non-json-number', encoded, encoded.replace('"priority": 100', '"priority": NaN'), 2),
        ('lone-surrogate', encoded, encoded.replace(FIXTURE_SECRET, '\\ud800'), 2),
    ])
    for label, change in [('unknown-envelope', {'unexpected': True}),
                          ('wrong-schema', {'schema': 'unknown'}),
                          ('bad-kind', {'source_kind': False}),
                          ('different-kind', {'source_kind': 'captured'})]:
        observed = copy.deepcopy(base)
        observed.update(change)
        cases.append((label, encoded, json.dumps(observed), 2))
    for label, value in [('empty', {}), ('list', []), ('null', None)]:
        observed = copy.deepcopy(base)
        observed['routers']['items']['api@docker'] = value
        cases.append(('bad-config-' + label, encoded, json.dumps(observed), 2))
    for path in ['/absolute.yml', '../escape.yml', './security.yml', 'nested//file.yml',
                 'nested\\file.yml', 'C:/file.yml', '.', 'dir/', '', 'x\x00y']:
        observed = copy.deepcopy(base)
        observed['dynamic_files']['items'] = {path: 'a' * 64}
        cases.append(('bad-relative-path-' + str(len(cases)), encoded, json.dumps(observed), 2))
    for digest in ['A' * 64, 'g' * 64, 'a' * 63, None, 42]:
        observed = copy.deepcopy(base)
        observed['dynamic_files']['items'] = {'security.yml': digest}
        cases.append(('bad-hash-' + str(len(cases)), encoded, json.dumps(observed), 2))
    cases.extend([
        ('exact-decimal-drift', encoded.replace('"priority": 100', '"priority": 0.10000000000000000001'),
         encoded.replace('"priority": 100', '"priority": 0.10000000000000000002'), 1),
        ('number-format', encoded, encoded.replace('"priority": 100', '"priority": 1e2'), 0),
        ('boolean-number', encoded.replace('"priority": 100', '"priority": true'),
         encoded.replace('"priority": 100', '"priority": 1'), 1)])
    nested = copy.deepcopy(base)
    nested['routers']['items']['api@docker']['unknownArray'] = [{'a': 1}, {'b': 2}]
    swapped = copy.deepcopy(nested)
    swapped['routers']['items']['api@docker']['unknownArray'].reverse()
    cases.append(('unknown-array-order', json.dumps(nested), json.dumps(swapped), 1))
    for category in comparator.COLLECTIONS:
        observed = copy.deepcopy(base)
        observed[category]['items'] = []
        cases.append((category + '-wrong-inventory-type', encoded, json.dumps(observed), 2))
    return cases


class TestDeploymentSnapshots(unittest.TestCase):
    """Exercise the format and comparison contract, not unrelated Core suites."""

    def test_contract_matrix(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            expected, observed = Path(temporary) / 'expected.json', Path(temporary) / 'observed.json'
            for name, left, right, wanted in contract_cases():
                with self.subTest(case=name):
                    expected.write_text(left, encoding='utf-8')
                    observed.write_text(right, encoding='utf-8')
                    try:
                        left_kind, left_data = comparator.load_snapshot(expected)
                        right_kind, right_data = comparator.load_snapshot(observed)
                        if left_kind != right_kind:
                            actual, changes = 2, []
                        else:
                            changes = comparator.compare_snapshots(left_data, right_data)
                            actual = 1 if changes else 0
                    except comparator.InvalidSnapshot:
                        actual, changes = 2, []
                    self.assertEqual(actual, wanted)
                    output = json.dumps(changes)
                    self.assertNotIn(FIXTURE_SECRET, output)
                    self.assertNotIn(FIXTURE_KEY, output)
                    self.assertEqual(changes, sorted(changes))

    def test_array_index_paths_and_determinism(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'input.json'
            base = synthetic_snapshot()
            path.write_text(json.dumps(base), encoding='utf-8')
            _, expected = comparator.load_snapshot(path)
            base['routers']['items']['api@docker']['middlewares'].reverse()
            path.write_text(json.dumps(base), encoding='utf-8')
            _, observed = comparator.load_snapshot(path)
            first = comparator.compare_snapshots(expected, observed)
            self.assertEqual(len(first), 2)
            self.assertEqual({p.rsplit('/', 1)[1] for p in first}, {'0', '1'})
            self.assertEqual(first, comparator.compare_snapshots(expected, observed))

    def test_unreadable_input_has_fixed_error(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(comparator.InvalidSnapshot, '^unreadable_input$'):
                comparator.load_snapshot(Path(temporary) / FIXTURE_SECRET)


if __name__ == '__main__':
    unittest.main()
