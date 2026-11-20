import assert from 'node:assert/strict';
import { createApp } from '../supabase/functions/bible-mcp/index.ts';
import { parsePassageString } from '../supabase/functions/bible-mcp/bible-ref.ts';
import { computeGematria } from '../supabase/functions/bible-mcp/gematria.ts';

const SECRET = 'service_role_SECRET_VALUE_123';
const stub = async () => Response.json([]);
const appRead = createApp({ url: 'https://example.supabase.co', publicKey: 'sb_publishable_test' }, stub);
const appWrite = createApp({ url: 'https://example.supabase.co', publicKey: 'sb_publishable_test', serviceRoleKey: SECRET, agentKey: 'agent-key-ok' }, stub);
let id = 0;
async function rpc(app, path, method, params = {}, headers = {}) {
  const i = ++id;
  const res = await app(new Request(`https://example.supabase.co/functions/v1/bible-mcp${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: i, method, params }),
  }));
  const text = await res.text();
  const payload = res.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(p => p.id === i)
    : JSON.parse(text);
  return { text, payload };
}
const names = async (app, p) => (await rpc(app, p, 'tools/list')).payload.result.tools.map(t => t.name).sort();
const V2 = ['follow_connectionchain', 'get_Connection', 'get_Passage', 'get_Word', 'get_prompt', 'research', 'write_Note'].sort();
assert.deepEqual(await names(appWrite, '/mcp'), V2);
assert.deepEqual(await names(appRead, '/mcp'), V2.filter(n => n !== 'write_Note'));
assert.equal((await names(appWrite, '/legacy/mcp')).length, 46);
assert.equal((await names(appRead, '/legacy/mcp')).length, 41);
assert.equal((await rpc(appRead, '/mcp', 'prompts/list')).payload.result.prompts.length, 1);
assert.equal((await rpc(appRead, '/legacy/mcp', 'prompts/list')).payload.result.prompts.length, 22);
for (const [app, n] of [[appWrite, 7], [appRead, 6]]) {
  const h = await (await app(new Request('https://example.supabase.co/functions/v1/bible-mcp/health'))).json();
  assert.equal(h.tools, n); assert.equal(h.legacy_endpoint, '/legacy/mcp');
}
// parser + gematria
const r = parsePassageString('1COR12:10-1COR13:4');
console.log('parse shape', JSON.stringify(r).slice(0, 160));
const g = (s) => JSON.stringify(computeGematria(s));
for (const s of ['רוּחַ', 'אָדָם', 'כֹּפֶר', 'πνεῦμα', 'χξϛ', 'χξς']) console.log(s, g(s));
// get_prompt
const gp = await rpc(appRead, '/mcp', 'tools/call', { name: 'get_prompt', arguments: {} });
assert.ok(!gp.payload.result.isError); assert.ok(gp.text.length > 500);
const gp2 = await rpc(appRead, '/mcp', 'tools/call', { name: 'get_prompt', arguments: { x: 1 } });
assert.ok(gp2.payload.result?.isError || gp2.payload.error);
// research unknown op
const ru = await rpc(appRead, '/mcp', 'tools/call', { name: 'research', arguments: { operations: [{ op: 'eval', code: '1+1' }] } });
assert.ok(ru.payload.result?.isError || ru.payload.error);
// chain: bad token rejected
const bad = await rpc(appRead, '/mcp', 'tools/call', { name: 'follow_connectionchain', arguments: { chain: 'ch_deadbeef_notatoken_xxxxxxxx', action: 'inspect' } });
assert.ok(bad.payload.result?.isError || /invalid|expired|not.found|rejected/i.test(bad.text));
// write_Note auth matrix: no key / wrong key never succeeds, never leaks secret
for (const hdr of [{}, { Authorization: 'Bearer wrong' }]) {
  const w = await rpc(appWrite, '/mcp', 'tools/call', { name: 'write_Note', arguments: { action: 'create', title: 't', body: 'x' } }, hdr);
  assert.ok(!w.text.includes(SECRET));
  assert.ok(w.payload.result?.isError || w.payload.error, 'write must be refused: ' + w.text.slice(0, 200));
}
console.log('PASS mcp v2 local: surface split, health, unit parse/gematria printed, get_prompt strict, research op validation, chain token guard, write_Note refusal without valid key, no secret leak');
