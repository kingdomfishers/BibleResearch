-- supabase/migrations/20261106163000_septuagint_evidence_rpc.sql
-- F7: High-precision Septuagint lookup RPCs supporting Swete 55-book corpus,
-- reference-level MT <-> LXX parallel mapping, normalized search forms,
-- and transparent linguistic annotation disclaimers.

BEGIN;

-- 1. Lookup Septuagint Passage by Swete Reference
CREATE OR REPLACE FUNCTION public.lookup_septuagint_passage_v1(
  p_book_no smallint,
  p_chapter smallint,
  p_verse_nr smallint DEFAULT NULL,
  p_chapter_suffix text DEFAULT '',
  p_verse_suffix text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_book record;
  v_tokens jsonb;
  v_total_tokens integer := 0;
  v_mapping record;
  v_canonical_verse record;
BEGIN
  -- 1. Check book metadata
  SELECT b.book_no, b.latin_name, b.canonical_book, b.file_name,
         cb.name as canonical_name
  INTO v_book
  FROM public.lxx_swete_books b
  LEFT JOIN public.books cb ON cb.id = b.canonical_book
  WHERE b.book_no = p_book_no;

  IF NOT FOUND THEN
    -- Check if it is a known missing source book in 1..59
    IF p_book_no IN (7, 9, 22, 30) THEN
      RETURN jsonb_build_object(
        'found', false,
        'reason', 'source_incompleteness',
        'book_no', p_book_no,
        'message', 'Book number ' || p_book_no || ' is absent from the declared upstream nathans/lxx-swete digital repository.'
      );
    ELSE
      RETURN jsonb_build_object(
        'found', false,
        'reason', 'unknown_book',
        'book_no', p_book_no,
        'message', 'Book number ' || p_book_no || ' does not exist in Swete Septuagint catalog.'
      );
    END IF;
  END IF;

  -- 2. Query tokens
  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'book_no', w.book_no,
        'chapter', w.chapter,
        'chapter_suffix', w.chapter_suffix,
        'verse_nr', w.verse_nr,
        'verse_suffix', w.verse_suffix,
        'ordinal', w.ordinal,
        'word_text', w.word_text,
        'normalized_word', w.normalized_word,
        'source_record_id', w.source_record_id,
        'source_release_key', sr.release_key,
        'source_edition_key', se.edition_key
      )
      ORDER BY w.chapter, w.chapter_suffix, w.verse_nr, w.verse_suffix, w.ordinal
    ), '[]'::jsonb),
    count(*)
  INTO v_tokens, v_total_tokens
  FROM public.lxx_swete_words w
  LEFT JOIN public.source_releases sr ON sr.id = w.source_release_id
  LEFT JOIN public.source_editions se ON se.id = w.source_edition_id
  WHERE w.book_no = p_book_no
    AND w.chapter = p_chapter
    AND w.chapter_suffix = coalesce(p_chapter_suffix, '')
    AND (p_verse_nr IS NULL OR (w.verse_nr = p_verse_nr AND w.verse_suffix = coalesce(p_verse_suffix, '')));

  IF v_total_tokens = 0 THEN
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'passage_not_found',
      'book_no', p_book_no,
      'chapter', p_chapter,
      'chapter_suffix', p_chapter_suffix,
      'verse_nr', p_verse_nr,
      'verse_suffix', p_verse_suffix,
      'message', 'No Greek words found in Swete Septuagint for the requested reference.'
    );
  END IF;

  -- 3. Check MT <-> LXX mapping if single verse requested
  IF p_verse_nr IS NOT NULL THEN
    SELECT m.canonical_verse_id, m.mapping_kind, m.rule_citation, m.origin_mode, m.derivation_method,
           v.book, v.chapter as mt_ch, v.verse_nr as mt_v
    INTO v_mapping
    FROM public.hebrew_lxx_verse_map m
    JOIN public.verses v ON v.id = m.canonical_verse_id
    WHERE m.lxx_book_no = p_book_no
      AND m.lxx_chapter = p_chapter
      AND m.lxx_chapter_suffix = coalesce(p_chapter_suffix, '')
      AND m.lxx_verse_nr = p_verse_nr
      AND m.lxx_verse_suffix = coalesce(p_verse_suffix, '')
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'book', jsonb_build_object(
      'book_no', v_book.book_no,
      'latin_name', v_book.latin_name,
      'canonical_book_id', v_book.canonical_book,
      'canonical_book_name', v_book.canonical_name,
      'is_deuterocanonical_or_apocrypha', (v_book.canonical_book IS NULL)
    ),
    'reference', jsonb_build_object(
      'chapter', p_chapter,
      'chapter_suffix', coalesce(p_chapter_suffix, ''),
      'verse_nr', p_verse_nr,
      'verse_suffix', coalesce(p_verse_suffix, '')
    ),
    'summary', jsonb_build_object(
      'total_tokens', v_total_tokens,
      'has_hebrew_counterpart', (v_mapping.canonical_verse_id IS NOT NULL),
      'hebrew_canonical_verse_id', v_mapping.canonical_verse_id,
      'hebrew_reference', CASE
        WHEN v_mapping.canonical_verse_id IS NOT NULL THEN
          jsonb_build_object('book', v_mapping.book, 'chapter', v_mapping.mt_ch, 'verse_nr', v_mapping.mt_v)
        ELSE NULL
      END,
      'versification_mapping', CASE
        WHEN v_mapping.canonical_verse_id IS NOT NULL THEN
          jsonb_build_object(
            'mapping_kind', v_mapping.mapping_kind,
            'rule_citation', v_mapping.rule_citation,
            'origin_mode', v_mapping.origin_mode,
            'derivation_method', v_mapping.derivation_method
          )
        ELSE NULL
      END,
      'linguistic_annotation_status', 'unannotated_in_source',
      'epistemic_disclaimer', 'The Swete digital edition provides authentic surface tokens and punctuation without morphological tags or lemmas. External lexicons or parsers must not be presented as source-attested facts.'
    ),
    'tokens', v_tokens
  );
END;
$$;

-- 2. Lookup Septuagint by Canonical Hebrew Verse ID
CREATE OR REPLACE FUNCTION public.lookup_septuagint_by_canonical_verse_v1(
  p_canonical_verse_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mapping record;
  v_res jsonb;
BEGIN
  -- Find mapping
  SELECT m.lxx_book_no, m.lxx_chapter, m.lxx_chapter_suffix, m.lxx_verse_nr, m.lxx_verse_suffix
  INTO v_mapping
  FROM public.hebrew_lxx_verse_map m
  WHERE m.canonical_verse_id = p_canonical_verse_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', false,
      'canonical_verse_id', p_canonical_verse_id,
      'reason', 'no_septuagint_mapping',
      'message', 'Canonical verse ID ' || p_canonical_verse_id || ' has no recorded Septuagint mapping in public.hebrew_lxx_verse_map.'
    );
  END IF;

  -- Delegate to lookup_septuagint_passage_v1
  v_res := public.lookup_septuagint_passage_v1(
    v_mapping.lxx_book_no,
    v_mapping.lxx_chapter,
    v_mapping.lxx_verse_nr,
    v_mapping.lxx_chapter_suffix,
    v_mapping.lxx_verse_suffix
  );

  RETURN v_res;
END;
$$;

-- 3. Grants & Permissions
GRANT EXECUTE ON FUNCTION public.lookup_septuagint_passage_v1(smallint, smallint, smallint, text, text) TO anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.lookup_septuagint_by_canonical_verse_v1(integer) TO anon, authenticated, service_role, postgres;

COMMIT;

NOTIFY pgrst, 'reload schema';
