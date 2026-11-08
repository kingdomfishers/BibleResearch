# MIGRATION_HANDOFF.md — Hybrid Cloudflare Static Assets + Supabase Certification Contract

## 1. Files Changed & Architectural Decisions

### Files Created or Modified
1. **`scripts/corpus-worker.mjs`** (Deployed to Cloudflare Worker `bibleresearch-corpus`, Version `9644fd2d-6d05-40d8-b157-5b61c11a77b5`):
   - Added `runLiveCorpusVerification(env)`: Loads `/manifest.json` from `env.ASSETS`, verifies total asset count (`1,890` assets) and Macula file count (`983` files), fetches 12 representative compressed shards across lexical, syntax, OT Hebrew, Aramaic, Minor Prophets, NT Greek, and Septuagint corpora, verifies live compressed byte lengths and live `crypto.subtle.digest('SHA-256')` digests against `manifest.json` (`v1_retrieval_shards`), and runs live structural checks on syntax trees (parent node existence, cycle/depth validation, terminal XML IDs, span ordering) and restricted Macula field exclusions (`sdbh`, `lexdomain`, `coredomain`, `ln`, `domain`).
   - Wired `handleValidateSyntaxTreeIntegrityV1`, `handleVerifyReferentialIntegrityV1`, `handleAuditEvidenceCoverageV1`, and `handleGetHebrewImportStatusV1` to `runLiveCorpusVerification(env)` so any missing or corrupted asset fails closed (`status: "FAIL"`, `is_valid: false`).
   - Added `handleGetWordFormLemmasBatchV1` (`get_word_form_lemmas_batch_v1`) to batch-fetch `word_form_lemmas` arrays from `/v1/words/<bucket>.json.gz`.
   - Added `handleGetLemmaLexicalSummaryV1` (`get_lemma_lexical_summary_v1` supporting `occurrences`, `glosses`, and `semantics` modes, including the 5 cross-Strong's stem lemma exceptions `3666`, `6349`, `14118`, `15763`, `19621`).
2. **`supabase/migrations/20261108203000_hybrid_rpc_fixes_and_offload.sql`** (Applied to Supabase `ejoperxiwxlcbsqrkrvb`):
   - **Problem 1 Fix (`get_reader_overview_v1`):** Replaced nonexistent `place_locations.is_primary` and `verse_geography.geography_role` references with live schema columns (`place_locations.is_alternative ASC, place_locations.rank_order ASC`, `verse_geography.relationship_type`, `verse_geography.resolution_tier`), enforced `published = true` filtering across `places`, `verse_geography`, and `place_locations`, normalized extended/zero-padded Strong's numbers plus proper-noun (`%Np%`) biblical/historical name matching, and preserved both backward-compatible UI keys (`word_position`, `place_key`, `name`) and enriched metadata (`biblical_name`, `place_type`, `relationship_type`, `role`, `resolution_tier`, `confidence`, `lat`, `lon`).
   - **Problem 2 Fix (Fail-Closed Error & Integrity Handling):** Updated `validate_syntax_tree_integrity_v1`, `verify_referential_integrity_v1`, `audit_evidence_coverage_v1`, `get_hebrew_import_status_v1`, `lookup_syntax_tree_v1` (both overloads), `lookup_passage_tokens_syntax_v1`, `lookup_hebrew_verse_evidence_v1`, `lookup_greek_verse_evidence_v1`, `lookup_septuagint_passage_v1`, `lookup_septuagint_by_canonical_verse_v1`, `compare_hebrew_septuagint_passage_v1`, `get_hebrew_septuagint_parallel_v1`, `get_reader_passages_v1`, and `get_reader_overview_v1` to fail closed (`status: 'FAIL'`, `is_valid: false` on audit RPCs; `status: 'unavailable'`, `error: 'static_corpus_unavailable'` on data RPCs) whenever the Cloudflare Worker is unreachable or returns malformed JSON, while checking `public.verses` first so invalid coordinates/nonexistent verses still return `invalid_request` or `passage_not_found`.
   - **Problems 3 & 4 Fix (Additional 276.43 MiB Offload & Hybrid Composition):**
     - Offloaded `word_form_lemmas` (114.98 MiB), `verse_translation_sources` (86.48 MiB), `lexeme_identifiers` (31.99 MiB), `edition_passages` (13.80 MiB), `reader_rendering_groups` (12.56 MiB), `hebrew_lxx_verse_map` (9.68 MiB), and `reader_english_verses` (6.94 MiB).
     - Updated `get_reader_word_v1`, `get_verse_translations_v1`, `save_word_translation_v1`, `validate_word_translation_choice_v1`, `get_verse_research_v1`, `get_verse_research_v2`, `get_word_formation_v1`, `lookup_word_to_lemma_senses_v1`, `lookup_lemma_occurrences_v1`, `lookup_lemma_english_glosses_v1`, `lookup_lexical_semantics_v1`, `get_notes_for_passage_v1`, and `get_notes_for_word_v1` to compose static corpus evidence from `bibleresearch-corpus` with live PostgreSQL dynamic records (`words`, `verses`, `lemmas`, `lexemes`, `lexical_senses`, `lexical_formations`, `lemma_root_links`, `word_translation_choices`, `notes`, `places`, `chronology_models`).
     - Dropped `word_translation_choices_verse_id_word_position_word_id_fkey` and updated trigger `validate_word_translation_choice_v1()` to validate `(verse_id, word_position, word_id)` against `public.verses.word_ids[word_position] = word_id`.
3. **`scripts/reclaim-supabase-storage.sql`** (Prepared, **kept unexecuted**):
   - Added a mandatory read-only `DO $preflight$ ... $preflight$;` gate at the top that aborts with `RAISE EXCEPTION` unless all 11 live verification checks and the `< 400 MiB` post-reclamation size projection pass.
   - Configured `TRUNCATE TABLE` across all 19 offloaded static tables (`1,035.06 MiB` reclaimed -> `350.43 MiB` remaining).
4. **`scripts/preflight-storage-reclamation.mjs`**:
   - Standalone read-only preflight verification script.
5. **`scripts/verify-canonical-lexical-db.mjs` & `scripts/notes-guard.mjs`**:
   - Updated table row-count checks to consult `audit_evidence_coverage_v1` for offloaded static tables (`edition_passages`, `lexeme_identifiers`, `word_form_lemmas`) when their PostgreSQL row count is `0` post-reclamation.

---

## 2. Exact Commands for Automated Tests

Run these commands from `c:\Projects\BibleResearch` in order:

```powershell
# 1. TypeScript & File Size / @toc Contract Verification
npm.cmd run check:types
npm.cmd run check:size

# 2. Read-Only Storage Reclamation Preflight (11 live gates)
node scripts/preflight-storage-reclamation.mjs

# 3. Canonical Lexical, Morphology, Formation, Greek & Septuagint Suites
node scripts/verify-canonical-lexical-db.mjs
node scripts/verify-word-formation.mjs
node scripts/verify-greek-statistics.mjs
node scripts/verify-septuagint-layer.mjs
node scripts/verify-corpus-integrity.mjs

# 4. Hybrid Equivalence & Remote Static Corpus Shards Verification
node scripts/verify-static-corpus-remote.mjs --all
node scripts/verify-hybrid-equivalence.mjs

# 5. Notes Layer Non-Destructive Guard
node scripts/notes-guard.mjs --compare
node scripts/notes-guard.mjs --static
```

---

## 3. Required Endpoints & Expected Response Schemas

### A. Cloudflare Corpus Worker (`https://bibleresearch-corpus.fluckiger.workers.dev`)
- **`GET /health`**:
  - Expected HTTP `200`: `{"status":"ok","service":"bibleresearch-corpus","version":"1.0.0"}`
- **`GET /manifest.json`**:
  - Expected HTTP `200`: JSON object with `total_assets: 1890`, `v1_retrieval_shards` object containing SHA-256 and `compressed_bytes` for all `/v1/*` shards, and `macula_syntax_import_files` (`983` files).
- **`POST /rpc/<operation>`** (or `POST /rpc` with `{"operation":"<op>","params":{...}}`):
  - `validate_syntax_tree_integrity_v1`: `{"status":"PASS","is_valid":true,"total_nodes":1385305,"total_edges":1360521,"live_asset_verification":{"status":"PASS","manifest_total_assets":1890,"verified_assets_count":12}}`
  - `verify_referential_integrity_v1`: `{"status":"ok","is_valid":true,"live_asset_verification":{"status":"PASS",...}}`
  - `get_reader_overview_v1` (`{"p_book":1,"p_chapter":2,"p_verse":14}`): `{"status":"ok","ranges":{...},"grammar":{...},"place_anchors":[],"previous":{"book":1,"chapter":2,"verse":13},"next":{"book":1,"chapter":2,"verse":15}}` (enriched with PostgreSQL `place_anchors` when called via Supabase RPC).
  - `get_verse_translation_sources_batch_v1` (`{"p_verse_ids":[1]}`): `{"status":"ok","verses":{"1":[{"word_position":1,"word_id":129386,"source_english":"In [the] beginning",...}]}}`
  - `get_word_form_lemmas_batch_v1` (`{"p_word_ids":[46861]}`): `{"status":"ok","words":{"46861":{"word_id":46861,"strongs_nr":"H1254","word_form_lemmas":[...]}}}`
  - `get_lemma_lexical_summary_v1` (`{"p_lemma_id":35,"p_base_strongs":"H1254","p_mode":"occurrences","p_after_verse_id":0,"p_limit":5}`): `{"status":"ok","totals":{"total_tokens":55,"total_verses":47,"distinct_inflected_forms":53,"ambiguous_form_tokens":41},"pagination":{...},"occurrences":[...]}`

### B. Supabase PostgREST RPCs (`https://ejoperxiwxlcbsqrkrvb.supabase.co/rest/v1/rpc/<fn>`)
- **`get_reader_overview_v1`** (`{"p_book":1,"p_chapter":2,"p_verse":14}`):
  - Must return `status: "ok"`, `ranges` (non-empty), `grammar` (12 positions), `previous`, `next`, and `place_anchors` array containing 3 items (`Tigris` at `word_position: 4`, `Assyria` at `word_position: 8`, `Euphrates` at `word_position: 12`), each with `{word_position, place_key, name, biblical_name, place_type, relationship_type, role, resolution_tier, confidence, lat, lon}`.
- **`get_verse_research_v1` & `get_verse_research_v2`**:
  - Must return `status: "ok"`, `verses[0].words` with `translations.source_english` and (in v2) `disambiguated_lemmas`, `morphology`, and top-level `lexical_formations`.
- **`lookup_lexical_semantics_v1`**:
  - Must return `status: "ok"`, `lemmas[*].lexemes[*].registered_identifiers` (5 deterministic identifiers per lexeme), `attested_translation_glosses`, and `surface_forms_summary`.
- **`lookup_lemma_occurrences_v1` & `lookup_lemma_english_glosses_v1`**:
  - Must return `status: "ok"`, exact `totals`, `occurrences`, and `attested_english_glosses`.

### C. Supabase Edge Function MCP (`https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp`)
- **`GET /health`**:
  - Must return HTTP `200` with `status: "ok"`, `tools` count, and `prompts` count.

---

## 4. Dataset & Manifest Integrity Requirements

1. **Manifest Asset Count:** `/manifest.json` must list `total_assets: 1890` and `983` imported Macula syntax files (`929` Hebrew OT chapter files + `27` Greek NT Lowfat book files + `27` Greek NT Nestle1904 book files).
2. **Live Shard SHA-256 Verification:** `runLiveCorpusVerification(env)` must pass on all 12 probed shards (`/v1/lexical/query-index.json.gz`, `/v1/syntax/verse/1.json.gz`, `/v1/syntax/verse/261.json.gz`, `/v1/verses/1.json.gz`, `/v1/verses/155.json.gz`, `/v1/verses/221.json.gz`, `/v1/verses/228.json.gz`, `/v1/verses/261.json.gz`, `/v1/words/46.json.gz`, `/v1/words/129.json.gz`, `/v1/lxx/passage/1_1.json.gz`, `/v1/lxx/lemma/0d.json.gz`) with 0 byte-length or SHA-256 mismatches.
3. **Restricted Field Exclusion:** Zero occurrences of restricted Macula/Louw-Nida/SDBH fields (`sdbh`, `lexdomain`, `coredomain`, `ln`, `domain`, `sensenumber`, `contextualgloss`) in any public shard or RPC response.

---

## 5. Required Semantic & Septuagint Coverage Checks

1. **Septuagint (LXX) Coverage:**
   - `59` Swete books, `30,683` distinct LXX verses, `623,669` tokens in static shards.
   - `22,633` canonical MT-to-LXX verse mappings (`21,750` mapped OT verses + `883` explicitly documented unmapped/versification-shift entries including 9 Psalm superscription shifts such as `PSA 3:0 -> Psalmi 3:1`).
   - `lookup_septuagint_passage_v1`, `lookup_septuagint_by_canonical_verse_v1`, `compare_hebrew_septuagint_passage_v1`, and `get_hebrew_septuagint_parallel_v1` must all return `status: "ok"` / `found: true` on Genesis 1:1 and Psalm 3:0.
2. **Cross-Testament & Lexical Semantics Coverage:**
   - `lookup_cross_testament_greek_v1('G3056', 5)` must return both NT occurrences (`330` tokens) and LXX occurrences (`1,239` tokens via `public.lxx_norm_word_summary`).
   - `lookup_hebrew_to_greek_alignments_v1` and `lookup_greek_to_hebrew_alignments_v1` must return aligned cross-testament equivalents via `public.hebrew_lxx_word_alignments` and `public.macula_greekstrong_morphemes`.
   - Homographs (`H1254a/b/c`, `H5869a/b`) must remain separated and never be merged.

---

## 6. Database Reclamation Targets & Expected Sizes

Calculated from live `pg_database_size(current_database())` and `pg_total_relation_size()` on `ejoperxiwxlcbsqrkrvb`:

| Metric / Relation | Live Size (Bytes) | Live Size (MiB) | Disposition |
|---|---:|---:|---|
| **Current Total Database Size** | `1,452,794,255` | **`1,385.49 MiB`** | Pre-reclamation |
| `public.macula_hebrew_morphemes` | `286,801,920` | `273.52 MiB` | Offloaded -> Truncate in Stage G |
| `public.macula_greek_tokens` | `126,631,936` | `120.77 MiB` | Offloaded -> Truncate in Stage G |
| `public.word_form_lemmas` | `120,569,856` | `114.98 MiB` | Offloaded -> Truncate in Stage G |
| `public.lxx_swete_words` | `106,586,112` | `101.65 MiB` | Offloaded -> Truncate in Stage G |
| `public.morphhb_tokens` | `96,223,232` | `91.77 MiB` | Offloaded -> Truncate in Stage G |
| `public.syntax_nodes` | `93,233,152` | `88.91 MiB` | Offloaded -> Truncate in Stage G |
| `public.verse_translation_sources` | `90,685,440` | `86.48 MiB` | Offloaded -> Truncate in Stage G |
| `public.tagnt_tokens` | `64,487,424` | `61.50 MiB` | Offloaded -> Truncate in Stage G |
| `public.syntax_edges` | `38,076,416` | `36.31 MiB` | Offloaded -> Truncate in Stage G |
| `public.lexeme_identifiers` | `33,546,240` | `31.99 MiB` | Offloaded -> Truncate in Stage G |
| `public.edition_passages` | `14,467,072` | `13.80 MiB` | Offloaded -> Truncate in Stage G |
| `public.reader_rendering_groups` | `13,172,736` | `12.56 MiB` | Offloaded -> Truncate in Stage G |
| `public.hebrew_lxx_verse_map` | `10,149,888` | `9.68 MiB` | Offloaded -> Truncate in Stage G |
| `public.reader_english_verses` | `7,274,496` | `6.94 MiB` | Offloaded -> Truncate in Stage G |
| `public.token_morphemes` | `638,976` | `0.61 MiB` | Offloaded -> Truncate in Stage G |
| `public.macula_gated_field_values` | `581,632` | `0.55 MiB` | Offloaded -> Truncate in Stage G |
| `public.cross_token_mappings` | `335,872` | `0.32 MiB` | Offloaded -> Truncate in Stage G |
| `bible_internal.macula_syntax_unmapped_nodes` | `425,984` | `0.41 MiB` | Offloaded -> Truncate in Stage G |
| `bible_internal.macula_syntax_import_files` | `311,296` | `0.30 MiB` | Offloaded -> Truncate in Stage G |
| **Total Reclaimed (19 Static Tables)** | **`1,085,337,600`** | **`1,035.06 MiB`** | Released via `TRUNCATE TABLE` |
| **Projected Post-Reclamation DB Size** | **`367,456,655`** | **`350.43 MiB`** | **< 400 MiB Preferred & < 500 MiB Free Limit** |

---

## 7. Known Limitations & Remaining Blockers

- **Stage G Deletion SQL Kept Unexecuted by Rule:** Per non-negotiable instructions, `scripts/reclaim-supabase-storage.sql` has been authored and verified via read-only preflight and rolled-back empty-table isolation testing, but **not yet executed** against production. Flash should execute `scripts/reclaim-supabase-storage.sql` only after completing final certification.
- **Cold-Start Latency on Batch Hybrid RPCs:** When `bibleresearch-corpus` experiences a cold isolate start, PostgreSQL RPCs that invoke `public.call_corpus_rpc_v1` over `pgsql-http` take ~200–600 ms. All hybrid RPCs have explicit `SET statement_timeout TO '15s'` (or `'60s'` on `get_verse_research_v1`/`v2`) so PostgREST's default 3-second anonymous timeout does not interrupt cold-start requests.
