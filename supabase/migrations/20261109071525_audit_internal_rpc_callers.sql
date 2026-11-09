-- ============================================================================
-- Migration: 20261109071500_audit_internal_rpc_callers.sql
-- Feature: AUDIT-01 Route public SQL hybrid callers to bible_internal.call_corpus_rpc_v1
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_evidence_coverage_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1('audit_evidence_coverage_v1', '{}'::jsonb);
  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR NOT (v_remote ? 'table_counts') THEN
    RETURN jsonb_build_object(
      'status', 'FAIL',
      'is_valid', false,
      'error', 'static_corpus_unavailable'
    );
  END IF;
  RETURN v_remote;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lookup_syntax_tree_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer,
  p_edition_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
  v_verse_id integer;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_syntax_tree_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_book', p_book,
      'p_chapter', p_chapter,
      'p_verse', p_verse,
      'p_edition_key', p_edition_key
    ))
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  SELECT id INTO v_verse_id
  FROM public.verses
  WHERE book = p_book AND chapter = p_chapter AND verse_nr = p_verse;

  IF v_verse_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'verse_not_found',
      'book', p_book,
      'chapter', p_chapter,
      'verse_nr', p_verse,
      'has_syntax', false,
      'syntax_status', 'passage_not_found',
      'missing_syntax_reason', 'The requested passage does not exist in the canonical 66-book Bible index.'
    );
  END IF;

  RETURN public.lookup_syntax_tree_v1(v_verse_id, p_edition_key);
END;
$function$;

CREATE OR REPLACE FUNCTION public.lookup_septuagint_passage_v1(
  p_book_no smallint,
  p_chapter smallint,
  p_verse_nr smallint DEFAULT NULL::smallint,
  p_chapter_suffix text DEFAULT ''::text,
  p_verse_suffix text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
  v_verse_tokens jsonb;
  v_swete_book record;
  v_token_count integer;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_septuagint_passage_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_book_no', p_book_no,
      'p_chapter', p_chapter,
      'p_verse_nr', p_verse_nr,
      'p_chapter_suffix', p_chapter_suffix,
      'p_verse_suffix', p_verse_suffix
    ))
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  SELECT id, book_name_latin, book_name_greek, book_order_swete
  INTO v_swete_book
  FROM public.lxx_swete_books
  WHERE canonical_book_id = p_book_no
  LIMIT 1;

  IF v_swete_book IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'not_found',
      'error', 'Book not present in Swete LXX edition',
      'canonical_book_id', p_book_no,
      'tokens', '[]'::jsonb,
      'token_count', 0
    );
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', w.id,
      'canonical_verse_id', w.canonical_verse_id,
      'word_position', w.word_position,
      'word_greek', w.word_greek,
      'word_norm', w.word_norm,
      'accented_text', w.accented_text,
      'strongs_number', w.strongs_number,
      'step_lemma', w.step_lemma,
      'step_morph_code', w.step_morph_code,
      'swete_ref', w.swete_ref
    ) ORDER BY w.canonical_verse_id, w.word_position
  ), '[]'::jsonb), count(w.id)
  INTO v_verse_tokens, v_token_count
  FROM public.lxx_swete_words w
  JOIN public.verses v ON v.id = w.canonical_verse_id
  WHERE v.book = p_book_no
    AND v.chapter = p_chapter
    AND (p_verse_nr IS NULL OR v.verse_nr = p_verse_nr);

  RETURN jsonb_build_object(
    'status', 'ok',
    'canonical_book_id', p_book_no,
    'book_name_latin', v_swete_book.book_name_latin,
    'book_name_greek', v_swete_book.book_name_greek,
    'chapter', p_chapter,
    'verse_nr', p_verse_nr,
    'token_count', v_token_count,
    'tokens', v_verse_tokens
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.audit_evidence_coverage_v1() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_syntax_tree_v1(integer, integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_septuagint_passage_v1(smallint, smallint, smallint, text, text) TO anon, authenticated;
