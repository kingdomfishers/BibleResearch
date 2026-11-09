# Independent Principal Architecture & Database Integrity Audit

**Audit Date:** 2026-11-09  
**Workspace:** `C:\Projects\BibleResearch` (Authoritative Local Workspace)  
**Live PostgreSQL Target:** Supabase `ejoperxiwxlcbsqrkrvb` (Read-Only Inspection Only; Zero Production Mutations Executed)  
**Static Corpus Target:** Cloudflare Worker `bibleresearch-corpus` (`.artifacts/static-corpus/` + `scripts/corpus-worker.mjs`)  

| Gate | Independent Verdict | Summary Basis |
| :--- | :---: | :--- |
| **Stage G Deletion Readiness** | **FAIL** | `scripts/reclaim-supabase-storage.sql` truncates **23 tables** (`1,048.07 MiB`, not 19), including 2 unbacked-up tables (`lxx_norm_word_summary`, `macula_greekstrong_morphemes`), breaks **4 active public SQL RPCs** that still query truncated tables directly, relies on cached audit constants (`0.63%` remote shard sampling), and leaks `69,205` restricted `macula-hebrew` `frame` values in public assets while leaving 2 `SECURITY DEFINER` ingest RPCs executable by `anon`. |
| **Recovery Readiness** | **FAIL** | `scripts/test-isolated-pg-restore.mjs` inserts rows into PGlite for only **2 of 23** truncated tables (`1,043` rows out of `5,834,630`), `.artifacts/db-backup/schema/02_reclamation_tables_schema.sql` omits `CREATE TABLE` DDL for **4 truncated tables**, 2 truncated tables have **zero backup shards anywhere**, and `scripts/restore-supabase-storage.mjs` has **zero database restore logic**. |

---

## 1. Verified Current Architecture

### 1.1 Two-Tier Hybrid Topology
BibleResearch operates as a hybrid **Cloudflare Workers Static Assets + Supabase PostgreSQL** architecture:
1. **Immutable Biblical & Linguistic Corpus Layer (`bibleresearch-corpus`, Cloudflare Workers Static Assets):**
   - Local build root `.artifacts/static-corpus/` contains **1,890 static `.json.gz` / `.jsonl.gz` files** in `manifest.json` (`268.25 MiB` compressed; `1,189` chapter shards `/v1/chapters/b*-c*.json.gz`, `55` LXX book shards `/v1/lxx/book-*.json.gz`, `64` lexical shards `/v1/lexical/bucket-*.json.gz`, `256` word shards `/v1/words/bucket-*.json.gz`, `1` catalog shard `/v1/catalog/metadata.json.gz`, and `315` raw table backup shards `/tables/*/*.jsonl.gz`), plus the new `XREF-LEX-01` vertical-slice shards under `/v1/relationships/` (`65` cross-reference book shards, `21` lexical buckets, `lexical-index.json.gz`, `manifest.json.gz`).
   - Served by `scripts/corpus-worker.mjs` (`wrangler.corpus.jsonc`) exposing `/v1/rpc/<operation>` for 17 static corpus read operations.
2. **Dynamic Research & Relational Core Layer (Supabase PostgreSQL `ejoperxiwxlcbsqrkrvb`):**
   - Live database size verified via `pg_database_size(current_database())`: **`1,397.75 MiB`** (`1,465,647,555` bytes).
   - Schema footprint: `public` = **`1,379.98 MiB`** (89 tables), `pg_catalog` = **`14.61 MiB`**, `auth` = **`1.48 MiB`**, `bible_internal` = **`0.70 MiB`** (3 tables), `storage` = **`0.47 MiB`**, `extensions` = **`0.24 MiB`**.
   - Retains canonical spine tables (`books`, `verses` [`31,203` rows], `words` [`150,105` rows including editable `custom_definition`/`biblical_def`/`physical_def`], `lemmas` [`21,671`], `lexemes` [`22,722`], `lexical_roots` [`3,217`], `lexical_senses` [`21,701`], `canonical_entities` [`23,544`], `entity_relationships` [`2,265`]), multi-model chronology (`chronology_*`), historical geography (`places`, `place_locations`, `passage_geography`, `verse_geography`), lexical formations (`lexical_formations`, `lemma_components`, `lexical_connections`, `orthographic_candidates`), reviewed research graph (`concepts`, `research_nodes`, `assertions`, `assertion_evidence`), private per-user occurrence translations (`word_translation_choices`), and the `notes` / `note_anchors` / `note_connections` / `note_blocks` layer.
   - **Undocumented Schema Drift in `public`:** Live `public` also contains **4 Bible tables missing from local `supabase/migrations/`** (`public.lxx_norm_word_summary` [`11.59 MiB`], `public.macula_greekstrong_morphemes` [`0.25 MiB`], `public.test_guard_probe` [`16 KiB`, RLS disabled], and `bible_internal.macula_gated_restricted_frames` [`56 KiB`]) plus **8 legacy non-Bible tables** (`content`, `needs`, `posts`, `bol_raw_offers`, `bol_categories`, `bol_offers`, `offers`, `pages`, totaling `~0.44 MiB`).
3. **Composition Gateways:**
   - **Browser (`src/api/rpc.ts` + `src/api/corpus-client.ts`):** Routes pure static corpus RPCs directly to `bibleresearch-corpus` over HTTPS and calls Supabase PostgREST for mutable/hybrid/relational RPCs. *(Audit Fix Applied Locally: `get_reader_word_v1` was erroneously listed in `CORPUS_RO_OPS`, bypassing dynamic `words.custom_definition` in Supabase; fixed in `src/api/corpus-client.ts` and `src/api/rpc.ts`.)*
   - **PostgreSQL Hybrid Gateway (`supabase/migrations/20261107213000_hybrid_corpus_gateway.sql` & `20261108203000_hybrid_rpc_fixes_and_offload.sql`):** Uses synchronous `extensions.http` (`public.call_corpus_rpc_v1`) to fetch static shards from Cloudflare inside PostgreSQL when direct PostgREST callers invoke offloaded or hybrid RPCs (`get_verse_translations_v1`, `save_word_translation_v1`, `get_notes_for_passage_v1`, `get_notes_for_word_v1`, `get_verse_research_v1`, `get_verse_research_v2`, `lookup_lexical_semantics_v1`, `get_reader_word_v1`).
   - **Edge MCP (`supabase/functions/bible-mcp/index.ts`):** Routes `STATIC_CORPUS_RPCS` to `bibleresearch-corpus`, falling back to `supabase.rpc` on failure.

---

## 2. Confirmed Findings

 findings are ordered by consequence and classified as `BLOCKER`, `IMPORTANT`, or `OPTIONAL`. Items marked **[FIXED LOCALLY IN AUDIT]** were non-destructively corrected and verified in the local workspace during Section 7; all DB/migration/Stage-G blockers remain untouched in production per safety rules.

---

### B1 — `BLOCKER`: Stage G Truncates 23 Tables (Including 2 Unbacked-Up Tables) and Breaks 4 Active Public SQL RPCs
- **Exact File / Function:**
  - `scripts/reclaim-supabase-storage.sql` (lines 173–197, `TRUNCATE TABLE ...`)
  - Live PostgreSQL RPCs: `public.lookup_cross_testament_greek_v1(text, integer)`, `public.lookup_hebrew_to_greek_alignments_v1(text, integer)`, `public.lookup_greek_to_hebrew_alignments_v1(text, integer)`, `public.lookup_hebrew_septuagint_alignments_v1(text, text, integer)`
  - `supabase/migrations/20261108203000_hybrid_rpc_fixes_and_offload.sql`
- **Verified Evidence:**
  1. `STAGE_G_FINAL_APPROVAL.md` claims 19 PostgreSQL tables (`1,035.97 MiB`) are targeted for reclamation. Inspection of `scripts/reclaim-supabase-storage.sql` lines 173–197 shows **23 tables** in the `TRUNCATE` statement (`1,048.07 MiB` live): the 19 documented tables (`1,035.97 MiB`) + 2 `bible_internal` tables (`0.26 MiB`) + **`public.lxx_norm_word_summary` (`11,360` rows, `11.59 MiB`)** and **`public.macula_greekstrong_morphemes` (`1,010` rows, `0.25 MiB`)**.
  2. Neither `lxx_norm_word_summary` nor `macula_greekstrong_morphemes` exists in `.artifacts/static-corpus/tables/`, `.artifacts/db-backup/tables/`, `.artifacts/private-backup/`, `.artifacts/db-backup/schema/02_reclamation_tables_schema.sql`, or `supabase/migrations/`.
  3. Live `pg_proc` scan of all `public` functions referencing any of the 23 truncated tables confirms **4 active public RPCs** still execute SQL directly against truncated tables:
     - `public.lookup_cross_testament_greek_v1`: Queries `public.lxx_norm_word_summary` and `public.macula_greekstrong_morphemes` directly; NOT implemented in `scripts/corpus-worker.mjs` and NOT in `CORPUS_RO_OPS`.
     - `public.lookup_hebrew_to_greek_alignments_v1`: Queries `LEFT JOIN public.macula_greekstrong_morphemes` directly; NOT implemented in `scripts/corpus-worker.mjs`.
     - `public.lookup_greek_to_hebrew_alignments_v1`: Queries `LEFT JOIN public.macula_greekstrong_morphemes` directly; NOT implemented in `scripts/corpus-worker.mjs`.
     - `public.lookup_hebrew_septuagint_alignments_v1`: Queries `public.hebrew_lxx_word_alignments` directly in PostgreSQL (omitted from `20261107213000_hybrid_corpus_gateway.sql` and `20261108203000_hybrid_rpc_fixes_and_offload.sql`).
- **Failure Mechanism:** Executing `scripts/reclaim-supabase-storage.sql` permanently destroys `lxx_norm_word_summary` and `macula_greekstrong_morphemes` with no backup or DDL to recreate them, and causes all 4 SQL RPCs above to **silently fabricate empty/zero scholarly results (`status: 'ok'`, `lxx_occurrence_count: 0`, `occurrence_count: 0`, `alignments: []`)** instead of returning real alignments or failing closed.
- **Minimal Corrective Action:**
  1. Export `lxx_norm_word_summary` and `macula_greekstrong_morphemes` (or deterministic rebuild SQL from `lxx_swete_words` and `macula_hebrew_morphemes` / `macula_gated_field_values`) into `.artifacts/db-backup/` AND add their `CREATE TABLE` + index DDL to a tracked migration and `02_reclamation_tables_schema.sql`.
  2. Implement Worker handlers in `scripts/corpus-worker.mjs` + fail-closed SQL wrappers (`status = 'unavailable'` when `call_corpus_rpc_v1` returns `NULL`) for `lookup_cross_testament_greek_v1`, `lookup_hebrew_to_greek_alignments_v1`, `lookup_greek_to_hebrew_alignments_v1`, and `lookup_hebrew_septuagint_alignments_v1`.
