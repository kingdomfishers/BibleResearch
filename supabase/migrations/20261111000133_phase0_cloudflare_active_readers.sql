-- Non-destructive reader migration. No table data is removed.
BEGIN;
-- BEGIN LIVE SOURCE GUARD
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset('[{"schema":"bible_internal","name":"call_corpus_rpc_v1","identity_arguments":"p_operation text, p_params jsonb","md5":"1ee9c39bf1d32bf369896847c2dc6735","acl":"{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"schema":"public","name":"get_dlm_notes_for_verse_v1","identity_arguments":"p_book integer, p_chapter integer, p_verse integer, p_limit integer","md5":"1bb68d123104b699211b143807f7c263","acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"schema":"public","name":"get_notes_for_passage_v1","identity_arguments":"p_book integer, p_chapter integer, p_verse_start integer, p_verse_end integer, p_author_kind text, p_note_kind text, p_limit integer","md5":"2656a9085c8f68dc7f1abea2339ba63f","acl":"{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}"},{"schema":"public","name":"get_static_corpus_manifest_meta_v1","identity_arguments":"","md5":"213bc78e9bef909ed7cd9c61c173fb8a","acl":"{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}"},{"schema":"public","name":"research_passage_lens_v1","identity_arguments":"p_book integer, p_chapter integer, p_verse integer, p_max_tokens integer","md5":"2a478fed7bf771940ae7d967875ef24b","acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"schema":"public","name":"research_word_bridge_v1","identity_arguments":"p_left text, p_right text, p_limit integer, p_window integer","md5":"1348da34b9a065908c092b0adbc7c560","acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"schema":"public","name":"research_word_lens_v1","identity_arguments":"p_query text, p_limit integer","md5":"9364b8871eaec700ccbf16ad55734579","acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"schema":"public","name":"verify_dlm_lemma_occurrence_v1","identity_arguments":"p_lemma_id bigint, p_word_id integer","md5":"5e04fd466471e27d3ded6ee58b7e0d1f","acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}]'::jsonb) e(schema text,name text,identity_arguments text,md5 text)
 LEFT JOIN pg_namespace n ON n.nspname=e.schema LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.name AND pg_get_function_identity_arguments(p.oid)=e.identity_arguments
 WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM e.md5)
 THEN RAISE EXCEPTION 'New deployed reader changes must be reconciled before Phase 0 migration'; END IF;
END $guard$;
-- END LIVE SOURCE GUARD
CREATE OR REPLACE FUNCTION bible_internal.call_corpus_rpc_v1(p_operation text, p_params jsonb DEFAULT '{}'::jsonb)
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

  IF p_operation IN ('audit_evidence_coverage_v1','verify_referential_integrity_v1','validate_syntax_tree_integrity_v1','get_hebrew_import_status_v1') THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'Required static corpus unavailable: %',p_operation USING ERRCODE='53300';
END;
$function$;
-- Bounded immutable-source retrieval. Cache lifetime is the current transaction only.
CREATE OR REPLACE FUNCTION bible_internal.require_corpus_rpc_v1(p_operation text, p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $fn$
DECLARE v jsonb; k text := 'bible.corpus_' || md5(p_operation || p_params::text);
BEGIN
  v := nullif(current_setting(k,true),'')::jsonb;
  IF v IS NULL THEN
    v := bible_internal.call_corpus_rpc_v1(p_operation,p_params);
    IF v IS NULL OR jsonb_typeof(v) <> 'object' OR v->>'status' IS DISTINCT FROM 'ok' THEN
      RAISE EXCEPTION 'Required static corpus unavailable: %',p_operation USING ERRCODE='53300';
    END IF;
    PERFORM set_config(k,v::text,true);
  END IF;
  RETURN v;
END $fn$;

CREATE OR REPLACE FUNCTION bible_internal.word_form_lemmas_for_words_v1(p_word_ids integer[])
RETURNS SETOF public.word_form_lemmas LANGUAGE plpgsql STABLE SET search_path = '' AS $fn$
DECLARE ids integer[]; v jsonb;
BEGIN
  SELECT array_agg(w.id ORDER BY w.id) INTO ids FROM public.words w WHERE w.id=ANY(p_word_ids);
  IF ids IS NULL THEN RETURN; END IF;
  IF cardinality(ids)>5000 THEN RAISE EXCEPTION 'Word-form batch exceeds 5000 words' USING ERRCODE='22023'; END IF;
  v:=bible_internal.require_corpus_rpc_v1('get_word_form_lemmas_batch_v1',jsonb_build_object('p_word_ids',ids));
  IF jsonb_typeof(v->'words') IS DISTINCT FROM 'object' OR EXISTS(
    SELECT 1 FROM unnest(ids) id WHERE NOT (v->'words' ? id::text)
      OR jsonb_typeof(v->'words'->id::text->'word_form_lemmas') IS DISTINCT FROM 'array'
  ) THEN RAISE EXCEPTION 'Incomplete static word-form evidence' USING ERRCODE='53300'; END IF;
  RETURN QUERY SELECT r.* FROM jsonb_each(v->'words') w
    CROSS JOIN LATERAL jsonb_array_elements(w.value->'word_form_lemmas') a
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public.word_form_lemmas,a.value||jsonb_build_object('word_id',w.key::integer)) r;
END $fn$;

