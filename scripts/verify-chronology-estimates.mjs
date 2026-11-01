import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const data = JSON.parse(await fs.readFile('data/chronology/context-estimates.json', 'utf8'));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
assert.equal(data.models.length, 2);
assert.equal(data.models[0].resurrectionYear - data.models[0].offsetYears, -3970);
assert.equal(data.models[1].resurrectionYear - data.models[1].offsetYears, -3967);
const json = `${quote(JSON.stringify(data))}::jsonb`;
const sql = `begin;
insert into public.chronology_sources(source_key,dataset,version,locator,license,attribution,raw_metadata)
values('user-premise:v1','User-confirmed Adam premise','1','local:context-estimates.json','User supplied premise','User; scenario arithmetic by Codex',${json}) on conflict(source_key) do nothing;
insert into public.chronology_models(id,name,adam_year,resurrection_year,assumptions)
select m->>'id',m->>'name',(m->>'resurrectionYear')::integer-(m->>'offsetYears')::integer,(m->>'resurrectionYear')::integer,
jsonb_build_object('premise','Adam creation approximately 4,000 elapsed years before resurrection','offset_years',4000,'resurrection_year_assumption',(m->>'resurrectionYear')::integer,'certainty','Model premise, not archaeological finding','scope','Cited creation context only; other dates are not shifted')
from jsonb_array_elements(${json}->'models') m on conflict(id) do nothing;
insert into public.chronology_assertions(assertion_key,model_id,verse_id,source_id,axis,earliest_year,latest_year,preferred_year,precision,method,rationale,author,review_status,mapping)
select m.id||':'||v.id,m.id,v.id,s.id,'setting',m.adam_year,m.adam_year,m.adam_year,'approximate',
${quote(data.method)},${quote(data.rationale)},${quote(data.author)},'model_assumption',
jsonb_build_object('context',c->>'citation','locator',c->>'locator','applicability','inherited','uncertainty',${quote(data.uncertainty)})
from jsonb_array_elements(${json}->'contexts') c
join public.verses v on v.book=(c->>'book')::integer and v.chapter=(c->>'chapter')::integer and v.verse_nr between (c->>'firstVerse')::integer and (c->>'lastVerse')::integer
cross join public.chronology_models m cross join public.chronology_sources s
where m.id in ('adam-resurrection-30-v1','adam-resurrection-33-v1') and s.source_key='user-premise:v1'
on conflict(assertion_key) do nothing;
do $check$ begin
 if (select count(*) from public.chronology_assertions where model_id in ('adam-resurrection-30-v1','adam-resurrection-33-v1'))<>50 then raise exception 'User anchor scope mismatch'; end if;
end $check$;
commit;`;
await fs.writeFile('.artifacts/chronology-audit/estimates.sql', sql);
console.log('Validated both relative anchors; prepared 25 cited context assignments per scenario.');
