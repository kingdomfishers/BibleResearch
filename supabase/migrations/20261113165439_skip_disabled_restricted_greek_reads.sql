-- Preserve SECURITY INVOKER, API output, grants and restricted-table ACL/RLS.
-- A disabled source must not trigger permission checks for its restricted relation.
CREATE OR REPLACE FUNCTION public.lookup_cross_testament_greek_v1(p_greek_query text, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  v_gated_norm_forms text[] := ARRAY[]::text[];
BEGIN
  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_greek_query must not be empty'
    );
  END IF;

  IF v_query ~* '^[Gg]?[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := 'G' || regexp_replace(v_query, '[^0-9]', '', 'g');
    v_strong_norm := 'lemma:G' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
  ELSIF v_query ~* '^lemma:G[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := regexp_replace(v_query, '^lemma:', '');
    v_strong_norm := v_query;
  END IF;

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

  -- Do not plan restricted-table reads while the source field is disabled.
  IF public.field_is_enabled('macula-hebrew','greekstrong') IS TRUE THEN
    SELECT coalesce(array_agg(norm_word), ARRAY[]::text[]) INTO v_gated_norm_forms
    FROM (
SELECT DISTINCT public.strip_greek_diacritics(gm.greek_surface)
    FROM public.macula_greekstrong_morphemes gm
    WHERE public.field_is_enabled('macula-hebrew','greekstrong') IS TRUE AND gm.greek_surface IS NOT NULL
      AND (
        (v_base_strongs IS NOT NULL AND gm.greekstrong = regexp_replace(v_base_strongs, '[^0-9]', '', 'g'))
        OR (v_clean_strong IS NOT NULL AND gm.greekstrong = regexp_replace(v_clean_strong, '[^0-9]', '', 'g'))
      )
    ) gated(norm_word);
  END IF;

  -- 2. LXX Swete occurrences via compact precomputed public.lxx_norm_word_summary & public.macula_greekstrong_morphemes
  WITH target_norm_forms AS (
    SELECT DISTINCT public.strip_greek_diacritics(w.original_word) AS norm_word
    FROM public.words w
    WHERE (v_base_strongs IS NOT NULL AND w.strongs_nr = v_base_strongs)
       OR (v_clean_strong IS NOT NULL AND w.strongs_nr = v_clean_strong)
    UNION
    SELECT public.strip_greek_diacritics(v_grk_entity.lemma_script)
    WHERE v_grk_entity.lemma_script IS NOT NULL
    UNION
    SELECT unnest(v_gated_norm_forms)
  ),
  matched_summaries AS (
    SELECT s.occ_count, s.verse_keys, s.sample_rows
    FROM public.lxx_norm_word_summary s
    WHERE s.normalized_word IN (SELECT norm_word FROM target_norm_forms WHERE norm_word IS NOT NULL AND norm_word <> '')
  )
  SELECT
    coalesce((SELECT sum(occ_count)::integer FROM matched_summaries), 0),
    coalesce((SELECT count(DISTINCT vk)::integer FROM matched_summaries CROSS JOIN LATERAL unnest(verse_keys) AS vk), 0),
    coalesce((
      SELECT jsonb_agg(elem)
      FROM (
        SELECT elem
        FROM matched_summaries
        CROSS JOIN LATERAL jsonb_array_elements(sample_rows) AS elem
        ORDER BY
          (elem->>'book_no')::integer,
          (elem->>'chapter')::integer,
          (elem->>'verse_nr')::integer,
          (elem->>'word_id')::bigint
        LIMIT v_limit
      ) sub
    ), '[]'::jsonb)
  INTO v_lxx_total, v_lxx_verses, v_lxx_samples;

  -- 3. Hebrew lemmas rendered by this Greek lemma in MT via compact public.macula_greekstrong_morphemes
  IF public.field_is_enabled('macula-hebrew','greekstrong') IS TRUE THEN
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
      count(DISTINCT gm.morpheme_id) AS cnt
    FROM public.entity_relationships er
    JOIN public.macula_greekstrong_morphemes gm
      ON public.field_is_enabled('macula-hebrew','greekstrong') IS TRUE AND ('lemma:G' || lpad(gm.greekstrong, 4, '0') = v_grk_entity.entity_key
           OR v_grk_entity.entity_key LIKE 'lemma:G' || lpad(gm.greekstrong, 4, '0') || '%')
    WHERE er.object_entity_id = v_grk_entity.id
      AND er.relation_type IN ('explicit_source_word_alignment', 'source_provided_lexical_equivalent')
    GROUP BY er.subject_entity_id
    ORDER BY cnt DESC
    LIMIT v_limit
  ) sub
  JOIN public.canonical_entities ce_heb ON ce_heb.id = sub.subject_entity_id
  LEFT JOIN public.lemmas l_heb ON l_heb.id = ce_heb.lemma_id;

  END IF;

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
$function$
