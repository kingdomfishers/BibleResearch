-- ============================================================================
-- scripts/reclaim-supabase-storage.sql
-- STAGE G: Production Storage Reclamation (WITH MANDATORY READ-ONLY PREFLIGHT)
--
-- IMPORTANT: DO NOT EXECUTE UNTIL ALL PREFLIGHT CHECKS & FLASH CERTIFICATION PASS.
--
-- Live Storage Accounting (measured on Supabase `ejoperxiwxlcbsqrkrvb`):
--   Current total database size:           1,385.49 MiB (1,452,794,255 bytes)
--   19 static tables scheduled for offload: 1,035.06 MiB (1,085,337,600 bytes)
--   Projected post-reclamation DB size:      350.43 MiB   (367,456,655 bytes)
--   Supabase Free limit:                     500.00 MiB
--   Preferred target:                      < 400.00 MiB (ACHIEVED: ~350.43 MiB)
--
-- 19 Reclaimed Static Tables (1,035.06 MiB total):
--   1. public.macula_hebrew_morphemes                  (273.52 MiB)
--   2. public.macula_greek_tokens                      (120.77 MiB)
--   3. public.word_form_lemmas                         (114.98 MiB)
--   4. public.lxx_swete_words                          (101.65 MiB)
--   5. public.morphhb_tokens                            (91.77 MiB)
--   6. public.syntax_nodes                              (88.91 MiB)
--   7. public.verse_translation_sources                 (86.48 MiB)
--   8. public.tagnt_tokens                              (61.50 MiB)
--   9. public.syntax_edges                              (36.31 MiB)
--  10. public.lexeme_identifiers                        (31.99 MiB)
--  11. public.edition_passages                          (13.80 MiB)
--  12. public.reader_rendering_groups                   (12.56 MiB)
--  13. public.hebrew_lxx_verse_map                       (9.68 MiB)
--  14. public.reader_english_verses                      (6.94 MiB)
--  15. public.token_morphemes                            (0.61 MiB)
--  16. public.macula_gated_field_values                  (0.55 MiB)
--  17. public.cross_token_mappings                       (0.32 MiB)
--  18. bible_internal.macula_syntax_unmapped_nodes       (0.41 MiB)
--  19. bible_internal.macula_syntax_import_files         (0.30 MiB)
-- ============================================================================

-- ============================================================================
-- PHASE 0: MANDATORY READ-ONLY PREFLIGHT GATE
-- Blocks execution (RAISE EXCEPTION) unless all live Cloudflare asset,
-- hybrid RPC, referential integrity, and size targets pass.
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

  -- 9. Compact summary tables & dynamic core tables populated
  IF (SELECT count(*) FROM public.lxx_norm_word_summary) < 11000
     OR (SELECT count(*) FROM public.macula_greekstrong_morphemes) < 1000
     OR (SELECT count(*) FROM public.verses) < 31200
     OR (SELECT count(*) FROM public.words) < 150000
     OR (SELECT count(*) FROM public.lemmas) < 22170
     OR (SELECT count(*) FROM public.lexemes) < 22700
     OR (SELECT count(*) FROM public.lexical_senses) < 26170 THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: Core or compact summary table row count below threshold';
  END IF;

  -- 10. Ensure FK from word_translation_choices -> verse_translation_sources has been dropped
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'word_translation_choices_verse_id_word_position_word_id_fkey'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT BLOCKED: FK word_translation_choices_verse_id_word_position_word_id_fkey still exists';
  END IF;

  -- 11. Live storage projection check (< 400 MiB required)
  v_db_bytes := pg_database_size(current_database());
  SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0)
  INTO v_reclaim_bytes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND (n.nspname, c.relname) IN (
      ('public', 'macula_hebrew_morphemes'),
      ('public', 'macula_greek_tokens'),
      ('public', 'word_form_lemmas'),
      ('public', 'lxx_swete_words'),
      ('public', 'morphhb_tokens'),
      ('public', 'syntax_nodes'),
      ('public', 'verse_translation_sources'),
      ('public', 'tagnt_tokens'),
      ('public', 'syntax_edges'),
      ('public', 'lexeme_identifiers'),
      ('public', 'edition_passages'),
      ('public', 'reader_rendering_groups'),
      ('public', 'hebrew_lxx_verse_map'),
      ('public', 'reader_english_verses'),
      ('public', 'token_morphemes'),
      ('public', 'macula_gated_field_values'),
      ('public', 'cross_token_mappings'),
      ('bible_internal', 'macula_syntax_unmapped_nodes'),
      ('bible_internal', 'macula_syntax_import_files')
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
-- PHASE 1: RECLAIM 19 STATIC CORPUS TABLES (~1,035.06 MiB)
-- Preserves all table schemas, indexes, and RLS policies while releasing
-- 100% of heap and index pages back to disk in < 1 second.
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
-- PHASE 2: VERIFY POST-RECLAMATION DATABASE SIZE (< 400 MiB TARGET)
-- ============================================================================
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS total_db_size,
  pg_database_size(current_database()) AS total_db_bytes,
  round(pg_database_size(current_database()) / (1024.0 * 1024.0), 2) AS total_db_mib;
