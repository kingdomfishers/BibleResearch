-- Migration: 20261106063000_septuagint_comparison_rpcs.sql
-- Description: Deterministic Septuagint & Hebrew-Greek Comparison RPCs
-- Verification: Search, Reverse search, Frequency distribution, Side-by-side parallel text, Cross-testament vocabulary tracing.

-- 1. Forward lookup: Hebrew lemma -> Greek translation equivalents
CREATE OR REPLACE FUNCTION public.lookup_hebrew_to_greek_alignments_v1(
  p_lemma_query text,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_query text := btrim(coalesce(p_lemma_query, ''));
  v_strong_norm text;
  v_license_status text;
  v_heb_entity record;
  v_alignments jsonb;
  v_total_alignments integer := 0;
BEGIN
  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_lemma_query must not be empty'
    );
  END IF;

  -- Dynamic license gating check
  SELECT status INTO v_license_status
  FROM public.field_license_registry
  WHERE dataset_key = 'macula-hebrew' AND field_name = 'greekstrong';

  IF v_license_status IS NULL OR v_license_status NOT IN ('enabled_verified', 'enabled_origin_unverified') THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'gated_license_restricted',
      'message', 'Hebrew-to-Greek alignments from MACULA Hebrew are restricted by field license policy (status: ' || coalesce(v_license_status, 'disabled_unverified') || ').',
      'license_status', coalesce(v_license_status, 'disabled_unverified')
    );
  END IF;

  -- Normalize Strong's if query looks like a Strong number (e.g. H0430, 0430, 430)
  IF v_query ~* '^[Hh]?[0-9]+[A-Za-z]?$' THEN
    v_strong_norm := 'lemma:H' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
  END IF;

  -- Locate Hebrew canonical lemma
  SELECT ce.id, ce.entity_key, ce.display_label, ce.language, l.lemma_script, l.transliteration, l.base_strongs
  INTO v_heb_entity
  FROM public.canonical_entities ce
  LEFT JOIN public.lemmas l ON l.id = ce.lemma_id
  WHERE ce.entity_kind = 'lemma'
    AND ce.language IN ('hbo', 'arc')
    AND (
      ce.entity_key = v_query
      OR (v_strong_norm IS NOT NULL AND (ce.entity_key = v_strong_norm OR ce.entity_key LIKE v_strong_norm || '%'))
      OR l.lemma_script = v_query
      OR l.transliteration ILIKE v_query
      OR ce.display_label ILIKE '%' || v_query || '%'
    )
  ORDER BY
    CASE WHEN ce.entity_key = v_strong_norm THEN 0
         WHEN ce.entity_key LIKE v_strong_norm || '%' THEN 1
         WHEN l.lemma_script = v_query THEN 2
         ELSE 3 END
  LIMIT 1;

  IF v_heb_entity.id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'query', p_lemma_query,
      'message', 'Hebrew lemma not found'
    );
  END IF;

  -- Retrieve explicit source alignments with occurrence frequencies
  WITH alignment_data AS (
    SELECT
      ce_grk.entity_key AS greek_lemma_key,
      ce_grk.display_label AS greek_display_label,
      coalesce(l_grk.lemma_script, '') AS greek_script,
      l_grk.transliteration AS greek_transliteration,
      coalesce(l_grk.base_strongs, g.field_value) AS greek_strong,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary,
      count(DISTINCT m.id) AS occurrence_count,
      (array_agg(DISTINCT m.ref_mt ORDER BY m.ref_mt))[1:10] AS sample_verses
    FROM public.entity_relationships er
    JOIN public.canonical_entities ce_grk ON ce_grk.id = er.object_entity_id
    LEFT JOIN public.lemmas l_grk ON l_grk.id = ce_grk.lemma_id
    LEFT JOIN public.macula_gated_field_values g ON g.field_name = 'greekstrong'
      AND ('lemma:G' || lpad(g.field_value, 4, '0') = ce_grk.entity_key OR ce_grk.entity_key LIKE 'lemma:G' || lpad(g.field_value, 4, '0') || '%')
    LEFT JOIN public.macula_hebrew_morphemes m ON m.id = g.morpheme_id
      AND ('lemma:H' || lpad(regexp_replace(m.strong_x, '[^0-9]', '', 'g'), 4, '0') = v_heb_entity.entity_key
           OR v_heb_entity.entity_key LIKE 'lemma:H' || lpad(regexp_replace(m.strong_x, '[^0-9]', '', 'g'), 4, '0') || '%')
    WHERE er.subject_entity_id = v_heb_entity.id
      AND er.relation_type = 'explicit_source_word_alignment'
    GROUP BY
      ce_grk.entity_key,
      ce_grk.display_label,
      l_grk.lemma_script,
      l_grk.transliteration,
      l_grk.base_strongs,
      g.field_value,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary
    ORDER BY occurrence_count DESC, ce_grk.entity_key
    LIMIT p_limit
  )
  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'greek_lemma_key', greek_lemma_key,
        'greek_display_label', greek_display_label,
        'greek_script', greek_script,
        'greek_transliteration', greek_transliteration,
        'greek_strong', greek_strong,
        'relation_type', relation_type,
        'derivation_method', derivation_method,
        'evidence_summary', evidence_summary,
        'occurrence_count', occurrence_count,
        'sample_verses', to_jsonb(sample_verses)
      )
    ), '[]'::jsonb),
    count(*)
  INTO v_alignments, v_total_alignments
  FROM alignment_data;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query', p_lemma_query,
    'hebrew_lemma', jsonb_build_object(
      'entity_key', v_heb_entity.entity_key,
      'display_label', v_heb_entity.display_label,
      'language', v_heb_entity.language,
      'lemma_script', v_heb_entity.lemma_script,
      'transliteration', v_heb_entity.transliteration,
      'base_strongs', v_heb_entity.base_strongs
    ),
    'license_status', v_license_status,
    'total_alignments', coalesce(v_total_alignments, 0),
    'alignments', v_alignments,
    'provenance', jsonb_build_object(
      'dataset', 'Clear-Bible/macula-hebrew',
      'release', '47db250bd55d0d8577f2a94fba114ef16c35b23c',
      'license', 'CC BY 4.0',
      'attribution', 'MACULA Hebrew Linguistic Datasets (Biblica, Inc.)'
    )
  );
