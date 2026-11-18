/** Bounded read-only resource probe. One attempt per request; no retries. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const [base, output] = process.argv.slice(2);
assert.ok(base && output, 'Usage: node scripts/verify-r12-staging-resources.mjs URL OUTPUT.json');
const url = new URL(base);
assert.ok(['127.0.0.1', 'localhost', 'bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev'].includes(url.hostname));
const cases = [
  ['discover_biblical_connections_v2', { query: 'scarlet Tamar Rahab Matthew 1' }],
  ['discover_biblical_connections_v2', { query: 'spirit wind' }],
  ['discover_biblical_connections_v2', { query: 'Hagar seeing eyes spring' }],
  ['get_connection_evidence_v1', { evidence_id: 'r11:gram:G3037:modifies:G5093' }],
  ['get_connection_evidence_v1', { evidence_id: 'r11:gram:H5397:possessive_construction_with:H7307' }],
  ['query_relationships_v2', { mode: 'unified_lemma', query: 'H7307', book: 1, chapter: 1, verse: 2, position: 9 }],
];
const started = new Date().toISOString();
async function probe([operation, params], phase, index) {
  try {
    const response = await fetch(new URL(`/v1/rpc/${operation}?resource_probe=${phase}-${index}`, url), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-R12-Trace-Id': `task1-${phase}-${index}` },
      body: JSON.stringify(params), signal: AbortSignal.timeout(60000), redirect: 'error',
    });
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { operation, params, phase, status: response.status, version: response.headers.get('X-BibleResearch-Version'),
      ray: response.headers.get('cf-ray'), trace: JSON.parse(response.headers.get('X-R12-Trace') || 'null'), body };
  } catch (error) { return { operation, params, phase, error: String(error) }; }
}
// First wave starts together without warming RPC assets; second observes warm behavior.
const results = [];
for (const phase of ['cold-concurrent', 'warm-concurrent']) results.push(...await Promise.all(cases.map((c, i) => probe(c, phase, i))));
fs.writeFileSync(output, JSON.stringify({ started, ended: new Date().toISOString(), base, retries: 0, results }, null, 2));
console.log(results.map(r => ({ operation: r.operation, query: r.params.query || r.params.evidence_id,
  phase: r.phase, status: r.status, error: r.error, body_status: r.body?.status,
  reads: r.trace?.asset_reads, decoded_bytes: r.trace?.decoded_bytes,
    coverage: r.body?.coverage || r.body?.search_metadata, version: r.version })));
for (const r of results.filter(r => r.status === 200)) {
  if (r.operation === 'get_connection_evidence_v1') {
    assert.equal(r.body.evidence?.evidence_id, r.params.evidence_id);
    assert.equal(r.body.evidence?.passages?.length, 3);
    assert.ok(r.body.evidence.provenance.source_record_ids.every(id => id.startsWith('rel:')));
  }
  if (r.operation === 'query_relationships_v2') assert.equal(r.body.resolved_occurrence?.word_id, 130555);
}
process.exitCode = results.every(r => r.status === 200 && (!r.body?.status || ['ok', 'not_found', 'no_evidence_in_covered_scope'].includes(r.body.status))) ? 0 : 1;
