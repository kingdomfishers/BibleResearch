-- Migration: 20261106180000_syntax_passage_lookup_overload.sql
-- Description: Add (book, chapter, verse) overload for lookup_syntax_tree_v1

CREATE OR REPLACE FUNCTION public.lookup_syntax_tree_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer,
  p_edition_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_verse_id integer;
BEGIN
  SELECT id INTO v_verse_id
  FROM public.verses
  WHERE book = p_book AND chapter = p_chapter AND verse_nr = p_verse;

  IF NOT FOUND THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.lookup_syntax_tree_v1(integer, integer, integer, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.lookup_syntax_tree_v1(integer, integer, integer, text) IS
  'Passage overload (book, chapter, verse) for lookup_syntax_tree_v1 resolving canonical verse_id.';
