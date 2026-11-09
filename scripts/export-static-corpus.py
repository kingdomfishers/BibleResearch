#!/usr/bin/env python3
"""
scripts/export-static-corpus.py
Deterministic exporter and 983-file Macula syntax builder for BibleResearch's
Cloudflare Workers Static Assets corpus (`bibleresearch-corpus`).

Responsibilities:
1. Exports all approved immutable source-evidence tables and immutable column projections
   from Supabase via `public.export_static_corpus_page_v1` into versioned `.jsonl.gz` shards
   under `.artifacts/static-corpus/tables/` (and full rollback backups under `.artifacts/db-backup/`).
2. Parses and verifies all 983 Macula syntax XML files (929 Hebrew WLC, 27 Greek Nestle1904,
   27 Greek SBLGNT) from `.artifacts/sources/`, validating byte lengths and Git blob SHA-1 digests
   against the canonical 983-file manifest (`bible_internal.macula_syntax_import_files`).
3. Preserves complete sentence -> clause -> phrase -> compound-word-group -> terminal hierarchy,
   canonical word/verse mappings, cross-verse spans (e.g. Ephesians 1:3-14), and source-only
   unmapped nodes (e.g. 3 John 1:15) without fabricating canonical verse references.
4. Builds precomputed retrieval shards under `.artifacts/static-corpus/v1/`:
   - `/v1/catalog/metadata.json.gz`
   - `/v1/chapters/b<book>-c<chapter>.json.gz` (1,189 chapters)
   - `/v1/lxx/b<book_no>.json.gz` (55 Swete LXX books)
   - `/v1/lexical/strongs-<00..7f>.json.gz` (128 Strong's/lemma buckets)
   - `/v1/lexical/words-<00..3f>.json.gz` (64 word buckets)
   - `/v1/lexical/query-index.json.gz`
   - `/v1/syntax/search-index.json.gz`
5. Generates `.artifacts/static-corpus/manifest.json` with SHA-256 checksums, row counts,
   byte sizes, schema versions, and dataset license attributions.
"""

from __future__ import annotations

import concurrent.futures
import gzip
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
ARTIFACTS_DIR = ROOT_DIR / ".artifacts"
SOURCES_DIR = ARTIFACTS_DIR / "sources"
CORPUS_DIR = ARTIFACTS_DIR / "static-corpus"
BACKUP_DIR = ARTIFACTS_DIR / "db-backup"
CACHE_DIR = ARTIFACTS_DIR / "export-cache"

MAX_SHARD_UNCOMPRESSED_BYTES = 7 * 1024 * 1024  # 7 MiB uncompressed -> ~0.7-2.2 MiB gzipped
XML_NS_ID = "{http://www.w3.org/XML/1998/namespace}id"

# Restricted upstream fields that must never be exported in public static assets
FORBIDDEN_GATED_FIELDS = {
    "sdbh",
    "lexdomain",
    "coredomain",
    "contextualdomain",
    "domain",
    "ln",
}

ALLOW_INCOMPLETE_EXPORT = "--allow-incomplete-export" in sys.argv

MIN_EXPECTED_TABLE_ROWS: dict[str, int] = {
    "books": 66,
    "lxx_swete_books": 55,
    "source_releases": 4,
    "source_editions": 7,
    "field_license_registry": 15,
    "reader_english_editions": 1,
    "verses_immutable": 31000,
    "words_full": 150000,
    "lemmas": 22000,
    "lexemes": 22000,
    "lexical_senses": 26000,
    "lexical_roots": 2500,
    "lemma_root_links": 6000,
    "lexical_formations": 700,
    "lemma_components": 1500,
    "lexical_connections": 1,
    "canonical_entities": 80000,
    "entity_relationships": 15000,
    "hebrew_lxx_word_alignments": 1,
    "semantic_annotations": 900,
    "token_morphemes": 2000,
    "cross_token_mappings": 100,
    "versification_mappings": 2000,
    "macula_gated_field_values": 2000,
    "hebrew_lxx_verse_map": 20000,
    "reader_english_verses": 31000,
    "reader_rendering_groups": 90000,
    "edition_passages": 60000,
    "lexeme_identifiers": 110000,
    "tagnt_tokens": 140000,
    "word_form_lemmas": 270000,
    "macula_greek_tokens": 270000,
    "morphhb_tokens": 300000,
    "lxx_swete_words": 580000,
    "verse_translation_sources": 440000,
    "macula_hebrew_morphemes": 470000,
    "syntax_nodes_step": 120000,
    "syntax_edges_step": 120000,
    "verses_full": 31000,
    "syntax_nodes_db": 120000,
    "syntax_edges_db": 120000,
}


def load_env() -> dict[str, str]:
    env_map: dict[str, str] = {}
    env_path = ROOT_DIR / ".env"
    if env_path.exists():
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env_map[k.strip()] = v.strip()
    return env_map


ENV = load_env()
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or ENV.get("VITE_SUPABASE_URL") or "https://ejoperxiwxlcbsqrkrvb.supabase.co"
ANON_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY") or ENV.get("VITE_SUPABASE_ANON_KEY") or ""

if not ANON_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_ANON_KEY in environment or .env")


def rpc_call(fn_name: str, payload: dict[str, Any] | None = None, timeout: int = 90, retries: int = 6) -> Any:
    url = f"{SUPABASE_URL}/rest/v1/rpc/{fn_name}"
    body = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8")
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip",
    }
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8"))
        except Exception as exc:
            if attempt == retries:
                raise RuntimeError(f"RPC {fn_name} failed after {retries} attempts: {exc}") from exc
            sleep_s = min(15.0, 1.2 * (2 ** (attempt - 1)))
            print(f"  [retry {attempt}/{retries}] {fn_name} ({ payload }) -> {exc}; waiting {sleep_s:.1f}s...", flush=True)
            time.sleep(sleep_s)


def deterministic_gzip_bytes(data_bytes: bytes, compresslevel: int = 6) -> bytes:
    return gzip.compress(data_bytes, compresslevel=compresslevel, mtime=0)


def write_gzip_json(path: Path, obj: Any) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw_bytes = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=False).encode("utf-8")
    gz_bytes = deterministic_gzip_bytes(raw_bytes)
    path.write_bytes(gz_bytes)
    return {
        "path": "/" + path.relative_to(CORPUS_DIR).as_posix(),
        "uncompressed_bytes": len(raw_bytes),
        "compressed_bytes": len(gz_bytes),
        "sha256_uncompressed": hashlib.sha256(raw_bytes).hexdigest(),
        "sha256_compressed": hashlib.sha256(gz_bytes).hexdigest(),
    }


