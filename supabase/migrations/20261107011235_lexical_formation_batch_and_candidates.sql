-- Additive lexical formation batch ingestion and enhanced candidate discovery RPCs
-- Enhances suggest_orthographic_candidates_v1 with Greek final sigma normalization (ς -> σ)
-- Adds batch_suggest_orthographic_candidates_v1 with documented relationship cross-referencing
-- Adds ingest_lexical_formations_batch_v1 and ingest_quarantined_records_batch_v1 for deterministic batch ETL

-- 1. Batch ingestion of formations and components
create or replace function public.ingest_lexical_formations_batch_v1(p_formations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_formations_count int := 0;
  v_components_count int := 0;
  v_f record;
  v_formation_id bigint;
  v_c record;
begin
  for v_f in
    select
      (elem->>'lemma_id')::bigint as lemma_id,
      elem->>'analysis_key' as analysis_key,
      elem->>'formation_type' as formation_type,
      elem->>'whole_word_gloss' as whole_word_gloss,
      coalesce(elem->>'evidence_status', 'documented') as evidence_status,
      elem->>'evidence_note' as evidence_note,
      elem->>'source_title' as source_title,
      elem->>'source_url' as source_url,
      elem->>'source_record_id' as source_record_id,
      coalesce(elem->>'origin_mode', 'sourced') as origin_mode,
      elem->'components' as components
    from jsonb_array_elements(p_formations) elem
  loop
    insert into public.lexical_formations
      (lemma_id, analysis_key, formation_type, whole_word_gloss, evidence_status, evidence_note, source_title, source_url, source_record_id, origin_mode)
    values
      (v_f.lemma_id, v_f.analysis_key, v_f.formation_type, v_f.whole_word_gloss, v_f.evidence_status, v_f.evidence_note, v_f.source_title, v_f.source_url, v_f.source_record_id, v_f.origin_mode)
    on conflict (lemma_id, analysis_key) do nothing
    returning id into v_formation_id;

    if v_formation_id is null then
      select id into v_formation_id from public.lexical_formations where lemma_id = v_f.lemma_id and analysis_key = v_f.analysis_key;
    else
      v_formations_count := v_formations_count + 1;
    end if;

    if v_formation_id is not null and v_f.components is not null and jsonb_array_length(v_f.components) > 0 then
      for v_c in
        select
          (comp->>'order')::smallint as component_order,
          (comp->>'lemma_id')::bigint as component_lemma_id,
          (comp->>'lexeme_id')::bigint as component_lexeme_id,
          comp->>'surface_text' as surface_text,
          comp->>'role' as component_role,
          comp->>'semantic_contribution' as semantic_contribution,
          comp->>'note' as component_note
        from jsonb_array_elements(v_f.components) comp
      loop
        insert into public.lemma_components
          (formation_id, component_order, component_lemma_id, component_lexeme_id, surface_text, component_role, semantic_contribution, component_note)
        values
          (v_formation_id, v_c.component_order, v_c.component_lemma_id, v_c.component_lexeme_id, v_c.surface_text, v_c.component_role, v_c.semantic_contribution, v_c.component_note)
        on conflict (formation_id, component_order) do nothing;
        v_components_count := v_components_count + 1;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'formations_processed', jsonb_array_length(p_formations),
    'formations_inserted', v_formations_count,
    'components_inserted', v_components_count
  );
end;
$function$;

revoke all on function public.ingest_lexical_formations_batch_v1(jsonb) from public;
grant execute on function public.ingest_lexical_formations_batch_v1(jsonb) to anon,authenticated,service_role;
comment on function public.ingest_lexical_formations_batch_v1(jsonb) is 'Batch idempotent ingestion for documented lexical formations and ordered components.';

-- 2. Batch ingestion of quarantined evidence records
create or replace function public.ingest_quarantined_records_batch_v1(p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inserted int := 0;
begin
  insert into public.quarantined_evidence_records
    (dataset_key, source_record_id, entity_type, raw_payload, quarantine_reason, quarantine_status, quarantined_at)
  select
    r->>'dataset_key',
    r->>'source_record_id',
    r->>'entity_type',
    coalesce(r->'raw_payload', '{}'::jsonb),
    r->>'quarantine_reason',
    coalesce(r->>'quarantine_status', 'unresolved'),
    now()
  from jsonb_array_elements(p_records) r
  where not exists (
    select 1 from public.quarantined_evidence_records q
    where q.dataset_key = r->>'dataset_key'
      and q.source_record_id = r->>'source_record_id'
      and q.entity_type = r->>'entity_type'
  );
  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'status', 'ok',
    'quarantined_processed', jsonb_array_length(p_records),
    'quarantined_inserted', v_inserted
  );
end;
$function$;

revoke all on function public.ingest_quarantined_records_batch_v1(jsonb) from public;
grant execute on function public.ingest_quarantined_records_batch_v1(jsonb) to anon,authenticated,service_role;
comment on function public.ingest_quarantined_records_batch_v1(jsonb) is 'Batch idempotent ingestion for quarantined ambiguous or conflicted lexical mappings.';

