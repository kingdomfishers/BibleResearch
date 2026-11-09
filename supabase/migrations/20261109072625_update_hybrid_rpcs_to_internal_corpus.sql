-- ============================================================================
-- Migration: 20261109072625_update_hybrid_rpcs_to_internal_corpus.sql
-- Feature: AUDIT-01 Route all hybrid SQL RPCs to bible_internal.call_corpus_rpc_v1
-- ============================================================================

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

CREATE OR REPLACE FUNCTION public.lookup_syntax_tree_v1(
  p_verse_id integer,
  p_edition_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
  v_verse record;
BEGIN
  IF p_verse_id IS NULL OR p_verse_id <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'invalid_request',
      'error', 'invalid_verse_id',
      'verse_id', p_verse_id,
      'has_syntax', false
    );
  END IF;

  SELECT id, book, chapter, verse_nr INTO v_verse FROM public.verses WHERE id = p_verse_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'passage_not_found',
      'error', 'Verse not found',
      'verse_id', p_verse_id,
      'has_syntax', false,
      'syntax_status', 'passage_not_found'
    );
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_syntax_tree_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_verse_id', p_verse_id,
      'p_edition_key', p_edition_key
    ))
  );

  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'has_syntax' OR v_remote ? 'error') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'verse_id', v_verse.id,
    'book', v_verse.book,
    'chapter', v_verse.chapter,
    'verse_nr', v_verse.verse_nr,
    'has_syntax', false,
    'syntax_status', 'unavailable',
    'missing_syntax_reason', 'Static corpus worker unreachable or returned malformed payload.'
  );
END;
$function$;

-- 2. Syntax Tree Lookup (by book, chapter, verse) - Fail Closed on Worker Outage


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
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
  v_verse_id integer;
BEGIN
  IF p_book IS NULL OR p_chapter IS NULL OR p_verse IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'invalid_request',
      'error', 'invalid_coordinates',
      'book', p_book,
      'chapter', p_chapter,
      'verse_nr', p_verse,
      'has_syntax', false,
      'syntax_status', 'invalid_request'
    );
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

  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_syntax_tree_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_book', p_book,
      'p_chapter', p_chapter,
      'p_verse', p_verse,
      'p_edition_key', p_edition_key
    ))
  );

  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'has_syntax' OR v_remote ? 'error') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'verse_id', v_verse_id,
    'book', p_book,
    'chapter', p_chapter,
    'verse_nr', p_verse,
    'has_syntax', false,
    'syntax_status', 'unavailable',
    'missing_syntax_reason', 'Static corpus worker unreachable or returned malformed payload.'
  );
END;
$function$;

-- 3. Validate Syntax Tree Integrity V1 - Strictly Fail Closed


CREATE OR REPLACE FUNCTION public.validate_syntax_tree_integrity_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1('validate_syntax_tree_integrity_v1', '{}'::jsonb);

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR NOT (v_remote ? 'is_valid') THEN
    RETURN jsonb_build_object(
      'status', 'FAIL',
      'is_valid', false,
      'error', 'static_corpus_unavailable',
      'failure_reasons', jsonb_build_array('Static corpus worker unreachable or returned malformed integrity payload')
    );
  END IF;

  IF coalesce((v_remote->>'is_valid')::boolean, false) = false OR coalesce(v_remote->>'status', 'FAIL') <> 'PASS' THEN
    RETURN v_remote || jsonb_build_object('status', 'FAIL', 'is_valid', false);
  END IF;

  RETURN v_remote;
END;
$function$;

-- 4. Verify Referential Integrity V1 - Strictly Fail Closed + Live PostgreSQL Constraint Probes


CREATE OR REPLACE FUNCTION public.verify_referential_integrity_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
  v_homographs_h1254 integer;
  v_homographs_h5869 integer;
  v_multi_etym integer;
  v_chk_synonymy boolean;
  v_chk_root_kind boolean;
  v_chk_self_rel boolean;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1('verify_referential_integrity_v1', '{}'::jsonb);

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR NOT (v_remote ? 'is_valid') THEN
    RETURN jsonb_build_object(
      'schema_version', '1.0.0',
      'status', 'FAIL',
      'is_valid', false,
      'error', 'static_corpus_unavailable',
      'failure_reasons', jsonb_build_array('Static corpus worker unreachable or returned malformed referential integrity payload')
    );
  END IF;

  IF coalesce((v_remote->>'is_valid')::boolean, false) = false OR coalesce(v_remote->>'status', 'FAIL') NOT IN ('ok', 'PASS') THEN
    RETURN v_remote || jsonb_build_object('status', 'FAIL', 'is_valid', false);
  END IF;

  -- Live PostgreSQL constraint & homograph verification
  SELECT count(*)::integer INTO v_homographs_h1254 FROM public.lexemes WHERE extended_strongs ~* '^H1254[a-z]?$';
  SELECT count(*)::integer INTO v_homographs_h5869 FROM public.lexemes WHERE extended_strongs ~* '^H5869[a-z]?$';
  SELECT count(*)::integer INTO v_multi_etym FROM (
    SELECT lemma_id FROM public.lemma_root_links GROUP BY lemma_id HAVING count(*) > 1
  ) sub;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_lemma_root_links_no_synonymy'
  ) INTO v_chk_synonymy;
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_lexical_roots_kind'
  ) INTO v_chk_root_kind;
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_entity_relationships_no_self_ref'
  ) INTO v_chk_self_rel;

  IF NOT (v_chk_synonymy AND v_chk_root_kind AND v_chk_self_rel) OR v_homographs_h1254 < 2 OR v_homographs_h5869 < 2 THEN
    RETURN v_remote || jsonb_build_object(
      'status', 'FAIL',
      'is_valid', false,
      'error', 'postgres_constraint_or_homograph_check_failed'
    );
  END IF;

  RETURN v_remote;
END;
$function$;

-- 5. Audit Evidence Coverage V1 - Fail Closed


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

-- 6. Get Hebrew Import Status V1 - Fail Closed


CREATE OR REPLACE FUNCTION public.get_hebrew_import_status_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1('get_hebrew_import_status_v1', '{}'::jsonb);
  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', 'FAIL') = 'FAIL' THEN
    RETURN jsonb_build_object(
      'status', 'FAIL',
      'is_valid', false,
      'error', 'static_corpus_unavailable'
    );
  END IF;
  RETURN v_remote;
END;
$function$;

-- 7. Lookup Passage Tokens & Syntax V1 - Fail Closed


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
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  IF p_book IS NULL OR p_chapter IS NULL OR p_verse IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse', p_verse)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.verses v WHERE v.book = p_book AND v.chapter = p_chapter AND v.verse_nr = p_verse
  ) THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'passage_not_found',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse', p_verse)
    );
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_passage_tokens_syntax_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_book', p_book,
      'p_chapter', p_chapter,
      'p_verse', p_verse,
      'p_edition_key', p_edition_key
    ))
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'status') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse', p_verse)
  );
END;
$function$;

-- 8. Lookup Hebrew Verse Evidence V1 - Fail Closed


CREATE OR REPLACE FUNCTION public.lookup_hebrew_verse_evidence_v1(
  p_book smallint,
  p_chapter smallint,
  p_verse smallint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_hebrew_verse_evidence_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'found') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'status', 'unavailable',
    'book', p_book,
    'chapter', p_chapter,
    'verse_nr', p_verse,
    'error', 'static_corpus_unavailable'
  );
END;
$function$;

-- 9. Lookup Greek Verse Evidence V1 - Fail Closed


CREATE OR REPLACE FUNCTION public.lookup_greek_verse_evidence_v1(
  p_book smallint,
  p_chapter smallint,
  p_verse smallint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_greek_verse_evidence_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'found') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'status', 'unavailable',
    'book', p_book,
    'chapter', p_chapter,
    'verse_nr', p_verse,
    'error', 'static_corpus_unavailable'
  );
END;
$function$;

-- 10. Lookup Septuagint Passage V1 - Fail Closed


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
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_septuagint_passage_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_book_no', p_book_no,
      'p_chapter', p_chapter,
      'p_verse_nr', p_verse_nr,
      'p_chapter_suffix', coalesce(p_chapter_suffix, ''),
      'p_verse_suffix', coalesce(p_verse_suffix, '')
    ))
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'found') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'status', 'unavailable',
    'reason', 'static_corpus_unavailable',
    'error', 'static_corpus_unavailable',
    'book_no', p_book_no,
    'chapter', p_chapter,
    'verse_nr', p_verse_nr
  );
END;
$function$;

-- 11. Lookup Septuagint by Canonical Verse V1 - Fail Closed


CREATE OR REPLACE FUNCTION public.lookup_septuagint_by_canonical_verse_v1(
  p_canonical_verse_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'lookup_septuagint_by_canonical_verse_v1',
    jsonb_build_object('p_canonical_verse_id', p_canonical_verse_id)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'found') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'found', false,
    'status', 'unavailable',
    'canonical_verse_id', p_canonical_verse_id,
    'reason', 'static_corpus_unavailable',
    'error', 'static_corpus_unavailable'
  );
END;
$function$;

-- 12. Compare Hebrew & Septuagint Passage V1 - Fail Closed


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
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
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
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'status') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'message', 'Static corpus worker unavailable'
  );
END;
$function$;

-- 13. Get Hebrew-Septuagint Parallel V1 - Fail Closed


CREATE OR REPLACE FUNCTION public.get_hebrew_septuagint_parallel_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_hebrew_septuagint_parallel_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'status') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'message', 'Static corpus worker unavailable'
  );
END;
$function$;

-- 14. Get Reader Passages V1 - Fail Closed


CREATE OR REPLACE FUNCTION public.get_reader_passages_v1(
  p_passages jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_remote jsonb;
BEGIN
  IF p_passages IS NULL OR jsonb_typeof(p_passages) <> 'array'
     OR jsonb_array_length(p_passages) < 1 OR jsonb_array_length(p_passages) > 12 THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_reader_passages_v1',
    jsonb_build_object('p_passages', p_passages)
  );
  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' AND (v_remote ? 'status') THEN
    RETURN v_remote;
  END IF;

  RETURN jsonb_build_object(
    'status', 'unavailable',
    'error', 'static_corpus_unavailable',
    'passages', '[]'::jsonb
  );
END;
$function$;

-- 15. Get Reader Overview V1 (Problem 1 Fix: live place_anchors schema + ranking + publication filter + fail-closed)


CREATE OR REPLACE FUNCTION public.get_reader_overview_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_verse record;
  v_remote jsonb;
  v_place_anchors jsonb;
BEGIN
  IF p_book IS NULL OR p_chapter IS NULL OR p_verse IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'invalid_request',
      'ranges', '{}'::jsonb,
      'grammar', '{}'::jsonb,
      'place_anchors', '[]'::jsonb,
      'previous', null,
      'next', null
    );
  END IF;

  SELECT id, word_ids INTO v_verse
  FROM public.verses
  WHERE book = p_book AND chapter = p_chapter AND verse_nr = p_verse;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'passage_not_found',
      'ranges', '{}'::jsonb,
      'grammar', '{}'::jsonb,
      'place_anchors', '[]'::jsonb,
      'previous', null,
      'next', null
    );
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_reader_overview_v1',
    jsonb_build_object('p_book', p_book, 'p_chapter', p_chapter, 'p_verse', p_verse)
  );

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'ranges', '{}'::jsonb,
      'grammar', '{}'::jsonb,
      'place_anchors', '[]'::jsonb,
      'previous', null,
      'next', null
    );
  END IF;

  WITH candidate_anchors AS (
    SELECT
      u.ord::integer AS word_position,
      p.place_key,
      p.biblical_name AS name,
      p.biblical_name,
      p.place_type,
      vg.relationship_type,
      vg.relationship_type AS role,
      vg.resolution_tier,
      vg.confidence_level AS confidence,
      pl.latitude AS lat,
      pl.longitude AS lon,
      coalesce(pl.rank_order, 999) AS loc_rank,
      CASE
        WHEN w.strongs_nr = ANY(p.strongs_numbers) THEN 1
        WHEN EXISTS (
          SELECT 1 FROM unnest(p.strongs_numbers) sn
          WHERE upper(regexp_replace(sn, '^([HG])0*([0-9]+)[A-Za-z]*$', '\1\2')) = w.strongs_nr
        ) THEN 2
        WHEN cardinality(p.strongs_numbers) = 0
          AND w.grammar_code LIKE '%Np%'
          AND EXISTS (
            SELECT 1 FROM unnest(w.english_translations) et
            WHERE et ~* ('\m' || regexp_replace(regexp_replace(p.biblical_name, '\s+[0-9]+$', ''), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M')
          ) THEN 3
        WHEN cardinality(p.strongs_numbers) = 0
          AND w.grammar_code LIKE '%Np%'
          AND EXISTS (
            SELECT 1 FROM unnest(w.english_translations) et
            CROSS JOIN unnest(p.historical_names) hn
            WHERE length(hn) >= 3
              AND et ~* ('\m' || regexp_replace(hn, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M')
          ) THEN 4
        ELSE 99
      END AS match_tier
    FROM unnest(v_verse.word_ids) WITH ORDINALITY u(word_id, ord)
    JOIN public.words w ON w.id = u.word_id
    JOIN public.verse_geography vg ON vg.verse_id = v_verse.id AND vg.published = true
    JOIN public.places p ON p.id = vg.place_id AND p.published = true
    LEFT JOIN LATERAL (
      SELECT loc.latitude, loc.longitude, loc.rank_order
      FROM public.place_locations loc
      WHERE loc.place_id = p.id AND loc.published = true
      ORDER BY loc.is_alternative ASC, loc.rank_order ASC, loc.id ASC
      LIMIT 1
    ) pl ON true
  ),
  best_per_place AS (
    SELECT place_key, min(match_tier) AS best_tier
    FROM candidate_anchors
    WHERE match_tier < 99
    GROUP BY place_key
  ),
  anchor_rows AS (
    SELECT DISTINCT ON (ca.word_position, ca.place_key)
      ca.*
    FROM candidate_anchors ca
    JOIN best_per_place bp ON bp.place_key = ca.place_key AND ca.match_tier = bp.best_tier
    ORDER BY ca.word_position, ca.place_key, ca.match_tier ASC, ca.resolution_tier ASC, ca.loc_rank ASC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'word_position', ar.word_position,
    'place_key', ar.place_key,
    'name', ar.name,
    'biblical_name', ar.biblical_name,
    'place_type', ar.place_type,
    'relationship_type', ar.relationship_type,
    'role', ar.role,
    'resolution_tier', ar.resolution_tier,
    'confidence', ar.confidence,
    'lat', ar.lat,
    'lon', ar.lon
  ) ORDER BY ar.word_position ASC, ar.resolution_tier ASC, ar.loc_rank ASC, ar.name ASC, ar.place_key ASC), '[]'::jsonb)
  INTO v_place_anchors
  FROM anchor_rows ar;

  RETURN jsonb_set(v_remote, '{place_anchors}', coalesce(v_place_anchors, '[]'::jsonb));
END;
$function$;

-- 16. Get Reader Word V1 - Hybrid Offload (reads occurrences from static corpus + live words/lexemes from PostgreSQL)


CREATE OR REPLACE FUNCTION public.get_reader_word_v1(
  p_word_id integer,
  p_after integer DEFAULT 0,
  p_rendering text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '8s'
AS $function$
DECLARE
  v_word record;
  v_lexemes jsonb;
  v_remote jsonb;
BEGIN
  SELECT * INTO v_word FROM public.words WHERE id = p_word_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'word_not_found',
      'word', null,
      'lexemes', '[]'::jsonb,
      'token_total', 0,
      'verse_total', 0,
      'scope', 'Base Strong’s group; observed STEP occurrence renderings; token senses are not assigned.',
      'occurrences', '[]'::jsonb,
      'next_cursor', null
    );
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]'::jsonb)
  INTO v_lexemes
  FROM public.lexemes l
  WHERE l.base_strongs = v_word.strongs_nr;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_reader_word_v1',
    jsonb_strip_nulls(jsonb_build_object(
      'p_word_id', p_word_id,
      'p_after', greatest(coalesce(p_after, 0), 0),
      'p_rendering', p_rendering
    ))
  );

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'word', to_jsonb(v_word),
      'lexemes', v_lexemes,
      'token_total', 0,
      'verse_total', 0,
      'scope', 'Base Strong’s group; observed STEP occurrence renderings; token senses are not assigned.',
      'occurrences', '[]'::jsonb,
      'next_cursor', null
    );
  END IF;

  RETURN v_remote || jsonb_build_object(
    'word', to_jsonb(v_word),
    'lexemes', v_lexemes
  );
