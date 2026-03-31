#!/usr/bin/env python3
"""Unit tests for validate_adapter_import_boundaries (unittest, no extra deps)."""

from __future__ import annotations

import pathlib
import tempfile
import unittest

import validate_adapter_import_boundaries as v


class TestBoundaries(unittest.TestCase):
    def test_inrupt_allowed_solid_adapter(self) -> None:
        self.assertTrue(v.is_solid_adapter_module(pathlib.Path("lib/solid-adapter.js")))
        self.assertTrue(v.is_solid_adapter_module(pathlib.Path("lib/adapters/solid-data-layer-adapter.js")))
        self.assertFalse(v.is_solid_adapter_module(pathlib.Path("lib/adapters/nostr-adapter.js")))

    def test_sql_allowed_db_and_sql_adapter(self) -> None:
        self.assertTrue(v.is_sql_client_allowed_path(pathlib.Path("db.js")))
        self.assertTrue(v.is_sql_client_allowed_path(pathlib.Path("lib/adapters/sql-data-layer-adapter.js")))
        self.assertFalse(v.is_sql_client_allowed_path(pathlib.Path("routes/feeds.js")))

    def test_p2p_allowed_adapter_stems(self) -> None:
        self.assertTrue(v.is_p2p_client_allowed_path(pathlib.Path("lib/adapters/p2p-append-feed-adapter.js")))
        self.assertTrue(v.is_p2p_client_allowed_path(pathlib.Path("lib/adapters/ssb-adapter.js")))
        self.assertTrue(v.is_p2p_client_allowed_path(pathlib.Path("lib/adapters/hypercore-adapter.js")))
        self.assertFalse(v.is_p2p_client_allowed_path(pathlib.Path("lib/helpers.js")))

    def test_scan_fails_on_inrupt_in_route(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            bad = root / "routes" / "evil.js"
            bad.parent.mkdir(parents=True)
            bad.write_text("import { x } from '@inrupt/solid-client';\n", encoding="utf-8")
            vio = v.scan_social_app(root)
            self.assertEqual(len(vio), 1)
            self.assertIn("@inrupt", vio[0])

    def test_scan_passes_minimal_layout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            good = root / "lib" / "solid-adapter.js"
            good.parent.mkdir(parents=True)
            good.write_text("import { x } from '@inrupt/solid-client';\n", encoding="utf-8")
            db = root / "db.js"
            db.write_text("import pg from 'pg';\n", encoding="utf-8")
            self.assertEqual(v.scan_social_app(root), [])

    def test_jsdoc_import_type_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            p = root / "lib" / "crypto-helper.js"
            p.parent.mkdir(parents=True)
            p.write_text(
                "/**\n * @param {import('pg').Pool} pool\n */\nexport function x() {}\n",
                encoding="utf-8",
            )
            self.assertEqual(v.scan_social_app(root), [])


if __name__ == "__main__":
    unittest.main()