CREATE OR REPLACE FUNCTION bible_internal.corpus_source_gloss_v1(p_verse_id integer,p_position integer)
RETURNS text LANGUAGE plpgsql STABLE COST 10000 SET search_path = '' AS $fn$
DECLARE v jsonb; t jsonb;
BEGIN
  v:=bible_internal.require_corpus_rpc_v1('get_verse_translation_sources_batch_v1',jsonb_build_object('p_verse_ids',jsonb_build_array(p_verse_id)));
  SELECT x.value INTO t FROM jsonb_array_elements(v->'verses'->p_verse_id::text) x
    WHERE (x.value->>'word_position')::integer=p_position;
  IF t IS NULL THEN RAISE EXCEPTION 'Static token evidence missing for verse % position %',p_verse_id,p_position USING ERRCODE='53300'; END IF;
  RETURN t->>'source_english';
END $fn$;

CREATE OR REPLACE FUNCTION bible_internal.corpus_english_v1(p_book integer,p_chapter integer,p_verse integer)
RETURNS text LANGUAGE plpgsql STABLE COST 10000 SET search_path = '' AS $fn$
DECLARE v jsonb;
BEGIN
  v:=bible_internal.require_corpus_rpc_v1('get_reader_passages_v1',jsonb_build_object('p_passages',jsonb_build_array(jsonb_build_object('book',p_book,'chapter',p_chapter,'verse',p_verse))));
  IF jsonb_array_length(v->'passages') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Static English passage evidence missing' USING ERRCODE='53300';
  END IF;
  RETURN v->'passages'->0->>'text';
END $fn$;

-- The canonical spine already retains exact word order; no immutable data is duplicated.
CREATE OR REPLACE VIEW bible_internal.corpus_tokens WITH (security_invoker=true) AS
 SELECT v.id AS verse_id,u.word_id,u.position::integer AS word_position,
   bible_internal.corpus_source_gloss_v1(v.id,u.position::integer) AS source_english
 FROM public.verses v CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY u(word_id,position);
CREATE OR REPLACE VIEW bible_internal.corpus_english_verses WITH (security_invoker=true) AS
 SELECT v.book,v.chapter,v.verse_nr,'webp-2026-11'::text AS edition_id,
   bible_internal.corpus_english_v1(v.book,v.chapter,v.verse_nr) AS text FROM public.verses v;

