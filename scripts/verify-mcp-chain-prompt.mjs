// Local-only fixtures: no network, database, user notes, or production mutation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createChainStore } from '../supabase/functions/bible-mcp/chain-store.ts';
import { selectChainEvidence, chainEvidenceTarget } from '../supabase/functions/bible-mcp/chain-evidence.ts';
import { createDiscoveryV2Server } from '../supabase/functions/bible-mcp/discovery-v2-tools.ts';
import { WORKFLOW_INSTRUCTIONS } from '../supabase/functions/bible-mcp/research-workflow.ts';

const archive = JSON.parse(await fs.readFile('research/r12/mcp_v2_live_audit_2026-11-20/RAW_CASES.json', 'utf8'));
const seed = archive.chain_tests[0];
const follow = archive.chain_tests[1];
assert.equal(follow.output.added_step.relation, 'exploratory_step', 'Archived reproduction');
const known = selectChainEvidence(seed.output.next_connections, seed.input.next, follow.input.next);
assert.ok(known, 'Archived suggested edge already documents the requested target');
assert.ok(known.refs.includes('Revelation 11:4'));
assert.equal(chainEvidenceTarget(known, 'Zechariah 4'), 'Exodus 25:31');
assert.equal(selectChainEvidence([known], 'Zechariah 4', 'Genesis 1:1'), undefined);
assert.equal(selectChainEvidence([known], 'Zechariah 4', 'Zech 4:2'), undefined);

const initial = { root: 'Zechariah 4', current_node: 'Zechariah 4', visited_nodes: ['Zechariah 4'], visited_edges: [], steps: [], branches: [], active_candidates: [known] };
let now = Date.parse('2026-11-21T00:00:00Z');
const store = createChainStore(null, undefined, { now: () => now, ttlMs: 1000 });
const created = await store.create(initial, 'owner');
assert.ok(created.ok);
assert.equal((await store.load(created.handle, 'other')).error, 'chain_access_denied');
assert.equal((await store.load(created.handle)).error, 'chain_access_denied');
assert.equal((await store.load(created.handle.slice(0, -1) + (created.handle.endsWith('0') ? '1' : '0'), 'owner')).error, 'chain_access_denied');
const loaded = await store.load(created.handle, 'owner');
assert.ok(loaded.ok);
loaded.state.current_node = 'Revelation 11:4';
const updated = await store.update(created.handle, loaded.state, 'owner');
assert.ok(updated.ok);
assert.equal(updated.state.expires_at, created.state.expires_at, 'Updates do not extend expiry');
assert.equal((await store.load(created.handle, 'owner')).state.current_node, 'Revelation 11:4');
now += 1000;
assert.equal((await store.load(created.handle, 'owner')).error, 'chain_expired');
const unbound = await store.create(initial);
assert.ok((await store.load(unbound.handle)).ok, 'Capability-only clients remain supported');

// Persist through a new isolate/store using a fake PostgREST service.
const rows = new Map();
const remote = async (input, init = {}) => {
  const url = new URL(input);
  if (init.method === 'POST') { const row = JSON.parse(init.body); rows.set(row.chain_id, row); return new Response(null, { status: 201 }); }
  if (init.method === 'PATCH') { Object.assign(rows.get(url.searchParams.get('chain_id').slice(3)), JSON.parse(init.body)); return new Response(null, { status: 204 }); }
  if (init.method === 'DELETE') return new Response(null, { status: 204 });
  return Response.json([rows.get(url.searchParams.get('chain_id').slice(3))].filter(Boolean));
};
const config = { url: 'https://fixture.invalid', serviceRoleKey: 'LOCAL_FIXTURE_ONLY' };
const persistent = await createChainStore(config, remote).create(initial, 'owner');
assert.ok(persistent.ok);
const restored = await createChainStore(config, remote).load(persistent.handle, 'owner');
assert.ok(restored.ok);
assert.deepEqual(restored.state.active_candidates, [known]);
restored.state.current_node = 'Revelation 11:4';
const remoteUpdated = await createChainStore(config, remote).update(persistent.handle, restored.state, 'owner');
assert.ok(remoteUpdated.ok);
assert.equal((await createChainStore(config, remote).load(persistent.handle, 'owner')).state.current_node, 'Revelation 11:4');

// Exercise real MCP handlers with archived suggestions and a deterministic reader.
const reader = async ({ name, args }) => ({ rows: [name === 'discover_biblical_connections_v2'
  ? { strongest_connections: args.query.startsWith('Zechariah') ? seed.output.next_connections : [known] }
  : {}], page: { limit: 1, offset: 0, has_more: false, next_offset: null } });
const app = createMcpHandler(() => createDiscoveryV2Server(reader, null, createStore), {});
const createStore = createChainStore();
let requestId = 0;
async function call(name, args) {
  const id = ++requestId;
  const response = await app.fetch(new Request('https://fixture.invalid/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const text = await response.text();
  const packet = text.startsWith('event:') || text.startsWith('data:')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(p => p.id === id)
    : JSON.parse(text);
  assert.ok(!packet.error && !packet.result.isError, text);
  return packet.result.structuredContent;
}
const started = await call('follow_connectionchain', seed.input);
const advanced = await call('follow_connectionchain', { ...follow.input, chain: started.chain });
assert.equal(advanced.added_step.edge_id, known.id);
assert.equal(advanced.added_step.relation, known.relation);
assert.deepEqual(advanced.added_step.refs, known.refs);
assert.equal(advanced.current_node, 'Revelation 11:4');
assert.ok(!advanced.next_connections.some(c => c.id === known.id), 'Do not repeat the traversed edge');
const inspected = await call('follow_connectionchain', { chain: started.chain, action: 'inspect' });
assert.equal(inspected.step, 1);
const branched = await call('follow_connectionchain', { chain: started.chain, action: 'branch', from_node: 'Zechariah 4' });
assert.equal(branched.current_node, 'Zechariah 4');
assert.equal(branched.branches.length, 1);
const revisited = await call('follow_connectionchain', { chain: started.chain, action: 'revisit', from_node: 'Revelation 11:4' });
assert.equal(revisited.current_node, 'Revelation 11:4');
const exploratory = await call('follow_connectionchain', { chain: started.chain, next: 'Genesis 1:1' });
assert.equal(exploratory.added_step.relation, 'exploratory_step');
assert.deepEqual(exploratory.added_step.refs, []);
const secondChain = await call('follow_connectionchain', seed.input);
const explicit = await call('follow_connectionchain', { chain: secondChain.chain, next: known.id });
assert.equal(explicit.added_step.edge_id, known.id);
assert.deepEqual(explicit.added_step.refs, known.refs);

const prompt = await call('get_prompt', {});
assert.equal(prompt.instructions, WORKFLOW_INSTRUCTIONS);
assert.ok(Buffer.byteLength(JSON.stringify(prompt)) < 6000);
assert.ok(!prompt.instructions.includes('study_bible'));
assert.ok(prompt.instructions.includes('Neither controls verse completeness or grammatical detail'));
for (const tool of ['get_Passage', 'get_Word', 'get_Connection', 'follow_connectionchain', 'research', 'write_Note', 'get_prompt']) assert.ok(prompt.instructions.includes(tool));
console.log(JSON.stringify({ passed: true, coverage: 'archived chain evidence; remote persistence; private/session and capability handles; fixed expiry; follow/inspect/branch/revisit; no repeated edge; exploratory distinction; prompt contract', prompt_before_bytes: archive.cases.find(c => c.id === 'G01').raw_bytes, prompt_after_bytes: Buffer.byteLength(JSON.stringify(prompt)) }));
