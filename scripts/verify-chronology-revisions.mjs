import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chronology } from './chronology-client.mjs';
import { validateProposal } from './chronology-revision-contract.mjs';
const packet = await chronology({p_book:1,p_chapter:2,p_verse:7});
assert.equal(packet.status,'ok');
const doc = {proposal_key:'test-chronology-workflow',model_id:packet.model.id,parent_run_id:packet.run.id,
  actor:'Verification fixture',license:'Original verification data',attribution:'Automated rollback-only fixture',
  rationale:'Exercise publication and rollback without changing retained data',
  ai:{model:'verification-fixture-only',prompt_sha256:'0'.repeat(64),input_sha256:['1'.repeat(64)]},
  assertions:[{book:1,chapter:2,verse:7,axis:'source_placement',earliest_year:-4005,latest_year:-4001,
    preferred_year:-4003,supersedes:packet.assertions[0].id,rationale:'Synthetic interval for transaction-only verification',
    evidence:[{category:'scholarly_interpretation',relationship:'contextual',title:'Fixture source',citation:'Fixture only',
      locator:'https://example.org/chronology-test',summary:'Not a historical evidence claim',dating_method:'Synthetic test',
      scope:'Verification only',uncertainty:'Not a published historical result',explanation:'Exercise typed evidence'}]}]};
validateProposal(doc);
const invalid = structuredClone(doc); invalid.assertions[0].earliest_year=2;
assert.throws(()=>validateProposal(invalid));
const unsafe = structuredClone(doc); unsafe.assertions[0].evidence[0].locator='javascript:alert(1)';
assert.throws(()=>validateProposal(unsafe));
const noEvidence = structuredClone(doc); noEvidence.assertions[0].evidence=[];
assert.throws(()=>validateProposal(noEvidence));
const dir='.artifacts/chronology-audit';
const input=`${dir}/revision-test.json`;
await fs.writeFile(input,JSON.stringify(doc));
for (const [script,args] of [
  ['propose-chronology-revision.mjs',[input,`${dir}/revision-proposed.sql`]],
  ['review-chronology-revision.mjs',[input,'approve','Rollback-only verifier',`${dir}/revision-approved.sql`]],
]) {
  const result=spawnSync(process.execPath,[`scripts/${script}`,...args],{encoding:'utf8'});
  if(result.status!==0) throw new Error(result.stderr);
}
const unwrap = sql => sql.replace(/^\s*begin;\s*/,'').replace(/commit;\s*$/,'');
const proposed=unwrap(await fs.readFile(`${dir}/revision-proposed.sql`,'utf8'));
const approved=unwrap(await fs.readFile(`${dir}/revision-approved.sql`,'utf8'));
await fs.writeFile(`${dir}/revision-workflow-test.sql`,`begin;\n${proposed}\n${approved}
do $test$ declare latest jsonb; previous jsonb; begin
latest:=public.get_verse_chronology_v1(1,2,7);
previous:=public.get_verse_chronology_v1(1,2,7,'theographic-verse-v1','${packet.run.id}');
if latest->'summary'->>'earliest_year'<>'-4005' then raise exception 'Revision not selected'; end if;
if previous->'summary'->>'earliest_year'<>'-4003' then raise exception 'Old release changed'; end if;
if (latest->'run'->>'id')='${packet.run.id}' then raise exception 'Publication did not create a new run'; end if;
if not exists(select 1 from public.chronology_revisions where proposal_key='test-chronology-workflow' and action='approved') then raise exception 'Missing decision history'; end if;
end $test$;
rollback;\n`);
console.log('Revision validation passed (bad bounds, unsafe citation URL, missing evidence). Generated rollback-only SQL workflow verification.');
