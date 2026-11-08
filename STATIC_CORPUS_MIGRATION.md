# STATIC_CORPUS_MIGRATION.md — Hybrid Cloudflare Static Corpus & Supabase Dynamic State Migration

## 1. Executive Summary & Architectural Boundary

BibleResearch separates **immutable biblical source evidence** from **dynamic research and application state**:

- **Cloudflare Workers Static Assets (`bibleresearch-corpus` Worker):**
  - Stores and serves versioned, checksum-verified, immutable public biblical datasets, the **complete 983-file MACULA syntax corpus** (Hebrew WLC, Greek Nestle 1904, Greek SBLGNT), and precomputed chapter, Septuagint, lexical, occurrence, and syntactic-pattern retrieval indexes.
  - Exposes deterministic, read-only JSON endpoints (`/manifest.json`, `/tables/<table>/part-<nnnn>.jsonl.gz`, `/v1/chapters/...`, `/v1/lxx/...`, `/v1/lexical/...`, `/v1/syntax/...`, and `/v1/rpc/<operation>`) with explicit decompression (`Content-Type: application/json; charset=utf-8`) and raw `.jsonl.gz` shard verification.
  - Strictly within Cloudflare Workers Free plan limits: **< 2,000 static assets** (limit: 20,000 per Worker version) and **< 8 MiB uncompressed / < 3 MiB compressed per asset** (limit: 25 MiB per file).
- **Supabase PostgreSQL (`ejoperxiwxlcbsqrkrvb`):**
  - Retains authentication and user sessions (`auth.users`), private occurrence translation choices (`word_translation_choices`), notes and connections (`notes`, `note_anchors`, `note_connections`, `note_blocks`, `note_revisions`, `note_authors`, `note_settings`), editable lexical definitions (`words.biblical_def`, `words.physical_def`), reviewed and draft scholarly assertions (`assertions`, `assertion_evidence`, `research_nodes`, `concepts`, `concept_properties`, `concept_external_links`), chronology models/runs/assertions/revisions (`chronology_*`), context-aware biblical geography (`places`, `place_locations`, `verse_geography`, `passage_geography`), license gating (`field_license_registry`), and quarantined records (`quarantined_evidence_records`).
  - Reduces PostgreSQL storage consumption from **1,455 MB** (`1,525,476,499` bytes) to **~350–370 MB** (well below the 500 MB Supabase Free limit and the 400 MB target) in Stage G after full backup, Cloudflare verification, hybrid integration, and explicit user approval.

---

## 2. Live Database Storage & Classification Audit (2026-11-07)

Measured against live Supabase project `ejoperxiwxlcbsqrkrvb` (`pg_database_size(current_database()) = 1,455 MB` / `1,525,476,499` bytes; `public` schema = `1,437 MB`):

### 2.1 Purely Immutable Corpus & Evidence Tables (Offload Candidates — ~1,033 MB)

