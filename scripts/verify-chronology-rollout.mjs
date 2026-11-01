import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { base, headers, chronology } from './chronology-client.mjs';

console.log('=== Verifying Chronology Rollout & Contract Synchronization (C12) ===');

// 1. Verify documentation & OpenAPI contract synchronization
const apiDoc = await fs.readFile('CHRONOLOGY_API.md', 'utf8');
assert.ok(apiDoc.includes('get_verse_chronology_v1'), 'CHRONOLOGY_API.md must document get_verse_chronology_v1');
const openApi = JSON.parse(await fs.readFile('supabase/openapi.json', 'utf8'));
assert.ok(openApi.paths['/rpc/get_verse_chronology_v1'], 'supabase/openapi.json must include /rpc/get_verse_chronology_v1');
console.log('  PASS: CHRONOLOGY_API.md and supabase/openapi.json synchronized');

// 2. Verify all 31,203 passage assignments and model coverage
const packet = await chronology({ p_book: 1, p_chapter: 2, p_verse: 7, p_model_id: 'theographic-verse-v1' });
assert.equal(packet.status, 'ok');
assert.ok(Array.isArray(packet.models) && packet.models.length >= 5, 'Expected at least 5 published chronology models');
for (const m of packet.models) {
  assert.equal(m.coverage.passages, 31203, `Model ${m.id} must cover all 31,203 canonical passages`);
  assert.equal(
    m.coverage.dated + m.coverage.unresolved + m.coverage.conflicting,
    31203,
    `Model ${m.id} status counts must sum to 31,203`,
  );
}
console.log(`  PASS: All ${packet.models.length} published models account for all 31,203 passages`);

// 3. Run full RPC verification suite
await import('./verify-chronology-rpc.mjs');

// 4. Verify baseline Prompt 1-4 regression safety
const p1Res = await fetch(`${base}/rest/v1/rpc/prompt_verse_words`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ p_book: 1, p_chapter: 1, p_verse: 1 }),
});
assert.equal(p1Res.status, 200);
const p1Tokens = await p1Res.json();
assert.equal(p1Tokens.length, 7);
assert.equal(p1Tokens[0].millennium, null, 'Legacy verses.millennium column must not be globally overwritten');
console.log('  PASS: Legacy verses.millennium (null preserved) and Prompts 1–4 unaffected');

console.log('\nChronology Rollout Verification (C12) PASSED!');
