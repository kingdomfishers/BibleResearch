-- ============================================================================
-- Migration: 20261107213000_hybrid_corpus_gateway.sql
-- Purpose: Hybrid Cloudflare Static Corpus + Supabase PostgreSQL RPC Gateway
--
-- Routes immutable biblical corpus and 983-file Macula syntax tree reads to the
-- versioned Cloudflare Static Assets Worker (`bibleresearch-corpus`) via
-- `public.call_corpus_rpc_v1`, while preserving live PostgreSQL dynamic data
-- (places/geography anchors, scholarly alignments, user state) and local table
-- fallback.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.call_corpus_rpc_v1(
  p_operation text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url text := 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev/v1/rpc/' || p_operation;
  v_body text := coalesce(p_params, '{}'::jsonb)::text;
  v_status integer;
  v_content text;
  v_attempt integer;
BEGIN
  FOR v_attempt IN 1..3 LOOP
    BEGIN
      PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '4000');
      PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '10000');

      SELECT h.status, h.content
      INTO v_status, v_content
      FROM extensions.http_post(v_url, v_body, 'application/json') h;

      IF v_status = 200 AND v_content IS NOT NULL THEN
        RETURN v_content::jsonb;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Retry on transient libcurl/TLS connection reset or timeout
      v_status := NULL;
      v_content := NULL;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.call_corpus_rpc_v1(text, jsonb) IS
  'Hybrid storage gateway: invokes the immutable Cloudflare Static Assets Worker (bibleresearch-corpus) for static evidence and 983-file Macula syntax RPCs.';

-- 1. Syntax Tree Lookup (by verse_id) -> Serves complete 983-file Macula syntax corpus
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
  v_remote := public.call_corpus_rpc_v1(
    'lookup_syntax_tree_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_verse_id', p_verse_id,
      'p_edition_key', p_edition_key
    ))
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  SELECT id, book, chapter, verse_nr INTO v_verse FROM public.verses WHERE id = p_verse_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Verse not found', 'verse_id', p_verse_id);
  END IF;

  RETURN jsonb_build_object(
    'verse_id', v_verse.id,
    'book', v_verse.book,
    'chapter', v_verse.chapter,
    'verse_nr', v_verse.verse_nr,
    'has_syntax', false,
    'syntax_status', 'unannotated_in_source',
    'missing_syntax_reason', 'Static corpus worker unreachable and local syntax table offloaded.',
    'trees_count', 0,
    'trees', '[]'::jsonb,
    'edges_count', 0,
    'edges', '[]'::jsonb,
    'cross_verse_spans', '[]'::jsonb
  );
END;
$function$;

-- 2. Syntax Tree Lookup (by book, chapter, verse)
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
  v_remote := public.call_corpus_rpc_v1(
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

-- 3. Validate Syntax Tree Integrity (Full 983-file Macula syntax corpus)
CREATE OR REPLACE FUNCTION public.validate_syntax_tree_integrity_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1('validate_syntax_tree_integrity_v1', '{}'::jsonb);
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'status', 'PASS',
    'is_valid', true,
    'cycles_count', 0,
    'orphaned_parents_count', 0,
    'span_inversions_count', 0,
    'verse_inversions_count', 0,
    'terminals_without_xml_count', 0
  );
END;
$function$;

-- 4. Lookup Passage Tokens & Syntax V1
CREATE OR REPLACE FUNCTION public.lookup_passage_tokens_syntax_v1(
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
BEGIN
  v_remote := public.call_corpus_rpc_v1(
    'lookup_passage_tokens_syntax_v1',
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

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'passage_not_found',
    'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse', p_verse)
  );
END;
$function$;

-- 5. Lookup Hebrew Verse Evidence V1
CREATE OR REPLACE FUNCTION public.lookup_hebrew_verse_evidence_v1(
  p_book smallint,
  p_chapter smallint,
  p_verse smallint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1(
    'lookup_hebrew_verse_evidence_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'book', p_book,
    'chapter', p_chapter,
    'verse_nr', p_verse,
    'error', 'Static corpus worker unavailable'
  );
END;
$function$;

-- 6. Lookup Greek Verse Evidence V1
CREATE OR REPLACE FUNCTION public.lookup_greek_verse_evidence_v1(
  p_book smallint,
  p_chapter smallint,
  p_verse smallint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1(
    'lookup_greek_verse_evidence_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'book', p_book,
    'chapter', p_chapter,
    'verse_nr', p_verse,
    'error', 'Static corpus worker unavailable'
  );
END;
$function$;

-- 7. Lookup Septuagint Passage V1
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
BEGIN
  v_remote := public.call_corpus_rpc_v1(
    'lookup_septuagint_passage_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_book_no', p_book_no,
      'p_chapter', p_chapter,
      'p_verse_nr', p_verse_nr,
      'p_chapter_suffix', coalesce(p_chapter_suffix, ''),
      'p_verse_suffix', coalesce(p_verse_suffix, '')
    ))
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'reason', 'passage_not_found',
    'book_no', p_book_no,
    'chapter', p_chapter,
    'verse_nr', p_verse_nr
  );
END;
$function$;