| Table | Rows | Total Size | Heap / Indexes | Classification & Provenance | Dependent SQL RPCs / Services |
| :--- | ---: | ---: | :--- | :--- | :--- |
| `public.macula_hebrew_morphemes` | 475,911 | **200 MB** | 123 MB / 78 MB | Immutable source evidence (`Clear-Bible/macula-hebrew` @ `47db250`, CC BY 4.0) | `lookup_hebrew_verse_evidence_v1`, `get_hebrew_septuagint_parallel_v1`, `lookup_hebrew_to_greek_alignments_v1`, `lookup_greek_to_hebrew_alignments_v1`, `lookup_cross_testament_greek_v1`, `get_hebrew_import_status_v1`, `audit_evidence_coverage_v1`, `verify_referential_integrity_v1` |
| `public.macula_greek_tokens` | 275,520 | **123 MB** | 76 MB / 47 MB | Immutable source evidence (`Clear-Bible/macula-greek` @ `8423afe`, Nestle1904 `137,779` + SBLGNT `137,741`, CC BY 4.0) | `lookup_greek_verse_evidence_v1`, `audit_evidence_coverage_v1` |
| `public.word_form_lemmas` | 279,484 | **115 MB** | 82 MB / 33 MB | Immutable STEP morphological form-to-lemma links (`STEPBible` CC BY 4.0). Note: `(word_id, lemma_id)` mapping is also used by `get_notes_for_passage_v1` and `get_notes_for_word_v1` | `lookup_word_to_lemma_senses_v1`, `lookup_lemma_occurrences_v1`, `lookup_lemma_english_glosses_v1`, `lookup_lexical_semantics_v1`, `lookup_passage_tokens_syntax_v1`, `get_verse_research_v2`, `get_word_formation_v1`, `get_notes_for_passage_v1`, `get_notes_for_word_v1` |
| `public.lxx_swete_words` | 588,579 | **112 MB** | 63 MB / 50 MB | Immutable diplomatic Greek OT text (`nathans/lxx-swete` @ `26bad3e`, CC BY-SA 4.0) | `lookup_septuagint_passage_v1`, `lookup_septuagint_by_canonical_verse_v1`, `compare_hebrew_septuagint_passage_v1`, `get_hebrew_septuagint_parallel_v1`, `lookup_cross_testament_greek_v1`, `audit_evidence_coverage_v1` |
| `public.morphhb_tokens` | 306,786 | **101 MB** | 61 MB / 40 MB | Immutable OSHB Hebrew/Aramaic tokens & Ketiv/Qere (`openscriptures/morphhb` @ `3d15126`, CC BY 4.0) | `lookup_hebrew_verse_evidence_v1`, `get_hebrew_import_status_v1`, `audit_evidence_coverage_v1` |
| `public.syntax_nodes` | 125,010 (DB) $\to$ **~1,420,000** (Full 983 files) | **97 MB** (DB partial) | 51 MB / 46 MB | Immutable MACULA constituent syntax hierarchy (`macula-hebrew-wlc`, `macula-greek-nestle1904`, `macula-greek-sblgnt`, `step-tahot`/`step-tagnt`) | `lookup_syntax_tree_v1`, `validate_syntax_tree_integrity_v1`, `lookup_passage_tokens_syntax_v1`, `lookup_hebrew_verse_evidence_v1`, `audit_evidence_coverage_v1` |
| `public.verse_translation_sources` | 443,524 | **86 MB** | 56 MB / 30 MB | Immutable STEP TAHOT/TAGNT token renderings (`STEPBible` CC BY 4.0) | `get_verse_translations_v1`, `save_word_translation_v1`, `validate_word_translation_choice_v1`, `get_verse_research_v1`, `get_verse_research_v2`, `lookup_passage_tokens_syntax_v1`, `lookup_lemma_occurrences_v1`, `lookup_lemma_english_glosses_v1`, `lookup_lexical_semantics_v1`, `get_reader_word_v1` |
| `public.tagnt_tokens` | 142,096 | **64 MB** | 40 MB / 24 MB | Immutable STEP TAGNT Greek tokens, textual variants & edition flags (`STEPBible` CC BY 4.0) | `lookup_greek_verse_evidence_v1`, `audit_evidence_coverage_v1` |
| `public.syntax_edges` | 121,477 (DB) $\to$ **~1,390,000** (Full 983 files) | **59 MB** (DB partial) | 35 MB / 24 MB | Immutable MACULA parent-child & dependency syntax edges | `lookup_syntax_tree_v1`, `validate_syntax_tree_integrity_v1`, `lookup_passage_tokens_syntax_v1`, `lookup_hebrew_verse_evidence_v1`, `audit_evidence_coverage_v1` |
| `public.lexeme_identifiers` | 113,595 | **32 MB** | 11 MB / 21 MB | Immutable external lexicon cross-reference IDs (`dStrong`, `uStrong`, `STEP`) | `lookup_lexical_semantics_v1`, `audit_evidence_coverage_v1` |
| `public.edition_passages` | 62,418 | **14 MB** | 6.8 MB / 7.0 MB | Immutable per-verse witness & token count metadata (`STEPBible`) | `lookup_passage_tokens_syntax_v1` |
| `public.reader_rendering_groups` | 98,133 | **13 MB** | 6.6 MB / 6.0 MB | Precomputed Strong's English rendering frequency summaries | `get_reader_overview_v1` |
| `public.hebrew_lxx_verse_map` | 22,633 | **9.9 MB** | 3.7 MB / 6.0 MB | Immutable STEP `TVTMS.txt` MT$\leftrightarrow$LXX versification mappings | `compare_hebrew_septuagint_passage_v1`, `get_hebrew_septuagint_parallel_v1`, `lookup_septuagint_passage_v1`, `lookup_septuagint_by_canonical_verse_v1` |
| `public.reader_english_verses` | 31,215 | **7.1 MB** | 4.8 MB / 2.2 MB | Public-domain World English Bible (`webp-2026-11`) reference verses | `get_reader_passages_v1`, `lookup_passage_tokens_syntax_v1` |
| `public.versification_mappings` | 2,131 | **960 kB** | 288 kB / 672 kB | Immutable edition versification differences | `lookup_passage_tokens_syntax_v1`, `compare_hebrew_septuagint_passage_v1` |
| `public.token_morphemes` | 2,321 | **832 kB** | 424 kB / 408 kB | Immutable token morpheme decompositions | `lookup_passage_tokens_syntax_v1`, `verify_referential_integrity_v1` |
| `bible_internal.macula_syntax_import_files` | 983 | **488 kB** | 184 kB / 304 kB | 983-file Macula syntax manifest with pinned git blob SHA-1 digests | `import_macula_syntax_file_v1`, `verify_imported_macula_source_v1` |
| `public.cross_token_mappings` | 147 | **184 kB** | 32 kB / 152 kB | Explicit STEP$\leftrightarrow$OSHB$\leftrightarrow$MACULA token links | `lookup_hebrew_verse_evidence_v1` |
| `bible_internal.macula_syntax_unmapped_nodes` | 60 (DB) $\to$ **~125** (Full 983 files) | **136 kB** | 32 kB / 104 kB | Source-only Macula syntax nodes with no canonical verse counterpart | Syntax audit & source-only queries |

