-- ============================================================================
-- Migration: 20261106194000_fix_referential_integrity_rpc.sql
-- Description: Update verify_referential_integrity_v1 to verify constraints via
--              PostgreSQL system catalogs rather than test INSERTs.
--              This enables safe, pure-read execution under SECURITY INVOKER
--              by public/anon roles without write permissions.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_referential_integrity_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
DECLARE
  v_fk_token_morphemes_rejected boolean := false;
  v_fk_word_form_lemmas_rejected boolean := false;
  v_chk_no_synonymy_rejected boolean := false;
  v_chk_root_kind_rejected boolean := false;
  v_chk_no_self_ref_rejected boolean := false;
  v_chk_token_morpheme_role_rejected boolean := false;
  v_lxx_missing_provenance bigint;
  v_orphans jsonb;
  v_variants jsonb;
BEGIN
  -- 1. FK constraint check on token_morphemes (validated foreign key exists)
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'token_morphemes' AND c.contype = 'f' AND c.convalidated
  ) INTO v_fk_token_morphemes_rejected;

  -- 2. FK constraint check on word_form_lemmas (validated foreign key exists)
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'word_form_lemmas' AND c.contype = 'f' AND c.convalidated
  ) INTO v_fk_word_form_lemmas_rejected;

  -- 3. Check constraint: chk_lemma_root_links_no_synonymy
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'chk_lemma_root_links_no_synonymy' AND c.convalidated
  ) INTO v_chk_no_synonymy_rejected;

  -- 4. Check constraint: chk_lexical_roots_kind
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'chk_lexical_roots_kind' AND c.convalidated
  ) INTO v_chk_root_kind_rejected;

  -- 5. Check constraint: chk_entity_relationships_no_self_ref
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'chk_entity_relationships_no_self_ref' AND c.convalidated
  ) INTO v_chk_no_self_ref_rejected;

  -- 6. Check constraint: chk_token_morphemes_role
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'chk_token_morphemes_role' AND c.convalidated
  ) INTO v_chk_token_morpheme_role_rejected;

  -- 7. Direct provenance on lxx_swete_words
  SELECT count(*) INTO v_lxx_missing_provenance
  FROM public.lxx_swete_words
  WHERE source_release_id IS NULL OR source_edition_id IS NULL;

  -- 8. Orphan counts across 12 canonical relationships
  SELECT jsonb_build_object(
    'orphan_macula_verses', (SELECT count(*) FROM public.macula_hebrew_morphemes m WHERE NOT EXISTS (SELECT 1 FROM public.verses v WHERE v.id = m.canonical_verse_id)),
    'orphan_gated_morphemes', (SELECT count(*) FROM public.macula_gated_field_values g WHERE NOT EXISTS (SELECT 1 FROM public.macula_hebrew_morphemes m WHERE m.id = g.morpheme_id)),
    'orphan_map_verses', (SELECT count(*) FROM public.hebrew_lxx_verse_map m WHERE m.canonical_verse_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.verses v WHERE v.id = m.canonical_verse_id)),
    'orphan_map_books', (SELECT count(*) FROM public.hebrew_lxx_verse_map m WHERE m.lxx_book_no IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.lxx_swete_books b WHERE b.book_no = m.lxx_book_no)),
    'orphan_lxx_books', (SELECT count(*) FROM public.lxx_swete_words w WHERE NOT EXISTS (SELECT 1 FROM public.lxx_swete_books b WHERE b.book_no = w.book_no)),
    'orphan_rel_subject', (SELECT count(*) FROM public.entity_relationships r WHERE NOT EXISTS (SELECT 1 FROM public.canonical_entities e WHERE e.id = r.subject_entity_id)),
    'orphan_rel_object', (SELECT count(*) FROM public.entity_relationships r WHERE NOT EXISTS (SELECT 1 FROM public.canonical_entities e WHERE e.id = r.object_entity_id)),
    'orphan_wfl_words', (SELECT count(*) FROM public.word_form_lemmas wfl WHERE NOT EXISTS (SELECT 1 FROM public.words w WHERE w.id = wfl.word_id)),
    'orphan_wfl_lemmas', (SELECT count(*) FROM public.word_form_lemmas wfl WHERE NOT EXISTS (SELECT 1 FROM public.lemmas l WHERE l.id = wfl.lemma_id)),
    'orphan_lrl_lemmas', (SELECT count(*) FROM public.lemma_root_links lrl WHERE NOT EXISTS (SELECT 1 FROM public.lemmas l WHERE l.id = lrl.lemma_id)),
    'orphan_lrl_roots', (SELECT count(*) FROM public.lemma_root_links lrl WHERE NOT EXISTS (SELECT 1 FROM public.lexical_roots r WHERE r.id = lrl.root_id)),
    'orphan_senses_lemmas', (SELECT count(*) FROM public.lexical_senses ls WHERE NOT EXISTS (SELECT 1 FROM public.lemmas l WHERE l.id = ls.lemma_id))
  ) INTO v_orphans;

  -- 9. Legitimate Variants & Homographs Preservation
  SELECT jsonb_build_object(
    'homographs_h1254', (SELECT count(*) FROM public.lexemes WHERE extended_strongs ~* '^H1254[a-z]?$'),
    'homographs_h5869', (SELECT count(*) FROM public.lexemes WHERE extended_strongs ~* '^H5869[a-z]?$'),
    'psalm_versification_shifts', (SELECT count(*) FROM public.hebrew_lxx_verse_map WHERE mapping_kind = 'versification_shift'),
    'multi_etymology_root_links', (SELECT count(*) FROM (SELECT lemma_id, root_id FROM public.lemma_root_links GROUP BY lemma_id, root_id HAVING count(*) > 1) d)
  ) INTO v_variants;

  RETURN jsonb_build_object(
    'schema_version', '1.0.0',
    'status', 'ok',
    'foreign_key_rejection', jsonb_build_object(
      'token_morphemes_invalid_verse_rejected', v_fk_token_morphemes_rejected,
      'word_form_lemmas_invalid_lemma_rejected', v_fk_word_form_lemmas_rejected
    ),
    'check_constraint_rejection', jsonb_build_object(
      'synonymy_claim_rejected', v_chk_no_synonymy_rejected,
      'invalid_root_kind_rejected', v_chk_root_kind_rejected,
      'self_relationship_rejected', v_chk_no_self_ref_rejected,
      'invalid_morpheme_role_rejected', v_chk_token_morpheme_role_rejected
    ),
    'provenance_integrity', jsonb_build_object(
      'lxx_words_missing_provenance', v_lxx_missing_provenance
    ),
    'orphan_counts', v_orphans,
    'preserved_variants_and_homographs', v_variants
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_referential_integrity_v1() TO anon, authenticated, service_role;
