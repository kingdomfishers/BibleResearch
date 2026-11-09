-- ============================================================================
-- scripts/reclaim-supabase-storage.sql
-- STAGE G: Production Storage Reclamation (WITH MANDATORY IN-TRANSACTION PREFLIGHT)
--
-- IMPORTANT: DO NOT EXECUTE UNTIL EXPLICIT USER APPROVAL IS GRANTED.
--
-- Live Storage Accounting (measured on Supabase `ejoperxiwxlcbsqrkrvb`):
--   Current total database size:           1,397.73 MiB (1,465,625,747 bytes)
--   19 static tables scheduled for offload: 1,035.13 MiB (1,085,411,328 bytes)
--   Projected post-reclamation DB size:      362.60 MiB   (380,214,419 bytes)
--   Supabase Free limit:                     500.00 MiB
--   Preferred target:                      < 400.00 MiB (ACHIEVED: ~362.60 MiB)
--
-- 19 Reclaimed Static Tables (1,035.13 MiB total, 3,083,152 rows):
--   1. public.macula_hebrew_morphemes                  (200.30 MiB | 475,911 rows)
--   2. public.macula_greek_tokens                      (122.90 MiB | 275,520 rows)
--   3. public.word_form_lemmas                         (114.98 MiB | 270,447 rows)
--   4. public.lxx_swete_words                          (112.41 MiB | 588,579 rows)
--   5. public.morphhb_tokens                           (101.14 MiB | 306,786 rows)
--   6. public.syntax_nodes                              (97.06 MiB | 125,010 rows)
--   7. public.verse_translation_sources                 (86.48 MiB | 443,524 rows)
--   8. public.tagnt_tokens                              (63.91 MiB | 142,096 rows)
--   9. public.syntax_edges                              (59.03 MiB | 121,477 rows)
--  10. public.lexeme_identifiers                        (31.99 MiB | 113,595 rows)
--  11. public.edition_passages                          (13.80 MiB |  62,418 rows)
--  12. public.reader_rendering_groups                   (12.56 MiB |  98,133 rows)
--  13. public.hebrew_lxx_verse_map                       (9.68 MiB |  22,633 rows)
--  14. public.reader_english_verses                      (6.94 MiB |  31,215 rows)
--  15. public.token_morphemes                            (0.81 MiB |   2,321 rows)
--  16. bible_internal.macula_syntax_import_files         (0.48 MiB |     983 rows)
--  17. public.macula_gated_field_values                  (0.36 MiB |   2,294 rows)
--  18. public.cross_token_mappings                       (0.18 MiB |     147 rows)
--  19. bible_internal.macula_syntax_unmapped_nodes       (0.13 MiB |      60 rows)
--
-- Safety Guarantees:
-- 1. Explicit atomic transaction (BEGIN ... COMMIT).
-- 2. Strict lock (10s) and statement (60s) timeouts.
-- 3. Fail-closed: Any preflight check failure rolls back the entire transaction.
-- 4. Exact pre-truncation row count checks on all 19 tables before truncate.
-- 5. NO CASCADE: TRUNCATE explicitly lists all mutually-referencing target tables.
-- 6. No data deletion of dynamic research (verses, words, places, notes, bookmarks).
-- 7. Private restricted frames preserved in bible_internal.macula_gated_restricted_frames (200 rows).
-- 8. In-transaction post-truncation assertion verifying target tables emptied and core tables intact.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- ============================================================================
-- PHASE 0: MANDATORY IN-TRANSACTION PREFLIGHT GATE
-- Blocks execution (RAISE EXCEPTION / ROLLBACK) unless all live Cloudflare
-- assets, hybrid RPCs, referential integrity, exact pre-truncation row counts,
-- and size targets pass.
-- ============================================================================
DO $preflight$
DECLARE
  v_syn jsonb;
  v_ref jsonb;
  v_aud jsonb;
  v_ovw jsonb;
  v_res_v2 jsonb;
  v_sem jsonb;
  v_occ jsonb;
  v_glo jsonb;
  v_lxx jsonb;
  v_xtest jsonb;
  v_db_bytes bigint;
  v_reclaim_bytes bigint;
  v_remaining_bytes bigint;
  v_remaining_mib numeric(10,2);
  v_count bigint;
