// Live read-only probe of the deployed BibleResearch MCP v2 surface. Usage: node scripts/verify-mcp-v2-live.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
const BASE = process.env.MCP_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp';
const OUT = '.artifacts-r12/mcp-v2-live'; mkdirSync(OUT, { recursive: true });
let n = 0;
async function rpc(path, method, params, session) {
  const id = ++n;
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const text = await res.text();
  const p = res.headers.get('content-type')?.includes('event-stream') ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(x => x.id === id) : JSON.parse(text);
  return { p, bytes: text.length, session: res.headers.get('mcp-session-id') };
}
let failures = 0;
async function call(name, args, label = name, path = '/mcp') {
  const t = Date.now();
  let r; try { r = await rpc(path, 'tools/call', { name, arguments: args }); } catch (e) { console.log(label, 'TRANSPORT FAIL', e.message); failures++; return null; }
  const res = r.p.result; const sc = res?.structuredContent ?? (res?.content?.[0]?.text ? safe(res.content[0].text) : null);
  writeFileSync(`${OUT}/${label.replace(/[^\w.-]+/g, '_')}.json`, JSON.stringify(r.p, null, 1));
  console.log(`${label}: ${Date.now() - t}ms ${r.bytes}B isError=${!!res?.isError}${r.p.error ? ' rpcError=' + r.p.error.message : ''}`);
  return { sc, isError: !!res?.isError || !!r.p.error, bytes: r.bytes };
}
const safe = s => { try { return JSON.parse(s); } catch { return { text: s.slice(0, 300) }; } };
const keys = o => o && typeof o === 'object' ? Object.keys(o).join(',') : typeof o;
for (const [p, extra] of [['Genesis 6:14', {}], ['Zechariah 4:1-14', {}], ['Ezekiel 1:1-28', {}], ['Revelation 13:1-18', {}], ['1COR12:10-1COR13:4', { realworld: 1 }]]) {
  const r = await call('get_Passage', { passage: p, ...extra }, 'get_Passage ' + p);
  if (r) { if (r.isError) failures++; console.log('  keys:', keys(r.sc)); }
}
const w = await call('get_Word', { word: 'Ruach' }, 'get_Word Ruach'); if (w) console.log('  keys:', keys(w.sc), JSON.stringify(w.sc?.word)?.slice(0, 400));
for (const items of [['Genesis 6:14', 'Exodus 2:3'], ['Ruach', 'Zechariah 4'], ['Zechariah 4', 'Revelation 11']]) {
  const r = await call('get_Connection', { items }, 'get_Connection ' + items.join(' | ')); if (r) { if (r.isError) failures++; console.log('  keys:', keys(r.sc)); }
}
// chain across stateless calls
const s = await call('follow_connectionchain', { next: 'Zechariah 4' }, 'chain start');
const chain = s?.sc?.chain ?? s?.sc?.chain_id; console.log('  chain handle present:', !!chain, 'keys:', keys(s?.sc));
if (chain) {
  const f = await call('follow_connectionchain', { chain, action: 'follow', next: 'Revelation 11' }, 'chain follow'); console.log('  keys:', keys(f?.sc));
  const b = await call('follow_connectionchain', { chain, action: 'inspect' }, 'chain inspect');
  const t = await call('follow_connectionchain', { chain: chain.slice(0, -4) + 'aaaa', action: 'inspect' }, 'chain tampered');
  if (!t?.isError && !/invalid|not.found|expired|rejected/i.test(JSON.stringify(t?.sc))) { console.log('  FAIL tampered token accepted'); failures++; }
}
const rs = await call('research', { query: 'ruach' }, 'research query'); console.log('  keys:', keys(rs?.sc));
const rg = await call('research', { operations: [{ op: 'gematria', terms: ['רוּחַ', 'אָדָם'], find_matches: true, limit: 5 }] }, 'research gematria'); console.log('  keys:', keys(rg?.sc));
await call('get_prompt', {}, 'get_prompt');
const bad = await call('write_Note', { action: 'save_dlm', dlm: { invalid: true } }, 'write_Note invalid (must be rejected)');
if (bad && !bad.isError) { console.log('  FAIL write accepted'); failures++; }
const tl = await rpc('/mcp', 'tools/list', {}); console.log('v2 tools:', tl.p.result.tools.map(t => t.name).join(','));
const ll = await rpc('/legacy/mcp', 'tools/list', {}); console.log('legacy tools:', ll.p.result.tools.length);
console.log('health', JSON.stringify(await (await fetch(BASE + '/health')).json()));
console.log(failures ? `FAILURES: ${failures}` : 'DONE (inspect printed digests and ' + OUT + ')'); process.exit(failures ? 1 : 0);

