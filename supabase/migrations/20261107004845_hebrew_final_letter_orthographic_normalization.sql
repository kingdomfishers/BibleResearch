create or replace function public.suggest_orthographic_candidates_v1(
 p_query text,
 p_limit integer default 20,
 p_min_chars integer default 2
) returns jsonb
language plpgsql stable security invoker
set search_path=''
set statement_timeout='8s'
as $function$
declare
 v_packet jsonb;
 v_candidates jsonb;
 v_count integer;
begin
 if p_limit not between 1 and 50 or p_min_chars not between 2 and 5 then
  return jsonb_build_object('schema_version',1,'status','invalid_request','message','p_limit must be 1-50 and p_min_chars 2-5');
 end if;
 v_packet:=public.get_word_formation_v1(p_query,null);
 if v_packet->>'status'<>'ok' then
  return jsonb_build_object('schema_version',1,'status',v_packet->>'status','query',p_query);
 end if;
 with targets as (
   select distinct l.id,l.lemma_stripped,l.language,l.base_strongs,l.lemma_key,
      translate(l.lemma_stripped,'ךםןףץ','כמנפצ') search_form
   from jsonb_array_elements(v_packet->'matched_lemmas') m
   join public.lemmas l on l.id=(m->>'lemma_id')::bigint
   where char_length(l.lemma_stripped)>=p_min_chars
 ),
 pool as (
   select c.id,c.lemma_key,c.base_strongs,c.lemma_script,c.transliteration,c.language,
       lx.primary_gloss,
       translate(c.lemma_stripped,'ךםןףץ','כמנפצ') search_form
   from public.lemmas c
   left join public.lexemes lx on lx.id=c.primary_lexeme_id
   where char_length(c.lemma_stripped)>=p_min_chars
 ),
 matched as (
   select t.lemma_key source_lemma_key,t.base_strongs source_strongs,
       c.id candidate_id,c.lemma_key candidate_lemma_key,c.base_strongs candidate_strongs,
       c.lemma_script candidate_script,c.transliteration candidate_transliteration,
       c.primary_gloss candidate_gloss,
       case when position(c.search_form in t.search_form)>0 then 'candidate_inside_query'
            else 'query_inside_candidate' end overlap_kind,
       case when left(t.search_form,char_length(c.search_form))=c.search_form then 'start'
            when right(t.search_form,char_length(c.search_form))=c.search_form then 'end'
            when left(c.search_form,char_length(t.search_form))=t.search_form then 'query_at_start'
            when right(c.search_form,char_length(t.search_form))=t.search_form then 'query_at_end'
            else 'internal' end overlap_position,
       least(char_length(t.search_form),char_length(c.search_form)) overlap_chars,
       (case when position(c.search_form in t.search_form)>0 then 2 else 1 end) +
       (case when left(t.search_form,char_length(c.search_form))=c.search_form
                  or right(t.search_form,char_length(c.search_form))=c.search_form then 2 else 0 end) heuristic_rank
   from targets t
   join pool c on c.language=t.language and c.id<>t.id and c.search_form<>t.search_form
   where position(c.search_form in t.search_form)>0 or position(t.search_form in c.search_form)>0
 ),
 dedup as (
   select distinct on (candidate_id) *
   from matched
   order by candidate_id,heuristic_rank desc,overlap_chars desc,source_lemma_key
 ),
 ranked as (
   select * from dedup order by heuristic_rank desc,overlap_chars desc,candidate_lemma_key limit p_limit
 )
 select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
    'evidence_status','unverified_candidate',
    'relation_type','consonantal_substring',
    'etymological_inference',false
 ) order by heuristic_rank desc,overlap_chars desc,candidate_lemma_key),'[]'::jsonb),
 count(*) into v_candidates,v_count from ranked r;
 return jsonb_build_object(
   'schema_version',1,'status','ok','query',p_query,
   'method','normalized_hebrew_medial_final_consonantal_substring_v1',
   'language_scope','same_language_only',
   'returned_count',v_count,'limit',p_limit,
   'candidate_connections',v_candidates,
   'limitations','Substring resemblance alone provides no evidence of etymology, morphology, synonymy or intentional wordplay. Heuristic ranks are not confidence scores. Output is bounded and not exhaustive.'
 );
end
$function$;
