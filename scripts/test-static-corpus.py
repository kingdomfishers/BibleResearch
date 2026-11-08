#!/usr/bin/env python3
"""
scripts/test-static-corpus.py
Unit and integration test suite for the static corpus export, 983-file Macula syntax trees,
Unicode normalization, license gating, and retrieval shard invariants.
"""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

_VERIFY_PATH = Path(__file__).resolve().parent / "verify-static-corpus.py"
_SPEC = importlib.util.spec_from_file_location("verify_static_corpus", _VERIFY_PATH)
assert _SPEC and _SPEC.loader
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)

load_gzip_json = _MOD.load_gzip_json
verify_static_corpus = _MOD.verify_static_corpus
CORPUS_DIR = _MOD.CORPUS_DIR


class TestStaticCorpus(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.summary = verify_static_corpus()
        cls.manifest = json.loads((CORPUS_DIR / "manifest.json").read_text(encoding="utf-8"))

    def test_01_cloudflare_free_plan_limits(self) -> None:
        limits = self.manifest["cloudflare_limits_check"]
        self.assertTrue(limits["within_limits"])
        self.assertLessEqual(limits["total_asset_files"], 20000)
        self.assertLessEqual(limits["max_single_asset_compressed_bytes"], 25 * 1024 * 1024)

    def test_02_macula_983_files_complete(self) -> None:
        macula = self.manifest["macula_syntax_completion"]
        self.assertEqual(macula["manifest_files_total"], 983)
        self.assertEqual(macula["files_imported_and_verified"], 983)
        self.assertEqual(macula["editions"]["macula-hebrew-wlc"], 929)
        self.assertEqual(macula["editions"]["macula-greek-nestle1904"], 27)
        self.assertEqual(macula["editions"]["macula-greek-sblgnt"], 27)
        self.assertEqual(macula["integrity"]["status"], "PASS")
        self.assertEqual(macula["integrity"]["cycles_count"], 0)
        self.assertEqual(macula["integrity"]["orphaned_parents_count"], 0)

    def test_03_hebrew_greek_aramaic_unicode_and_difficult_passages(self) -> None:
        # Genesis 1:1
        gen1 = load_gzip_json("/v1/chapters/b1-c1.json.gz")
        self.assertIn("1", gen1["verses"])
        self.assertEqual(len(gen1["verses"]["1"]["tokens"]), 7)
        # Psalm 51:0 superscription
        ps51 = load_gzip_json("/v1/chapters/b19-c51.json.gz")
        self.assertIn("0", ps51["verses"])
        self.assertGreater(len(ps51["verses"]["0"]["tokens"]), 0)
        # Daniel 2:4 Aramaic transition
        dan2 = load_gzip_json("/v1/chapters/b27-c2.json.gz")
        langs = {m["lang"] for m in dan2["verses"]["4"]["macula_hebrew_morphemes"]}
        self.assertEqual(langs, {"H", "A"})
        # Ephesians 1:3-14 cross-verse spans (#s3 = 1:3-6, #s6 = 1:13-14)
        eph1 = load_gzip_json("/v1/chapters/b49-c1.json.gz")
        tids_v3 = set(eph1["verses"]["3"]["tree_ids"])
        tids_v6 = set(eph1["verses"]["6"]["tree_ids"])
        tids_v13 = set(eph1["verses"]["13"]["tree_ids"])
        tids_v14 = set(eph1["verses"]["14"]["tree_ids"])
        self.assertEqual(len(tids_v3 & tids_v6), 2)
        self.assertEqual(len(tids_v13 & tids_v14), 2)
        # Mark 16:99 noncanonical source nodes preserved without fabricating verse 99, and 3 John 1:15 versification
        mrk16 = load_gzip_json("/v1/chapters/b41-c16.json.gz")
        self.assertNotIn("99", mrk16["verses"])
        self.assertGreater(len(mrk16["unmapped_syntax_nodes"]), 0)
        jhn3 = load_gzip_json("/v1/chapters/b64-c1.json.gz")
        self.assertIn("15", jhn3["verses"])
        self.assertGreaterEqual(len(jhn3["verses"]["15"]["versification_mappings"]), 1)

    def test_04_septuagint_55_books_and_deuterocanonical_coverage(self) -> None:
        meta = load_gzip_json("/v1/catalog/metadata.json.gz")
        self.assertEqual(len(meta["lxx_swete_books"]), 55)
        wis1 = load_gzip_json("/v1/lxx/b33.json.gz")
        self.assertTrue(wis1["book"]["is_deuterocanonical_or_apocrypha"])
        self.assertGreater(len(wis1["words"]), 100)


if __name__ == "__main__":
    unittest.main()
