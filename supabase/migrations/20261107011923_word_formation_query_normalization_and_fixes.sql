-- Migration: 20261107021500_word_formation_query_normalization_and_fixes.sql
-- 1. Updates get_word_formation_v1 to support normalized Hebrew final letters and Greek final sigma in lemma lookup
-- 2. Creates alias word_formation_research_rpc_v1 for backward compatibility
-- 3. Robustifies ingest_lexical_formations_batch_v1 to resolve lemma_id from source_strongs/lemma_key if omitted

-- 1. Updated get_word_formation_v1
create or replace function public.get_word_formation_v1(
 p_query text default null,
 p_word_id integer default null
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
set statement_timeout = '8s'
as $function$
declare
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
begin
 if p_word_id is not null and p_word_id <= 0 then
   return jsonb_build_object('schema_version',1,'status','invalid_request','message','p_word_id must be positive');
 end if;
 if p_word_id is not null then
   if not exists (select 1 from public.words w where w.id=p_word_id) then
     return jsonb_build_object('schema_version',1,'status','word_id_not_found');
   end if;
   if v_q='' then
     select w.strongs_nr into v_q from public.words w where w.id=p_word_id;
   end if;
 end if;
 if v_q='' or length(v_q)>128 then
   return jsonb_build_object('schema_version',1,'status','invalid_request','message','Provide p_query (1-128 characters), or a valid p_word_id.');
 end if;
 v_base := case
   when v_q ~* '^[HG]0*[0-9]+[A-Z]?$'
   then upper(regexp_replace(v_q,'^([HG])0*([0-9]+[A-Z]?)$','\1\2','i'))
   else null end;
 v_stripped := regexp_replace(normalize(v_q,NFKD),'[֑-ׇ̀-ͯ]','','g');
 v_norm := translate(translate(v_stripped,'ךםןףץ','כמנפצ'),'ς','σ');

 with targets as (
   select l.id,
      case when lower(l.lemma_key)=lower(v_q) or lower(l.lemma_key)='lemma:'||lower(v_q) then 0
           when v_base is not null and (l.base_strongs=v_base or upper(regexp_replace(l.lemma_key,'^lemma:([HG])0*([0-9]+[A-Z]?)$','\1\2','i'))=v_base) then 1
           when exists (select 1 from public.lexemes x where x.lemma_id=l.id and upper(x.extended_strongs)=upper(v_q)) then 2
           when l.lemma_script=v_q or (v_stripped<>'' and l.lemma_stripped=v_stripped) then 3
           when (v_norm<>'' and translate(translate(l.lemma_stripped,'ךםןףץ','כמנפצ'),'ς','σ')=v_norm) then 4
           else 5 end priority
   from public.lemmas l
   where (v_base is not null and (l.base_strongs=v_base or upper(regexp_replace(l.lemma_key,'^lemma:([HG])0*([0-9]+[A-Z]?)$','\1\2','i'))=v_base))
      or lower(l.lemma_key)=lower(v_q)
      or lower(l.lemma_key)='lemma:'||lower(v_q)
      or l.lemma_script=v_q
      or (v_stripped<>'' and l.lemma_stripped=v_stripped)
      or (v_norm<>'' and translate(translate(l.lemma_stripped,'ךםןףץ','כמנפצ'),'ς','σ')=v_norm)
      or lower(l.transliteration)=lower(v_q)
      or exists (select 1 from public.lexemes x where x.lemma_id=l.id and upper(x.extended_strongs)=upper(v_q))
 ),
 ids as (select id from targets order by priority,id limit 26)
 select array_agg(id) into v_ids from ids;
 v_total := coalesce(cardinality(v_ids),0);
 if v_total=0 then
  return jsonb_build_object('schema_version',1,'status','not_found','query',v_q);
 end if;
 if v_total>25 then v_ids:=v_ids[1:25]; end if;
 v_selected:=cardinality(v_ids);
 select coalesce(jsonb_agg(jsonb_build_object(
  'lemma_id',l.id,'lemma_key',l.lemma_key,'language',l.language,
  'lemma_script',l.lemma_script,'lemma_stripped',l.lemma_stripped,
  'transliteration',l.transliteration,'base_strongs',l.base_strongs,
  'primary_pos',l.primary_pos,'homograph_tag',l.homograph_tag,
  'primary_lexeme_id',l.primary_lexeme_id,
  'primary_gloss',lx.primary_gloss,
  'source_record_id',l.source_record_id
 ) order by l.id),'[]'::jsonb)
 into v_lemmas
 from public.lemmas l left join public.lexemes lx on lx.id=l.primary_lexeme_id
 where l.id=any(v_ids);

 select coalesce(jsonb_agg(jsonb_build_object(
  'formation_id',f.id,'lemma_id',f.lemma_id,'analysis_key',f.analysis_key,
  'formation_type',f.formation_type,'whole_word_gloss',f.whole_word_gloss,
  'evidence_status',f.evidence_status,'evidence_note',f.evidence_note,
  'origin_mode',f.origin_mode,'review_status',f.review_status,
  'source',jsonb_build_object('title',f.source_title,'url',f.source_url,'record_id',f.source_record_id),
  'components',(
     select coalesce(jsonb_agg(jsonb_build_object(
       'order',c.component_order,'surface_text',c.surface_text,
       'role',c.component_role,'semantic_contribution',c.semantic_contribution,
       'component_note',c.component_note,
       'lemma_id',cl.id,'lemma_key',cl.lemma_key,'base_strongs',cl.base_strongs,
       'original_lemma',cl.lemma_script,'transliteration',cl.transliteration,
       'lexeme_id',cx.id,'primary_gloss',cx.primary_gloss,
       'senses',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'sense_code',ss.sense_code,'short_gloss',ss.short_gloss,
            'source_attribution',ss.source_attribution
          ) order by ss.sense_order,ss.id),'[]'::jsonb)
          from (select * from public.lexical_senses s where s.lemma_id=cl.id order by s.sense_order,s.id limit 5) ss
       )
     ) order by c.component_order),'[]'::jsonb)
     from public.lemma_components c
     left join public.lemmas cl on cl.id=c.component_lemma_id
     left join public.lexemes cx on cx.id=coalesce(c.component_lexeme_id,cl.primary_lexeme_id)
     where c.formation_id=f.id
  )
 ) order by f.id),'[]'::jsonb)
 into v_formations from public.lexical_formations f where f.lemma_id=any(v_ids);

 select coalesce(jsonb_agg(jsonb_build_object(
   'lemma_id',rl.lemma_id,'lemma_key',l.lemma_key,'root_id',r.id,'root_key',r.root_key,
   'root_script',r.root_script,'root_transliteration',r.transliteration,
   'root_kind',r.root_kind,'relation_type',rl.etymology_type,
   'implies_synonymy',false,'evidence_note',rl.evidence_note,
   'origin_mode',rl.origin_mode,'derivation_method',rl.derivation_method,
   'source_record_id',rl.source_record_id,'source_release_key',sr.release_key
 ) order by rl.lemma_id,r.root_key,rl.id),'[]'::jsonb)
 into v_roots
 from public.lemma_root_links rl
 join public.lemmas l on l.id=rl.lemma_id
 join public.lexical_roots r on r.id=rl.root_id
 left join public.source_releases sr on sr.id=rl.source_release_id
 where rl.lemma_id=any(v_ids);

 select coalesce(jsonb_agg(jsonb_build_object(
   'root_key',r.root_key,'relative_lemma_id',l.id,'relative_lemma_key',l.lemma_key,
   'base_strongs',l.base_strongs,'lemma_script',l.lemma_script,
   'transliteration',l.transliteration,'primary_gloss',lx.primary_gloss,
   'relation_type',related.etymology_type,'source_record_id',related.source_record_id
 ) order by r.root_key, l.id),'[]'::jsonb)
 into v_relatives from (
   select distinct rl.root_id from public.lemma_root_links rl where rl.lemma_id=any(v_ids)
 ) roots
 join public.lexical_roots r on r.id=roots.root_id
 join public.lemma_root_links related on related.root_id=r.id
 join public.lemmas l on l.id=related.lemma_id
 left join public.lexemes lx on lx.id=l.primary_lexeme_id
 where not (l.id=any(v_ids));

 select coalesce(jsonb_agg(jsonb_build_object(
  'connection_id',c.id,'source_lemma_id',c.subject_lemma_id,'target_lemma_id',c.target_lemma_id,
  'source_lemma_key',sl.lemma_key,'target_lemma_key',tl.lemma_key,
  'source_strongs',sl.base_strongs,'target_strongs',tl.base_strongs,
  'relation_type',c.relation_type,'evidence_status',c.evidence_status,
  'evidence_note',c.evidence_note,'passage_reference',c.passage_reference,
  'source_title',c.source_title,'source_url',c.source_url,'derivation_method',c.derivation_method
 ) order by c.id),'[]'::jsonb)
 into v_connections
 from public.lexical_connections c
 join public.lemmas sl on sl.id=c.subject_lemma_id
 join public.lemmas tl on tl.id=c.target_lemma_id
 where c.subject_lemma_id=any(v_ids) or c.target_lemma_id=any(v_ids);

 if p_word_id is not null then
   select coalesce(jsonb_agg(jsonb_build_object(
    'component_order',wfl.component_order,'morpheme_role',wfl.morpheme_role,
    'surface',wfl.morpheme_surface,'gloss',wfl.morpheme_gloss,
    'grammar_code',wfl.grammar_code,'lemma_id',wfl.lemma_id,'lexeme_id',wfl.lexeme_id,
    'observed_token_count',wfl.observed_token_count,
    'is_context_ambiguous',wfl.is_context_ambiguous,
    'source_record_id',wfl.source_record_id
   ) order by wfl.component_order,wfl.id),'[]'::jsonb)
   into v_form_candidates
   from (select * from public.word_form_lemmas where word_id=p_word_id order by component_order,id limit 30) wfl;
 end if;

 return jsonb_build_object(
  'schema_version',1,'status','ok','query',v_q,'requested_word_id',p_word_id,
  'identity_scope','disambiguated_lemmas',
  'needs_disambiguation',v_total>1,'matched_lemmas',v_lemmas,
  'lexical_formations',v_formations,'documented_roots',v_roots,
  'root_relatives',v_relatives,'other_connections',v_connections,
  'word_form_component_candidates',v_form_candidates,
  'coverage',jsonb_build_object(
    'selected_lemma_count',v_selected,'complete',v_total<=25,
    'roots_attested_for_every_lemma',(
      select not exists (select 1 from unnest(v_ids) x(lemma_id)
        where not exists(select 1 from public.lemma_root_links r where r.lemma_id=x.lemma_id))
    ),
    'token_morphology_scope','word-form candidates, not uniquely disambiguated verse-token morphemes',
    'missing_data_not_evidence_of_absence',true,
    'root_is_not_a_meaning',true,'shared_root_implies_synonymy',false,
    'orthographic_similarity_proves_derivation',false
  )
 );
