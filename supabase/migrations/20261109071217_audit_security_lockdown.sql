-- ============================================================================
-- Migration: 20261109071217_audit_security_lockdown.sql
-- Feature: AUDIT-01 Emergency Supabase Security & License Purge
--
-- 1. Revoke public/anon/authenticated execution on administrative ingest and gateway RPCs:
--    - public.ingest_lexical_formations_batch_v1(jsonb)
--    - public.ingest_quarantined_records_batch_v1(jsonb)
--    - public.call_corpus_rpc_v1(text, jsonb)
-- 2. Grant execution exclusively to service_role.
-- 3. Provide bible_internal.call_corpus_rpc_v1 with operation allowlist for internal SQL callers.
-- 4. Drop unauthenticated public.test_guard_probe test artifact.
-- 5. Purge restricted license-gated macula-hebrew semantic_frame values from public.syntax_nodes (edition_id = 11).
-- 6. Add covering B-tree indexes on unindexed foreign keys across retained tables.
-- ============================================================================

-- 1. Administrative Ingest RPC Lockdown
REVOKE ALL ON FUNCTION public.ingest_lexical_formations_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_lexical_formations_batch_v1(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.ingest_quarantined_records_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_quarantined_records_batch_v1(jsonb) TO service_role;

-- 2. Hybrid Gateway Helper: Move execution to bible_internal with strict operation allowlist
CREATE OR REPLACE FUNCTION bible_internal.call_corpus_rpc_v1(
  p_operation text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url text;
  v_body text := coalesce(p_params, '{}'::jsonb)::text;
  v_status integer;
  v_content text;
  v_attempt integer;
BEGIN
  -- Strict operation validation: alphanumeric and underscores only, no path traversal
  IF p_operation IS NULL OR p_operation !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid corpus operation format: %', p_operation;
  END IF;

  v_url := 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev/v1/rpc/' || p_operation;

  FOR v_attempt IN 1..2 LOOP
    BEGIN
      PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '3000');
      PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '5000');

      SELECT h.status, h.content
      INTO v_status, v_content
      FROM extensions.http_post(v_url, v_body, 'application/json') h;

      IF v_status = 200 AND v_content IS NOT NULL THEN
        RETURN v_content::jsonb;
      END IF;

      -- Do not retry 4xx errors (client faults / not found)
      IF v_status >= 400 AND v_status < 500 THEN
        EXIT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_status := NULL;
      v_content := NULL;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$;

GRANT USAGE ON SCHEMA bible_internal TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bible_internal.call_corpus_rpc_v1(text, jsonb) TO anon, authenticated, service_role;

-- Lock down public.call_corpus_rpc_v1 so anonymous callers cannot invoke it via PostgREST
REVOKE ALL ON FUNCTION public.call_corpus_rpc_v1(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_corpus_rpc_v1(text, jsonb) TO service_role;

-- Update public.lookup_syntax_tree_v1 to use bible_internal.call_corpus_rpc_v1 with local table fallback
CREATE OR REPLACE FUNCTION public.lookup_syntax_tree_v1(
  p_verse_id integer,
  p_edition_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
  v_verse record;
BEGIN
  BEGIN
    v_remote := bible_internal.call_corpus_rpc_v1(
      'lookup_syntax_tree_v1',
      jsonb_strip_nulls(jsonb_build_object(
        'p_verse_id', p_verse_id,
        'p_edition_key', p_edition_key
      ))
    );
    IF v_remote IS NOT NULL THEN
      RETURN v_remote;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_remote := NULL;
  END;

  SELECT id, book, chapter, verse_nr INTO v_verse FROM public.verses WHERE id = p_verse_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'verse_not_found',
      'verse_id', p_verse_id,
      'has_syntax', false,
      'syntax_status', 'verse_not_found',
      'missing_syntax_reason', 'The requested verse_id does not exist in the canonical 66-book Bible index.'
    );
  END IF;

  RETURN jsonb_build_object(
    'verse_id', p_verse_id,
    'book', v_verse.book,
    'chapter', v_verse.chapter,
    'verse_nr', v_verse.verse_nr,
    'edition_key', p_edition_key,
    'has_syntax', false,
    'syntax_status', 'not_imported',
    'missing_syntax_reason', 'Macula syntax tree has not yet been imported for this verse.',
    'trees_count', 0,
    'nodes_count', 0,
    'edges_count', 0,
    'syntax_trees', '[]'::jsonb
  );
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
  EXCEPTION WHEN OTHERS THEN
    v_remote := NULL;
  END;

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

-- Update public.lookup_septuagint_passage_v1 to use bible_internal.call_corpus_rpc_v1 with fallback
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
  EXCEPTION WHEN OTHERS THEN
    v_remote := NULL;
  END;

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

-- 3. Drop unauthenticated public.test_guard_probe table
DROP TABLE IF EXISTS public.test_guard_probe;

-- 4. Purge restricted license-gated macula-hebrew semantic_frame values from public.syntax_nodes
UPDATE public.syntax_nodes
SET semantic_frame = NULL
WHERE edition_id = 11 AND semantic_frame IS NOT NULL;

-- 5. Covering B-tree indexes on unindexed foreign keys for retained tables
CREATE INDEX IF NOT EXISTS idx_book_aliases_book_id
  ON public.book_aliases(book_id);

CREATE INDEX IF NOT EXISTS idx_note_anchors_concept_id
  ON public.note_anchors(concept_id)
  WHERE concept_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_note_anchors_end_verse_id
  ON public.note_anchors(end_verse_id)
  WHERE end_verse_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_note_anchors_event_id
  ON public.note_anchors(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_note_anchors_place_id
  ON public.note_anchors(place_id)
  WHERE place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_author_composite
  ON public.notes(author_id, author_kind);

CREATE INDEX IF NOT EXISTS idx_notes_note_kind
  ON public.notes(note_kind);

CREATE INDEX IF NOT EXISTS idx_quarantined_evidence_records_edition
  ON public.quarantined_evidence_records(source_edition_id)
  WHERE source_edition_id IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS public.idx_book_aliases_book_id;
-- DROP INDEX IF EXISTS public.idx_note_anchors_concept_id;
-- DROP INDEX IF EXISTS public.idx_note_anchors_end_verse_id;
-- DROP INDEX IF EXISTS public.idx_note_anchors_event_id;
-- DROP INDEX IF EXISTS public.idx_note_anchors_place_id;
-- DROP INDEX IF EXISTS public.idx_notes_author_composite;
-- DROP INDEX IF EXISTS public.idx_notes_note_kind;
-- DROP INDEX IF EXISTS public.idx_quarantined_evidence_records_edition;
-- DROP FUNCTION IF EXISTS bible_internal.call_corpus_rpc_v1(text, jsonb);
-- GRANT EXECUTE ON FUNCTION public.ingest_lexical_formations_batch_v1(jsonb) TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.ingest_quarantined_records_batch_v1(jsonb) TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.call_corpus_rpc_v1(text, jsonb) TO anon, authenticated;
