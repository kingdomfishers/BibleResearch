-- Tighten DLM source-domain classification: empirical science cannot be presented as biblical definition.
-- Matches deployed migration 20261110090355, preserves existing notes.

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
 IF kind='biblical_definition' AND cls NOT IN ('TEXT_EXPLICIT','TEXT_INTERTEXTUAL','TEXT_PATTERN') THEN RETURN false; END IF;
 IF kind='text_observation' AND cls NOT IN ('TEXT_EXPLICIT','TEXT_LINGUISTIC') THEN RETURN false; END IF;
 IF kind='literary_connection' AND cls NOT IN ('TEXT_INTERTEXTUAL','TEXT_PATTERN','DLM_HYPOTHESIS','DISPUTED') THEN RETURN false; END IF;
 IF kind='narrative_event' AND cls NOT IN ('TEXT_EXPLICIT','TEXT_PATTERN') THEN RETURN false; END IF;
 IF cls='SCIENCE_EMPIRICAL' AND kind<>'physical_mechanism' THEN RETURN false; END IF;
 IF cls='DLM_HYPOTHESIS' AND kind NOT IN ('dlm_layer_hypothesis','literary_connection') THEN RETURN false; END IF;
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