END;
$function$;

-- 17. Drop Foreign Key from word_translation_choices -> verse_translation_sources
--     (since verse_translation_sources is offloaded to Cloudflare Static Assets,
--      and validate_word_translation_choice_v1 enforces verse_id/word_position/word_id integrity against public.verses)
ALTER TABLE public.word_translation_choices
  DROP CONSTRAINT IF EXISTS word_translation_choices_verse_id_word_position_word_id_fkey;

-- 18. Validate Word Translation Choice V1 (Trigger function independent of verse_translation_sources)


CREATE OR REPLACE FUNCTION public.validate_word_translation_choice_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_verse record;
  v_remote jsonb;
  v_source_text text;
BEGIN
  SELECT id, word_ids INTO v_verse
  FROM public.verses
  WHERE id = new.verse_id;

  IF NOT FOUND
     OR new.word_position IS NULL
     OR new.word_position < 1
     OR new.word_position > coalesce(cardinality(v_verse.word_ids), 0)
     OR v_verse.word_ids[new.word_position] IS DISTINCT FROM new.word_id THEN
    RAISE EXCEPTION 'Translation is not an available rendering for this occurrence' USING errcode = '22023';
  END IF;

  -- Check against english_translations array on public.words first (fast local path)
  IF EXISTS (
    SELECT 1 FROM public.words w
    WHERE w.id = new.word_id
      AND (
        new.english = ANY(coalesce(w.english_translations, '{}'))
        OR btrim(new.english) = ANY(SELECT btrim(x) FROM unnest(coalesce(w.english_translations, '{}')) x)
      )
  ) THEN
    new.updated_at := now();
    RETURN new;
  END IF;

  -- Also check attested source_english from static corpus worker
  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', jsonb_build_array(new.verse_id))
  );

  SELECT elem->>'source_english'
  INTO v_source_text
  FROM jsonb_array_elements(coalesce(v_remote #> ARRAY['verses', new.verse_id::text], '[]'::jsonb)) elem
  WHERE (elem->>'word_position')::integer = new.word_position
    AND (elem->>'word_id')::integer = new.word_id
  LIMIT 1;

  IF v_source_text IS NULL OR NOT (new.english = ANY(public.translation_options_v1(new.word_id, v_source_text))) THEN
    RAISE EXCEPTION 'Translation is not an available rendering for this occurrence' USING errcode = '22023';
  END IF;

  new.updated_at := now();
  RETURN new;
END;
$function$;

-- 19. Save Word Translation V1 (Independent of verse_translation_sources)


CREATE OR REPLACE FUNCTION public.save_word_translation_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer,
  p_word_position integer,
  p_word_id integer,
  p_english text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_verse record;
  v_remote jsonb;
  v_source_english text;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'A reader session is required to save translations' USING errcode = '42501';
  END IF;

  SELECT id, word_ids INTO v_verse
  FROM public.verses v
  WHERE v.book = p_book AND v.chapter = p_chapter AND v.verse_nr = p_verse
    AND p_word_position >= 1
    AND p_word_position <= coalesce(cardinality(v.word_ids), 0)
    AND v.word_ids[p_word_position] = p_word_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The verse occurrence does not match the requested word' USING errcode = '22023';
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', jsonb_build_array(v_verse.id))
  );

  SELECT elem->>'source_english'
  INTO v_source_english
  FROM jsonb_array_elements(coalesce(v_remote #> ARRAY['verses', v_verse.id::text], '[]'::jsonb)) elem
  WHERE (elem->>'word_position')::integer = p_word_position
    AND (elem->>'word_id')::integer = p_word_id
  LIMIT 1;

  IF v_source_english IS NULL THEN
    SELECT coalesce(w.english_translations[1], '') INTO v_source_english
    FROM public.words w WHERE w.id = p_word_id;
  END IF;

  IF p_english IS NULL THEN
    DELETE FROM public.word_translation_choices
    WHERE owner_id = v_owner
      AND verse_id = v_verse.id
      AND word_position = p_word_position;
  ELSE
    IF NOT (p_english = ANY(public.translation_options_v1(p_word_id, v_source_english))) THEN
      RAISE EXCEPTION 'Translation is not an available rendering for this occurrence' USING errcode = '22023';
    END IF;
    INSERT INTO public.word_translation_choices(owner_id, verse_id, word_position, word_id, english)
    VALUES (v_owner, v_verse.id, p_word_position, p_word_id, p_english)
    ON CONFLICT (owner_id, verse_id, word_position) DO UPDATE
      SET english = excluded.english, word_id = excluded.word_id;
  END IF;

  RETURN jsonb_build_object(
    'saved', p_english IS NOT NULL,
    'english', coalesce(p_english, v_source_english),
    'source_english', v_source_english
  );
END;
$function$;

-- 20. Get Verse Translations V1 (Hybrid: static source_english/source_ref from Worker + live words & word_translation_choices)


CREATE OR REPLACE FUNCTION public.get_verse_translations_v1(
  p_book integer,
  p_chapter integer,
  p_verse integer
)
RETURNS TABLE(
  word_position integer,
  word_id integer,
  original_word text,
  transliteration text,
  strongs_nr character varying,
  grammar_code character varying,
  primary_english text,
  millennium smallint,
  source_english text,
  english_translations text[],
  selected_english text,
  has_choice boolean,
  source_ref text
)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_verse_id integer;
  v_remote jsonb;
  v_vts jsonb := '[]'::jsonb;
BEGIN
  SELECT v.id INTO v_verse_id
  FROM public.verses v
  WHERE v.book = p_book AND v.chapter = p_chapter AND v.verse_nr = p_verse;

  IF v_verse_id IS NULL THEN
    RETURN;
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', jsonb_build_array(v_verse_id))
  );

  IF v_remote IS NOT NULL AND jsonb_typeof(v_remote) = 'object' THEN
    v_vts := coalesce(v_remote #> ARRAY['verses', v_verse_id::text], '[]'::jsonb);
  END IF;

  RETURN QUERY
  WITH remote_vts AS (
    SELECT
      (elem->>'word_position')::integer AS word_position,
      (elem->>'word_id')::integer AS word_id,
      elem->>'source_english' AS source_english,
      elem->>'source_ref' AS source_ref
    FROM jsonb_array_elements(v_vts) elem
  )
  SELECT
    u.ord::integer,
    w.id,
    w.original_word,
    w.transliteration,
    w.strongs_nr,
    w.grammar_code,
    coalesce(c.english, s.source_english, w.english_translations[1]),
    v.millennium,
    s.source_english,
    public.translation_options_v1(w.id, s.source_english),
    c.english,
    c.owner_id IS NOT NULL,
    s.source_ref
  FROM public.verses v
  CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY u(word_id, ord)
  JOIN public.words w ON w.id = u.word_id
  LEFT JOIN remote_vts s
    ON s.word_position = u.ord AND s.word_id = w.id
  LEFT JOIN public.word_translation_choices c
    ON c.owner_id = (SELECT auth.uid())
   AND c.verse_id = v.id
   AND c.word_position = u.ord
   AND c.word_id = w.id
  WHERE v.id = v_verse_id
  ORDER BY u.ord;
END;
$function$;

-- 21. Get Word Formation V1 (Uses get_word_form_lemmas_batch_v1 for p_word_id component candidates)


CREATE OR REPLACE FUNCTION public.get_word_formation_v1(
  p_query text DEFAULT NULL::text,
  p_word_id integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '8s'
AS $function$
DECLARE
  v_q text := btrim(coalesce(p_query,''));
  v_base text;
  v_stripped text;
  v_norm text;
  v_ids bigint[];
  v_total integer;
  v_selected integer;
  v_lemmas jsonb;
  v_formations jsonb;
  v_roots jsonb;
  v_relatives jsonb;
  v_connections jsonb;
  v_form_candidates jsonb := '[]'::jsonb;
  v_remote_wfl jsonb;
BEGIN
  IF p_word_id IS NOT NULL AND p_word_id <= 0 THEN
    RETURN jsonb_build_object('schema_version',1,'status','invalid_request','message','p_word_id must be positive');
  END IF;
  IF p_word_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.words w WHERE w.id = p_word_id) THEN
      RETURN jsonb_build_object('schema_version',1,'status','word_id_not_found');
    END IF;
    IF v_q = '' THEN
      SELECT w.strongs_nr INTO v_q FROM public.words w WHERE w.id = p_word_id;
    END IF;
  END IF;
  IF v_q = '' OR length(v_q) > 128 THEN
    RETURN jsonb_build_object('schema_version',1,'status','invalid_request','message','Provide p_query (1-128 characters), or a valid p_word_id.');
  END IF;
  v_base := CASE
    WHEN v_q ~* '^[HG]0*[0-9]+[A-Z]?$'
    THEN upper(regexp_replace(v_q,'^([HG])0*([0-9]+[A-Z]?)$','\1\2','i'))
    ELSE NULL END;
  v_stripped := regexp_replace(normalize(v_q,NFKD),'[֑-ׇ̀-ͯ]','','g');
  v_norm := translate(translate(v_stripped,'ךםןףץ','כמנפצ'),'ς','σ');

  WITH targets AS (
    SELECT l.id,
       CASE WHEN lower(l.lemma_key)=lower(v_q) OR lower(l.lemma_key)='lemma:'||lower(v_q) THEN 0
            WHEN v_base IS NOT NULL AND (l.base_strongs=v_base OR upper(regexp_replace(l.lemma_key,'^lemma:([HG])0*([0-9]+[A-Z]?)$','\1\2','i'))=v_base) THEN 1
            WHEN EXISTS (SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND upper(x.extended_strongs)=upper(v_q)) THEN 2
            WHEN l.lemma_script=v_q OR (v_stripped<>'' AND l.lemma_stripped=v_stripped) THEN 3
            WHEN (v_norm<>'' AND translate(translate(l.lemma_stripped,'ךםןףץ','כמנפצ'),'ς','σ')=v_norm) THEN 4
            ELSE 5 END priority
    FROM public.lemmas l
    WHERE (v_base IS NOT NULL AND (l.base_strongs=v_base OR upper(regexp_replace(l.lemma_key,'^lemma:([HG])0*([0-9]+[A-Z]?)$','\1\2','i'))=v_base))
       OR lower(l.lemma_key)=lower(v_q)
       OR lower(l.lemma_key)='lemma:'||lower(v_q)
       OR l.lemma_script=v_q
       OR (v_stripped<>'' AND l.lemma_stripped=v_stripped)
       OR (v_norm<>'' AND translate(translate(l.lemma_stripped,'ךםןףץ','כמנפצ'),'ς','σ')=v_norm)
       OR lower(l.transliteration)=lower(v_q)
       OR EXISTS (SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND upper(x.extended_strongs)=upper(v_q))
  ),
  ids AS (SELECT id FROM targets ORDER BY priority,id LIMIT 26)
  SELECT array_agg(id) INTO v_ids FROM ids;
  v_total := coalesce(cardinality(v_ids),0);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('schema_version',1,'status','not_found','query',v_q);
  END IF;
  IF v_total > 25 THEN v_ids := v_ids[1:25]; END IF;
  v_selected := cardinality(v_ids);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'lemma_id',l.id,'lemma_key',l.lemma_key,'language',l.language,
    'lemma_script',l.lemma_script,'lemma_stripped',l.lemma_stripped,
    'transliteration',l.transliteration,'base_strongs',l.base_strongs,
    'primary_pos',l.primary_pos,'homograph_tag',l.homograph_tag,
    'primary_lexeme_id',l.primary_lexeme_id,
    'primary_gloss',lx.primary_gloss,
    'source_record_id',l.source_record_id
  ) ORDER BY l.id),'[]'::jsonb)
  INTO v_lemmas
  FROM public.lemmas l LEFT JOIN public.lexemes lx ON lx.id=l.primary_lexeme_id
  WHERE l.id = ANY(v_ids);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'formation_id',f.id,'lemma_id',f.lemma_id,'analysis_key',f.analysis_key,
    'formation_type',f.formation_type,'whole_word_gloss',f.whole_word_gloss,
    'evidence_status',f.evidence_status,'evidence_note',f.evidence_note,
    'origin_mode',f.origin_mode,'review_status',f.review_status,
    'source',jsonb_build_object('title',f.source_title,'url',f.source_url,'record_id',f.source_record_id),
    'components',(
       SELECT coalesce(jsonb_agg(jsonb_build_object(
         'order',c.component_order,'surface_text',c.surface_text,
         'role',c.component_role,'semantic_contribution',c.semantic_contribution,
         'component_note',c.component_note,
         'lemma_id',cl.id,'lemma_key',cl.lemma_key,'base_strongs',cl.base_strongs,
         'original_lemma',cl.lemma_script,'transliteration',cl.transliteration,
         'lexeme_id',cx.id,'primary_gloss',cx.primary_gloss,
         'senses',(
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'sense_code',ss.sense_code,'short_gloss',ss.short_gloss,
              'source_attribution',ss.source_attribution
            ) ORDER BY ss.sense_order,ss.id),'[]'::jsonb)
            FROM (SELECT * FROM public.lexical_senses s WHERE s.lemma_id=cl.id ORDER BY s.sense_order,s.id LIMIT 5) ss
         )
       ) ORDER BY c.component_order),'[]'::jsonb)
       FROM public.lemma_components c
       LEFT JOIN public.lemmas cl ON cl.id=c.component_lemma_id
       LEFT JOIN public.lexemes cx ON cx.id=coalesce(c.component_lexeme_id,cl.primary_lexeme_id)
       WHERE c.formation_id=f.id
    )
  ) ORDER BY f.id),'[]'::jsonb)
  INTO v_formations FROM public.lexical_formations f WHERE f.lemma_id = ANY(v_ids);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'lemma_id',rl.lemma_id,'lemma_key',l.lemma_key,'root_id',r.id,'root_key',r.root_key,
    'root_script',r.root_script,'root_transliteration',r.transliteration,
    'root_kind',r.root_kind,'relation_type',rl.etymology_type,
    'implies_synonymy',false,'evidence_note',rl.evidence_note,
    'origin_mode',rl.origin_mode,'derivation_method',rl.derivation_method,
    'source_record_id',rl.source_record_id,'source_release_key',sr.release_key
  ) ORDER BY rl.lemma_id,r.root_key,rl.id),'[]'::jsonb)
  INTO v_roots
  FROM public.lemma_root_links rl
  JOIN public.lemmas l ON l.id=rl.lemma_id
  JOIN public.lexical_roots r ON r.id=rl.root_id
  LEFT JOIN public.source_releases sr ON sr.id=rl.source_release_id
  WHERE rl.lemma_id = ANY(v_ids);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'root_key',r.root_key,'relative_lemma_id',l.id,'relative_lemma_key',l.lemma_key,
    'base_strongs',l.base_strongs,'lemma_script',l.lemma_script,
    'transliteration',l.transliteration,'primary_gloss',lx.primary_gloss,
    'relation_type',related.etymology_type,'source_record_id',related.source_record_id
  ) ORDER BY r.root_key, l.id),'[]'::jsonb)
  INTO v_relatives FROM (
    SELECT DISTINCT rl.root_id FROM public.lemma_root_links rl WHERE rl.lemma_id = ANY(v_ids)
  ) roots
  JOIN public.lexical_roots r ON r.id=roots.root_id
  JOIN public.lemma_root_links related ON related.root_id=r.id
  JOIN public.lemmas l ON l.id=related.lemma_id
  LEFT JOIN public.lexemes lx ON lx.id=l.primary_lexeme_id
  WHERE NOT (l.id = ANY(v_ids));

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'connection_id',c.id,'source_lemma_id',c.subject_lemma_id,'target_lemma_id',c.target_lemma_id,
    'source_lemma_key',sl.lemma_key,'target_lemma_key',tl.lemma_key,
    'source_strongs',sl.base_strongs,'target_strongs',tl.base_strongs,
    'relation_type',c.relation_type,'evidence_status',c.evidence_status,
    'evidence_note',c.evidence_note,'passage_reference',c.passage_reference,
    'source_title',c.source_title,'source_url',c.source_url,'derivation_method',c.derivation_method
  ) ORDER BY c.id),'[]'::jsonb)
  INTO v_connections
  FROM public.lexical_connections c
  JOIN public.lemmas sl ON sl.id=c.subject_lemma_id
  JOIN public.lemmas tl ON tl.id=c.target_lemma_id
  WHERE c.subject_lemma_id = ANY(v_ids) OR c.target_lemma_id = ANY(v_ids);

  IF p_word_id IS NOT NULL THEN
    v_remote_wfl := bible_internal.call_corpus_rpc_v1(
      'get_word_form_lemmas_batch_v1',
      jsonb_build_object('p_word_ids', jsonb_build_array(p_word_id))
    );
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'component_order', (elem->>'component_order')::smallint,
      'morpheme_role', elem->>'morpheme_role',
      'surface', elem->>'morpheme_surface',
      'gloss', elem->>'morpheme_gloss',
      'grammar_code', elem->>'grammar_code',
      'lemma_id', (elem->>'lemma_id')::bigint,
      'lexeme_id', l.primary_lexeme_id,
      'observed_token_count', (elem->>'observed_token_count')::integer,
      'is_context_ambiguous', coalesce((elem->>'is_context_ambiguous')::boolean, false),
      'source_record_id', elem->>'source_record_id'
    ) ORDER BY (elem->>'component_order')::smallint, (elem->>'id')::bigint), '[]'::jsonb)
    INTO v_form_candidates
    FROM (
      SELECT elem
      FROM jsonb_array_elements(coalesce(v_remote_wfl #> ARRAY['words', p_word_id::text, 'word_form_lemmas'], '[]'::jsonb)) elem
      ORDER BY (elem->>'component_order')::smallint, (elem->>'id')::bigint
      LIMIT 30
    ) sub
    LEFT JOIN public.lemmas l ON l.id = (sub.elem->>'lemma_id')::bigint;
  END IF;

  RETURN jsonb_build_object(
    'schema_version',1,'status','ok','query',v_q,'requested_word_id',p_word_id,
    'identity_scope','disambiguated_lemmas',
    'needs_disambiguation',v_total>1,'matched_lemmas',v_lemmas,
    'lexical_formations',v_formations,'documented_roots',v_roots,
    'root_relatives',v_relatives,'other_connections',v_connections,
    'word_form_component_candidates',v_form_candidates,
    'coverage',jsonb_build_object(
      'selected_lemma_count',v_selected,'complete',v_total<=25,
      'roots_attested_for_every_lemma',(
        SELECT NOT EXISTS (SELECT 1 FROM unnest(v_ids) x(lemma_id)
          WHERE NOT EXISTS(SELECT 1 FROM public.lemma_root_links r WHERE r.lemma_id=x.lemma_id))
      ),
      'token_morphology_scope','word-form candidates, not uniquely disambiguated verse-token morphemes',
      'missing_data_not_evidence_of_absence',true,
      'root_is_not_a_meaning',true,'shared_root_implies_synonymy',false,
      'orthographic_similarity_proves_derivation',false
    )
  );
END;
$function$;

-- 22. Lookup Word to Lemma Senses V1 (Hybrid: words/lemmas/senses in PG + morpheme_lemma_links from Worker)


CREATE OR REPLACE FUNCTION public.lookup_word_to_lemma_senses_v1(
  p_word_id integer DEFAULT NULL::integer,
  p_query text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '8s'
AS $function$
DECLARE
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_norm_strongs text := CASE
    WHEN v_q IS NOT NULL AND v_q ~* '^[HG][0-9]+[A-Za-z]?$'
      THEN upper(regexp_replace(v_q, '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    ELSE NULL
  END;
  v_is_hebrew boolean := v_q IS NOT NULL AND v_q ~ '[\u0590-\u05FF]';
  v_has_hebrew_vowels boolean := v_q IS NOT NULL AND v_q ~ '[\u05B0-\u05BC\u05C1\u05C2]';
  v_is_greek boolean := v_q IS NOT NULL AND v_q ~ '[\u0370-\u03FF\u1F00-\u1FFF]';
  v_has_greek_accents boolean := v_q IS NOT NULL AND (v_q ~ '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF]' OR v_q ~ '[άέήίόύώΐΰϊϋ]');

  v_heb_vocalized text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_cantillation(v_q) ELSE NULL END;
  v_heb_stripped text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_all(v_q) ELSE NULL END;
  v_grk_harmonized text := CASE WHEN v_is_greek THEN public.harmonize_greek_accents(v_q) ELSE NULL END;
  v_grk_stripped text := CASE WHEN v_is_greek THEN public.strip_greek_diacritics(v_q) ELSE NULL END;

  v_ids integer[];
  v_remote_wfl jsonb := '{}'::jsonb;
  v_words jsonb;
BEGIN
  IF p_word_id IS NULL AND v_q IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide p_word_id or p_query (surface word form, transliteration, or Strong''s code).'
    );
  END IF;

  IF p_word_id IS NOT NULL THEN
    SELECT array_agg(w.id ORDER BY w.id)
    INTO v_ids
    FROM public.words w
    WHERE w.id = p_word_id;
  ELSE
    SELECT array_agg(sub.id ORDER BY sub.rk, sub.id)
    INTO v_ids
    FROM (
      SELECT
        w.id,
        CASE
          WHEN w.original_word = v_q THEN 1
          WHEN v_has_hebrew_vowels AND public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized THEN 2
          WHEN v_has_greek_accents AND public.harmonize_greek_accents(w.original_word) = v_grk_harmonized THEN 2
          WHEN v_norm_strongs IS NOT NULL AND w.strongs_nr = v_norm_strongs THEN 3
          WHEN lower(w.transliteration) = lower(v_q) THEN 4
          ELSE 9
        END AS rk
      FROM public.words w
      WHERE w.original_word = v_q
         OR (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized)
         OR (v_has_greek_accents AND public.harmonize_greek_accents(w.original_word) = v_grk_harmonized)
         OR (v_norm_strongs IS NOT NULL AND w.strongs_nr = v_norm_strongs)
         OR lower(w.transliteration) = lower(v_q)
      ORDER BY rk, w.id
      LIMIT 10
    ) sub;

    IF coalesce(cardinality(v_ids), 0) = 0 THEN
      IF v_is_hebrew AND NOT v_has_hebrew_vowels AND v_heb_stripped IS NOT NULL AND length(v_heb_stripped) >= 2 THEN
        SELECT array_agg(sub.id ORDER BY sub.id)
        INTO v_ids
        FROM (
          SELECT w.id
          FROM public.words w
          WHERE public.strip_hebrew_all(w.original_word) = v_heb_stripped
          ORDER BY w.id
          LIMIT 10
        ) sub;
      ELSIF v_is_greek AND NOT v_has_greek_accents AND v_grk_stripped IS NOT NULL AND length(v_grk_stripped) >= 2 THEN
        SELECT array_agg(sub.id ORDER BY sub.id)
        INTO v_ids
        FROM (
          SELECT w.id
          FROM public.words w
          WHERE public.strip_greek_diacritics(w.original_word) = v_grk_stripped
          ORDER BY w.id
          LIMIT 10
        ) sub;
      END IF;
    END IF;

    -- Secondary fallback via public.lemmas.base_strongs -> public.words.strongs_nr
    IF coalesce(cardinality(v_ids), 0) = 0 THEN
      SELECT array_agg(sub.id ORDER BY sub.id)
      INTO v_ids
      FROM (
        SELECT DISTINCT w.id
        FROM public.lemmas lem
        JOIN public.words w ON w.strongs_nr = lem.base_strongs
        WHERE (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized)
           OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped)
           OR (v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized)
           OR (v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped)
        ORDER BY w.id
        LIMIT 10
      ) sub;
    END IF;
  END IF;

  IF coalesce(cardinality(v_ids), 0) > 0 THEN
    v_remote_wfl := bible_internal.call_corpus_rpc_v1(
      'get_word_form_lemmas_batch_v1',
      jsonb_build_object('p_word_ids', to_jsonb(v_ids))
    );
    IF v_remote_wfl IS NULL OR jsonb_typeof(v_remote_wfl) <> 'object' OR coalesce(v_remote_wfl->>'status', '') <> 'ok' THEN
      RETURN jsonb_build_object(
        'schema_version', 1,
        'status', 'unavailable',
        'error', 'static_corpus_unavailable',
        'message', 'Static corpus worker unreachable while loading morpheme-to-lemma links'
      );
    END IF;
  END IF;

  WITH matched_words AS MATERIALIZED (
    SELECT w.id, w.original_word, w.transliteration, w.strongs_nr, w.grammar_code, w.gematria
    FROM public.words w
    WHERE v_ids IS NOT NULL AND w.id = ANY(v_ids)
    ORDER BY array_position(v_ids, w.id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'word_id', mw.id,
    'surface_form', mw.original_word,
    'transliteration', mw.transliteration,
    'base_strongs', mw.strongs_nr,
    'grammar_code', mw.grammar_code,
    'decoded_grammar', public.decode_grammar_v1(mw.grammar_code),
    'gematria', mw.gematria,
    'morpheme_lemma_links', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'component_order', (wfl->>'component_order')::smallint,
        'morpheme_role', wfl->>'morpheme_role',
        'morpheme_surface', wfl->>'morpheme_surface',
        'dstrongs_tag', wfl->>'dstrongs_tag',
        'observed_token_count', (wfl->>'observed_token_count')::integer,
        'is_context_ambiguous', coalesce((wfl->>'is_context_ambiguous')::boolean, false),
        'origin_mode', wfl->>'origin_mode',
        'derivation_method', wfl->>'derivation_method',
        'source_record_id', wfl->>'source_record_id',
        'lemma', jsonb_build_object(
          'lemma_id', lem.id,
          'lemma_key', lem.lemma_key,
          'language', lem.language,
          'lemma_script', lem.lemma_script,
          'transliteration', lem.transliteration,
          'primary_pos', lem.primary_pos,
          'homograph_tag', lem.homograph_tag,
          'base_strongs', lem.base_strongs,
          'source_record_id', lem.source_record_id
        ),
        'available_senses', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'sense_key', ls.sense_key,
            'sense_code', ls.sense_code,
            'sense_order', ls.sense_order,
            'short_gloss', ls.short_gloss,
            'definition_text', ls.definition_text,
            'usage_note', ls.usage_note,
            'scripture_refs', ls.scripture_refs,
            'source_attribution', ls.source_attribution,
            'source_edition_key', se.edition_key,
            'source_record_id', ls.source_record_id
          ) ORDER BY ls.sense_order, ls.id)
          FROM public.lexical_senses ls
          JOIN public.source_editions se ON se.id = ls.source_edition_id
          WHERE ls.lemma_id = lem.id
        ), '[]'::jsonb)
      ) ORDER BY (wfl->>'component_order')::smallint, (wfl->>'observed_token_count')::integer DESC, (wfl->>'id')::bigint)
      FROM jsonb_array_elements(coalesce(v_remote_wfl #> ARRAY['words', mw.id::text, 'word_form_lemmas'], '[]'::jsonb)) wfl
      JOIN public.lemmas lem ON lem.id = (wfl->>'lemma_id')::bigint
    ), '[]'::jsonb)
  )), '[]'::jsonb)
  INTO v_words
  FROM matched_words mw;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', CASE WHEN jsonb_array_length(v_words) > 0 THEN 'ok' ELSE 'not_found' END,
    'modeling_invariants', jsonb_build_object(
      'word_form_is_not_lemma', true,
      'sense_assignment_policy', 'catalog_only_no_ai_inference',
      'unicode_aware_search', true
    ),
    'query_analysis', jsonb_build_object(
      'raw_query', v_q,
      'is_hebrew', v_is_hebrew,
      'has_hebrew_vowels', v_has_hebrew_vowels,
      'is_greek', v_is_greek,
      'has_greek_accents', v_has_greek_accents
    ),
    'word_forms', v_words
  );
