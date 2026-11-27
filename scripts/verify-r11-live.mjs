/** Public read-only live MCP protocol and cross-release regression. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const endpoint = 'https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp';
let id = 0;
const timings = [];
async function rpc(method, params) {
  const start = performance.now();
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const text = await response.text();
  assert.equal(response.status, 200, text.slice(0, 300));
  const packet = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(p => p.id === id) : JSON.parse(text);
  assert.ok(packet.result, JSON.stringify(packet));
  timings.push({ method, tool: params?.name, ms: Math.round(performance.now() - start) });
  return packet.result;
}
async function call(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  const payload = result.structuredContent || JSON.parse(result.content.find(c => c.type === 'text').text);
  console.log(name, args.query || args.evidence_id || '', payload.status, payload.release_version || payload.release_id || '');
  return payload;
}
await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'r11-release-verification', version: '1.0' } });
const tools = (await rpc('tools/list', {})).tools;
assert.ok(tools.some(t => t.name === 'discover_biblical_connections_v2'));
for (const query of ['H7307', 'H7799']) {
  for (const name of ['get_unified_word_relationships_v2', 'get_word_relationships_v2']) {
    const result = await call(name, { query });
    assert.equal(result.release_version, 'r9b-v1.0');
    assert.notEqual(result.status, 'unavailable');
  }
}
for (const [book, chapter, verse] of [[1, 1, 2], [11, 7, 26]]) {
  const result = await call('get_passage_grammatical_frames_v2', { book, chapter, verse });
  assert.equal(result.status, 'ok');
}
assert.equal((await call('get_relationship_coverage_v2', {})).status, 'ok');
const paths = await call('discover_relationship_paths_v1', { source: 'lemma:H7307', target: 'lemma:G4151', max_hops: 2 });
assert.ok(paths.paths.length);
const lily = await call('discover_biblical_connections_v2', { query: 'lily' });
assert.equal(lily.release_id, 'r11-v1.0');
assert.ok(lily.parsed_query.resolved_concepts.some(c => c.lemmas.some(l => l.strongs === 'H7799')));
assert.equal(lily.search_metadata.exhaustive, false);
const ids = new Set(); let cursor = null;
do {
  const result = await call('discover_biblical_connections_v2', { query: 'H7799', mode: 'expand', focus_lemma: 'H7799', limit: 6, cursor });
  for (const p of result.iterative_analysis.lemma_occurrences.passages) { assert.ok(!ids.has(p.verse_id)); ids.add(p.verse_id); }
  cursor = result.iterative_analysis.lemma_occurrences.next_cursor;
} while (cursor);
assert.equal(ids.size, 17);
assert.equal((await call('get_connection_evidence_v1', { evidence_id: lily.strongest_connections[0].evidence_id })).status, 'ok');
assert.equal((await call('expand_biblical_connection_v1', { node_id: 'cluster:H7799:temple_and_sanctuary_architecture' })).status, 'ok');
for (const evidence_id of ['r10:ident:auto:27705', 'r10:ident:auto:24806']) assert.equal((await call('get_connection_evidence_v1', { evidence_id })).status, 'not_found');
for (const query of ['H4728', 'G2090', 'gate', 'tree life', 'lily molten sea', 'one hundred', '1 Kings 7:26', 'Psalm 45:0', 'Genesis 1:2']) {
  const result = await call('discover_biblical_connections_v2', { query });
  assert.ok(['ok', 'partial'].includes(result.status), JSON.stringify(result));
}
fs.mkdirSync('.artifacts-r10/benchmarks', { recursive: true });
fs.writeFileSync('.artifacts-r10/benchmarks/live-mcp.json', JSON.stringify({ endpoint, tools: tools.length, timings }, null, 2));
console.log(`PASS live initialize, ${tools.length} tools, legacy defaults, discovery, pagination, evidence, expansion and identity quarantine.`);