REVOKE ALL ON FUNCTION bible_internal.require_corpus_rpc_v1(text,jsonb),
 bible_internal.word_form_lemmas_for_words_v1(integer[]),
 bible_internal.corpus_source_gloss_v1(integer,integer),
 bible_internal.corpus_english_v1(integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bible_internal.require_corpus_rpc_v1(text,jsonb),
 bible_internal.word_form_lemmas_for_words_v1(integer[]),
 bible_internal.corpus_source_gloss_v1(integer,integer),
 bible_internal.corpus_english_v1(integer,integer,integer) TO anon,authenticated,service_role;
GRANT SELECT ON bible_internal.corpus_tokens,bible_internal.corpus_english_verses TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_dlm_notes_for_verse_v1(p_book integer, p_chapter integer, p_verse integer, p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '8s'
AS $function$
DECLARE v_id integer; v_word_ids integer[]; v_limit integer:=least(greatest(coalesce(p_limit,8),1),20);
 v_total integer:=0; v_items jsonb:='[]'::jsonb;
BEGIN
 SELECT v.id,v.word_ids INTO v_id,v_word_ids FROM public.verses v WHERE v.book=p_book AND v.chapter=p_chapter AND v.verse_nr=p_verse;
 IF v_id IS NULL THEN RETURN jsonb_build_object('status','verse_not_found','notes_total',0,'items','[]'::jsonb); END IF;
 WITH matching AS (
  SELECT n.id, n.title, n.body_md, n.note_kind, n.author_kind, n.review_status,n.confidence,n.updated_at,n.version,
    n.source_context->'dlm_v1' meta,
    a.anchor_kind,a.word_position,
    CASE a.anchor_kind
      WHEN 'word_occurrence' THEN 0
      WHEN 'verse' THEN 1
      WHEN 'verse_range' THEN 2
      WHEN 'lemma' THEN 3
      WHEN 'word_form' THEN 4
      ELSE 9 END priority
  FROM public.notes n JOIN public.note_anchors a ON a.note_id=n.id
  WHERE n.status='published' AND n.visibility='public'
    AND n.source_context ? 'dlm_v1'
    AND (
      (a.anchor_kind IN ('word_occurrence','verse') AND a.verse_id=v_id)
      OR (a.anchor_kind='verse_range' AND v_id BETWEEN a.verse_id AND a.end_verse_id)
      OR (a.anchor_kind='word_form' AND a.word_id=ANY(v_word_ids))
      OR (a.anchor_kind='lemma' AND EXISTS (
         SELECT 1 FROM bible_internal.word_form_lemmas_for_words_v1(v_word_ids) wfl
         WHERE wfl.lemma_id=a.lemma_id AND wfl.word_id=ANY(v_word_ids) AND wfl.is_context_ambiguous IS FALSE
      ))
    )
 ), dedup AS (
  SELECT DISTINCT ON (id) *
  FROM matching ORDER BY id,priority,updated_at DESC
 ), ranked AS (
  SELECT * FROM dedup
  ORDER BY CASE review_status WHEN 'confirmed' THEN 0 WHEN 'unreviewed' THEN 1 ELSE 2 END,
    CASE meta->>'evidence_class' WHEN 'TEXT_EXPLICIT' THEN 0 WHEN 'TEXT_LINGUISTIC' THEN 1
      WHEN 'TEXT_INTERTEXTUAL' THEN 2 WHEN 'SCIENCE_EMPIRICAL' THEN 3 WHEN 'TEXT_PATTERN' THEN 4
      WHEN 'DLM_HYPOTHESIS' THEN 5 ELSE 6 END,
    priority,updated_at DESC,id
 ), chosen AS (SELECT * FROM ranked LIMIT v_limit)
 SELECT (SELECT count(*)::integer FROM ranked),
  COALESCE((SELECT jsonb_agg(
    jsonb_build_object(
      'note_id',x.id,'title',x.title,'claim',x.meta->>'claim','scope',x.meta->>'scope',
      'card_kind',x.meta->>'card_kind','evidence_class',x.meta->>'evidence_class',
      'layers',x.meta->'layers','form_flow',x.meta->>'form_flow',
      'scientific_sources',x.meta->'science_sources','counterexamples',x.meta->'counterexamples',
      'limitations',x.meta->>'limitations','scriptures',x.meta->'scriptures',
      'note_kind',x.note_kind,'review_status',x.review_status,'author_kind',x.author_kind,
      'confidence',x.confidence,'version',x.version,
      'match',x.anchor_kind,'matched_word_position',x.word_position,
      'excerpt',left(x.body_md,350),'full_note_tool','get_notes'
    ) ORDER BY CASE x.review_status WHEN 'confirmed' THEN 0 WHEN 'unreviewed' THEN 1 ELSE 2 END,
      x.priority,x.updated_at DESC,x.id
  ) FROM chosen x),'[]'::jsonb)
 INTO v_total,v_items;
 RETURN jsonb_build_object('schema_version',1,'status',CASE WHEN v_total=0 THEN 'no_dlm_notes' ELSE 'ok' END,
    'canonical_reference',jsonb_build_object('book',p_book,'chapter',p_chapter,'verse',p_verse,'verse_id',v_id),
    'epistemic_layer','research_commentary_not_scripture',
    'items',v_items,'coverage',jsonb_build_object('notes_total',v_total,'shown',jsonb_array_length(v_items),'truncated',v_total>v_limit,
       'restricted_to','published_public_dlm_notes','ranking','review status, evidence class, anchor specificity'),
    'warnings',jsonb_build_array('Even confirmed notes remain scholarly commentary, not canonical text.',
      'AI-generated notes are unreviewed until separately reviewed.',
      'DLM layer assignments are interpretive hypotheses, not empirical measurements or lexical senses.',
      'Scientific mechanisms are independent physical evidence and never prove theological analogies.'));
END $function$;

CREATE OR REPLACE FUNCTION public.get_notes_for_passage_v1(p_book integer, p_chapter integer, p_verse_start integer, p_verse_end integer DEFAULT NULL::integer, p_author_kind text DEFAULT NULL::text, p_note_kind text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '8s'
 SET jit TO 'off'
AS $function$
DECLARE
  v_verse_end int;
  v_limit int;
  v_verse_ids int[];
  v_min_vid int;
  v_max_vid int;
  v_primary_list jsonb;
  v_secondary_list jsonb;
  v_token_counts jsonb;
  v_primary_total int := 0;
  v_secondary_total int := 0;
  v_human_total int := 0;
  v_ai_total int := 0;
  v_result jsonb;
BEGIN
  IF p_book IS NULL OR p_chapter IS NULL OR p_verse_start IS NULL OR p_verse_start < 0 THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'user_note',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse_start', p_verse_start, 'verse_end', p_verse_end, 'verse_ids', '[]'::jsonb),
      'primary', '[]'::jsonb,
      'secondary', '[]'::jsonb,
      'totals', jsonb_build_object('primary', 0, 'secondary', 0, 'human', 0, 'ai', 0, 'total', 0),
      'truncated', jsonb_build_object('primary', false, 'secondary', false),
      'token_note_counts', '[]'::jsonb
    );
  END IF;

  v_verse_end := greatest(p_verse_start, coalesce(p_verse_end, p_verse_start));
  IF v_verse_end - p_verse_start + 1 > 100 THEN
    v_verse_end := p_verse_start + 99;
  END IF;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  SELECT array_agg(v.id ORDER BY v.id), min(v.id), max(v.id)
  INTO v_verse_ids, v_min_vid, v_max_vid
  FROM public.verses v
  WHERE v.book = p_book
    AND v.chapter = p_chapter
    AND v.verse_nr BETWEEN p_verse_start AND v_verse_end;

  IF v_verse_ids IS NULL OR array_length(v_verse_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'user_note',
      'passage', jsonb_build_object('book', p_book, 'chapter', p_chapter, 'verse_start', p_verse_start, 'verse_end', v_verse_end, 'verse_ids', '[]'::jsonb),
      'primary', '[]'::jsonb,
      'secondary', '[]'::jsonb,
      'totals', jsonb_build_object('primary', 0, 'secondary', 0, 'human', 0, 'ai', 0, 'total', 0),
      'truncated', jsonb_build_object('primary', false, 'secondary', false),
      'token_note_counts', '[]'::jsonb
    );
  END IF;

  WITH passage_tokens AS (
    SELECT pv.id AS verse_id, pos.ord::int AS word_position, pos.val::int AS word_id
    FROM public.verses pv,
    unnest(pv.word_ids) WITH ORDINALITY AS pos(val, ord)
    WHERE pv.id = ANY(v_verse_ids)
  ),
  passage_words AS (
    SELECT DISTINCT word_id FROM passage_tokens
  ),
  passage_lemmas AS (
    SELECT DISTINCT l.id AS lemma_id, pw.word_id
    FROM passage_words pw
    JOIN bible_internal.word_form_lemmas_for_words_v1(ARRAY(SELECT word_id FROM passage_words)) wfl ON wfl.word_id = pw.word_id
      AND wfl.lemma_id IS NOT NULL
      AND wfl.is_context_ambiguous IS FALSE
    JOIN public.lemmas l ON l.id = wfl.lemma_id
  ),
  primary_matches AS (
    SELECT
      anc.note_id,
      CASE
        WHEN anc.anchor_kind = 'verse' THEN 'verse:' || anc.verse_id::text
        WHEN anc.anchor_kind = 'verse_range' THEN 'verse_range:' || anc.verse_id::text || '-' || anc.end_verse_id::text
        WHEN anc.anchor_kind = 'word_occurrence' THEN 'word_occurrence:' || anc.verse_id::text || ':' || anc.word_position::text
      END AS reason,
      anc.anchor_kind,
      anc.verse_id,
      anc.word_position,
      anc.word_id
    FROM public.note_anchors anc
    WHERE (
      (anc.anchor_kind = 'verse' AND anc.verse_id = ANY(v_verse_ids))
      OR (anc.anchor_kind = 'verse_range' AND anc.verse_id <= v_max_vid AND anc.end_verse_id >= v_min_vid AND EXISTS (
            SELECT 1 FROM unnest(v_verse_ids) x WHERE x BETWEEN anc.verse_id AND anc.end_verse_id
          ))
      OR (anc.anchor_kind = 'word_occurrence' AND anc.verse_id = ANY(v_verse_ids))
    )
  ),
  primary_summary AS (
    SELECT
      pm.note_id,
      array_agg(DISTINCT pm.reason) AS reasons,
      coalesce(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'verse_id', pm.verse_id,
            'word_position', pm.word_position,
            'word_id', pm.word_id
          )
        ) FILTER (WHERE pm.anchor_kind = 'word_occurrence'),
        '[]'::jsonb
      ) AS positions
    FROM primary_matches pm
    GROUP BY pm.note_id
  ),
  primary_all AS (
    SELECT
      n.id AS note_id,
      n.author_kind,
      ps.reasons,
      ps.positions,
      n.created_at
    FROM primary_summary ps
    JOIN public.notes n ON n.id = ps.note_id
    WHERE n.status = 'published'
      AND n.visibility = 'public'
      AND (p_author_kind IS NULL OR n.author_kind = p_author_kind)
      AND (p_note_kind IS NULL OR n.note_kind = p_note_kind)
  ),
  secondary_matches AS (
    SELECT
      anc.note_id,
      'word_form:' || anc.word_id::text AS reason,
      pt.verse_id,
      pt.word_position,
      pt.word_id
    FROM public.note_anchors anc
    JOIN passage_tokens pt ON pt.word_id = anc.word_id
    WHERE anc.anchor_kind = 'word_form'
      AND NOT EXISTS (SELECT 1 FROM primary_summary ps WHERE ps.note_id = anc.note_id)

    UNION ALL

    SELECT
      anc.note_id,
      'lemma:' || anc.lemma_id::text AS reason,
      pt.verse_id,
      pt.word_position,
      pt.word_id
    FROM public.note_anchors anc
    JOIN passage_lemmas pl ON pl.lemma_id = anc.lemma_id
    JOIN passage_tokens pt ON pt.word_id = pl.word_id
    WHERE anc.anchor_kind = 'lemma'
      AND NOT EXISTS (SELECT 1 FROM primary_summary ps WHERE ps.note_id = anc.note_id)
  ),
  secondary_summary AS (
    SELECT
      sm.note_id,
      array_agg(DISTINCT sm.reason) AS reasons,
      coalesce(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'verse_id', sm.verse_id,
            'word_position', sm.word_position,
            'word_id', sm.word_id
          )
        ),
        '[]'::jsonb
      ) AS positions
    FROM secondary_matches sm
    GROUP BY sm.note_id
  ),
  secondary_all AS (
    SELECT
      n.id AS note_id,
      n.author_kind,
      ss.reasons,
      ss.positions,
      n.created_at
    FROM secondary_summary ss
    JOIN public.notes n ON n.id = ss.note_id
    WHERE n.status = 'published'
      AND n.visibility = 'public'
      AND (p_author_kind IS NULL OR n.author_kind = p_author_kind)
      AND (p_note_kind IS NULL OR n.note_kind = p_note_kind)
  ),
  token_counts_agg AS (
    SELECT
      anc.verse_id,
      anc.word_position,
      count(*) FILTER (WHERE n.author_kind = 'human')::int AS human,
      count(*) FILTER (WHERE n.author_kind = 'ai')::int AS ai
    FROM public.note_anchors anc
    JOIN public.notes n ON n.id = anc.note_id
    WHERE anc.anchor_kind = 'word_occurrence'
      AND anc.verse_id = ANY(v_verse_ids)
      AND n.status = 'published'
      AND n.visibility = 'public'
      AND (p_author_kind IS NULL OR n.author_kind = p_author_kind)
      AND (p_note_kind IS NULL OR n.note_kind = p_note_kind)
    GROUP BY anc.verse_id, anc.word_position
    ORDER BY anc.verse_id, anc.word_position
  )
  SELECT
    (SELECT count(*)::int FROM primary_all),
    (SELECT count(*)::int FROM secondary_all),
    (SELECT count(*)::int FROM (
       SELECT pa.note_id FROM primary_all pa WHERE pa.author_kind = 'human'
       UNION
       SELECT sa.note_id FROM secondary_all sa WHERE sa.author_kind = 'human'
     ) u),
    (SELECT count(*)::int FROM (
       SELECT pa.note_id FROM primary_all pa WHERE pa.author_kind = 'ai'
       UNION
       SELECT sa.note_id FROM secondary_all sa WHERE sa.author_kind = 'ai'
     ) u),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'verse_id', tc.verse_id,
          'word_position', tc.word_position,
          'human', tc.human,
          'ai', tc.ai
        )
      ) FROM token_counts_agg tc
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
          'tier', 'primary',
          'reasons', to_jsonb(p_sub.reasons),
          'positions', p_sub.positions
        ) ORDER BY p_sub.created_at DESC, p_sub.note_id DESC
      )
      FROM (
        SELECT pa.note_id, pa.reasons, pa.positions, pa.created_at
        FROM primary_all pa
        ORDER BY pa.created_at DESC, pa.note_id DESC
        LIMIT v_limit
      ) p_sub
      JOIN public.notes n ON n.id = p_sub.note_id
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
          'tier', 'secondary',
          'reasons', to_jsonb(s_sub.reasons),
          'positions', s_sub.positions
        ) ORDER BY s_sub.created_at DESC, s_sub.note_id DESC
      )
      FROM (
        SELECT sa.note_id, sa.reasons, sa.positions, sa.created_at
        FROM secondary_all sa
        ORDER BY sa.created_at DESC, sa.note_id DESC
        LIMIT v_limit
      ) s_sub
      JOIN public.notes n ON n.id = s_sub.note_id
      JOIN public.note_authors a ON a.id = n.author_id
    ), '[]'::jsonb)
  INTO
    v_primary_total,
    v_secondary_total,
    v_human_total,
    v_ai_total,
    v_token_counts,
    v_primary_list,
    v_secondary_list;

  v_result := jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'user_note',
    'passage', jsonb_build_object(
      'book', p_book,
      'chapter', p_chapter,
      'verse_start', p_verse_start,
      'verse_end', v_verse_end,
      'verse_ids', v_verse_ids
    ),
    'primary', v_primary_list,
    'secondary', v_secondary_list,
    'totals', jsonb_build_object(
      'primary', v_primary_total,
      'secondary', v_secondary_total,
      'human', v_human_total,
      'ai', v_ai_total,
      'total', v_primary_total + v_secondary_total
    ),
    'truncated', jsonb_build_object(
      'primary', v_primary_total > v_limit,
      'secondary', v_secondary_total > v_limit
    ),
    'token_note_counts', v_token_counts
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.research_passage_lens_v1(p_book integer, p_chapter integer, p_verse integer, p_max_tokens integer DEFAULT 75)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
DECLARE v_source jsonb;
  v_id integer;
  cap integer:=least(greatest(coalesce(p_max_tokens,75),10),120);
  total integer;
  tokens jsonb;
  language text;