END;
$function$;

-- 23. Lookup Lemma Occurrences V1 (Hybrid: lemma candidate resolution in PG + stem occurrences from Worker)


CREATE OR REPLACE FUNCTION public.lookup_lemma_occurrences_v1(
  p_lemma_query text,
  p_after_verse_id integer DEFAULT 0,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '8s'
AS $function$
DECLARE
  v_q text := btrim(coalesce(p_lemma_query, ''));
  v_base_strongs text := CASE
    WHEN v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      THEN upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    ELSE NULL
  END;
  v_is_hebrew boolean := v_q ~ '[\u0590-\u05FF]';
  v_has_hebrew_vowels boolean := v_q ~ '[\u05B0-\u05BC\u05C1\u05C2]';
  v_is_greek boolean := v_q ~ '[\u0370-\u03FF\u1F00-\u1FFF]';
  v_has_greek_accents boolean := v_q ~ '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF]' OR v_q ~ '[άέήίόύώΐΰϊϋ]';

  v_heb_vocalized text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_cantillation(v_q) ELSE NULL END;
  v_heb_stripped text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_all(v_q) ELSE NULL END;
  v_grk_harmonized text := CASE WHEN v_is_greek THEN public.harmonize_greek_accents(v_q) ELSE NULL END;
  v_grk_stripped text := CASE WHEN v_is_greek THEN public.strip_greek_diacritics(v_q) ELSE NULL END;

  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_after int := greatest(coalesce(p_after_verse_id, 0), 0);
  v_lemma record;
  v_candidates jsonb;
  v_remote jsonb;
BEGIN
  IF v_q = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide p_lemma_query (e.g. "lemma:G3056", "H1254A", "G1510", or original headword).'
    );
  END IF;

  WITH cands AS (
    SELECT
      lem.*,
      CASE
        WHEN lower(lem.lemma_key) = lower(v_q) THEN 0
        WHEN lower(lem.lemma_key) = 'lemma:' || lower(v_q) THEN 1
        WHEN EXISTS (
          SELECT 1 FROM public.lexemes lx
          WHERE lx.id = lem.primary_lexeme_id AND upper(lx.extended_strongs) = upper(v_q)
        ) THEN 2
        WHEN v_base_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_base_strongs THEN 3
        WHEN v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized THEN 4
        WHEN v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized THEN 4
        WHEN v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped THEN 5
        WHEN v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped THEN 5
        WHEN lower(lem.transliteration) = lower(v_q) THEN 6
        ELSE 9
      END AS match_rank
    FROM public.lemmas lem
    WHERE lower(lem.lemma_key) = lower(v_q)
       OR lower(lem.lemma_key) = 'lemma:' || lower(v_q)
       OR (v_base_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_base_strongs)
       OR (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized)
       OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped)
       OR (v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized)
       OR (v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped)
       OR lower(lem.transliteration) = lower(v_q)
       OR EXISTS (
         SELECT 1 FROM public.lexemes lx
         WHERE lx.lemma_id = lem.id AND upper(lx.extended_strongs) = upper(v_q)
       )
    ORDER BY match_rank, lem.id
    LIMIT 12
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'lemma_key', c.lemma_key,
      'language', c.language,
      'lemma_script', c.lemma_script,
      'transliteration', c.transliteration,
      'primary_pos', c.primary_pos,
      'homograph_tag', c.homograph_tag,
      'base_strongs', c.base_strongs
    ) ORDER BY c.match_rank, c.id), '[]'::jsonb)
  INTO v_candidates
  FROM cands c;

  IF jsonb_array_length(v_candidates) = 0 THEN
    RETURN jsonb_build_object('schema_version', 1, 'status', 'not_found', 'lemma_candidates', '[]'::jsonb);
  END IF;

  SELECT lem.*
  INTO v_lemma
  FROM public.lemmas lem
  WHERE lem.lemma_key = (v_candidates->0->>'lemma_key');

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_lemma_lexical_summary_v1',
    jsonb_build_object(
      'p_lemma_id', v_lemma.id,
      'p_base_strongs', v_lemma.base_strongs,
      'p_mode', 'occurrences',
      'p_after_verse_id', v_after,
      'p_limit', v_limit
    )
  );

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'message', 'Static corpus worker unreachable while loading lemma occurrences'
    );
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'lemma', jsonb_build_object(
      'lemma_id', v_lemma.id,
      'lemma_key', v_lemma.lemma_key,
      'language', v_lemma.language,
      'lemma_script', v_lemma.lemma_script,
      'transliteration', v_lemma.transliteration,
      'primary_pos', v_lemma.primary_pos,
      'homograph_tag', v_lemma.homograph_tag,
      'base_strongs', v_lemma.base_strongs,
      'source_record_id', v_lemma.source_record_id
    ),
    'homograph_or_query_candidates', v_candidates,
    'totals', v_remote->'totals',
    'pagination', v_remote->'pagination',
    'occurrences', coalesce(v_remote->'occurrences', '[]'::jsonb)
  );