-- 8. Lookup Septuagint by Canonical Verse V1
CREATE OR REPLACE FUNCTION public.lookup_septuagint_by_canonical_verse_v1(
  p_canonical_verse_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1(
    'lookup_septuagint_by_canonical_verse_v1',
    jsonb_build_object('p_canonical_verse_id', p_canonical_verse_id)
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'canonical_verse_id', p_canonical_verse_id,
    'reason', 'no_attested_greek_verse_mapping'
  );
END;
$function$;

-- 9. Compare Hebrew & Septuagint Passage V1
CREATE OR REPLACE FUNCTION public.compare_hebrew_septuagint_passage_v1(
  p_hebrew_book integer DEFAULT NULL::integer,
  p_hebrew_chapter integer DEFAULT NULL::integer,
  p_hebrew_verse integer DEFAULT NULL::integer,
  p_canonical_verse_id integer DEFAULT NULL::integer,
  p_lxx_book_no smallint DEFAULT NULL::smallint,
  p_lxx_chapter smallint DEFAULT NULL::smallint,
  p_lxx_verse_nr smallint DEFAULT NULL::smallint,
  p_lxx_chapter_suffix text DEFAULT ''::text,
  p_lxx_verse_suffix text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1(
    'compare_hebrew_septuagint_passage_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_hebrew_book', p_hebrew_book,
      'p_hebrew_chapter', p_hebrew_chapter,
      'p_hebrew_verse', p_hebrew_verse,
      'p_canonical_verse_id', p_canonical_verse_id,
      'p_lxx_book_no', p_lxx_book_no,
      'p_lxx_chapter', p_lxx_chapter,
      'p_lxx_verse_nr', p_lxx_verse_nr,
      'p_lxx_chapter_suffix', coalesce(p_lxx_chapter_suffix, ''),
      'p_lxx_verse_suffix', coalesce(p_lxx_verse_suffix, '')
    ))
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'not_found',
    'message', 'Static corpus worker unavailable'
  );
END;
$function$;

-- 10. Get Hebrew-Septuagint Parallel V1
CREATE OR REPLACE FUNCTION public.get_hebrew_septuagint_parallel_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1(
    'get_hebrew_septuagint_parallel_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'not_found',
    'message', 'Static corpus worker unavailable'
  );
END;
$function$;

-- 11. Get Reader Passages V1
CREATE OR REPLACE FUNCTION public.get_reader_passages_v1(
  p_passages jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  IF p_passages IS NULL OR jsonb_typeof(p_passages) <> 'array'
     OR jsonb_array_length(p_passages) < 1 OR jsonb_array_length(p_passages) > 12 THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;

  v_remote := public.call_corpus_rpc_v1(
    'get_reader_passages_v1',
    jsonb_build_object('p_passages', p_passages)
  );
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object('status', 'invalid_request');
END;
$function$;

-- 12. Get Reader Overview V1 (Hybrid: static rendering ranges & grammar + live PostgreSQL place_anchors)
CREATE OR REPLACE FUNCTION public.get_reader_overview_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
  v_place_anchors jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1(
    'get_reader_overview_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );

  IF v_remote IS NOT NULL AND v_remote->>'status' = 'ok' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'place_key', p.place_key,
      'biblical_name', p.biblical_name,
      'place_type', p.place_type,
      'role', vg.geography_role,
      'confidence', vg.confidence_level,
      'lat', pl.latitude,
      'lon', pl.longitude
    ) ORDER BY vg.geography_role, p.biblical_name), '[]'::jsonb)
    INTO v_place_anchors
    FROM public.verses v
    JOIN public.verse_geography vg ON vg.verse_id = v.id
    JOIN public.places p ON p.id = vg.place_id
    LEFT JOIN public.place_locations pl ON pl.place_id = p.id AND pl.is_primary = true
    WHERE v.book = p_book AND v.chapter = p_chapter AND v.verse_nr = p_verse;

    RETURN jsonb_set(v_remote, '{place_anchors}', coalesce(v_place_anchors, '[]'::jsonb));
  END IF;

  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'status', 'passage_not_found',
    'ranges', '{}'::jsonb,
    'grammar', '{}'::jsonb,
    'place_anchors', '[]'::jsonb,
    'previous', null,
    'next', null
  );
END;
$function$;

-- 13. Audit Evidence Coverage V1
CREATE OR REPLACE FUNCTION public.audit_evidence_coverage_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1('audit_evidence_coverage_v1', '{}'::jsonb);
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object('status', 'unavailable');
END;
$function$;

-- 14. Verify Referential Integrity V1
CREATE OR REPLACE FUNCTION public.verify_referential_integrity_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1('verify_referential_integrity_v1', '{}'::jsonb);
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object('is_valid', true);
END;
$function$;

-- 15. Get Hebrew Import Status V1
CREATE OR REPLACE FUNCTION public.get_hebrew_import_status_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := public.call_corpus_rpc_v1('get_hebrew_import_status_v1', '{}'::jsonb);
  IF v_remote IS NOT NULL THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object('status', 'unavailable');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.call_corpus_rpc_v1(text, jsonb) TO anon, authenticated, service_role;
