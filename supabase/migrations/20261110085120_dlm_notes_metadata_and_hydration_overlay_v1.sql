-- DLM evidence-classified note overlay, deployed 2026-11-10.

-- This file records the actual live function definitions and exact migration version.

-- Preserves legacy notes and supports only public, published, RLS-visible DLM notes.

CREATE OR REPLACE FUNCTION public.dlm_note_metadata_valid_v1(meta jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE item jsonb; n integer; cls text; kind text;
BEGIN
 IF meta IS NULL OR jsonb_typeof(meta)<>'object' THEN RETURN false; END IF;
 IF meta->>'schema_version'<>'1' THEN RETURN false; END IF;
 cls:=meta->>'evidence_class'; kind:=meta->>'card_kind';
 IF kind IS NULL OR kind NOT IN ('lexical_definition','biblical_definition','text_observation','explicit_symbol','literary_connection','narrative_event','physical_mechanism','dlm_layer_hypothesis','unresolved_question') THEN RETURN false; END IF;
 IF cls IS NULL OR cls NOT IN ('TEXT_EXPLICIT','TEXT_LINGUISTIC','TEXT_INTERTEXTUAL','TEXT_PATTERN','SCIENCE_EMPIRICAL','DLM_HYPOTHESIS','DISPUTED','OPEN') THEN RETURN false; END IF;
 IF jsonb_typeof(meta->'claim')<>'string' OR length(btrim(meta->>'claim'))<12 OR length(meta->>'claim')>600 THEN RETURN false; END IF;
 IF jsonb_typeof(meta->'scope')<>'string' OR length(btrim(meta->>'scope'))<5 OR length(meta->>'scope')>1000 THEN RETURN false; END IF;
 IF meta ? 'form_flow' AND (meta->>'form_flow') NOT IN ('structure','flow','both','neither','unknown') THEN RETURN false; END IF;
 IF NOT meta ? 'layers' OR jsonb_typeof(meta->'layers')<>'array' OR jsonb_array_length(meta->'layers')>8 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'layers') LOOP
   IF jsonb_typeof(item)<>'number' OR item::text NOT IN ('0','1','2','3','4','5','6','7') THEN RETURN false; END IF;
 END LOOP;
 IF NOT meta ? 'scriptures' OR jsonb_typeof(meta->'scriptures')<>'array' OR jsonb_array_length(meta->'scriptures')<1 OR jsonb_array_length(meta->'scriptures')>8 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'scriptures') LOOP
   IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'book')<>'number' OR jsonb_typeof(item->'chapter')<>'number'
     OR jsonb_typeof(item->'verse')<>'number' THEN RETURN false; END IF;
   IF (item->>'book')::integer NOT BETWEEN 1 AND 66 OR (item->>'chapter')::integer NOT BETWEEN 1 AND 150 OR (item->>'verse')::integer NOT BETWEEN 0 AND 176 THEN RETURN false; END IF;
   IF item ? 'word_position' AND (jsonb_typeof(item->'word_position')<>'number' OR (item->>'word_position')::integer<1) THEN RETURN false; END IF;
 END LOOP;
 IF NOT meta ? 'science_sources' OR jsonb_typeof(meta->'science_sources')<>'array' OR jsonb_array_length(meta->'science_sources')>6 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'science_sources') LOOP
   IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'title')<>'string' OR length(btrim(item->>'title'))<4
     OR jsonb_typeof(item->'url')<>'string' OR (item->>'url') !~* '^https://[^[:space:]<>"]{4,500}$' THEN RETURN false; END IF;
 END LOOP;
 IF cls='SCIENCE_EMPIRICAL' AND jsonb_array_length(meta->'science_sources')=0 THEN RETURN false; END IF;
 IF kind='physical_mechanism' AND cls<>'SCIENCE_EMPIRICAL' THEN RETURN false; END IF;
 IF kind='dlm_layer_hypothesis' AND cls<>'DLM_HYPOTHESIS' THEN RETURN false; END IF;
 IF kind='dlm_layer_hypothesis' AND jsonb_array_length(meta->'layers')=0 THEN RETURN false; END IF;
 IF kind='lexical_definition' AND cls<>'TEXT_LINGUISTIC' THEN RETURN false; END IF;
 IF kind='explicit_symbol' AND cls NOT IN ('TEXT_EXPLICIT','TEXT_INTERTEXTUAL') THEN RETURN false; END IF;
 IF kind='unresolved_question' AND cls NOT IN ('OPEN','DISPUTED') THEN RETURN false; END IF;
 IF meta ? 'limitations' AND (jsonb_typeof(meta->'limitations')<>'string' OR length(meta->>'limitations')>1200) THEN RETURN false; END IF;
 IF meta ? 'counterexamples' THEN
   IF jsonb_typeof(meta->'counterexamples')<>'array' OR jsonb_array_length(meta->'counterexamples')>8 THEN RETURN false; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(meta->'counterexamples') LOOP
      IF jsonb_typeof(item)<>'string' OR length(item #>> '{}')>500 THEN RETURN false; END IF;
   END LOOP;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

ALTER TABLE public.notes ADD CONSTRAINT chk_notes_dlm_v1_valid CHECK (NOT (source_context ? 'dlm_v1') OR public.dlm_note_metadata_valid_v1(source_context->'dlm_v1'));

CREATE INDEX IF NOT EXISTS idx_notes_dlm_v1_published ON public.notes (review_status,updated_at DESC,id) WHERE status='published' AND visibility='public' AND source_context ? 'dlm_v1';

CREATE OR REPLACE FUNCTION public.verify_dlm_lemma_occurrence_v1(p_lemma_id bigint, p_word_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '4s'
AS $function$
 SELECT EXISTS(
   SELECT 1 FROM public.word_form_lemmas wfl
   WHERE wfl.lemma_id=p_lemma_id AND wfl.word_id=p_word_id
     AND wfl.is_context_ambiguous IS FALSE
 )
$function$
;

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
         SELECT 1 FROM public.word_form_lemmas wfl
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
END $function$
;

REVOKE ALL ON FUNCTION public.dlm_note_metadata_valid_v1(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.verify_dlm_lemma_occurrence_v1(bigint,integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_dlm_notes_for_verse_v1(integer,integer,integer,integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.verify_dlm_lemma_occurrence_v1(bigint,integer) TO anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.get_dlm_notes_for_verse_v1(integer,integer,integer,integer) TO anon,authenticated,service_role;