### 2.2 Mixed Tables (Separated by Column / Row Provenance)

| Table | Rows | Total Size | Immutable Columns / Rows (Exported to Cloudflare) | Mutable Columns / Rows (Retained in Supabase) | Foreign Key & ID Stability |
| :--- | ---: | ---: | :--- | :--- | :--- |
| `public.words` | 150,105 | **82 MB** | `id`, `strongs_nr`, `grammar_code`, `original_word`, `transliteration`, `co_occurrences`, `english_translations`, `gematria` | `biblical_def`, `physical_def` (editable lexical definitions & interpretations) | Stable `words.id` (`1..150105`). Referenced by `note_anchors.word_id` and `verses.word_ids`. Retained in Supabase and exported (immutable columns) to Cloudflare. |
| `public.verses` | 31,203 | **16 MB** | `id`, `book`, `chapter`, `verse_nr`, `word_ids` | `millennium` (legacy chronology classification) | Stable `verses.id` (`1..31203`). Referenced by `chronology_*`, `note_anchors`, `verse_geography`, `word_translation_choices`. Retained in Supabase and exported (immutable columns) to Cloudflare. |
| `public.lexemes` | 22,719 | **28 MB** | `id`, `lexeme_key`, `base_strongs`, `extended_strongs`, `disambiguated_strongs`, `unified_strongs`, `language`, `lemma`, `transliteration`, `primary_gloss`, ` Abbott-Smith/STEP metadata`, `source_release_id`, `lemma_id` | `homograph_note`, custom polysemous candidate annotations (`H5869a`/`b`) | Stable `lexemes.id` & `lexeme_key`. Retained in Supabase and exported to Cloudflare. |
| `public.entity_relationships` | 15,259 | **9.4 MB** | Source-imported lexical equivalents (`origin_mode = 'directly_imported'` / `'derived_from_attested_tokens'`) | Scholarly/curated entity relationship assertions and review states | Stable `entity_relationships.id`. Retained in Supabase and exported to Cloudflare. |
| `public.hebrew_lxx_word_alignments` | 110 | **176 kB** | `alignment_tier = 'documented_textual'` & `'computationally_inferred_candidate'` | `alignment_tier = 'scholarly_interpretation'` & `verification_status` | Stable `alignment_key`. Retained in Supabase and exported to Cloudflare. |

