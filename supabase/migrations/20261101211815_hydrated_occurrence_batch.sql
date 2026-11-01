-- Optimize whole-request occurrence hydration: one corpus token sweep, not one search per lexical target.
-- One-call public research packet. Existing corpus and RPC contracts stay intact.
-- All occurrence searches, rankings, and evidence hydration execute under caller RLS.
create or replace function public.get_verse_research_v1(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  refs jsonb; item jsonb; mode text; sample_limit integer := 20;
  model_id text; packet jsonb; byte_size integer;
  invalid constant jsonb := '{"schema_version":1,"status":"invalid_request","message":"Provide 1-5 distinct numeric passages; occurrences.mode is all or sample (limit 1-100); use a published chronology model."}';
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then return invalid; end if;
  if exists (select 1 from jsonb_object_keys(p_request) k where k not in ('passages','occurrences','chronology_model_id')) then return invalid; end if;
  refs := p_request->'passages';
  if refs is null or jsonb_typeof(refs) <> 'array' then return invalid; end if;
  if jsonb_array_length(refs) not between 1 and 5 then return invalid; end if;
  for item in select value from jsonb_array_elements(refs) loop
    if jsonb_typeof(item) <> 'object' then return invalid; end if;
    if exists(select 1 from jsonb_object_keys(item) k where k not in ('book','chapter','verse')) then return invalid; end if;
    if jsonb_typeof(item->'book') is distinct from 'number'
      or jsonb_typeof(item->'chapter') is distinct from 'number'
      or jsonb_typeof(item->'verse') is distinct from 'number' then return invalid; end if;
    if item->>'book' !~ '^[0-9]{1,2}$' or item->>'chapter' !~ '^[0-9]{1,3}$'
      or item->>'verse' !~ '^[0-9]{1,3}$' then return invalid; end if;
    if (item->>'book')::int not between 1 and 66 or (item->>'chapter')::int not between 1 and 150
      or (item->>'verse')::int not between 0 and 176 then return invalid; end if;
  end loop;
  if (select count(distinct value) from jsonb_array_elements(refs)) <> jsonb_array_length(refs) then return invalid; end if;
  mode := coalesce(p_request #>> '{occurrences,mode}', 'all');
  if p_request ? 'occurrences' then
    item := p_request->'occurrences';
    if jsonb_typeof(item) <> 'object' then return invalid; end if;
    if exists(select 1 from jsonb_object_keys(item) k where k not in ('mode','limit')) then return invalid; end if;
    if item ? 'mode' and jsonb_typeof(item->'mode') <> 'string' then return invalid; end if;
    if item ? 'limit' then
      if jsonb_typeof(item->'limit') <> 'number' or item->>'limit' !~ '^[0-9]{1,3}$' then return invalid; end if;
      sample_limit := (item->>'limit')::int;
      if sample_limit not between 1 and 100 or mode <> 'sample' then return invalid; end if;
    end if;
  end if;
  if mode not in ('all','sample') then return invalid; end if;
  if p_request ? 'chronology_model_id' and jsonb_typeof(p_request->'chronology_model_id') <> 'string' then return invalid; end if;
  model_id := coalesce(p_request->>'chronology_model_id','theographic-verse-v1');
  if not exists(select 1 from public.chronology_models where id=model_id and published) then return invalid; end if;
  if exists(select 1 from jsonb_array_elements(refs) r where not exists(
    select 1 from public.verses v where v.book=(r->>'book')::int
      and v.chapter=(r->>'chapter')::int and v.verse_nr=(r->>'verse')::int)) then
    return jsonb_build_object('schema_version',1,'status','passage_not_found','requested_passages',refs);
  end if;

  with passages as materialized (
    select v.*,r.ord from jsonb_array_elements(refs) with ordinality r(ref,ord)
    join public.verses v on v.book=(r.ref->>'book')::int
      and v.chapter=(r.ref->>'chapter')::int and v.verse_nr=(r.ref->>'verse')::int
  ), tokens as materialized (
    select v.id verse_id,u.ord::integer word_position,w.*,s.source_english,s.source_ref,s.source_name,s.source_commit
    from passages v cross join lateral unnest(v.word_ids) with ordinality u(word_id,ord)
    join public.words w on w.id=u.word_id
    left join public.verse_translation_sources s on s.verse_id=v.id and s.word_position=u.ord and s.word_id=w.id
  ), targets as materialized (
    select distinct strongs_nr from tokens
  ), target_forms as materialized (
    select w.id,w.strongs_nr from public.words w join targets t using(strongs_nr)
  ), occurrence_counts as materialized (
    select f.strongs_nr,v.book,v.chapter,v.verse_nr,count(*)::integer occurrence_count
    from public.verses v cross join lateral unnest(v.word_ids) u(word_id)
    join target_forms f on f.id=u.word_id
    group by f.strongs_nr,v.book,v.chapter,v.verse_nr
  ), ranked_occurrences as (
    select a.*,row_number() over(partition by a.strongs_nr order by a.book,a.chapter,a.verse_nr) rn
    from occurrence_counts a
  ), occurrence_packets as materialized (
    select strongs_nr,jsonb_build_object(
      'counting_method','Sum of matching tokens per passage across base-Strongs inflections',
      'corpus_token_total',sum(occurrence_count),'distinct_passage_total',count(*),
      'returned_reference_count',count(*) filter(where mode='all' or rn<=sample_limit),
      'complete',mode='all' or count(*)<=sample_limit,
      'references',coalesce(jsonb_agg(jsonb_build_object('book',q.book,'chapter',q.chapter,
        'verse',q.verse_nr,'occurrence_count',q.occurrence_count) order by q.book,q.chapter,q.verse_nr)
        filter(where mode='all' or rn<=sample_limit),'[]'::jsonb)) doc
    from ranked_occurrences q group by strongs_nr
  ), lexemes as materialized (
    select t.strongs_nr,coalesce(jsonb_agg(to_jsonb(l)-'id' order by l.lexeme_key)
      filter(where l.id is not null),'[]'::jsonb) candidates
    from targets t left join public.lexemes l on l.base_strongs=t.strongs_nr group by t.strongs_nr
  ), lexical as materialized (
    select t.strongs_nr,jsonb_build_object(
      'identity_scope','base_strongs','strongs_nr',t.strongs_nr,
      'lexeme_candidates',l.candidates,'needs_disambiguation',jsonb_array_length(l.candidates)>1,
      'sense_status','not_assigned_to_token',
      'semantic_annotation_status',case when jsonb_array_length(l.candidates)=0 then 'unavailable' else 'candidate_lexemes_only' end,
      'occurrences',o.doc,'top_connected_words',c.doc,
      'connection_coverage',jsonb_build_object('requested',7,'returned',jsonb_array_length(c.doc),
        'status',case when jsonb_array_length(c.doc)=0 then 'no_cached_connections' else 'cached' end,
        'method','Cached within-verse base-Strongs token-pair associations; scores are not semantic equivalence.'),
      'limitations','Base Strong''s groups inflections and may combine homographs. No token sense or semantic domain is inferred.'
    ) doc
    from targets t join lexemes l using(strongs_nr)
    join occurrence_packets o using(strongs_nr)
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.rank),'[]'::jsonb) doc from (
        select row_number() over(order by a.score desc,a.word_id) rank,a.*,
          w.english_translations,w.biblical_def,w.physical_def,'stepbible-2026-11'::text source_release_key
        from public.prompt_word_cooccurrences(t.strongs_nr) a join public.words w on w.id=a.word_id
        order by a.score desc,a.word_id limit 7
      ) q
    ) c
  ), semantic_paths as materialized (
    select a.id,a.subject_node_id,a.object_node_id,
      to_jsonb(a)-'id'-'subject_node_id'-'object_node_id' || jsonb_build_object(
        'subject',sn.display_label,'object',ob.display_label,
        'evidence_spans',coalesce((select jsonb_agg(to_jsonb(e)-'id'-'assertion_id' order by e.step_order,e.id)
          from public.assertion_evidence e where e.assertion_id=a.id),'[]'::jsonb)) doc
    from public.assertions a join public.research_nodes sn on sn.id=a.subject_node_id
    join public.research_nodes ob on ob.id=a.object_node_id where a.review_status='reviewed'
  ), verse_packets as materialized (
    select v.ord,jsonb_build_object('verse_id',v.id,'passage',jsonb_build_object(
      'book',v.book,'chapter',v.chapter,'verse',v.verse_nr,'is_heading',v.verse_nr=0),
      'words',coalesce((select jsonb_agg(jsonb_build_object(
        'word_position',t.word_position,'word_id',t.id,'original_word',t.original_word,
        'transliteration',t.transliteration,'strongs_nr',t.strongs_nr,'lexical_entry_key',t.strongs_nr,
        'grammar',jsonb_build_object('raw_code',t.grammar_code,
          'scheme',case when t.source_name like 'TAHOT%' then 'STEP TEHMC (ETCBC/OpenScriptures adapted)'
            when t.source_name like 'TAGNT%' then 'STEP TEGMC (Tauber adapted)' else null end,
          'decoded_features','{}'::jsonb,'unresolved_tags',case when t.grammar_code is null then '[]'::jsonb else jsonb_build_array(t.grammar_code) end),
        'translations',jsonb_build_object('source_english',t.source_english,'source_ref',t.source_ref,
          'source_name',t.source_name,'source_commit',t.source_commit,'corpus_gloss',t.english_translations[1],
          'available_renderings',public.translation_options_v1(t.id,t.source_english)),
        'definitions',jsonb_build_object('biblical',t.biblical_def,'physical',t.physical_def,
          'source_release_key','stepbible-2026-11'),
        'lexeme_candidates',(select candidates from lexemes l where l.strongs_nr=t.strongs_nr)
      ) order by t.word_position) from tokens t where t.verse_id=v.id),'[]'::jsonb),
      'chronology',public.get_verse_chronology_v1(v.book,v.chapter,v.verse_nr,model_id),
      'geography',public.get_verse_geography(v.book,v.chapter,v.verse_nr),
      'semantic_evidence',coalesce((select jsonb_agg(sp.doc order by sp.id) from semantic_paths sp where
        exists(select 1 from public.assertion_evidence e where e.assertion_id=sp.id and e.book=v.book
          and (v.chapter,v.verse_nr)>=(e.start_chapter,e.start_verse) and (v.chapter,v.verse_nr)<=(e.end_chapter,e.end_verse))
        or exists(select 1 from public.research_nodes n join public.concepts c on c.id=n.concept_id
          where n.id in (sp.subject_node_id,sp.object_node_id) and c.primary_strongs &&
            array(select t.strongs_nr::text from tokens t where t.verse_id=v.id))),'[]'::jsonb),
      'coverage',jsonb_build_object('semantic_scope','Reviewed passage matches and lexically related concept candidates; not token-sense assignments',
        'grammar_decoding','Raw source tags retained; unsupported expansions remain unresolved',
        'semantic_domains','unavailable','token_senses','unavailable')
    ) doc from passages v
  )
  select jsonb_build_object('schema_version',1,'status','ok',
    'verses',(select jsonb_agg(doc order by ord) from verse_packets),
    'lexical_entries',(select jsonb_object_agg(strongs_nr,doc order by strongs_nr) from lexical),
    'sources',coalesce((select jsonb_agg(to_jsonb(s)-'id'-'created_at' order by s.release_key)
      from public.source_releases s where s.release_key in ('stepbible-2026-11','curated-motifs-v1')),'[]'::jsonb),
    'coverage',jsonb_build_object('corpus','primary STEP Hebrew/Aramaic OT and NA28-membership Greek NT',
      'requested_passage_count',jsonb_array_length(refs),'returned_passage_count',(select count(*) from passages),
      'lexical_entry_count',(select count(*) from targets),'occurrence_mode',mode,
      'occurrences_complete',(select bool_and((doc #>> '{occurrences,complete}')::boolean) from lexical),
      'chronology_evidence_complete',(select bool_and(coalesce((doc #>> '{chronology,status}')='ok',false)
        and not coalesce((doc #>> '{chronology,evidence_truncated}')::boolean,true)
        and not coalesce((doc #>> '{chronology,assertions_truncated}')::boolean,true)) from verse_packets),
      'component_statuses',(select jsonb_agg(jsonb_build_object('passage',doc->'passage',
        'chronology',doc #>> '{chronology,status}','geography',doc #>> '{geography,status}') order by ord) from verse_packets),
      'max_passages',5,'max_packet_bytes',8388608,'semantic_coverage','Limited reviewed annotations; empty results do not establish absence of a relationship',
      'private_translation_choices_included',false)) into packet;
  byte_size := octet_length(packet::text);
  if byte_size > 8388608 then return jsonb_build_object('schema_version',1,'status','packet_limit_exceeded',
    'requested_passages',refs,'measured_bytes',byte_size,'max_packet_bytes',8388608,
    'message','Request fewer passages or explicitly select occurrences.mode=sample. No partial packet was returned.'); end if;
  return packet;
end;
$$;
revoke all on function public.get_verse_research_v1(jsonb) from public;
grant execute on function public.get_verse_research_v1(jsonb) to anon,authenticated;
notify pgrst, 'reload schema';