- **Automated Acceptance Test:** Run an isolated PGlite or transaction-rolled-back test that truncates all target tables and invokes every `public` RPC (`SELECT proname FROM pg_proc`), asserting byte-identical JSON parity with pre-truncation baselines and zero `status: 'ok'` responses with degraded zero counts.

---

### B2 — `BLOCKER`: Recovery Suite Fails to Test 21 of 23 Truncated Tables, Omits 4 Table DDLs, and Has Zero Restore Implementation
- **Exact File / Function:**
  - `scripts/test-isolated-pg-restore.mjs` (lines 93–128)
  - `scripts/restore-supabase-storage.mjs` (lines 1–138)
  - `scripts/build-reclamation-backup-schema.mjs` (lines 12–19)
  - `.artifacts/db-backup/schema/02_reclamation_tables_schema.sql`
- **Verified Evidence:**
  1. `scripts/test-isolated-pg-restore.mjs` executes SQL `INSERT` into PGlite **only** for `bible_internal.macula_syntax_import_files` (`983` rows) and `bible_internal.macula_syntax_unmapped_nodes` (`60` rows) — **1,043 rows out of 5,834,630 live rows (`0.018%`)**. For 15 public tables (`3,079,668` rows) it merely calls `loadJsonlShards(t, 10)` into a JavaScript array without touching PGlite; for `cross_token_mappings` and `macula_gated_field_values` it parses JSON into memory without SQL `INSERT`; for 4 tables it does nothing at all.
  2. Inspection of `.artifacts/db-backup/schema/02_reclamation_tables_schema.sql` shows it defines only **19 tables** and **completely omits `CREATE TABLE` DDL for 4 truncated tables**: `public.hebrew_lxx_word_alignments`, `public.versification_mappings`, `public.lxx_norm_word_summary`, and `public.macula_greekstrong_morphemes`. Because `test-isolated-pg-restore.mjs` never executed `INSERT` against those tables in PGlite, the missing DDL went undetected.
  3. `scripts/build-reclamation-backup-schema.mjs` lines 12–19 hardcode ephemeral paths inside a prior agent's scratch directory (`C:/Users/fluck/.gemini/antigravity/brain/665d66fd-5dd3-4293-8f5a-1ae633a34d7f/.system_generated/steps/.../output.txt`), making schema backup generation non-reproducible across machines or clean checkouts.
  4. `scripts/restore-supabase-storage.mjs` (cited in `STAGE_G_FINAL_APPROVAL.md` §9 as the emergency rollback command) only parses the **first and last line** of each `.jsonl.gz` shard (lines 70–81), verifies **zero SHA-256 checksums** against `manifest.json`, and contains **zero PostgreSQL connection, `COPY`, batch `INSERT`, or RPC restore logic**.
  5. **Corpus vs DB Divergence on `syntax_nodes` / `syntax_edges`:** Pre-truncation PostgreSQL holds only the 70-file pilot (`143,781` `syntax_nodes`, `138,712` `syntax_edges`), whereas `.artifacts/static-corpus/tables/` holds the expanded 983-file Macula export (`1,338,108` `syntax_nodes`, `1,298,688` `syntax_edges` — `~820+ MiB` with indexes if restored into Postgres, which would immediately exceed Supabase's `500 MiB` Free Tier limit!). Neither `STAGE_G_FINAL_APPROVAL.md` nor `restore-supabase-storage.mjs` distinguishes restoring to self-hosted/Pro Postgres vs filtering to fit Free Tier.
- **Failure Mechanism:** If Stage G truncation is committed and an emergency rollback is required, running `node scripts/restore-supabase-storage.mjs --table all` restores **zero rows**, applying `02_reclamation_tables_schema.sql` fails to recreate 4 tables, 2 tables have no data backup anywhere, and attempting to load all `1.34M` `syntax_nodes` + `1.30M` `syntax_edges` back into Supabase Free Tier overflows the `500 MiB` quota mid-restore.
- **Minimal Corrective Action:**
  1. Rewrite `scripts/build-reclamation-backup-schema.mjs` to extract DDL deterministically from `supabase/migrations/` (or live `pg_catalog` via read-only introspection) with zero ephemeral path dependencies, covering all 23 target tables.
  2. Implement actual batched, idempotent PostgreSQL restore (`--dry-run` vs `--execute --dsn <postgres_url>` with FK-topological ordering, sequence `setval`, and `--pilot-syntax-only` flag for `<500 MiB` Free-Tier emergency rollback) in `scripts/restore-supabase-storage.mjs`, plus full every-line JSON + SHA-256 verification against `manifest.json`.
  3. Upgrade `scripts/test-isolated-pg-restore.mjs` to execute real SQL `INSERT` + constraint + FK + sequence checks in PGlite across **all 23 target tables** (full row counts for small/medium tables and stratified multi-shard batches with FK parents for million-row tables).
- **Automated Acceptance Test:** `node scripts/test-isolated-pg-restore.mjs` must apply `01_dependencies_schema.sql` + `02_reclamation_tables_schema.sql` in PGlite and execute real SQL `INSERT` statements into **all 23 truncated tables** with `0` missing-table, type, CHECK, UNIQUE, or FK errors, and `node scripts/restore-supabase-storage.mjs --verify-all` must verify SHA-256 + every JSONL line across all 315+ shards.

---

### B3 — `BLOCKER`: Live Unauthenticated `anon` Write Vulnerability & Restricted `macula-hebrew` `frame` License Leak (`69,205` Public Nodes)
- **Exact File / Function:**
  - Live DB `SECURITY DEFINER` RPCs: `public.ingest_lexical_formations_batch_v1(jsonb)` and `public.ingest_quarantined_records_batch_v1(jsonb)` (`supabase/migrations/20261107011235_lexical_formation_batch_and_candidates.sql`, `20261107011923_word_formation_query_normalization_and_fixes.sql`), plus `public.test_guard_probe`
  - `scripts/export-static-corpus.py` (line 542: `semantic_frame = (el.attrib.get("frame") or "").strip() or None`)
  - `.artifacts/static-corpus/tables/syntax_nodes/` & `/v1/chapters/b*-c*.json.gz` & `/v1/syntax/*.json.gz` (`69,205` WLC nodes) + live `public.syntax_nodes` (`8,014` WLC nodes)
  - `scripts/extract-private-backups.mjs` (line 56)
- **Verified Evidence:**
  1. **Unauthenticated Public Write Exposure (`anon`):** Supabase `get_advisors(security)` and direct catalog query `has_function_privilege('anon', p.oid, 'EXECUTE')` confirm `public.ingest_lexical_formations_batch_v1(jsonb)` and `public.ingest_quarantined_records_batch_v1(jsonb)` are `SECURITY DEFINER` and **executable by `anon` and `authenticated`**. Anyone holding the public `VITE_SUPABASE_ANON_KEY` shipped in the browser bundle can `POST /rest/v1/rpc/ingest_lexical_formations_batch_v1` to insert or overwrite `public.lexical_formations`, `public.lemma_components`, and `public.quarantined_evidence_records`! Additionally, `public.test_guard_probe` exists in `public` with `rowsecurity = false`.
  2. **Restricted `macula-hebrew` `frame` Leaked into Public Cloudflare Corpus (`69,205` Nodes):** `public.field_license_registry` row `id=15` (`dataset_key='macula-hebrew'`, `field_name='frame'`) explicitly mandates `status='disabled_unverified'`, `enabled_for_display=false`, `decision_note='Stored, not exposed.'`, and `.artifacts/static-corpus/manifest.json` line 134 declares `"excluded_restricted_fields": [..., "macula_hebrew_frame_gated"]`. However, `scripts/export-static-corpus.py` line 542 unconditionally parses `@frame` from all 929 `macula-hebrew` Lowfat XML files into `semantic_frame`. Streaming scan of `.artifacts/static-corpus/tables/syntax_nodes/*.jsonl.gz` proved **`69,205` `macula-hebrew-wlc` (`edition_id=11`) nodes** contain non-null `semantic_frame` values in the deployed public Cloudflare corpus (and `8,014` rows in live `public.syntax_nodes`).
  3. **Hardcoded Encryption Key & Plaintext Private Backup:** `scripts/extract-private-backups.mjs` line 56 hardcodes the AES-256-GCM passphrase in source code (`'BibleResearch:ejoperxiwxlcbsqrkrvb:private_macula_frame_vault:2026'`) and writes plaintext `.json` files alongside `.json.enc` in `.artifacts/private-backup/`.
- **Failure Mechanism:** Malicious or automated clients can corrupt `lexical_formations` / `lemma_components` in production Supabase using only the public anon key, while `bibleresearch-corpus` publicly distributes `69,205` license-gated `macula-hebrew` `frame` annotations in violation of `field_license_registry` and falsely claims in `manifest.json` that they were excluded.
- **Minimal Corrective Action:**
  1. Apply a security migration executing `REVOKE ALL ON FUNCTION public.ingest_lexical_formations_batch_v1(jsonb), public.ingest_quarantined_records_batch_v1(jsonb) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` and `DROP TABLE IF EXISTS public.test_guard_probe;` (plus `UPDATE public.syntax_nodes SET semantic_frame = NULL WHERE edition_id = 11 AND semantic_frame IS NOT NULL;` if retained pre-truncation).
  2. In `scripts/export-static-corpus.py` line 542, gate `semantic_frame = None if repo == "macula-hebrew" else ((el.attrib.get("frame") or "").strip() or None)`, invalidate cached `syntax_nodes` shards, regenerate `/v1/chapters/*`, `/v1/syntax/*`, and `/tables/syntax_nodes/*`, and assert `0` WLC `semantic_frame` values in `verify-static-corpus.py`.
  3. Require `PRIVATE_BACKUP_PASSPHRASE` from environment variables in `scripts/extract-private-backups.mjs` and never write unencrypted `.json` copies of gated fields.
- **Automated Acceptance Test:**
  1. `has_function_privilege('anon', 'public.ingest_lexical_formations_batch_v1(jsonb)', 'EXECUTE') = false` and `get_advisors(security)` reports `0` `rls_disabled_in_public` warnings and `0` unexpected anon `SECURITY DEFINER` ingest RPCs.
  2. Streaming scan of `.artifacts/static-corpus/tables/syntax_nodes` and `/v1/chapters/*` asserts `count(edition_id = 11 AND semantic_frame IS NOT NULL) === 0` while Greek (`edition_id IN (18, 19)`) retains all `50,855` `semantic_frame` annotations.

---

### B4 — `BLOCKER`: Post-Stage-G Rebuild / CI Overwrite Hazard & Hardcoded Integrity Audit Snapshots
- **Exact File / Function:**
  - `.github/workflows/publish-static-corpus.yml` (lines 45–63)
  - `scripts/export-static-corpus.py` (lines 853–863, 1059–1089, 1137–1173)
  - `scripts/corpus-worker.mjs` (`runLiveCorpusVerification`, lines 2055–2259)
  - `scripts/reclaim-supabase-storage.sql` (Preflight Check 2, lines 60–97)
- **Verified Evidence:**
  1. `.github/workflows/publish-static-corpus.yml` runs `python3 scripts/export-static-corpus.py` before `wrangler deploy --config wrangler.corpus.jsonc`. `export-static-corpus.py` Step 2 (`fetch_table_rows`, lines 854–863) fetches all 19 offloaded tables live from Supabase via `export_static_corpus_page_v1` with **no offline shard fallback** (unlike `manifest_files`, which has a fallback on lines 809–829). Once Stage G truncates Supabase, running `export-static-corpus.py` locally overwrites `.artifacts/static-corpus/` with empty `0`-row shards before `verify-static-corpus.py` aborts—destroying the local static corpus—and permanently prevents CI from rebuilding/redeploying `bibleresearch-corpus` (blocking the upcoming full `XREF-LEX` cross-reference & lexical corpus deployment!).
  2. In `scripts/export-static-corpus.py` lines 1059–1089 and 1137–1173, `audit_evidence_coverage` (`duplicates.*`, `orphans.*`) and `verify_referential_integrity` (`orphan_counts`, `multi_etymology_root_links: 5`, constraint checks) are **literal hardcoded Python constants** written into `/v1/catalog/metadata.json.gz`.
  3. In `scripts/corpus-worker.mjs` lines 2055–2259, `runLiveCorpusVerification` (`audit_evidence_coverage_v1` / `verify_referential_integrity_v1`) echoes those cached metadata numbers after probing only **12 hardcoded asset paths out of 1,890 (`0.63%`)**. Consequently, `scripts/reclaim-supabase-storage.sql` Preflight Check 2 (`v_integrity->>'status' = 'ok'`) and `scripts/preflight-storage-reclamation.mjs` **can pass even if 99.3% of remote Cloudflare shards are stale, missing, or corrupted**!
- **Failure Mechanism:** A partial or corrupted Cloudflare upload affecting any of the other 1,878 shards passes Stage G preflight and triggers irreversible PostgreSQL truncation; thereafter, running `export-static-corpus.py` against truncated Supabase wipes local shards and blocks future Worker updates.
- **Minimal Corrective Action:**
  1. Add a `--from-pinned-shards` / offline table-shard loader to `scripts/export-static-corpus.py` (reading immutable `/tables/<name>/part-*.jsonl.gz` with SHA-256 verification against `manifest.json` whenever Supabase tables are truncated, and writing to a staging directory before atomic rename) and split `.github/workflows/publish-static-corpus.yml` so Worker code/relationship-slice updates never re-export truncated Supabase tables.
  2. Compute `audit_evidence_coverage` and `verify_referential_integrity` metrics **dynamically** from the exported rows in `export-static-corpus.py` (zero hardcoded constants), and upgrade `scripts/verify-static-corpus-remote.mjs` + `preflight-storage-reclamation.mjs` to verify `manifest.json` `corpus_version` + exhaustive/stratified SHA-256 shard verification across every shard category before Stage G can proceed.
- **Automated Acceptance Test:** Simulate truncated Supabase (`0` rows returned by `export_static_corpus_page_v1`) and verify `export-static-corpus.py --from-pinned-shards` reproduces the exact shard counts and SHA-256 manifest without data loss, while corrupting any single table/chapter/LXX/lexical shard causes `verify-static-corpus.py` and `preflight-storage-reclamation.mjs` to exit non-zero.

---

### B5 — `BLOCKER`: Silent Fail-Open Result Fabrication, Homograph Regression, and Synchronous HTTP Pool Amplification in Hybrid SQL Gateway
- **Exact File / Function:**
  - `supabase/migrations/20261108203000_hybrid_rpc_fixes_and_offload.sql`: `get_verse_translations_v1` (lines 985–1029), `save_word_translation_v1` (lines 906–921), `lookup_lexical_semantics_v1` (lines 1793–1892), `get_word_formation_v1` (lines 1194–1219), `get_notes_for_passage_v1` (lines 2902–2907), `get_notes_for_word_v1` (lines 3343–3349)
  - `supabase/migrations/20261107213000_hybrid_corpus_gateway.sql`: `public.call_corpus_rpc_v1(text, jsonb)`
  - `src/api/corpus-client.ts` & `src/api/rpc.ts` (`readerRPC`) — **[CLIENT HALF FIXED LOCALLY IN AUDIT]**
  - `supabase/functions/bible-mcp/index.ts` (lines 95–128)
- **Verified Evidence:**
  1. **Silent Fail-Open Fabrication in SQL:** When `public.call_corpus_rpc_v1` returns `NULL` (Worker timeout/5xx):
     - `get_verse_translations_v1` still returns token rows with `source_english: NULL`, `options: []`, `default_english: ''` instead of raising or returning an explicit `unavailable` envelope.
     - `lookup_lexical_semantics_v1` returns `status: 'ok'` with `observed_translation_glosses: []` and `occurrence_count: 0` because `COALESCE(v_gloss_resp->'glosses', '[]'::jsonb)` swallows the `NULL` Worker response.
     - `get_word_formation_v1` returns `status: 'ok'` with unresolved word-form fallback when `lookup_word_to_lemma_senses_v1` fails on the Worker.
  2. **`NOTE-10` Homograph Regression in `get_notes_for_passage_v1`:** Lines 2902–2907 replaced `public.word_form_lemmas` resolution with `JOIN public.lemmas l ON l.base_strongs = w.strongs_nr`. For homographs sharing a base Strong's number (e.g., `H1254A` *create* vs `H1254B` *cut down*, or `H0430G` vs `H0430a`), a note anchored specifically to `lemma_id` for `H1254B` now falsely attaches to `H1254A` occurrences in Genesis 1:1, while compound/prefix tokens whose morpheme lemma differs from `w.strongs_nr` miss lemma-scoped notes completely! Similarly, `get_notes_for_word_v1` lines 3343–3349 fall back to `l.base_strongs = v_word.strongs_nr` when the Worker call fails.
  3. **Unauthenticated `call_corpus_rpc_v1` SSRF/Path-Injection & Connection Pool Amplification:**
     - `public.call_corpus_rpc_v1(p_operation, p_params)` is `SECURITY DEFINER` and executable by `anon` (`has_function_privilege = true`), does not validate `p_operation` against `^[a-z0-9_]+$` or an allowlist, and retries `3 × 10s = 30s` synchronously even on HTTP `404`.
     - Inside `lookup_lexical_semantics_v1`, `call_corpus_rpc_v1` is called inside per-lemma loops (up to **15 sequential HTTP calls** inside a single PostgreSQL transaction!).
     - In `supabase/functions/bible-mcp/index.ts` (and previously `src/api/rpc.ts`), when direct HTTPS to `bibleresearch-corpus` failed, the fallback immediately called `supabase.rpc(name, args)`—forcing PostgreSQL to hold a scarce Free-Tier connection open for 30s retrying the exact same unreachable Worker! *(Client-side amplification and the `get_reader_word_v1` mutable-definition bypass were fixed locally in `src/api/corpus-client.ts` and `src/api/rpc.ts` during this audit.)*
- **Failure Mechanism:** Any transient Cloudflare Worker slowdown exhausts Supabase's PostgreSQL connection pool via synchronous `pgsql-http` retries, fabricates `status: 'ok'` responses with missing glosses/translations, and cross-contaminates homograph notes in `get_notes_for_passage_v1`.
- **Minimal Corrective Action:**
  1. `REVOKE EXECUTE ON FUNCTION public.call_corpus_rpc_v1(text, jsonb) FROM PUBLIC, anon, authenticated;` (convert callers that legitimately need it or validate `p_operation` against an explicit `CASE`/`IN (...)` allowlist, never retry 4xx, reduce timeout to `4s` × max `2` attempts, and batch multi-lemma Worker lookups into a single HTTP request).
  2. Make `get_verse_translations_v1`, `save_word_translation_v1`, `lookup_lexical_semantics_v1`, `get_word_formation_v1`, and `get_notes_for_word_v1` **fail closed** (`status = 'unavailable'`) whenever `call_corpus_rpc_v1` returns `NULL` or `status <> 'ok'`.
  3. Retain compact `word_form_lemmas` (`139,899` integer pairs = only `28 MiB` in Postgres, or extract a tiny `(word_id, lemma_id)` mapping table `~8 MiB` without provenance text columns!) OR resolve exact occurrence/word-form `lemma_id`s from the chapter shard in `get_notes_for_passage_v1` so `NOTE-10` homograph isolation is 100% preserved without `base_strongs` conflation.
  4. Remove the `supabase.rpc` fallback for pure `STATIC_CORPUS_RPCS` in `supabase/functions/bible-mcp/index.ts` (matching the fix applied to `src/api/rpc.ts`).
- **Automated Acceptance Test:**
  1. Anchor a test note to `H1254B` (`cut down`) and assert `get_notes_for_passage_v1(1, 1, 1)` returns **0 matches** on Genesis 1:1 (`H1254A`), while anchoring to `H1254A` returns **1 match**.
  2. Point `app.corpus_base_url` in a local transaction (`SET LOCAL`) to an unreachable/503 mock endpoint and assert every hybrid SQL RPC returns `status = 'unavailable'` within `< 6s` with **zero** fabricated `status = 'ok'` payloads.

---

### B6 — `BLOCKER`: Epistemic & Linguistic Misclassifications in Relationship Architecture (`XREF-LEX`) — **[SLICE & MODEL FIXED LOCALLY; FULL-IMPORT HANDOFF UPDATED]**
- **Exact File / Function:**
  - `src/api/relationship-types.ts` (`LexicalRelationshipCategory`)
  - `src/api/relationship-model.ts` (`buildLexicalRelationshipId`, `validateLexicalEdgeIntegrity`)
  - `src/api/relationship-notes-adapter.ts` (`mapLexicalCategoryToNoteConnection`)
  - `scripts/corpus-relationships-rpc.mjs` (`handleLookupCrossReferencesV1`)
  - `scripts/build-relationship-slice.mjs` (Sections B, D, E, G & index assembly)
  - `RELATIONSHIP_IMPORT_HANDOFF.md` (§5, lines 156–164)
- **Verified Evidence:**
  1. **Transliteration Falsely Classified as Linguistic Cognacy:** `build-relationship-slice.mjs` (lines 883, 964–970) and `RELATIONSHIP_IMPORT_HANDOFF.md` (line 158) mapped `greek_transliteration_of` and `greek_loan_or_transliteration` (e.g., Indo-European Greek `Ἀαρών` `G2` ← Semitic Hebrew `אַהֲרֹן` `H175`; `Ἀββᾶ` `G5` ← Aramaic `אַב` `H2`) to `category: 'cognate'` with `guardrails.implies_common_etymology: true`, and `relationship-notes-adapter.ts` mapped them to `same_root` note connections. Phonetic borrowing/transliteration across unrelated language families (Indo-European vs Afroasiatic/Semitic) is **not** cognacy.
  2. **Derived Co-Root Sibling Joins Falsely Marked `attested_lexical_fact` + `etymology_type` Broadcast Bug + Asymmetric `.slice(0, 12)`:** Joining two sibling lemmas `(L1 -> R)` and `(L2 -> R)` via `lemma_root_links` was labeled `attested_lexical_fact` (`algorithm_version: null`) even though the source only attested each `(lemma, root)` link individually, not the derived pairwise sibling edge. Worse, lines 895–900 checked `rl.etymology_type` (`form_of` / `spelling_variant_of`) on `(subj, root)` and broadcast `morphological_relationship` onto up to 12 arbitrary sibling lemmas of `root`, while `.slice(0, 12)` silently dropped edges and broke `A <-> B` symmetry!
  3. **Broken Canonical `relationship_id` on `inverse` Directed Lexical Edges:** `buildLexId` hashed `(subjKey, tgtKey)` as passed. When emitting `direction: 'inverse'` (`H0216 <- G5457`), it hashed `(H0216, G5457)` instead of canonical forward `(G5457, H0216)`, generating a **different `relationship_id`** from `G5457 -> H0216` (`directed`) so researcher notes attached on one side failed to match `indexNotesByRelationshipId` on the other!
  4. **Base Strong's Lookup Overwrite (`H430 -> lemma:H0430a` instead of `lemma:H0430G`):** `build-relationship-slice.mjs` line 1230 allowed secondary sub-meaning rows with `homograph_tag: null` (`lemma:H0430a`, `lemma:H1254a`) to overwrite the primary `'G'`/`'A'` lemma in `key_by_lookup['H430']` and `key_by_lookup['H1254']`.
  5. **Asymmetric Cross-Reference `translation_filter` & Unpaginated `edition_only_passage`:** `handleLookupCrossReferencesV1` applied `p_translation_filter` (`bsb`/`kjv`) to `outgoing` edges while ignoring it on `incoming` edges despite encoding `translationFilter` in `scopeKey`, and bypassed cursor pagination on `edition_only_passage`.
  6. **Provenance Misattribution & Hardcoded `related_translation`:** Internal `lexical_connections` (`orthographic_overlap` on `אדם`/`דם`), TAHOT `verse_translation_sources`, and `words.co_occurrences` were all misattributed to `stepbible_tbesh_v1`/`stepbible_tbesg_v1`, with hardcoded fallback `['make']` and verse `1:1:1` (where `H6213` does not appear).
- **Failure Mechanism:** Corrupts theological and philological research by telling users and AI agents that Greek proper-name transliterations share a historical proto-root with Hebrew (`same_root`), claims transitive co-root joins are direct lexicon statements, orphans researcher evaluation notes across inverse lexical lookups, and resolves `H430` (`אֱלֹהִים`) to a sub-entry instead of its primary lemma.
- **Minimal Corrective Action:**
  1. **[FIXED LOCALLY IN AUDIT]** Added `'loan_transliteration'` (`implies_common_etymology: false`, note prefill `'related'` instead of `'same_root'`) to `src/api/relationship-types.ts`, `src/api/relationship-model.ts`, `src/api/relationship-notes-adapter.ts`, and `scripts/build-relationship-slice.mjs`; fixed `buildLexicalRelationshipId` so `'directed'` and `'inverse'` share identical canonical `relationship_id`; reclassified co-root sibling joins to `'deterministic_computational'` (`co_root_peer_join_v1`), removed `.slice(0, 12)` truncation and `etymology_type` broadcast, fixed `pickPrimaryLemma` lookup indexing, fixed `corpus-relationships-rpc.mjs` `translation_filter` + `edition_only_passage` pagination, fixed provenance attributions, and rebuilt `.artifacts/static-corpus/v1/relationships/*`.
  2. **[REMAINING BEFORE FULL CORPUS IMPORT]** Update `RELATIONSHIP_IMPORT_HANDOFF.md` §5 and ensure the full-corpus Abbott-Smith parser marks unaccented Greek (`normalizeGreekStrip`) or consonantal-only Hebrew fallback matches as `'deterministic_computational'` whenever >1 homograph candidate exists, and computes `related_translation` across all shared rendering pairs above a documented minimum support threshold rather than only `H1254`/`H6213`.
- **Automated Acceptance Test:** `node scripts/verify-relationship-foundation.mjs` (**`63 passed, 0 failed`**, expanded from 55 checks during this audit).

---

### B7 — `BLOCKER` (Data Integrity): Masoretic vs English Versification Misalignment Across ~2,400+ OT Verses in `macula_hebrew_morphemes`, `morphhb_tokens`, and `syntax_nodes`, Plus Missing Nehemiah (`406` Verses) in `hebrew_lxx_verse_map`
- **Exact File / Function:**
  - `supabase/migrations/20261106120000_hebrew_morphhb_and_syntax_schema.sql` (`ingest_macula_batch_v1`, `ingest_morphhb_batch_v1`)
  - `scripts/export-static-corpus.py` (`parse_all_macula_syntax_files`, lines 454–459: `heb_xml_map`)
  - `scripts/import-lxx-swete.mjs` (lines 110, 306–310: `SWETE_CANONICAL_MAP`)
- **Verified Evidence:**
  1. **Empirical Proof of OT Versification Shift Corruption (`Psalm 3` & `Genesis 32`):**
     - STEP TAHOT (`public.verses` / `public.words`) uses **English/KJV canonical versification** (`Psa.3.0(3.1)` = superscription `מִזְמוֹר לְדָוִד`; `Psa.3.1(3.2)` = `יְהוָה מָה־רַבּוּ`, `word_id=71039` `יְהוָה`; `Gen.31.55(32.1)` = `וַיַּשְׁכֵּם לָבָן`; `Gen.32.1(32.2)` = `וְיַעֲקֹב הָלַךְ`, `word_id=74104` `וְיַעֲקֹב`).
     - `macula-hebrew` (`PSA 3:1!1`, `GEN 32:1!1`) and `morphhb` use **Masoretic Text (BHS/WLC) versification**.
     - Inspection of `.artifacts/static-corpus/v1/chapters/b19-c3.json.gz` and `b1-c32.json.gz` proves `macula_hebrew_morphemes`, `morphhb_tokens`, and WLC `syntax_nodes` (`edition_id=11`) were joined directly on `(book, chapter_mt, verse_mt) = (book, chapter, verse_nr)` **without translating MT coordinates through `public.versification_mappings`**!
     - As a result:
       - On **Psalm 3:1** (`יְהוָה מָה־רַבּוּ`), `macula_hebrew_morphemes` attaches `PSA 3:1!1` **`מִזְמוֹר` ("a psalm") directly onto `word_id = 71039` (`יְהוָה`, "Yahweh"!)** and `PSA 3:1!2` **`לְדָוִד` ("of David") onto `word_id = 86642` (`מָה־`, "how!"!)**, falsely stamping `link_status = 'matched_consonantal'` by ordinal position!
       - On **Genesis 32:1** (`וְיַעֲקֹב הָלַךְ`), `macula_hebrew_morphemes` and WLC `syntax_nodes` attach `GEN 32:1!1` **`וַיַּשְׁכֵּם לָבָן` ("and Laban rose early" = Gen 31:55!) onto `word_id = 74104` (`וְיַעֲקֹב`, "and Jacob"!)** and `word_id = 56494` (`הָלַךְ`, "went"!)!
       - Across the entire OT, **`226` canonical verses** (`116` Psalm `verse_nr = 0` headings + `110` shifted verses across Genesis 31, Exodus 8/22, Leviticus 6, Numbers 16/29, Deuteronomy 12/22/29, 1 Samuel 23, 2 Samuel 18, 1 Kings 4, 2 Kings 11, 1 Chronicles 6, 2 Chronicles 2/14, Nehemiah 4/7/9, Job 41, Ecclesiastes 5, Song 6, Isaiah 9/64, Jeremiah 9, Ezekiel 20, Daniel 4/5, Hosea 1/11/13, Joel 2, Jonah 1, Micah 5, Nahum 1, Zechariah 1) receive **0 WLC syntax trees / morphemes**, every subsequent verse in those ~151 chapters (~2,400+ OT verses!) has **shifted/wrong syntax trees and morphemes**, and `71` WLC XML terminals (`128` total syntax nodes) overflow MT chapter ends as `unmapped_syntax_nodes`!
  2. **Empirical Proof of Missing Nehemiah (`406` Verses) in `hebrew_lxx_verse_map`:**
     - `23,261` canonical OT verses − `222` (Ecclesiastes, `book=21`, absent upstream in `nathans/lxx-swete`) − **`406` (Nehemiah, `book=16`)** = **`22,633`** (`hebrew_lxx_verse_map` row count)!
     - Swete `18.Esdras_B.txt` **already contains all of Nehemiah in chapters 11–23** (imported into `lxx_swete_words`!), but `scripts/import-lxx-swete.mjs` line 110 used a 1-to-1 lookup `SWETE_CANONICAL_MAP = { 18: 15 }` (Ezra only), causing line 310 (`if (!bookNo) continue;`) to silently skip all **406 verses of Nehemiah** (`canonical_book = 16` -> `lxx_book_no = 18`, `lxx_chapter = chapter + 10`)!
- **Failure Mechanism:** Any user or AI querying `lookup_hebrew_verse_evidence_v1`, `lookup_syntax_tree_v1`, or `lookup_passage_tokens_syntax_v1` on any headed Psalm (`Psalms 3–9, 11–32, 34–42, 44–70, 72–90, 92, 98, 100–103, 108–110, 120–134, 138–145`) or any MT-shifted OT chapter receives **another verse's Hebrew syntax tree and morphemes grafted onto the wrong Hebrew words**, and every Septuagint parallel lookup on **Nehemiah 1–13** fails to find its Greek text even though the Greek tokens are already in `lxx_swete_words`!
- **Minimal Corrective Action:**
  1. Resolve `canonical_verse_id` for `macula_hebrew_morphemes`, `morphhb_tokens`, `cross_token_mappings`, and WLC `syntax_nodes` through `versification_mappings` (matching STEP TAHOT parenthetical MT refs `(ch.vs)` / `mt-hebrew-versification` to canonical `verse_id`), and require genuine normalized Hebrew consonantal overlap before stamping `link_status = 'matched_consonantal'`! *(Note: Because Stage G truncates `versification_mappings`, `macula_hebrew_morphemes`, and `morphhb_tokens`, fixing this BEFORE Stage G is dramatically cleaner and safer than after truncation.)*
  2. Add the **406 Nehemiah (`book=16` -> `lxx_book_no=18`, `lxx_chapter = v.chapter + 10`)** verse mappings to `hebrew_lxx_verse_map` and re-export `/v1/lxx/*` + `/v1/chapters/b16-*`.
- **Automated Acceptance Test:**
  1. Assert on `Psalm 3:0` (`b19-c3.json.gz`) that `PSA 3:1!1` (`מִזְמוֹר`) maps to `Ps 3:0` (`word_id = 88044`), `PSA 3:2!1` (`יְהוָה`) maps to `Ps 3:1` (`word_id = 71039`), `GEN 32:1!1` (`וַיַּשְׁכֵּם`) maps to `Gen 31:55` (`word_id = 138884`), `otWlcSyntaxMissingCount === 0` across all `23,261` canonical OT verses, and `0` `matched_consonantal` rows have disjoint consonantal skeletons!
  2. Assert `lookup_septuagint_by_canonical_verse_v1` for Nehemiah 1:1 (`book=16, chapter=1, verse=1`) resolves to `18.Esdras_B` `11:1` (`Λόγοι Νεεμίου υἱοῦ Ἁχαλία`).

---

### I1 — `IMPORTANT`: Cross-Reference Outgoing Tier Naming Precision (`attested_lexical_fact` Applied to Literary Passage Associations)
- **Exact File / Function:** `src/api/relationship-types.ts` (line 97), `scripts/build-relationship-slice.mjs` (line 484), `RELATIONSHIP_IMPORT_HANDOFF.md` (§3)
- **Verified Evidence:** Outgoing `CrossReferenceEdge` records use `epistemic_tier: 'attested_lexical_fact'`. While `guardrails` (`association_only: true`, `implies_quotation: false`, `implies_prophecy: false`, `implies_typology: false`, `implies_theological_equivalence: false`) and UI badge text (`'Attested association'` in `PassageCrossReferences.ts` line 65) correctly prevent over-claiming, a curated Treasury/CrossReferences.org passage link is a **curated literary/editorial association**, not a *lexical* fact.
- **Failure Mechanism:** Downstream MCP/API consumers inspecting `epistemic_tier` literally without checking `domain === 'cross_reference'` could treat editorial cross-references as primary-language lexical attestations.
- **Minimal Corrective Action:** Either add `'attested_source_association'` for `domain: 'cross_reference'` in v1.1 (with backward-compatible UI label mapping) or document explicitly in OpenAPI/MCP tool schemas that on `domain: 'cross_reference'`, `attested_lexical_fact` means *directly attested in the curated CrossReferences.org edition (as opposed to reverse-indexed `deterministic_computational`)* and never implies lexical, prophetic, or typological proof.
- **Automated Acceptance Test:** Assert every `CrossReferenceEdge` has `guardrails.association_only === true` and MCP/OpenAPI tool descriptions explicitly state editorial association semantics.

---

### I2 — `IMPORTANT`: Unaccented Greek & Consonantal Hebrew Regex Scraping in Abbott-Smith Marked `attested_lexical_fact` Without Disambiguation Guard
- **Exact File / Function:** `scripts/build-relationship-slice.mjs` (lines 662–680, 1004–1051)
- **Verified Evidence:** `greekLemmaIndex` strips all Greek breathings, accents, and iota subscripts (`normalizeGreekStrip`) and keeps only the **first** lemma encountered in table order (`if (k && !greekLemmaIndex.has(k)) greekLemmaIndex.set(k, l)`). In Greek, minimal pairs distinguished solely by breathing/accent/subscript (e.g., `εἰ` *if* vs `εἶ` *you are*; `ἡ` *the* vs `ἤ` *or* vs `ἦ` *truly*; `τίς` *who?* vs `τις` *someone*; `νόμος` *law* vs `νομός` *pasture*; `φῶς` *light* vs `φώς` *man*) collide under `normalizeGreekStrip`! Similarly, `lxxForMatch` falls back to `normalizeHebrewConsonants` when vowel points are absent, picking `cands[0]` across Hebrew homographs while still stamping `epistemic_tier: 'attested_lexical_fact'` and `algorithm_version: null`.
- **Failure Mechanism:** When expanding from the 31-Strong's vertical slice to all `21,671` lemmas during full import, polytonic Greek minimal pairs and unpointed Hebrew homographs in `TBESG.txt` prose will resolve to the wrong target lemma while masquerading as `attested_lexical_fact`.
- **Minimal Corrective Action:** Before full `XREF-LEX` import, index Greek lemmas by **exact NFC polytonic form first** (`Map<string, Lemma[]>`), falling back to stripped diacritics **only** when the stripped bucket has cardinality `=== 1`; if cardinality `> 1` (both for Greek minimal pairs and Hebrew consonantal homographs), either quarantine or emit as `'deterministic_computational'` with explicit `algorithm_version` and ambiguity note—never silent `cands[0]` under `attested_lexical_fact`.
- **Automated Acceptance Test:** Unit test `resolveAbbottSmithGreekTarget('φῶς')` vs `'φώς'` and `'νόμος'` vs `'νομός'` asserting exact polytonic match wins and ambiguous unaccented strings are never emitted as `attested_lexical_fact`.

---

### I3 — `IMPORTANT`: Supabase Performance & Security Advisor Hygiene (`auth_rls_initplan`, Unindexed FKs, Legacy Non-Bible Tables)
- **Exact File / Function:**
  - `public.word_translation_choices` RLS policies (`word_translation_choices_select_own`, `_insert_own`, `_update_own`, `_delete_own` in `20261101162259_word_translation_schema.sql`)
  - Unindexed FKs on retained tables (`assertions`, `chronology_*`, `lexical_formations`, `lemma_components`, `lexical_connections`, `source_editions`)
  - Legacy non-Bible tables in `public` (`content`, `needs`, `posts`, `bol_raw_offers`, `bol_categories`, `bol_offers`, `offers`, `pages`)
- **Verified Evidence:**
  1. `get_advisors(performance)` confirms `word_translation_choices` RLS policies call `auth.uid()` bare instead of `(select auth.uid())`, causing per-row re-evaluation (`auth_rls_initplan`).
  2. `get_advisors(performance)` identifies unindexed foreign keys on retained tables (`assertions`, `chronology_assertions`, `chronology_evidence`, `lemma_components`, `lexical_connections`, `lexical_formations`, `source_editions`).
  3. Live `pg_tables` reveals 8 non-Bible tables (`bol_*`, `offers`, `posts`, `needs`, `pages`, `content`, `~0.44 MiB`) sharing the `public` PostgREST schema.
- **Failure Mechanism:** Per-row `auth.uid()` evaluation degrades translation choice queries as user rows grow; unindexed FKs cause sequential scans during cascade checks; unrelated tables pollute the PostgREST OpenAPI surface.
- **Minimal Corrective Action:** Wrap `(select auth.uid())` in the 4 `word_translation_choices` RLS policies, add covering B-tree indexes on retained FK columns (`~1.5 MiB` total), and confirm with project owner whether the 8 legacy `bol_*`/`offers`/`posts` tables belong to an older prototype and can be archived/dropped.
- **Automated Acceptance Test:** `get_advisors(performance)` reports `0` `auth_rls_initplan` warnings on `word_translation_choices` and `0` `unindexed_foreign_keys` on retained Bible tables.

---

### I4 — `IMPORTANT`: Documentation Drift Between `ARCHITECTURE.md`, `STAGE_G_FINAL_APPROVAL.md`, and Actual Schema
- **Exact File / Function:** `ARCHITECTURE.md` (§7.1 line 238), `STAGE_G_FINAL_APPROVAL.md` (§2–§3)
- **Verified Evidence:**
  - `ARCHITECTURE.md` §7.1 states Supabase retains `verse_translation_sources`, `word_form_lemmas`, and `lexeme_identifiers`, whereas `reclaim-supabase-storage.sql` truncates all three!
  - `STAGE_G_FINAL_APPROVAL.md` states 19 tables (`1,035.97 MiB`) are truncated, whereas `reclaim-supabase-storage.sql` truncates 23 tables (`1,048.07 MiB`).
  - 4 live database tables (`lxx_norm_word_summary`, `macula_greekstrong_morphemes`, `test_guard_probe`, `bible_internal.macula_gated_restricted_frames`) have no DDL in `supabase/migrations/`.
- **Failure Mechanism:** Future agents (`Flash High`) reading `ARCHITECTURE.md` §7.1 will write SQL joins against `word_form_lemmas` or `verse_translation_sources` assuming they remain populated in Supabase after Stage G, causing immediate post-truncation production outages.
- **Minimal Corrective Action:** Synchronize `ARCHITECTURE.md` §7.1, `STAGE_G_FINAL_APPROVAL.md`, and `supabase/migrations/` with the exact approved table retention/reclamation manifest before Stage G.
- **Automated Acceptance Test:** Automated doc-vs-SQL check asserting the table list in `reclaim-supabase-storage.sql` equals the offloaded table list in `ARCHITECTURE.md` §7.1 and `02_reclamation_tables_schema.sql`.

---

### O1 — `OPTIONAL`: Worker Bundle In-Memory Catalog Caching & Cold-Start Memory Footprint
- **Exact File / Function:** `scripts/corpus-worker.mjs` (`ensureCatalog`, lines 66–130)
- **Verified Evidence:** `metadata.json.gz` is `~5.1 MiB` compressed (`~22 MiB` uncompressed JSON including `decode_grammar_catalog` and `verses_compact`). On cold isolate start, `ensureCatalog` gunzips and `JSON.parse`s the entire catalog into Worker isolate memory (`128 MiB` Cloudflare Free Worker limit).
- **Failure Mechanism:** Under large concurrent queries (e.g., `search_syntax_patterns_v1` scanning multiple chapter shards while holding `CATALOG` in memory), Worker memory can approach `128 MiB`.
- **Minimal Corrective Action:** Split `decode_grammar_catalog` (`~14 MiB` uncompressed) out of `metadata.json.gz` into a lazy-loaded `/v1/catalog/grammar.json.gz` shard so cold-start catalog hydration stays `< 5 MiB` in isolate RAM.
- **Automated Acceptance Test:** Cold-start `lookup_cross_references_v1` and `get_reader_passages_v1` complete in `< 50ms` CPU with `< 25 MiB` isolate heap usage.

---

### O2 — `OPTIONAL`: Frontend Bundle Chunk Splitting (`maplibre-gl` Warning)
- **Exact File / Function:** `vite.config.ts` / `dist/assets/maplibre-gl-*.js`
- **Verified Evidence:** `npm.cmd run build` succeeds in `1.08s` (`index.js` = `121.79 kB` gzip; lazy-loaded `maplibre-gl` = `298.14 kB` gzip, `1,104 kB` minified, triggering Vite's default 500 kB chunk warning).
- **Minimal Corrective Action:** Set `build.chunkSizeWarningLimit: 1200` (since `maplibre-gl` is already lazy-loaded only when opening `VerseMapCanvas.ts`).
- **Automated Acceptance Test:** `npm.cmd run build` exits `0` with zero chunk warnings.

---

## 3. Stage G Deletion Readiness: **FAIL**

Every claim in `STAGE_G_FINAL_APPROVAL.md` was verified directly against live PostgreSQL (`ejoperxiwxlcbsqrkrvb`), `.artifacts/static-corpus/`, `.artifacts/db-backup/`, and `scripts/reclaim-supabase-storage.sql`:

| Stage G Sub-Audit Criterion | Status | Independent Evidence |
| :--- | :---: | :--- |
| **1. Original PG vs Expanded Cloudflare Corpus** | **VERIFIED DIVERGENCE** | Live PG holds only the **70-file pilot** in `public.syntax_nodes` (`143,781` rows) & `public.syntax_edges` (`138,712` rows), whereas Cloudflare holds all **983 Macula XML files** (`1,338,108` nodes, `1,298,688` edges). Conversely, PG holds `lxx_norm_word_summary` (`11,360` rows) & `macula_greekstrong_morphemes` (`1,010` rows) which are **absent** from Cloudflare! Also `69,205` WLC `semantic_frame` values leaked into Cloudflare (`B3`), and ~2,400+ OT verses have MT-vs-English versification shift misalignment (`B7`). |
| **2. Every Required Backup Record Restorable** | **FAIL** | **2 truncated tables (`lxx_norm_word_summary`, `macula_greekstrong_morphemes`) have zero backup files anywhere**, and **4 truncated tables lack `CREATE TABLE` DDL** in `02_reclamation_tables_schema.sql` (`B1`, `B2`). |
| **3. Recovery Test Covers Every Table vs Samples** | **FAIL** | `test-isolated-pg-restore.mjs` inserts into PGlite for **only 2 of 23 tables** (`983 + 60 = 1,043` rows), reading only 10 JS objects into memory for 15 tables and skipping 4 tables entirely (`B2`). |
| **4. All Active SQL Functions Valid After Truncation** | **FAIL** | **4 active public SQL RPCs** (`lookup_cross_testament_greek_v1`, `lookup_hebrew_to_greek_alignments_v1`, `lookup_greek_to_hebrew_alignments_v1`, `lookup_hebrew_septuagint_alignments_v1`) still query truncated tables directly and silently return `0`/`[]` after truncation (`B1`). Additionally, `get_notes_for_passage_v1` regressed homograph lemma scoping (`B5`), and keeping `word_form_lemmas` (`28 MiB`) or a slim `(word_id, lemma_id)` map (`~8 MiB`) in Postgres avoids breaking `NOTE-10` while still staying well below `400 MiB`! |
| **5. Preflight Checks Immune to Stale/Incomplete Data** | **FAIL** | `reclaim-supabase-storage.sql` Preflight Check 2 calls `verify_referential_integrity_v1` / `audit_evidence_coverage_v1`, which echo **hardcoded constants** from `metadata.json.gz` after probing only **12 of 1,890 shards (`0.63%`)** (`B4`). |
| **6. Corrupted Cloudflare Deploy Overwrite Protection** | **FAIL** | `.github/workflows/publish-static-corpus.yml` runs `export-static-corpus.py` against live Supabase before `wrangler deploy`; post-Stage-G, running `export-static-corpus.py` wipes local shards with `0`-row exports (`B4`). |
| **7. Transaction Atomic, Reversible Pre-Commit, Fail-Closed** | **PARTIAL** | PostgreSQL `BEGIN ... TRUNCATE ... COMMIT;` IS transactional and reversible via `ROLLBACK` *prior* to `COMMIT` (though `TRUNCATE` acquires `ACCESS EXCLUSIVE` locks across all 23 tables plus FK-referencing tables simultaneously), and post-commit recovery is broken (`B2`) while preflight checks are fail-open against shard corruption (`B4`). |
| **8. Storage Projection Accounts for All Retained Objects** | **VERIFIED (`~349.68–361.52 MiB`)** | Live `pg_database_size` = **`1,397.75 MiB`**. Truncating the 21 backed-up tables reclaims **`1,036.23 MiB`**, leaving **`361.52 MiB`**; truncating all 23 (once the 2 summary tables are offloaded & backed up) reclaims **`1,048.07 MiB`**, leaving **`349.68 MiB`** (including `pg_catalog` `14.61 MiB`, `auth` `1.48 MiB`, `storage` `0.47 MiB`, `bible_internal` `0.44 MiB`, and all retained `public` tables + indexes). Even if `word_form_lemmas` (`28.38 MiB`) is retained in Postgres to preserve fast, exact `NOTE-10` homograph lemma resolution, remaining DB size is **`378.06 MiB`** (`< 400 MiB` target and `122 MiB` below the `500 MiB` Free Tier cap!). |

---

## 4. Recovery Readiness: **FAIL**

### Exact Audit of All 23 `TRUNCATE` Targets in `scripts/reclaim-supabase-storage.sql`

| # | Schema.Table | Live Rows | Live Size (MiB) | In Static Corpus `/tables/`? | In `02_reclamation_tables_schema.sql`? | SQL-Inserted in `test-isolated-pg-restore.mjs`? |
| :-: | :--- | ---: | ---: | :---: | :---: | :---: |
| 1 | `public.lxx_swete_words` | 588,579 | 217.56 | Yes (`588,579`) | Yes | **NO** (10 JS lines only) |
| 2 | `public.verse_translation_sources` | 443,524 | 150.70 | Yes (`443,524`) | Yes | **NO** (10 JS lines only) |
| 3 | `public.macula_hebrew_morphemes` | 475,911 | 150.56 | Yes (`475,911`) | Yes | **NO** (10 JS lines only) |
| 4 | `public.macula_gated_field_values` | 917,053 | 121.02 | Filtered (`459,759`) + `.enc` (`457,294`) | Yes | **NO** (JS array only) |
| 5 | `public.morphhb_tokens` | 306,786 | 62.78 | Yes (`306,786`) | Yes | **NO** (10 JS lines only) |
| 6 | `public.macula_greek_tokens` | 275,520 | 61.98 | Yes (`275,520`) | Yes | **NO** (10 JS lines only) |
| 7 | `public.syntax_nodes` | 143,781 | 48.20 | Expanded (`1,338,108`) | Yes | **NO** (10 JS lines only) |
| 8 | `public.cross_token_mappings` | 299,586 | 42.34 | Yes (`299,586`) | Yes | **NO** (JS array only) |
| 9 | `public.tagnt_tokens` | 142,096 | 41.35 | Yes (`142,096`) | Yes | **NO** (10 JS lines only) |
| 10 | `public.syntax_edges` | 138,712 | 35.61 | Expanded (`1,298,688`) | Yes | **NO** (10 JS lines only) |
| 11 | `public.word_form_lemmas` | 139,899 | 28.38 | Yes (`139,899`) | Yes | **NO** (10 JS lines only) |
| 12 | `public.reader_rendering_groups` | 95,431 | 19.63 | Yes (`95,431`) | Yes | **NO** (10 JS lines only) |
| 13 | `public.edition_passages` | 62,406 | 17.75 | Yes (`62,406`) | Yes | **NO** (10 JS lines only) |
| 14 | **`public.lxx_norm_word_summary`** | **11,360** | **11.59** | **NO (MISSING!)** | **NO (MISSING DDL!)** | **NO (UNTESTED!)** |
| 15 | `public.reader_english_verses` | 31,103 | 10.67 | Yes (`31,103`) | Yes | **NO** (10 JS lines only) |
| 16 | `public.hebrew_lxx_verse_map` | 22,633 | 9.31 | Yes (`22,633`) | Yes | **NO** (10 JS lines only) |
| 17 | `public.lexeme_identifiers` | 65,610 | 8.20 | Yes (`65,610`) | Yes | **NO** (10 JS lines only) |
| 18 | `public.semantic_annotations` | 35,342 | 7.30 | Yes (`35,342`) | Yes | **NO** (10 JS lines only) |
| 19 | `public.versification_mappings` | 31,203 | 2.52 | Yes (`31,203`) | **NO (MISSING DDL!)** | **NO** (10 JS lines only) |
| 20 | **`public.macula_greekstrong_morphemes`** | **1,010** | **0.25** | **NO (MISSING!)** | **NO (MISSING DDL!)** | **NO (UNTESTED!)** |
| 21 | `bible_internal.macula_syntax_import_files` | 983 | 0.23 | Yes (`983`) | Yes | **YES (`983` rows)** |
| 22 | `public.hebrew_lxx_word_alignments` | 9 | 0.11 | Yes (`9`) | **NO (MISSING DDL!)** | **NO** (9 JS lines only) |
| 23 | `bible_internal.macula_syntax_unmapped_nodes` | 60 | 0.03 | Expanded (`128`) | Yes | **YES (`60` rows)** |
| **Total** | **23 Tables** | **4,228,600** | **1,048.07** | **21 / 23** | **19 / 23** | **2 / 23 (`0.024%` rows)** |

---

## 5. Macula and Septuagint Completeness Assessment

All metrics below were **recomputed directly by streaming every `.jsonl.gz` and chapter shard** in `.artifacts/static-corpus/` (not read from cached audit snapshots).

### 5.1 Macula 7-Dimension Assessment

| Dimension | WLC Hebrew (`edition_id=11`) | Nestle 1904 Greek (`edition_id=18`) | SBLGNT Greek (`edition_id=19`) | Assessment & Root-Cause Distinction |
| :--- | :--- | :--- | :--- | :--- |
| **1. Source-File Completeness** | **`929 / 929` (`100%`)** Lowfat XML chapter files (`47db250`), all git-blob SHA-1 verified | **`27 / 27` (`100%`)** Lowfat XML book files (`80e39e0`), all git-blob SHA-1 verified | **`27 / 27` (`100%`)** Lowfat XML book files (`80e39e0`), all git-blob SHA-1 verified | **100% complete (`983 / 983` files).** Zero missing upstream XML files. |
| **2. Syntax-Tree Completeness** | `840,902` nodes (`475,911` terminals, `364,991` constituents) across `23,035 / 23,261` OT verses (`99.03%`) | `246,881` nodes (`137,719` terminals, `109,162` constituents; `5,503` cross-verse) across `7,941 / 7,942` NT verses (`99.99%`) | `246,900` nodes (`137,730` terminals, `109,170` constituents; `5,505` cross-verse) across `7,938 / 7,942` NT verses (`99.95%`) | **NT differences are genuine critical-text edition boundaries:** Nestle 1904 omits only `Acts 19:41` (`44:19:41`, merged into Greek `19:40`); SBLGNT omits `44:19:41` + movable doxology `Rom 16:25–27` (`45:16:25-27`). **OT 226-verse gap is an ETL versification defect (`B7`), NOT missing WLC XML!** |
| **3. Node & Edge Integrity** | `0` orphan `parent_node_id`; `0` orphan edge endpoints across `1,298,688` total `syntax_edges` (`1,294,607` `parent_child` + `4,081` STEP TAGNT conjoin edges) | Included in `0 / 1,298,688` orphan check | Included in `0 / 1,298,688` orphan check | **100% structural tree/edge referential integrity** inside `syntax_nodes` / `syntax_edges`. (`4,081` STEP TAGNT `conjoin_*` edges use `source_node_id = NULL` + `dependent_word_position` by design.) |
| **4. Canonical Mapping Completeness** | `475,911` XML terminals -> `macula_id` (`100%`), `464,727` (`97.65%`) non-null `word_id`, `71` XML terminals (`128` nodes) unmapped | `137,719` XML terminals -> `xml_id` (`100%`), `137,431` (`99.79%`) linked to STEP `word_id` (`348` apparatus diffs) | `137,730` XML terminals -> `xml_id` (`100%`), `137,505` (`99.84%`) linked to STEP `word_id` (`236` apparatus diffs) | **CRITICAL DEFECT ON OT (`B7`):** `macula_hebrew_morphemes` & `morphhb_tokens` joined MT `(book, ch_mt, vs_mt)` directly to English-versified `verses`, misaligning ~2,400+ verses across 116 headed Psalms & ~35 shifted OT chapters! |
| **5. Morphological Coverage** | `475,911 / 475,911` (`100%`) morphemes have `morph_code` (+ `306,786` `morphhb_tokens`) | `137,779 / 137,779` (`100%`) tokens have `morph_code` & `lemma` (+ `142,096` `tagnt_tokens`) | `137,741 / 137,741` (`100%`) tokens have `morph_code` & `lemma` | **100% morphological annotation coverage** across all imported Hebrew, Aramaic, and Greek tokens. |
| **6. Syntactic-Role Coverage** | `211,858 / 840,902` (`25.19%`) all nodes; `101,942 / 364,991` (`27.93%`) non-terminals | `81,726 / 246,881` (`33.10%`) all nodes; `34,958 / 109,162` (`32.02%`) non-terminals | `81,700 / 246,900` (`33.09%`) all nodes; `34,983 / 109,170` (`32.04%`) non-terminals | **Expected linguistic boundary (NOT missing data):** In Lowfat syntax trees, `@role` (`s`, `v`, `o`, `adv`, `io`, `p`) marks clause-level immediate constituents; sub-clausal `<wg>` phrase wrappers carry `@class`/`@rule` rather than clause `@role`. |
| **7. Semantic-Role / Frame Coverage** | `69,205` nodes carry `@frame` (**MUST BE GATED OUT** per `field_license_registry` row 15 — see `B3`!); Louw-Nida/SDBH domains gated (`457,294` rows in `.enc`) | `25,493 / 246,881` (`10.33%`) carry predicate `@frame`; Louw-Nida domains gated (`macula-greek` `ln`/`domain` disabled) | `25,362 / 246,900` (`10.27%`) carry predicate `@frame`; Louw-Nida domains gated | **Expected linguistic + license boundary:** Predicate frames (`A0`/`A1`/`A2`) apply only to verbal/eventive predications (~10% of tree nodes). Domain/SDBH fields are intentionally license-gated. |

### 5.2 Septuagint (`lxx-swete`) 5-Dimension Assessment

| Dimension | Verified Metric | Scholarly vs Implementation Distinction |
| :--- | :--- | :--- |
| **1. Original Greek Text Coverage** | **`588,579` tokens** across **`55` Swete book files** (`37` canonical OT book files + `18` deuterocanonical / double-version books: 1 Esdras, Judith, Tobit, 1–4 Maccabees, Odes, Wisdom, Sirach, Psalms of Solomon, Baruch, Letter of Jeremiah, Susanna OG/Th, Daniel Th, Bel OG/Th). | **Upstream Source Gap Identified:** In `nathans/lxx-swete` (`commit 26bad3e`), missing file numbers `7, 9, 22` are alternate codex apparatus splits (`06` Joshua, `08` Judges, `21` Tobit are present), **but `30` (`Ecclesiastes`, canonical `book=21`, 222 verses) is genuinely absent from the upstream `nathans/lxx-swete` repo**! Nehemiah (`book=16`) **IS present** inside `18.Esdras_B.txt` chapters 11–23. |
| **2. Versification Alignment** | **`22,633` rows** in `hebrew_lxx_verse_map` (`18,874` `same_reference`, `2,350` `psalm_numbering_shift`, `677` `reordered` [Jeremiah/etc.], `498` `unmatched_hebrew` [MT-only minuses in LXX], `118` `versification_shift`, `116` `superscription_title_verse`) covering `22,135` aligned OT verses. | **ETL Mapping Bug (`B7`):** Exactly **`628` canonical OT verses** (`23,261 - 22,633`) have no `hebrew_lxx_verse_map` entry: `222` are missing Ecclesiastes (`book=21`), and **`406` are Nehemiah (`book=16`)** which was accidentally skipped because `SWETE_CANONICAL_MAP` mapped `18 -> 15` (Ezra) 1-to-1 and ignored `16` (`Esdras B` chs. 11–23)! |
| **3. Morphological Annotation** | **`0 / 588,579` (`0.00%`)** on `lxx_swete_words` | **Expected source boundary (correctly disclaimed in `SeptuagintPassageResponse`):** Swete (`First1KGreek/tlg0527`) is an unlemmatized diplomatic Greek edition, not CATSS/Rahlfs-MorphGNT. |
| **4. Lexical Annotation** | **`0 / 588,579` (`0.00%`)** Strong's/lemmas on `lxx_swete_words` (only `word_text` + diacritic-stripped `normalized_word`). Indirect Hebrew->Greek Strong's gloss counts exist in `macula_gated_field_values` (`greek` / `greekstrong`) & unbacked-up `macula_greekstrong_morphemes`. | **Expected source boundary + Stage G risk (`B1`):** `lookup_cross_testament_greek_v1` relies on `lxx_norm_word_summary` and `macula_greekstrong_morphemes`, which Stage G currently truncates without Worker replacement! |
| **5. Hebrew–Greek Word Alignment** | **`9` curated rows** in `hebrew_lxx_word_alignments` (Isaiah 53:7 benchmark) + statistical/lexicon-level `macula` `greekstrong` counts. | **Important completeness distinction:** Token-to-token MT–LXX alignment (`hebrew_lxx_word_alignments`) is **only a 9-row benchmark pilot**, NOT a corpus-wide word-alignment dataset (such as Clear-Bible / CATSS parallel alignments). Current comparison RPCs accurately report `unaligned` status on non-pilot verses rather than fabricating alignments. |

### 5.3 Reproducibility of Integrity Metrics vs Cached Audit Snapshots
- **Finding:** **FAIL (`B4`)** — Currently `audit_evidence_coverage_v1` and `verify_referential_integrity_v1` in `scripts/corpus-worker.mjs` do **not** recompute duplicate, orphan, or multi-etymology metrics from deployed shards; they return **literal hardcoded constants** embedded into `/v1/catalog/metadata.json.gz` by `scripts/export-static-corpus.py` lines 1059–1089 and 1137–1173 after checking only 12 sample URLs. Our streaming Node audit (`audit_corpus_metrics.mjs`) proved that exact metrics **can and must** be computed deterministically from the raw `.jsonl.gz` shards during every export/verification run.

---

## 6. Semantic and Lexical Relationship Quality Assessment

Evaluated against `RELATIONSHIP_IMPORT_HANDOFF.md`, `src/api/relationship-*.ts`, `scripts/corpus-relationships-rpc.mjs`, and `scripts/build-relationship-slice.mjs`:

| Evaluation Dimension | Audit Assessment | Status |
| :--- | :--- | :---: |
| **1. Canonical Relationship Identity & Stable IDs** | 64-bit FNV-1a deterministic IDs (`rel:v1:xref:...` & `rel:v1:lex:...`) use canonical coordinates and `lemma_key`s rather than mutable DB surrogates. **Bug found & fixed locally:** `direction: 'inverse'` previously reversed `(a, b)` on directed lexical edges, breaking bidirectional note matching (`B6.3`). | **PASS (Fixed Locally)** |
| **2. Cross-Reference Versification Rules** | Preserves Psalm `verse 0` superscriptions (`19:3:0` distinct from `19:3:1`), `versification_shift` notes (`3 John 1:15`, `2 Cor 13:13`), contiguous `verse_range` (`Prov 8:22–24`, `John 1:1–3`), non-contiguous `verse_cluster`, and `17` KJV/TR `edition_only_non_canonical` verses (`Matt 17:21`, etc.) with `start_verse_id: null`. | **PASS** |
| **3. Hebrew / Aramaic / Greek Lexical Mappings** | Distinguishes `hbo`, `arc`, and `grc`; preserves STEP homograph siblings (`H1254A`/`B`, `H0430G`/`a`). **Bug found & fixed locally:** `key_by_lookup` previously allowed null-tag contextual sub-meanings (`lemma:H0430a`) to overwrite primary `'G'`/`'A'` lemmas (`lemma:H0430G`) (`B6.4`). | **PASS (Fixed Locally)** |
| **4. Relationship Directionality & Deduplication** | Collapses duplicate target groups within an anchor while preserving multi-phrase anchors in the same verse (`Gen 2:7`). **Bug found & fixed locally:** `corpus-relationships-rpc.mjs` now applies `translation_filter` to both `outgoing` and `incoming` and paginates `edition_only_passage` (`B6.5`). | **PASS (Fixed Locally)** |
| **5. Linguistic & Epistemic Classification** |<ul><li>*Shared roots ≠ synonymy:* Enforced (`same_documented_root` has `implies_synonymy: false`).</li><li>*Transliteration ≠ cognacy:* **Previously violated (`G2`/`H175`, `G5`/`H2` marked `cognate` + `same_root`); fixed locally via `'loan_transliteration'` (`implies_common_etymology: false`) (`B6.1`).**</li><li>*Similar spellings ≠ historical relationship:* Enforced (`orthographic_overlap` on `אדם`/`דם` has `implies_common_etymology: false`).</li><li>*Shared English renderings ≠ equivalent meaning:* Enforced (`related_translation` marked `statistical_association`, `implies_synonymy: false`).</li><li>*Source-attested root ≠ source-attested pairwise sibling link:* **Previously violated (`same_documented_root` co-root joins marked `attested_lexical_fact` + `etymology_type` broadcast bug); fixed locally (`deterministic_computational`, `co_root_peer_join_v1`) (`B6.2`).**</li><li>*Cross-references ≠ prophecy/quotation/typology:* Enforced via `CROSS_REFERENCE_GUARDRAILS`.</li></ul> | **PASS on Slice (See `I2` for Full Import)** |
| **6. Source Provenance & Licenses** | `CrossReferences.org` (`CC BY 4.0`, commit `671bbf73...`) excludes restricted French `s21`; `STEPBible TBESH` (`CC BY 4.0`, commit `be4191f0...`) slices columns `0..6` only, strictly excluding restricted column 7 (Online Bible Meaning). **Provenance misattribution on `lexical_connections`, `verse_translation_sources`, and `words.co_occurrences` fixed locally (`B6.6`).** | **PASS (Fixed Locally)** |
| **7. Pagination & Free-Tier Query Complexity** | `O(1)` Worker shard lookups (`1` manifest + `1` book or `1` 64-way hash bucket `~15–120 KiB` gzip) with signed `rc1:<offset>:<sig>` cursors and `limit <= 100`. Zero SQL runtime cost; fits comfortably inside Cloudflare Workers Free Tier. | **PASS** |

---

## 7. Exact Unresolved Blockers Before Stage G Execution

Stage G (`scripts/reclaim-supabase-storage.sql`) **MUST NOT BE EXECUTED** until every item below is resolved and verified:

1. **[BLOCKER B3 — Live DB Security]:** Revoke `PUBLIC`, `anon`, and `authenticated` `EXECUTE` privileges on `public.ingest_lexical_formations_batch_v1(jsonb)`, `public.ingest_quarantined_records_batch_v1(jsonb)`, and `public.call_corpus_rpc_v1(text, jsonb)`; drop `public.test_guard_probe`.
2. **[BLOCKER B3 — Public Corpus License Compliance]:** Strip restricted `macula-hebrew` `semantic_frame` (`69,205` WLC nodes) from `scripts/export-static-corpus.py` and redeploy clean `/tables/syntax_nodes/*`, `/v1/chapters/*`, and `/v1/syntax/*` shards; remove hardcoded passphrase and plaintext gated `.json` files from `scripts/extract-private-backups.mjs`.
3. **[BLOCKER B7 — OT Versification Alignment & Nehemiah LXX Mapping]:** Fix MT-to-English canonical `verse_id` & consonantal `word_id` resolution via `versification_mappings` for `macula_hebrew_morphemes`, `morphhb_tokens`, `cross_token_mappings`, and WLC `syntax_nodes` (~2,400+ misaligned OT verses including Psalm 3:1 & Genesis 32:1), and add the missing 406 Nehemiah (`book=16` -> `18.Esdras_B` chs. 11–23) mappings to `hebrew_lxx_verse_map` **before** truncating source tables.
4. **[BLOCKER B1 — Unbacked-Up Tables & 4 Broken SQL RPCs]:** Export/back up `public.lxx_norm_word_summary` and `public.macula_greekstrong_morphemes`, add missing `CREATE TABLE` DDLs (`hebrew_lxx_word_alignments`, `versification_mappings`, `lxx_norm_word_summary`, `macula_greekstrong_morphemes`), and offload/wrap `lookup_cross_testament_greek_v1`, `lookup_hebrew_to_greek_alignments_v1`, `lookup_greek_to_hebrew_alignments_v1`, and `lookup_hebrew_septuagint_alignments_v1` in `corpus-worker.mjs` + SQL with fail-closed behavior.
5. **[BLOCKER B5 — Hybrid Gateway Fail-Closed & `NOTE-10` Homograph Fix]:** Make `get_verse_translations_v1`, `save_word_translation_v1`, `lookup_lexical_semantics_v1`, `get_word_formation_v1`, and `get_notes_for_word_v1` fail closed on Worker errors; retain `word_form_lemmas` (`28.38 MiB`, keeping DB at `~378 MiB < 400 MiB`!) OR resolve exact `lemma_id`s without `base_strongs` conflation in `get_notes_for_passage_v1`; remove `STATIC_CORPUS_RPCS` fallback storm in `supabase/functions/bible-mcp/index.ts`.
6. **[BLOCKER B2 & B4 — Real Recovery Implementation, Full 23-Table PGlite Restore Test & Offline Corpus Rebuild]:** Implement real Postgres restore + full-line SHA-256 verification in `scripts/restore-supabase-storage.mjs`, test SQL `INSERT` into **all** target tables in `scripts/test-isolated-pg-restore.mjs`, replace hardcoded audit snapshots in `export-static-corpus.py` / `corpus-worker.mjs` with computed shard metrics, and add `--from-pinned-shards` to `export-static-corpus.py` + `.github/workflows/publish-static-corpus.yml` so post-Stage-G Worker deploys never read from truncated Supabase.

---

## 8. Prioritized Corrective Tasks

| Priority | Task ID | Scope | Severity |
| :---: | :--- | :--- | :---: |
| 1 | **AUDIT-01** | Lock down `anon` `SECURITY DEFINER` ingest RPCs (`ingest_lexical_formations_batch_v1`, `ingest_quarantined_records_batch_v1`, `call_corpus_rpc_v1`), drop `public.test_guard_probe`, and fix `word_translation_choices` `(select auth.uid())` RLS + unindexed FKs. | `BLOCKER` |
| 2 | **AUDIT-02** | Fix OT MT-vs-English versification alignment (`versification_mappings`) + consonantal verification on `macula_hebrew_morphemes`, `morphhb_tokens`, `cross_token_mappings`, and WLC `syntax_nodes`, and ingest the 406 Nehemiah (`Esdras B` chs. 11–23) rows into `hebrew_lxx_verse_map`. | `BLOCKER` |
| 3 | **AUDIT-03** | Strip license-gated `macula-hebrew` `@frame` (`69,205` WLC nodes) in `export-static-corpus.py`, remove hardcoded passphrase/plaintext gated JSON in `extract-private-backups.mjs`, compute live coverage/integrity metrics instead of hardcoded constants, and add `--from-pinned-shards` offline rebuild mode + safe CI workflow. | `BLOCKER` |
| 4 | **AUDIT-04** | Offload/wrap the 4 broken SQL RPCs (`lookup_cross_testament_greek_v1`, `lookup_hebrew_to_greek_alignments_v1`, `lookup_greek_to_hebrew_alignments_v1`, `lookup_hebrew_septuagint_alignments_v1`), enforce fail-closed `'unavailable'` handling across all hybrid SQL RPCs, remove `bible-mcp` fallback amplification, and retain `word_form_lemmas` (`28.38 MiB`) to preserve `NOTE-10` homograph accuracy and eliminate per-word Worker hops. | `BLOCKER` |
| 5 | **AUDIT-05** | Rebuild deterministic backup DDL (`02_reclamation_tables_schema.sql`) from migrations for all truncated tables, back up `lxx_norm_word_summary` & `macula_greekstrong_morphemes`, implement real PostgreSQL restore + SHA-256 verification in `restore-supabase-storage.mjs`, and verify SQL `INSERT` across **100% of target tables** in `test-isolated-pg-restore.mjs` + exhaustive shard SHA-256 preflight in `preflight-storage-reclamation.mjs`. | `BLOCKER` |
| 6 | **AUDIT-06** | Execute full `XREF-LEX` import (`CrossReferences.org` all 66 books + full `STEPBible` `21,671`-lemma lexical graph) incorporating the `loan_transliteration` separation, exact polytonic Greek / homograph-safe Abbott-Smith resolution (`I2`), corpus-wide `related_translation` support threshold, `bible-mcp` tool registration, and `bibleresearch-corpus` deployment. | `IMPORTANT` |
| 7 | **AUDIT-07** | Synchronize `ARCHITECTURE.md` §7.1, `STAGE_G_FINAL_APPROVAL.md`, and `PROJECTMAP.md`, then re-run full hybrid equivalence + recovery gates and present Stage G `[USER-CHECK]` sign-off. | `IMPORTANT` |

---

## 9. Tests Added or Executed During This Audit

### 9.1 Non-Destructive Targeted Code & Slice Corrections Implemented (Section 7)
- `src/api/corpus-client.ts`: Added bounded 128-entry session LRU cache (`callCorpusRpc`, `fetchCorpusJson`, `clearCorpusSessionCache`) and removed `get_reader_word_v1` from `CORPUS_RO_OPS` so mutable `words.custom_definition` in Supabase is never bypassed.
- `src/api/rpc.ts`: Updated `readerRPC` to fail closed on `isStaticCorpusRpc` failures rather than triggering synchronous PostgreSQL `call_corpus_rpc_v1` HTTP connection amplification.
- `src/api/relationship-types.ts`, `src/api/relationship-model.ts`, `src/api/relationship-notes-adapter.ts`: Added `'loan_transliteration'` (`implies_common_etymology: false`, note prefill `'related'` instead of `'same_root'`), canonicalized `buildLexicalRelationshipId` across `'directed'` and `'inverse'` edges, and hardened `validateLexicalEdgeIntegrity`.
- `scripts/corpus-relationships-rpc.mjs`: Applied `translation_filter` symmetrically to `outgoing` and `incoming` cross-reference edges and enabled signed cursor pagination on `edition_only_passage`.
- `scripts/build-relationship-slice.mjs`: Separated `'loan_transliteration'` from `'cognate'`, reclassified co-root sibling joins as `'deterministic_computational'` (`co_root_peer_join_v1`), removed `.slice(0, 12)` truncation and `etymology_type` broadcast, fixed `pickPrimaryLemma` base Strong's index priority (`H430 -> lemma:H0430G`), corrected provenance attributions, sorted shard edges deterministically by epistemic tier, and regenerated `.artifacts/static-corpus/v1/relationships/*`.
- `scripts/verify-relationship-foundation.mjs`: Added **8 new regression assertions** (totaling **63 automated checks**).

### 9.2 Verification Suites & Audits Executed
1. `npm.cmd run check:types` -> **PASS** (`0` TypeScript errors)
2. `npm.cmd run check:size` -> **PASS** (`0` file `>450` or `@section` `>80` or `@toc` mismatches across all `src/**/*.ts`)
3. `npm.cmd run build` -> **PASS** (`vite v8.3.5`, `99` modules transformed in `1.08s`)
4. `node scripts/notes-guard.mjs --static` -> **PASS** (`12` notes files, `33` UI files, `72` source files)
5. `node scripts/verify-relationship-foundation.mjs` -> **PASS (`63 passed, 0 failed`)**
6. **Live Supabase Read-Only SQL & Advisor Audits (`ejoperxiwxlcbsqrkrvb`):** Verified exact `pg_database_size` (`1,397.75 MiB`), all 89 `public` + 3 `bible_internal` table sizes/row counts, `pg_proc` source scan across all RPCs, `has_function_privilege` privilege matrix for `anon`/`authenticated`, `field_license_registry` vs `syntax_nodes.semantic_frame`, and `get_advisors(security)` + `get_advisors(performance)`.
7. **Streaming Static-Corpus Completeness & Referential Integrity Scan (`audit_corpus_metrics.mjs`):** Streamed all `1,338,108` `syntax_nodes`, `1,298,688` `syntax_edges`, `475,911` `macula_hebrew_morphemes`, `306,786` `morphhb_tokens`, `275,520` `macula_greek_tokens`, `142,096` `tagnt_tokens`, `588,579` `lxx_swete_words`, `22,633` `hebrew_lxx_verse_map`, `983` `macula_syntax_import_files`, and chapter shards `b19-c3.json.gz` / `b1-c31.json.gz` / `b1-c32.json.gz`.

---

## 10. Recommended Handoff Tasks for Gemini Flash High

Execute the `AUDIT-01` through `AUDIT-07` queue added at the top of [`TASKS.md`](file:///C:/Projects/BibleResearch/TASKS.md) **strictly one task at a time in exact sequence**:
1. **Never run `scripts/reclaim-supabase-storage.sql`** during `AUDIT-01`..`AUDIT-06`.
2. Fix live security (`AUDIT-01`) and OT/LXX alignment (`AUDIT-02`) **while all source tables are still intact in Supabase**, then re-export clean license-compliant static shards (`AUDIT-03`), complete hybrid RPC fail-closed + `word_form_lemmas` retention (`AUDIT-04`), prove 100%-table PGlite + SHA-256 recovery (`AUDIT-05`), complete full-corpus `XREF-LEX` import (`AUDIT-06`), and only then present `AUDIT-07` / `CORP-04` for explicit user approval of Stage G truncation.