-- 3. Update suggest_orthographic_candidates_v1 with Greek final sigma normalization (ς -> σ)
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
      translate(l.lemma_stripped,'ךםןףץς','כמנפצσ') search_form
   from jsonb_array_elements(v_packet->'matched_lemmas') m
   join public.lemmas l on l.id=(m->>'lemma_id')::bigint
   where char_length(l.lemma_stripped)>=p_min_chars
 ),
 pool as (
   select c.id,c.lemma_key,c.base_strongs,c.lemma_script,c.transliteration,c.language,
       lx.primary_gloss,
       translate(c.lemma_stripped,'ךםןףץς','כמנפצσ') search_form
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
   'method','normalized_hebrew_and_greek_final_letter_consonantal_substring_v1',
   'language_scope','same_language_only',
   'returned_count',v_count,'limit',p_limit,
   'candidate_connections',v_candidates,
   'limitations','Substring resemblance alone provides no evidence of etymology, morphology, synonymy or intentional wordplay. Heuristic ranks are not confidence scores. Output is bounded and not exhaustive.'
 );
end
$function$;

revoke all on function public.suggest_orthographic_candidates_v1(text,integer,integer) from public;
grant execute on function public.suggest_orthographic_candidates_v1(text,integer,integer) to anon,authenticated,service_role;
comment on function public.suggest_orthographic_candidates_v1(text,integer,integer) is 'Exploratory spelling matches with Hebrew final-letter (ךםןףץ -> כמנפצ) and Greek final sigma (ς -> σ) normalization; candidates never become documented roots or etymologies without supporting evidence.';

-- 4. Batch candidate discovery pipeline with relationship cross-referencing
create or replace function public.batch_suggest_orthographic_candidates_v1(
 p_queries text[],
 p_limit_per_query integer default 10,
 p_min_chars integer default 2
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
set statement_timeout = '15s'
as $function$
declare
  v_results jsonb := '[]'::jsonb;
  v_q text;
  v_item jsonb;
  v_cand jsonb;
  v_enriched jsonb;
begin
  if p_queries is null or cardinality(p_queries) = 0 then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_request', 'message', 'p_queries array must not be empty');
  end if;
  if cardinality(p_queries) > 20 then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_request', 'message', 'Maximum 20 queries per batch call');
  end if;

  foreach v_q in array p_queries
  loop
    v_item := public.suggest_orthographic_candidates_v1(v_q, p_limit_per_query, p_min_chars);
    if v_item->>'status' = 'ok' then
      -- Enrich candidates with documented relationship cross-referencing
      select coalesce(jsonb_agg(
        elem || jsonb_build_object(
          'has_documented_root', exists (
            select 1 from public.lemma_root_links rl1
            join public.lemma_root_links rl2 on rl2.root_id = rl1.root_id and rl2.lemma_id <> rl1.lemma_id
            join public.lemmas l_src on l_src.id = rl1.lemma_id and l_src.lemma_key = elem->>'source_lemma_key'
            where rl2.lemma_id = (elem->>'candidate_id')::bigint
          ),
          'has_documented_formation', exists (
            select 1 from public.lemma_components c
            join public.lexical_formations f on f.id = c.formation_id
            join public.lemmas l_src on l_src.id = f.lemma_id and l_src.lemma_key = elem->>'source_lemma_key'
            where c.component_lemma_id = (elem->>'candidate_id')::bigint
               or exists (
                 select 1 from public.lemma_components c2
                 where c2.formation_id = c.formation_id and c2.component_lemma_id = (elem->>'candidate_id')::bigint
               )
          ),
          'existing_connection_type', (
            select con.relation_type from public.lexical_connections con
            join public.lemmas l_src on l_src.id = con.subject_lemma_id and l_src.lemma_key = elem->>'source_lemma_key'
            where con.target_lemma_id = (elem->>'candidate_id')::bigint
            limit 1
          )
        )
      ), '[]'::jsonb)
      into v_enriched
      from jsonb_array_elements(v_item->'candidate_connections') elem;

      v_results := v_results || jsonb_build_array(
        v_item || jsonb_build_object('candidate_connections', v_enriched)
      );
    else
      v_results := v_results || jsonb_build_array(v_item);
    end if;
  end loop;

  return jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'batch_size', cardinality(p_queries),
    'results', v_results,
    'method', 'batch_orthographic_candidate_discovery_pipeline_v1',
    'limitations', 'Consonantal resemblance is unverified exploratory data. Documented roots, formations, and literary connections are cross-referenced to prevent synthetic etymologies.'
  );
end;
$function$;

revoke all on function public.batch_suggest_orthographic_candidates_v1(text[],integer,integer) from public;
grant execute on function public.batch_suggest_orthographic_candidates_v1(text[],integer,integer) to anon,authenticated,service_role;
comment on function public.batch_suggest_orthographic_candidates_v1(text[],integer,integer) is 'Batch candidate discovery across word arrays with documented root, formation, and connection cross-referencing.';
