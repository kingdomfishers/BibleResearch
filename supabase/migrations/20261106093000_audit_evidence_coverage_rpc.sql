-- Migration: 20261106093000_audit_evidence_coverage_rpc.sql
-- Description: Deterministic evidence coverage audit function for Bible Research Engine (F1)
-- Returns exact table counts, duplicate metrics, foreign key orphan checks, pilot book coverage,
-- and source vs import incompleteness classifications.

CREATE OR REPLACE FUNCTION public.audit_evidence_coverage_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
SELECT jsonb_build_object(
  'schema_version', '1.0.0',
  'audit_type', 'evidence_coverage_and_integrity',
  'table_counts', jsonb_build_object(
    'books', (SELECT count(*) FROM public.books),
    'verses', (SELECT count(*) FROM public.verses),
    'words', (SELECT count(*) FROM public.words),
    'verse_translation_sources', (SELECT count(*) FROM public.verse_translation_sources),
    'lexemes', (SELECT count(*) FROM public.lexemes),
    'lemmas', (SELECT count(*) FROM public.lemmas),
    'lexeme_identifiers', (SELECT count(*) FROM public.lexeme_identifiers),
    'word_form_lemmas', (SELECT count(*) FROM public.word_form_lemmas),
    'lexical_roots', (SELECT count(*) FROM public.lexical_roots),
    'lemma_root_links', (SELECT count(*) FROM public.lemma_root_links),
    'lexical_senses', (SELECT count(*) FROM public.lexical_senses),
    'token_morphemes', (SELECT count(*) FROM public.token_morphemes),
    'syntax_nodes', (SELECT count(*) FROM public.syntax_nodes),
    'syntax_edges', (SELECT count(*) FROM public.syntax_edges),
    'semantic_annotations', (SELECT count(*) FROM public.semantic_annotations),
    'canonical_entities', (SELECT count(*) FROM public.canonical_entities),
    'entity_relationships', (SELECT count(*) FROM public.entity_relationships),
    'field_license_registry', (SELECT count(*) FROM public.field_license_registry),
    'lxx_swete_books', (SELECT count(*) FROM public.lxx_swete_books),
    'hebrew_lxx_verse_map', (SELECT count(*) FROM public.hebrew_lxx_verse_map),
    'lxx_swete_words', (SELECT count(*) FROM public.lxx_swete_words),
    'macula_hebrew_morphemes', (SELECT count(*) FROM public.macula_hebrew_morphemes),
    'macula_gated_field_values', (SELECT count(*) FROM public.macula_gated_field_values)
  ),
  'duplicates', jsonb_build_object(
    'dup_verses', (SELECT count(*) FROM (SELECT book, chapter, verse_nr FROM public.verses GROUP BY book, chapter, verse_nr HAVING count(*) > 1) d),
    'dup_lxx_words', (SELECT count(*) FROM (SELECT book_no, chapter, verse_nr, COALESCE(verse_suffix,''), ordinal FROM public.lxx_swete_words GROUP BY book_no, chapter, verse_nr, COALESCE(verse_suffix,''), ordinal HAVING count(*) > 1) d),
    'dup_macula_morphemes', (SELECT count(*) FROM (SELECT macula_id FROM public.macula_hebrew_morphemes GROUP BY macula_id HAVING count(*) > 1) d),
    'dup_relationships', (SELECT count(*) FROM (SELECT subject_entity_id, object_entity_id, relation_type FROM public.entity_relationships GROUP BY subject_entity_id, object_entity_id, relation_type HAVING count(*) > 1) d),
    'dup_lemma_roots', (SELECT count(*) FROM (SELECT lemma_id, root_id FROM public.lemma_root_links GROUP BY lemma_id, root_id HAVING count(*) > 1) d),
    'dup_lexical_senses', (SELECT count(*) FROM (SELECT sense_key FROM public.lexical_senses GROUP BY sense_key HAVING count(*) > 1) d)
  ),
  'orphans', jsonb_build_object(
    'orphan_macula_verses', (SELECT count(*) FROM public.macula_hebrew_morphemes m WHERE NOT EXISTS (SELECT 1 FROM public.verses v WHERE v.id = m.canonical_verse_id)),
    'orphan_gated_morphemes', (SELECT count(*) FROM public.macula_gated_field_values g WHERE NOT EXISTS (SELECT 1 FROM public.macula_hebrew_morphemes m WHERE m.id = g.morpheme_id)),
    'orphan_map_verses', (SELECT count(*) FROM public.hebrew_lxx_verse_map m WHERE NOT EXISTS (SELECT 1 FROM public.verses v WHERE v.id = m.canonical_verse_id)),
    'orphan_map_books', (SELECT count(*) FROM public.hebrew_lxx_verse_map m WHERE NOT EXISTS (SELECT 1 FROM public.lxx_swete_books b WHERE b.book_no = m.lxx_book_no)),
    'orphan_lxx_books', (SELECT count(*) FROM public.lxx_swete_words w WHERE NOT EXISTS (SELECT 1 FROM public.lxx_swete_books b WHERE b.book_no = w.book_no)),
    'orphan_rel_subject', (SELECT count(*) FROM public.entity_relationships r WHERE NOT EXISTS (SELECT 1 FROM public.canonical_entities e WHERE e.id = r.subject_entity_id)),
    'orphan_rel_object', (SELECT count(*) FROM public.entity_relationships r WHERE NOT EXISTS (SELECT 1 FROM public.canonical_entities e WHERE e.id = r.object_entity_id)),
    'orphan_wfl_words', (SELECT count(*) FROM public.word_form_lemmas wfl WHERE NOT EXISTS (SELECT 1 FROM public.words w WHERE w.id = wfl.word_id)),
    'orphan_wfl_lemmas', (SELECT count(*) FROM public.word_form_lemmas wfl WHERE NOT EXISTS (SELECT 1 FROM public.lemmas l WHERE l.id = wfl.lemma_id)),
    'orphan_lrl_lemmas', (SELECT count(*) FROM public.lemma_root_links lrl WHERE NOT EXISTS (SELECT 1 FROM public.lemmas l WHERE l.id = lrl.lemma_id)),
    'orphan_lrl_roots', (SELECT count(*) FROM public.lemma_root_links lrl WHERE NOT EXISTS (SELECT 1 FROM public.lexical_roots r WHERE r.id = lrl.root_id)),
    'orphan_senses_lemmas', (SELECT count(*) FROM public.lexical_senses ls WHERE NOT EXISTS (SELECT 1 FROM public.lemmas l WHERE l.id = ls.lemma_id))
  ),
  'pilot_coverage', jsonb_build_object(
    'macula_hebrew', jsonb_build_object(
      'imported_verses', (SELECT count(DISTINCT canonical_verse_id) FROM public.macula_hebrew_morphemes),
      'imported_morphemes', (SELECT count(*) FROM public.macula_hebrew_morphemes),
      'books_present', (SELECT jsonb_agg(DISTINCT book ORDER BY book) FROM public.macula_hebrew_morphemes),
      'missing_ot_books_count', (SELECT 39 - count(DISTINCT book) FROM public.macula_hebrew_morphemes),
      'verse_coverage_pct', ROUND(100.0 * (SELECT count(DISTINCT canonical_verse_id) FROM public.macula_hebrew_morphemes) / 23213.0, 4),
      'classification', 'import_incompleteness'
    ),
    'lxx_swete', jsonb_build_object(
      'registered_books', (SELECT count(*) FROM public.lxx_swete_books),
      'books_with_text', (SELECT count(DISTINCT book_no) FROM public.lxx_swete_words),
      'imported_verses', (SELECT count(DISTINCT book_no || ':' || chapter || ':' || verse_nr || COALESCE(verse_suffix, '')) FROM public.lxx_swete_words),
      'imported_words', (SELECT count(*) FROM public.lxx_swete_words),
      'missing_lxx_text_books_count', (SELECT 55 - count(DISTINCT book_no) FROM public.lxx_swete_words),
      'word_coverage_pct', ROUND(100.0 * (SELECT count(*) FROM public.lxx_swete_words) / 554086.0, 4),
      'classification', 'import_incompleteness'
    ),
    'stepbible', jsonb_build_object(
      'canonical_books', (SELECT count(*) FROM public.books),
      'canonical_verses', (SELECT count(*) FROM public.verses),
      'distinct_words', (SELECT count(*) FROM public.words),
      'total_tokens', (SELECT count(*) FROM public.verse_translation_sources),
      'verse_coverage_pct', 100.0,
      'classification', 'complete_import'
    )
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.audit_evidence_coverage_v1() TO anon, authenticated;
COMMENT ON FUNCTION public.audit_evidence_coverage_v1() IS 'Deterministic evidence coverage and data integrity audit returning table counts, duplicates, orphans, and pilot incompleteness metrics.';