### 2.3 Purely Dynamic & Compact Reference Tables Retained in Supabase (~350 MB after cleanup)

- **Notes & Connections Layer (`notes`, `note_anchors`, `note_connections`, `note_blocks`, `note_revisions`, `note_authors`, `note_kinds`, `note_connection_types`, `note_block_types`, `note_settings`):** Currently 60 MB due to rolled-back 40,000-row benchmark index bloat in `NOTE-04`; drops to **< 1 MB** after `REINDEX`.
- **Private User Translations (`word_translation_choices`):** Owner-scoped via `auth.uid()` RLS (**48 kB**).
- **Chronology Layer (`chronology_models`, `chronology_sources`, `chronology_runs`, `chronology_active_runs`, `chronology_events`, `chronology_event_links`, `chronology_assertions`, `chronology_assignments`, `chronology_assignment_assertions`, `chronology_assertion_evidence`, `chronology_evidence`, `chronology_revisions`):** Dynamic chronological models, hypotheses, and revisions (**~135 MB**).
- **Geography Layer (`geography_sources`, `places`, `place_locations`, `verse_geography`, `passage_geography`):** Context-aware biblical geography and disputed site identifications (**~9.2 MB**).
- **Concepts & Scholarly Assertions (`concepts`, `concept_aliases`, `concept_properties`, `concept_external_links`, `research_nodes`, `assertions`, `assertion_evidence`, `semantic_annotations`):** Active scholarly research graph (**~6.0 MB**).
- **Core Lexical & Formation Catalog (`books`, `book_aliases`, `lemmas`, `lexical_roots`, `lemma_root_links`, `lexical_senses`, `lexical_formations`, `lemma_components`, `lexical_connections`, `canonical_entities`, `field_license_registry`, `quarantined_evidence_records`):** Compact reference catalog (**~50 MB**).

---

## 3. Licensing & Restricted-Field Enforcement

Every exported file and `manifest.json` enforces the project's licensing and provenance laws (`DATA_SOURCES.md`, `ARCHITECTURE.md`, and `public.field_license_registry`):

1. **Strictly Excluded from Public Static Export:**
   - **Online Bible `Meaning` (column 7 of `TBESH.txt`):** Never imported or exported.
   - **UBS Dictionary of Biblical Hebrew (`SDBH`):** `sdbh`, `lexdomain`, `coredomain`, `contextualdomain` (`disabled_restricted` in `field_license_registry`).
   - **Greek UBS MARBLE / Louw–Nida:** `domain`, `ln` (`disabled_restricted` in `field_license_registry`).
   - **MACULA Hebrew `frame` in `macula_gated_field_values`:** `disabled_unverified` in `field_license_registry` — retained internally in database for rights auditing only; never exported to public static assets.
   - **Private User Content & Credentials:** `auth.users`, `word_translation_choices`, `notes`, `note_revisions`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DATABASE_URL`.
2. **Required Attributions Preserved in `manifest.json` and API Responses:**
   - **STEPBible (`TAHOT`, `TAGNT`, `TBESH`, `TBESG`, `TVTMS`, `TIPNR`):** CC BY 4.0, Tyndale House, Cambridge (`https://github.com/STEPBible/STEPBible-Data`).
   - **Clear-Bible (`macula-hebrew` @ `47db250`, `macula-greek` @ `8423afe`):** CC BY 4.0, Clear Bible, Inc. / Biblica, Inc.
   - **OpenScriptures (`morphhb` @ `3d15126`, `HebrewLexicon`):** CC BY 4.0 (morphology/cantillation) over Public Domain WLC and BDB/Strong's.
   - **Swete Septuagint (`nathans/lxx-swete` @ `26bad3e`):** CC BY-SA 4.0 (ShareAlike notice preserved in `manifest.json` and Septuagint API responses).
   - **World English Bible (`webp-2026-11`):** Public Domain (`ebible.org`).

