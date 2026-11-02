// End-to-end protocol and read-only boundary checks. Node 22+; no API keys or dependencies.
import assert from 'node:assert/strict';
import { PATTERN_PROMPTS } from '../supabase/functions/bible-mcp/pattern-prompts.ts';
import { WORKFLOW_VERSION } from '../supabase/functions/bible-mcp/research-workflow.ts';
import { mkdir, writeFile } from 'node:fs/promises';
const defaultUrl = 'https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp';
const endpoint = process.env.BIBLE_MCP_URL ?? defaultUrl;
const url = new URL(endpoint);
assert.ok(['https:', 'http:'].includes(url.protocol), 'Expected an HTTP MCP endpoint');
let sequence = 0;
let checks = 0;
const pass = label => { checks++; console.log(`PASS ${label}`); };
const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-11-25' };
async function rpc(method, params = {}, options = {}) {
  const id = ++sequence;
  const response = await fetch(options.endpoint ?? endpoint, { method: 'POST',
    headers: { ...headers, ...options.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  assert.ok(response.ok, `${method}: HTTP ${response.status} ${text.slice(0, 250)}`);
  const payload = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(p => p.id === id)
    : JSON.parse(text);
  assert.equal(payload?.id, id, `${method}: missing matching JSON-RPC response`);
  return payload;
}
async function result(method, params, options) {
  const payload = await rpc(method, params, options);
  assert.ok(!payload.error, `${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}
async function tool(name, args, options) {
  const response = await result('tools/call', { name, arguments: args }, options);
  assert.ok(!response.isError, `${name}: ${JSON.stringify(response.content)}`);
  return response.structuredContent;
}
const health = await fetch(endpoint.replace(/\/mcp\/?$/, '') + '/health', { signal: AbortSignal.timeout(30000) });
assert.equal(health.status, 200);
const status = await health.json();
assert.equal(status.read_only, true);
assert.equal(status.authentication, 'none');
assert.equal(status.tools, 11);
assert.equal(status.prompts, 17);
assert.equal(status.version, WORKFLOW_VERSION);
pass('anonymous health endpoint (11 tools, 17 prompts)');

for (const protocolVersion of ['2025-03-26', '2025-06-18', '2025-11-25']) {
  const init = await result('initialize', { protocolVersion, capabilities: {},
    clientInfo: { name: 'BibleResearch verifier', version: '1.2.0' } });
  assert.equal(init.serverInfo.name, 'BibleResearch');
  assert.ok(init.capabilities.tools && init.capabilities.prompts);
}
pass('MCP initialization with three compatible client protocol versions');
const listed = await result('tools/list');
const expected = [
  'get_research_prompt',
  'get_verse_chronology_v1',
  'get_verse_geography',
  'get_verse_research',
  'get_word_details',
  'prompt_verse_words',
  'prompt_word_cooccurrences',
  'prompt_word_occurrences',
  'prompt_word_relationships',
  'research_relationships',
  'resolve_word_id',
];
assert.deepEqual(listed.tools.map(t => t.name).sort(), expected.sort());
for (const t of listed.tools) {
  assert.equal(t.annotations.readOnlyHint, true);
  assert.equal(t.annotations.destructiveHint, false);
  assert.equal(t.inputSchema.type, 'object');
}
pass('exact allowlist of eleven read-only tools with input schemas');
if (process.argv.includes('--catalog-only')) {
  const workflow = await tool('get_research_prompt', { subject: 'Explain John 1:1' });
  assert.equal(workflow.name, 'study_bible');
  assert.equal(workflow.workflow.version, WORKFLOW_VERSION);
  assert.deepEqual([...workflow.workflow.expected_tools].sort(), listed.tools.map(t => t.name).sort());
  assert.equal((await result('prompts/list')).prompts.length, 17);
  pass('workflow discovery metadata matches every live tool and exposes the general router');
  process.exit(0);
}

const verse = await tool('prompt_verse_words', { p_book: 1, p_chapter: 1, p_verse: 1 });
assert.equal(verse.source, 'live');
assert.equal(verse.rows.length, 7);
assert.equal(verse.rows[0].strongs_nr, 'H7225');
assert.deepEqual(verse.rows.map(r => r.word_position), [1, 2, 3, 4, 5, 6, 7]);
const greek = await tool('prompt_verse_words', { p_book: 43, p_chapter: 1, p_verse: 1 });
assert.ok(greek.rows.some(r => r.strongs_nr === 'G3056'));
pass('ordered live Hebrew and Greek verse tokens');
const hydrated = await tool('get_verse_research', { p_request: {
  passages: [{ book: 1, chapter: 1, verse: 1 }, { book: 43, chapter: 1, verse: 1 }],
  occurrences: { mode: 'sample', limit: 2 },
} });
assert.equal(hydrated.status, 'ok');
assert.equal(hydrated.verses.length, 2);
assert.equal(hydrated.verses[0].words.length, 7);
assert.equal(hydrated.coverage.private_translation_choices_included, false);
assert.equal(hydrated.coverage.occurrences_complete, false);
assert.ok(hydrated.lexical_entries.H7225.top_connected_words.length <= 7);
assert.ok(hydrated.verses[1].words.some(w => w.strongs_nr === 'G3056'));
pass('one-call hydrated JSON with shared occurrences, grammar, translations, dates and map data');
const analysisPacket = await tool('get_verse_research', {
  profile: 'analysis', p_request: { passages: [{ book: 43, chapter: 1, verse: 1 }] },
});
const fullPacket = await tool('get_verse_research', {
  profile: 'full', p_request: { passages: [{ book: 43, chapter: 1, verse: 1 }] },
});
assert.equal(analysisPacket.status, 'ok'); assert.equal(fullPacket.status, 'ok');
assert.deepEqual(analysisPacket.verses, fullPacket.verses, 'Profiles must preserve requested-verse evidence');
assert.equal(analysisPacket.coverage.occurrences_complete, false);
assert.equal(fullPacket.coverage.occurrences_complete, true);
for (const [key, entry] of Object.entries(analysisPacket.lexical_entries)) {
  const fullEntry = fullPacket.lexical_entries[key];
  assert.ok(entry.occurrences.references.length <= 5);
  for (const count of ['corpus_token_total', 'distinct_passage_total']) {
    assert.equal(entry.occurrences[count], fullEntry.occurrences[count]);
  }
  assert.deepEqual(entry.top_connected_words, fullEntry.top_connected_words);
  assert.deepEqual(entry.lexeme_candidates, fullEntry.lexeme_candidates);
}
const analysisBytes = Buffer.byteLength(JSON.stringify(analysisPacket));
const fullBytes = Buffer.byteLength(JSON.stringify(fullPacket));
assert.ok(analysisBytes < fullBytes);
const measurement = { server_version: WORKFLOW_VERSION, passage: { book: 43, chapter: 1, verse: 1 },
  analysis_bytes: analysisBytes, full_bytes: fullBytes,
  reduction_percent: Math.round((1 - analysisBytes / fullBytes) * 1000) / 10,
  exact_totals_and_verse_evidence_preserved: true };
await mkdir('.artifacts/research-plugin', { recursive: true });
await writeFile('.artifacts/research-plugin/measurements.json', JSON.stringify(measurement, null, 2) + '\n');
pass(`analysis profile preserves evidence/totals with ${measurement.reduction_percent}% smaller structured JSON (${analysisBytes} vs ${fullBytes} bytes)`);

const resolved = await tool('resolve_word_id', { p_query: 'H7225' });
assert.equal(resolved.rows.length, 1);
const wordId = resolved.rows[0].word_id;
assert.ok(wordId > 0);
const details = await tool('get_word_details', { word_id: wordId });
assert.equal(details.rows[0].strongs_nr, 'H7225');
assert.ok(details.rows[0].biblical_def);
pass('word resolution and definition lookup');

const allOccurrences = [];
let offset = 0;
do {
  const page = await tool('prompt_word_occurrences', { p_word_query: 'H7225', limit: 17, offset });
  assert.ok(page.rows.length <= 17);
  assert.equal(page.page.offset, offset);
  allOccurrences.push(...page.rows);
  if (!page.page.has_more) break;
  assert.equal(page.page.next_offset, offset + 17);
  offset = page.page.next_offset;
  assert.ok(offset <= 100, 'Unexpected pagination loop');
} while (true);
assert.equal(allOccurrences.length, 49);
assert.equal(new Set(allOccurrences.map(r => `${r.book}-${r.chapter}-${r.verse_nr}`)).size, 49);
assert.equal(allOccurrences.reduce((n, r) => n + r.occurrence_count, 0), 51);
pass('complete paginated H7225 search: 49 passages and 51 tokens, no duplicates');

const related = await tool('prompt_word_cooccurrences', { p_word_query: 'H7225' });
assert.equal(related.rows.length, 15);
assert.ok(related.rows.every(r => r.frequency > 0 && r.avg_distance > 0));
const shared = await tool('prompt_word_relationships', { p_word_ids: verse.rows.slice(0, 2).map(r => r.word_id) });
assert.ok(shared.rows.some(r => r.book === 1 && r.chapter === 1 && r.verse_nr === 1));
pass('co-occurrences and multi-word relationships');

const chrono = await tool('get_verse_chronology_v1', { p_book: 11, p_chapter: 6, p_verse: 1 });
assert.equal(chrono.rows.length, 1);
assert.equal(chrono.rows[0].status, 'ok');
assert.ok(chrono.rows[0].summary.label);
const geo = await tool('get_verse_geography', { p_book: 43, p_chapter: 4, p_verse: 7 });
assert.equal(geo.rows.length, 1);
assert.equal(geo.rows[0].status, 'ok');
assert.equal(geo.rows[0].resolution_status, 'passage_context');
assert.ok(Array.isArray(geo.rows[0].locations) && geo.rows[0].locations.length > 0);
const relGraph = await tool('research_relationships', { subject: 'well', target: 'marriage', mode: 'explain' });
assert.equal(relGraph.rows.length, 1);
assert.equal(relGraph.rows[0].status, 'ok');
assert.equal(relGraph.rows[0].evidence_paths.length, 3);
pass('chronology, geography, and relationship evidence-graph tools return live packets');

const prompts = (await result('prompts/list')).prompts;
assert.deepEqual(
  prompts.map(p => p.name).sort(),
  ['compare_words', 'study_bible', 'study_chronology', 'study_geography', 'study_relationships', 'study_verse', 'study_word', ...Object.keys(PATTERN_PROMPTS)].sort(),
);
for (const prompt of prompts) {
  const native = await result('prompts/get', { name: prompt.name, arguments: { subject: 'John 4:7' } });
  const compatibility = await tool('get_research_prompt', { name: prompt.name, subject: 'John 4:7' });
  assert.equal(native.messages[0].content.text, compatibility.instructions);
  if (prompt.name in PATTERN_PROMPTS) {
    for (const requirement of ['get_verse_research', 'counterexamples', 'coverage', 'epistemic_category']) {
      assert.ok(compatibility.instructions.includes(requirement), `${prompt.name}: missing ${requirement}`);
    }
  }
}
const generalWorkflow = await tool('get_research_prompt', { subject: 'Investigate wells and marriage' });
assert.equal(generalWorkflow.name, 'study_bible');
assert.equal(generalWorkflow.workflow.version, WORKFLOW_VERSION);
assert.deepEqual([...generalWorkflow.workflow.expected_tools].sort(), listed.tools.map(t => t.name).sort());
assert.ok(generalWorkflow.workflow.routes.motif.starting_tools.includes('research_relationships'));
pass('seventeen native prompts match retrieval; general workflow routing and ten pattern templates are available');

const missing = await tool('prompt_word_occurrences', { p_word_query: 'H999999' });
assert.deepEqual(missing.rows, []);
assert.equal(missing.page.has_more, false);
for (const [name, args] of [
  ['prompt_verse_words', { p_book: 67, p_chapter: 1, p_verse: 1 }],
  ['prompt_word_occurrences', { p_word_query: 'H7225', limit: 101 }],
  ['prompt_word_relationships', { p_word_ids: [-1, -2] }],
  ['prompt_word_occurrences', { p_word_query: 'H7225', sql: 'unsupported' }],
  ['execute_sql', { query: 'unsupported' }],
  ['get_verse_research', { p_request: { passages: [], sql: 'unsupported' } }],
]) {
  const rejected = await rpc('tools/call', { name, arguments: args });
  assert.ok(rejected.error || rejected.result?.isError, `${name} invalid input must be rejected`);
}
pass('empty results, invalid values, unknown fields and SQL execution are handled safely');
const noCallerAuth = await tool('get_word_details', { word_id: wordId },
  { headers: { Authorization: 'Bearer ignored-verification-token' } });
assert.equal(noCallerAuth.rows[0].strongs_nr, 'H7225');
pass('caller credentials do not replace the server public database identity');

const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://chatgpt.com' } });
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
const malformed = await fetch(endpoint, { method: 'POST', headers, body: '{' });
assert.equal(malformed.status, 400);
const oversized = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ data: 'x'.repeat(33000) }) });
assert.equal(oversized.status, 413);
pass('CORS, malformed JSON and request-size limits');
console.log(`Verified ${checks} groups of live checks at ${endpoint}`);
