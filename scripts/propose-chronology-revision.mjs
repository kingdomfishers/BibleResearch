// Generates reviewable SQL only. It never executes SQL or promotes a candidate.
import fs from 'node:fs/promises';
import { readProposal,literal,jsonSql,proposalGuard } from './chronology-revision-contract.mjs';
const [input,output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/propose-chronology-revision.mjs proposal.json output.sql');
const {doc,hash} = await readProposal(input);
const sql = `begin;\n${proposalGuard(doc,hash)}
insert into public.chronology_revisions(proposal_key,model_id,parent_run_id,action,actor,payload)
values(${literal(doc.proposal_key)},${literal(doc.model_id)},${literal(doc.parent_run_id)}::bigint,'proposed',${literal(doc.actor)},
${jsonSql({proposal_sha256:hash,proposal:doc})}) on conflict(proposal_key,action) do nothing;
commit;\n`;
await fs.writeFile(output,sql);
console.log(`Prepared private candidate SQL for ${doc.proposal_key}; no date or release was changed.`);