---

## 4. Complete 983-File MACULA Syntax Corpus Architecture

Earlier PostgreSQL ingestion stopped at 94 of 983 files due to database size limits. The static corpus pipeline completes **all 983 source XML files** directly from the pinned upstream repositories in `.artifacts/sources/`:

- **`macula-hebrew-wlc` (`edition_id = 11`, `source_release_id = 7`):** 929 chapter XML files (`WLC/lowfat/*.xml` @ `47db250bd55d0d8577f2a94fba114ef16c35b23c`).
- **`macula-greek-nestle1904` (`edition_id = 18`, `source_release_id = 8`):** 27 book XML files (`Nestle1904/lowfat/*.xml` @ `8423afe47b9e8f24b7772e808af45c7159a6fe7e`).
- **`macula-greek-sblgnt` (`edition_id = 19`, `source_release_id = 8`):** 27 book XML files (`SBLGNT/lowfat/*.xml` @ `8423afe47b9e8f24b7772e808af45c7159a6fe7e`).

### Conversion & Integrity Rules (100% faithful to `bible_internal.import_macula_syntax_file_v1`):
1. **Git Blob SHA-1 & Byte Verification:** Every XML file is verified against the 983-row manifest in `bible_internal.macula_syntax_import_files` (`octet_length` and `sha1("blob " + bytes + "\0" + content)`).
2. **Complete Constituent Hierarchy:** Walks `/chapter/sentence` (Hebrew) and `/book/sentence` (Greek) recursively across `wg`, `c` (`compound_word_group`), and `w` (`terminal`), preserving `node_key`, `parent_node_id`, `tree_id`, `depth`, `sibling_order`, `node_type` (`sentence`, `clause`, `phrase`, `compound_word_group`, `terminal`), `class_label`, `rule_label`, `cl_type`, `syntactic_role`, `is_head`, `is_terminal`, `terminal_xml_id`, `terminal_word_id`, `terminal_source_ref`, `terminal_mapping_status`, `grammar_summary` (`@morph`), and `semantic_frame` (`@frame`).
3. **Canonical Terminal Mapping & Unmapped Preservation:**
   - Hebrew terminals (`w`) map via `xml_id = macula_hebrew_morphemes.macula_id` (`exact_xml_id`).
   - Greek terminals (`w`) map via `xml_id = macula_greek_tokens.xml_id` and `edition_key` (`exact_xml_id`), with fallback to `source_ref` (`BOOK CH:V!POS`) against `public.verses` (`source_reference_only`).
   - Any node whose subtree has no mapped canonical `verse_id` (such as 3 John 1:15 in Greek Nestle1904/SBLGNT where canonical 3 John has 14 verses) is retained in `macula_syntax_unmapped_nodes` (`mapping_status = 'not_in_canonical_verse'`) **without fabricating canonical verse references**.
4. **Cross-Verse Span Propagation:** Bottom-up span computation sets `verse_id = min(first_verse)`, `end_verse_id = max(last_verse)`, `start_word_position = first_position`, `end_word_position = greatest(first_position, last_position)`, and `is_cross_verse = (verse_id <> end_verse_id)`.

---

## 5. Static Corpus Layout & Retrieval Architecture (`bibleresearch-corpus`)

Generated under `.artifacts/static-corpus/` (git-ignored):

