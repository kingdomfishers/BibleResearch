-- Migration: 20261106173000_hebrew_septuagint_comparison_rpc.sql
-- Description: Rigorous Hebrew-Septuagint Comparison RPCs supporting bidirectional passage lookup, 3-tier alignments, and explicit unmatched reporting.

-- 1. Main passage comparison RPC: compare_hebrew_septuagint_passage_v1
CREATE OR REPLACE FUNCTION public.compare_hebrew_septuagint_passage_v1(
  p_hebrew_book integer DEFAULT NULL,
  p_hebrew_chapter integer DEFAULT NULL,
  p_hebrew_verse integer DEFAULT NULL,
  p_canonical_verse_id integer DEFAULT NULL,
  p_lxx_book_no smallint DEFAULT NULL,
  p_lxx_chapter smallint DEFAULT NULL,
  p_lxx_verse_nr smallint DEFAULT NULL,
  p_lxx_chapter_suffix text DEFAULT '',
  p_lxx_verse_suffix text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_query_mode text;
  v_verse_id integer := p_canonical_verse_id;
  v_heb_book integer := p_hebrew_book;
  v_heb_chapter integer := p_hebrew_chapter;
  v_heb_verse integer := p_hebrew_verse;

  v_lxx_book_no smallint := p_lxx_book_no;
  v_lxx_chapter smallint := p_lxx_chapter;
  v_lxx_ch_suffix text := coalesce(p_lxx_chapter_suffix, '');
  v_lxx_verse_nr smallint := p_lxx_verse_nr;
  v_lxx_v_suffix text := coalesce(p_lxx_verse_suffix, '');
  v_lxx_book_name text;
  v_is_deuterocanonical boolean := false;

  v_correspondence_status text := 'matched';
  v_mappings jsonb := '[]'::jsonb;
  v_map_count integer := 0;

  v_mt_words jsonb := '[]'::jsonb;
  v_mt_word_count integer := 0;

  v_lxx_words jsonb := '[]'::jsonb;
  v_lxx_word_count integer := 0;

  v_doc_alignments jsonb := '[]'::jsonb;
  v_cand_alignments jsonb := '[]'::jsonb;
  v_scholarly_alignments jsonb := '[]'::jsonb;

  v_primary_map record;
BEGIN
  -- Determine Query Mode
  IF v_verse_id IS NOT NULL OR (v_heb_book IS NOT NULL AND v_heb_chapter IS NOT NULL AND v_heb_verse IS NOT NULL) THEN
    v_query_mode := 'hebrew';
  ELSIF v_lxx_book_no IS NOT NULL AND v_lxx_chapter IS NOT NULL AND v_lxx_verse_nr IS NOT NULL THEN
    v_query_mode := 'septuagint';
  ELSE
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Either Hebrew reference (book, chapter, verse / canonical_verse_id) or Septuagint reference (lxx_book_no, lxx_chapter, lxx_verse_nr) must be provided.'
    );
  END IF;

  -- 1. HEBREW QUERY MODE
  IF v_query_mode = 'hebrew' THEN
    IF v_verse_id IS NULL THEN
      SELECT v.id INTO v_verse_id
      FROM public.verses v
      WHERE v.book = v_heb_book AND v.chapter = v_heb_chapter AND v.verse_nr = v_heb_verse;
    ELSE
      SELECT v.book, v.chapter, v.verse_nr INTO v_heb_book, v_heb_chapter, v_heb_verse
      FROM public.verses v
      WHERE v.id = v_verse_id;
    END IF;

    IF v_verse_id IS NULL THEN
      RETURN jsonb_build_object(
        'schema_version', 1,
        'status', 'not_found',
        'message', 'Passage not found in canonical Hebrew corpus'
      );
    END IF;

    -- Fetch all versification mappings for this Hebrew verse
    SELECT
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'canonical_verse_id', m.canonical_verse_id,
          'lxx_book_no', m.lxx_book_no,
          'lxx_book_name', coalesce(b.latin_name, ''),
          'lxx_chapter', m.lxx_chapter,
          'lxx_chapter_suffix', m.lxx_chapter_suffix,
          'lxx_verse_nr', m.lxx_verse_nr,
          'lxx_verse_suffix', m.lxx_verse_suffix,
          'mapping_kind', m.mapping_kind,
          'rule_citation', m.rule_citation,
          'origin_mode', m.origin_mode,
          'derivation_method', m.derivation_method
        ) ORDER BY m.id
      ), '[]'::jsonb),
      count(*)
    INTO v_mappings, v_map_count
    FROM public.hebrew_lxx_verse_map m
    LEFT JOIN public.lxx_swete_books b ON b.book_no = m.lxx_book_no
    WHERE m.canonical_verse_id = v_verse_id;

    -- Inspect primary mapping
    SELECT m.*, b.latin_name INTO v_primary_map
    FROM public.hebrew_lxx_verse_map m
    LEFT JOIN public.lxx_swete_books b ON b.book_no = m.lxx_book_no
    WHERE m.canonical_verse_id = v_verse_id
    ORDER BY m.id
    LIMIT 1;

    IF v_primary_map.id IS NOT NULL THEN
      IF v_primary_map.mapping_kind IN ('unmatched_hebrew', 'mt_plus') OR v_primary_map.lxx_book_no IS NULL THEN
        v_correspondence_status := 'unmatched_hebrew_minus_in_lxx';
      ELSIF v_primary_map.mapping_kind = 'reordered' THEN
        v_correspondence_status := 'reordered';
        v_lxx_book_no := v_primary_map.lxx_book_no;
        v_lxx_book_name := v_primary_map.latin_name;
        v_lxx_chapter := v_primary_map.lxx_chapter;
        v_lxx_ch_suffix := v_primary_map.lxx_chapter_suffix;
        v_lxx_verse_nr := v_primary_map.lxx_verse_nr;
        v_lxx_v_suffix := v_primary_map.lxx_verse_suffix;
      ELSE
        v_correspondence_status := 'matched';
        v_lxx_book_no := v_primary_map.lxx_book_no;
        v_lxx_book_name := v_primary_map.latin_name;
        v_lxx_chapter := v_primary_map.lxx_chapter;
        v_lxx_ch_suffix := v_primary_map.lxx_chapter_suffix;
        v_lxx_verse_nr := v_primary_map.lxx_verse_nr;
        v_lxx_v_suffix := v_primary_map.lxx_verse_suffix;
      END IF;
    ELSE
      -- Fallback: check if book exists in Septuagint
      SELECT b.book_no, b.latin_name INTO v_lxx_book_no, v_lxx_book_name
      FROM public.lxx_swete_books b
      WHERE b.canonical_book = v_heb_book;

      IF v_lxx_book_no IS NOT NULL THEN
        v_lxx_chapter := v_heb_chapter;
        v_lxx_verse_nr := v_heb_verse;
        v_correspondence_status := 'matched';
      ELSE
        v_correspondence_status := 'unmatched_hebrew_minus_in_lxx';
      END IF;
    END IF;

  -- 2. SEPTUAGINT QUERY MODE
  ELSE
    SELECT b.latin_name, (b.canonical_book IS NULL) INTO v_lxx_book_name, v_is_deuterocanonical
    FROM public.lxx_swete_books b
    WHERE b.book_no = v_lxx_book_no;

    IF v_lxx_book_name IS NULL THEN
      RETURN jsonb_build_object(
        'schema_version', 1,
        'status', 'not_found',
        'message', 'Septuagint book not found'
      );
    END IF;

    -- Fetch mappings from Septuagint side
    SELECT
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'canonical_verse_id', m.canonical_verse_id,
          'hebrew_reference', coalesce(format('%s %s:%s', bk.name, v.chapter, v.verse_nr), ''),
          'hebrew_book', v.book,
          'hebrew_chapter', v.chapter,
          'hebrew_verse', v.verse_nr,
          'mapping_kind', m.mapping_kind,
          'rule_citation', m.rule_citation,
          'origin_mode', m.origin_mode,
          'derivation_method', m.derivation_method
        ) ORDER BY m.id
      ), '[]'::jsonb),
      count(*)
    INTO v_mappings, v_map_count
    FROM public.hebrew_lxx_verse_map m
    LEFT JOIN public.verses v ON v.id = m.canonical_verse_id
    LEFT JOIN public.books bk ON bk.id = v.book
    WHERE m.lxx_book_no = v_lxx_book_no
      AND m.lxx_chapter = v_lxx_chapter
      AND m.lxx_verse_nr = v_lxx_verse_nr
      AND (v_lxx_ch_suffix = '' OR m.lxx_chapter_suffix = v_lxx_ch_suffix)
      AND (v_lxx_v_suffix = '' OR m.lxx_verse_suffix = v_lxx_v_suffix);

    -- Inspect primary mapping
    SELECT m.*, v.book AS heb_b, v.chapter AS heb_c, v.verse_nr AS heb_v INTO v_primary_map
    FROM public.hebrew_lxx_verse_map m
    LEFT JOIN public.verses v ON v.id = m.canonical_verse_id
    WHERE m.lxx_book_no = v_lxx_book_no
      AND m.lxx_chapter = v_lxx_chapter
      AND m.lxx_verse_nr = v_lxx_verse_nr
    ORDER BY m.id
    LIMIT 1;

    IF v_primary_map.id IS NOT NULL THEN
      IF v_primary_map.mapping_kind IN ('unmatched_septuagint', 'lxx_plus') OR v_primary_map.canonical_verse_id IS NULL THEN
        v_correspondence_status := 'unmatched_lxx_plus_in_greek';
      ELSIF v_primary_map.mapping_kind = 'reordered' THEN
        v_correspondence_status := 'reordered';
        v_verse_id := v_primary_map.canonical_verse_id;
        v_heb_book := v_primary_map.heb_b;
        v_heb_chapter := v_primary_map.heb_c;
        v_heb_verse := v_primary_map.heb_v;
      ELSE
        v_correspondence_status := 'matched';
        v_verse_id := v_primary_map.canonical_verse_id;
        v_heb_book := v_primary_map.heb_b;
        v_heb_chapter := v_primary_map.heb_c;
        v_heb_verse := v_primary_map.heb_v;
      END IF;
    ELSIF v_is_deuterocanonical THEN
      v_correspondence_status := 'unmatched_lxx_plus_in_greek';
    ELSE
      -- Fallback to canonical OT book if applicable
      SELECT b.canonical_book INTO v_heb_book
      FROM public.lxx_swete_books b
      WHERE b.book_no = v_lxx_book_no;

      IF v_heb_book IS NOT NULL THEN
        SELECT v.id INTO v_verse_id
        FROM public.verses v
        WHERE v.book = v_heb_book AND v.chapter = v_lxx_chapter AND v.verse_nr = v_lxx_verse_nr;

        IF v_verse_id IS NOT NULL THEN
          v_heb_chapter := v_lxx_chapter;
          v_heb_verse := v_lxx_verse_nr;
          v_correspondence_status := 'matched';
        ELSE
          v_correspondence_status := 'unmatched_lxx_plus_in_greek';
        END IF;
      ELSE
        v_correspondence_status := 'unmatched_lxx_plus_in_greek';
      END IF;
    END IF;
  END IF;

  -- 3. FETCH HEBREW TOKENS
  IF v_verse_id IS NOT NULL THEN
    SELECT
      coalesce(jsonb_agg(
        jsonb_build_object(
          'ordinal', u.ord,
          'word_id', w.id,
          'original_word', w.original_word,
          'transliteration', w.transliteration,
          'strongs_nr', w.strongs_nr,
          'gloss', (w.english_translations)[1],
          'alignment_status', 'unmatched',
          'aligned_lxx_ordinals', '[]'::jsonb
        ) ORDER BY u.ord
      ), '[]'::jsonb),
      count(*)
    INTO v_mt_words, v_mt_word_count
    FROM public.verses v,
         unnest(v.word_ids) WITH ORDINALITY AS u(wid, ord)
    JOIN public.words w ON w.id = u.wid
    WHERE v.id = v_verse_id;
  END IF;

  -- 4. FETCH SEPTUAGINT GREEK TOKENS
  IF v_lxx_book_no IS NOT NULL AND v_lxx_chapter IS NOT NULL AND v_lxx_verse_nr IS NOT NULL THEN
    SELECT
      coalesce(jsonb_agg(
        jsonb_build_object(
          'ordinal', sw.ordinal,
          'lxx_word_id', sw.id,
          'word_text', sw.word_text,
          'normalized_word', sw.normalized_word,
          'alignment_status', 'unmatched',
          'aligned_hebrew_ordinals', '[]'::jsonb
        ) ORDER BY sw.ordinal
      ), '[]'::jsonb),
      count(*)
    INTO v_lxx_words, v_lxx_word_count
    FROM public.lxx_swete_words sw
    WHERE sw.book_no = v_lxx_book_no
      AND sw.chapter = v_lxx_chapter
      AND (v_lxx_ch_suffix = '' OR sw.chapter_suffix = v_lxx_ch_suffix)
      AND sw.verse_nr = v_lxx_verse_nr
      AND (v_lxx_v_suffix = '' OR sw.verse_suffix = v_lxx_v_suffix);
  END IF;

  -- 5. FETCH 3-TIER WORD & PHRASE ALIGNMENTS
  IF v_verse_id IS NOT NULL OR (v_lxx_book_no IS NOT NULL AND v_lxx_chapter IS NOT NULL AND v_lxx_verse_nr IS NOT NULL) THEN
    -- Tier 1: Documented Textual
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'alignment_key', a.alignment_key,
        'cardinality', a.cardinality,
        'alignment_tier', a.alignment_tier,
        'verification_status', a.verification_status,
        'confidence_score', a.confidence_score,
        'hebrew_text', a.hebrew_text,
        'hebrew_ordinals', to_jsonb(a.hebrew_token_ordinals),
        'hebrew_strongs', to_jsonb(a.hebrew_strongs),
        'lxx_text', a.lxx_text,
        'lxx_ordinals', to_jsonb(a.lxx_token_ordinals),
        'lxx_strongs', to_jsonb(a.lxx_strongs),
        'algorithm_or_source', a.algorithm_or_source,
        'translation_technique', a.translation_technique,
        'evidence_summary', a.evidence_summary
      ) ORDER BY a.id
    ), '[]'::jsonb)
    INTO v_doc_alignments
    FROM public.hebrew_lxx_word_alignments a
    WHERE (v_verse_id IS NOT NULL AND a.canonical_verse_id = v_verse_id)
       OR (v_lxx_book_no IS NOT NULL AND a.lxx_book_no = v_lxx_book_no AND a.lxx_chapter = v_lxx_chapter AND a.lxx_verse_nr = v_lxx_verse_nr)
      AND a.alignment_tier = 'documented_textual';

    -- Tier 2: Computationally Inferred Candidate
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'alignment_key', a.alignment_key,
        'cardinality', a.cardinality,
        'alignment_tier', a.alignment_tier,
        'verification_status', a.verification_status,
        'confidence_score', a.confidence_score,
        'hebrew_text', a.hebrew_text,
        'hebrew_ordinals', to_jsonb(a.hebrew_token_ordinals),
        'hebrew_strongs', to_jsonb(a.hebrew_strongs),
        'lxx_text', a.lxx_text,
        'lxx_ordinals', to_jsonb(a.lxx_token_ordinals),
        'lxx_strongs', to_jsonb(a.lxx_strongs),
        'algorithm_or_source', a.algorithm_or_source,
        'translation_technique', a.translation_technique,
        'evidence_summary', a.evidence_summary
      ) ORDER BY a.id
    ), '[]'::jsonb)
    INTO v_cand_alignments
    FROM public.hebrew_lxx_word_alignments a
    WHERE (v_verse_id IS NOT NULL AND a.canonical_verse_id = v_verse_id)
       OR (v_lxx_book_no IS NOT NULL AND a.lxx_book_no = v_lxx_book_no AND a.lxx_chapter = v_lxx_chapter AND a.lxx_verse_nr = v_lxx_verse_nr)
      AND a.alignment_tier = 'computationally_inferred_candidate';

    -- Tier 3: Scholarly Interpretation
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'alignment_key', a.alignment_key,
        'cardinality', a.cardinality,
        'alignment_tier', a.alignment_tier,
        'verification_status', a.verification_status,
        'confidence_score', a.confidence_score,
        'hebrew_text', a.hebrew_text,
        'hebrew_ordinals', to_jsonb(a.hebrew_token_ordinals),
        'hebrew_strongs', to_jsonb(a.hebrew_strongs),
        'lxx_text', a.lxx_text,
        'lxx_ordinals', to_jsonb(a.lxx_token_ordinals),
        'lxx_strongs', to_jsonb(a.lxx_strongs),
        'algorithm_or_source', a.algorithm_or_source,
        'translation_technique', a.translation_technique,
        'evidence_summary', a.evidence_summary
      ) ORDER BY a.id
    ), '[]'::jsonb)
    INTO v_scholarly_alignments
    FROM public.hebrew_lxx_word_alignments a
    WHERE (v_verse_id IS NOT NULL AND a.canonical_verse_id = v_verse_id)
       OR (v_lxx_book_no IS NOT NULL AND a.lxx_book_no = v_lxx_book_no AND a.lxx_chapter = v_lxx_chapter AND a.lxx_verse_nr = v_lxx_verse_nr)
      AND a.alignment_tier = 'scholarly_interpretation';

    -- Tag Hebrew tokens with alignment status
    IF jsonb_array_length(v_doc_alignments) > 0 OR jsonb_array_length(v_cand_alignments) > 0 THEN
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'ordinal', (elem->>'ordinal')::int,
          'word_id', (elem->>'word_id')::int,
          'original_word', elem->>'original_word',
          'transliteration', elem->>'transliteration',
          'strongs_nr', elem->>'strongs_nr',
          'gloss', elem->>'gloss',
          'alignment_status', CASE
            WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc_alignments) da WHERE da->'hebrew_ordinals' @> jsonb_build_array((elem->>'ordinal')::int)) THEN 'documented_aligned'
            WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_cand_alignments) ca WHERE ca->'hebrew_ordinals' @> jsonb_build_array((elem->>'ordinal')::int)) THEN 'candidate_aligned'
            ELSE 'unmatched'
          END,
          'aligned_lxx_ordinals', coalesce((
            SELECT (da->'lxx_ordinals')
            FROM jsonb_array_elements(v_doc_alignments) da
            WHERE da->'hebrew_ordinals' @> jsonb_build_array((elem->>'ordinal')::int)
            LIMIT 1
          ), (
            SELECT (ca->'lxx_ordinals')
            FROM jsonb_array_elements(v_cand_alignments) ca
            WHERE ca->'hebrew_ordinals' @> jsonb_build_array((elem->>'ordinal')::int)
            LIMIT 1
          ), '[]'::jsonb)
        ) ORDER BY (elem->>'ordinal')::int
      ), '[]'::jsonb)
      INTO v_mt_words
      FROM jsonb_array_elements(v_mt_words) elem;
    END IF;

    -- Tag Greek tokens with alignment status
    IF jsonb_array_length(v_doc_alignments) > 0 OR jsonb_array_length(v_cand_alignments) > 0 THEN
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'ordinal', (elem->>'ordinal')::int,
          'lxx_word_id', (elem->>'lxx_word_id')::bigint,
          'word_text', elem->>'word_text',
          'normalized_word', elem->>'normalized_word',
          'alignment_status', CASE
            WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc_alignments) da WHERE da->'lxx_ordinals' @> jsonb_build_array((elem->>'ordinal')::int)) THEN 'documented_aligned'
            WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_cand_alignments) ca WHERE ca->'lxx_ordinals' @> jsonb_build_array((elem->>'ordinal')::int)) THEN 'candidate_aligned'
            ELSE 'unmatched'
          END,
          'aligned_hebrew_ordinals', coalesce((
            SELECT (da->'hebrew_ordinals')
            FROM jsonb_array_elements(v_doc_alignments) da
            WHERE da->'lxx_ordinals' @> jsonb_build_array((elem->>'ordinal')::int)
            LIMIT 1
          ), (
            SELECT (ca->'hebrew_ordinals')
            FROM jsonb_array_elements(v_cand_alignments) ca
            WHERE ca->'lxx_ordinals' @> jsonb_build_array((elem->>'ordinal')::int)
            LIMIT 1
          ), '[]'::jsonb)
        ) ORDER BY (elem->>'ordinal')::int
      ), '[]'::jsonb)
      INTO v_lxx_words
      FROM jsonb_array_elements(v_lxx_words) elem;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query_mode', v_query_mode,
    'correspondence_status', v_correspondence_status,
    'has_hebrew_passage', (v_verse_id IS NOT NULL),
    'has_septuagint_passage', (v_lxx_book_no IS NOT NULL AND v_lxx_chapter IS NOT NULL AND v_lxx_verse_nr IS NOT NULL AND v_correspondence_status != 'unmatched_hebrew_minus_in_lxx'),
    'hebrew_passage', CASE WHEN v_verse_id IS NOT NULL THEN jsonb_build_object(
      'canonical_verse_id', v_verse_id,
      'book', v_heb_book,
      'chapter', v_heb_chapter,
      'verse_nr', v_heb_verse,
      'word_count', v_mt_word_count,
      'words', v_mt_words
    ) ELSE NULL END,
    'septuagint_passage', CASE WHEN v_lxx_book_no IS NOT NULL AND v_correspondence_status != 'unmatched_hebrew_minus_in_lxx' THEN jsonb_build_object(
      'book_no', v_lxx_book_no,
      'latin_name', coalesce(v_lxx_book_name, ''),
      'chapter', v_lxx_chapter,
      'chapter_suffix', v_lxx_ch_suffix,
      'verse_nr', v_lxx_verse_nr,
      'verse_suffix', v_lxx_v_suffix,
      'is_deuterocanonical', v_is_deuterocanonical,
      'word_count', v_lxx_word_count,
      'words', v_lxx_words
    ) ELSE NULL END,
    'versification_mappings', v_mappings,
    'documented_alignments', v_doc_alignments,
    'candidate_alignments', v_cand_alignments,
    'scholarly_interpretations', v_scholarly_alignments,
    'epistemic_disclaimer', 'Candidate alignments are computationally inferred and strictly segregated from verified textual evidence. Unmatched words remain explicitly unaligned without invented equivalents.'
  );
