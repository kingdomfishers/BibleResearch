import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
export const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export const jsonSql = value => `${literal(JSON.stringify(value))}::jsonb`;
const bounded = (value,name,max=2000) => assert.ok(typeof value==='string' && value.trim() && value.length<=max,`Invalid ${name}`);
export function validateProposal(doc) {
  assert.match(doc.proposal_key,/^[a-zA-Z0-9:_-]{1,100}$/);
  assert.match(doc.model_id,/^[a-zA-Z0-9_-]{1,100}$/);
  assert.match(doc.parent_run_id,/^[1-9][0-9]{0,17}$/);
  for (const name of ['actor','license','attribution','rationale']) bounded(doc[name],name);
  bounded(doc.ai?.model,'AI model',200);
  assert.match(doc.ai?.prompt_sha256,/^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(doc.ai?.input_sha256) && doc.ai.input_sha256.length>0 && doc.ai.input_sha256.length<=100);
  doc.ai.input_sha256.forEach(hash=>assert.match(hash,/^[a-f0-9]{64}$/));
  assert.ok(Array.isArray(doc.assertions) && doc.assertions.length>0 && doc.assertions.length<=100);
  const replaced = new Set();
  for (const a of doc.assertions) {
    assert.ok(Number.isInteger(a.book) && a.book>=1 && a.book<=66);
    assert.ok(Number.isInteger(a.chapter) && a.chapter>=1 && a.chapter<=150);
    assert.ok(Number.isInteger(a.verse) && a.verse>=0 && a.verse<=176);
    assert.ok(['source_placement','setting','composition','mentioned_event'].includes(a.axis));
    assert.ok(Number.isInteger(a.earliest_year) && Number.isInteger(a.latest_year) && a.earliest_year<=a.latest_year);
    assert.ok(Math.abs(a.earliest_year)<=100000 && Math.abs(a.latest_year)<=100000);
    assert.ok(a.preferred_year==null || (Number.isInteger(a.preferred_year) && a.preferred_year>=a.earliest_year && a.preferred_year<=a.latest_year));
    if (a.supersedes!=null) {
      assert.match(a.supersedes,/^[1-9][0-9]{0,17}$/);
      assert.ok(!replaced.has(a.supersedes),'Cannot replace the same assertion twice');
      replaced.add(a.supersedes);
    }
    bounded(a.rationale,'assertion rationale');
    assert.ok(Array.isArray(a.evidence) && a.evidence.length>0 && a.evidence.length<=10);
    for (const e of a.evidence) {
      assert.ok(['textual','archaeological','model_premise','scholarly_interpretation'].includes(e.category));
      assert.ok(['supporting','challenging','contextual'].includes(e.relationship));
      for (const name of ['title','citation','locator','summary','dating_method','scope','uncertainty','explanation']) bounded(e[name],name);
      const url = new URL(e.locator); assert.equal(url.protocol,'https:');
      for (const name of ['object_year','event_year']) assert.ok(e[name]==null || Number.isInteger(e[name]));
    }
  }
  assert.ok(Buffer.byteLength(JSON.stringify(doc))<=250000,'Proposal exceeds 250 KiB');
  return createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}
export async function readProposal(path) {
  const doc = JSON.parse(await fs.readFile(path,'utf8'));
  return {doc,hash:validateProposal(doc)};
}
export function proposalGuard(doc,hash) {
  return `do $guard$ begin
if not exists(select 1 from public.chronology_runs r join public.chronology_models m on m.id=r.model_id
 where r.id=${literal(doc.parent_run_id)}::bigint and r.model_id=${literal(doc.model_id)} and r.published and m.published) then raise exception 'Unknown published parent/model'; end if;
if exists(select 1 from public.chronology_revisions where proposal_key=${literal(doc.proposal_key)} and payload->>'proposal_sha256'<>${literal(hash)}) then raise exception 'Proposal key/content mismatch'; end if;
end $guard$;`;
}
