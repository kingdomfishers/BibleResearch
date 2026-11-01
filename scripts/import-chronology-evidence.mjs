// Generate evidence import and publication SQL for authenticated administration.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const data = JSON.parse(await fs.readFile('data/chronology/evidence.json', 'utf8'));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
for (const row of data.items) {
  for (const field of ['key','category','title','citation','locator','summary','dating_method','scope','uncertainty','review_status']) assert.ok(row[field], `${row.key}: ${field}`);
  assert.ok(row.locator.startsWith('https://') || row.locator.startsWith('local:'));
}
assert.equal(new Set(data.items.map(row => row.key)).size, data.items.length);
const items = `${quote(JSON.stringify(data.items))}::jsonb`;
const sql = `begin;
insert into public.chronology_sources(source_key,dataset,version,locator,license,attribution,raw_metadata)
values('israel-museum-prism:v1','Israel Museum Jerusalem Prism catalog','2026-11-01',
'https://www.imj.org.il/en/exhibitions/special-display-assyrian-campaign-judah-told-sennacherib-prism',
'Original short summary and catalog link; no images or transcription copied','Israel Museum; exhibition text Laura A. Peri',
'{"object":"IMJ 71.72.249","object_year":-690,"campaign_year":-700}') on conflict(source_key) do nothing;
insert into public.chronology_models(id,name,assumptions) values('archaeology-pilot-v1','Archaeological context: Sennacherib pilot',
'{"basis":"Museum-attributed campaign context, not full-Bible chronology","scope":"2 Kings 18:13 and Isaiah 36:1","review":"Codex source verification, not independent expert review"}') on conflict(id) do nothing;
insert into public.chronology_evidence(evidence_key,source_id,category,title,citation,locator,summary,dating_method,scope,uncertainty,review_status,object_year,event_year,provenance)
select e->>'key',s.id,e->>'category',e->>'title',e->>'citation',e->>'locator',e->>'summary',e->>'dating_method',e->>'scope',e->>'uncertainty',e->>'review_status',
(e->>'object_year')::integer,(e->>'event_year')::integer,coalesce(e->'provenance','{}')||'{"reviewer":"Codex; source verification, not independent expert review"}'::jsonb
from jsonb_array_elements(${items}) e join public.chronology_sources s on s.source_key=case e->>'source'
when 'theographic-verses' then 'theographic:verses:744355c7a5f38efd407bc67a5257c99aca9532bc'
when 'theographic-events' then 'theographic:events:744355c7a5f38efd407bc67a5257c99aca9532bc'
when 'user-premise' then 'user-premise:v1' else 'israel-museum-prism:v1' end on conflict(evidence_key) do nothing;
insert into public.chronology_assertions(assertion_key,model_id,verse_id,source_id,axis,earliest_year,latest_year,preferred_year,precision,method,rationale,author,review_status)
select 'archaeology:sennacherib:'||v.id,'archaeology-pilot-v1',v.id,s.id,'setting',-700,-700,-700,'approximate','museum_campaign_correlation',
'Correlate the named Sennacherib campaign with the museum-attributed 701 BC campaign. The prism itself dates to 691 BC. Source-model alternatives are retained.',
'Codex source verification; Israel Museum catalog','reviewed'
from public.verses v cross join public.chronology_sources s where (v.book,v.chapter,v.verse_nr) in ((12,18,13),(23,36,1)) and s.source_key='israel-museum-prism:v1'
on conflict(assertion_key) do nothing;
insert into public.chronology_assertion_evidence(assertion_id,evidence_id,relationship,applicability,explanation)
select a.id,e.id,'supporting','direct','Attribution and method of the source estimate; this is not independent archaeological evidence.'
from public.chronology_assertions a join public.chronology_evidence e on e.evidence_key=case a.model_id when 'theographic-verse-v1' then 'theographic-verse-method' when 'theographic-events-v1' then 'theographic-event-method' else 'adam-relative-premise' end
where a.model_id in ('theographic-verse-v1','theographic-events-v1','adam-resurrection-30-v1','adam-resurrection-33-v1') and not a.published and not exists(select 1 from public.chronology_assertion_evidence old where old.assertion_id=a.id and old.evidence_id=e.id) on conflict do nothing;
insert into public.chronology_assertion_evidence(assertion_id,evidence_id,relationship,applicability,explanation)
select a.id,e.id,'contextual','inherited','Text identifies the narrative context; it does not independently establish the absolute year or the 4,000-year interval.'
from public.chronology_assertions a cross join public.chronology_evidence e
where ((a.model_id like 'adam-%' and e.evidence_key='genesis-creation-text')
or (a.model_id='theographic-events-v1' and a.verse_id in (select id from public.verses where book=44 and chapter=2 and verse_nr between 1 and 4) and e.evidence_key='pentecost-text'))
and not exists(select 1 from public.chronology_assertion_evidence old where old.assertion_id=a.id and old.evidence_id=e.id) on conflict do nothing;
insert into public.chronology_assertion_evidence(assertion_id,evidence_id,relationship,applicability,explanation)
select a.id,e.id,case when a.model_id='archaeology-pilot-v1' then 'supporting' else 'challenging' end,'direct',
case when a.model_id='archaeology-pilot-v1' then 'Museum-attributed campaign context; object date and event date are distinct.' else 'This historical correlation offers a competing campaign year to the source placement; no claim that every detail has been adjudicated.' end
from public.chronology_assertions a join public.verses v on v.id=a.verse_id cross join public.chronology_evidence e
where (v.book,v.chapter,v.verse_nr) in ((12,18,13),(23,36,1))
and a.model_id in ('archaeology-pilot-v1','theographic-verse-v1') and e.evidence_key in ('sennacherib-jerusalem-prism','sennacherib-text')
and not exists(select 1 from public.chronology_assertion_evidence old where old.assertion_id=a.id and old.evidence_id=e.id) on conflict do nothing;
-- Publish draft content once evidence is attached. Existing published rows stay immutable.
update public.chronology_sources set published=true where not published and (source_key like 'theographic:%:744355c7a5f38efd407bc67a5257c99aca9532bc' or source_key in ('user-premise:v1','israel-museum-prism:v1'));
update public.chronology_models set published=true where not published and id in ('theographic-verse-v1','theographic-events-v1','adam-resurrection-30-v1','adam-resurrection-33-v1','archaeology-pilot-v1');
update public.chronology_events set published=true where not published and source_id in (select id from public.chronology_sources where source_key='theographic:events:744355c7a5f38efd407bc67a5257c99aca9532bc');
update public.chronology_evidence set published=true where not published and evidence_key in (select e->>'key' from jsonb_array_elements(${items}) e) and review_status<>'candidate';
update public.chronology_assertions set published=true where not published and review_status<>'candidate' and assertion_key ~ '^(verse:|event:|adam-resurrection-(30|33)-v1:|archaeology:sennacherib:)';
do $publish$ declare m record; begin
for m in select id from public.chronology_models where published and not exists(select 1 from public.chronology_active_runs r where r.model_id=chronology_models.id) loop
perform public.chronology_publish_run(m.id,'Initial attributed chronology release 2026-11-01');
end loop; end $publish$;
commit;`;
await fs.writeFile('.artifacts/chronology-audit/evidence.sql', sql);
console.log(`Validated ${data.items.length} evidence entries; generated draft import and initial publication SQL.`);