END;
$function$;

-- 24. Lookup Lemma English Glosses V1 (Hybrid: lemma & senses in PG + attested English renderings from Worker)


CREATE OR REPLACE FUNCTION public.lookup_lemma_english_glosses_v1(
  p_lemma_query text,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '8s'
AS $function$
DECLARE
  v_q text := btrim(coalesce(p_lemma_query, ''));
  v_base_strongs text := CASE
    WHEN v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      THEN upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    ELSE NULL
  END;
  v_stripped text := regexp_replace(normalize(v_q, NFKD), '[\u0591-\u05C7\u0300-\u036F\u1DC0-\u1DFF׃־]', '', 'g');
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_lemma record;
  v_remote jsonb;
BEGIN
  IF v_q = '' THEN
    RETURN jsonb_build_object('schema_version', 1, 'status', 'invalid_request', 'message', 'Provide p_lemma_query.');
  END IF;

  SELECT lem.*
  INTO v_lemma
  FROM public.lemmas lem
  WHERE lower(lem.lemma_key) = lower(v_q)
     OR lower(lem.lemma_key) = 'lemma:' || lower(v_q)
     OR (v_base_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_base_strongs)
     OR lem.lemma_script = v_q
     OR (v_stripped <> '' AND lem.lemma_stripped = v_stripped)
     OR lower(lem.transliteration) = lower(v_q)
     OR EXISTS (
       SELECT 1 FROM public.lexemes lx
       WHERE lx.lemma_id = lem.id AND upper(lx.extended_strongs) = upper(v_q)
     )
  ORDER BY
    CASE
      WHEN lower(lem.lemma_key) = lower(v_q) OR lower(lem.lemma_key) = 'lemma:' || lower(v_q) THEN 0
      WHEN EXISTS (SELECT 1 FROM public.lexemes lx WHERE lx.id = lem.primary_lexeme_id AND upper(lx.extended_strongs) = upper(v_q)) THEN 1
      WHEN v_base_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_base_strongs THEN 2
      ELSE 3
    END,
    lem.id
  LIMIT 1;

  IF v_lemma.id IS NULL THEN
    RETURN jsonb_build_object('schema_version', 1, 'status', 'not_found');
  END IF;

  v_remote := bible_internal.call_corpus_rpc_v1(
    'get_lemma_lexical_summary_v1',
    jsonb_build_object(
      'p_lemma_id', v_lemma.id,
      'p_base_strongs', v_lemma.base_strongs,
      'p_mode', 'glosses',
      'p_limit', v_limit
    )
  );

  IF v_remote IS NULL OR jsonb_typeof(v_remote) <> 'object' OR coalesce(v_remote->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'message', 'Static corpus worker unreachable while loading lemma glosses'
    );
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'modeling_invariants', jsonb_build_object(
      'lexical_sense_is_not_english_translation', true,
      'translation_is_not_word_for_word_alignment', true
    ),
    'lemma', jsonb_build_object(
      'lemma_key', v_lemma.lemma_key,
      'language', v_lemma.language,
      'lemma_script', v_lemma.lemma_script,
      'transliteration', v_lemma.transliteration,
      'primary_pos', v_lemma.primary_pos,
      'base_strongs', v_lemma.base_strongs
    ),
    'lexicon_sense_glosses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'sense_key', ls.sense_key,
        'sense_code', ls.sense_code,
        'short_gloss', ls.short_gloss,
        'source_attribution', ls.source_attribution,
        'source_edition_key', se.edition_key,
        'source_record_id', ls.source_record_id
      ) ORDER BY ls.sense_order, ls.id)
      FROM public.lexical_senses ls
      JOIN public.source_editions se ON se.id = ls.source_edition_id
      WHERE ls.lemma_id = v_lemma.id
    ), '[]'::jsonb),
    'corpus_rendering_summary', v_remote->'corpus_rendering_summary',
    'attested_english_glosses', coalesce(v_remote->'attested_english_glosses', '[]'::jsonb)
  );
END;
$function$;

-- 25. Lookup Lexical Semantics V1 (Hybrid: lexeme_identifiers derived from public.lexemes + attested glosses/forms from Worker)


CREATE OR REPLACE FUNCTION public.lookup_lexical_semantics_v1(
  p_query text,
  p_match_scope text DEFAULT 'auto'::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_scope text := lower(coalesce(p_match_scope, 'auto'));
  v_norm_strongs text := CASE
    WHEN v_q IS NOT NULL AND v_q ~* '^(lemma:)?[HG][0-9]+[A-Za-z]?$'
      THEN upper(regexp_replace(regexp_replace(v_q, '^lemma:', '', 'i'), '^([HG])0*([0-9]+)[A-Za-z]?$', '\1\2', 'i'))
    ELSE NULL
  END;
  v_is_hebrew boolean := v_q IS NOT NULL AND v_q ~ '[\u0590-\u05FF]';
  v_has_hebrew_vowels boolean := v_q IS NOT NULL AND v_q ~ '[\u05B0-\u05BC\u05C1\u05C2]';
  v_is_greek boolean := v_q IS NOT NULL AND v_q ~ '[\u0370-\u03FF\u1F00-\u1FFF]';
  v_has_greek_accents boolean := v_q IS NOT NULL AND (v_q ~ '[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF]' OR v_q ~ '[άέήίόύώΐΰϊϋ]');

  v_heb_vocalized text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_cantillation(v_q) ELSE NULL END;
  v_heb_stripped text := CASE WHEN v_is_hebrew THEN public.strip_hebrew_all(v_q) ELSE NULL END;
  v_grk_harmonized text := CASE WHEN v_is_greek THEN public.harmonize_greek_accents(v_q) ELSE NULL END;
  v_grk_stripped text := CASE WHEN v_is_greek THEN public.strip_greek_diacritics(v_q) ELSE NULL END;

  v_lemmas jsonb;
  v_has_aramaic boolean := false;
BEGIN
  IF v_q IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'Provide p_query (Hebrew/Aramaic with or without niqqud, Greek with or without accents, Strong''s code, or transliteration).'
    );
  END IF;

  WITH candidate_lemmas AS (
    SELECT
      lem.*,
      se.edition_key AS source_edition_key,
      CASE
        WHEN lower(lem.lemma_key) = lower(v_q) OR lower(lem.lemma_key) = 'lemma:' || lower(v_q) THEN 0
        WHEN EXISTS (
          SELECT 1 FROM public.lexemes lx
          WHERE lx.id = lem.primary_lexeme_id AND upper(lx.extended_strongs) = upper(v_q)
        ) THEN 1
        WHEN v_norm_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_norm_strongs THEN 2
        WHEN v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized THEN 3
        WHEN v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized THEN 3
        WHEN v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped THEN 4
        WHEN v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped THEN 4
        WHEN lower(lem.transliteration) = lower(v_q) THEN 5
        WHEN EXISTS (
          SELECT 1 FROM public.words w
          WHERE w.strongs_nr = lem.base_strongs
            AND (
              (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized)
              OR (v_has_greek_accents AND public.harmonize_greek_accents(w.original_word) = v_grk_harmonized)
              OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND public.strip_hebrew_all(w.original_word) = v_heb_stripped)
              OR (v_is_greek AND NOT v_has_greek_accents AND public.strip_greek_diacritics(w.original_word) = v_grk_stripped)
            )
        ) THEN 6
        ELSE 9
      END AS match_rank
    FROM public.lemmas lem
    LEFT JOIN public.source_editions se ON se.id = lem.source_edition_id
    WHERE lower(lem.lemma_key) = lower(v_q)
       OR lower(lem.lemma_key) = 'lemma:' || lower(v_q)
       OR (v_norm_strongs IS NOT NULL AND upper(coalesce(lem.base_strongs, '')) = v_norm_strongs)
       OR (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(lem.lemma_script) = v_heb_vocalized)
       OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND lem.lemma_stripped = v_heb_stripped)
       OR (v_has_greek_accents AND public.harmonize_greek_accents(lem.lemma_script) = v_grk_harmonized)
       OR (v_is_greek AND NOT v_has_greek_accents AND lem.lemma_stripped = v_grk_stripped)
       OR lower(lem.transliteration) = lower(v_q)
       OR EXISTS (
         SELECT 1 FROM public.lexemes lx
         WHERE lx.lemma_id = lem.id AND upper(lx.extended_strongs) = upper(v_q)
       )
       OR EXISTS (
         SELECT 1 FROM public.words w
         WHERE w.strongs_nr = lem.base_strongs
           AND (
             (v_has_hebrew_vowels AND public.strip_hebrew_cantillation(w.original_word) = v_heb_vocalized)
             OR (v_has_greek_accents AND public.harmonize_greek_accents(w.original_word) = v_grk_harmonized)
             OR (v_is_hebrew AND NOT v_has_hebrew_vowels AND public.strip_hebrew_all(w.original_word) = v_heb_stripped)
             OR (v_is_greek AND NOT v_has_greek_accents AND public.strip_greek_diacritics(w.original_word) = v_grk_stripped)
           )
       )
    ORDER BY match_rank, lem.id
    LIMIT 15
  ),
  remote_summaries AS (
    SELECT
      cl.id AS lemma_id,
      bible_internal.call_corpus_rpc_v1(
        'get_lemma_lexical_summary_v1',
        jsonb_build_object(
          'p_lemma_id', cl.id,
          'p_base_strongs', cl.base_strongs,
          'p_mode', 'semantics'
        )
      ) AS doc
    FROM candidate_lemmas cl
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'lemma_id', cl.id,
    'lemma_key', cl.lemma_key,
    'language', cl.language,
    'lemma_script', cl.lemma_script,
    'lemma_stripped', cl.lemma_stripped,
    'transliteration', cl.transliteration,
    'primary_pos', cl.primary_pos,
    'homograph_tag', cl.homograph_tag,
    'base_strongs', cl.base_strongs,
    'source_edition_key', cl.source_edition_key,
    'source_record_id', cl.source_record_id,

    -- 1. Distinct Lexemes and Identifiers (synthesized deterministically from public.lexemes columns)
    'lexemes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'lexeme_id', lx.id,
        'lexeme_key', lx.lexeme_key,
        'extended_strongs', lx.extended_strongs,
        'disambiguated_strongs', lx.disambiguated_strongs,
        'unified_strongs', lx.unified_strongs,
        'primary_gloss', lx.primary_gloss,
        'homograph_note', lx.homograph_note,
        'source_record_id', lx.source_record_id,
        'registered_identifiers', jsonb_build_array(
          jsonb_build_object('namespace', 'extended_strongs', 'value', lx.extended_strongs, 'is_primary', true),
          jsonb_build_object('namespace', 'step_lexeme_key', 'value', lx.lexeme_key, 'is_primary', true),
          jsonb_build_object('namespace', 'base_strongs', 'value', lx.base_strongs, 'is_primary', false),
          jsonb_build_object('namespace', 'disambiguated_strongs', 'value', lx.disambiguated_strongs, 'is_primary', false),
          jsonb_build_object('namespace', 'unified_strongs', 'value', lx.unified_strongs, 'is_primary', false)
        )
      ) ORDER BY lx.id)
      FROM public.lexemes lx
      WHERE lx.lemma_id = cl.id OR lx.id = cl.primary_lexeme_id
    ), '[]'::jsonb),

    -- 2. Documented Roots & Etymology
    'documented_roots', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'root_key', lr.root_key,
        'language', lr.language,
        'root_script', lr.root_script,
        'transliteration', lr.transliteration,
        'root_kind', lr.root_kind,
        'etymology_type', lrl.etymology_type,
        'implies_synonymy', lrl.implies_synonymy,
        'evidence_note', lrl.evidence_note,
        'origin_mode', lrl.origin_mode,
        'derivation_method', lrl.derivation_method,
        'source_record_id', lrl.source_record_id
      ) ORDER BY lr.root_key)
      FROM public.lemma_root_links lrl
      JOIN public.lexical_roots lr ON lr.id = lrl.root_id
      WHERE lrl.lemma_id = cl.id
    ), '[]'::jsonb),

    -- 3. Documented Lexical Senses
    'documented_senses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'sense_key', ls.sense_key,
        'sense_code', ls.sense_code,
        'sense_order', ls.sense_order,
        'short_gloss', ls.short_gloss,
        'definition_text', ls.definition_text,
        'usage_note', ls.usage_note,
        'scripture_refs', ls.scripture_refs,
        'source_attribution', ls.source_attribution,
        'source_edition_key', se.edition_key,
        'source_record_id', ls.source_record_id
      ) ORDER BY ls.sense_order, ls.id)
      FROM public.lexical_senses ls
      JOIN public.source_editions se ON se.id = ls.source_edition_id
      WHERE ls.lemma_id = cl.id
    ), '[]'::jsonb),

    -- 4. Attested Translation Glosses (from Cloudflare Worker)
    'attested_translation_glosses', coalesce(rs.doc->'attested_translation_glosses', '[]'::jsonb),

    -- 5. Contextual Surface Forms Summary (from Cloudflare Worker)
    'surface_forms_summary', coalesce(
      rs.doc->'surface_forms_summary',
      jsonb_build_object('distinct_forms_count', 0, 'sample_surface_forms', '[]'::jsonb)
    )
  ) ORDER BY cl.match_rank, cl.id), '[]'::jsonb)
  INTO v_lemmas
  FROM candidate_lemmas cl
  LEFT JOIN remote_summaries rs ON rs.lemma_id = cl.id;

  v_has_aramaic := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lemmas) elem
    WHERE elem->>'language' = 'arc'
  );

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', CASE WHEN jsonb_array_length(v_lemmas) > 0 THEN 'ok' ELSE 'not_found' END,
    'query_analysis', jsonb_build_object(
      'raw_query', v_q,
      'detected_script', CASE
        WHEN v_is_hebrew AND NOT v_has_aramaic THEN 'hebrew'
        WHEN v_is_hebrew AND v_has_aramaic THEN 'hebrew_or_aramaic'
        WHEN v_is_greek THEN 'greek'
        WHEN v_norm_strongs IS NOT NULL AND v_norm_strongs LIKE 'H%' THEN 'strongs_hebrew'
        WHEN v_norm_strongs IS NOT NULL AND v_norm_strongs LIKE 'G%' THEN 'strongs_greek'
        ELSE 'transliteration_or_latin'
      END,
      'has_vowels_or_accents', (v_has_hebrew_vowels OR v_has_greek_accents),
      'cantillation_stripped', v_heb_vocalized,
      'accent_harmonized', v_grk_harmonized,
      'consonants_or_base_letters', coalesce(v_heb_stripped, v_grk_stripped)
    ),
    'epistemic_invariants', jsonb_build_object(
      'surface_form_is_not_lemma', 'A surface form (public.words) is the contextual inflected word in a biblical verse. A lemma (public.lemmas) is the dictionary citation headword.',
      'lemma_is_not_root', 'A lemma is a distinct lexical unit. A root (public.lexical_roots) is an etymological base. Words sharing a common root do NOT imply synonymy.',
      'shared_root_implies_synonymy', false,
      'strongs_identifies_contextual_sense', false,
      'sense_is_not_translation_gloss', 'A lexical sense (public.lexical_senses) is a documented dictionary definition with scope and citations. A translation gloss is a translation choice for a specific passage and cannot be treated as a definitive contextual sense without supporting evidence.'
    ),
    'total_matching_lemmas', jsonb_array_length(v_lemmas),
    'lemmas', v_lemmas
  );
