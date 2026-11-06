-- ============================================================================
-- Migration: 20261106192000_fix_greek_occurrence_statistics.sql
-- Description: Correct occurrence statistics calculation in lookup_cross_testament_greek_v1.
--              Corpus totals are computed independently of sample pagination limits.
--              Explicitly reports total_matching_occurrences, returned_count, limit,
--              and is_exhaustive_lemma_count=false for unlemmatized Swete LXX text.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lookup_cross_testament_greek_v1(
  p_greek_query text,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_query text := btrim(coalesce(p_greek_query, ''));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_strong_norm text;
  v_clean_strong text;
  v_grk_entity record;
  v_base_strongs text;
  v_nt_total integer := 0;
  v_nt_verses integer := 0;
  v_nt_samples jsonb := '[]'::jsonb;
  v_lxx_total integer := 0;
  v_lxx_verses integer := 0;
  v_lxx_samples jsonb := '[]'::jsonb;
  v_hebrew_renderings jsonb := '[]'::jsonb;
BEGIN
  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_greek_query must not be empty'
    );
  END IF;

  -- Normalize Strong's if query looks like a Strong number (e.g. G4151, 4151, g4151)
  IF v_query ~* '^[Gg]?[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := 'G' || regexp_replace(v_query, '[^0-9]', '', 'g');
    v_strong_norm := 'lemma:G' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
  ELSIF v_query ~* '^lemma:G[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := regexp_replace(v_query, '^lemma:', '');
    v_strong_norm := v_query;
  END IF;

  -- Locate Greek canonical lemma
  SELECT ce.id, ce.entity_key, ce.display_label, ce.language, l.lemma_script, l.transliteration, l.base_strongs
  INTO v_grk_entity
  FROM public.canonical_entities ce
  LEFT JOIN public.lemmas l ON l.id = ce.lemma_id
  WHERE ce.entity_kind = 'lemma'
    AND ce.language = 'grc'
    AND (
      ce.entity_key = v_query
      OR (v_strong_norm IS NOT NULL AND (ce.entity_key = v_strong_norm OR ce.entity_key LIKE v_strong_norm || '%'))
      OR l.lemma_script = v_query
      OR public.strip_greek_diacritics(l.lemma_script) = public.strip_greek_diacritics(v_query)
      OR l.transliteration ILIKE v_query
      OR ce.display_label ILIKE '%' || v_query || '%'
    )
  ORDER BY
    CASE WHEN ce.entity_key = v_strong_norm THEN 0
         WHEN ce.entity_key LIKE v_strong_norm || '%' THEN 1
         WHEN l.lemma_script = v_query THEN 2
         WHEN public.strip_greek_diacritics(l.lemma_script) = public.strip_greek_diacritics(v_query) THEN 3
         ELSE 4 END
  LIMIT 1;

  IF v_grk_entity.id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'query', p_greek_query,
      'message', 'Greek lemma not found'
    );
  END IF;

  v_base_strongs := coalesce(v_grk_entity.base_strongs, v_clean_strong);

  -- 1. NT Greek occurrences in public.words (book >= 40)
  -- Step 1a: Compute full corpus occurrences
  WITH matched_words AS (
    SELECT w.id AS word_id, w.original_word, w.transliteration, (w.english_translations)[1] AS gloss
    FROM public.words w
    WHERE (v_base_strongs IS NOT NULL AND w.strongs_nr = v_base_strongs)
       OR (v_clean_strong IS NOT NULL AND w.strongs_nr = v_clean_strong)
       OR (v_grk_entity.lemma_script IS NOT NULL AND w.original_word = v_grk_entity.lemma_script)
  ),
  nt_occurrences_all AS (
    SELECT
      v.id AS verse_id,
      v.book,
      v.chapter,
      v.verse_nr,
      mw.word_id,
      mw.original_word,
      mw.transliteration,
      mw.gloss
    FROM public.verses v
    CROSS JOIN LATERAL unnest(v.word_ids) AS wid
    JOIN matched_words mw ON mw.word_id = wid
    WHERE v.book >= 40
  )
  SELECT
    count(*),
    count(DISTINCT verse_id)
  INTO v_nt_total, v_nt_verses
  FROM nt_occurrences_all;

  -- Step 1b: Fetch paginated sample rows
  WITH matched_words AS (
    SELECT w.id AS word_id, w.original_word, w.transliteration, (w.english_translations)[1] AS gloss
    FROM public.words w
    WHERE (v_base_strongs IS NOT NULL AND w.strongs_nr = v_base_strongs)
       OR (v_clean_strong IS NOT NULL AND w.strongs_nr = v_clean_strong)
       OR (v_grk_entity.lemma_script IS NOT NULL AND w.original_word = v_grk_entity.lemma_script)
  ),
  nt_occurrences_sample AS (
    SELECT
      v.id AS verse_id,
      v.book,
      v.chapter,
      v.verse_nr,
      mw.word_id,
      mw.original_word,
      mw.transliteration,
      mw.gloss
    FROM public.verses v
    CROSS JOIN LATERAL unnest(v.word_ids) AS wid
    JOIN matched_words mw ON mw.word_id = wid
    WHERE v.book >= 40
    ORDER BY v.book, v.chapter, v.verse_nr, mw.word_id
    LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'word_id', word_id,
      'book', book,
      'chapter', chapter,
      'verse_nr', verse_nr,
      'ref', book || ' ' || chapter || ':' || verse_nr,
      'original_word', original_word,
      'transliteration', transliteration,
      'gloss', gloss
    )
  ), '[]'::jsonb)
  INTO v_nt_samples
  FROM nt_occurrences_sample;

  -- 2. LXX Swete occurrences in public.lxx_swete_words (matching normalized surface forms)
  -- Step 2a: Target normalized forms
  WITH target_norm_forms AS (
    SELECT DISTINCT public.strip_greek_diacritics(w.original_word) AS norm_word
    FROM public.words w
    WHERE (v_base_strongs IS NOT NULL AND w.strongs_nr = v_base_strongs)
       OR (v_clean_strong IS NOT NULL AND w.strongs_nr = v_clean_strong)
    UNION
    SELECT public.strip_greek_diacritics(v_grk_entity.lemma_script)
    WHERE v_grk_entity.lemma_script IS NOT NULL
    UNION
    SELECT DISTINCT public.strip_greek_diacritics(g_word.field_value)
    FROM public.macula_gated_field_values g_strong
    JOIN public.macula_gated_field_values g_word ON g_word.morpheme_id = g_strong.morpheme_id AND g_word.field_name = 'greek'
    WHERE g_strong.field_name = 'greekstrong'
      AND (
        (v_base_strongs IS NOT NULL AND g_strong.field_value = regexp_replace(v_base_strongs, '[^0-9]', '', 'g'))
        OR (v_clean_strong IS NOT NULL AND g_strong.field_value = regexp_replace(v_clean_strong, '[^0-9]', '', 'g'))
      )
  ),
  lxx_matches_all AS (
    SELECT
      sw.id AS word_id,
      sw.book_no,
      b.latin_name AS book_name,
      sw.chapter,
      sw.verse_nr,
      sw.word_text,
      sw.source_record_id
    FROM public.lxx_swete_words sw
    JOIN public.lxx_swete_books b ON b.book_no = sw.book_no
    WHERE sw.normalized_word IN (SELECT norm_word FROM target_norm_forms WHERE norm_word IS NOT NULL AND norm_word <> '')
  )
  SELECT
    count(*),
    count(DISTINCT (book_no, chapter, verse_nr))
  INTO v_lxx_total, v_lxx_verses
  FROM lxx_matches_all;

  -- Step 2b: Paginated LXX sample rows
  WITH target_norm_forms AS (
    SELECT DISTINCT public.strip_greek_diacritics(w.original_word) AS norm_word
    FROM public.words w
    WHERE (v_base_strongs IS NOT NULL AND w.strongs_nr = v_base_strongs)
       OR (v_clean_strong IS NOT NULL AND w.strongs_nr = v_clean_strong)
    UNION
    SELECT public.strip_greek_diacritics(v_grk_entity.lemma_script)
    WHERE v_grk_entity.lemma_script IS NOT NULL
    UNION
    SELECT DISTINCT public.strip_greek_diacritics(g_word.field_value)
    FROM public.macula_gated_field_values g_strong
    JOIN public.macula_gated_field_values g_word ON g_word.morpheme_id = g_strong.morpheme_id AND g_word.field_name = 'greek'
    WHERE g_strong.field_name = 'greekstrong'
      AND (
        (v_base_strongs IS NOT NULL AND g_strong.field_value = regexp_replace(v_base_strongs, '[^0-9]', '', 'g'))
        OR (v_clean_strong IS NOT NULL AND g_strong.field_value = regexp_replace(v_clean_strong, '[^0-9]', '', 'g'))
      )
  ),
  lxx_matches_sample AS (
    SELECT
      sw.id AS word_id,
      sw.book_no,
      b.latin_name AS book_name,
      sw.chapter,
      sw.verse_nr,
      sw.word_text,
      sw.source_record_id
    FROM public.lxx_swete_words sw
    JOIN public.lxx_swete_books b ON b.book_no = sw.book_no
    WHERE sw.normalized_word IN (SELECT norm_word FROM target_norm_forms WHERE norm_word IS NOT NULL AND norm_word <> '')
    ORDER BY sw.book_no, sw.chapter, sw.verse_nr, sw.id
    LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'word_id', word_id,
      'book_no', book_no,
      'book_name', book_name,
      'chapter', chapter,
      'verse_nr', verse_nr,
      'ref_swete', book_name || ' ' || chapter || ':' || verse_nr,
      'word_text', word_text,
      'source_record_id', source_record_id
    )
  ), '[]'::jsonb)
  INTO v_lxx_samples
  FROM lxx_matches_sample;

  -- 3. Hebrew lemmas rendered by this Greek lemma in MT
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'hebrew_lemma_key', ce_heb.entity_key,
      'hebrew_display_label', ce_heb.display_label,
      'hebrew_script', l_heb.lemma_script,
      'hebrew_strong', l_heb.base_strongs,
      'occurrence_count', sub.cnt
    )
  ), '[]'::jsonb)
  INTO v_hebrew_renderings
  FROM (
    SELECT
      er.subject_entity_id,
      count(DISTINCT m.id) AS cnt
    FROM public.entity_relationships er
    JOIN public.macula_gated_field_values g ON g.field_name = 'greekstrong'
      AND ('lemma:G' || lpad(g.field_value, 4, '0') = v_grk_entity.entity_key
           OR v_grk_entity.entity_key LIKE 'lemma:G' || lpad(g.field_value, 4, '0') || '%')
    JOIN public.macula_hebrew_morphemes m ON m.id = g.morpheme_id
    WHERE er.object_entity_id = v_grk_entity.id
      AND er.relation_type IN ('explicit_source_word_alignment', 'source_provided_lexical_equivalent')
    GROUP BY er.subject_entity_id
    ORDER BY cnt DESC
    LIMIT v_limit
  ) sub
  JOIN public.canonical_entities ce_heb ON ce_heb.id = sub.subject_entity_id
  LEFT JOIN public.lemmas l_heb ON l_heb.id = ce_heb.lemma_id;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query', p_greek_query,
    'greek_lemma', jsonb_build_object(
      'entity_key', v_grk_entity.entity_key,
      'display_label', v_grk_entity.display_label,
      'language', v_grk_entity.language,
      'lemma_script', v_grk_entity.lemma_script,
      'transliteration', v_grk_entity.transliteration,
      'base_strongs', v_grk_entity.base_strongs
    ),
    'nt_occurrences', jsonb_build_object(
      'total_count', v_nt_total,
      'total_matching_occurrences', v_nt_total,
      'total_verses', v_nt_verses,
      'returned_count', jsonb_array_length(v_nt_samples),
      'limit', v_limit,
      'samples', v_nt_samples
    ),
    'lxx_occurrences', jsonb_build_object(
      'total_count', v_lxx_total,
      'total_matching_occurrences', v_lxx_total,
      'total_verses', v_lxx_verses,
      'returned_count', jsonb_array_length(v_lxx_samples),
      'limit', v_limit,
      'is_exhaustive_lemma_count', false,
      'count_scope_notes', 'Swete LXX is an unlemmatized diplomatic text. Matching uses normalized surface inflections attested in New Testament lexical evidence; count reflects matching surface tokens, not an exhaustive morphological parse.',
      'samples', v_lxx_samples
    ),
    'hebrew_source_renderings', v_hebrew_renderings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_cross_testament_greek_v1(text, integer) TO anon, authenticated, service_role;