END;
$$;

-- 2. Reverse lookup: Greek lemma -> Hebrew lemmas rendered
CREATE OR REPLACE FUNCTION public.lookup_greek_to_hebrew_alignments_v1(
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
  v_strong_norm text;
  v_license_status text;
  v_grk_entity record;
  v_alignments jsonb;
  v_total_alignments integer := 0;
BEGIN
  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_greek_query must not be empty'
    );
  END IF;

  -- Dynamic license gating check
  SELECT status INTO v_license_status
  FROM public.field_license_registry
  WHERE dataset_key = 'macula-hebrew' AND field_name = 'greekstrong';

  IF v_license_status IS NULL OR v_license_status NOT IN ('enabled_verified', 'enabled_origin_unverified') THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'gated_license_restricted',
      'message', 'Hebrew-to-Greek alignments from MACULA Hebrew are restricted by field license policy (status: ' || coalesce(v_license_status, 'disabled_unverified') || ').',
      'license_status', coalesce(v_license_status, 'disabled_unverified')
    );
  END IF;

  -- Normalize Strong's if query looks like a Strong number (e.g. G2316, 2316)
  IF v_query ~* '^[Gg]?[0-9]+[A-Za-z]?$' THEN
    v_strong_norm := 'lemma:G' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
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
      OR l.transliteration ILIKE v_query
      OR ce.display_label ILIKE '%' || v_query || '%'
    )
  ORDER BY
    CASE WHEN ce.entity_key = v_strong_norm THEN 0
         WHEN ce.entity_key LIKE v_strong_norm || '%' THEN 1
         WHEN l.lemma_script = v_query THEN 2
         ELSE 3 END
  LIMIT 1;

  IF v_grk_entity.id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'query', p_greek_query,
      'message', 'Greek lemma not found'
    );
  END IF;

  -- Retrieve explicit source alignments where this Greek lemma is the object
  WITH alignment_data AS (
    SELECT
      ce_heb.entity_key AS hebrew_lemma_key,
      ce_heb.display_label AS hebrew_display_label,
      coalesce(l_heb.lemma_script, '') AS hebrew_script,
      l_heb.transliteration AS hebrew_transliteration,
      coalesce(l_heb.base_strongs, m.strong_x) AS hebrew_strong,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary,
      count(DISTINCT m.id) AS occurrence_count,
      (array_agg(DISTINCT m.ref_mt ORDER BY m.ref_mt))[1:10] AS sample_verses
    FROM public.entity_relationships er
    JOIN public.canonical_entities ce_heb ON ce_heb.id = er.subject_entity_id
    LEFT JOIN public.lemmas l_heb ON l_heb.id = ce_heb.lemma_id
    LEFT JOIN public.macula_gated_field_values g ON g.field_name = 'greekstrong'
      AND ('lemma:G' || lpad(g.field_value, 4, '0') = v_grk_entity.entity_key OR v_grk_entity.entity_key LIKE 'lemma:G' || lpad(g.field_value, 4, '0') || '%')
    LEFT JOIN public.macula_hebrew_morphemes m ON m.id = g.morpheme_id
      AND ('lemma:H' || lpad(regexp_replace(m.strong_x, '[^0-9]', '', 'g'), 4, '0') = ce_heb.entity_key
           OR ce_heb.entity_key LIKE 'lemma:H' || lpad(regexp_replace(m.strong_x, '[^0-9]', '', 'g'), 4, '0') || '%')
    WHERE er.object_entity_id = v_grk_entity.id
      AND er.relation_type = 'explicit_source_word_alignment'
    GROUP BY
      ce_heb.entity_key,
      ce_heb.display_label,
      l_heb.lemma_script,
      l_heb.transliteration,
      l_heb.base_strongs,
      m.strong_x,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary
    ORDER BY occurrence_count DESC, ce_heb.entity_key
    LIMIT p_limit
  )
  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'hebrew_lemma_key', hebrew_lemma_key,
        'hebrew_display_label', hebrew_display_label,
        'hebrew_script', hebrew_script,
        'hebrew_transliteration', hebrew_transliteration,
        'hebrew_strong', hebrew_strong,
        'relation_type', relation_type,
        'derivation_method', derivation_method,
        'evidence_summary', evidence_summary,
        'occurrence_count', occurrence_count,
        'sample_verses', to_jsonb(sample_verses)
      )
    ), '[]'::jsonb),
    count(*)
  INTO v_alignments, v_total_alignments
  FROM alignment_data;

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
    'license_status', v_license_status,
    'total_alignments', coalesce(v_total_alignments, 0),
    'alignments', v_alignments,
    'provenance', jsonb_build_object(
      'dataset', 'Clear-Bible/macula-hebrew',
      'release', '47db250bd55d0d8577f2a94fba114ef16c35b23c',
      'license', 'CC BY 4.0',
      'attribution', 'MACULA Hebrew Linguistic Datasets (Biblica, Inc.)'
    )
  );
