#!/usr/bin/env python3
"""Fail-closed, LOCAL-ONLY B7 patch for BibleResearch's static corpus exporter.

Usage from C:\\Projects\\BibleResearch:
    python path/to/b7_patch_exporter.py --check
    python path/to/b7_patch_exporter.py --apply

Never run during active concurrent editing. This does not edit remote systems.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
from pathlib import Path

TARGET = Path('scripts/export-static-corpus.py')


def once(text: str, old: str, new: str, name: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{name}: expected one source match, observed {count}; nothing changed')
    return text.replace(old, new, 1)


def between(text: str, begin: str, end: str, replacement: str, name: str) -> str:
    if text.count(begin) != 1 or text.count(end) != 1:
        raise RuntimeError(f'{name}: source anchors changed; nothing changed')
    a = text.index(begin)
    b = text.index(end, a + len(begin))
    return text[:a] + replacement + text[b:]


VALIDATOR = '''def validate_b7_source_mappings(tables_data, verses_by_coord, verses_by_id):
    """Fail closed on missing or wrong MT-canonical verse mapping and word membership.

    The check is exhaustive for the Macula Hebrew/MorphHB exported rows, but it
    is a structural audit, not an independent philological word-alignment proof.
    """
    books = {int(b["id"]): b["usfm"] for b in tables_data["books"]}
    crosswalk = {}
    for mapping in tables_data["versification_mappings"]:
        ref = mapping.get("to_ref") or ""
        if not ref.startswith("MT:"):
            continue
        vid = int(mapping["canonical_verse_id"])
        if ref in crosswalk:
            raise RuntimeError(f"B7 duplicate MT mapping: {ref}")
        crosswalk[ref] = vid
    if len(crosswalk) < 2088:
        raise RuntimeError(f"B7 insufficient MT crosswalk: {len(crosswalk)} entries; expected at least 2088")

    summary = {}
    for table_name, ch_field, verse_field, linked_field in (
        ("macula_hebrew_morphemes", "chapter_mt", "verse_mt", "word_id"),
        ("morphhb_tokens", "chapter", "verse_nr", "step_word_id"),
    ):
        checked = shifted = linked = unresolved = tests_skipped = 0
        for row in tables_data[table_name]:
            if table_name == "morphhb_tokens" and str(row.get("morphhb_id") or "").startswith("test"):
                tests_skipped += 1
                continue
            book, ch, verse = int(row["book"]), int(row[ch_field]), int(row[verse_field])
            source_ref = f"MT:{books[book]}.{ch}.{verse}"
            expected_id = crosswalk.get(source_ref)
            if expected_id is None:
                expected_id = verses_by_coord.get((book, ch, verse))
            actual_id = row.get("canonical_verse_id")
            if actual_id is None or expected_id is None or int(actual_id) != int(expected_id):
                raise RuntimeError(
                    f"B7 wrong/missing verse: table={table_name} row={row['id']} "
                    f"source={source_ref} actual={actual_id} expected={expected_id}")
            canonical = verses_by_id[int(actual_id)]
            linked_word = row.get(linked_field)
            if linked_word is not None:
                if int(linked_word) not in canonical["word_ids"]:
                    raise RuntimeError(
                        f"B7 word not in canonical verse: table={table_name} "
                        f"row={row['id']} word={linked_word} verse={actual_id}")
                linked += 1
            else:
                unresolved += 1
            if (int(canonical["book"]), int(canonical["chapter"]), int(canonical["verse_nr"])) != (book, ch, verse):
                if source_ref not in crosswalk:
                    raise RuntimeError(f"B7 shifted source lacks crosswalk: {source_ref}")
                shifted += 1
            checked += 1
        summary[table_name] = {"checked": checked, "shifted": shifted,
                               "linked": linked, "unresolved": unresolved,
                               "excluded_test_records": tests_skipped}

    for source_id, canonical_ref, expected_word_id in (
        ("19AxB", (19, 3, 0), 88044),
        ("01SDx", (1, 31, 55), 138884),
    ):
        row = next((r for r in tables_data["morphhb_tokens"]
                    if r.get("morphhb_id") == source_id), None)
        if row is None:
            raise RuntimeError(f"B7 canary source token absent: {source_id}")
        expected_verse_id = verses_by_coord[canonical_ref]
        if (int(row["canonical_verse_id"]) != expected_verse_id or
                int(row["step_word_id"]) != expected_word_id):
            raise RuntimeError(f"B7 canary incorrect: {source_id} -> {canonical_ref} "
                               f"word_id {expected_word_id}")

    print("[B7] Exhaustive source-reference and verse-membership gate passed:",
          summary, flush=True)
    return summary


'''


def patch(source: str) -> str:
    if 'def validate_b7_source_mappings(' in source:
        raise RuntimeError('B7 patch already appears present; review locally instead of reapplying')
    out = source

    out = once(out, 'CORPUS_DIR = ARTIFACTS_DIR / "static-corpus"',
               'CORPUS_DIR = ARTIFACTS_DIR / "static-corpus-b7-candidate"', 'isolated corpus candidate')
    out = once(out, 'BACKUP_DIR = ARTIFACTS_DIR / "db-backup"',
               'BACKUP_DIR = ARTIFACTS_DIR / "db-backup-b7-candidate"', 'isolated backup candidate')
    out = once(out, 'CACHE_DIR = ARTIFACTS_DIR / "export-cache"',
               'CACHE_DIR = ARTIFACTS_DIR / "export-cache-b7-candidate"', 'isolated export cache')

    old_key = '''ANON_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY") or ENV.get("VITE_SUPABASE_ANON_KEY") or ""

if not ANON_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_ANON_KEY in environment or .env")'''
    new_key = '''# Private build-only credential; never publish or commit this value.
EXPORT_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ENV.get("SUPABASE_SERVICE_ROLE_KEY") or ""
if not EXPORT_KEY:
    raise RuntimeError("B7 export requires SUPABASE_SERVICE_ROLE_KEY in the local private environment")'''
    out = once(out, old_key, new_key, 'authenticated exporter')
    out = once(out, '''        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",''',
               '''        "apikey": EXPORT_KEY,
        "Authorization": f"Bearer {EXPORT_KEY}",''', 'private RPC credentials')

    cache_begin = '''    if cache_file.exists():
        try:
            with gzip.open(cache_file, "rt", encoding="utf-8") as fh:
                cached = json.load(fh)
            if isinstance(cached, list) and len(cached) > 0:
                print(f"  [cache hit] {table_key}: {len(cached):,} rows", flush=True)
                return cached
        except Exception:
            pass

'''
    out = once(out, cache_begin,
               '''    # B7: never trust cached source mappings after reconciliation.
    if cache_file.exists():
        print(f"  [B7] Re-exporting {table_key}; ignoring cached previous evidence", flush=True)

''', 'table data cache bypass')

    # A second cache returned old .gz assets based on matching record/shard counts!
    meta_begin = '''    if meta_cache_file.exists():
        try:
            cached_meta = json.loads(meta_cache_file.read_text(encoding="utf-8"))
            if (
                cached_meta.get("total_rows") == len(rows)
                and cached_meta.get("shard_count") == len(list(out_dir.glob("part-*.jsonl.gz")))
            ):
                return cached_meta
        except Exception:
            pass
'''
    out = once(out, meta_begin,
               '''    # B7: never reuse compressed shards based solely on unchanged row counts.
    # All bytes are rebuilt deterministically from the fresh source rows.
''', 'compiled table shard cache bypass')

    out = between(out,
                  '    # Check if already written to .artifacts/static-corpus/tables/ from a completed Step 4 run\n',
                  '    # Build fast lookup maps for terminal resolution\n',
                  '    # B7: reparse every pinned XML file to rebuild all terminal word identities.\n\n',
                  'stale Macula syntax-shard cache')

    out = once(out,
               '            semantic_frame = (el.attrib.get("frame") or "").strip() or None',
               '            semantic_frame = None  # restricted Macula field; never publish',
               'restricted XML semantic frame')
    out = once(out, '    "ln",\n}', '    "ln",\n    "frame",\n    "semantic_frame",\n    "greekstrong",\n}',
               'forbidden field registry')
    out = once(out, '''                "semantic_frame": n.get("semantic_frame"),\n''',
               '', 'hydrated syntax API redaction')

    # Keep no restricted frame data in either mapped or source-only tree shards.
    out = once(out,
               '''    tables_data["syntax_nodes"] = all_syntax_nodes\n''',
               '''    for node in all_syntax_nodes:
        node.pop("semantic_frame", None)
    for node in unmapped_nodes_all:
        node.pop("semantic_frame", None)
    tables_data["syntax_nodes"] = all_syntax_nodes
''', 'static syntax field redaction')

    out = between(out,
                  '            # Also include fallback direct (canonical_book -> lxx_book_no, same chapter & verse) if unmapped\n',
                  '            verses_payload[str(vnr)] = {\n',
                  '''            # B7: never invent a Greek verse counterpart by assuming identical numerals.
            # If explicit source-evidence mappings are absent, leave LXX targets empty.
''', 'LXX fabricated direct-reference fallback')

    out = once(out, '"macula_gated_field_values": 2294,',
               '"macula_gated_field_values": len(tables_data["macula_gated_field_values"]),',
               'non-live gated field count')
    out = once(out, 'def main() -> None:\n', VALIDATOR + 'def main() -> None:\n',
               'B7 validator implementation')
    out = once(out, '    start_time = time.time()\n',
               '''    start_time = time.time()
    # Never merge a new B7 candidate into an old, partially rebuilt corpus.
    if CORPUS_DIR.exists() and any(CORPUS_DIR.iterdir()):
        raise RuntimeError(f"B7 output directory already contains data: {CORPUS_DIR}. "
                           "Move it to a dated archive before a completely fresh build.")
    if BACKUP_DIR.exists() and any(BACKUP_DIR.iterdir()):
        raise RuntimeError(f"B7 backup candidate already contains data: {BACKUP_DIR}. "
                           "Preserve it externally before rebuilding.")
''', 'fresh candidate output safety')
    out = once(out, '    # Step 4: Writing Versioned Table Shards', '    # Step 4: Writing Versioned Table Shards', 'noop') if False else out
    out = once(out, '    print("\n=== Step 4: Writing Versioned Table Shards (.jsonl.gz) ===", flush=True)\n',
               '''    # B7: distinguish text-presence from textual equivalence for MT/LXX maps.
    lxx_available = {
        (int(w["book_no"]), int(w["chapter"]), w.get("chapter_suffix") or "",
         int(w["verse_nr"]), w.get("verse_suffix") or "")
        for w in tables_data["lxx_swete_words"]
    }
    lxx_counts = {"source_text_present": 0, "source_text_absent": 0,
                  "no_source_edition": 0}
    for row in tables_data["hebrew_lxx_verse_map"]:
        if row.get("lxx_book_no") is None:
            status = "no_source_edition"
        else:
            key = (int(row["lxx_book_no"]), int(row["lxx_chapter"]),
                   row.get("lxx_chapter_suffix") or "", int(row["lxx_verse_nr"]),
                   row.get("lxx_verse_suffix") or "")
            status = "source_text_present" if key in lxx_available else "source_text_absent"
        row["b7_target_text_status"] = status
        lxx_counts[status] += 1
    if lxx_counts["source_text_absent"]:
        print("[B7] Unresolved LXX references retained but not promoted to aligned Greek tokens:",
              lxx_counts, flush=True)

    print("\n=== Step 4: Writing Versioned Table Shards (.jsonl.gz) ===", flush=True)
''', 'LXX source availability annotation')
    out = once(out, '''            v_lxx_maps = sorted(lxx_map_by_verse_id.get(vid, []), key=lambda r: int(r["id"]))
''', '''            v_lxx_all = sorted(lxx_map_by_verse_id.get(vid, []), key=lambda r: int(r["id"]))
            v_lxx_maps = [r for r in v_lxx_all if r.get("b7_target_text_status") == "source_text_present"]
            v_lxx_unresolved = [r for r in v_lxx_all if r.get("b7_target_text_status") != "source_text_present"]
''', 'LXX unverified mapping quarantine')
    out = once(out, '''                "hebrew_lxx_verse_map": v_lxx_maps,
''', '''                "hebrew_lxx_verse_map": v_lxx_maps,
                "hebrew_lxx_unresolved_mappings": v_lxx_unresolved,
''', 'LXX unresolved metadata retained')
    out = once(out, '    # Step 3: Parse all 983 Macula XML files\n',
               '''    # Gate all Hebrew/MorphHB reference mappings before rebuilding the corpus.
    validate_b7_source_mappings(tables_data, verses_by_coord, verses_by_id)

    # Step 3: Parse all 983 Macula XML files
''', 'B7 validator invocation')

    ast.parse(out, filename=str(TARGET))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true', help='validate source markers and Python syntax; no changes')
    mode.add_argument('--apply', action='store_true', help='write guarded patch and immutable original backup')
    args = parser.parse_args()
    if not TARGET.is_file():
        raise SystemExit(f'Missing {TARGET} (run from local BibleResearch root)')
    source = TARGET.read_text(encoding='utf-8')
    updated = patch(source)
    digest = hashlib.sha256(source.encode('utf-8')).hexdigest()[:12]
    backup = TARGET.with_name(TARGET.name + '.pre-b7-' + digest)
    if args.check:
        print(f'PASS: all source markers matched; candidate compiles. Existing source sha256={digest}.')
        print('No local files changed. Use --apply only after verifying local backup and worktree state.')
        return
    if backup.exists():
        raise RuntimeError(f'Backup {backup} already exists; refusing to overwrite')
    backup.write_text(source, encoding='utf-8')
    TARGET.write_text(updated, encoding='utf-8')
    print(f'B7 exporter patched: {TARGET}')
    print(f'Original backed up: {backup}')
    print('Candidate artifacts will write to .artifacts/static-corpus-b7-candidate/')
    print('DO NOT deploy until the entire local corpus and deployed RPC mapping tests pass.')


if __name__ == '__main__':
    main()