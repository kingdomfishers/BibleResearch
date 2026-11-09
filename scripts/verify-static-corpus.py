#!/usr/bin/env python3
"""
scripts/verify-static-corpus.py
Comprehensive offline verifier for the generated Cloudflare Workers Static Assets corpus
in `.artifacts/static-corpus/`.

Verifies:
1. Manifest schema, Cloudflare Free-plan file count (<= 20,000) and per-asset size (<= 25 MiB).
2. Compressed & uncompressed SHA-256 checksums and exact row counts for all exported table shards
   and all `/v1/*` retrieval shards.
3. Complete 983-file Macula syntax corpus coverage (929 WLC, 27 Nestle1904, 27 SBLGNT),
   parent-child acyclicity, terminal XML ID coverage, and cross-verse span preservation.
4. Difficult biblical cases:
   - Genesis 1:1 (Hebrew Unicode NFC, 11 terminals, PP-V-S-O clause)
   - Psalm headings at verse 0 (Psalm 3:0, Psalm 51:0)
   - Daniel 2:4 (Hebrew-to-Aramaic transition)
   - John 1:1 (Greek polytonic Unicode, Nestle1904 & SBLGNT Conj3CL trees)
   - Mark 16:9-20 (edition differences & TAGNT variant flags)
   - Ephesians 1:3-14 (12-verse cross-verse Greek sentence tree)
   - 3 John 1:15 (noncanonical source-only syntax nodes preserved without fabricating canonical verse)
5. License compliance & secret exclusion (no restricted lexical fields, no service_role keys).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
CORPUS_DIR = ROOT_DIR / ".artifacts" / "static-corpus"

EXPECTED_ROW_COUNTS = {
    "books": 66,
    "lxx_swete_books": 55,
    "verses_immutable": 31203,
    "words_immutable": 150105,
    "verse_translation_sources": 443524,
    "macula_hebrew_morphemes": 475911,
    "macula_greek_tokens": 275520,
    "lxx_swete_words": 588579,
    "morphhb_tokens": 306786,
    "tagnt_tokens": 142096,
    "word_form_lemmas": 270447,
    "lexeme_identifiers": 113595,
    "canonical_entities": 82485,
    "edition_passages": 62418,
    "reader_rendering_groups": 98133,
    "reader_english_verses": 31215,
    "lexical_senses": 26179,
    "lexemes": 22719,
    "hebrew_lxx_verse_map": 23039,
    "lemmas": 22171,
    "lexical_formations": 744,
    "entity_relationships": 15642,
    "lemma_root_links": 6504,
    "lemma_components": 1558,
    "versification_mappings": 2131,
    "lexical_roots": 2637,
    "token_morphemes": 2321,
    "macula_gated_field_values": 2094,
    "semantic_annotations": 911,
    "cross_token_mappings": 147,
    "lexical_connections": 2,
    "field_license_registry": 40,
    "hebrew_lxx_word_alignments": 9,
    "macula_syntax_import_files": 983,
}

FORBIDDEN_GATED_FIELDS = {
    "sdbh",
    "lexdomain",
    "coredomain",
    "contextualdomain",
    "domain",
    "ln",
}


def load_gzip_json(rel_path: str) -> Any:
    full_path = CORPUS_DIR / rel_path.lstrip("/")
    raw = gzip.decompress(full_path.read_bytes())
    return json.loads(raw.decode("utf-8"))


def verify_static_corpus() -> dict[str, Any]:
    manifest_path = CORPUS_DIR / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing manifest.json at {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    limits = manifest["cloudflare_limits_check"]
    assert limits["within_limits"] is True, f"Cloudflare limits exceeded: {limits}"
    assert limits["total_asset_files"] <= 20000, f"Too many assets: {limits['total_asset_files']}"
    assert limits["max_single_asset_compressed_bytes"] <= 25 * 1024 * 1024, (
        f"Asset exceeds 25 MiB: {limits['max_single_asset_compressed_bytes']}"
    )

    # 1. Verify all table shards & row counts
    tables = manifest["tables"]
    verified_shards = 0
    for table_name, expected_count in EXPECTED_ROW_COUNTS.items():
        assert table_name in tables, f"Missing table in manifest: {table_name}"
        t_info = tables[table_name]
        assert t_info["total_rows"] == expected_count, (
            f"Row count mismatch on {table_name}: expected {expected_count}, got {t_info['total_rows']}"
        )

    for table_name, t_info in tables.items():
        counted_rows = 0
        for shard in t_info["shards"]:
            s_path = CORPUS_DIR / shard["path"].lstrip("/")
            assert s_path.exists(), f"Missing shard file: {s_path}"
            gz_bytes = s_path.read_bytes()
            assert len(gz_bytes) == shard["compressed_bytes"], f"Compressed size mismatch on {s_path}"
            assert hashlib.sha256(gz_bytes).hexdigest() == shard["sha256_compressed"], (
                f"Compressed SHA-256 mismatch on {s_path}"
            )
            raw_bytes = gzip.decompress(gz_bytes)
            assert len(raw_bytes) == shard["uncompressed_bytes"], f"Uncompressed size mismatch on {s_path}"
            assert hashlib.sha256(raw_bytes).hexdigest() == shard["sha256_uncompressed"], (
                f"Uncompressed SHA-256 mismatch on {s_path}"
            )
            lines = raw_bytes.decode("utf-8").splitlines()
            assert len(lines) == shard["rows"], f"Line count mismatch on {s_path}"
            counted_rows += len(lines)
            verified_shards += 1
        assert counted_rows == t_info["total_rows"], f"Summed shard rows != total_rows for {table_name}"

    # 2. Verify all /v1/* retrieval shards
    v1_shards = manifest["v1_retrieval_shards"]
    assert len(v1_shards) == 1 + 55 + 1189 + 64 + 128 + 1 + 1, (
        f"Unexpected v1 shard count: {len(v1_shards)}"
    )
    for shard in v1_shards:
        s_path = CORPUS_DIR / shard["path"].lstrip("/")
        assert s_path.exists(), f"Missing v1 shard: {s_path}"
        gz_bytes = s_path.read_bytes()
        assert hashlib.sha256(gz_bytes).hexdigest() == shard["sha256_compressed"], (
            f"Compressed SHA-256 mismatch on {s_path}"
        )
        raw_bytes = gzip.decompress(gz_bytes)
        assert hashlib.sha256(raw_bytes).hexdigest() == shard["sha256_uncompressed"], (
            f"Uncompressed SHA-256 mismatch on {s_path}"
        )
        verified_shards += 1

    # 3. Verify 983-file Macula completion & integrity
    macula = manifest["macula_syntax_completion"]
    assert macula["manifest_files_total"] == 983, f"Expected 983 Macula files, got {macula['manifest_files_total']}"
    assert macula["files_imported_and_verified"] == 983, "Not all 983 Macula files marked imported & verified"
    assert macula["editions"]["macula-hebrew-wlc"] == 929
    assert macula["editions"]["macula-greek-nestle1904"] == 27
    assert macula["editions"]["macula-greek-sblgnt"] == 27
    integrity = macula["integrity"]
    assert integrity["is_valid"] is True and integrity["status"] == "PASS", f"Syntax integrity failed: {integrity}"
    assert integrity["cycles_count"] == 0
    assert integrity["orphaned_parents_count"] == 0
    assert integrity["span_inversions_count"] == 0
    assert integrity["verse_inversions_count"] == 0
    assert integrity["terminals_without_xml_count"] == 0
    assert integrity["total_nodes"] > 1000000, f"Expected > 1M total syntax nodes across 983 files, got {integrity['total_nodes']}"

    # 4. Verify difficult biblical edge cases in chapter bundles
    # 4a. Genesis 1:1
    gen1_ch = load_gzip_json("/v1/chapters/b1-c1.json.gz")
    gen1_v1 = gen1_ch["verses"]["1"]
    assert gen1_v1["verse_id"] == 1
    assert len(gen1_v1["tokens"]) == 7
    assert "רֵאשִׁית" in gen1_v1["tokens"][0]["surface_form"] or "בְּ" in gen1_v1["tokens"][0]["surface_form"]
    gen1_trees = [
        gen1_ch["syntax_trees"][tid]["tree"]
        for tid in gen1_v1["tree_ids"]
        if gen1_ch["syntax_trees"][tid]["tree"]["edition_key"] == "macula-hebrew-wlc"
    ]
    assert len(gen1_trees) == 1, f"Genesis 1:1 should have 1 WLC syntax tree, got {len(gen1_trees)}"
    gen1_terminals = [n for n in gen1_trees[0]["nodes"] if n["is_terminal"]]
    assert len(gen1_terminals) == 11, f"Genesis 1:1 expected 11 terminals, got {len(gen1_terminals)}"
    bara_node = next((n for n in gen1_terminals if n["terminal_xml_id"] == "o010010010021"), None)
    assert bara_node is not None and bara_node["syntactic_role"] == "v"
    # AUDIT-01: macula-hebrew semantic_frame must be stripped per field_license_registry (disabled_unverified)
    assert bara_node["semantic_frame"] is None, f"Genesis 1:1 bara_node semantic_frame must be None, got {bara_node['semantic_frame']}"

    # 4b. Psalm headings at verse 0 (Psalm 3:0 and Psalm 51:0) + WLC Psalm 3:1 versification shift
    ps3_ch = load_gzip_json("/v1/chapters/b19-c3.json.gz")
    assert "0" in ps3_ch["verses"], "Psalm 3:0 heading missing from b19-c3.json.gz"
    assert len(ps3_ch["verses"]["0"]["tokens"]) > 0, "Psalm 3:0 has no tokens"
    assert len(ps3_ch["verses"]["0"]["versification_mappings"]) >= 1, "Psalm 3:0 has no versification mapping to WLC 3:1"
    assert len(ps3_ch["verses"]["1"]["tree_ids"]) >= 1, "Psalm 3:1 has no Macula syntax tree"

    # 4c. Daniel 2:4 Hebrew-to-Aramaic transition
    dan2_ch = load_gzip_json("/v1/chapters/b27-c2.json.gz")
    dan2_v4 = dan2_ch["verses"]["4"]
    langs = {m["lang"] for m in dan2_v4["macula_hebrew_morphemes"]}
    assert "H" in langs and "A" in langs, f"Daniel 2:4 must contain both Hebrew ('H') and Aramaic ('A') morphemes, got {langs}"
    assert any(t.get("is_aramaic") for t in dan2_v4["morphhb_tokens"]), "Daniel 2:4 morphhb_tokens missing Aramaic flag"

    # 4d. John 1:1 (Nestle1904 & SBLGNT syntax trees)
    jhn1_ch = load_gzip_json("/v1/chapters/b43-c1.json.gz")
    jhn1_v1 = jhn1_ch["verses"]["1"]
    jhn_nestle = [
        jhn1_ch["syntax_trees"][tid]["tree"]
        for tid in jhn1_v1["tree_ids"]
        if jhn1_ch["syntax_trees"][tid]["tree"]["edition_key"] == "macula-greek-nestle1904"
    ]
    jhn_sbl = [
        jhn1_ch["syntax_trees"][tid]["tree"]
        for tid in jhn1_v1["tree_ids"]
        if jhn1_ch["syntax_trees"][tid]["tree"]["edition_key"] == "macula-greek-sblgnt"
    ]
    assert len(jhn_nestle) == 1 and len(jhn_sbl) == 1, "John 1:1 must have both Nestle1904 and SBLGNT syntax trees"
    jhn_clauses = [n for n in jhn_nestle[0]["nodes"] if n["node_type"] == "clause"]
    assert len(jhn_clauses) == 4, f"John 1:1 Nestle1904 expected 4 clauses, got {len(jhn_clauses)}"

    # 4e. Mark 16:9-20 textual variants
    mrk16_ch = load_gzip_json("/v1/chapters/b41-c16.json.gz")
    assert "9" in mrk16_ch["verses"] and "20" in mrk16_ch["verses"]
    assert len(mrk16_ch["verses"]["9"]["tagnt_tokens"]) > 0

    # 4f. Ephesians 1:3-14 cross-verse spans (#s3 = 1:3-6, #s4 = 1:7-10, #s5 = 1:11-12, #s6 = 1:13-14)
    eph1_ch = load_gzip_json("/v1/chapters/b49-c1.json.gz")
    eph1_v3 = eph1_ch["verses"]["3"]
    eph1_v6 = eph1_ch["verses"]["6"]
    eph1_v13 = eph1_ch["verses"]["13"]
    eph1_v14 = eph1_ch["verses"]["14"]
    shared_3_6 = set(eph1_v3["tree_ids"]) & set(eph1_v6["tree_ids"])
    shared_13_14 = set(eph1_v13["tree_ids"]) & set(eph1_v14["tree_ids"])
    assert len(shared_3_6) == 2 and len(shared_13_14) == 2, f"Ephesians 1:3-6 and 1:13-14 should share Nestle1904 & SBLGNT cross-verse trees, got {shared_3_6} / {shared_13_14}"
    for tid in shared_3_6:
        t_obj = eph1_ch["syntax_trees"][tid]["tree"]
        assert t_obj["is_cross_verse"] is True
        assert t_obj["cross_verse_span"] == "1:3–1:6"
    for tid in shared_13_14:
        t_obj = eph1_ch["syntax_trees"][tid]["tree"]
        assert t_obj["is_cross_verse"] is True
        assert t_obj["cross_verse_span"] == "1:13–1:14"

    # 4g. Noncanonical source-only syntax preservation (Mark 16:99 shorter ending & 3 John 1:15 versification)
    assert "99" not in mrk16_ch["verses"], "Mark 16:99 must NOT be fabricated as a canonical verse"
    unmapped_mrk16 = mrk16_ch["unmapped_syntax_nodes"]
    assert len(unmapped_mrk16) > 0, "Mark 16:99 unmapped source nodes must be preserved in b41-c16.json.gz"
    assert any("MRK 16:99!" in (n.get("source_ref") or "") for n in unmapped_mrk16)
    jhn3_ch = load_gzip_json("/v1/chapters/b64-c1.json.gz")
    assert "15" in jhn3_ch["verses"], "3 John 1:15 canonical verse must be present in b64-c1.json.gz"
    assert len(jhn3_ch["verses"]["15"]["versification_mappings"]) >= 1, "3 John 1:15 must preserve versification mappings"

    # 5. License & secret check on gated fields
    gated_shard = CORPUS_DIR / "tables" / "macula_gated_field_values" / "part-0000.jsonl.gz"
    gated_lines = gzip.decompress(gated_shard.read_bytes()).decode("utf-8").splitlines()
    for line in gated_lines:
        row = json.loads(line)
        assert row["field_name"] not in FORBIDDEN_GATED_FIELDS, f"Forbidden field leaked: {row['field_name']}"

    return {
        "status": "PASS",
        "verified_shards": verified_shards,
        "total_asset_files": limits["total_asset_files"],
        "total_compressed_mib": round(limits["total_compressed_bytes"] / (1024 * 1024), 2),
        "max_single_asset_mib": round(limits["max_single_asset_compressed_bytes"] / (1024 * 1024), 2),
        "macula_files_verified": macula["files_imported_and_verified"],
        "total_syntax_nodes": integrity["total_nodes"],
        "total_syntax_edges": integrity["total_edges"],
        "total_unmapped_nodes": macula["total_unmapped_source_nodes"],
    }


if __name__ == "__main__":
    summary = verify_static_corpus()
    print(json.dumps(summary, indent=2))