END;
$$;

-- 3. Side-by-side parallel text: MT Hebrew vs Swete Septuagint Greek
CREATE OR REPLACE FUNCTION public.get_hebrew_septuagint_parallel_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_verse_id integer;
  v_map record;
  v_mt_words jsonb;
  v_lxx_words jsonb;
  v_alignments jsonb := '[]'::jsonb;
  v_license_status text;
  v_lxx_book_no smallint;
  v_lxx_book_name text;
  v_lxx_chapter smallint;
  v_lxx_verse_nr smallint;
  v_lxx_suffix text := '';
  v_mapping_kind text := 'unmapped';
  v_rule_citation text := null;
BEGIN
  -- Locate canonical verse
  SELECT v.id INTO v_verse_id
  FROM public.verses v
  WHERE v.book = p_book AND v.chapter = p_chapter AND v.verse_nr = p_verse;

  IF v_verse_id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'message', 'Passage not found in canonical corpus'
    );
  END IF;

  -- Check explicit versification mapping
  SELECT m.*, b.latin_name INTO v_map
  FROM public.hebrew_lxx_verse_map m
  JOIN public.lxx_swete_books b ON b.book_no = m.lxx_book_no
  WHERE m.canonical_verse_id = v_verse_id;

  IF v_map.id IS NOT NULL THEN
    v_lxx_book_no := v_map.lxx_book_no;
    v_lxx_book_name := v_map.latin_name;
    v_lxx_chapter := v_map.lxx_chapter;
    v_lxx_verse_nr := v_map.lxx_verse_nr;
    v_lxx_suffix := coalesce(v_map.lxx_verse_suffix, '');
    v_mapping_kind := v_map.mapping_kind;
    v_rule_citation := v_map.rule_citation;
  ELSE
    -- Fallback: check if book exists in LXX
    SELECT b.book_no, b.latin_name INTO v_lxx_book_no, v_lxx_book_name
    FROM public.lxx_swete_books b
    WHERE b.canonical_book = p_book;

    v_lxx_chapter := p_chapter;
    v_lxx_verse_nr := p_verse;
    v_mapping_kind := 'assumed_1_to_1';
  END IF;

  -- Load MT Hebrew words from canonical words table
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', w.id,
      'ordinal', u.ord,
      'original_word', w.original_word,
      'transliteration', w.transliteration,
      'strongs_nr', w.strongs_nr,
      'gloss', (w.english_translations)[1]
    ) ORDER BY u.ord
  ), '[]'::jsonb)
  INTO v_mt_words
  FROM public.verses v,
       unnest(v.word_ids) WITH ORDINALITY AS u(wid, ord)
  JOIN public.words w ON w.id = u.wid
  WHERE v.id = v_verse_id;

  -- Load LXX Swete Greek words
  IF v_lxx_book_no IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', sw.id,
        'ordinal', sw.ordinal,
        'word_text', sw.word_text,
        'source_record_id', sw.source_record_id
      ) ORDER BY sw.ordinal
    ), '[]'::jsonb)
    INTO v_lxx_words
    FROM public.lxx_swete_words sw
    WHERE sw.book_no = v_lxx_book_no
      AND sw.chapter = v_lxx_chapter
      AND sw.verse_nr = v_lxx_verse_nr;
  ELSE
    v_lxx_words := '[]'::jsonb;
  END IF;

  -- Check license gating for morpheme-level alignments
  SELECT status INTO v_license_status
  FROM public.field_license_registry
  WHERE dataset_key = 'macula-hebrew' AND field_name = 'greekstrong';

  IF v_license_status IN ('enabled_verified', 'enabled_origin_unverified') THEN
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'word_no', m.word_no,
        'morph_no', m.morph_no,
        'text_form', m.text_form,
        'strong_x', m.strong_x,
        'lemma', m.lemma,
        'gloss', m.gloss,
        'greek_strong', g_strong.field_value,
        'greek_word', g_greek.field_value,
        'greek_display_label', ce_grk.display_label,
        'relation_type', 'explicit_source_word_alignment'
      ) ORDER BY m.word_no, m.morph_no
    ), '[]'::jsonb)
    INTO v_alignments
    FROM public.macula_hebrew_morphemes m
    LEFT JOIN public.macula_gated_field_values g_strong
      ON g_strong.morpheme_id = m.id AND g_strong.field_name = 'greekstrong'
    LEFT JOIN public.macula_gated_field_values g_greek
      ON g_greek.morpheme_id = m.id AND g_greek.field_name = 'greek'
    LEFT JOIN public.canonical_entities ce_grk
      ON ce_grk.entity_kind = 'lemma' AND ce_grk.language = 'grc'
      AND (ce_grk.entity_key = 'lemma:G' || lpad(g_strong.field_value, 4, '0')
           OR ce_grk.entity_key LIKE 'lemma:G' || lpad(g_strong.field_value, 4, '0') || '%')
    WHERE m.book = p_book
      AND m.chapter_mt = p_chapter
      AND m.verse_mt = p_verse;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'canonical_verse', jsonb_build_object(
      'id', v_verse_id,
      'book', p_book,
      'chapter', p_chapter,
      'verse_nr', p_verse
    ),
    'masoretic', jsonb_build_object(
      'book', p_book,
      'chapter', p_chapter,
      'verse_nr', p_verse,
      'word_count', jsonb_array_length(v_mt_words),
      'words', v_mt_words
    ),
    'septuagint', jsonb_build_object(
      'lxx_book_no', v_lxx_book_no,
      'latin_name', v_lxx_book_name,
      'chapter', v_lxx_chapter,
      'verse_nr', v_lxx_verse_nr,
      'verse_suffix', v_lxx_suffix,
      'mapping_kind', v_mapping_kind,
      'rule_citation', v_rule_citation,
      'word_count', jsonb_array_length(v_lxx_words),
      'words', v_lxx_words
    ),
    'word_alignments', v_alignments,
    'license_info', jsonb_build_object(
      'lxx_source', 'CC BY-SA 4.0 (nathans/lxx-swete, First1KGreek)',
      'macula_hebrew', 'CC BY 4.0 (Clear-Bible/macula-hebrew)',
      'macula_alignments_status', coalesce(v_license_status, 'disabled_unverified'),
      'catss_policy', 'External reference only; CATSS alignment data is NOT embedded.'
    )
  );
