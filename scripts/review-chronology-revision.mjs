// Requires a deliberate review decision. Generates inspectable admin SQL, never executes it.
import fs from 'node:fs/promises';
import { readProposal,literal,jsonSql,proposalGuard } from './chronology-revision-contract.mjs';
const [input,decision,reviewer,output] = process.argv.slice(2);
if (!input || !['approve','reject'].includes(decision) || !reviewer?.trim() || !output) {
  throw new Error('Usage: node scripts/review-chronology-revision.mjs proposal.json approve|reject reviewer output.sql');
}
const {doc,hash} = await readProposal(input);
const q = literal;
let sql = `begin;\n${proposalGuard(doc,hash)}
select pg_advisory_xact_lock(hashtextextended(${q('chronology:'+doc.model_id)},0));
do $guard$ begin
if not exists(select 1 from public.chronology_revisions where proposal_key=${q(doc.proposal_key)} and action='proposed' and payload->>'proposal_sha256'=${q(hash)}) then raise exception 'Matching proposal must be recorded first'; end if;
if exists(select 1 from public.chronology_revisions where proposal_key=${q(doc.proposal_key)} and action in ('approved','rejected')) then raise exception 'Proposal already decided'; end if;
end $guard$;
`;
if (decision==='approve') {
  sql += `do $guard$ begin
if not exists(select 1 from public.chronology_active_runs where model_id=${q(doc.model_id)} and run_id=${q(doc.parent_run_id)}::bigint) then raise exception 'Stale parent release; rebase and review again'; end if;
end $guard$;
insert into public.chronology_sources(source_key,dataset,version,locator,license,attribution,raw_metadata)
values(${q('revision:'+doc.proposal_key)},'Reviewed chronology revision',${q(hash)},${q('local:revision:'+doc.proposal_key)},${q(doc.license)},${q(doc.attribution)},${jsonSql({ai:doc.ai,reviewer,proposal_sha256:hash})});
`;
  for (const [i,a] of doc.assertions.entries()) {
    const akey = `revision:${doc.proposal_key}:${i}`;
    const where = `v.book=${a.book} and v.chapter=${a.chapter} and v.verse_nr=${a.verse}`;
    sql += `do $guard$ begin
if not exists(select 1 from public.verses v where ${where}) then raise exception 'Unknown target passage'; end if;
${a.supersedes ? `if not exists(select 1 from public.chronology_assignment_assertions aa join public.chronology_assertions a on a.id=aa.assertion_id join public.verses v on v.id=aa.verse_id where aa.run_id=${q(doc.parent_run_id)}::bigint and a.id=${q(a.supersedes)}::bigint and a.model_id=${q(doc.model_id)} and a.axis=${q(a.axis)} and ${where}) then raise exception 'Invalid superseded assertion'; end if;` : ''}
if exists(select 1 from public.chronology_models where id=${q(doc.model_id)} and id like 'adam-%' and adam_year is distinct from ${a.preferred_year ?? a.earliest_year}) and ${a.book}=1 and ${q(a.axis)}='setting' then raise exception 'Change model assumptions in a new model version first'; end if;
end $guard$;
insert into public.chronology_assertions(assertion_key,model_id,verse_id,source_id,axis,earliest_year,latest_year,preferred_year,precision,method,rationale,author,review_status,supersedes,mapping)
select ${q(akey)},${q(doc.model_id)},v.id,s.id,${q(a.axis)},${a.earliest_year},${a.latest_year},${a.preferred_year ?? 'null'},${q(a.earliest_year===a.latest_year?'approximate':'range')},'reviewed_ai_proposal',${q(a.rationale)},${q(reviewer)},'reviewed',${a.supersedes ? q(a.supersedes)+'::bigint' : 'null'},${jsonSql({proposal_key:doc.proposal_key,proposal_sha256:hash,ai_model:doc.ai.model})}
from public.verses v cross join public.chronology_sources s where ${where} and s.source_key=${q('revision:'+doc.proposal_key)};
`;
    for (const [j,e] of a.evidence.entries()) {
      const ekey = `${akey}:e${j}`;
      sql += `insert into public.chronology_evidence(evidence_key,source_id,category,title,citation,locator,summary,dating_method,scope,uncertainty,review_status,object_year,event_year,provenance)
select ${q(ekey)},s.id,${q(e.category)},${q(e.title)},${q(e.citation)},${q(e.locator)},${q(e.summary)},${q(e.dating_method)},${q(e.scope)},${q(e.uncertainty)},'reviewed',${e.object_year ?? 'null'},${e.event_year ?? 'null'},${jsonSql({reviewer,proposal_sha256:hash})} from public.chronology_sources s where s.source_key=${q('revision:'+doc.proposal_key)};
insert into public.chronology_assertion_evidence(assertion_id,evidence_id,relationship,applicability,explanation)
select a.id,e.id,${q(e.relationship)},'direct',${q(e.explanation)} from public.chronology_assertions a cross join public.chronology_evidence e where a.assertion_key=${q(akey)} and e.evidence_key=${q(ekey)};
`;
    }
  }
  sql += `update public.chronology_sources set published=true where source_key=${q('revision:'+doc.proposal_key)};
update public.chronology_evidence set published=true where source_id=(select id from public.chronology_sources where source_key=${q('revision:'+doc.proposal_key)});
update public.chronology_assertions set published=true where source_id=(select id from public.chronology_sources where source_key=${q('revision:'+doc.proposal_key)});
select public.chronology_publish_run(${q(doc.model_id)},${q('Reviewed revision '+doc.proposal_key+' by '+reviewer)});
`;
}
sql += `insert into public.chronology_revisions(proposal_key,model_id,parent_run_id,action,actor,payload)
values(${q(doc.proposal_key)},${q(doc.model_id)},${q(doc.parent_run_id)}::bigint,${q(decision==='approve'?'approved':'rejected')},${q(reviewer)},${jsonSql({proposal_sha256:hash,decision,rationale:doc.rationale})});
commit;\n`;
await fs.writeFile(output,sql);
console.log(`Prepared ${decision} SQL for ${doc.proposal_key}. Review source citations and the complete diff before authenticated execution.`);
