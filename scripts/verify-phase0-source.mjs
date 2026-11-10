// Run with the existing Deno toolchain; verifies the reconciled deployed contract.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createApp, createDatabaseReader } from '../supabase/functions/bible-mcp/index.ts';
import { RESEARCH_TOOL_NAMES } from '../supabase/functions/bible-mcp/workflow-contract.ts';

const edge = JSON.parse(fs.readFileSync('.artifacts/phase0/live-bible-mcp.json', 'utf8'));
const functions = JSON.parse(fs.readFileSync('.artifacts/phase0/live-functions.json', 'utf8'));
const digest = s => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');
let assertions = 0;
const sourceRefIndex = process.argv.indexOf('--source-ref');
const sourceRef = sourceRefIndex < 0 ? null : process.argv[sourceRefIndex + 1];
for (const file of edge.files) {
  const name = `supabase/functions/bible-mcp/${file.name}`;
  const captured = sourceRef ? execFileSync('git', ['show', `${sourceRef}:${name}`], { encoding: 'utf8' }) : fs.readFileSync(name, 'utf8');
  assert.equal(digest(captured), digest(file.content), `Deployed file changed: ${file.name}`);
  assertions++;
}
const migration = fs.readFileSync('supabase/migrations/20261110202614_phase0_live_source_reconciliation.sql', 'utf8');
for (const name of ['research_passage_lens_v1','research_word_lens_v1','research_word_bridge_v1','get_dlm_notes_for_verse_v1','verify_dlm_lemma_occurrence_v1','dlm_note_metadata_valid_v1']) {
  const f = functions.find(f => f.schema === 'public' && f.name === name);
  assert.ok(migration.includes(f.definition.trim()), `Exact live definition missing: ${name}`);
  assertions++;
}
const calls = [];
const fetcher = async (input, init) => {
  const name = new URL(input).pathname.split('/').pop();
  calls.push({ name, args: JSON.parse(init.body) });
  if (name === 'verify_dlm_lemma_occurrence_v1') return Response.json(true);
  return Response.json({ status: 'ok', marker: name });
};
const config = { url: 'https://example.supabase.co', publicKey: 'sb_publishable_test' };
const read = createDatabaseReader(config, fetcher);
for (const [name, args] of [
  ['research_passage_lens_v1', { p_book: 19, p_chapter: 3, p_verse: 0, p_max_tokens: 55 }],
  ['research_word_lens_v1', { p_query: 'H1254A', p_limit: 3 }],
  ['research_word_bridge_v1', { p_left: 'H120', p_right: 'H1818', p_limit: 4, p_window: 2 }],
  ['get_dlm_notes_for_verse_v1', { p_book: 1, p_chapter: 9, p_verse: 6, p_limit: 8 }],
  ['verify_dlm_lemma_occurrence_v1', { p_lemma_id: 35, p_word_id: 46861 }],
]) {
  const result = await read({ name, args, limit: 1, offset: 0 });
  if (name === 'verify_dlm_lemma_occurrence_v1') assert.deepEqual(result.rows, [{ attested: true }]);
  else assert.equal(result.rows[0].marker, name);
  assert.deepEqual(calls.at(-1), { name, args });
  assertions += 2;
}
const app = createApp(config, fetcher);
const health = await (await app(new Request('https://example.supabase.co/health'))).json();
assert.equal(health.status, 'ok');
assert.equal(health.tools, RESEARCH_TOOL_NAMES.length);
assert.equal(health.authentication, 'none');
assert.ok(RESEARCH_TOOL_NAMES.includes('research_word_lens'));
assert.ok(RESEARCH_TOOL_NAMES.includes('trace_biblical_bridge'));
assert.ok(RESEARCH_TOOL_NAMES.includes('research_passage_lens'));
assert.ok(RESEARCH_TOOL_NAMES.includes('get_dlm_research'));
assert.ok(RESEARCH_TOOL_NAMES.includes('get_verse_hydrated'));
assertions += 8;
console.log(JSON.stringify({ status: 'PASS', assertions, deployed_version: edge.version, tools: health.tools, exact_source_files: edge.files.length }));
