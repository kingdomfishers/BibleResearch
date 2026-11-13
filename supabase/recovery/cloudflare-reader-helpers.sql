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
