-- Adversarial pagination and privacy checks. Entire fixture is rolled back.
begin;
insert into public.chronology_models(id,name,published) values('test-pagination','Pagination verification',true);
insert into public.chronology_sources(source_key,dataset,version,locator,license,attribution,published)
values('test-pagination','Synthetic test','1','https://example.org','Original fixture','Rollback only',true);
insert into public.chronology_assertions(assertion_key,model_id,verse_id,source_id,axis,earliest_year,latest_year,preferred_year,precision,method,rationale,author,review_status)
select 'test-page:'||g,'test-pagination',v.id,s.id,'setting',0,0,0,'approximate','synthetic','Fixture only','Verifier','reviewed'
from generate_series(1,12) g cross join public.verses v cross join public.chronology_sources s
where v.book=1 and v.chapter=1 and v.verse_nr=1 and s.source_key='test-pagination';
insert into public.chronology_evidence(evidence_key,source_id,category,title,citation,locator,summary,dating_method,scope,uncertainty,review_status)
select 'test-page:e'||g,s.id,'textual','Synthetic evidence '||g,'Fixture only','https://example.org','Not historical evidence','Synthetic','Test only','Test only','reviewed'
from generate_series(1,2)g cross join public.chronology_sources s where s.source_key='test-pagination';
insert into public.chronology_assertion_evidence(assertion_id,evidence_id,relationship,applicability,explanation)
select a.id,e.id,'contextual','direct','Fixture only' from public.chronology_assertions a cross join public.chronology_evidence e
where a.model_id='test-pagination' and e.evidence_key like 'test-page:e%';
update public.chronology_evidence set published=true where evidence_key like 'test-page:e%';
update public.chronology_assertions set published=true where model_id='test-pagination';
select public.chronology_publish_run('test-pagination','Rolled back pagination fixture');
insert into public.chronology_models(id,name) values('test-draft-private','Must remain invisible');
set local role anon;
do $test$
declare first_page jsonb; next_page jsonb; invalid jsonb; denied boolean:=false;
begin
  first_page:=public.get_verse_chronology_v1(1,1,1,'test-pagination');
  if first_page->>'status'<>'ok' or jsonb_array_length(first_page->'evidence')<>20
    or first_page->>'evidence_truncated'<>'true' then raise exception 'Evidence cap/pagination failed'; end if;
  if first_page->'summary'->>'label'<>'around 1 BC' then raise exception 'Year zero label failed'; end if;
  next_page:=public.get_verse_chronology_v1(1,1,1,'test-pagination',first_page->'run'->>'id',first_page->>'next_evidence_cursor');
  if next_page->>'status'<>'ok' or jsonb_array_length(next_page->'evidence')<>4
    or next_page->>'evidence_truncated'<>'false' then raise exception 'Evidence continuation failed'; end if;
  if exists(select 1 from jsonb_array_elements(first_page->'evidence') a
    join jsonb_array_elements(next_page->'evidence') b on (a->>'assertion_id',a->>'id')=(b->>'assertion_id',b->>'id')) then
    raise exception 'Repeated evidence across page boundary';
  end if;
  invalid:=public.get_verse_chronology_v1(1,1,1,'test-pagination',first_page->'run'->>'id',(first_page->'run'->>'id')||':99999999:1');
  if invalid->>'status'<>'invalid_cursor' then raise exception 'Forged cursor accepted'; end if;
  if (public.get_verse_chronology_v1(1,1,1,'test-draft-private')->>'status')<>'invalid_model' then raise exception 'Draft model disclosed'; end if;
  begin perform 1 from public.chronology_revisions; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Private revision inputs are public'; end if;
  if octet_length(first_page::text)>51200 then raise exception 'Packet limit failed'; end if;
end $test$;
reset role;
rollback;