END;
$function$;

-- 26. Get Verse Research V1 (Hybrid: verse_translation_sources fetched from Worker + live PG words/chronology/geography/assertions)


CREATE OR REPLACE FUNCTION public.get_verse_research_v1(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '60s'
AS $function$
DECLARE
  refs jsonb; item jsonb; mode text; sample_limit integer := 20;
  model_id text; packet jsonb; byte_size integer;
  profile_preset text; max_passages integer := 5;
  total_expanded integer;
  v_verse_ids integer[];
  v_remote_vts jsonb;
  invalid constant jsonb := '{"schema_version":1,"status":"invalid_request","message":"Provide 1-5 passages (or up to 100 in analysis profile / sample mode); occurrences.mode is all or sample (limit 1-100); use a published chronology model."}';
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN RETURN invalid; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN ('passages','occurrences','chronology_model_id','profile')) THEN RETURN invalid; END IF;

  refs := p_request->'passages';
  IF refs IS NULL OR jsonb_typeof(refs) <> 'array' OR jsonb_array_length(refs) = 0 THEN RETURN invalid; END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(refs)) <> jsonb_array_length(refs) THEN RETURN invalid; END IF;

  profile_preset := coalesce(p_request->>'profile', 'full');
  IF profile_preset NOT IN ('analysis', 'full') THEN RETURN invalid; END IF;

  mode := coalesce(p_request #>> '{occurrences,mode}', CASE WHEN profile_preset = 'analysis' THEN 'sample' ELSE 'all' END);
  IF profile_preset = 'analysis' AND NOT (p_request ? 'occurrences') THEN
    sample_limit := 5;
  END IF;

  IF p_request ? 'occurrences' THEN
    item := p_request->'occurrences';
    IF jsonb_typeof(item) <> 'object' THEN RETURN invalid; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('mode','limit')) THEN RETURN invalid; END IF;
    IF item ? 'mode' AND jsonb_typeof(item->'mode') <> 'string' THEN RETURN invalid; END IF;
    IF item ? 'limit' THEN
      IF jsonb_typeof(item->'limit') <> 'number' OR item->>'limit' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      sample_limit := (item->>'limit')::int;
      IF sample_limit NOT BETWEEN 1 AND 100 OR mode <> 'sample' THEN RETURN invalid; END IF;
    END IF;
  END IF;
  IF mode NOT IN ('all','sample') THEN RETURN invalid; END IF;

  IF profile_preset = 'analysis' OR mode = 'sample' THEN
    max_passages := 100;
  ELSE
    max_passages := 5;
  END IF;

  IF p_request ? 'chronology_model_id' AND jsonb_typeof(p_request->'chronology_model_id') <> 'string' THEN RETURN invalid; END IF;
  model_id := coalesce(p_request->>'chronology_model_id', 'theographic-verse-v1');
  IF NOT EXISTS(SELECT 1 FROM public.chronology_models WHERE id = model_id AND published) THEN RETURN invalid; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(refs) LOOP
    IF jsonb_typeof(item) <> 'object' THEN RETURN invalid; END IF;
    IF NOT (
      (item ? 'book' AND item ? 'chapter' AND item ? 'verse' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('book','chapter','verse')))
      OR
      (item ? 'book' AND item ? 'chapter' AND item ? 'start_verse' AND item ? 'end_verse' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('book','chapter','start_verse','end_verse')))
    ) THEN RETURN invalid; END IF;

    IF jsonb_typeof(item->'book') IS DISTINCT FROM 'number'
      OR jsonb_typeof(item->'chapter') IS DISTINCT FROM 'number' THEN RETURN invalid; END IF;
    IF item->>'book' !~ '^[0-9]{1,2}$' OR item->>'chapter' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
    IF (item->>'book')::int NOT BETWEEN 1 AND 66 OR (item->>'chapter')::int NOT BETWEEN 1 AND 150 THEN RETURN invalid; END IF;

    IF item ? 'verse' THEN
      IF jsonb_typeof(item->'verse') IS DISTINCT FROM 'number' OR item->>'verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF (item->>'verse')::int NOT BETWEEN 0 AND 176 THEN RETURN invalid; END IF;
    ELSE
      IF jsonb_typeof(item->'start_verse') IS DISTINCT FROM 'number' OR item->>'start_verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF jsonb_typeof(item->'end_verse') IS DISTINCT FROM 'number' OR item->>'end_verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF (item->>'start_verse')::int NOT BETWEEN 0 AND 176 OR (item->>'end_verse')::int NOT BETWEEN 0 AND 176 THEN RETURN invalid; END IF;
      IF (item->>'start_verse')::int > (item->>'end_verse')::int THEN RETURN invalid; END IF;
    END IF;
  END LOOP;

  SELECT count(DISTINCT (r.item->>'book')::int || ':' || (r.item->>'chapter')::int || ':' || g.v)
  INTO total_expanded
  FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
  CROSS JOIN LATERAL (
    SELECT generate_series(
      coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
      coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
    ) AS v
  ) g;

  IF total_expanded NOT BETWEEN 1 AND max_passages THEN RETURN invalid; END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT
        (r.item->>'book')::int AS book,
        (r.item->>'chapter')::int AS chapter,
        g.v AS verse
      FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
      CROSS JOIN LATERAL (
        SELECT generate_series(
          coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
          coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
        ) AS v
      ) g
    ) req
    WHERE NOT EXISTS (
      SELECT 1 FROM public.verses v
      WHERE v.book = req.book AND v.chapter = req.chapter AND v.verse_nr = req.verse
    )
  ) THEN
    RETURN jsonb_build_object('schema_version', 1, 'status', 'passage_not_found', 'requested_passages', refs);
  END IF;

  SELECT array_agg(DISTINCT v.id ORDER BY v.id)
  INTO v_verse_ids
  FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
  CROSS JOIN LATERAL (
    SELECT generate_series(
      coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
      coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
    ) AS v
  ) g
  JOIN public.verses v ON v.book = (r.item->>'book')::int AND v.chapter = (r.item->>'chapter')::int AND v.verse_nr = g.v;

  v_remote_vts := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', to_jsonb(v_verse_ids))
  );

  IF v_remote_vts IS NULL OR jsonb_typeof(v_remote_vts) <> 'object' OR coalesce(v_remote_vts->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'message', 'Static corpus worker unreachable while loading verse translation sources'
    );
  END IF;

  WITH req_passages AS MATERIALIZED (
    SELECT
      row_number() OVER (ORDER BY min(r.ord), (r.item->>'book')::int, (r.item->>'chapter')::int, g.v)::int AS ord,
      (r.item->>'book')::int AS book,
      (r.item->>'chapter')::int AS chapter,
      g.v AS verse
    FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
    CROSS JOIN LATERAL (
      SELECT generate_series(
        coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
        coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
      ) AS v
    ) g
    GROUP BY (r.item->>'book')::int, (r.item->>'chapter')::int, g.v
  ), passages AS MATERIALIZED (
    SELECT v.*, r.ord, (v.book || ':' || v.chapter || ':' || v.verse_nr) AS verse_ref
    FROM req_passages r
    JOIN public.verses v ON v.book = r.book AND v.chapter = r.chapter AND v.verse_nr = r.verse
  ), remote_vts_rows AS MATERIALIZED (
    SELECT
      p.id AS verse_id,
      (elem->>'word_position')::integer AS word_position,
      (elem->>'word_id')::integer AS word_id,
      elem->>'source_english' AS source_english,
      elem->>'source_ref' AS source_ref,
      elem->>'source_name' AS source_name,
      elem->>'source_commit' AS source_commit
    FROM passages p
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(v_remote_vts #> ARRAY['verses', p.id::text], '[]'::jsonb)) elem
  ), tokens AS MATERIALIZED (
    SELECT v.id verse_id, v.verse_ref, u.ord::integer word_position, w.*,
      s.source_english, s.source_ref, s.source_name, s.source_commit
    FROM passages v
    CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY u(word_id, ord)
    JOIN public.words w ON w.id = u.word_id
    LEFT JOIN remote_vts_rows s ON s.verse_id = v.id AND s.word_position = u.ord AND s.word_id = w.id
  ), targets AS MATERIALIZED (
    SELECT DISTINCT strongs_nr FROM tokens
  ), target_forms AS MATERIALIZED (
    SELECT w.id, w.strongs_nr FROM public.words w JOIN targets t USING(strongs_nr)
  ), occurrence_counts AS MATERIALIZED (
    SELECT f.strongs_nr, v.book, v.chapter, v.verse_nr, count(*)::integer occurrence_count
    FROM public.verses v
    CROSS JOIN LATERAL unnest(v.word_ids) u(word_id)
    JOIN target_forms f ON f.id = u.word_id
    GROUP BY f.strongs_nr, v.book, v.chapter, v.verse_nr
  ), ranked_occurrences AS (
    SELECT a.*, row_number() OVER(PARTITION BY a.strongs_nr ORDER BY a.book, a.chapter, a.verse_nr) rn
    FROM occurrence_counts a
  ), occurrence_packets AS MATERIALIZED (
    SELECT strongs_nr, jsonb_build_object(
      'counting_method', 'Sum of matching tokens per passage across base-Strongs inflections',
      'corpus_token_total', sum(occurrence_count),
      'distinct_passage_total', count(*),
      'returned_reference_count', count(*) FILTER(WHERE mode = 'all' OR rn <= sample_limit),
      'complete', mode = 'all' OR count(*) <= sample_limit,
      'references', coalesce(jsonb_agg(jsonb_build_object(
        'book', q.book, 'chapter', q.chapter, 'verse', q.verse_nr, 'occurrence_count', q.occurrence_count
      ) ORDER BY q.book, q.chapter, q.verse_nr) FILTER(WHERE mode = 'all' OR rn <= sample_limit), '[]'::jsonb)
    ) doc
    FROM ranked_occurrences q GROUP BY strongs_nr
  ), lexemes AS MATERIALIZED (
    SELECT t.strongs_nr, coalesce(jsonb_agg(to_jsonb(l)-'id' ORDER BY l.lexeme_key)
      FILTER(WHERE l.id IS NOT NULL), '[]'::jsonb) candidates
    FROM targets t LEFT JOIN public.lexemes l ON l.base_strongs = t.strongs_nr GROUP BY t.strongs_nr
  ), lexical AS MATERIALIZED (
    SELECT t.strongs_nr, jsonb_build_object(
      'identity_scope', 'base_strongs',
      'strongs_nr', t.strongs_nr,
      'lexeme_candidates', l.candidates,
      'needs_disambiguation', jsonb_array_length(l.candidates) > 1,
      'sense_status', 'not_assigned_to_token',
      'semantic_annotation_status', CASE WHEN jsonb_array_length(l.candidates) = 0 THEN 'unavailable' ELSE 'candidate_lexemes_only' END,
      'occurrences', o.doc,
      'top_connected_words', c.doc,
      'connection_coverage', jsonb_build_object(
        'requested', 7, 'returned', jsonb_array_length(c.doc),
        'status', CASE WHEN jsonb_array_length(c.doc) = 0 THEN 'no_cached_connections' ELSE 'cached' END,
        'method', 'Cached within-verse base-Strongs token-pair associations; scores are not semantic equivalence.'
      ),
      'limitations', 'Base Strong''s groups inflections and may combine homographs. Multi-valence and paronomasia are preserved across contexts.'
    ) doc
    FROM targets t
    JOIN lexemes l USING(strongs_nr)
    JOIN occurrence_packets o USING(strongs_nr)
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.rank), '[]'::jsonb) doc FROM (
        SELECT row_number() OVER(ORDER BY a.score DESC, a.word_id) rank, a.*,
          w.english_translations, w.biblical_def, w.physical_def, 'stepbible-2026-11'::text source_release_key
        FROM public.prompt_word_cooccurrences(t.strongs_nr) a
        JOIN public.words w ON w.id = a.word_id
        ORDER BY a.score DESC, a.word_id LIMIT 7
      ) q
    ) c
  ), semantic_paths AS MATERIALIZED (
    SELECT a.id, a.subject_node_id, a.object_node_id,
      to_jsonb(a)-'id'-'subject_node_id'-'object_node_id' || jsonb_build_object(
        'subject', sn.display_label, 'object', ob.display_label,
        'evidence_spans', coalesce((
          SELECT jsonb_agg(to_jsonb(e)-'id'-'assertion_id' ORDER BY e.step_order, e.id)
          FROM public.assertion_evidence e WHERE e.assertion_id = a.id
        ), '[]'::jsonb)
      ) doc
    FROM public.assertions a
    JOIN public.research_nodes sn ON sn.id = a.subject_node_id
    JOIN public.research_nodes ob ON ob.id = a.object_node_id
    WHERE a.review_status = 'reviewed'
  ), verse_packets AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, jsonb_build_object(
      'verse_id', v.id,
      'verse_ref', v.verse_ref,
      'passage', jsonb_build_object(
        'book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0
      ),
      'words', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'word_position', t.word_position, 'word_id', t.id, 'original_word', t.original_word,
          'transliteration', t.transliteration, 'strongs_nr', t.strongs_nr, 'lexical_entry_key', t.strongs_nr,
          'grammar', jsonb_build_object(
            'raw_code', t.grammar_code,
            'scheme', CASE WHEN t.source_name LIKE 'TAHOT%' THEN 'STEP TEHMC (ETCBC/OpenScriptures adapted)'
              WHEN t.source_name LIKE 'TAGNT%' THEN 'STEP TEGMC (Tauber adapted)' ELSE NULL END,
            'decoded_grammar', public.decode_grammar_v1(t.grammar_code),
            'decoded_features', public.decode_grammar_v1(t.grammar_code),
            'unresolved_tags', CASE WHEN t.grammar_code IS NULL OR public.decode_grammar_v1(t.grammar_code) = '{}'::jsonb
              THEN CASE WHEN t.grammar_code IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(t.grammar_code) END
              ELSE '[]'::jsonb END
          ),
          'translations', jsonb_build_object(
            'source_english', t.source_english, 'source_ref', t.source_ref,
            'source_name', t.source_name, 'source_commit', t.source_commit,
            'corpus_gloss', t.english_translations[1],
            'available_renderings', public.translation_options_v1(t.id, t.source_english)
          ),
          'definitions', jsonb_build_object(
            'biblical', t.biblical_def, 'physical', t.physical_def,
            'source_release_key', 'stepbible-2026-11'
          ),
          'lexeme_candidates', (SELECT candidates FROM lexemes l WHERE l.strongs_nr = t.strongs_nr)
        ) ORDER BY t.word_position)
        FROM tokens t WHERE t.verse_id = v.id
      ), '[]'::jsonb),
      'coverage', jsonb_build_object(
        'semantic_scope', 'Reviewed passage matches and lexically related concept candidates; not token-sense assignments',
        'grammar_decoding', 'Server-side structured decoding active via decode_grammar_v1',
        'semantic_domains', 'candidate_lexemes_only',
        'token_senses', 'unavailable'
      )
    ) doc FROM passages v
  ), top_chronology AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, public.get_verse_chronology_v1(v.book, v.chapter, v.verse_nr, model_id) doc
    FROM passages v
  ), top_geography AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, public.get_verse_geography(v.book, v.chapter, v.verse_nr) doc
    FROM passages v
  ), top_semantics AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, coalesce((
      SELECT jsonb_agg(sp.doc ORDER BY sp.id)
      FROM semantic_paths sp
      WHERE EXISTS(
        SELECT 1 FROM public.assertion_evidence e
        WHERE e.assertion_id = sp.id AND e.book = v.book
          AND (v.chapter, v.verse_nr) >= (e.start_chapter, e.start_verse)
          AND (v.chapter, v.verse_nr) <= (e.end_chapter, e.end_verse)
      ) OR EXISTS(
        SELECT 1 FROM public.research_nodes n
        JOIN public.concepts c ON c.id = n.concept_id
        WHERE n.id IN (sp.subject_node_id, sp.object_node_id)
          AND c.primary_strongs && array(SELECT t.strongs_nr::text FROM tokens t WHERE t.verse_id = v.id)
      )
    ), '[]'::jsonb) doc
    FROM passages v
  )
  SELECT jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'verses', (SELECT jsonb_agg(doc ORDER BY ord) FROM verse_packets),
    'chronology', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_chronology),
    'geography', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_geography),
    'semantic_evidence', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_semantics),
    'lexical_entries', (SELECT jsonb_object_agg(strongs_nr, doc ORDER BY strongs_nr) FROM lexical),
    'sources', coalesce((SELECT jsonb_agg(to_jsonb(s)-'id'-'created_at' ORDER BY s.release_key)
      FROM public.source_releases s WHERE s.release_key IN ('stepbible-2026-11','curated-motifs-v1')), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'corpus', 'primary STEP Hebrew/Aramaic OT and NA28-membership Greek NT',
      'requested_passage_count', jsonb_array_length(refs),
      'returned_passage_count', (SELECT count(*) FROM passages),
      'lexical_entry_count', (SELECT count(*) FROM targets),
      'occurrence_mode', mode,
      'occurrences_complete', (SELECT bool_and((doc #>> '{occurrences,complete}')::boolean) FROM lexical),
      'chronology_evidence_complete', (SELECT bool_and(coalesce((doc #>> '{status}') = 'ok', false)
        AND NOT coalesce((doc #>> '{evidence_truncated}')::boolean, true)
        AND NOT coalesce((doc #>> '{assertions_truncated}')::boolean, true)) FROM top_chronology),
      'component_statuses', (SELECT jsonb_agg(jsonb_build_object(
        'verse_ref', v.verse_ref,
        'passage', jsonb_build_object('book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0),
        'chronology', c.doc #>> '{status}',
        'geography', g.doc #>> '{status}'
      ) ORDER BY v.ord) FROM passages v JOIN top_chronology c USING(verse_ref) JOIN top_geography g USING(verse_ref)),
      'max_passages', max_passages,
      'max_packet_bytes', 8388608,
      'semantic_coverage', 'Limited reviewed annotations; empty results do not establish absence of a relationship',
      'polysemy_homographs_preserved', true,
      'payload_deduplication', 'Hoisted top-level chronology, geography, and semantic_evidence dictionaries keyed by verse reference',
      'private_translation_choices_included', false
    )
  ) INTO packet;

  byte_size := octet_length(packet::text);
  IF byte_size > 8388608 THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'packet_limit_exceeded',
      'requested_passages', refs,
      'measured_bytes', byte_size,
      'max_packet_bytes', 8388608,
      'message', 'Request fewer passages or explicitly select occurrences.mode=sample. No partial packet was returned.'
    );
  END IF;

  RETURN packet;
END;
$function$;

-- 27. Get Verse Research V2 (Hybrid: verse_translation_sources & word_form_lemmas fetched in batch from Worker + live PG formations/notes/chronology/geography)


CREATE OR REPLACE FUNCTION public.get_verse_research_v2(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '60s'
AS $function$
DECLARE
  refs jsonb; item jsonb; mode text; sample_limit integer := 20;
  model_id text; packet jsonb; byte_size integer;
  profile_preset text; max_passages integer := 5;
  total_expanded integer;
  v_verse_ids integer[];
  v_word_ids integer[];
  v_remote_vts jsonb;
  v_remote_wfl jsonb;
  invalid constant jsonb := '{"schema_version":2,"status":"invalid_request","message":"Provide 1-5 passages (or up to 100 in analysis profile / sample mode); occurrences.mode is all or sample (limit 1-100); use a published chronology model."}';
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN RETURN invalid; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN ('passages','occurrences','chronology_model_id','profile','include_formation')) THEN RETURN invalid; END IF;

  refs := p_request->'passages';
  IF refs IS NULL OR jsonb_typeof(refs) <> 'array' OR jsonb_array_length(refs) = 0 THEN RETURN invalid; END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(refs)) <> jsonb_array_length(refs) THEN RETURN invalid; END IF;

  profile_preset := coalesce(p_request->>'profile', 'full');
  IF profile_preset NOT IN ('analysis', 'full') THEN RETURN invalid; END IF;

  mode := coalesce(p_request #>> '{occurrences,mode}', CASE WHEN profile_preset = 'analysis' THEN 'sample' ELSE 'all' END);
  IF profile_preset = 'analysis' AND NOT (p_request ? 'occurrences') THEN
    sample_limit := 5;
  END IF;

  IF p_request ? 'occurrences' THEN
    item := p_request->'occurrences';
    IF jsonb_typeof(item) <> 'object' THEN RETURN invalid; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('mode','limit')) THEN RETURN invalid; END IF;
    IF item ? 'mode' AND jsonb_typeof(item->'mode') <> 'string' THEN RETURN invalid; END IF;
    IF item ? 'limit' THEN
      IF jsonb_typeof(item->'limit') <> 'number' OR item->>'limit' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      sample_limit := (item->>'limit')::int;
      IF sample_limit NOT BETWEEN 1 AND 100 OR mode <> 'sample' THEN RETURN invalid; END IF;
    END IF;
  END IF;
  IF mode NOT IN ('all','sample') THEN RETURN invalid; END IF;

  IF profile_preset = 'analysis' OR mode = 'sample' THEN
    max_passages := 100;
  ELSE
    max_passages := 5;
  END IF;

  IF p_request ? 'chronology_model_id' AND jsonb_typeof(p_request->'chronology_model_id') <> 'string' THEN RETURN invalid; END IF;
  model_id := coalesce(p_request->>'chronology_model_id', 'theographic-verse-v1');
  IF NOT EXISTS(SELECT 1 FROM public.chronology_models WHERE id = model_id AND published) THEN RETURN invalid; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(refs) LOOP
    IF jsonb_typeof(item) <> 'object' THEN RETURN invalid; END IF;
    IF NOT (
      (item ? 'book' AND item ? 'chapter' AND item ? 'verse' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('book','chapter','verse')))
      OR
      (item ? 'book' AND item ? 'chapter' AND item ? 'start_verse' AND item ? 'end_verse' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('book','chapter','start_verse','end_verse')))
    ) THEN RETURN invalid; END IF;

    IF jsonb_typeof(item->'book') IS DISTINCT FROM 'number'
      OR jsonb_typeof(item->'chapter') IS DISTINCT FROM 'number' THEN RETURN invalid; END IF;
    IF item->>'book' !~ '^[0-9]{1,2}$' OR item->>'chapter' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
    IF (item->>'book')::int NOT BETWEEN 1 AND 66 OR (item->>'chapter')::int NOT BETWEEN 1 AND 150 THEN RETURN invalid; END IF;

    IF item ? 'verse' THEN
      IF jsonb_typeof(item->'verse') IS DISTINCT FROM 'number' OR item->>'verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF (item->>'verse')::int NOT BETWEEN 0 AND 176 THEN RETURN invalid; END IF;
    ELSE
      IF jsonb_typeof(item->'start_verse') IS DISTINCT FROM 'number' OR item->>'start_verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF jsonb_typeof(item->'end_verse') IS DISTINCT FROM 'number' OR item->>'end_verse' !~ '^[0-9]{1,3}$' THEN RETURN invalid; END IF;
      IF (item->>'start_verse')::int NOT BETWEEN 0 AND 176 OR (item->>'end_verse')::int NOT BETWEEN 0 AND 176 THEN RETURN invalid; END IF;
      IF (item->>'start_verse')::int > (item->>'end_verse')::int THEN RETURN invalid; END IF;
    END IF;
  END LOOP;

  SELECT count(DISTINCT (r.item->>'book')::int || ':' || (r.item->>'chapter')::int || ':' || g.v)
  INTO total_expanded
  FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
  CROSS JOIN LATERAL (
    SELECT generate_series(
      coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
      coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
    ) AS v
  ) g;

  IF total_expanded NOT BETWEEN 1 AND max_passages THEN RETURN invalid; END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT
        (r.item->>'book')::int AS book,
        (r.item->>'chapter')::int AS chapter,
        g.v AS verse
      FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
      CROSS JOIN LATERAL (
        SELECT generate_series(
          coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
          coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
        ) AS v
      ) g
    ) req
    WHERE NOT EXISTS (
      SELECT 1 FROM public.verses v
      WHERE v.book = req.book AND v.chapter = req.chapter AND v.verse_nr = req.verse
    )
  ) THEN
    RETURN jsonb_build_object('schema_version', 2, 'status', 'passage_not_found', 'requested_passages', refs);
  END IF;

  SELECT
    array_agg(DISTINCT v.id ORDER BY v.id),
    array_agg(DISTINCT wid ORDER BY wid)
  INTO v_verse_ids, v_word_ids
  FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
  CROSS JOIN LATERAL (
    SELECT generate_series(
      coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
      coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
    ) AS v
  ) g
  JOIN public.verses v ON v.book = (r.item->>'book')::int AND v.chapter = (r.item->>'chapter')::int AND v.verse_nr = g.v
  CROSS JOIN LATERAL unnest(v.word_ids) wid;

  v_remote_vts := bible_internal.call_corpus_rpc_v1(
    'get_verse_translation_sources_batch_v1',
    jsonb_build_object('p_verse_ids', to_jsonb(coalesce(v_verse_ids, '{}'::integer[])))
  );
  v_remote_wfl := bible_internal.call_corpus_rpc_v1(
    'get_word_form_lemmas_batch_v1',
    jsonb_build_object('p_word_ids', to_jsonb(coalesce(v_word_ids, '{}'::integer[])))
  );

  IF v_remote_vts IS NULL OR jsonb_typeof(v_remote_vts) <> 'object' OR coalesce(v_remote_vts->>'status', '') <> 'ok'
     OR v_remote_wfl IS NULL OR jsonb_typeof(v_remote_wfl) <> 'object' OR coalesce(v_remote_wfl->>'status', '') <> 'ok' THEN
    RETURN jsonb_build_object(
      'schema_version', 2,
      'status', 'unavailable',
      'error', 'static_corpus_unavailable',
      'message', 'Static corpus worker unreachable while loading verse translation sources or word form lemmas'
    );
  END IF;

  WITH req_passages AS MATERIALIZED (
    SELECT
      row_number() OVER (ORDER BY min(r.ord), (r.item->>'book')::int, (r.item->>'chapter')::int, g.v)::int AS ord,
      (r.item->>'book')::int AS book,
      (r.item->>'chapter')::int AS chapter,
      g.v AS verse
    FROM jsonb_array_elements(refs) WITH ORDINALITY r(item, ord)
    CROSS JOIN LATERAL (
      SELECT generate_series(
        coalesce((r.item->>'start_verse')::int, (r.item->>'verse')::int),
        coalesce((r.item->>'end_verse')::int, (r.item->>'verse')::int)
      ) AS v
    ) g
    GROUP BY (r.item->>'book')::int, (r.item->>'chapter')::int, g.v
  ), passages AS MATERIALIZED (
    SELECT v.*, r.ord, (v.book || ':' || v.chapter || ':' || v.verse_nr) AS verse_ref
    FROM req_passages r
    JOIN public.verses v ON v.book = r.book AND v.chapter = r.chapter AND v.verse_nr = r.verse
  ), remote_vts_rows AS MATERIALIZED (
    SELECT
      p.id AS verse_id,
      (elem->>'word_position')::integer AS word_position,
      (elem->>'word_id')::integer AS word_id,
      elem->>'source_english' AS source_english,
      elem->>'source_ref' AS source_ref,
      elem->>'source_name' AS source_name,
      elem->>'source_commit' AS source_commit
    FROM passages p
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(v_remote_vts #> ARRAY['verses', p.id::text], '[]'::jsonb)) elem
  ), tokens AS MATERIALIZED (
    SELECT v.id verse_id, v.verse_ref, u.ord::integer word_position, w.*,
      s.source_english, s.source_ref, s.source_name, s.source_commit
    FROM passages v
    CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY u(word_id, ord)
    JOIN public.words w ON w.id = u.word_id
    LEFT JOIN remote_vts_rows s ON s.verse_id = v.id AND s.word_position = u.ord AND s.word_id = w.id
  ), targets AS MATERIALIZED (
    SELECT DISTINCT strongs_nr FROM tokens
  ), lexemes AS MATERIALIZED (
    SELECT t.strongs_nr, coalesce(jsonb_agg(to_jsonb(l)-'id' ORDER BY l.lexeme_key)
      FILTER(WHERE l.id IS NOT NULL), '[]'::jsonb) candidates
    FROM targets t LEFT JOIN public.lexemes l ON l.base_strongs = t.strongs_nr GROUP BY t.strongs_nr
  ), lexical AS MATERIALIZED (
    SELECT t.strongs_nr, jsonb_build_object(
      'identity_scope', 'base_strongs',
      'strongs_nr', t.strongs_nr,
      'lexeme_candidates', l.candidates,
      'needs_disambiguation', jsonb_array_length(l.candidates) > 1,
      'sense_status', 'not_assigned_to_token',
      'semantic_annotation_status', CASE WHEN jsonb_array_length(l.candidates) = 0 THEN 'unavailable' ELSE 'candidate_lexemes_only' END,
      'occurrences', o.doc,
      'top_connected_words', c.doc,
      'connection_coverage', jsonb_build_object(
        'requested', 7, 'returned', jsonb_array_length(c.doc),
        'status', CASE WHEN jsonb_array_length(c.doc) = 0 THEN 'no_cached_connections' ELSE 'cached' END,
        'method', 'Cached within-verse base-Strongs token-pair associations; scores are not semantic equivalence.'
      ),
      'limitations', 'Base Strong''s groups inflections and may combine homographs. Multi-valence and paronomasia are preserved across contexts.'
    ) doc
    FROM targets t
    JOIN lexemes l USING(strongs_nr)
    CROSS JOIN LATERAL (
      SELECT jsonb_build_object(
        'counting_method', 'Sum of matching tokens per passage across base-Strongs inflections',
        'corpus_token_total', coalesce(sum(occurrence_count), 0),
        'distinct_passage_total', count(*),
        'returned_reference_count', count(*) FILTER(WHERE mode = 'all' OR rn <= sample_limit),
        'complete', mode = 'all' OR count(*) <= sample_limit,
        'references', coalesce(jsonb_agg(jsonb_build_object(
          'book', q.book, 'chapter', q.chapter, 'verse', q.verse_nr, 'occurrence_count', q.occurrence_count
        ) ORDER BY q.book, q.chapter, q.verse_nr) FILTER(WHERE mode = 'all' OR rn <= sample_limit), '[]'::jsonb)
      ) doc
      FROM (
        SELECT a.*, row_number() OVER(ORDER BY a.book, a.chapter, a.verse_nr) rn
        FROM public.prompt_word_occurrences(t.strongs_nr) a
      ) q
    ) o
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.rank), '[]'::jsonb) doc FROM (
        SELECT row_number() OVER(ORDER BY a.score DESC, a.word_id) rank, a.*,
          w.english_translations, w.biblical_def, w.physical_def, 'stepbible-2026-11'::text source_release_key
        FROM public.prompt_word_cooccurrences(t.strongs_nr) a
        JOIN public.words w ON w.id = a.word_id
        ORDER BY a.score DESC, a.word_id LIMIT 7
      ) q
    ) c
  ), remote_wfl_rows AS MATERIALIZED (
    SELECT
      wid AS word_id,
      (elem->>'id')::bigint AS id,
      (elem->>'component_order')::smallint AS component_order,
      elem->>'morpheme_role' AS morpheme_role,
      elem->>'morpheme_surface' AS morpheme_surface,
      elem->>'morpheme_gloss' AS morpheme_gloss,
      elem->>'grammar_code' AS grammar_code,
      (elem->>'lemma_id')::bigint AS lemma_id,
      coalesce((elem->>'is_context_ambiguous')::boolean, false) AS is_context_ambiguous
    FROM unnest(coalesce(v_word_ids, '{}'::integer[])) wid
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(v_remote_wfl #> ARRAY['words', wid::text, 'word_form_lemmas'], '[]'::jsonb)) elem
  ), token_morphology AS MATERIALIZED (
    SELECT wfl.word_id,
      coalesce(jsonb_agg(jsonb_build_object(
        'order', wfl.component_order,
        'role', wfl.morpheme_role,
        'surface', wfl.morpheme_surface,
        'gloss', wfl.morpheme_gloss,
        'grammar_code', wfl.grammar_code,
        'lemma_key', l.lemma_key,
        'is_context_ambiguous', wfl.is_context_ambiguous
      ) ORDER BY wfl.component_order, wfl.id), '[]'::jsonb) AS morphemes,
      array_agg(DISTINCT l.lemma_key ORDER BY l.lemma_key) AS lemma_keys,
      array_agg(DISTINCT wfl.lemma_id) AS lemma_ids
    FROM remote_wfl_rows wfl
    JOIN public.lemmas l ON l.id = wfl.lemma_id
    GROUP BY wfl.word_id
  ), lemma_ids AS MATERIALIZED (
    SELECT DISTINCT unnest(lemma_ids) AS id FROM token_morphology
    UNION
    SELECT DISTINCT l.id FROM public.lemmas l WHERE l.base_strongs IN (SELECT DISTINCT strongs_nr FROM targets)
  ), formations_agg AS MATERIALIZED (
    SELECT f.lemma_id, jsonb_agg(jsonb_build_object(
      'formation_id', f.id, 'lemma_id', f.lemma_id, 'analysis_key', f.analysis_key,
      'formation_type', f.formation_type, 'whole_word_gloss', f.whole_word_gloss,
      'evidence_status', f.evidence_status, 'evidence_note', f.evidence_note,
      'origin_mode', f.origin_mode, 'review_status', f.review_status,
      'source', jsonb_build_object('title', f.source_title, 'url', f.source_url, 'record_id', f.source_record_id),
      'components', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'order', c.component_order, 'surface_text', c.surface_text,
          'role', c.component_role, 'semantic_contribution', c.semantic_contribution,
          'component_note', c.component_note,
          'lemma_id', cl.id, 'lemma_key', cl.lemma_key, 'base_strongs', cl.base_strongs,
          'original_lemma', cl.lemma_script, 'transliteration', cl.transliteration,
          'lexeme_id', cx.id, 'primary_gloss', cx.primary_gloss,
          'senses', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'sense_code', ss.sense_code, 'short_gloss', ss.short_gloss,
              'source_attribution', ss.source_attribution
            ) ORDER BY ss.sense_order, ss.id), '[]'::jsonb)
            FROM (SELECT * FROM public.lexical_senses s WHERE s.lemma_id = cl.id ORDER BY s.sense_order, s.id LIMIT 5) ss
          )
        ) ORDER BY c.component_order)
        FROM public.lemma_components c
        LEFT JOIN public.lemmas cl ON cl.id = c.component_lemma_id
        LEFT JOIN public.lexemes cx ON cx.id = coalesce(c.component_lexeme_id, cl.primary_lexeme_id)
        WHERE c.formation_id = f.id
      ), '[]'::jsonb)
    ) ORDER BY f.id) AS formations
    FROM public.lexical_formations f
    WHERE f.lemma_id IN (SELECT id FROM lemma_ids)
    GROUP BY f.lemma_id
  ), roots_agg AS MATERIALIZED (
    SELECT rl.lemma_id, jsonb_agg(jsonb_build_object(
      'lemma_id', rl.lemma_id, 'lemma_key', l.lemma_key, 'root_id', r.id, 'root_key', r.root_key,
      'root_script', r.root_script, 'root_transliteration', r.transliteration,
      'root_kind', r.root_kind, 'relation_type', rl.etymology_type,
      'implies_synonymy', false, 'evidence_note', rl.evidence_note,
      'origin_mode', rl.origin_mode, 'derivation_method', rl.derivation_method,
      'source_record_id', rl.source_record_id, 'source_release_key', sr.release_key
    ) ORDER BY r.root_key) AS roots
    FROM public.lemma_root_links rl
    JOIN public.lemmas l ON l.id = rl.lemma_id
    JOIN public.lexical_roots r ON r.id = rl.root_id
    LEFT JOIN public.source_releases sr ON sr.id = rl.source_release_id
    WHERE rl.lemma_id IN (SELECT id FROM lemma_ids)
    GROUP BY rl.lemma_id
  ), relatives_agg AS MATERIALIZED (
    SELECT rel.source_lemma_id AS lemma_id, jsonb_agg(rel.doc ORDER BY rel.relative_lemma_key) AS relatives
    FROM (
      SELECT roots.lemma_id AS source_lemma_id, l.lemma_key AS relative_lemma_key, jsonb_build_object(
        'root_key', r.root_key, 'relative_lemma_id', l.id, 'relative_lemma_key', l.lemma_key,
        'base_strongs', l.base_strongs, 'lemma_script', l.lemma_script,
        'transliteration', l.transliteration, 'primary_gloss', lx.primary_gloss,
        'relation_type', related.etymology_type, 'source_record_id', related.source_record_id
      ) AS doc
      FROM (
        SELECT DISTINCT rl.lemma_id, rl.root_id FROM public.lemma_root_links rl
        WHERE rl.lemma_id IN (SELECT id FROM lemma_ids)
      ) roots
      JOIN public.lexical_roots r ON r.id = roots.root_id
      JOIN public.lemma_root_links related ON related.root_id = r.id
      JOIN public.lemmas l ON l.id = related.lemma_id
      LEFT JOIN public.lexemes lx ON lx.id = l.primary_lexeme_id
      WHERE NOT (l.id IN (SELECT id FROM lemma_ids))
    ) rel
    GROUP BY rel.source_lemma_id
  ), connections_agg AS MATERIALIZED (
    SELECT conn.lemma_id, jsonb_agg(conn.doc ORDER BY conn.connection_id) AS connections
    FROM (
      SELECT c.subject_lemma_id AS lemma_id, c.id AS connection_id, jsonb_build_object(
        'connection_id', c.id, 'source_lemma_id', c.subject_lemma_id, 'target_lemma_id', c.target_lemma_id,
        'source_lemma_key', sl.lemma_key, 'target_lemma_key', tl.lemma_key,
        'source_strongs', sl.base_strongs, 'target_strongs', tl.base_strongs,
        'relation_type', c.relation_type, 'evidence_status', c.evidence_status,
        'evidence_note', c.evidence_note, 'passage_reference', c.passage_reference,
        'source_title', c.source_title, 'source_url', c.source_url, 'derivation_method', c.derivation_method
      ) AS doc
      FROM public.lexical_connections c
      JOIN public.lemmas sl ON sl.id = c.subject_lemma_id
      JOIN public.lemmas tl ON tl.id = c.target_lemma_id
      WHERE c.subject_lemma_id IN (SELECT id FROM lemma_ids)
      UNION ALL
      SELECT c.target_lemma_id AS lemma_id, c.id AS connection_id, jsonb_build_object(
        'connection_id', c.id, 'source_lemma_id', c.subject_lemma_id, 'target_lemma_id', c.target_lemma_id,
        'source_lemma_key', sl.lemma_key, 'target_lemma_key', tl.lemma_key,
        'source_strongs', sl.base_strongs, 'target_strongs', tl.base_strongs,
        'relation_type', c.relation_type, 'evidence_status', c.evidence_status,
        'evidence_note', c.evidence_note, 'passage_reference', c.passage_reference,
        'source_title', c.source_title, 'source_url', c.source_url, 'derivation_method', c.derivation_method
      ) AS doc
      FROM public.lexical_connections c
      JOIN public.lemmas sl ON sl.id = c.subject_lemma_id
      JOIN public.lemmas tl ON tl.id = c.target_lemma_id
      WHERE c.target_lemma_id IN (SELECT id FROM lemma_ids)
    ) conn
    GROUP BY conn.lemma_id
  ), hydrated_lemma_formations AS MATERIALIZED (
    SELECT l.lemma_key, jsonb_build_object(
      'lemma_id', l.id,
      'lemma_key', l.lemma_key,
      'language', l.language,
      'lemma_script', l.lemma_script,
      'transliteration', l.transliteration,
      'base_strongs', l.base_strongs,
      'primary_pos', l.primary_pos,
      'homograph_tag', l.homograph_tag,
      'primary_gloss', lx.primary_gloss,
      'formations', coalesce(f.formations, '[]'::jsonb),
      'documented_roots', coalesce(r.roots, '[]'::jsonb),
      'root_relatives', coalesce(rel.relatives, '[]'::jsonb),
      'literary_connections', coalesce(conn.connections, '[]'::jsonb)
    ) AS formation_entry
    FROM lemma_ids li
    JOIN public.lemmas l ON l.id = li.id
    LEFT JOIN public.lexemes lx ON lx.id = l.primary_lexeme_id
    LEFT JOIN formations_agg f ON f.lemma_id = l.id
    LEFT JOIN roots_agg r ON r.lemma_id = l.id
    LEFT JOIN relatives_agg rel ON rel.lemma_id = l.id
    LEFT JOIN connections_agg conn ON conn.lemma_id = l.id
  ), semantic_paths AS MATERIALIZED (
    SELECT a.id, a.subject_node_id, a.object_node_id,
      to_jsonb(a)-'id'-'subject_node_id'-'object_node_id' || jsonb_build_object(
        'subject', sn.display_label, 'object', ob.display_label,
        'evidence_spans', coalesce((
          SELECT jsonb_agg(to_jsonb(e)-'id'-'assertion_id' ORDER BY e.step_order, e.id)
          FROM public.assertion_evidence e WHERE e.assertion_id = a.id
        ), '[]'::jsonb)
      ) doc
    FROM public.assertions a
    JOIN public.research_nodes sn ON sn.id = a.subject_node_id
    JOIN public.research_nodes ob ON ob.id = a.object_node_id
    WHERE a.review_status = 'reviewed'
  ), verse_packets AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, jsonb_build_object(
      'verse_id', v.id,
      'verse_ref', v.verse_ref,
      'passage', jsonb_build_object(
        'book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0
      ),
      'words', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'word_position', t.word_position, 'word_id', t.id, 'original_word', t.original_word,
          'transliteration', t.transliteration, 'strongs_nr', t.strongs_nr, 'lexical_entry_key', t.strongs_nr,
          'disambiguated_lemmas', coalesce(tm.lemma_keys, '{}'::text[]),
          'morphology', coalesce(tm.morphemes, '[]'::jsonb),
          'grammar', jsonb_build_object(
            'raw_code', t.grammar_code,
            'scheme', CASE WHEN t.source_name LIKE 'TAHOT%' THEN 'STEP TEHMC (ETCBC/OpenScriptures adapted)'
              WHEN t.source_name LIKE 'TAGNT%' THEN 'STEP TEGMC (Tauber adapted)' ELSE NULL END,
            'decoded_grammar', public.decode_grammar_v1(t.grammar_code),
            'decoded_features', public.decode_grammar_v1(t.grammar_code),
            'unresolved_tags', CASE WHEN t.grammar_code IS NULL OR public.decode_grammar_v1(t.grammar_code) = '{}'::jsonb
              THEN CASE WHEN t.grammar_code IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(t.grammar_code) END
              ELSE '[]'::jsonb END
          ),
          'translations', jsonb_build_object(
            'source_english', t.source_english, 'source_ref', t.source_ref,
            'source_name', t.source_name, 'source_commit', t.source_commit,
            'corpus_gloss', t.english_translations[1],
            'available_renderings', public.translation_options_v1(t.id, t.source_english)
          ),
          'definitions', jsonb_build_object(
            'biblical', t.biblical_def, 'physical', t.physical_def,
            'source_release_key', 'stepbible-2026-11'
          ),
          'lexeme_candidates', (SELECT candidates FROM lexemes l WHERE l.strongs_nr = t.strongs_nr)
        ) ORDER BY t.word_position)
        FROM tokens t
        LEFT JOIN token_morphology tm ON tm.word_id = t.id
        WHERE t.verse_id = v.id
      ), '[]'::jsonb),
      'coverage', jsonb_build_object(
        'semantic_scope', 'Reviewed passage matches and lexically related concept candidates; not token-sense assignments',
        'grammar_decoding', 'Server-side structured decoding active via decode_grammar_v1',
        'semantic_domains', 'candidate_lexemes_only',
        'token_senses', 'unavailable'
      )
    ) doc FROM passages v
  ), top_chronology AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, public.get_verse_chronology_v1(v.book, v.chapter, v.verse_nr, model_id) doc
    FROM passages v
  ), top_geography AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, public.get_verse_geography(v.book, v.chapter, v.verse_nr) doc
    FROM passages v
  ), top_semantics AS MATERIALIZED (
    SELECT v.ord, v.verse_ref, coalesce((
      SELECT jsonb_agg(sp.doc ORDER BY sp.id)
      FROM semantic_paths sp
      WHERE EXISTS(
        SELECT 1 FROM public.assertion_evidence e
        WHERE e.assertion_id = sp.id AND e.book = v.book
          AND (v.chapter, v.verse_nr) >= (e.start_chapter, e.start_verse)
          AND (v.chapter, v.verse_nr) <= (e.end_chapter, e.end_verse)
      ) OR EXISTS(
        SELECT 1 FROM public.research_nodes n
        JOIN public.concepts c ON c.id = n.concept_id
        WHERE n.id IN (sp.subject_node_id, sp.object_node_id)
          AND c.primary_strongs && array(SELECT t.strongs_nr::text FROM tokens t WHERE t.verse_id = v.id)
      )
    ), '[]'::jsonb) doc
    FROM passages v
  )
  SELECT jsonb_build_object(
    'schema_version', 2,
    'status', 'ok',
    'verses', (SELECT jsonb_agg(doc ORDER BY ord) FROM verse_packets),
    'chronology', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_chronology),
    'geography', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_geography),
    'semantic_evidence', (SELECT jsonb_object_agg(verse_ref, doc ORDER BY ord) FROM top_semantics),
    'lexical_entries', (SELECT jsonb_object_agg(strongs_nr, doc ORDER BY strongs_nr) FROM lexical),
    'lexical_formations', (SELECT jsonb_object_agg(lemma_key, formation_entry ORDER BY lemma_key) FROM hydrated_lemma_formations),
    'sources', coalesce((SELECT jsonb_agg(to_jsonb(s)-'id'-'created_at' ORDER BY s.release_key)
      FROM public.source_releases s WHERE s.release_key IN ('stepbible-2026-11','curated-motifs-v1')), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'corpus', 'primary STEP Hebrew/Aramaic OT and NA28-membership Greek NT',
      'requested_passage_count', jsonb_array_length(refs),
      'returned_passage_count', (SELECT count(*) FROM passages),
      'lexical_entry_count', (SELECT count(*) FROM targets),
      'occurrence_mode', mode,
      'occurrences_complete', (SELECT bool_and((doc #>> '{occurrences,complete}')::boolean) FROM lexical),
      'chronology_evidence_complete', (SELECT bool_and(coalesce((doc #>> '{status}') = 'ok', false)
        AND NOT coalesce((doc #>> '{evidence_truncated}')::boolean, true)
        AND NOT coalesce((doc #>> '{assertions_truncated}')::boolean, true)) FROM top_chronology),
      'component_statuses', (SELECT jsonb_agg(jsonb_build_object(
        'verse_ref', v.verse_ref,
        'passage', jsonb_build_object('book', v.book, 'chapter', v.chapter, 'verse', v.verse_nr, 'is_heading', v.verse_nr = 0),
        'chronology', c.doc #>> '{status}',
        'geography', g.doc #>> '{status}'
      ) ORDER BY v.ord) FROM passages v JOIN top_chronology c USING(verse_ref) JOIN top_geography g USING(verse_ref)),
      'max_passages', max_passages,
      'max_packet_bytes', 8388608,
      'semantic_coverage', 'Limited reviewed annotations; empty results do not establish absence of a relationship',
      'polysemy_homographs_preserved', true,
      'payload_deduplication', 'Hoisted top-level chronology, geography, semantic_evidence, and lexical_formations dictionaries',
      'lexical_formation_coverage', jsonb_build_object(
        'deduplicated_by', 'disambiguated_lemma_key',
        'homographs_preserved', true,
        'token_morphology_distinguished_from_composition', true,
        'spelling_similarity_not_proven_etymology', true,
        'roots_do_not_imply_synonymy', true,
        'missing_evidence_is_not_evidence_of_absence', true
      ),
      'private_translation_choices_included', false
    )
  ) INTO packet;

  byte_size := octet_length(packet::text);
  IF byte_size > 8388608 THEN
    RETURN jsonb_build_object(
      'schema_version', 2,
      'status', 'packet_limit_exceeded',
      'requested_passages', refs,
      'measured_bytes', byte_size,
      'max_packet_bytes', 8388608,
      'message', 'Request fewer passages or explicitly select occurrences.mode=sample. No partial packet was returned.'
    );
  END IF;

  RETURN packet;
END;
$function$;

-- 28. Get Notes For Passage V1 (Resolves lemma anchors via public.words.strongs_nr = public.lemmas.base_strongs OR Worker word_form_lemmas)


CREATE OR REPLACE FUNCTION public.get_notes_for_word_v1(
  p_word_id integer,
  p_verse_id integer DEFAULT NULL::integer,
  p_word_position integer DEFAULT NULL::integer,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
SET statement_timeout TO '8s'
SET jit TO 'off'
AS $function$
DECLARE
  v_limit int;
  v_remote_wfl jsonb;
  v_lemma_ids bigint[];
  v_lemmas jsonb;
  v_occurrence_list jsonb;
  v_form_list jsonb;
  v_lemma_list jsonb;
  v_occ_total int := 0;
  v_form_total int := 0;
  v_lemma_total int := 0;
  v_human_total int := 0;
  v_ai_total int := 0;
  v_result jsonb;
BEGIN
  IF p_word_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'user_note',
      'groups', jsonb_build_object('occurrence', '[]'::jsonb, 'form', '[]'::jsonb, 'lemma', '[]'::jsonb),
      'totals', jsonb_build_object('occurrence', 0, 'form', 0, 'lemma', 0, 'human', 0, 'ai', 0, 'total', 0),
      'lemmas', '[]'::jsonb
    );
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  v_remote_wfl := bible_internal.call_corpus_rpc_v1(
    'get_word_form_lemmas_batch_v1',
    jsonb_build_object('p_word_ids', jsonb_build_array(p_word_id))
  );

  IF v_remote_wfl IS NOT NULL AND jsonb_typeof(v_remote_wfl) = 'object' AND coalesce(v_remote_wfl->>'status', '') = 'ok' THEN
    SELECT array_agg(DISTINCT (elem->>'lemma_id')::bigint)
    INTO v_lemma_ids
    FROM jsonb_array_elements(coalesce(v_remote_wfl #> ARRAY['words', p_word_id::text, 'word_form_lemmas'], '[]'::jsonb)) elem
    WHERE elem->>'lemma_id' IS NOT NULL;
  END IF;

  IF v_lemma_ids IS NULL OR cardinality(v_lemma_ids) = 0 THEN
    SELECT array_agg(DISTINCT l.id)
    INTO v_lemma_ids
    FROM public.words w
    JOIN public.lemmas l ON l.base_strongs = w.strongs_nr
    WHERE w.id = p_word_id;
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'lemma_id', l.id,
        'lemma_key', l.lemma_key
      ) ORDER BY l.id
    ),
    '[]'::jsonb
  ) INTO v_lemmas
  FROM public.lemmas l
  WHERE v_lemma_ids IS NOT NULL AND l.id = ANY(v_lemma_ids);

  WITH candidate_anchors AS (
    SELECT
      anc.note_id,
      'occurrence' AS scope
    FROM public.note_anchors anc
    WHERE anc.anchor_kind = 'word_occurrence'
      AND anc.word_id = p_word_id
      AND (p_verse_id IS NULL OR anc.verse_id = p_verse_id)
      AND (p_word_position IS NULL OR anc.word_position = p_word_position)

    UNION ALL

    SELECT
      anc.note_id,
      'form' AS scope
    FROM public.note_anchors anc
    WHERE anc.anchor_kind = 'word_form'
      AND anc.word_id = p_word_id

    UNION ALL

    SELECT
      anc.note_id,
      'lemma' AS scope
    FROM public.note_anchors anc
    WHERE anc.anchor_kind = 'lemma'
      AND v_lemma_ids IS NOT NULL
      AND anc.lemma_id = ANY(v_lemma_ids)
  ),
  scoped_notes AS (
    SELECT
      ca.note_id,
      array_agg(DISTINCT ca.scope) AS scopes,
      CASE
        WHEN 'occurrence' = ANY(array_agg(DISTINCT ca.scope)) THEN 'occurrence'
        WHEN 'form' = ANY(array_agg(DISTINCT ca.scope)) THEN 'form'
        ELSE 'lemma'
      END AS assigned_group
    FROM candidate_anchors ca
    GROUP BY ca.note_id
  ),
  classified_notes AS (
    SELECT
      n.id AS note_id,
      n.author_kind,
      sn.scopes,
      sn.assigned_group,
      n.created_at
    FROM scoped_notes sn
    JOIN public.notes n ON n.id = sn.note_id
    WHERE n.status = 'published'
      AND n.visibility = 'public'
  )
  SELECT
    (SELECT count(*)::int FROM classified_notes WHERE assigned_group = 'occurrence'),
    (SELECT count(*)::int FROM classified_notes WHERE assigned_group = 'form'),
    (SELECT count(*)::int FROM classified_notes WHERE assigned_group = 'lemma'),
    (SELECT count(*)::int FROM classified_notes WHERE author_kind = 'human'),
    (SELECT count(*)::int FROM classified_notes WHERE author_kind = 'ai'),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'body_md', n.body_md,
          'note_kind', n.note_kind,
          'language', n.language,
          'epistemic_layer', 'user_note',
          'author', jsonb_build_object(
            'id', a.id,
            'kind', a.author_kind,
            'display_name', a.display_name,
            'ai_provider', a.ai_provider,
            'ai_model', a.ai_model,
            'ai_client', a.ai_client
          ),
          'created_via', n.created_via,
          'review_status', n.review_status,
          'confidence', n.confidence,
          'status', n.status,
          'visibility', n.visibility,
          'version', n.version,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'source_context', coalesce(n.source_context, '{}'::jsonb),
          'anchors', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', anc.id,
                'kind', anc.anchor_kind,
                'role', anc.role,
                'label', anc.label,
                'ordinal', anc.ordinal,
                'verse_id', anc.verse_id,
                'end_verse_id', anc.end_verse_id,
                'word_position', anc.word_position,
                'word_id', anc.word_id,
                'lemma_id', anc.lemma_id,
                'concept_id', anc.concept_id,
                'place_id', anc.place_id,
                'event_id', anc.event_id,
                'target_note_id', anc.target_note_id,
                'external_uri', anc.external_uri,
                'block_id', anc.block_id,
                'element_ref', anc.element_ref
              ) ORDER BY anc.ordinal, anc.id
            )
            FROM public.note_anchors anc
            WHERE anc.note_id = n.id
          ), '[]'::jsonb),
          'connections', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'from_anchor_id', c.from_anchor_id,
                'to_anchor_id', c.to_anchor_id,
                'connection_type', c.connection_type,
                'type_label', ct.label,
                'inverse_label', ct.inverse_label,
                'category', ct.category,
                'custom_label', c.custom_label,
                'direction', c.direction,
                'explanation', c.explanation
              ) ORDER BY c.id
            )
            FROM public.note_connections c
            LEFT JOIN public.note_connection_types ct ON ct.type_key = c.connection_type
            WHERE c.note_id = n.id
          ), '[]'::jsonb),
          'blocks', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'ordinal', b.ordinal,
                'block_type', b.block_type,
                'content', b.content,
                'text_alternative', b.text_alternative
              ) ORDER BY b.ordinal, b.id
            )
            FROM public.note_blocks b
            WHERE b.note_id = n.id
          ), '[]'::jsonb),
          'scopes', to_jsonb(sub.scopes)
        ) ORDER BY sub.created_at DESC, sub.note_id DESC
      )
      FROM (
        SELECT cn.note_id, cn.scopes, cn.created_at
        FROM classified_notes cn
        WHERE cn.assigned_group = 'occurrence'
        ORDER BY cn.created_at DESC, cn.note_id DESC
        LIMIT v_limit
      ) sub
      JOIN public.notes n ON n.id = sub.note_id
      JOIN public.note_authors a ON a.id = n.author_id
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'body_md', n.body_md,
          'note_kind', n.note_kind,
          'language', n.language,
          'epistemic_layer', 'user_note',
          'author', jsonb_build_object(
            'id', a.id,
            'kind', a.author_kind,
            'display_name', a.display_name,
            'ai_provider', a.ai_provider,
            'ai_model', a.ai_model,
            'ai_client', a.ai_client
          ),
          'created_via', n.created_via,
          'review_status', n.review_status,
          'confidence', n.confidence,
          'status', n.status,
          'visibility', n.visibility,
          'version', n.version,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'source_context', coalesce(n.source_context, '{}'::jsonb),
          'anchors', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', anc.id,
                'kind', anc.anchor_kind,
                'role', anc.role,
                'label', anc.label,
                'ordinal', anc.ordinal,
                'verse_id', anc.verse_id,
                'end_verse_id', anc.end_verse_id,
                'word_position', anc.word_position,
                'word_id', anc.word_id,
                'lemma_id', anc.lemma_id,
                'concept_id', anc.concept_id,
                'place_id', anc.place_id,
                'event_id', anc.event_id,
                'target_note_id', anc.target_note_id,
                'external_uri', anc.external_uri,
                'block_id', anc.block_id,
                'element_ref', anc.element_ref
              ) ORDER BY anc.ordinal, anc.id
            )
            FROM public.note_anchors anc
            WHERE anc.note_id = n.id
          ), '[]'::jsonb),
          'connections', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'from_anchor_id', c.from_anchor_id,
                'to_anchor_id', c.to_anchor_id,
                'connection_type', c.connection_type,
                'type_label', ct.label,
                'inverse_label', ct.inverse_label,
                'category', ct.category,
                'custom_label', c.custom_label,
                'direction', c.direction,
                'explanation', c.explanation
              ) ORDER BY c.id
            )
            FROM public.note_connections c
            LEFT JOIN public.note_connection_types ct ON ct.type_key = c.connection_type
            WHERE c.note_id = n.id
          ), '[]'::jsonb),
          'blocks', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'ordinal', b.ordinal,
                'block_type', b.block_type,
                'content', b.content,
                'text_alternative', b.text_alternative
              ) ORDER BY b.ordinal, b.id
            )
            FROM public.note_blocks b
            WHERE b.note_id = n.id
          ), '[]'::jsonb),
          'scopes', to_jsonb(sub.scopes)
        ) ORDER BY sub.created_at DESC, sub.note_id DESC
      )
      FROM (
        SELECT cn.note_id, cn.scopes, cn.created_at
        FROM classified_notes cn
        WHERE cn.assigned_group = 'form'
        ORDER BY cn.created_at DESC, cn.note_id DESC
        LIMIT v_limit
      ) sub
      JOIN public.notes n ON n.id = sub.note_id
      JOIN public.note_authors a ON a.id = n.author_id
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'body_md', n.body_md,
          'note_kind', n.note_kind,
          'language', n.language,
          'epistemic_layer', 'user_note',
          'author', jsonb_build_object(
            'id', a.id,
            'kind', a.author_kind,
            'display_name', a.display_name,
            'ai_provider', a.ai_provider,
            'ai_model', a.ai_model,
            'ai_client', a.ai_client
          ),
          'created_via', n.created_via,
          'review_status', n.review_status,
          'confidence', n.confidence,
          'status', n.status,
          'visibility', n.visibility,
          'version', n.version,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'source_context', coalesce(n.source_context, '{}'::jsonb),
          'anchors', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', anc.id,
                'kind', anc.anchor_kind,
                'role', anc.role,
                'label', anc.label,
                'ordinal', anc.ordinal,
                'verse_id', anc.verse_id,
                'end_verse_id', anc.end_verse_id,
                'word_position', anc.word_position,
                'word_id', anc.word_id,
                'lemma_id', anc.lemma_id,
                'concept_id', anc.concept_id,
                'place_id', anc.place_id,
                'event_id', anc.event_id,
                'target_note_id', anc.target_note_id,
                'external_uri', anc.external_uri,
                'block_id', anc.block_id,
                'element_ref', anc.element_ref
              ) ORDER BY anc.ordinal, anc.id
            )
            FROM public.note_anchors anc
            WHERE anc.note_id = n.id
          ), '[]'::jsonb),
          'connections', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'from_anchor_id', c.from_anchor_id,
                'to_anchor_id', c.to_anchor_id,
                'connection_type', c.connection_type,
                'type_label', ct.label,
                'inverse_label', ct.inverse_label,
                'category', ct.category,
                'custom_label', c.custom_label,
                'direction', c.direction,
                'explanation', c.explanation
              ) ORDER BY c.id
            )
            FROM public.note_connections c
            LEFT JOIN public.note_connection_types ct ON ct.type_key = c.connection_type
            WHERE c.note_id = n.id
          ), '[]'::jsonb),
          'blocks', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'ordinal', b.ordinal,
                'block_type', b.block_type,
                'content', b.content,
                'text_alternative', b.text_alternative
              ) ORDER BY b.ordinal, b.id
            )
            FROM public.note_blocks b
            WHERE b.note_id = n.id
          ), '[]'::jsonb),
          'scopes', to_jsonb(sub.scopes)
        ) ORDER BY sub.created_at DESC, sub.note_id DESC
      )
      FROM (
        SELECT cn.note_id, cn.scopes, cn.created_at
        FROM classified_notes cn
        WHERE cn.assigned_group = 'lemma'
        ORDER BY cn.created_at DESC, cn.note_id DESC
        LIMIT v_limit
      ) sub
      JOIN public.notes n ON n.id = sub.note_id
      JOIN public.note_authors a ON a.id = n.author_id
    ), '[]'::jsonb)
  INTO
    v_occ_total,
    v_form_total,
    v_lemma_total,
    v_human_total,
    v_ai_total,
    v_occurrence_list,
    v_form_list,
    v_lemma_list;

  v_result := jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'groups', jsonb_build_object(
      'occurrence', v_occurrence_list,
      'form', v_form_list,
      'lemma', v_lemma_list
    ),
    'totals', jsonb_build_object(
      'occurrence', v_occ_total,
      'form', v_form_total,
      'lemma', v_lemma_total,
      'human', v_human_total,
      'ai', v_ai_total,
      'total', v_occ_total + v_form_total + v_lemma_total
    ),
    'lemmas', v_lemmas
  );

  RETURN v_result;
END;
$function$;
