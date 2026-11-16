/** Read-only discovery acceptance across named regression concepts and combinations. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNodeFsAssetReader } from '../src/relationships/adjacency-loader.ts';
import { discoverBiblicalConnections } from '../src/relationships/r10-discovery.ts';
const reader = await createNodeFsAssetReader(['.artifacts-r10/deploy-bundle']);
const concepts = 'lily fig vine acacia myrtle wheat barley salt honey cedar pomegranate hyssop lion lamb dove serpent eagle ox goat fish wolf altar ark priest tabernacle veil crown garment bronze gate lampstand wisdom mercy justice righteousness holiness sin repentance resurrection exile salvation faith love covenant three four seven twelve forty seventy'.split(' ').concat('one hundred');
const pairs = ['lily temple', 'lily molten sea', 'pomegranate priestly garment', 'cedar temple', 'hyssop cleansing', 'blood door', 'oil lampstand', 'tree life', 'temple garden', 'bread wilderness', 'water spirit', 'covenant rainbow', 'forty wilderness'];
const report = [];
for (const query of [...concepts, ...pairs]) {
  const result = await discoverBiblicalConnections(reader, { query });
  const direct = result.parsed_query.resolved_concepts.some(c => c.total_verses > 0) || result.strongest_connections.some(c => c.predicate === 'numbered_entity');
  report.push({ query, direct, missing: result.parsed_query.missing_concepts, top: result.strongest_connections[0]?.title,
    support: result.strongest_connections[0]?.query_support, ms: result.search_metadata.execution_ms, reads: result.search_metadata.asset_requests_used });
  assert.equal(result.search_metadata.exhaustive, false);
}
for (const [lemma, refs] of [['H7799', ['1 Kings 7:19', '1 Kings 7:22', '1 Kings 7:26', '2 Chronicles 4:5', 'Psalms 45:0', 'Psalms 60:0', 'Psalms 69:0', 'Psalms 80:0', 'Song of Solomon 2:1', 'Song of Solomon 2:2', 'Hosea 14:5']], ['G2918', ['Matthew 6:28', 'Luke 12:27']]]) {
  const actual = [];
  let cursor = null;
  do {
    const result = await discoverBiblicalConnections(reader, { query: lemma, mode: 'expand', focus_lemma: lemma, limit: 6, cursor });
    actual.push(...result.iterative_analysis.lemma_occurrences.passages.map(p => p.ref));
    cursor = result.iterative_analysis.lemma_occurrences.next_cursor;
  } while (cursor);
  for (const ref of refs) assert.ok(actual.includes(ref), `${lemma}: missing ${ref}: ${actual}`);
  if (lemma === 'H7799') assert.equal(actual.length, 17);
}
fs.mkdirSync('.artifacts-r10/benchmarks', { recursive: true });
fs.writeFileSync('.artifacts-r10/benchmarks/acceptance.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
assert.ok(report.every(r => r.direct), `No direct evidence: ${report.filter(r => !r.direct).map(r => r.query)}`);