END;
$$;

-- 2. Alignment lookup RPC: lookup_hebrew_septuagint_alignments_v1
CREATE OR REPLACE FUNCTION public.lookup_hebrew_septuagint_alignments_v1(
  p_query text,
  p_tier text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_q text := btrim(coalesce(p_query, ''));
  v_results jsonb;
  v_total integer;
BEGIN
  IF v_q = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_query must not be empty'
    );
  END IF;

  WITH filtered AS (
    SELECT
      a.id,
      a.alignment_key,
      a.canonical_verse_id,
      a.lxx_book_no,
      coalesce(b.latin_name, '') AS lxx_book_name,
      a.lxx_chapter,
      a.lxx_chapter_suffix,
      a.lxx_verse_nr,
      a.lxx_verse_suffix,
      a.hebrew_text,
      a.hebrew_token_ordinals,
      a.hebrew_strongs,
      a.lxx_text,
      a.lxx_token_ordinals,
      a.lxx_strongs,
      a.cardinality,
      a.alignment_tier,
      a.verification_status,
      a.confidence_score,
      a.algorithm_or_source,
      a.translation_technique,
      a.evidence_summary
    FROM public.hebrew_lxx_word_alignments a
    LEFT JOIN public.lxx_swete_books b ON b.book_no = a.lxx_book_no
    WHERE (p_tier IS NULL OR a.alignment_tier = p_tier)
      AND (
        a.hebrew_text ILIKE '%' || v_q || '%'
        OR a.lxx_text ILIKE '%' || v_q || '%'
        OR v_q = ANY(a.hebrew_strongs)
        OR v_q = ANY(a.lxx_strongs)
        OR a.alignment_key ILIKE '%' || v_q || '%'
      )
    ORDER BY
      CASE WHEN a.alignment_tier = 'documented_textual' THEN 1
           WHEN a.alignment_tier = 'scholarly_interpretation' THEN 2
           ELSE 3 END,
      a.confidence_score DESC NULLS LAST,
      a.id
    LIMIT p_limit
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb),
    count(*)
  INTO v_results, v_total
  FROM filtered f;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query', p_query,
    'tier_filter', p_tier,
    'total_returned', coalesce(v_total, 0),
    'alignments', v_results,
    'epistemic_disclaimer', 'Candidate alignments are computationally inferred and strictly segregated from verified textual evidence. Unmatched words remain explicitly unaligned without invented equivalents.'
  );
END;
$$;