BEGIN
 SELECT v.id INTO v_id FROM public.verses v WHERE v.book=p_book AND v.chapter=p_chapter AND v.verse_nr=p_verse;
 IF v_id IS NULL THEN RETURN jsonb_build_object('status','passage_not_found'); END IF;
 v_source:=bible_internal.require_corpus_rpc_v1('get_passage_lens_source_v1',jsonb_build_object('p_book',p_book,'p_chapter',p_chapter,'p_verse',p_verse));
 language:=CASE WHEN p_book<=39 THEN 'hebrew_aramaic' ELSE 'greek' END;
 IF p_book<=39 THEN
   SELECT count(*) INTO total FROM jsonb_populate_recordset(NULL::public.macula_hebrew_morphemes,v_source->'hebrew') m WHERE m.canonical_verse_id=v_id;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('word',x.word_no,'part',x.computed_morpheme_order,'source_morph_no',x.morph_no,'text',x.text_form,'lemma',x.lemma,'strongs_raw',x.strong_x,
     'morphology',x.morph_code,'class',x.class,'sense_annotation',x.sense_number,'subject_ref',x.subjref,
     'participant_ref',x.participantref,'source_id',x.source_record_id) ORDER BY x.word_no,x.morph_no,x.id),'[]'::jsonb)
   INTO tokens FROM (SELECT m.*,row_number() OVER (PARTITION BY m.word_no ORDER BY m.id) AS computed_morpheme_order FROM jsonb_populate_recordset(NULL::public.macula_hebrew_morphemes,v_source->'hebrew') m WHERE m.canonical_verse_id=v_id ORDER BY m.word_no,m.id LIMIT cap) x;
 ELSE
   SELECT count(*) INTO total FROM jsonb_populate_recordset(NULL::public.macula_greek_tokens,(SELECT coalesce(jsonb_agg(x||jsonb_build_object('frame',x->'semantic_frame_source')),'[]'::jsonb) FROM jsonb_array_elements(v_source->'greek') x)) m WHERE m.canonical_verse_id=v_id AND m.edition_key='macula-greek-nestle1904';
   SELECT COALESCE(jsonb_agg(jsonb_build_object('word',x.word_no,'text',x.text_form,'lemma',x.lemma,'strongs_raw',x.strongs,
     'morphology',x.morph_code,'grammatical_role',x.role,'semantic_frame_source',x.frame,
     'subject_ref',x.subjref,'referent',x.referent,'source_id',x.source_record_id)
     ORDER BY x.word_no,x.id),'[]'::jsonb)
   INTO tokens FROM (SELECT * FROM jsonb_populate_recordset(NULL::public.macula_greek_tokens,(SELECT coalesce(jsonb_agg(x||jsonb_build_object('frame',x->'semantic_frame_source')),'[]'::jsonb) FROM jsonb_array_elements(v_source->'greek') x)) WHERE canonical_verse_id=v_id
     AND edition_key='macula-greek-nestle1904' ORDER BY word_no,id LIMIT cap) x;
 END IF;
 RETURN jsonb_build_object('schema_version',1,'status','ok','reference',jsonb_build_object('book',p_book,'chapter',p_chapter,'verse',p_verse,'verse_id',v_id),
   'language',language,'macula_edition',CASE WHEN p_book<=39 THEN 'macula-hebrew-wlc' ELSE 'macula-greek-nestle1904' END,
   'english_web',(SELECT r.text FROM bible_internal.corpus_english_verses r WHERE r.book=p_book AND r.chapter=p_chapter AND r.verse_nr=p_verse AND r.edition_id='webp-2026-11' LIMIT 1),
   'tokens',tokens,'coverage',jsonb_build_object('source_token_rows',total,'returned',jsonb_array_length(tokens),'truncated',total>cap),
   'epistemic_notes',CASE WHEN p_book<=39 THEN jsonb_build_array(
      'MACULA Hebrew morphology and source sense/participant references, not automatically a verified lexical sense or semantic agent.',
      'Restricted SDBH semantic domains and unverified Hebrew frame are excluded.',
      'MACULA verse text may differ from the primary STEP reading; raw IDs are source-specific.')
    ELSE jsonb_build_array(
      'MACULA Greek role is grammatical; frame and discourse references are source annotations, not a verified theological claim.',
      'Edition Nestle1904 is not identical to NA28; do not merge its tokens by ordinal.',
      'Restricted Louw-Nida/MARBLE domains are excluded.') END,
   'next_step','Investigate exact token and phrase scope with get_verse_hydrated or research_macula_syntax. Detect negation, quoted voice and genre before interpretation.');
