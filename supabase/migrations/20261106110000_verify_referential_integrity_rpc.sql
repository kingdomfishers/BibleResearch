-- Migration: 20261106110000_verify_referential_integrity_rpc.sql
-- Description: Deterministic referential integrity and constraint verification function (F2)
-- Verifies:
--   1. Rejection of invalid foreign keys (token_morphemes, word_form_lemmas)
--   2. Rejection of invalid domain check constraints (no synonymy, root kind, self-ref, morpheme role)
--   3. Direct provenance completeness on lxx_swete_words
--   4. Zero orphans across all 12 foreign-key relationships
--   5. Preservation of legitimate 1-to-many variants, homographs, and versification shifts

CREATE OR REPLACE FUNCTION public.verify_referential_integrity_v1()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
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
  -- 1. FK constraint check on token_morphemes (non-existent verse_id)
  BEGIN
    INSERT INTO public.token_morphemes (
      edition_id, verse_id, word_position, component_order,
      morpheme_role, dstrongs_tag, source_release_id, source_record_id
    ) VALUES (
      1, -999999, 1, 1, 'stem', 'H9999', 1, 'test_fk_inv'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_fk_token_morphemes_rejected := true;
  END;

  -- 2. FK constraint check on word_form_lemmas (non-existent lemma_id)
  BEGIN
    INSERT INTO public.word_form_lemmas (
      word_id, component_order, morpheme_role, dstrongs_tag,
      lemma_id, observed_token_count, is_context_ambiguous,
      source_release_id, source_record_id, origin_mode, derivation_method
    ) VALUES (
      1, 1, 'stem', 'H9999', -999999, 1, false, 1, 'test_wfl_fk', 'directly_imported', 'test'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_fk_word_form_lemmas_rejected := true;
  END;

  -- 3. Check constraint: chk_lemma_root_links_no_synonymy (implies_synonymy cannot be true)
  BEGIN
    INSERT INTO public.lemma_root_links (
      lemma_id, root_id, etymology_type, implies_synonymy,
      source_release_id, source_record_id, origin_mode, derivation_method
    ) VALUES (
      1, 1, 'derived_from', true, 1, 'test_syn_inv', 'directly_imported', 'test'
    );
  EXCEPTION WHEN check_violation THEN
    v_chk_no_synonymy_rejected := true;
  END;

  -- 4. Check constraint: chk_lexical_roots_kind
  BEGIN
    INSERT INTO public.lexical_roots (
      root_key, language, root_script, root_stripped, root_kind,
      source_release_id, source_record_id
    ) VALUES (
      'root:test:ai', 'hbo', 'בקר', 'בקר', 'speculative_ai_generation', 1, 'test_root_inv'
    );
  EXCEPTION WHEN check_violation THEN
    v_chk_root_kind_rejected := true;
  END;

  -- 5. Check constraint: chk_entity_relationships_no_self_ref
  BEGIN
    INSERT INTO public.entity_relationships (
      relationship_key, subject_entity_id, object_entity_id, relation_type,
      evidence_summary, supporting_span_ref, epistemic_layer,
      source_release_id, source_record_id, origin_mode, derivation_method
    ) VALUES (
      'rel:test:self', 1, 1, 'mentions',
      'Test self relationship', 'Gen.1.1', 'primary_biblical',
      1, 'test_self_ref', 'directly_imported', 'test'
    );
  EXCEPTION WHEN check_violation THEN
    v_chk_no_self_ref_rejected := true;
  END;

  -- 6. Check constraint: chk_token_morphemes_role
  BEGIN
    INSERT INTO public.token_morphemes (
      edition_id, verse_id, word_position, component_order,
      morpheme_role, dstrongs_tag, source_release_id, source_record_id
    ) VALUES (
      1, 1, 1, 1, 'unauthorized_role_type', 'H0001', 1, 'test_role_inv'
    );
  EXCEPTION WHEN check_violation THEN
    v_chk_token_morpheme_role_rejected := true;
  END;

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

GRANT EXECUTE ON FUNCTION public.verify_referential_integrity_v1() TO anon, authenticated;
COMMENT ON FUNCTION public.verify_referential_integrity_v1() IS 'Deterministic referential integrity verification function asserting FK and domain constraint rejection, direct provenance, and orphan counts.';