BEGIN
  -- 1. Live Cloudflare syntax tree & asset SHA-256 verification
  v_syn := public.validate_syntax_tree_integrity_v1();
  IF coalesce(v_syn->>'status', '') <> 'PASS'
     OR coalesce((v_syn->>'is_valid')::boolean, false) <> true
     OR coalesce(v_syn #>> '{live_asset_verification,status}', '') <> 'PASS'
     OR coalesce((v_syn #>> '{live_asset_verification,manifest_total_assets}')::int, 0) < 1800 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: validate_syntax_tree_integrity_v1 failed: %', v_syn;
  END IF;

  -- 2. Live Cloudflare + PostgreSQL referential integrity verification
  v_ref := public.verify_referential_integrity_v1();
  IF coalesce((v_ref->>'is_valid')::boolean, false) <> true
     OR coalesce(v_ref #>> '{live_asset_verification,status}', '') <> 'PASS' THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: verify_referential_integrity_v1 failed: %', v_ref;
  END IF;

  -- 3. Live evidence coverage audit
  v_aud := public.audit_evidence_coverage_v1();
  IF coalesce(v_aud->>'status', '') <> 'ok'
     OR coalesce(v_aud #>> '{live_asset_verification,status}', '') <> 'PASS' THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: audit_evidence_coverage_v1 failed: %', v_aud;
  END IF;

  -- 4. Reader overview + live place_anchors check (Genesis 2:14)
  v_ovw := public.get_reader_overview_v1(1, 2, 14);
  IF coalesce(v_ovw->>'status', '') <> 'ok'
     OR jsonb_array_length(coalesce(v_ovw->'place_anchors', '[]'::jsonb)) < 3 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: get_reader_overview_v1(1,2,14) failed: %', v_ovw;
  END IF;

  -- 5. Hybrid verse research v2 check (Genesis 1:1)
  v_res_v2 := public.get_verse_research_v2('{"passages":[{"book":1,"chapter":1,"verse":1}]}'::jsonb);
  IF coalesce(v_res_v2->>'status', '') <> 'ok'
     OR jsonb_array_length(coalesce(v_res_v2 #> '{verses,0,words}', '[]'::jsonb)) <> 7
     OR jsonb_array_length(coalesce(v_res_v2 #> '{verses,0,words,0,morphology}', '[]'::jsonb)) < 2 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: get_verse_research_v2 failed: %', v_res_v2->>'status';
  END IF;

  -- 6. Hybrid lexical semantics check (H1254)
  v_sem := public.lookup_lexical_semantics_v1('H1254', 'auto');
  IF coalesce(v_sem->>'status', '') <> 'ok'
     OR jsonb_array_length(coalesce(v_sem #> '{lemmas,0,lexemes,0,registered_identifiers}', '[]'::jsonb)) <> 5
     OR jsonb_array_length(coalesce(v_sem #> '{lemmas,0,attested_translation_glosses}', '[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: lookup_lexical_semantics_v1 failed: %', v_sem->>'status';
  END IF;

  -- 7. Hybrid lemma occurrences & English glosses checks (H1254A)
  v_occ := public.lookup_lemma_occurrences_v1('H1254A', 0, 5);
  IF coalesce(v_occ->>'status', '') <> 'ok'
     OR coalesce((v_occ #>> '{totals,total_tokens}')::int, 0) <> 55 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: lookup_lemma_occurrences_v1 failed: %', v_occ;
  END IF;

  v_glo := public.lookup_lemma_english_glosses_v1('H1254A', 5);
  IF coalesce(v_glo->>'status', '') <> 'ok'
     OR jsonb_array_length(coalesce(v_glo->'attested_english_glosses', '[]'::jsonb)) <> 5 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: lookup_lemma_english_glosses_v1 failed: %', v_glo;
  END IF;

  -- 8. Septuagint & Cross-Testament Greek checks
  v_lxx := public.compare_hebrew_septuagint_passage_v1(1, 1, 1);
  IF coalesce(v_lxx->>'status', '') <> 'ok' THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: compare_hebrew_septuagint_passage_v1 failed: %', v_lxx;
  END IF;

  v_xtest := public.lookup_cross_testament_greek_v1('G3056', 5);
  IF coalesce(v_xtest->>'status', '') <> 'ok' THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: lookup_cross_testament_greek_v1 failed: %', v_xtest;
  END IF;

  -- 9. Retained compact summary & dynamic core tables populated
  IF (SELECT count(*) FROM public.lxx_norm_word_summary) < 11000
     OR (SELECT count(*) FROM public.macula_greekstrong_morphemes) < 1000
     OR (SELECT count(*) FROM public.verses) < 31200
     OR (SELECT count(*) FROM public.words) < 150000
     OR (SELECT count(*) FROM public.lemmas) < 22170
     OR (SELECT count(*) FROM public.lexemes) < 22700
     OR (SELECT count(*) FROM public.lexical_senses) < 26170
     OR (SELECT count(*) FROM public.places) < 1340 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: Core or compact summary table row count below threshold';
  END IF;

  -- 10. Ensure FK from word_translation_choices -> verse_translation_sources was dropped
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'word_translation_choices_verse_id_word_position_word_id_fkey'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: FK word_translation_choices_verse_id_word_position_word_id_fkey still exists';
  END IF;

  -- 11. Verify private restricted frame records preserved (200 records)
  SELECT count(*) INTO v_count FROM bible_internal.macula_gated_restricted_frames;
  IF v_count <> 200 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: bible_internal.macula_gated_restricted_frames has % rows (expected 200)', v_count;
  END IF;

  -- 12. Verify exact pre-truncation row counts across ALL 19 reclamation tables
  SELECT count(*) INTO v_count FROM public.lxx_swete_words;
  IF v_count <> 588579 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.lxx_swete_words has % rows (expected 588579)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.macula_hebrew_morphemes;
  IF v_count <> 475911 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.macula_hebrew_morphemes has % rows (expected 475911)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.verse_translation_sources;
  IF v_count <> 443524 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.verse_translation_sources has % rows (expected 443524)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.morphhb_tokens;
  IF v_count <> 306786 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.morphhb_tokens has % rows (expected 306786)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.macula_greek_tokens;
  IF v_count <> 275520 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.macula_greek_tokens has % rows (expected 275520)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.word_form_lemmas;
  IF v_count <> 270447 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.word_form_lemmas has % rows (expected 270447)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.tagnt_tokens;
  IF v_count <> 142096 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.tagnt_tokens has % rows (expected 142096)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.syntax_nodes;
  IF v_count <> 125010 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.syntax_nodes has % rows (expected 125010)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.syntax_edges;
  IF v_count <> 121477 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.syntax_edges has % rows (expected 121477)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.lexeme_identifiers;
  IF v_count <> 113595 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.lexeme_identifiers has % rows (expected 113595)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.reader_rendering_groups;
  IF v_count <> 98133 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.reader_rendering_groups has % rows (expected 98133)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.edition_passages;
  IF v_count <> 62418 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.edition_passages has % rows (expected 62418)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.reader_english_verses;
  IF v_count <> 31215 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.reader_english_verses has % rows (expected 31215)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.hebrew_lxx_verse_map;
  IF v_count <> 22633 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.hebrew_lxx_verse_map has % rows (expected 22633)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.token_morphemes;
  IF v_count <> 2321 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.token_morphemes has % rows (expected 2321)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.macula_gated_field_values;
  IF v_count <> 2294 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.macula_gated_field_values has % rows (expected 2294)', v_count; END IF;

  SELECT count(*) INTO v_count FROM bible_internal.macula_syntax_import_files;
  IF v_count <> 983 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: bible_internal.macula_syntax_import_files has % rows (expected 983)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.cross_token_mappings;
  IF v_count <> 147 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: public.cross_token_mappings has % rows (expected 147)', v_count; END IF;

  SELECT count(*) INTO v_count FROM bible_internal.macula_syntax_unmapped_nodes;
  IF v_count <> 60 THEN RAISE EXCEPTION 'PREFLIGHT BLOCKED: bible_internal.macula_syntax_unmapped_nodes has % rows (expected 60)', v_count; END IF;

  -- 13. Live storage projection check (< 400 MiB required)
  v_db_bytes := pg_database_size(current_database());
  SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0)
  INTO v_reclaim_bytes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND (
      (n.nspname = 'public' AND c.relname IN (
        'macula_hebrew_morphemes', 'macula_greek_tokens', 'word_form_lemmas', 'lxx_swete_words',
        'morphhb_tokens', 'syntax_nodes', 'verse_translation_sources', 'tagnt_tokens',
        'syntax_edges', 'lexeme_identifiers', 'edition_passages', 'reader_rendering_groups',
        'hebrew_lxx_verse_map', 'reader_english_verses', 'token_morphemes', 'macula_gated_field_values',
        'cross_token_mappings'
      ))
      OR (n.nspname = 'bible_internal' AND c.relname IN (
        'macula_syntax_unmapped_nodes', 'macula_syntax_import_files'
      ))
    );

  v_remaining_bytes := v_db_bytes - v_reclaim_bytes;
  v_remaining_mib := round(v_remaining_bytes / (1024.0 * 1024.0), 2);

  IF v_remaining_mib >= 400.00 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: Projected remaining DB size (% MiB) exceeds 400 MiB target', v_remaining_mib;
  END IF;

  RAISE NOTICE 'PREFLIGHT PASSED: Current=% MiB, Reclaimable=% MiB, Projected Remaining=% MiB (< 400 MiB target)',
    round(v_db_bytes / (1024.0 * 1024.0), 2),
    round(v_reclaim_bytes / (1024.0 * 1024.0), 2),
    v_remaining_mib;
END;
$preflight$;

-- ============================================================================
-- PHASE 1: RECLAIM 19 STATIC CORPUS TABLES (~1,035.13 MiB)
-- Preserves all table schemas, constraints, indexes, and RLS policies while
-- releasing 100% of heap and index pages back to disk in < 1 second.
-- NO CASCADE is used; all mutually-referencing tables are explicitly listed.
-- ============================================================================
TRUNCATE TABLE
  public.cross_token_mappings,
  public.token_morphemes,
  public.macula_gated_field_values,
  public.macula_hebrew_morphemes,
  public.macula_greek_tokens,
  public.word_form_lemmas,
  public.lxx_swete_words,
  public.morphhb_tokens,
  public.syntax_edges,
  public.syntax_nodes,
  public.verse_translation_sources,
  public.tagnt_tokens,
  public.lexeme_identifiers,
  public.edition_passages,
  public.reader_rendering_groups,
  public.hebrew_lxx_verse_map,
  public.reader_english_verses,
  bible_internal.macula_syntax_unmapped_nodes,
  bible_internal.macula_syntax_import_files;

-- ============================================================================
-- PHASE 2: IN-TRANSACTION POST-TRUNCATION ASSERTIONS
-- ============================================================================
DO $postcheck$
DECLARE
  v_count bigint;
BEGIN
  -- Verify all 19 target tables are now 0
  SELECT (
    (SELECT count(*) FROM public.cross_token_mappings) +
    (SELECT count(*) FROM public.token_morphemes) +
    (SELECT count(*) FROM public.macula_gated_field_values) +
    (SELECT count(*) FROM public.macula_hebrew_morphemes) +
    (SELECT count(*) FROM public.macula_greek_tokens) +
    (SELECT count(*) FROM public.word_form_lemmas) +
    (SELECT count(*) FROM public.lxx_swete_words) +
    (SELECT count(*) FROM public.morphhb_tokens) +
    (SELECT count(*) FROM public.syntax_edges) +
    (SELECT count(*) FROM public.syntax_nodes) +
    (SELECT count(*) FROM public.verse_translation_sources) +
    (SELECT count(*) FROM public.tagnt_tokens) +
    (SELECT count(*) FROM public.lexeme_identifiers) +
    (SELECT count(*) FROM public.edition_passages) +
    (SELECT count(*) FROM public.reader_rendering_groups) +
    (SELECT count(*) FROM public.hebrew_lxx_verse_map) +
    (SELECT count(*) FROM public.reader_english_verses) +
    (SELECT count(*) FROM bible_internal.macula_syntax_unmapped_nodes) +
    (SELECT count(*) FROM bible_internal.macula_syntax_import_files)
  ) INTO v_count;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'POST-TRUNCATE CHECK FAILED: % rows remain in target tables', v_count;
  END IF;

  -- Verify core dynamic and private tables remained untouched
  IF (SELECT count(*) FROM public.words) <> 150105 THEN
    RAISE EXCEPTION 'POST-TRUNCATE CHECK FAILED: public.words was corrupted';
  END IF;

  IF (SELECT count(*) FROM public.verses) <> 31203 THEN
    RAISE EXCEPTION 'POST-TRUNCATE CHECK FAILED: public.verses was corrupted';
  END IF;

  IF (SELECT count(*) FROM bible_internal.macula_gated_restricted_frames) <> 200 THEN
    RAISE EXCEPTION 'POST-TRUNCATE CHECK FAILED: bible_internal.macula_gated_restricted_frames was corrupted';
  END IF;

  RAISE NOTICE 'POST-TRUNCATE IN-TRANSACTION CHECK PASSED: 19 tables emptied, dynamic & private tables 100%% intact.';
END;
$postcheck$;

COMMIT;

-- ============================================================================
-- PHASE 3: POST-COMMIT VERIFICATION QUERIES (RUN SEPARATELY)
-- ============================================================================
-- 1. Check final database size:
-- SELECT
--   pg_size_pretty(pg_database_size(current_database())) AS total_db_size,
--   pg_database_size(current_database()) AS total_db_bytes,
--   round(pg_database_size(current_database()) / (1024.0 * 1024.0), 2) AS total_db_mib;
--
-- 2. Run post-reclamation test script:
-- node scripts/preflight-storage-reclamation.mjs