END $function$;

CREATE OR REPLACE FUNCTION public.research_word_bridge_v1(p_left text, p_right text, p_limit integer DEFAULT 8, p_window integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '12s'
AS $function$
DECLARE
 ql text := lower(btrim(coalesce(p_left,'')));
 qr text := lower(btrim(coalesce(p_right,'')));
 cl text;
 cr text;
 bl text;
 br text;
 left_codes text[];
 right_codes text[];
 left_ids integer[];
 right_ids integer[];
 lim integer:=least(greatest(coalesce(p_limit,8),1),12);
 win integer:=least(greatest(coalesce(p_window,1),0),2);
 result jsonb;
BEGIN
 IF length(ql)<1 OR length(qr)<1 OR length(ql)>96 OR length(qr)>96 THEN
   RETURN jsonb_build_object('status','invalid_query','message','Provide two valid 1-96 character terms.');
 END IF;
 cl:=upper(regexp_replace(ql,'^([hg])0*([0-9]+)([a-z]?)$','\1\2\3','i'));
 cr:=upper(regexp_replace(qr,'^([hg])0*([0-9]+)([a-z]?)$','\1\2\3','i'));
 bl:=regexp_replace(cl,'^([HG][0-9]+)[A-Z]$','\1');
 br:=regexp_replace(cr,'^([HG][0-9]+)[A-Z]$','\1');
 SELECT COALESCE(array_agg(DISTINCT s.base_strongs),'{}'::text[]) INTO left_codes
 FROM (
   SELECT l.base_strongs,
      CASE WHEN lower(l.lemma_key)=ql OR EXISTS(SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND upper(x.extended_strongs)=cl) THEN 0
           WHEN l.base_strongs=bl AND ql ~ '^[hg][0-9]+[a-z]?$' THEN 1
           WHEN lower(l.lemma_script)=ql OR lower(l.transliteration)=ql THEN 2
           WHEN EXISTS(SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND lower(btrim(x.primary_gloss))=ql) THEN 3
           WHEN EXISTS(SELECT 1 FROM public.lexical_senses x WHERE x.lemma_id=l.id AND
              (lower(btrim(x.short_gloss))=ql OR lower(btrim(split_part(x.short_gloss,':',2)))=ql)) THEN 4
           ELSE 99 END rank
   FROM public.lemmas l
 ) s WHERE s.rank<99 AND s.rank<=4;
 SELECT COALESCE(array_agg(DISTINCT s.base_strongs),'{}'::text[]) INTO right_codes
 FROM (
   SELECT l.base_strongs,
      CASE WHEN lower(l.lemma_key)=qr OR EXISTS(SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND upper(x.extended_strongs)=cr) THEN 0
           WHEN l.base_strongs=br AND qr ~ '^[hg][0-9]+[a-z]?$' THEN 1
           WHEN lower(l.lemma_script)=qr OR lower(l.transliteration)=qr THEN 2
           WHEN EXISTS(SELECT 1 FROM public.lexemes x WHERE x.lemma_id=l.id AND lower(btrim(x.primary_gloss))=qr) THEN 3
           WHEN EXISTS(SELECT 1 FROM public.lexical_senses x WHERE x.lemma_id=l.id AND
              (lower(btrim(x.short_gloss))=qr OR lower(btrim(split_part(x.short_gloss,':',2)))=qr)) THEN 4
           ELSE 99 END rank
   FROM public.lemmas l
 ) s WHERE s.rank<99 AND s.rank<=4;
 IF cardinality(left_codes)=0 OR cardinality(right_codes)=0 THEN
   RETURN jsonb_build_object('status','unresolved','left_codes',left_codes,'right_codes',right_codes,
      'message','One or both terms do not resolve by exact lexical identity/gloss; try Strong codes.');
 END IF;
 SELECT array_agg(id) INTO left_ids FROM public.words WHERE strongs_nr=ANY(left_codes);
 SELECT array_agg(id) INTO right_ids FROM public.words WHERE strongs_nr=ANY(right_codes);
 IF left_ids IS NULL OR right_ids IS NULL THEN
   RETURN jsonb_build_object('status','no_attested_tokens','left_codes',left_codes,'right_codes',right_codes);
 END IF;
 WITH left_verses AS (
   SELECT v.id,v.book,v.chapter,v.verse_nr FROM public.verses v WHERE v.word_ids && left_ids
 ), related AS (
   SELECT a.id AS left_id,a.book,a.chapter,a.verse_nr AS left_verse,b.id AS right_id,b.verse_nr AS right_verse,
     abs(b.verse_nr-a.verse_nr) AS distance
   FROM left_verses a JOIN public.verses b ON b.book=a.book AND b.chapter=a.chapter
     AND b.verse_nr BETWEEN a.verse_nr-win AND a.verse_nr+win
     AND b.word_ids && right_ids
 ), representatives AS (
   SELECT DISTINCT ON (book,chapter,left_verse,right_verse)
     * FROM related ORDER BY book,chapter,left_verse,right_verse,distance
 ), samples AS (
   SELECT * FROM representatives ORDER BY distance,book,chapter,left_verse,right_verse LIMIT lim
 )
 SELECT jsonb_build_object('schema_version',1,'status','ok','left_query',p_left,'right_query',p_right,
  'left_lexical_strongs',to_jsonb(left_codes),'right_lexical_strongs',to_jsonb(right_codes),
  'window_verses_within_chapter',win,'search_scope','canonical STEP verse word_ids; no across-chapter joins; text editions not double-counted',
  'relation_class','statistical_passage_proximity_only',
  'matches',COALESCE(jsonb_agg(jsonb_build_object(
    'type',CASE WHEN x.distance=0 THEN 'same_verse' ELSE 'adjacent_verse' END,
    'book',x.book,'chapter',x.chapter,'left_verse',x.left_verse,'right_verse',x.right_verse,
    'left_english_web',(SELECT re.text FROM bible_internal.corpus_english_verses re
        WHERE re.book=x.book AND re.chapter=x.chapter AND re.verse_nr=x.left_verse AND re.edition_id='webp-2026-11' LIMIT 1),
    'right_english_web',CASE WHEN x.distance=0 THEN NULL ELSE
        (SELECT re.text FROM bible_internal.corpus_english_verses re WHERE re.book=x.book AND re.chapter=x.chapter
           AND re.verse_nr=x.right_verse AND re.edition_id='webp-2026-11' LIMIT 1) END,
    'left_tokens',COALESCE((SELECT jsonb_agg(jsonb_build_object('position',t.word_position,'surface',w.original_word,
        'strongs',w.strongs_nr,'local_gloss',t.source_english) ORDER BY t.word_position)
      FROM bible_internal.corpus_tokens t JOIN public.words w ON w.id=t.word_id
      WHERE t.verse_id=x.left_id AND w.strongs_nr=ANY(left_codes)),'[]'::jsonb),
    'right_tokens',COALESCE((SELECT jsonb_agg(jsonb_build_object('position',t.word_position,'surface',w.original_word,
        'strongs',w.strongs_nr,'local_gloss',t.source_english) ORDER BY t.word_position)
      FROM bible_internal.corpus_tokens t JOIN public.words w ON w.id=t.word_id
      WHERE t.verse_id=x.right_id AND w.strongs_nr=ANY(right_codes)),'[]'::jsonb)
   ) ORDER BY x.distance,x.book,x.chapter,x.left_verse,x.right_verse),'[]'::jsonb),
  'sampling','First canonical matches prioritizing same-verse, then short adjacent-verse contexts; not exhaustive or importance ranked',
  'limits',jsonb_build_object('returned',count(*),'max',lim,'more_matches_possible',count(*)=lim),
  'epistemic_warning','Co-occurrence does NOT imply synonymy, metaphor, causation, action-role, typology or theological identity. Inspect grammar, discourse and counterexamples before proposing a relation.')
 INTO result FROM samples x;
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.research_word_lens_v1(p_query text, p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '12s'
AS $function$
DECLARE
  q text := lower(btrim(coalesce(p_query,'')));
  code text;
  base_code text;
  lim integer := least(greatest(coalesce(p_limit,5),1),8);
  result jsonb;
BEGIN
 IF length(q)<1 OR length(q)>96 THEN
  RETURN jsonb_build_object('status','invalid_query','message','Provide a 1-96 character Strong code, original lemma, transliteration, or exact lexical gloss.');
 END IF;
 code := upper(regexp_replace(q,'^([hg])0*([0-9]+)([a-z]?)$','\1\2\3','i'));
 base_code := regexp_replace(code,'^([HG][0-9]+)[A-Z]$','\1');
 WITH candidates AS (
   SELECT l.id,l.base_strongs,l.lemma_key,l.language,l.lemma_script,l.transliteration,l.primary_pos,
     CASE
       WHEN lower(l.lemma_key)=q OR EXISTS(SELECT 1 FROM public.lexemes lx WHERE lx.lemma_id=l.id AND upper(lx.extended_strongs)=code) THEN 0
       WHEN l.base_strongs=base_code AND q ~ '^h[0-9]+[a-z]?$|^g[0-9]+[a-z]?$' THEN 1
       WHEN lower(l.lemma_script)=q THEN 2
       WHEN lower(l.transliteration)=q THEN 3
       WHEN EXISTS(SELECT 1 FROM public.lexemes lx WHERE lx.lemma_id=l.id AND lower(btrim(lx.primary_gloss))=q) THEN 4
       WHEN EXISTS(SELECT 1 FROM public.lexical_senses s WHERE s.lemma_id=l.id AND
            (lower(btrim(s.short_gloss))=q OR lower(btrim(split_part(s.short_gloss,':',2)))=q)) THEN 5
       ELSE 99 END AS rank
   FROM public.lemmas l
 ), selected AS (
   SELECT * FROM candidates WHERE rank<99 ORDER BY rank,base_strongs,lemma_key LIMIT lim
 )
 SELECT jsonb_build_object('schema_version',1,'status',CASE WHEN count(*)>0 THEN 'ok' ELSE 'no_exact_lexical_match' END,
    'query',p_query,'resolution_policy','Exact Strong, original lemma, transliteration or lexicon gloss; no English substring search or automatic sense merge',
    'match_count_returned',count(*),'truncated_candidates_possible',count(*)=lim,
    'candidates',COALESCE(jsonb_agg(
      jsonb_build_object('lemma_id',s.id::text,'lemma_key',s.lemma_key,'strongs',s.base_strongs,
       'language',s.language,'original',s.lemma_script,'transliteration',s.transliteration,'pos',s.primary_pos,'resolution_rank',s.rank,
       'senses',COALESCE((
        SELECT jsonb_agg(jsonb_build_object('sense_id',z.id::text,'sense',z.short_gloss,'source',z.source_attribution)
           ORDER BY z.sense_order) FROM (
             SELECT * FROM public.lexical_senses ls WHERE ls.lemma_id=s.id ORDER BY ls.sense_order LIMIT 7
           ) z
       ),'[]'::jsonb),
       'root_links',COALESCE((
         SELECT jsonb_agg(jsonb_build_object('root_id',r.root_id::text,'relation',r.etymology_type,'source',r.source_record_id))
         FROM (SELECT * FROM public.lemma_root_links WHERE lemma_id=s.id LIMIT 5) r
       ),'[]'::jsonb),
       'occurrence_counts',(
         SELECT jsonb_build_object('tokens',count(*),'distinct_verses',count(DISTINCT t.verse_id),'source','STEP ordered word positions')
         FROM public.words w JOIN bible_internal.corpus_tokens t ON t.word_id=w.id WHERE w.strongs_nr=s.base_strongs
       ),
       'book_diverse_samples',COALESCE((
         SELECT jsonb_agg(jsonb_build_object('reference',format('%s:%s:%s',b.book,b.chapter,b.verse_nr),
             'book',b.book,'chapter',b.chapter,'verse',b.verse_nr,'word_position',b.word_position,
             'word_original',b.original_word,'word_gloss',bible_internal.corpus_source_gloss_v1(b.source_verse_id,b.word_position),'english_web',bible_internal.corpus_english_v1(b.book,b.chapter,b.verse_nr))
         ORDER BY b.book,b.chapter,b.verse_nr)
         FROM (
           SELECT DISTINCT ON (v.book) v.book,v.chapter,v.verse_nr,t.word_position,w.original_word,
             v.id AS source_verse_id
           FROM public.words w JOIN bible_internal.corpus_tokens t ON t.word_id=w.id
             JOIN public.verses v ON v.id=t.verse_id
           WHERE w.strongs_nr=s.base_strongs
           ORDER BY v.book,v.chapter,v.verse_nr,t.word_position LIMIT lim
         ) b
       ),'[]'::jsonb),
       'statistical_partners',COALESCE((
        SELECT jsonb_agg(jsonb_build_object('strongs',z.strongs_nr,'form',z.original_word,
         'gloss',z.primary_english,'pair_frequency',z.frequency,'avg_distance',z.avg_distance,'legacy_score',z.score))
        FROM (SELECT * FROM public.prompt_word_cooccurrences(s.base_strongs) LIMIT 5) z
       ),'[]'::jsonb)
      ) ORDER BY s.rank,s.base_strongs),'[]'::jsonb),
    'epistemic_notes',jsonb_build_array('A lemma is not a concept or a token-level sense assignment.',
      'Root membership is not synonymy or meaning.',
      'Book-diverse samples are not all occurrences nor proof of typical usage.',
      'Statistical partners are lexical proximity, not a theological relation.',
      'WEB is an independent English rendering, not an aligned gloss.'),
    'next_step','Inspect actual context with research_passage_lens or get_verse_hydrated; test semantic links with research_word_bridge.')
 INTO result FROM selected s;
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.verify_dlm_lemma_occurrence_v1(p_lemma_id bigint, p_word_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '4s'
AS $function$
 SELECT EXISTS(
   SELECT 1 FROM bible_internal.word_form_lemmas_for_words_v1(ARRAY[p_word_id]) wfl
   WHERE wfl.lemma_id=p_lemma_id AND wfl.word_id=p_word_id
     AND wfl.is_context_ambiguous IS FALSE
 )
$function$;
CREATE OR REPLACE FUNCTION public.get_static_corpus_manifest_meta_v1() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $fn$ SELECT bible_internal.require_corpus_rpc_v1('get_static_corpus_metadata_v1','{}'::jsonb)-'status' $fn$;
COMMIT;