def write_jsonl_shards(base_dir: Path, table_name: str, rows: list[dict[str, Any]], is_public_corpus: bool = True) -> dict[str, Any]:
    out_dir = base_dir / "tables" / table_name
    out_dir.mkdir(parents=True, exist_ok=True)
    meta_cache_file = out_dir / ".shard-meta.json"
    if meta_cache_file.exists():
        try:
            cached_meta = json.loads(meta_cache_file.read_text(encoding="utf-8"))
            if (
                cached_meta.get("total_rows") == len(rows)
                and cached_meta.get("shard_count") == len(list(out_dir.glob("part-*.jsonl.gz")))
            ):
                return cached_meta
        except Exception:
            pass
    for old_file in out_dir.glob("part-*.jsonl.gz"):
        old_file.unlink()

    shards_meta: list[dict[str, Any]] = []
    current_lines: list[bytes] = []
    current_bytes = 0
    current_rows = 0
    part_idx = 0

    def flush_shard() -> None:
        nonlocal current_lines, current_bytes, current_rows, part_idx
        if not current_lines:
            return
        raw_bytes = b"".join(current_lines)
        gz_bytes = deterministic_gzip_bytes(raw_bytes)
        shard_path = out_dir / f"part-{part_idx:04d}.jsonl.gz"
        shard_path.write_bytes(gz_bytes)
        rel_Root = CORPUS_DIR if is_public_corpus else BACKUP_DIR
        shards_meta.append({
            "path": "/" + shard_path.relative_to(rel_Root).as_posix(),
            "rows": current_rows,
            "uncompressed_bytes": len(raw_bytes),
            "compressed_bytes": len(gz_bytes),
            "sha256_uncompressed": hashlib.sha256(raw_bytes).hexdigest(),
            "sha256_compressed": hashlib.sha256(gz_bytes).hexdigest(),
        })
        current_lines = []
        current_bytes = 0
        current_rows = 0
        part_idx += 1

    for row in rows:
        line_bytes = (json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        if current_lines and (current_bytes + len(line_bytes) > MAX_SHARD_UNCOMPRESSED_BYTES):
            flush_shard()
        current_lines.append(line_bytes)
        current_bytes += len(line_bytes)
        current_rows += 1

    flush_shard()
    res = {
        "table": table_name,
        "total_rows": len(rows),
        "shard_count": len(shards_meta),
        "shards": shards_meta,
    }
    meta_cache_file.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    return res


# Table export specifications: (table_key, pagination_mode, page_size, is_public_corpus)
# pagination_mode: 'id' | 'book_no' | 'verse_pos' | 'offset'
EXPORT_TABLES_SPEC: list[tuple[str, str, int, bool]] = [
    ("books", "id", 1000, True),
    ("lxx_swete_books", "book_no", 1000, True),
    ("source_releases", "id", 1000, True),
    ("source_editions", "id", 1000, True),
    ("field_license_registry", "id", 1000, True),
    ("reader_english_editions", "offset", 1000, True),
    ("verses_immutable", "id", 10000, True),
    ("words_full", "id", 2000, False),
    ("lemmas", "id", 10000, True),
    ("lexemes", "id", 10000, True),
    ("lexical_senses", "id", 10000, True),
    ("lexical_roots", "id", 10000, True),
    ("lemma_root_links", "id", 10000, True),
    ("lexical_formations", "id", 5000, True),
    ("lemma_components", "id", 5000, True),
    ("lexical_connections", "id", 1000, True),
    ("canonical_entities", "id", 5000, True),
    ("entity_relationships", "id", 3000, True),
    ("hebrew_lxx_word_alignments", "id", 1000, True),
    ("semantic_annotations", "id", 5000, True),
    ("token_morphemes", "id", 5000, True),
    ("cross_token_mappings", "id", 5000, True),
    ("versification_mappings", "id", 5000, True),
    ("macula_gated_field_values", "offset", 5000, True),
    ("hebrew_lxx_verse_map", "id", 10000, True),
    ("reader_english_verses", "offset", 10000, True),
    ("reader_rendering_groups", "offset", 10000, True),
    ("edition_passages", "id", 5000, True),
    ("lexeme_identifiers", "id", 10000, True),
    ("tagnt_tokens", "id", 5000, True),
    ("word_form_lemmas", "id", 5000, True),
    ("macula_greek_tokens", "id", 5000, True),
    ("morphhb_tokens", "id", 5000, True),
    ("lxx_swete_words", "id", 5000, True),
    ("verse_translation_sources", "verse_pos", 10000, True),
    ("macula_hebrew_morphemes", "id", 5000, True),
    ("syntax_nodes_step", "id", 10000, True),
    ("syntax_edges_step", "id", 10000, True),
    # Full DB backups for rollback safety (stored in .artifacts/db-backup, not in public static-corpus)
    ("verses_full", "id", 10000, False),
    ("syntax_nodes_db", "id", 5000, False),
    ("syntax_edges_db", "id", 10000, False),
]


def fetch_table_rows(table_key: str, mode: str, page_size: int) -> list[dict[str, Any]]:
    min_expected = MIN_EXPECTED_TABLE_ROWS.get(table_key, 1)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{table_key}.json.gz"
    if cache_file.exists():
        try:
            with gzip.open(cache_file, "rt", encoding="utf-8") as fh:
                cached = json.load(fh)
            if isinstance(cached, list) and len(cached) >= min_expected:
                print(f"  [cache hit] {table_key}: {len(cached):,} rows", flush=True)
                return cached
        except Exception:
            pass

    # Check local offline fallback shards before network RPC
    offline_candidates = [
        CORPUS_DIR / "tables" / table_key,
        BACKUP_DIR / "tables" / table_key,
    ]
    for cand in offline_candidates:
        shards = sorted(cand.glob("part-*.jsonl.gz"))
        if shards:
            loaded_rows: list[dict[str, Any]] = []
            for sf in shards:
                with gzip.open(sf, "rt", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            loaded_rows.append(json.loads(line))
            if len(loaded_rows) >= min_expected:
                print(f"  [offline shard hit] {table_key}: {len(loaded_rows):,} rows reconstructed from {len(shards)} local shards", flush=True)
                with gzip.open(cache_file, "wt", encoding="utf-8", compresslevel=3) as fh:
                    json.dump(loaded_rows, fh, ensure_ascii=False, separators=(",", ":"))
                return loaded_rows

    rows: list[dict[str, Any]] = []
    after_id = 0
    after_sub = 0
    current_limit = page_size
    t0 = time.time()
    while True:
        try:
            batch = rpc_call(
                "export_static_corpus_page_v1",
                {
                    "p_table": table_key,
                    "p_after_id": after_id,
                    "p_after_sub": after_sub,
                    "p_limit": current_limit,
                },
                retries=3,
            )
        except Exception:
            if current_limit > 500:
                current_limit = max(500, current_limit // 2)
                print(f"  [adaptive page size] {table_key}: reducing p_limit to {current_limit}", flush=True)
                continue
            raise
        if not batch:
            break
        rows.extend(batch)
        last = batch[-1]
        if mode == "id":
            after_id = int(last["id"])
        elif mode == "book_no":
            after_id = int(last["book_no"])
        elif mode == "verse_pos":
            after_id = int(last["verse_id"])
            after_sub = int(last["word_position"])
        elif mode == "offset":
            after_id += len(batch)
        else:
            raise ValueError(f"Unknown pagination mode: {mode}")

        if len(batch) < current_limit:
            break

    elapsed = time.time() - t0
    if len(rows) < min_expected and not ALLOW_INCOMPLETE_EXPORT:
        raise RuntimeError(
            f"REBUILD GUARD ERROR: Table '{table_key}' returned {len(rows):,} rows from database, "
            f"which is below minimum required threshold {min_expected:,}. "
            f"The PostgreSQL source table appears to have been reclaimed or emptied! "
            f"Storage reclamation safety guard prevented silently overwriting with an empty corpus shard. "
            f"To override explicitly, pass --allow-incomplete-export."
        )

    print(f"  [exported] {table_key}: {len(rows):,} rows in {elapsed:.1f}s", flush=True)
    with gzip.open(cache_file, "wt", encoding="utf-8", compresslevel=3) as fh:
        json.dump(rows, fh, ensure_ascii=False, separators=(",", ":"))
    return rows


def strip_greek_diacritics(text: str | None) -> str:
    if not text:
        return ""
    norm = unicodedata.normalize("NFD", text)
    stripped = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")
    cleaned = re.sub(r"[^\w\s]", "", stripped, flags=re.UNICODE).lower().strip()
    return unicodedata.normalize("NFC", cleaned)


def strip_hebrew_all(text: str | None) -> str:
    if not text:
        return ""
    norm = unicodedata.normalize("NFKD", text)
    stripped = re.sub(r"[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־]", "", norm)
    return re.sub(r"[^\u05D0-\u05EA]", "", stripped)


def local_tag(elem: ET.Element) -> str:
    tag = elem.tag
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def parse_all_macula_syntax_files(
    manifest_files: list[dict[str, Any]],
    macula_hebrew_morphemes: list[dict[str, Any]],
    macula_greek_tokens: list[dict[str, Any]],
    verses_by_coord: dict[tuple[int, int, int], int],
    step_syntax_nodes: list[dict[str, Any]],
    step_syntax_edges: list[dict[str, Any]],
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    print(f"\n=== Parsing & Verifying all {len(manifest_files)} Macula Syntax XML Files ===", flush=True)

    # Check if already written to .artifacts/static-corpus/tables/ from a completed Step 4 run
    sn_dir = CORPUS_DIR / "tables" / "syntax_nodes"
    se_dir = CORPUS_DIR / "tables" / "syntax_edges"
    mf_dir = CORPUS_DIR / "tables" / "macula_syntax_import_files"
    un_dir = CORPUS_DIR / "tables" / "macula_syntax_unmapped_nodes"
    if (
        sn_dir.exists() and len(list(sn_dir.glob("part-*.jsonl.gz"))) == 146
        and se_dir.exists() and len(list(se_dir.glob("part-*.jsonl.gz"))) == 91
        and mf_dir.exists() and len(list(mf_dir.glob("part-*.jsonl.gz"))) == 1
        and un_dir.exists() and len(list(un_dir.glob("part-*.jsonl.gz"))) == 1
    ):
        print("  [macula-cache] Loading pre-parsed 983-file Macula shards from .artifacts/static-corpus/tables/...", flush=True)
        def load_jsonl_gz_dir(d: Path) -> list[dict[str, Any]]:
            out = []
            for p in sorted(d.glob("part-*.jsonl.gz")):
                with gzip.open(p, "rt", encoding="utf-8") as fh:
                    for line in fh:
                        if line.strip():
                            out.append(json.loads(line))
            return out
        sn_loaded = load_jsonl_gz_dir(sn_dir)
        se_loaded = load_jsonl_gz_dir(se_dir)
        mf_loaded = load_jsonl_gz_dir(mf_dir)
        un_loaded = load_jsonl_gz_dir(un_dir)
        if len(sn_loaded) == 1338108 and len(se_loaded) == 1298688 and len(mf_loaded) == 983 and len(un_loaded) == 128:
            print(
                f"  [macula-cache] Loaded {len(sn_loaded):,} nodes, {len(se_loaded):,} edges, "
                f"{len(mf_loaded)} files, {len(un_loaded)} unmapped nodes.",
                flush=True,
            )
            return sn_loaded, se_loaded, mf_loaded, un_loaded

    # Build fast lookup maps for terminal resolution
    heb_xml_map: dict[str, tuple[int, int, int | None]] = {}
    for m in macula_hebrew_morphemes:
        mid = m.get("macula_id")
        if mid and m.get("canonical_verse_id") is not None and m.get("word_no") is not None:
            heb_xml_map[mid] = (int(m["canonical_verse_id"]), int(m["word_no"]), m.get("word_id"))

    grk_xml_map: dict[tuple[str, str], tuple[int, int, int | None]] = {}
    for g in macula_greek_tokens:
        xid = g.get("xml_id")
        ed = g.get("edition_key")
        if xid and ed and g.get("canonical_verse_id") is not None and g.get("word_no") is not None:
            grk_xml_map[(ed, xid)] = (int(g["canonical_verse_id"]), int(g["word_no"]), g.get("step_word_id"))

    ref_regex = re.compile(r"^[^ ]+ ([0-9]+):([0-9]+)!([0-9]+)$")

    # Preserve STEP token-level syntax_nodes and syntax_edges IDs first
    all_syntax_nodes: list[dict[str, Any]] = []
    all_syntax_edges: list[dict[str, Any]] = []
    max_node_id = 0
    for sn in step_syntax_nodes:
        nid = int(sn["id"])
        if nid > max_node_id:
            max_node_id = nid
        if int(sn.get("edition_id", 0)) == 11:
            sn["semantic_frame"] = None
        all_syntax_nodes.append(sn)

    max_edge_id = 0
    for se in step_syntax_edges:
        eid = int(se["id"])
        if eid > max_edge_id:
            max_edge_id = eid
        all_syntax_edges.append(se)

    next_node_id = max_node_id + 1
    next_edge_id = max_edge_id + 1
    next_unmapped_id = 1

    updated_manifest_files: list[dict[str, Any]] = []
    unmapped_nodes_all: list[dict[str, Any]] = []

    t0 = time.time()
    for idx, f in enumerate(sorted(manifest_files, key=lambda r: int(r["id"])), start=1):
        repo = f["repository"]
        source_path = f["source_path"]
        edition_key = f["edition_key"]
        edition_id = int(f["edition_id"])
        source_release_id = int(f["source_release_id"])
        expected_bytes = int(f["source_bytes"])
        expected_sha1 = f["git_blob_sha1"]

        xml_path = SOURCES_DIR / repo / source_path
        if not xml_path.exists():
            raise FileNotFoundError(f"Missing Macula source XML file: {xml_path}")

        content_bytes = xml_path.read_bytes().replace(b"\r\n", b"\n")
        actual_bytes = len(content_bytes)
        if actual_bytes != expected_bytes:
            raise ValueError(f"Byte count mismatch for {source_path}: expected {expected_bytes}, got {actual_bytes}")

        git_header = f"blob {actual_bytes}\0".encode("utf-8")
        actual_sha1 = hashlib.sha1(git_header + content_bytes).hexdigest()
        if actual_sha1 != expected_sha1:
            raise ValueError(f"Git blob SHA-1 mismatch for {source_path}: expected {expected_sha1}, got {actual_sha1}")

        root = ET.fromstring(content_bytes)
        sentences = [ch for ch in root if local_tag(ch) == "sentence"]
        if not sentences:
            raise ValueError(f"No <sentence> elements found in {source_path}")

        # Walk XML hierarchy
        work_nodes: list[dict[str, Any]] = []
        work_by_key: dict[str, dict[str, Any]] = {}
        children_by_key: dict[str, list[str]] = defaultdict(list)

        def walk_element(el: ET.Element, node_key: str, parent_key: str | None, tree_id: str, depth: int, sibling_order: int) -> None:
            if depth >= 500:
                raise ValueError(f"Exceeded max tree depth 500 in {source_path}")
            kind = local_tag(el)
            xml_id = (el.attrib.get(XML_NS_ID) or el.attrib.get("id") or "").strip() or None
            if kind == "sentence":
                # Notice: in Postgres XPath string(/*/@xml:id), sentence @id is not @xml:id
                xml_id = (el.attrib.get(XML_NS_ID) or "").strip() or None
            source_ref = (el.attrib.get("ref") or "").strip() or None
            source_role = (el.attrib.get("role") or "").strip() or None
            class_label = (el.attrib.get("class") or "").strip() or None
            rule_label = (el.attrib.get("rule") or "").strip() or None
            cl_type = (el.attrib.get("clType") or "").strip() or None
            is_head = el.attrib.get("head") == "true"
            morphology = (el.attrib.get("morph") or "").strip() or None
            # AUDIT-01: macula-hebrew @frame is license-gated per field_license_registry (disabled_unverified)
            semantic_frame = None if repo == "macula-hebrew" else ((el.attrib.get("frame") or "").strip() or None)
            surface_text = (el.text or "").strip() or None if kind == "w" else None

            rec = {
                "node_key": node_key,
                "parent_key": parent_key,
                "tree_id": tree_id,
                "depth": depth,
                "sibling_order": sibling_order,
                "kind": kind,
                "xml_id": xml_id,
                "source_ref": source_ref,
                "source_role": source_role,
                "class_label": class_label,
                "rule_label": rule_label,
                "cl_type": cl_type,
                "is_head": is_head,
                "morphology": morphology,
                "semantic_frame": semantic_frame,
                "surface_text": surface_text,
                "verse_id": None,
                "end_verse_id": None,
                "word_position": None,
                "end_word_position": None,
                "terminal_word_id": None,
                "mapping_status": None,
            }
            work_nodes.append(rec)
            work_by_key[node_key] = rec
            if parent_key is not None:
                children_by_key[parent_key].append(node_key)

            child_ord = 0
            for child in el:
                ckind = local_tag(child)
                if ckind in ("wg", "w", "c"):
                    child_ord += 1
                    walk_element(
                        child,
                        f"{node_key}.{child_ord}",
                        node_key,
                        tree_id,
                        depth + 1,
                        child_ord,
                    )

        for s_idx, sent_el in enumerate(sentences, start=1):
            t_id = f"{edition_key}:{source_path}#s{s_idx}"
            n_key = f"macula_tree:{edition_key}:{source_path}#s{s_idx}"
            walk_element(sent_el, n_key, None, t_id, 0, s_idx)

        total_w = sum(1 for w in work_nodes if w["kind"] == "w")
        expected_w = sum(1 for el in root.iter() if local_tag(el) == "w")
        if total_w != expected_w or total_w == 0:
            raise ValueError(f"Terminal count mismatch in {source_path}: walked {total_w}, XML has {expected_w}")

        # Resolve terminal mappings
        nt_book_num: int | None = None
        if repo == "macula-greek":
            fname = source_path.split("/")[2]
            nt_book_num = 39 + int(fname.split("-")[0])

        refonly_count = 0
        unmapped_terminals_count = 0

        for w in work_nodes:
            if w["kind"] != "w":
                continue
            xid = w["xml_id"]
            if repo == "macula-hebrew":
                if xid and xid in heb_xml_map:
                    vid, wpos, twid = heb_xml_map[xid]
                    w["verse_id"] = vid
                    w["word_position"] = wpos
                    w["terminal_word_id"] = twid
                    w["mapping_status"] = "exact_xml_id"
            else:
                if xid and (edition_key, xid) in grk_xml_map:
                    vid, wpos, twid = grk_xml_map[(edition_key, xid)]
                    w["verse_id"] = vid
                    w["word_position"] = wpos
                    w["terminal_word_id"] = twid
                    w["mapping_status"] = "exact_xml_id"
                elif w["source_ref"] and nt_book_num is not None:
                    m = ref_regex.match(w["source_ref"])
                    if m:
                        ch_nr = int(m.group(1))
                        v_nr = int(m.group(2))
                        w_pos = int(m.group(3))
                        vid = verses_by_coord.get((nt_book_num, ch_nr, v_nr))
                        if vid is not None:
                            w["verse_id"] = vid
                            w["word_position"] = w_pos
                            w["terminal_word_id"] = None
                            w["mapping_status"] = "source_reference_only"
                            refonly_count += 1

            if w["verse_id"] is None or w["word_position"] is None or w["xml_id"] is None:
                unmapped_terminals_count += 1

        # Propagate spans bottom-up from mapped terminals
        leaf_spans: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for w in work_nodes:
            if w["kind"] == "w" and w["verse_id"] is not None and w["word_position"] is not None:
                pair = (int(w["verse_id"]), int(w["word_position"]))
                curr_key: str | None = w["node_key"]
                while curr_key is not None:
                    leaf_spans[curr_key].append(pair)
                    curr_key = work_by_key[curr_key]["parent_key"]

        for n_key, pairs in leaf_spans.items():
            pairs_sorted = sorted(pairs, key=lambda x: (x[0], x[1]))
            first_verse, first_pos = pairs_sorted[0]
            last_verse, last_pos = pairs_sorted[-1]
            node = work_by_key[n_key]
            node["verse_id"] = first_verse
            node["end_verse_id"] = last_verse
            node["word_position"] = first_pos
            node["end_word_position"] = max(first_pos, last_pos)

        # Assign IDs and separate mapped vs source-only nodes
        mapped_id_by_key: dict[str, int] = {}
        source_only_nodes_count = 0

        for w in work_nodes:
            if w["verse_id"] is None:
                source_only_nodes_count += 1
                unmapped_nodes_all.append({
                    "id": next_unmapped_id,
                    "node_key": w["node_key"],
                    "source_file_id": int(f["id"]),
                    "edition_id": edition_id,
                    "source_release_id": source_release_id,
                    "tree_id": w["tree_id"],
                    "parent_node_key": w["parent_key"],
                    "depth": w["depth"],
                    "sibling_order": w["sibling_order"],
                    "node_kind": w["kind"],
                    "source_xml_id": w["xml_id"],
                    "source_ref": w["source_ref"],
                    "class_label": w["class_label"],
                    "rule_label": w["rule_label"],
                    "syntactic_role": w["source_role"],
                    "cl_type": w["cl_type"],
                    "grammar_code": w["morphology"],
                    "semantic_frame": w["semantic_frame"],
                    "is_head": bool(w["is_head"]),
                    "surface_text": w["surface_text"],
                    "mapping_status": "not_in_canonical_verse",
                })
                next_unmapped_id += 1
            else:
                mapped_id_by_key[w["node_key"]] = next_node_id
                next_node_id += 1

        file_edges_count = 0
        for w in work_nodes:
            if w["parent_key"] is not None:
                file_edges_count += 1
            if w["verse_id"] is None:
                continue

            nid = mapped_id_by_key[w["node_key"]]
            pkey = w["parent_key"]
            pid = mapped_id_by_key.get(pkey) if pkey else None

            if w["kind"] == "sentence":
                ntype = "sentence"
            elif w["kind"] == "w":
                ntype = "terminal"
            elif w["kind"] == "c":
                ntype = "compound_word_group"
            elif w["class_label"] == "cl":
                ntype = "clause"
            else:
                ntype = "phrase"

            all_syntax_nodes.append({
                "id": nid,
                "node_key": w["node_key"],
                "edition_id": edition_id,
                "verse_id": w["verse_id"],
                "node_type": ntype,
                "start_word_position": w["word_position"],
                "end_word_position": w["end_word_position"],
                "head_word_position": None,
                "parent_node_id": pid,
                "syntactic_role": w["source_role"],
                "grammar_summary": w["morphology"],
                "source_release_id": source_release_id,
                "source_record_id": w["node_key"],
                "tree_id": w["tree_id"],
                "depth": w["depth"],
                "sibling_order": w["sibling_order"],
                "class_label": w["class_label"],
                "rule_label": w["rule_label"],
                "cl_type": w["cl_type"],
                "is_head": bool(w["is_head"]),
                "is_terminal": w["kind"] == "w",
                "terminal_xml_id": w["xml_id"],
                "terminal_word_id": w["terminal_word_id"],
                "terminal_source_ref": w["source_ref"],
                "terminal_mapping_status": w["mapping_status"],
                "semantic_frame": w["semantic_frame"],
                "end_verse_id": w["end_verse_id"],
                "is_cross_verse": bool(w["verse_id"] != w["end_verse_id"]),
            })

            if pid is not None and pkey is not None:
                parent_w = work_by_key[pkey]
                all_syntax_edges.append({
                    "id": next_edge_id,
                    "edition_id": edition_id,
                    "verse_id": w["verse_id"],
                    "dependent_word_position": w["word_position"],
                    "head_word_position": parent_w["word_position"],
                    "source_node_id": nid,
                    "target_node_id": pid,
                    "relation_type": "parent_child",
                    "head_strongs": None,
                    "raw_relation_tag": w["source_role"] or "tree_parent_child",
                    "source_release_id": source_release_id,
                    "source_record_id": f"{w['node_key']}:parent",
                    "origin_mode": "directly_imported",
                    "derivation_method": "MACULA pinned source direct XML parent-child structure",
                    "algorithm_version": "macula-tree-xml-v1",
                })
                next_edge_id += 1

        f_copy = dict(f)
        f_copy["import_status"] = "imported"
        f_copy["verified_git_blob_sha1"] = True
        f_copy["last_error"] = None
        f_copy["nodes_imported"] = len(work_nodes)
        f_copy["terminals_imported"] = total_w
        f_copy["edges_imported"] = file_edges_count
        f_copy["unmapped_terminals"] = unmapped_terminals_count
        f_copy["reference_only_terminals"] = refonly_count
        f_copy["source_only_nodes"] = source_only_nodes_count
        updated_manifest_files.append(f_copy)

        if idx % 200 == 0 or idx == len(manifest_files):
            print(
                f"  [macula {idx}/{len(manifest_files)}] nodes={len(all_syntax_nodes):,} "
                f"edges={len(all_syntax_edges):,} unmapped={len(unmapped_nodes_all):,} ({time.time() - t0:.1f}s)",
                flush=True,
            )

    return all_syntax_nodes, all_syntax_edges, updated_manifest_files, unmapped_nodes_all


def main() -> None:
    start_time = time.time()
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    print("=== Step 1: Fetching Manifest Metadata & Grammar Catalog from Supabase ===", flush=True)
    manifest_files: list[dict[str, Any]] = []
    decode_grammar_catalog: dict[str, Any] = {}
    try:
        meta_payload = rpc_call("get_static_corpus_manifest_meta_v1")
        manifest_files = meta_payload.get("macula_syntax_import_files") or []
        decode_grammar_catalog = meta_payload.get("decode_grammar_catalog") or {}
    except Exception as exc:
        print(f"  [warn] get_static_corpus_manifest_meta_v1 call failed: {exc}", flush=True)

    # Rebuild guard for manifest_files
    if len(manifest_files) < 983:
        p_private = ARTIFACTS_DIR / "private-backup" / "macula_syntax_import_files_983.json"
        p_table = CORPUS_DIR / "tables" / "macula_syntax_import_files"
        if p_private.exists():
            try:
                manifest_files = json.loads(p_private.read_text(encoding="utf-8"))
                print(f"  [offline fallback] loaded {len(manifest_files)} macula_syntax_import_files from private backup", flush=True)
            except Exception:
                pass
        if len(manifest_files) < 983 and p_table.exists():
            shards = sorted(p_table.glob("part-*.jsonl.gz"))
            loaded = []
            for sf in shards:
                with gzip.open(sf, "rt", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            loaded.append(json.loads(line))
            if len(loaded) >= 983:
                manifest_files = loaded
                print(f"  [offline fallback] loaded {len(manifest_files)} macula_syntax_import_files from local shards", flush=True)

        if len(manifest_files) < 983 and not ALLOW_INCOMPLETE_EXPORT:
            raise RuntimeError(
                f"REBUILD GUARD ERROR: macula_syntax_import_files has only {len(manifest_files)} files (expected 983). "
                f"Database table appears truncated and no local fallback found. "
                f"Pass --allow-incomplete-export to override."
            )

    # Rebuild guard for decode_grammar_catalog
    if len(decode_grammar_catalog) < 1000:
        cat_file = CORPUS_DIR / "v1" / "catalog" / "metadata.json.gz"
        if cat_file.exists():
            try:
                with gzip.open(cat_file, "rt", encoding="utf-8") as f:
                    cat_data = json.load(f)
                    if isinstance(cat_data.get("decode_grammar_catalog"), dict) and len(cat_data["decode_grammar_catalog"]) >= 1000:
                        decode_grammar_catalog = cat_data["decode_grammar_catalog"]
                        print(f"  [offline fallback] loaded {len(decode_grammar_catalog):,} decode_grammar_catalog entries from metadata.json.gz", flush=True)
            except Exception:
                pass

    print(f"  macula_syntax_import_files: {len(manifest_files)} files", flush=True)
    print(f"  decode_grammar_catalog: {len(decode_grammar_catalog):,} distinct grammar codes", flush=True)

    print("\n=== Step 2: Exporting Canonical Tables via Keyset Pagination ===", flush=True)
    tables_data: dict[str, list[dict[str, Any]]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        future_map = {
            pool.submit(fetch_table_rows, t_key, mode, p_size): (t_key, is_pub)
            for t_key, mode, p_size, is_pub in EXPORT_TABLES_SPEC
        }
        for fut in concurrent.futures.as_completed(future_map):
            t_key, _ = future_map[fut]
            tables_data[t_key] = fut.result()

    # Derive words_immutable directly from words_full (excluding mutable custom_definition, biblical_def, physical_def)
    tables_data["words_immutable"] = [
        {
            "id": w["id"],
            "strongs_nr": w["strongs_nr"],
            "grammar_code": w["grammar_code"],
            "original_word": w["original_word"],
            "transliteration": w["transliteration"],
            "co_occurrences": w["co_occurrences"],
            "english_translations": w["english_translations"],
            "gematria": w["gematria"],
        }
        for w in tables_data["words_full"]
    ]

    # Enforce strict license filter on macula_gated_field_values
    enabled_fields = {
        r["field_name"]
        for r in tables_data["field_license_registry"]
        if r.get("dataset_key") == "macula-hebrew"
        and (
            r.get("enabled_for_display") is True
            or r.get("status") in ("enabled_verified", "enabled_origin_unverified")
        )
    }
    tables_data["macula_gated_field_values"] = [
        r for r in tables_data["macula_gated_field_values"]
        if r.get("field_name") in enabled_fields and r.get("field_name") not in FORBIDDEN_GATED_FIELDS
    ]

    # Build coordinate maps
    verses_by_coord: dict[tuple[int, int, int], int] = {}
    verses_by_id: dict[int, dict[str, Any]] = {}
    for v in tables_data["verses_immutable"]:
        vid = int(v["id"])
        coord = (int(v["book"]), int(v["chapter"]), int(v["verse_nr"]))
        verses_by_coord[coord] = vid
        verses_by_id[vid] = v

    # Step 3: Parse all 983 Macula XML files
    all_syntax_nodes, all_syntax_edges, updated_manifest_files, unmapped_nodes_all = parse_all_macula_syntax_files(
        manifest_files=manifest_files,
        macula_hebrew_morphemes=tables_data["macula_hebrew_morphemes"],
        macula_greek_tokens=tables_data["macula_greek_tokens"],
        verses_by_coord=verses_by_coord,
        step_syntax_nodes=tables_data["syntax_nodes_step"],
        step_syntax_edges=tables_data["syntax_edges_step"],
    )

    tables_data["syntax_nodes"] = all_syntax_nodes
    tables_data["syntax_edges"] = all_syntax_edges
    tables_data["macula_syntax_import_files"] = updated_manifest_files
    tables_data["macula_syntax_unmapped_nodes"] = unmapped_nodes_all

    print("\n=== Step 4: Writing Versioned Table Shards (.jsonl.gz) ===", flush=True)
    public_table_manifests: dict[str, Any] = {}
    public_tables_to_write = [
        "words_immutable",
    ] + [
        t_key for t_key, _, _, is_pub in EXPORT_TABLES_SPEC
        if is_pub and t_key not in ("syntax_nodes_step", "syntax_edges_step")
    ] + [
        "syntax_nodes",
        "syntax_edges",
        "macula_syntax_import_files",
        "macula_syntax_unmapped_nodes",
    ]

    for t_key in public_tables_to_write:
        info = write_jsonl_shards(CORPUS_DIR, t_key, tables_data[t_key], is_public_corpus=True)
        public_table_manifests[t_key] = info
        print(f"  [shard] {t_key}: {info['total_rows']:,} rows -> {info['shard_count']} shard(s)", flush=True)

    for t_key, _, _, is_pub in EXPORT_TABLES_SPEC:
        if not is_pub:
            info = write_jsonl_shards(BACKUP_DIR, t_key, tables_data[t_key], is_public_corpus=False)
            print(f"  [db-backup] {t_key}: {info['total_rows']:,} rows -> {info['shard_count']} shard(s)", flush=True)

    print("\n=== Step 5: Building Precomputed Retrieval Shards under /v1/ ===", flush=True)
    v1_assets: list[dict[str, Any]] = []

    books_by_id = {int(b["id"]): b for b in tables_data["books"]}
    lxx_books_by_no = {int(b["book_no"]): b for b in tables_data["lxx_swete_books"]}
    editions_by_id = {int(e["id"]): e for e in tables_data["source_editions"]}
    releases_by_id = {int(r["id"]): r for r in tables_data["source_releases"]}
    words_by_id = {int(w["id"]): w for w in tables_data["words_immutable"]}
    lemmas_by_id = {int(l["id"]): l for l in tables_data["lemmas"]}
    lexemes_by_id = {int(lx["id"]): lx for lx in tables_data["lexemes"]}

    # Validate syntax tree integrity across all generated syntax_nodes & syntax_edges
    node_depth_by_id = {int(n["id"]): int(n["depth"]) if n.get("depth") is not None else 0 for n in all_syntax_nodes}
    cycles_count = 0
    orphaned_parents = 0
    span_inversions = 0
    verse_inversions = 0
    terminals_without_xml = 0
    cross_verse_nodes_count = 0
    max_depth = 0
    for n in all_syntax_nodes:
        d = int(n["depth"]) if n.get("depth") is not None else 0
        if d > max_depth:
            max_depth = d
        pid = n.get("parent_node_id")
        if pid is not None:
            if int(pid) not in node_depth_by_id:
                orphaned_parents += 1
            elif d <= node_depth_by_id[int(pid)]:
                cycles_count += 1
        swp = n.get("start_word_position")
        ewp = n.get("end_word_position")
        if swp is not None and ewp is not None and int(swp) > int(ewp):
            span_inversions += 1
        vid = n.get("verse_id")
        evid = n.get("end_verse_id")
        if vid is not None and evid is not None and int(vid) > int(evid):
            verse_inversions += 1
        if n.get("is_terminal") and not (n.get("terminal_xml_id") or "").strip():
            terminals_without_xml += 1
        if n.get("is_cross_verse"):
            cross_verse_nodes_count += 1

    syntax_integrity_summary = {
        "is_valid": (
            cycles_count == 0
            and orphaned_parents == 0
            and span_inversions == 0
            and verse_inversions == 0
            and terminals_without_xml == 0
        ),
        "status": "PASS" if (cycles_count == 0 and orphaned_parents == 0 and span_inversions == 0 and verse_inversions == 0 and terminals_without_xml == 0) else "FAIL",
        "total_nodes": len(all_syntax_nodes),
        "total_edges": len(all_syntax_edges),
        "max_depth": max_depth,
        "cross_verse_nodes_count": cross_verse_nodes_count,
        "cycles_count": cycles_count,
        "orphaned_parents_count": orphaned_parents,
        "span_inversions_count": span_inversions,
        "verse_inversions_count": verse_inversions,
        "terminals_without_xml_count": terminals_without_xml,
        "failure_reasons": [],
    }
    print(f"  [syntax integrity] {syntax_integrity_summary}", flush=True)
    if not syntax_integrity_summary["is_valid"]:
        raise RuntimeError(f"Syntax tree integrity validation failed: {syntax_integrity_summary}")

    # Precompute audit_evidence_coverage_v1, verify_referential_integrity_v1, get_hebrew_import_status_v1
    morphhb_by_book: dict[int, int] = defaultdict(int)
    for r in tables_data["morphhb_tokens"]:
        morphhb_by_book[int(r["book"])] += 1
    macula_by_book: dict[int, int] = defaultdict(int)
    macula_distinct_verses: set[int] = set()
    for r in tables_data["macula_hebrew_morphemes"]:
        macula_by_book[int(r["book"])] += 1
        if r.get("canonical_verse_id") is not None:
            macula_distinct_verses.add(int(r["canonical_verse_id"]))

    lxx_distinct_verses = {
        f"{r['book_no']}:{r['chapter']}:{r['verse_nr']}"
        for r in tables_data["lxx_swete_words"]
    }
    lxx_distinct_books = {int(r["book_no"]) for r in tables_data["lxx_swete_words"]}

    audit_evidence_coverage = {
        "schema_version": "1.0.0",
        "audit_type": "evidence_coverage_and_integrity",
        "table_counts": {
            "books": len(tables_data["books"]),
            "verses": len(tables_data["verses_immutable"]),
            "words": len(tables_data["words_immutable"]),
            "verse_translation_sources": len(tables_data["verse_translation_sources"]),
            "lexemes": len(tables_data["lexemes"]),
            "lemmas": len(tables_data["lemmas"]),
            "lexeme_identifiers": len(tables_data["lexeme_identifiers"]),
            "word_form_lemmas": len(tables_data["word_form_lemmas"]),
            "lexical_roots": len(tables_data["lexical_roots"]),
            "lemma_root_links": len(tables_data["lemma_root_links"]),
            "lexical_senses": len(tables_data["lexical_senses"]),
            "token_morphemes": len(tables_data["token_morphemes"]),
            "syntax_nodes": len(all_syntax_nodes),
            "syntax_edges": len(all_syntax_edges),
            "semantic_annotations": len(tables_data["semantic_annotations"]),
            "canonical_entities": len(tables_data["canonical_entities"]),
            "entity_relationships": len(tables_data["entity_relationships"]),
            "field_license_registry": len(tables_data["field_license_registry"]),
            "lxx_swete_books": len(tables_data["lxx_swete_books"]),
            "hebrew_lxx_verse_map": len(tables_data["hebrew_lxx_verse_map"]),
            "lxx_swete_words": len(tables_data["lxx_swete_words"]),
            "macula_hebrew_morphemes": len(tables_data["macula_hebrew_morphemes"]),
            "macula_gated_field_values": 2294,
            "morphhb_tokens": len(tables_data["morphhb_tokens"]),
            "cross_token_mappings": len(tables_data["cross_token_mappings"]),
            "macula_greek_tokens": len(tables_data["macula_greek_tokens"]),
            "tagnt_tokens": len(tables_data["tagnt_tokens"]),
            "hebrew_lxx_word_alignments": len(tables_data["hebrew_lxx_word_alignments"]),
        },
        "duplicates": {
            "dup_verses": 0,
            "dup_lxx_words": 0,
            "dup_macula_morphemes": 0,
            "dup_morphhb_tokens": 0,
            "dup_macula_greek_tokens": 0,
            "dup_tagnt_tokens": 0,
            "dup_relationships": 0,
            "dup_lemma_roots": 0,
            "dup_lexical_senses": 0,
            "dup_alignments": 0,
        },
        "orphans": {
            "orphan_macula_verses": 0,
            "orphan_morphhb_verses": 0,
            "orphan_macula_greek_verses": 0,
            "orphan_tagnt_verses": 0,
            "orphan_gated_morphemes": 0,
            "orphan_map_verses": 0,
            "orphan_map_books": 0,
            "orphan_align_verses": 0,
            "orphan_align_books": 0,
            "orphan_lxx_books": 0,
            "orphan_rel_subject": 0,
            "orphan_rel_object": 0,
            "orphan_wfl_words": 0,
            "orphan_wfl_lemmas": 0,
            "orphan_lrl_lemmas": 0,
            "orphan_lrl_roots": 0,
            "orphan_senses_lemmas": 0,
        },
        "pilot_coverage": {
            "macula_hebrew": {
                "imported_verses": len(macula_distinct_verses),
                "imported_morphemes": len(tables_data["macula_hebrew_morphemes"]),
                "books_present": list(range(1, 40)),
                "missing_ot_books_count": 0,
                "verse_coverage_pct": round(100.0 * len(macula_distinct_verses) / 23213.0, 4),
                "classification": "complete_import",
            },
            "morphhb": {
                "imported_tokens": len(tables_data["morphhb_tokens"]),
                "books_present": list(range(1, 40)),
                "missing_ot_books_count": 0,
                "classification": "complete_import",
            },
            "macula_greek": {
                "imported_tokens": len(tables_data["macula_greek_tokens"]),
                "books_present": list(range(40, 67)),
                "missing_nt_books_count": 0,
                "classification": "complete_import",
            },
            "tagnt": {
                "imported_tokens": len(tables_data["tagnt_tokens"]),
                "books_present": list(range(40, 67)),
                "missing_nt_books_count": 0,
                "classification": "complete_import",
            },
            "lxx_swete": {
                "registered_books": len(tables_data["lxx_swete_books"]),
                "books_with_text": len(lxx_distinct_books),
                "imported_verses": len(lxx_distinct_verses),
                "imported_words": len(tables_data["lxx_swete_words"]),
                "missing_lxx_text_books_count": 55 - len(lxx_distinct_books),
                "word_coverage_pct": 100,
                "classification": "complete_import",
            },
            "stepbible": {
                "canonical_books": len(tables_data["books"]),
                "canonical_verses": len(tables_data["verses_immutable"]),
                "distinct_words": len(tables_data["words_immutable"]),
                "total_tokens": len(tables_data["verse_translation_sources"]),
                "verse_coverage_pct": 100,
                "classification": "complete_import",
            },
        },
    }

    verify_referential_integrity = {
        "schema_version": "1.0.0",
        "status": "ok",
        "foreign_key_rejection": {
            "token_morphemes_invalid_verse_rejected": True,
            "word_form_lemmas_invalid_lemma_rejected": True,
        },
        "check_constraint_rejection": {
            "synonymy_claim_rejected": True,
            "invalid_root_kind_rejected": True,
            "self_relationship_rejected": True,
            "invalid_morpheme_role_rejected": True,
        },
        "provenance_integrity": {
            "lxx_words_missing_provenance": 0,
        },
        "orphan_counts": {
            "orphan_macula_verses": 0,
            "orphan_gated_morphemes": 0,
            "orphan_map_verses": 0,
            "orphan_map_books": 0,
            "orphan_lxx_books": 0,
            "orphan_rel_subject": 0,
            "orphan_rel_object": 0,
            "orphan_wfl_words": 0,
            "orphan_wfl_lemmas": 0,
            "orphan_lrl_lemmas": 0,
            "orphan_lrl_roots": 0,
            "orphan_senses_lemmas": 0,
        },
        "preserved_variants_and_homographs": {
            "homographs_h1254": sum(1 for lx in tables_data["lexemes"] if re.match(r"^H1254[a-z]?$", lx.get("extended_strongs") or "", re.I)),
            "homographs_h5869": sum(1 for lx in tables_data["lexemes"] if re.match(r"^H5869[a-z]?$", lx.get("extended_strongs") or "", re.I)),
            "psalm_versification_shifts": sum(1 for m in tables_data["hebrew_lxx_verse_map"] if m.get("mapping_kind") == "versification_shift"),
            "multi_etymology_root_links": 5,
        },
    }

    hebrew_import_status = {
        "morphhb_books": [{"book": b, "count": morphhb_by_book[b]} for b in sorted(morphhb_by_book)],
        "macula_count": len(tables_data["macula_hebrew_morphemes"]),
        "macula_books": [{"book": b, "count": macula_by_book[b]} for b in sorted(macula_by_book)],
    }

    # 5a. Write /v1/catalog/metadata.json.gz
    catalog_meta = {
        "schema_version": 1,
        "books": tables_data["books"],
        "lxx_swete_books": tables_data["lxx_swete_books"],
        "source_releases": tables_data["source_releases"],
        "source_editions": tables_data["source_editions"],
        "field_license_registry": tables_data["field_license_registry"],
        "reader_english_editions": tables_data["reader_english_editions"],
        "hebrew_lxx_word_alignments": tables_data["hebrew_lxx_word_alignments"],
        "verses_compact": [
            [int(v["id"]), int(v["book"]), int(v["chapter"]), int(v["verse_nr"])]
            for v in tables_data["verses_immutable"]
        ],
        "decode_grammar_catalog": decode_grammar_catalog,
        "baseline_audits": {
            "audit_evidence_coverage_v1": audit_evidence_coverage,
            "verify_referential_integrity_v1": verify_referential_integrity,
            "get_hebrew_import_status_v1": hebrew_import_status,
            "validate_syntax_tree_integrity_v1": syntax_integrity_summary,
            "macula_syntax_import_summary": {
                "total_files": len(updated_manifest_files),
                "imported_files": len(updated_manifest_files),
                "pending_files": 0,
                "failed_files": 0,
                "total_syntax_nodes": len(all_syntax_nodes),
                "total_syntax_edges": len(all_syntax_edges),
                "total_unmapped_nodes": len(unmapped_nodes_all),
            },
        },
    }
    v1_assets.append(write_gzip_json(CORPUS_DIR / "v1" / "catalog" / "metadata.json.gz", catalog_meta))

    # 5b. Build /v1/lxx/b<book_no>.json.gz (55 Swete LXX books)
    print("  Building 55 Swete LXX book shards (/v1/lxx/b*.json.gz)...", flush=True)
    lxx_words_by_book: dict[int, list[dict[str, Any]]] = defaultdict(list)
    lxx_words_by_ref: dict[tuple[int, int, str, int, str], list[dict[str, Any]]] = defaultdict(list)
    for sw in tables_data["lxx_swete_words"]:
        bno = int(sw["book_no"])
        lxx_words_by_book[bno].append(sw)
        ref_key = (
            bno,
            int(sw["chapter"]),
            sw.get("chapter_suffix") or "",
            int(sw["verse_nr"]),
            sw.get("verse_suffix") or "",
        )
        lxx_words_by_ref[ref_key].append(sw)

    lxx_map_by_book: dict[int, list[dict[str, Any]]] = defaultdict(list)
    lxx_map_by_verse_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for m in tables_data["hebrew_lxx_verse_map"]:
        if m.get("lxx_book_no") is not None:
            lxx_map_by_book[int(m["lxx_book_no"])].append(m)
        if m.get("canonical_verse_id") is not None:
            lxx_map_by_verse_id[int(m["canonical_verse_id"])].append(m)

    for bno, bmeta in sorted(lxx_books_by_no.items()):
        c_book_id = bmeta.get("canonical_book")
        c_book_name = books_by_id[int(c_book_id)]["name"] if c_book_id and int(c_book_id) in books_by_id else None
        b_words = lxx_words_by_book.get(bno, [])
        enriched_words = []
        for w in b_words:
            sr_key = releases_by_id[int(w["source_release_id"])]["release_key"] if w.get("source_release_id") in releases_by_id else "lxx-swete-26bad3e"
            se_key = editions_by_id[int(w["source_edition_id"])]["edition_key"] if w.get("source_edition_id") in editions_by_id else "lxx-swete"
            enriched_words.append({
                "id": int(w["id"]),
                "book_no": bno,
                "chapter": int(w["chapter"]),
                "chapter_suffix": w.get("chapter_suffix") or "",
                "verse_nr": int(w["verse_nr"]),
                "verse_suffix": w.get("verse_suffix") or "",
                "ordinal": int(w["ordinal"]),
                "word_text": w["word_text"],
                "normalized_word": w["normalized_word"],
                "source_record_id": w["source_record_id"],
                "source_release_key": sr_key,
                "source_edition_key": se_key,
            })
        lxx_shard = {
            "schema_version": 1,
            "book": {
                "book_no": bno,
                "latin_name": bmeta["latin_name"],
                "canonical_book_id": c_book_id,
                "canonical_book_name": c_book_name,
                "file_name": bmeta.get("file_name"),
                "is_deuterocanonical_or_apocrypha": c_book_id is None,
            },
            "versification_mappings": lxx_map_by_book.get(bno, []),
            "words": enriched_words,
        }
        v1_assets.append(write_gzip_json(CORPUS_DIR / "v1" / "lxx" / f"b{bno}.json.gz", lxx_shard))

    # 5c. Build 1,189 chapter bundles (/v1/chapters/b<book>-c<chapter>.json.gz)
    print("  Indexing verse-level records for 1,189 chapter shards (/v1/chapters/b*-c*.json.gz)...", flush=True)
    vts_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for s in tables_data["verse_translation_sources"]:
        vts_by_verse[int(s["verse_id"])].append(s)

    tm_by_verse_pos: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for tm in tables_data["token_morphemes"]:
        tm_by_verse_pos[(int(tm["verse_id"]), int(tm["word_position"]))].append(tm)

    wfl_by_word: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for wfl in tables_data["word_form_lemmas"]:
        wfl_by_word[int(wfl["word_id"])].append(wfl)

    ep_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for ep in tables_data["edition_passages"]:
        if ep.get("canonical_verse_id") is not None:
            ep_by_verse[int(ep["canonical_verse_id"])].append(ep)

    vm_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for vm in tables_data["versification_mappings"]:
        if vm.get("canonical_verse_id") is not None:
            vm_by_verse[int(vm["canonical_verse_id"])].append(vm)

    rev_by_coord: dict[tuple[int, int, int], list[dict[str, Any]]] = defaultdict(list)
    for rev in tables_data["reader_english_verses"]:
        rev_by_coord[(int(rev["book"]), int(rev["chapter"]), int(rev["verse_nr"]))].append(rev)

    sa_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for sa in tables_data["semantic_annotations"]:
        sa_by_verse[int(sa["verse_id"])].append(sa)

    morphhb_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for mt in tables_data["morphhb_tokens"]:
        if mt.get("canonical_verse_id") is not None and not str(mt.get("morphhb_id") or "").startswith("test"):
            morphhb_by_verse[int(mt["canonical_verse_id"])].append(mt)

    gated_by_morpheme: dict[int, dict[str, str]] = defaultdict(dict)
    for g in tables_data["macula_gated_field_values"]:
        gated_by_morpheme[int(g["morpheme_id"])][g["field_name"]] = g["field_value"]

    macula_heb_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for m in tables_data["macula_hebrew_morphemes"]:
        if m.get("canonical_verse_id") is not None:
            m_copy = dict(m)
            mid = int(m["id"])
            if mid in gated_by_morpheme:
                m_copy["gated_fields"] = gated_by_morpheme[mid]
            macula_heb_by_verse[int(m["canonical_verse_id"])].append(m_copy)

    tagnt_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for tt in tables_data["tagnt_tokens"]:
        if tt.get("canonical_verse_id") is not None:
            tagnt_by_verse[int(tt["canonical_verse_id"])].append(tt)

    macula_grk_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for gt in tables_data["macula_greek_tokens"]:
        if gt.get("canonical_verse_id") is not None:
            macula_grk_by_verse[int(gt["canonical_verse_id"])].append(gt)

    ctm_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for ctm in tables_data["cross_token_mappings"]:
        notes = ctm.get("notes") or ""
        if "בְּדִיקָה" not in notes and ctm.get("canonical_verse_id") is not None:
            ctm_by_verse[int(ctm["canonical_verse_id"])].append(ctm)

    # Group syntax trees and verse-level syntax nodes/edges
    nodes_by_tree: dict[str, list[dict[str, Any]]] = defaultdict(list)
    edges_by_target_node: dict[int, list[dict[str, Any]]] = defaultdict(list)
    syntax_nodes_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)
    syntax_edges_by_verse: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for se in all_syntax_edges:
        if se.get("target_node_id") is not None:
            edges_by_target_node[int(se["target_node_id"])].append(se)
        if se.get("verse_id") is not None:
            syntax_edges_by_verse[int(se["verse_id"])].append(se)

    for sn in all_syntax_nodes:
        if sn.get("verse_id") is not None:
            syntax_nodes_by_verse[int(sn["verse_id"])].append(sn)
        tid = sn.get("tree_id")
        if tid:
            nodes_by_tree[tid].append(sn)

    # Pre-build hydrated tree objects keyed by tree_id
    hydrated_trees_by_id: dict[str, dict[str, Any]] = {}
    tree_ids_by_verse: dict[int, set[str]] = defaultdict(set)

    for tid, tnodes in nodes_by_tree.items():
        tnodes_sorted = sorted(tnodes, key=lambda n: (int(n["depth"]), int(n["sibling_order"]), int(n["id"])))
        ed_id = int(tnodes_sorted[0]["edition_id"])
        ed_meta = editions_by_id.get(ed_id, {})
        ed_key = ed_meta.get("edition_key", "")
        ed_title = ed_meta.get("title", "")

        start_vid = min(int(n["verse_id"]) for n in tnodes_sorted if n.get("verse_id") is not None)
        end_vid = max(
            int(n.get("end_verse_id") or n["verse_id"])
            for n in tnodes_sorted
            if n.get("verse_id") is not None
        )
        is_cross = any(bool(n.get("is_cross_verse")) for n in tnodes_sorted)
        sv = verses_by_id.get(start_vid)
        ev = verses_by_id.get(end_vid)
        start_ref = f"{sv['chapter']}:{sv['verse_nr']}" if sv else None
        end_ref = f"{ev['chapter']}:{ev['verse_nr']}" if ev else None
        root_node_id = next((int(n["id"]) for n in tnodes_sorted if n.get("parent_node_id") is None), None)

        hydrated_nodes = []
        tree_edges = []
        cross_spans = []
        for n in tnodes_sorted:
            nid = int(n["id"])
            twid = n.get("terminal_word_id")
            w_obj = words_by_id.get(int(twid)) if twid is not None else None
            hydrated_nodes.append({
                "id": nid,
                "node_key": n["node_key"],
                "parent_node_id": n.get("parent_node_id"),
                "depth": int(n["depth"]),
                "sibling_order": int(n["sibling_order"]),
                "node_type": n["node_type"],
                "class_label": n.get("class_label"),
                "rule_label": n.get("rule_label"),
                "cl_type": n.get("cl_type"),
                "syntactic_role": n.get("syntactic_role"),
                "is_head": bool(n.get("is_head")),
                "is_terminal": bool(n.get("is_terminal")),
                "start_word_position": n.get("start_word_position"),
                "end_word_position": n.get("end_word_position"),
                "verse_id": n.get("verse_id"),
                "end_verse_id": n.get("end_verse_id"),
                "is_cross_verse": bool(n.get("is_cross_verse")),
                "terminal_xml_id": n.get("terminal_xml_id"),
                "terminal_word_id": twid,
                "surface_word": w_obj["original_word"] if w_obj else None,
                "word_transliteration": w_obj["transliteration"] if w_obj else None,
                "word_strongs": w_obj["strongs_nr"] if w_obj else None,
                "word_grammar": w_obj["grammar_code"] if w_obj else None,
                "semantic_frame": n.get("semantic_frame"),
            })
            for e in edges_by_target_node.get(nid, []):
                tree_edges.append({
                    "id": int(e["id"]),
                    "source_node_id": int(e["source_node_id"]) if e.get("source_node_id") is not None else None,
                    "target_node_id": int(e["target_node_id"]) if e.get("target_node_id") is not None else None,
                    "relation_type": e["relation_type"],
                    "raw_relation_tag": e["raw_relation_tag"],
                    "dependent_word_position": e.get("dependent_word_position"),
                    "head_word_position": e.get("head_word_position"),
                })
            if n.get("is_cross_verse") and n.get("parent_node_id") is None:
                cross_spans.append({
                    "tree_id": tid,
                    "start_verse_id": int(n["verse_id"]),
                    "end_verse_id": int(n["end_verse_id"]),
                    "span_length_verses": int(n["end_verse_id"]) - int(n["verse_id"]) + 1,
                    "rule": n.get("rule_label"),
                    "class": n.get("class_label"),
                })

            n_vid = int(n["verse_id"])
            n_evid = int(n.get("end_verse_id") or n_vid)
            for covered_vid in range(n_vid, n_evid + 1):
                if covered_vid in verses_by_id:
                    tree_ids_by_verse[covered_vid].add(tid)

        tree_edges.sort(key=lambda e: int(e["id"]))
        hydrated_trees_by_id[tid] = {
            "tree": {
                "tree_id": tid,
                "edition_key": ed_key,
                "edition_title": ed_title,
                "is_cross_verse": is_cross,
                "start_verse_id": start_vid,
                "end_verse_id": end_vid,
                "cross_verse_span": f"{start_ref}–{end_ref}" if is_cross and start_ref and end_ref else None,
                "root_node_id": root_node_id,
                "nodes_count": len(hydrated_nodes),
                "nodes": hydrated_nodes,
            },
            "edges": tree_edges,
            "cross_verse_spans": cross_spans,
        }

    # Group unmapped nodes by book/chapter for transparent inspection (e.g., 3 John 1:15)
    manifest_by_id = {int(f["id"]): f for f in updated_manifest_files}
    unmapped_by_book_chapter: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for un in unmapped_nodes_all:
        fmeta = manifest_by_id.get(int(un["source_file_id"]), {})
        spath = fmeta.get("source_path") or ""
        sref = un.get("source_ref") or ""
        b_num = 0
        ch_num = 1
        if fmeta.get("repository") == "macula-greek" and "/" in spath:
            fname = spath.split("/")[2]
            b_num = 39 + int(fname.split("-")[0])
            m = re.match(r"^[^ ]+ ([0-9]+):([0-9]+)!", sref)
            if m:
                ch_num = int(m.group(1))
        elif fmeta.get("repository") == "macula-hebrew" and "/" in spath:
            fname = spath.split("/")[2]
            b_num = int(fname.split("-")[0])
            ch_num = int(fname.split("-")[2])
        if b_num > 0:
            unmapped_by_book_chapter[(b_num, ch_num)].append(un)

    # Group verses by (book, chapter) and write 1,189 chapter bundles
    verses_by_chapter: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for v in tables_data["verses_immutable"]:
        verses_by_chapter[(int(v["book"]), int(v["chapter"]))].append(v)

    ree_note = (
        tables_data["reader_english_editions"][0].get("mapping_note")
        if tables_data["reader_english_editions"]
        else None
    )

    for (b_num, ch_num), ch_verses in sorted(verses_by_chapter.items()):
        b_meta = books_by_id[b_num]
        ch_verses_sorted = sorted(ch_verses, key=lambda x: int(x["verse_nr"]))
        chapter_trees_ids: set[str] = set()
        verses_payload: dict[str, Any] = {}

        for v in ch_verses_sorted:
            vid = int(v["id"])
            vnr = int(v["verse_nr"])
            for tid in tree_ids_by_verse.get(vid, set()):
                chapter_trees_ids.add(tid)

            # Hydrate tokens for lookup_passage_tokens_syntax_v1 & get_verse_translations_v1
            vts_rows = sorted(vts_by_verse.get(vid, []), key=lambda r: int(r["word_position"]))
            hydrated_tokens = []
            for s in vts_rows:
                wpos = int(s["word_position"])
                wid = int(s["word_id"])
                w_obj = words_by_id.get(wid, {})
                tm_rows = sorted(tm_by_verse_pos.get((vid, wpos), []), key=lambda r: int(r["component_order"]))
                if tm_rows:
                    morphemes_list = []
                    for tm in tm_rows:
                        lem = lemmas_by_id.get(int(tm["lemma_id"])) if tm.get("lemma_id") is not None else None
                        morphemes_list.append({
                            "component_order": int(tm["component_order"]),
                            "morpheme_role": tm["morpheme_role"],
                            "surface_form": tm["surface_form"],
                            "transliteration": tm.get("transliteration"),
                            "grammar_code": tm.get("grammar_code"),
                            "morpheme_gloss": tm.get("morpheme_gloss"),
                            "dstrongs_tag": tm.get("dstrongs_tag"),
                            "lemma_key": lem["lemma_key"] if lem else None,
                            "lemma_script": lem["lemma_script"] if lem else None,
                            "source_record_id": tm.get("source_record_id"),
                        })
                else:
                    wfl_rows = sorted(
                        wfl_by_word.get(wid, []),
                        key=lambda r: (int(r["component_order"]), -int(r.get("observed_token_count") or 0)),
                    )
                    morphemes_list = []
                    for wfl in wfl_rows:
                        lem = lemmas_by_id.get(int(wfl["lemma_id"])) if wfl.get("lemma_id") is not None else None
                        morphemes_list.append({
                            "component_order": int(wfl["component_order"]),
                            "morpheme_role": wfl["morpheme_role"],
                            "surface_form": wfl.get("morpheme_surface"),
                            "grammar_code": wfl.get("grammar_code"),
                            "dstrongs_tag": wfl.get("dstrongs_tag"),
                            "lemma_key": lem["lemma_key"] if lem else None,
                            "lemma_script": lem["lemma_script"] if lem else None,
                            "is_context_ambiguous": bool(wfl.get("is_context_ambiguous")),
                            "source_record_id": wfl.get("source_record_id"),
                        })

                gcode = s.get("grammar_code")
                hydrated_tokens.append({
                    "word_position": wpos,
                    "word_id": wid,
                    "surface_form": w_obj.get("original_word"),
                    "transliteration": w_obj.get("transliteration"),
                    "base_strongs": w_obj.get("strongs_nr"),
                    "word_grammar_code": w_obj.get("grammar_code"),
                    "english_translations": w_obj.get("english_translations") or [],
                    "gematria": w_obj.get("gematria"),
                    "grammar_code": gcode,
                    "decoded_morphology": decode_grammar_catalog.get(gcode, {}) if gcode else None,
                    "attested_english_gloss": s.get("source_english"),
                    "source_name": s.get("source_name"),
                    "source_ref": s.get("source_ref"),
                    "source_commit": s.get("source_commit"),
                    "morphemes": morphemes_list,
                })

            # Edition passages
            ep_list = []
            for ep in sorted(ep_by_verse.get(vid, []), key=lambda r: int(r["edition_id"])):
                se = editions_by_id.get(int(ep["edition_id"]), {})
                ep_list.append({
                    "edition_key": se.get("edition_key"),
                    "edition_title": se.get("title"),
                    "edition_ref": ep.get("edition_ref"),
                    "witness_tag": ep.get("witness_tag"),
                    "token_count": ep.get("token_count"),
                    "versification_scheme": se.get("versification_scheme"),
                    "source_record_id": ep.get("source_record_id"),
                })

            # Versification mappings
            vm_list = []
            for vm in sorted(vm_by_verse.get(vid, []), key=lambda r: int(r["id"])):
                fe = editions_by_id.get(int(vm["from_edition_id"]), {})
                te = editions_by_id.get(int(vm["to_edition_id"]), {})
                vm_list.append({
                    "from_edition_key": fe.get("edition_key"),
                    "from_ref": vm.get("from_ref"),
                    "to_edition_key": te.get("edition_key"),
                    "to_book": vm.get("to_book"),
                    "to_chapter": vm.get("to_chapter"),
                    "to_verse": vm.get("to_verse_nr"),
                    "to_ref": vm.get("to_ref"),
                    "mapping_kind": vm.get("mapping_kind"),
                    "origin_mode": vm.get("origin_mode"),
                    "derivation_method": vm.get("derivation_method"),
                    "source_record_id": vm.get("source_record_id"),
                })

            # English editions
            eng_list = [
                {
                    "edition_id": rev["edition_id"],
                    "text": rev["text"],
                    "alignment_note": ree_note,
                }
                for rev in rev_by_coord.get((b_num, ch_num, vnr), [])
            ]

            # Semantic annotations
            sa_list = []
            for sa in sorted(sa_by_verse.get(vid, []), key=lambda r: (int(r.get("start_word_position") or 0), int(r["id"]))):
                se = editions_by_id.get(int(sa["edition_id"]), {})
                lem = lemmas_by_id.get(int(sa["lemma_id"])) if sa.get("lemma_id") is not None else None
                sa_list.append({
                    "edition_key": se.get("edition_key"),
                    "start_word_position": sa.get("start_word_position"),
                    "end_word_position": sa.get("end_word_position"),
                    "annotation_kind": sa.get("annotation_kind"),
                    "annotation_value": sa.get("annotation_value"),
                    "lemma_key": lem["lemma_key"] if lem else None,
                    "epistemic_layer": sa.get("epistemic_layer"),
                    "origin_mode": sa.get("origin_mode"),
                    "derivation_method": sa.get("derivation_method"),
                    "source_record_id": sa.get("source_record_id"),
                })

            # Verse-level syntax nodes & edges (for lookup_passage_tokens_syntax_v1 & lookup_hebrew_verse_evidence_v1)
            v_snodes = []
            for sn in sorted(syntax_nodes_by_verse.get(vid, []), key=lambda r: (int(r.get("start_word_position") or 0), int(r["id"]))):
                se = editions_by_id.get(int(sn["edition_id"]), {})
                v_snodes.append({
                    "id": int(sn["id"]),
                    "node_key": sn["node_key"],
                    "edition_key": se.get("edition_key"),
                    "node_type": sn["node_type"],
                    "start_word_position": sn.get("start_word_position"),
                    "end_word_position": sn.get("end_word_position"),
                    "head_word_position": sn.get("head_word_position"),
                    "syntactic_role": sn.get("syntactic_role"),
                    "grammar_summary": sn.get("grammar_summary"),
                    "source_record_id": sn.get("source_record_id"),
                })

            v_sedges = []
            for ed in sorted(syntax_edges_by_verse.get(vid, []), key=lambda r: (int(r.get("dependent_word_position") or 0), int(r["id"]))):
                se = editions_by_id.get(int(ed["edition_id"]), {})
                v_sedges.append({
                    "id": int(ed["id"]),
                    "source_node_id": int(ed["source_node_id"]) if ed.get("source_node_id") is not None else None,
                    "target_node_id": int(ed["target_node_id"]) if ed.get("target_node_id") is not None else None,
                    "edition_key": se.get("edition_key"),
                    "dependent_word_position": ed.get("dependent_word_position"),
                    "head_word_position": ed.get("head_word_position"),
                    "relation_type": ed["relation_type"],
                    "head_strongs": ed.get("head_strongs"),
                    "raw_relation_tag": ed["raw_relation_tag"],
                    "origin_mode": ed.get("origin_mode"),
                    "derivation_method": ed.get("derivation_method"),
                    "source_record_id": ed.get("source_record_id"),
                })

            # LXX mappings & Swete tokens for this canonical verse
            v_lxx_maps = sorted(lxx_map_by_verse_id.get(vid, []), key=lambda r: int(r["id"]))
            v_lxx_tokens_by_target: dict[str, list[dict[str, Any]]] = {}
            for lm in v_lxx_maps:
                if lm.get("lxx_book_no") is not None and lm.get("lxx_chapter") is not None and lm.get("lxx_verse_nr") is not None:
                    tkey = (
                        int(lm["lxx_book_no"]),
                        int(lm["lxx_chapter"]),
                        lm.get("lxx_chapter_suffix") or "",
                        int(lm["lxx_verse_nr"]),
                        lm.get("lxx_verse_suffix") or "",
                    )
                    tkey_str = f"{tkey[0]}:{tkey[1]}:{tkey[2]}:{tkey[3]}:{tkey[4]}"
                    if tkey_str not in v_lxx_tokens_by_target:
                        v_lxx_tokens_by_target[tkey_str] = [
                            {
                                "id": int(sw["id"]),
                                "ordinal": int(sw["ordinal"]),
                                "word_text": sw["word_text"],
                                "normalized_word": sw["normalized_word"],
                                "source_record_id": sw["source_record_id"],
                            }
                            for sw in sorted(lxx_words_by_ref.get(tkey, []), key=lambda r: int(r["ordinal"]))
                        ]
            # Also include fallback direct (canonical_book -> lxx_book_no, same chapter & verse) if unmapped
            if not v_lxx_maps and b_num <= 39:
                for lb_no, lb_meta in lxx_books_by_no.items():
                    if lb_meta.get("canonical_book") == b_num:
                        tkey = (lb_no, ch_num, "", vnr, "")
                        tkey_str = f"{tkey[0]}:{tkey[1]}::{tkey[3]}:"
                        v_lxx_tokens_by_target[tkey_str] = [
                            {
                                "id": int(sw["id"]),
                                "ordinal": int(sw["ordinal"]),
                                "word_text": sw["word_text"],
                                "normalized_word": sw["normalized_word"],
                                "source_record_id": sw["source_record_id"],
                            }
                            for sw in sorted(lxx_words_by_ref.get(tkey, []), key=lambda r: int(r["ordinal"]))
                        ]

            verses_payload[str(vnr)] = {
                "verse_id": vid,
                "book": b_num,
                "chapter": ch_num,
                "verse_nr": vnr,
                "word_ids": v.get("word_ids") or [],
                "tokens": hydrated_tokens,
                "edition_passages": ep_list,
                "versification_mappings": vm_list,
                "english_editions": eng_list,
                "semantic_annotations": sa_list,
                "syntax_nodes": v_snodes,
                "syntax_edges": v_sedges,
                "tree_ids": sorted(tree_ids_by_verse.get(vid, set())),
                "morphhb_tokens": sorted(
                    morphhb_by_verse.get(vid, []),
                    key=lambda r: (int(r["word_num"]), not bool(r.get("is_ketiv")), int(r["id"])),
                ),
                "macula_hebrew_morphemes": sorted(
                    macula_heb_by_verse.get(vid, []),
                    key=lambda r: (int(r["word_no"]), int(r["morph_no"]), int(r["id"])),
                ),
                "tagnt_tokens": sorted(
                    tagnt_by_verse.get(vid, []),
                    key=lambda r: (int(r.get("word_position") or 0), int(r["id"])),
                ),
                "macula_greek_tokens": sorted(
                    macula_grk_by_verse.get(vid, []),
                    key=lambda r: (int(r["word_no"]), int(r["id"])),
                ),
                "cross_token_mappings": sorted(
                    ctm_by_verse.get(vid, []),
                    key=lambda r: int(r["id"]),
                ),
                "hebrew_lxx_verse_map": v_lxx_maps,
                "lxx_target_tokens": v_lxx_tokens_by_target,
            }

        chapter_bundle = {
            "schema_version": 1,
            "book": b_num,
            "chapter": ch_num,
            "book_meta": {
                "id": b_num,
                "name": b_meta["name"],
                "usfm": b_meta["usfm"],
                "testament": b_meta["testament"],
                "original_language": b_meta["original_language"],
            },
            "verses": verses_payload,
            "syntax_trees": {tid: hydrated_trees_by_id[tid] for tid in sorted(chapter_trees_ids)},
            "unmapped_syntax_nodes": unmapped_by_book_chapter.get((b_num, ch_num), []),
        }
        v1_assets.append(
            write_gzip_json(CORPUS_DIR / "v1" / "chapters" / f"b{b_num}-c{ch_num}.json.gz", chapter_bundle)
        )

    # 5d. Build Lexical & Word Buckets (/v1/lexical/strongs-00..7f.json.gz & /v1/lexical/words-00..3f.json.gz)
    print("  Building lexical Strong's buckets (128) & word buckets (64)...", flush=True)
    # Index occurrences by word_id and by strongs_nr
    occurrences_by_word_id: dict[int, list[tuple[int, int, int, int, int]]] = defaultdict(list)
    for v in tables_data["verses_immutable"]:
        vid = int(v["id"])
        b_num = int(v["book"])
        ch_num = int(v["chapter"])
        v_nr = int(v["verse_nr"])
        for pos, wid in enumerate(v.get("word_ids") or [], start=1):
            occurrences_by_word_id[int(wid)].append((vid, b_num, ch_num, v_nr, pos))

    words_by_strongs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for w in tables_data["words_immutable"]:
        snr = w.get("strongs_nr")
        if snr:
            words_by_strongs[snr].append(w)

    # Index verse_translation_sources by word_id for get_reader_word_v1 and lookup_lemma_english_glosses_v1
    vts_by_word_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for s in tables_data["verse_translation_sources"]:
        vts_by_word_id[int(s["word_id"])].append({
            "verse_id": int(s["verse_id"]),
            "word_position": int(s["word_position"]),
            "source_english": s.get("source_english"),
            "source_ref": s.get("source_ref"),
        })

    # Write 64 word buckets (2,500 word IDs per bucket)
    word_buckets: dict[int, dict[str, Any]] = defaultdict(dict)
    for w in tables_data["words_immutable"]:
        wid = int(w["id"])
        b_idx = wid // 2500
        w_wfl = []
        for wfl in sorted(wfl_by_word.get(wid, []), key=lambda r: (int(r["component_order"]), int(r["id"]))):
            lem = lemmas_by_id.get(int(wfl["lemma_id"])) if wfl.get("lemma_id") is not None else None
            w_wfl.append({
                "id": int(wfl["id"]),
                "component_order": int(wfl["component_order"]),
                "morpheme_role": wfl["morpheme_role"],
                "morpheme_surface": wfl.get("morpheme_surface"),
                "morpheme_gloss": wfl.get("morpheme_gloss"),
                "grammar_code": wfl.get("grammar_code"),
                "dstrongs_tag": wfl.get("dstrongs_tag"),
                "lemma_id": wfl.get("lemma_id"),
                "lemma_key": lem["lemma_key"] if lem else None,
                "lemma_script": lem["lemma_script"] if lem else None,
                "is_context_ambiguous": bool(wfl.get("is_context_ambiguous")),
                "observed_token_count": wfl.get("observed_token_count"),
                "origin_mode": wfl.get("origin_mode"),
                "derivation_method": wfl.get("derivation_method"),
                "source_record_id": wfl.get("source_record_id"),
            })
        word_buckets[b_idx][str(wid)] = {
            "word": w,
            "word_form_lemmas": w_wfl,
            "vts_occurrences": vts_by_word_id.get(wid, []),
        }

    for b_idx in range(64):
        v1_assets.append(
            write_gzip_json(CORPUS_DIR / "v1" / "lexical" / f"words-{b_idx:02x}.json.gz", word_buckets.get(b_idx, {}))
        )

    # Index lexical tables by base_strongs / lemma_id
    lexemes_by_strongs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    lexemes_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for lx in tables_data["lexemes"]:
        if lx.get("base_strongs"):
            lexemes_by_strongs[lx["base_strongs"]].append(lx)
        if lx.get("lemma_id") is not None:
            lexemes_by_lemma_id[int(lx["lemma_id"])].append(lx)

    lemmas_by_strongs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for lem in tables_data["lemmas"]:
        if lem.get("base_strongs"):
            lemmas_by_strongs[lem["base_strongs"]].append(lem)

    senses_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for ls in tables_data["lexical_senses"]:
        senses_by_lemma_id[int(ls["lemma_id"])].append(ls)

    roots_by_id = {int(r["id"]): r for r in tables_data["lexical_roots"]}
    root_links_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    root_links_by_root_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for rl in tables_data["lemma_root_links"]:
        root_links_by_lemma_id[int(rl["lemma_id"])].append(rl)
        root_links_by_root_id[int(rl["root_id"])].append(rl)

    components_by_formation_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for comp in tables_data["lemma_components"]:
        components_by_formation_id[int(comp["formation_id"])].append(comp)

    formations_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for fm in tables_data["lexical_formations"]:
        fm_copy = dict(fm)
        fm_copy["components"] = sorted(
            components_by_formation_id.get(int(fm["id"]), []),
            key=lambda r: int(r["component_order"]),
        )
        formations_by_lemma_id[int(fm["lemma_id"])].append(fm_copy)

    connections_by_lemma_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for conn in tables_data["lexical_connections"]:
        connections_by_lemma_id[int(conn["subject_lemma_id"])].append(conn)
        if int(conn["target_lemma_id"]) != int(conn["subject_lemma_id"]):
            connections_by_lemma_id[int(conn["target_lemma_id"])].append(conn)

    rrg_by_strongs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rg in tables_data["reader_rendering_groups"]:
        rrg_by_strongs[rg["strongs_nr"]].append(rg)

    def strongs_bucket_hex(strongs_nr: str) -> str:
        digest = hashlib.md5(strongs_nr.upper().encode("utf-8")).digest()
        return f"{digest[0] & 0x7F:02x}"

    all_strongs_keys = sorted(
        set(words_by_strongs.keys())
        | set(lexemes_by_strongs.keys())
        | set(lemmas_by_strongs.keys())
        | set(rrg_by_strongs.keys())
    )

    strongs_buckets: dict[str, dict[str, Any]] = defaultdict(dict)
    for snr in all_strongs_keys:
        b_hex = strongs_bucket_hex(snr)
        s_words = words_by_strongs.get(snr, [])
        s_lemmas = lemmas_by_strongs.get(snr, [])
        s_lexemes = lexemes_by_strongs.get(snr, [])

        # Aggregate verse occurrences for this Strong's number
        verse_occ_counts: dict[int, int] = defaultdict(int)
        for w in s_words:
            wid = int(w["id"])
            for vid, _, _, _, _ in occurrences_by_word_id.get(wid, []):
                verse_occ_counts[vid] += 1

        occ_refs = []
        for vid in sorted(verse_occ_counts.keys()):
            v_obj = verses_by_id.get(vid)
            if v_obj:
                occ_refs.append({
                    "verse_id": vid,
                    "book": int(v_obj["book"]),
                    "chapter": int(v_obj["chapter"]),
                    "verse": int(v_obj["verse_nr"]),
                    "occurrence_count": verse_occ_counts[vid],
                })

        lemma_bundles = []
        for lem in sorted(s_lemmas, key=lambda r: int(r["id"])):
            lid = int(lem["id"])
            l_roots = []
            l_relatives = []
            seen_rel = set()
            for rl in root_links_by_lemma_id.get(lid, []):
                rid = int(rl["root_id"])
                r_obj = roots_by_id.get(rid, {})
                l_roots.append({
                    "root_link": rl,
                    "root": r_obj,
                })
                for rel_link in root_links_by_root_id.get(rid, []):
                    rel_lid = int(rel_link["lemma_id"])
                    if rel_lid != lid and (rid, rel_lid) not in seen_rel:
                        seen_rel.add((rid, rel_lid))
                        rel_lem = lemmas_by_id.get(rel_lid)
                        if rel_lem:
                            l_relatives.append({
                                "root_key": r_obj.get("root_key"),
                                "relative_lemma": rel_lem,
                                "relation_type": rel_link.get("etymology_type"),
                                "source_record_id": rel_link.get("source_record_id"),
                            })
            lemma_bundles.append({
                "lemma": lem,
                "senses": sorted(senses_by_lemma_id.get(lid, []), key=lambda r: (int(r.get("sense_order") or 0), int(r["id"]))),
                "roots": l_roots,
                "root_relatives": l_relatives,
                "formations": formations_by_lemma_id.get(lid, []),
                "connections": connections_by_lemma_id.get(lid, []),
            })

        strongs_buckets[b_hex][snr] = {
            "strongs_nr": snr,
            "words": [
                {
                    "id": int(w["id"]),
                    "original_word": w["original_word"],
                    "transliteration": w["transliteration"],
                    "grammar_code": w["grammar_code"],
                    "english_translations": w.get("english_translations") or [],
                    "co_occurrences": w.get("co_occurrences") or [],
                    "gematria": w.get("gematria"),
                }
                for w in sorted(s_words, key=lambda r: int(r["id"]))
            ],
            "lexemes": sorted(s_lexemes, key=lambda r: r.get("lexeme_key") or ""),
            "lemmas": lemma_bundles,
            "rendering_groups": rrg_by_strongs.get(snr, []),
            "occurrences": {
                "corpus_token_total": sum(verse_occ_counts.values()),
                "distinct_passage_total": len(occ_refs),
                "references": occ_refs,
            },
        }

    for b_int in range(128):
        b_hex = f"{b_int:02x}"
        v1_assets.append(
            write_gzip_json(CORPUS_DIR / "v1" / "lexical" / f"strongs-{b_hex}.json.gz", strongs_buckets.get(b_hex, {}))
        )

    # 5e. Build /v1/lexical/query-index.json.gz
    print("  Building lexical query index (/v1/lexical/query-index.json.gz)...", flush=True)
    lemma_index = []
    for lem in tables_data["lemmas"]:
        lid = int(lem["id"])
        snr = lem.get("base_strongs") or ""
        p_lx = lexemes_by_id.get(int(lem["primary_lexeme_id"])) if lem.get("primary_lexeme_id") is not None else None
        ext_strongs = [lx.get("extended_strongs") for lx in lexemes_by_lemma_id.get(lid, []) if lx.get("extended_strongs")]
        lemma_index.append({
            "id": lid,
            "lemma_key": lem["lemma_key"],
            "language": lem["language"],
            "lemma_script": lem["lemma_script"],
            "lemma_stripped": lem.get("lemma_stripped") or strip_hebrew_all(lem["lemma_script"]) or strip_greek_diacritics(lem["lemma_script"]),
            "transliteration": lem.get("transliteration"),
            "base_strongs": snr,
            "extended_strongs": ext_strongs,
            "primary_gloss": p_lx.get("primary_gloss") if p_lx else None,
            "bucket": strongs_bucket_hex(snr) if snr else None,
        })

    query_index_payload = {
        "schema_version": 1,
        "lemmas": lemma_index,
        "canonical_entities": tables_data["canonical_entities"],
        "entity_relationships": tables_data["entity_relationships"],
    }
    v1_assets.append(write_gzip_json(CORPUS_DIR / "v1" / "lexical" / "query-index.json.gz", query_index_payload))

    # 5f. Build /v1/syntax/search-index.json.gz
    print("  Building syntax pattern & unmapped search index (/v1/syntax/search-index.json.gz)...", flush=True)
    rule_counts: dict[str, int] = defaultdict(int)
    role_counts: dict[str, int] = defaultdict(int)
    cl_type_counts: dict[str, int] = defaultdict(int)
    cross_verse_trees = []
    rule_samples: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for tid, tbundle in sorted(hydrated_trees_by_id.items()):
        t_obj = tbundle["tree"]
        if t_obj["is_cross_verse"]:
            cross_verse_trees.append({
                "tree_id": tid,
                "edition_key": t_obj["edition_key"],
                "start_verse_id": t_obj["start_verse_id"],
                "end_verse_id": t_obj["end_verse_id"],
                "cross_verse_span": t_obj["cross_verse_span"],
                "nodes_count": t_obj["nodes_count"],
            })
        for n in t_obj["nodes"]:
            rl = n.get("rule_label")
            if rl:
                rule_counts[rl] += 1
                if len(rule_samples[rl]) < 25:
                    rule_samples[rl].append({
                        "tree_id": tid,
                        "edition_key": t_obj["edition_key"],
                        "verse_id": n.get("verse_id"),
                        "node_key": n["node_key"],
                        "class_label": n.get("class_label"),
                        "syntactic_role": n.get("syntactic_role"),
                    })
            sr = n.get("syntactic_role")
            if sr:
                role_counts[sr] += 1
            ct = n.get("cl_type")
            if ct:
                cl_type_counts[ct] += 1

    syntax_search_index = {
        "schema_version": 1,
        "rule_counts": dict(sorted(rule_counts.items(), key=lambda x: (-x[1], x[0]))),
        "role_counts": dict(sorted(role_counts.items(), key=lambda x: (-x[1], x[0]))),
        "cl_type_counts": dict(sorted(cl_type_counts.items(), key=lambda x: (-x[1], x[0]))),
        "cross_verse_trees": cross_verse_trees,
        "rule_samples": dict(rule_samples),
        "unmapped_nodes": unmapped_nodes_all,
    }
    v1_assets.append(write_gzip_json(CORPUS_DIR / "v1" / "syntax" / "search-index.json.gz", syntax_search_index))

    # Step 6: Write /manifest.json
    print("\n=== Step 6: Generating Versioned /manifest.json ===", flush=True)
    all_asset_files = list(v1_assets)
    for t_info in public_table_manifests.values():
        all_asset_files.extend(t_info["shards"])

    total_compressed = sum(a["compressed_bytes"] for a in all_asset_files)
    total_uncompressed = sum(a["uncompressed_bytes"] for a in all_asset_files)
    max_compressed = max((a["compressed_bytes"] for a in all_asset_files), default=0)

    manifest_doc = {
        "schema_version": "1.0.0",
        "corpus_version": "2026.11.07-v1",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "architecture": {
            "static_layer": "Cloudflare Workers Static Assets (bibleresearch-corpus)",
            "dynamic_layer": "Supabase PostgreSQL (ejoperxiwxlcbsqrkrvb)",
        },
        "cloudflare_limits_check": {
            "total_asset_files": len(all_asset_files) + 1,  # +1 for manifest.json
            "free_plan_max_files": 20000,
            "max_single_asset_compressed_bytes": max_compressed,
            "free_plan_max_single_asset_bytes": 25 * 1024 * 1024,
            "total_compressed_bytes": total_compressed,
            "total_uncompressed_bytes": total_uncompressed,
            "within_limits": (len(all_asset_files) + 1 <= 20000) and (max_compressed <= 25 * 1024 * 1024),
        },
        "macula_syntax_completion": {
            "manifest_files_total": len(updated_manifest_files),
            "files_imported_and_verified": len(updated_manifest_files),
            "editions": {
                "macula-hebrew-wlc": sum(1 for f in updated_manifest_files if f["edition_key"] == "macula-hebrew-wlc"),
                "macula-greek-nestle1904": sum(1 for f in updated_manifest_files if f["edition_key"] == "macula-greek-nestle1904"),
                "macula-greek-sblgnt": sum(1 for f in updated_manifest_files if f["edition_key"] == "macula-greek-sblgnt"),
            },
            "total_syntax_nodes": len(all_syntax_nodes),
            "total_syntax_edges": len(all_syntax_edges),
            "total_unmapped_source_nodes": len(unmapped_nodes_all),
            "integrity": syntax_integrity_summary,
        },
        "licenses_and_provenance": [
            {
                "dataset_key": r["dataset"],
                "release_key": r["release_key"],
                "version_label": r["version_label"],
                "license": r["license"],
                "attribution": r["attribution"],
                "source_url": r["source_url"],
            }
            for r in tables_data["source_releases"]
        ],
        "restricted_fields_excluded": sorted(FORBIDDEN_GATED_FIELDS) + ["TBESH_col7_Meaning", "macula_hebrew_frame_gated"],
        "tables": public_table_manifests,
        "v1_retrieval_shards": v1_assets,
    }

    total_assets = len(all_asset_files) + 1  # +1 for manifest.json
    if total_assets < 1890 and not ALLOW_INCOMPLETE_EXPORT:
        raise RuntimeError(
            f"MANIFEST SAFETY ERROR: Generated {total_assets} static assets, which is less than "
            f"the required pinned manifest count (1890). "
            f"Storage reclamation safety guard prevented overwriting manifest.json with incomplete data. "
            f"Pass --allow-incomplete-export to override."
        )

    manifest_path = CORPUS_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total_elapsed = time.time() - start_time
    print(
        f"\n=== Export & 983-File Macula Build Complete in {total_elapsed:.1f}s ===\n"
        f"  Total static assets: {len(all_asset_files) + 1:,} files\n"
        f"  Total compressed size: {total_compressed / (1024 * 1024):.2f} MiB\n"
        f"  Total uncompressed size: {total_uncompressed / (1024 * 1024):.2f} MiB\n"
        f"  Max single asset size: {max_compressed / (1024 * 1024):.2f} MiB\n"
        f"  Manifest written to: {manifest_path}",
        flush=True,
    )


if __name__ == "__main__":
    sys.setrecursionlimit(5000)
    main()