END;
$$;

-- 4. Cross-Testament Greek vocabulary tracing: Septuagint Greek <-> New Testament Greek
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
  v_strong_norm text;
  v_grk_entity record;
  v_nt_count integer := 0;
  v_nt_samples jsonb := '[]'::jsonb;
  v_lxx_count integer := 0;
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

  -- Normalize Strong's if query looks like a Strong number
  IF v_query ~* '^[Gg]?[0-9]+[A-Za-z]?$' THEN
    v_strong_norm := 'lemma:G' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
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
      OR l.transliteration ILIKE v_query
      OR ce.display_label ILIKE '%' || v_query || '%'
    )
  ORDER BY
    CASE WHEN ce.entity_key = v_strong_norm THEN 0
         WHEN ce.entity_key LIKE v_strong_norm || '%' THEN 1
         WHEN l.lemma_script = v_query THEN 2
         ELSE 3 END
  LIMIT 1;

  IF v_grk_entity.id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'query', p_greek_query,
      'message', 'Greek lemma not found'
    );
  END IF;

  -- 1. NT Greek occurrences in public.words (book >= 40)
  WITH nt_matches AS (
    SELECT
      w.id AS word_id,
      v.book,
      v.chapter,
      v.verse_nr,
      w.original_word,
      w.transliteration,
      (w.english_translations)[1] AS gloss
    FROM public.verses v,
         unnest(v.word_ids) AS wid
    JOIN public.words w ON w.id = wid
    WHERE v.book >= 40
      AND (
        w.strongs_nr = v_grk_entity.base_strongs
        OR (v_strong_norm IS NOT NULL AND w.strongs_nr = replace(v_strong_norm, 'lemma:', ''))
        OR w.original_word = v_grk_entity.lemma_script
      )
  )
  SELECT
    count(*),
    coalesce(jsonb_agg(
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
    ) FILTER (WHERE word_id IS NOT NULL), '[]'::jsonb)
  INTO v_nt_count, v_nt_samples
  FROM (
    SELECT * FROM nt_matches LIMIT p_limit
  ) sub;

  -- 2. LXX Swete occurrences in public.lxx_swete_words (matching attested inflections + direct script/lemma)
  WITH target_forms AS (
    SELECT DISTINCT trim(both '.,;:·''"¶[]{}' from w.original_word) AS form
    FROM public.words w
    WHERE w.strongs_nr = v_grk_entity.base_strongs
       OR (v_strong_norm IS NOT NULL AND w.strongs_nr = replace(v_strong_norm, 'lemma:', ''))
    UNION
    SELECT DISTINCT trim(both '.,;:·''"¶[]{}' from g_word.field_value) AS form
    FROM public.macula_gated_field_values g_strong
    JOIN public.macula_gated_field_values g_word ON g_word.morpheme_id = g_strong.morpheme_id AND g_word.field_name = 'greek'
    WHERE g_strong.field_name = 'greekstrong'
      AND (g_strong.field_value = regexp_replace(v_grk_entity.base_strongs, '[^0-9]', '', 'g')
           OR (v_strong_norm IS NOT NULL AND g_strong.field_value = regexp_replace(v_strong_norm, '[^0-9]', '', 'g')))
    UNION
    SELECT v_grk_entity.lemma_script
  ),
  lxx_matches AS (
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
    JOIN target_forms tf ON trim(both '.,;:·''"¶[]{}' from sw.word_text) ILIKE tf.form
  )
  SELECT
    count(*),
    coalesce(jsonb_agg(
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
    ) FILTER (WHERE word_id IS NOT NULL), '[]'::jsonb)
  INTO v_lxx_count, v_lxx_samples
  FROM (
    SELECT * FROM lxx_matches LIMIT p_limit
  ) sub;

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
      AND er.relation_type = 'explicit_source_word_alignment'
    GROUP BY er.subject_entity_id
    ORDER BY cnt DESC
    LIMIT p_limit
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
      'total_count', v_nt_count,
      'samples', v_nt_samples
    ),
    'lxx_occurrences', jsonb_build_object(
      'total_count', v_lxx_count,
      'samples', v_lxx_samples
    ),
    'hebrew_source_renderings', v_hebrew_renderings
  );
END;
$$;

-- Grant permissions to public roles
GRANT EXECUTE ON FUNCTION public.lookup_hebrew_to_greek_alignments_v1(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_greek_to_hebrew_alignments_v1(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_hebrew_septuagint_parallel_v1(integer, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_cross_testament_greek_v1(text, integer) TO anon, authenticated, service_role;
