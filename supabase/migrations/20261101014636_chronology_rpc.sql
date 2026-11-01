create function public.chronology_year_label(y integer) returns text
language sql immutable strict security invoker set search_path='' as $$
 select case when y<=0 then (1::bigint-y)::text||' BC' else 'AD '||y::text end
$$;
revoke all on function public.chronology_year_label(integer) from public;
grant execute on function public.chronology_year_label(integer) to anon,authenticated,service_role;

create function public.get_verse_chronology_v1(
 p_book integer,p_chapter integer,p_verse integer,
 p_model_id text default 'theographic-verse-v1',p_run_id text default null,p_evidence_cursor text default null)
returns jsonb language plpgsql stable security invoker set search_path=''
set statement_timeout='5s' as $rpc$
declare
 vid integer; rid bigint; model public.chronology_models; run public.chronology_runs;
 base jsonb; assertions jsonb; evidence jsonb; alternatives jsonb; history jsonb; response jsonb;
 aid bigint:=0; eid bigint:=0; parts text[]; total_assertions integer; evidence_count integer;
 lo integer; hi integer; axis text; assignment_status text; has_archaeology boolean;
begin
 select jsonb_build_object('schema_version',1,'models',coalesce(jsonb_agg(jsonb_build_object(
   'id',m.id,'name',m.name,'assumptions',m.assumptions,'adam_year',m.adam_year,'resurrection_year',m.resurrection_year,
   'run_id',r.id::text,'coverage',r.coverage) order by case when m.id='theographic-verse-v1' then 0 else 1 end,m.id),'[]'::jsonb))
 into base from public.chronology_models m join public.chronology_active_runs ar on ar.model_id=m.id
 join public.chronology_runs r on r.id=ar.run_id where m.published and r.published;
 if p_book is null or p_chapter is null or p_verse is null or p_book not between 1 and 66
   or p_chapter not between 1 and 150 or p_verse not between 0 and 176 then
   return base||jsonb_build_object('status','invalid_reference');
 end if;
 select id into vid from public.verses where book=p_book and chapter=p_chapter and verse_nr=p_verse;
 if vid is null then return base||jsonb_build_object('status','passage_not_found'); end if;
 select * into model from public.chronology_models where id=p_model_id and published;
 if model.id is null then return base||jsonb_build_object('status','invalid_model'); end if;
 if p_run_id is not null and (p_run_id !~ '^[1-9][0-9]{0,17}$') then
   return base||jsonb_build_object('status','invalid_run');
 end if;
 select r.* into run from public.chronology_runs r where r.model_id=model.id and r.published
   and r.id=coalesce(p_run_id::bigint,(select ar.run_id from public.chronology_active_runs ar where ar.model_id=model.id));
 if run.id is null then return base||jsonb_build_object('status','release_unavailable'); end if;
 rid:=run.id;
 if p_evidence_cursor is not null then
   if p_run_id is null or p_evidence_cursor !~ '^[1-9][0-9]{0,17}:[0-9]{1,18}:[0-9]{1,18}$' then
     return base||jsonb_build_object('status','invalid_cursor');
   end if;
   parts:=string_to_array(p_evidence_cursor,':');
   if parts[1]<>rid::text then return base||jsonb_build_object('status','invalid_cursor'); end if;
   aid:=parts[2]::bigint; eid:=parts[3]::bigint;
 end if;
 select status into assignment_status from public.chronology_assignments where run_id=rid and verse_id=vid;
 select count(*) into total_assertions from public.chronology_assignment_assertions where run_id=rid and verse_id=vid;
 select coalesce(jsonb_agg(doc order by rank,id),'[]'::jsonb) into assertions from (
   select a.id,case a.axis when 'setting' then 0 when 'source_placement' then 1 when 'composition' then 2 else 3 end rank,
   jsonb_build_object('id',a.id::text,'model_id',a.model_id,'axis',a.axis,
     'earliest_year',a.earliest_year,'latest_year',a.latest_year,'preferred_year',a.preferred_year,
     'date_label',case when a.earliest_year=a.latest_year then 'around '||public.chronology_year_label(a.earliest_year)
       else public.chronology_year_label(a.earliest_year)||' to '||public.chronology_year_label(a.latest_year) end,
     'precision',a.precision,'method',a.method,'rationale',a.rationale,'author',a.author,'review_status',a.review_status,
     'mapping',a.mapping,'source',jsonb_build_object('dataset',s.dataset,'version',s.version,'locator',s.locator,'license',s.license,'attribution',s.attribution),
     'supersedes',a.supersedes::text,'event_title',e.title,'original_date',e.original_date,'duration',e.duration) doc
   from public.chronology_assignment_assertions aa join public.chronology_assertions a on a.id=aa.assertion_id
   join public.chronology_sources s on s.id=a.source_id left join public.chronology_events e on e.id=a.event_id
   where aa.run_id=rid and aa.verse_id=vid order by rank,a.id limit 20
 ) picked;
 if p_evidence_cursor is not null and not exists(
   select 1 from public.chronology_assertion_evidence ae
   where ae.assertion_id=aid and ae.evidence_id=eid
   and ae.assertion_id in (select (value->>'id')::bigint from jsonb_array_elements(assertions))) then
   return base||jsonb_build_object('status','invalid_cursor');
 end if;
 select coalesce(jsonb_agg(doc order by assertion_id,evidence_id),'[]'::jsonb) into evidence from (
   select ae.assertion_id,ae.evidence_id,jsonb_build_object('assertion_id',ae.assertion_id::text,'id',e.id::text,
     'category',e.category,'title',e.title,'citation',e.citation,'locator',e.locator,'summary',e.summary,
     'dating_method',e.dating_method,'scope',e.scope,'uncertainty',e.uncertainty,'review_status',e.review_status,
     'object_year',e.object_year,'object_date_label',public.chronology_year_label(e.object_year),
     'event_year',e.event_year,'event_date_label',public.chronology_year_label(e.event_year),
     'relationship',ae.relationship,'applicability',ae.applicability,'explanation',ae.explanation) doc
   from public.chronology_assertion_evidence ae join public.chronology_evidence e on e.id=ae.evidence_id
   where ae.assertion_id in (select (value->>'id')::bigint from jsonb_array_elements(assertions))
     and (ae.assertion_id,ae.evidence_id)>(aid,eid) order by ae.assertion_id,ae.evidence_id limit 21
 ) page;
 evidence_count:=jsonb_array_length(evidence);
 if evidence_count>20 then evidence:=evidence-20; end if;
 select exists(select 1 from public.chronology_assertion_evidence ae join public.chronology_evidence e on e.id=ae.evidence_id
   where e.category='archaeological' and ae.assertion_id in (select (value->>'id')::bigint from jsonb_array_elements(assertions))) into has_archaeology;
 select a->>'axis' into axis from jsonb_array_elements(assertions) a where a->>'axis'<>'mentioned_event' limit 1;
 select min((a->>'earliest_year')::integer),max((a->>'latest_year')::integer) into lo,hi
   from jsonb_array_elements(assertions) a where a->>'axis'=axis;
 select coalesce(jsonb_agg(doc order by model_name,id),'[]'::jsonb) into alternatives from (
   select m.name model_name,a.id,jsonb_build_object('id',a.id::text,'model_id',m.id,'model_name',m.name,'run_id',ar.run_id::text,
     'axis',a.axis,'date_label',case when a.earliest_year=a.latest_year then 'around '||public.chronology_year_label(a.earliest_year)
       else public.chronology_year_label(a.earliest_year)||' to '||public.chronology_year_label(a.latest_year) end,
     'earliest_year',a.earliest_year,'latest_year',a.latest_year,'event_title',e.title,'review_status',a.review_status) doc
   from public.chronology_models m join public.chronology_active_runs ar on ar.model_id=m.id
   cross join lateral (select a.* from public.chronology_assignment_assertions aa
     join public.chronology_assertions a on a.id=aa.assertion_id where aa.run_id=ar.run_id and aa.verse_id=vid order by a.id limit 3) a
   left join public.chronology_events e on e.id=a.event_id
   where m.id<>model.id order by m.name,a.id limit 12
 ) other_models;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id::text,'label',r.label,'created_at',r.created_at) order by r.id desc),'[]'::jsonb)
 into history from (select id,label,created_at from public.chronology_runs where model_id=model.id and published order by id desc limit 5) r;
 response:=base||jsonb_build_object('status','ok','passage',jsonb_build_object('book',p_book,'chapter',p_chapter,'verse',p_verse,'is_heading',p_verse=0),
   'model',jsonb_build_object('id',model.id,'name',model.name,'assumptions',model.assumptions,'adam_year',model.adam_year,'resurrection_year',model.resurrection_year),
   'run',jsonb_build_object('id',rid::text,'label',run.label,'created_at',run.created_at,'coverage',run.coverage),
   'assignment_status',coalesce(assignment_status,'unresolved'),'assertions',assertions,'assertion_count',total_assertions,
   'assertions_truncated',total_assertions>20,'evidence',evidence,'evidence_truncated',evidence_count>20,
   'next_evidence_cursor',case when evidence_count>20 then rid::text||':'||(evidence->19->>'assertion_id')||':'||(evidence->19->>'id') else null end,
   'has_archaeological_evidence',has_archaeology,'alternatives',alternatives,'history',history,
   'summary',jsonb_build_object('axis',axis,'earliest_year',lo,'latest_year',hi,
     'label',case when lo is null then 'No setting date established' when lo=hi then 'around '||public.chronology_year_label(lo)
       else public.chronology_year_label(lo)||' to '||public.chronology_year_label(hi) end,
     'millennium_first',case when lo is not null and model.adam_year is not null then floor((lo::numeric-model.adam_year)/1000)::integer+1 end,
     'millennium_last',case when hi is not null and model.adam_year is not null then floor((hi::numeric-model.adam_year)/1000)::integer+1 end));
 if octet_length(response::text)>51200 then return base||jsonb_build_object('status','packet_limit_exceeded'); end if;
 return response;
end $rpc$;
revoke all on function public.get_verse_chronology_v1(integer,integer,integer,text,text,text) from public;
grant execute on function public.get_verse_chronology_v1(integer,integer,integer,text,text,text) to anon,authenticated,service_role;
notify pgrst,'reload schema';