end
$function$;

revoke all on function public.get_word_formation_v1(text,integer) from public;
grant execute on function public.get_word_formation_v1(text,integer) to anon,authenticated,service_role;

-- 2. Alias: word_formation_research_rpc_v1
create or replace function public.word_formation_research_rpc_v1(
  p_query text default null,
  p_word_id integer default null
) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select public.get_word_formation_v1(p_query, p_word_id);
$$;

revoke all on function public.word_formation_research_rpc_v1(text,integer) from public;
grant execute on function public.word_formation_research_rpc_v1(text,integer) to anon,authenticated,service_role;

-- 3. Robustified ingest_lexical_formations_batch_v1
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
  v_resolved_lemma_id bigint;
  v_c record;
  v_resolved_comp_lemma_id bigint;
begin
  for v_f in
    select
      (elem->>'lemma_id')::bigint as lemma_id,
      elem->>'source_strongs' as source_strongs,
      coalesce(elem->>'analysis_key', elem->>'source_strongs') as analysis_key,
      elem->>'formation_type' as formation_type,
      coalesce(elem->>'whole_word_gloss', elem->>'gloss') as whole_word_gloss,
      coalesce(elem->>'evidence_status', 'documented') as evidence_status,
      coalesce(elem->>'evidence_note', 'Documented lexical formation evidence') as evidence_note,
      coalesce(elem->>'source_title', elem->>'source_dataset', 'Documented source') as source_title,
      coalesce(elem->>'source_url', 'https://github.com/openscriptures/HebrewLexicon') as source_url,
      coalesce(elem->>'source_record_id', elem->>'source_strongs') as source_record_id,
      coalesce(elem->>'origin_mode', 'sourced') as origin_mode,
      elem->'components' as components
    from jsonb_array_elements(p_formations) elem
  loop
    v_resolved_lemma_id := v_f.lemma_id;
    if v_resolved_lemma_id is null and v_f.source_strongs is not null then
      select l.id into v_resolved_lemma_id
      from public.lemmas l
      where l.base_strongs = upper(regexp_replace(v_f.source_strongs, '^([HG])0*([0-9]+[A-Z]?)$', '\1\2', 'i'))
         or lower(l.lemma_key) = lower(v_f.source_strongs)
         or lower(l.lemma_key) = 'lemma:' || lower(v_f.source_strongs)
      order by l.id
      limit 1;
    end if;

    if v_resolved_lemma_id is null then
      continue;
    end if;

    insert into public.lexical_formations
      (lemma_id, analysis_key, formation_type, whole_word_gloss, evidence_status, evidence_note, source_title, source_url, source_record_id, origin_mode)
    values
      (v_resolved_lemma_id, v_f.analysis_key, v_f.formation_type, v_f.whole_word_gloss, v_f.evidence_status, v_f.evidence_note, v_f.source_title, v_f.source_url, v_f.source_record_id, v_f.origin_mode)
    on conflict (lemma_id, analysis_key) do nothing
    returning id into v_formation_id;

    if v_formation_id is null then
      select id into v_formation_id from public.lexical_formations where lemma_id = v_resolved_lemma_id and analysis_key = v_f.analysis_key;
    else
      v_formations_count := v_formations_count + 1;
    end if;

    if v_formation_id is not null and v_f.components is not null and jsonb_array_length(v_f.components) > 0 then
      for v_c in
        select
          coalesce((comp->>'order')::int, (comp->>'sequence')::int) as component_order,
          (comp->>'lemma_id')::bigint as lemma_id,
          (comp->>'lexeme_id')::bigint as lexeme_id,
          comp->>'component_strongs' as component_strongs,
          comp->>'surface_text' as surface_text,
          comp->>'role' as component_role,
          coalesce(comp->>'semantic_contribution', comp->>'gloss') as semantic_contribution,
          comp->>'note' as component_note
        from jsonb_array_elements(v_f.components) comp
      loop
        v_resolved_comp_lemma_id := v_c.lemma_id;
        if v_resolved_comp_lemma_id is null and v_c.component_strongs is not null then
          select l.id into v_resolved_comp_lemma_id
          from public.lemmas l
          where l.base_strongs = upper(regexp_replace(v_c.component_strongs, '^([HG])0*([0-9]+[A-Z]?)$', '\1\2', 'i'))
             or lower(l.lemma_key) = lower(v_c.component_strongs)
             or lower(l.lemma_key) = 'lemma:' || lower(v_c.component_strongs)
          order by l.id
          limit 1;
        end if;

        if v_resolved_comp_lemma_id is null then
          continue;
        end if;

        insert into public.lemma_components
          (formation_id, component_order, component_lemma_id, component_lexeme_id, surface_text, component_role, semantic_contribution, component_note)
        values
          (v_formation_id, v_c.component_order, v_resolved_comp_lemma_id, v_c.lexeme_id, coalesce(v_c.surface_text, (select lemma_stripped from public.lemmas where id = v_resolved_comp_lemma_id), ''), v_c.component_role, v_c.semantic_contribution, v_c.component_note)
        on conflict (formation_id, component_order) do nothing;
        if found then
          v_components_count := v_components_count + 1;
        end if;
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