1. **`/manifest.json`:** Versioned release manifest listing corpus version, build timestamp, git commit, source licenses, table schemas, row counts, shard paths, compressed/uncompressed byte sizes, SHA-256 digests, and index shard inventory.
2. **`/tables/<table>/part-<nnnn>.jsonl.gz`:** Deterministic PK-ordered row-level JSONL shards (capped at $\le 8$ MiB uncompressed) for complete table reproducibility and database restoration.
3. **`/v1/catalog/metadata.json.gz`:** Canonical books (66), Swete LXX books (55), source releases/editions, license registry, `verses` coordinate index (`31,203` verses), and precomputed corpus-wide audit/integrity summaries (`audit_evidence_coverage_v1`, `verify_referential_integrity_v1`, `validate_syntax_tree_integrity_v1`, `get_hebrew_import_status_v1`).
4. **`/v1/chapters/b<book>-c<chapter>.json.gz` (`1,189` shards):** Pre-joined chapter bundles containing STEP tokens, `verse_translation_sources`, `token_morphemes`, `word_form_lemmas`, `edition_passages`, `versification_mappings`, `reader_english_verses`, `reader_rendering_groups`, `morphhb_tokens`, `macula_hebrew_morphemes`, `cross_token_mappings`, `tagnt_tokens`, `macula_greek_tokens` (Nestle1904 & SBLGNT), `hebrew_lxx_verse_map`, `hebrew_lxx_word_alignments`, and **complete 983-file Macula `syntax_trees` and `syntax_edges`** covering every verse in `(book, chapter)`.
5. **`/v1/lxx/b<book_no>.json.gz` (`55` shards):** Complete Swete Septuagint tokens and MT$\leftrightarrow$LXX mappings per Swete book (`1..59`).
6. **`/v1/lexical/strongs-<bucket>.json.gz` (`128` shards) & `/v1/lexical/words-<bucket>.json.gz` (`128` shards) & `/v1/lexical/query-index.json.gz`:** Precomputed lexical semantics, word-to-lemma senses, lemma occurrences, attested English glosses, root relatives, Hebrew$\leftrightarrow$Greek alignments, cross-testament Greek occurrences, and `Prompt 1–4` word occurrences/co-occurrences/relationships.
7. **`/v1/syntax/search-index.json.gz`:** Precomputed index of syntactic roles, clause/phrase rules (`rule_label`, `class_label`, `cl_type`), semantic frames, cross-verse trees, and `macula_syntax_unmapped_nodes` (including 3 John 1:15).

---

## 6. Staged Cutover & Reclamation Protocol

- **Stage A (Backup):** Export full, restorable table snapshots and schema metadata to `.artifacts/db-backup/` and `.artifacts/static-corpus/tables/`.
- **Stage B (Export & Complete Macula):** Run `scripts/build-static-corpus.mjs` / `python scripts/export-static-corpus.py`, `python scripts/verify-static-corpus.py`, and `python scripts/test-static-corpus.py -v`.
- **Stage C (Deploy):** Deploy isolated `bibleresearch-corpus` Worker (`npx.cmd wrangler deploy --config wrangler.corpus.jsonc`).
- **Stage D (Remote Verify):** Run `node scripts/verify-static-corpus-remote.mjs --all` against `https://bibleresearch-corpus.<subdomain>.workers.dev`.
- **Stage E & F (Integrate & Cut Over):** Route `BibleRPC` (`src/api/rpc.ts`), `bible-mcp` (`supabase/functions/bible-mcp/`), and PostgreSQL static-table RPCs through the hybrid gateway, composing dynamic Supabase records (`word_translation_choices`, `notes`, `chronology_*`, `places`, `assertions`, `field_license_registry`) deterministically. Run all equivalence and regression suites.
- **Stage G (Reclaim — Explicit User Approval Gate):** Only after all verification suites pass and explicit user approval is granted, execute `scripts/reclaim-supabase-storage.sql` to remove redundant PostgreSQL copies of offloaded static tables and reindex bloated tables, reducing `pg_database_size(current_database())` from **1,455 MB** to **~350–370 MB**.
