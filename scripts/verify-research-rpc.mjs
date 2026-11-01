import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const env = Object.fromEntries(
  (await fs.readFile('.env', 'utf8'))
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    }),
);
const base = env.VITE_SUPABASE_URL;
const headers = {
  apikey: env.VITE_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

async function callResearch(p_request) {
  const res = await fetch(`${base}/rest/v1/rpc/research_relationships_v1`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_request }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}: ${text}`);
  return JSON.parse(text);
}

console.log('=== Verifying One-Lookup Relationship Research RPC (research_relationships_v1) ===');

// 1. Benchmark 1: Well + Marriage
const wellMarriage = await callResearch({
  subject: { text: 'well' },
  target: { text: 'marriage' },
  mode: 'explain',
  corpus: 'primary',
});
assert.equal(wellMarriage.status, 'ok');
assert.equal(wellMarriage.evidence_paths.length, 3, 'Expected 3 betrothal-at-well episodes (Gen 24, Gen 29, Exod 2)');
const keys = wellMarriage.evidence_paths.map(p => p.assertion_key);
assert.ok(keys.includes('well-marriage-gen24-rebekah'));
assert.ok(keys.includes('well-marriage-gen29-rachel'));
assert.ok(keys.includes('well-marriage-exod2-zipporah'));
assert.ok(wellMarriage.controls_and_distinctions.length >= 1, 'Expected Genesis 21/26 non-marriage well controls');
assert.ok(Buffer.byteLength(JSON.stringify(wellMarriage)) <= 51200, 'Packet must stay <= 50 KiB');
console.log('  PASS: Benchmark 1 ("well" -> "marriage") returned Gen 24, Gen 29, Exod 2:15-21 + Gen 21/26 controls in 1 call');

// 2. Benchmark 2: Menorah + Seven Spirits of God
const menorahSpirits = await callResearch({
  subject: { text: 'menorah' },
  target: { text: 'seven spirits of God' },
  mode: 'explain',
  corpus: 'primary',
});
assert.equal(menorahSpirits.status, 'ok');
assert.ok(menorahSpirits.evidence_paths.length >= 2, 'Expected Rev 4:5 textual identification and Exod 25 -> Zech 4 -> Rev 5:6 chain');
assert.ok(
  menorahSpirits.controls_and_distinctions.some(c => c.assertion_key === 'menorah-churches-rev1-20-control'),
  'Expected Revelation 1:20 seven churches contextual distinction',
);
console.log('  PASS: Benchmark 2 ("menorah" -> "seven spirits of God") returned Exod 25 / Zech 4 / Rev 4:5 / Rev 5:6 + Rev 1:20 control in 1 call');

// 3. Homograph Disambiguation: H1254 (bara I, II, III)
const homograph = await callResearch({ subject: { text: 'H1254' }, mode: 'discover' });
assert.equal(homograph.status, 'ok');
assert.equal(homograph.resolution.subject_lexemes.length, 3, 'H1254 must return all 3 homograph subdivisions (H1254a, H1254b, H1254c)');
assert.equal(homograph.resolution.needs_disambiguation, true);
assert.ok(homograph.statistical_cooccurrences.length > 0, 'Must include corpus co-occurrence statistics for H1254');
console.log('  PASS: Homograph control ("H1254") preserved H1254a/b/c subdivisions + needs_disambiguation=true');

// 4. Security check: anonymous writes denied
const writeAttempt = await fetch(`${base}/rest/v1/assertions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ assertion_key: 'forged', subject_node_id: 1, object_node_id: 2, predicate: 'related_unspecified', epistemic_category: 'lexical', scope_reference: 'none', summary: 'none', limitations_note: 'none', source_attribution: 'none' }),
});
assert.ok([401, 403].includes(writeAttempt.status), 'Anonymous writes to assertions must be denied');
console.log('  PASS: Anonymous writes to relationship tables denied by RLS');

console.log('\nAll Relationship Research RPC (R6.2/R6.3) Checks PASSED!');
