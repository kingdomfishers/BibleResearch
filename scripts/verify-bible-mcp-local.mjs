import assert from 'node:assert/strict';
import { createApp, createDatabaseReader } from '../supabase/functions/bible-mcp/index.ts';

const requests = [];
const fakeFetch = async (input, init) => {
  const url = new URL(input);
  requests.push({ url, init });
  const name = url.pathname.split('/').pop();
  if (name === 'resolve_word_id') return Response.json(101);
  if (name === 'get_verse_research_v1') return Response.json({
    schema_version: 1, status: 'ok', verses: [{ passage: { book: 1, chapter: 1, verse: 1 } }],
    lexical_entries: {}, coverage: { occurrences_complete: true },
  });
  if (name === 'research_relationships_v1') return Response.json({ schema_version: 1, status: 'ok', evidence_paths: [] });
  if (name === 'get_verse_chronology_v1') {
    return Response.json({
      schema_version: 1,
      status: 'ok',
      passage: { book: 11, chapter: 6, verse: 1, is_heading: false },
      assignment_status: 'source_estimate',
      summary: { label: 'around 1011 BC', earliest_year: -1011, latest_year: -1011 },
      assertions: [],
      evidence: [],
      alternatives: [],
      models: [],
    });
  }
  if (name === 'get_verse_geography') {
    return Response.json({
      schema_version: 1,
      status: 'ok',
      passage: { book: 43, chapter: 4, verse: 7, is_heading: false },
      resolution_status: 'passage_context',
      resolution_tier: 2,
      summary_banner: 'Narrative setting: Sychar (John 4:4-6)',
      passage_context: { passage_key: 'john-4-1-42-sychar', title: 'Jesus and the Samaritan Woman at Sychar' },
      locations: [{ place_key: 'openbible:a27b472', biblical_name: 'Sychar', relationship_type: 'contextual_location' }],
    });
  }
  let rows = name === 'words' ? [{ id: 101, strongs_nr: 'H7225', biblical_def: 'beginning' }]
    : name === 'prompt_verse_words' ? [1, 2, 3].map(n => ({ word_id: 100 + n, word_position: n }))
    : name === 'prompt_word_occurrences' ? [1, 2, 3].map(n => ({ book: 1, chapter: 1, verse_nr: n }))
    : name === 'prompt_word_cooccurrences' ? [{ word_id: 102, frequency: 4, score: 1, avg_distance: 2 }]
    : name === 'prompt_word_relationships' ? [{ book: 1, chapter: 1, verse_nr: 1, relationship_score: 20 }]
    : assert.fail('Unexpected database operation');
  const offset = Number(url.searchParams.get('offset') ?? 0);
  rows = rows.slice(offset, offset + Number(url.searchParams.get('limit') ?? 100));
  return Response.json(rows);
};
const app = createApp({ url: 'https://example.supabase.co', publicKey: 'sb_publishable_test' }, fakeFetch);
let id = 0;
async function rpc(method, params = {}, extraHeaders = {}) {
  const currentId = ++id;
  const response = await app(new Request('https://example.supabase.co/functions/v1/bible-mcp/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25', ...extraHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', id: currentId, method, params }),
  }));
  const text = await response.text();
  const payload = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(p => p.id === currentId)
    : JSON.parse(text);
  return { response, payload };
}
const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'verification', version: '1' } });
assert.equal(init.payload.result.serverInfo.name, 'BibleResearch');
const tools = (await rpc('tools/list')).payload.result.tools;
assert.equal(tools.length, 11);
assert.ok(tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
const prompts = (await rpc('prompts/list')).payload.result.prompts;
assert.equal(prompts.length, 16);
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).payload;
const hydrated = (await call('get_verse_research', { p_request: { passages: [{ book: 1, chapter: 1, verse: 1 }] } })).result.structuredContent;
assert.equal(hydrated.status, 'ok');
assert.equal(hydrated.verses.length, 1);
assert.equal(requests.at(-1).url.searchParams.has('limit'), false);
assert.equal(requests.at(-1).url.searchParams.has('offset'), false);
assert.deepEqual(JSON.parse(requests.at(-1).init.body), { p_request: { passages: [{ book: 1, chapter: 1, verse: 1 }] } });
const first = (await call('prompt_verse_words', { p_book: 1, p_chapter: 1, p_verse: 1, limit: 1 })).result.structuredContent;
assert.equal(first.rows.length, 1);
assert.equal(first.page.next_offset, 1);
assert.equal(first.page.has_more, true);
const next = (await call('prompt_verse_words', { p_book: 1, p_chapter: 1, p_verse: 1, limit: 1, offset: 1 })).result.structuredContent;
assert.equal(next.rows[0].word_position, 2);
for (const [name, args] of [
  ['prompt_word_occurrences', { p_word_query: 'H7225' }],
  ['prompt_word_cooccurrences', { p_word_query: 'H7225' }],
  ['prompt_word_relationships', { p_word_ids: [101, 102] }],
  ['resolve_word_id', { p_query: 'H7225' }],
  ['get_word_details', { word_id: 101 }],
  ['get_verse_chronology_v1', { p_book: 11, p_chapter: 6, p_verse: 1 }],
  ['get_verse_geography', { p_book: 43, p_chapter: 4, p_verse: 7 }],
]) assert.ok((await call(name, args)).result.structuredContent.rows.length > 0, name);
for (const p of prompts) {
  const native = (await rpc('prompts/get', { name: p.name, arguments: { subject: 'H7225' } })).payload.result;
  const compat = (await call('get_research_prompt', { name: p.name, subject: 'H7225' })).result;
  assert.equal(native.messages[0].content.text, compat.structuredContent.instructions);
}
const before = requests.length;
for (const args of [
  { p_book: 0, p_chapter: 1, p_verse: 1 },
  { p_book: 1, p_chapter: 1, p_verse: 1, limit: 1000 },
  { p_book: 1, p_chapter: 1, p_verse: 1, sql: 'DROP TABLE words' },
]) {
  const failure = await call('prompt_verse_words', args);
  assert.ok(failure.error || failure.result?.isError);
}
const unsupported = await call('execute_sql', { query: 'DELETE FROM words' });
assert.ok(unsupported.error || unsupported.result?.isError);
assert.equal(requests.length, before);
await rpc('tools/call', { name: 'get_word_details', arguments: { word_id: 101 } }, { Authorization: 'Bearer caller-token' });
assert.equal(requests.at(-1).init.headers.apikey, 'sb_publishable_test');
assert.equal(requests.at(-1).init.headers.Authorization, undefined);
assert.throws(() => createDatabaseReader({ url: 'https://example.supabase.co', publicKey: 'sb_secret_never-use' }));
const preflight = await app(new Request('https://example/mcp', { method: 'OPTIONS' }));
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
const health = await app(new Request('https://example/bible-mcp/health'));
const healthJson = await health.json();
assert.equal(healthJson.read_only, true);
assert.equal(healthJson.tools, 11);
assert.equal(healthJson.prompts, 16);
let attempts = 0;
const retryReader = createDatabaseReader({ url: 'https://example.supabase.co', publicKey: 'sb_publishable_test' },
  async () => ++attempts === 1 ? new Response('Transient upstream failure', { status: 500 })
    : Response.json([{ word_id: 101 }]));
const recovered = await retryReader({ name: 'prompt_verse_words', args: {}, limit: 1, offset: 0 });
assert.equal(attempts, 2);
assert.equal(recovered.rows[0].word_id, 101);
attempts = 0;
const failingReader = createDatabaseReader({ url: 'https://example.supabase.co', publicKey: 'sb_publishable_test' },
  async () => { attempts++; return new Response('Unavailable', { status: 503 }); });
await assert.rejects(() => failingReader({ name: 'prompt_verse_words', args: {}, limit: 1, offset: 0 }));
assert.equal(attempts, 2, 'Persistent failures must not loop');
console.log('PASS: MCP initialization; eleven read-only tools; sixteen native/compatibility prompts; hydration without pagination; invalid/unknown inputs; credential isolation; secret-key rejection; CORS; health.');
console.log('PASS: transient upstream failures retry once; persistent failures terminate after two attempts.');
