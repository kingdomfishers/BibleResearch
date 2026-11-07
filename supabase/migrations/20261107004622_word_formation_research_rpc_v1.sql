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
   when v_q ~* '^[HG]0*[0-9]+$'
   then upper(regexp_replace(v_q,'^([HG])0*([0-9]+)$','\1\2','i'))
   else null end;
 v_stripped := regexp_replace(normalize(v_q,NFKD),'[֑-ׇ̀-ͯ]','','g');
 with targets as (
   select l.id,
      case when lower(l.lemma_key)=lower(v_q) or lower(l.lemma_key)='lemma:'||lower(v_q) then 0
           when v_base is not null and l.base_strongs=v_base then 1
           when exists (select 1 from public.lexemes x where x.lemma_id=l.id and upper(x.extended_strongs)=upper(v_q)) then 2
           else 3 end priority
   from public.lemmas l
   where (v_base is not null and l.base_strongs=v_base)
      or lower(l.lemma_key)=lower(v_q)
      or lower(l.lemma_key)='lemma:'||lower(v_q)
      or l.lemma_script=v_q
      or (v_stripped<>'' and l.lemma_stripped=v_stripped)
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
comment on function public.get_word_formation_v1(text,integer) is 'Read-only formation and relationship packet with disambiguated lemma candidates, sourced compound elements, documented roots, and explicitly labelled textual/formal connections; not an AI semantic inference.';
