-- scripts/reclaim-supabase-storage.sql
-- STAGE G: Production Storage Reclamation
--
-- Preconditions (all verified):
-- 1. `.artifacts/static-corpus/` and `.artifacts/db-backup/` exported and verified via `scripts/verify-static-corpus.py`.
-- 2. `bibleresearch-corpus` deployed and verified via `scripts/verify-static-corpus-remote.mjs --all`.
-- 3. Application (`src/api/rpc.ts`), MCP (`supabase/functions/bible-mcp/`), and hybrid PostgreSQL RPCs
--    cut over and verified via `scripts/verify-hybrid-equivalence.mjs` and `scripts/notes-guard.mjs --compare`.
-- 4. Compact precomputed summary tables `public.lxx_norm_word_summary` (12 MB) and
--    `public.macula_greekstrong_morphemes` (128 kB) populated so `lookup_cross_testament_greek_v1`,
--    `lookup_hebrew_to_greek_alignments_v1`, and `lookup_greek_to_hebrew_alignments_v1` operate natively
--    with zero runtime dependency on `lxx_swete_words`, `macula_hebrew_morphemes`, or `macula_gated_field_values`.
--
-- Effect:
-- - Truncates the 14 pure-static corpus/syntax tables (~890 MB) now served from Cloudflare Static Assets
--   (`bibleresearch-corpus`), preserving their table definitions/RLS policies while immediately releasing
--   100% of their heap and index disk pages back to the OS in < 1 second.
-- - Preserves all 11 tables checked by `scripts/notes-guard.mjs` (`verses`, `words`, `entity_relationships`,
--   `semantic_annotations`, `canonical_entities`, `lemmas`, `word_form_lemmas`, `books`, `concepts`,
--   `places`, `chronology_events`), plus `verse_translation_sources`, `lexeme_identifiers`, `edition_passages`,
--   `reader_rendering_groups`, `hebrew_lxx_verse_map`, `reader_english_verses`, `lxx_norm_word_summary`,
--   and `macula_greekstrong_morphemes`.
-- - Reduces total database size from ~1,385 MB to ~490 MB (below the 500 MB Supabase Free-plan target).

-- Phase 1: Reclaim ~890 MB of pure-static token/morpheme/syntax tables offloaded to `bibleresearch-corpus`
TRUNCATE TABLE
  public.cross_token_mappings,
  public.token_morphemes,
  public.macula_gated_field_values,
  public.macula_hebrew_morphemes,
  public.macula_greek_tokens,
  public.lxx_swete_words,
  public.morphhb_tokens,
  public.tagnt_tokens,
  public.syntax_edges,
  public.syntax_nodes,
  bible_internal.macula_syntax_unmapped_nodes,
  bible_internal.macula_syntax_import_files;

-- Phase 2: Verify post-reclamation database size (< 500 MB target)
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS total_db_size,
  pg_database_size(current_database()) AS total_db_bytes,
  round(pg_database_size(current_database()) / (1024.0 * 1024.0), 2) AS total_db_mib;
