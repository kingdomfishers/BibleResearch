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

async function rpc(name, args) {
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
  const text = await res.text();
  assert.equal(res.status, 200, `Expected HTTP 200 for ${name}, got ${res.status}: ${text}`);
  return JSON.parse(text);
}

console.log('Testing get_word_formation_v1...');
const f1 = await rpc('get_word_formation_v1', { p_query: 'H7501', p_word_id: null });
assert.equal(f1.status, 'ok');
assert.equal(f1.schema_version, 1);
assert.equal(f1.matched_lemmas.length, 1);
assert.equal(f1.matched_lemmas[0].base_strongs, 'H7501');
assert.ok(f1.lexical_formations.length >= 1);
const form = f1.lexical_formations[0];
assert.equal(form.formation_type, 'theophoric_name');
assert.equal(form.components.length, 2);
assert.equal(form.components[0].role, 'verbal_element');
assert.equal(form.components[1].role, 'divine_name_element');
console.log('  PASS: H7501 Rephael theophoric name formation verified');

const f2 = await rpc('get_word_formation_v1', { p_query: 'H0120G', p_word_id: null });
assert.equal(f2.status, 'ok');
assert.ok(f2.other_connections.some(c => c.relation_type === 'literary_wordplay' && c.evidence_status === 'documented_textual'));
assert.ok(f2.other_connections.some(c => c.relation_type === 'orthographic_overlap' && c.evidence_status === 'observed_form'));
console.log('  PASS: H0120G Adam literary wordplay and orthographic overlap verified');

const f3 = await rpc('get_word_formation_v1', { p_query: null, p_word_id: -5 });
assert.equal(f3.status, 'invalid_request');
console.log('  PASS: invalid word_id rejected');

console.log('Testing suggest_orthographic_candidates_v1...');
const c1 = await rpc('suggest_orthographic_candidates_v1', { p_query: 'H0120G', p_limit: 10, p_min_chars: 2 });
assert.equal(c1.status, 'ok');
assert.equal(c1.schema_version, 1);
assert.ok(c1.candidate_connections.length > 0);
assert.ok(c1.candidate_connections.some(c => c.candidate_strongs === 'H1818'));
assert.equal(c1.candidate_connections[0].evidence_status, 'unverified_candidate');
assert.equal(c1.candidate_connections[0].etymological_inference, false);
console.log('  PASS: H0120G orthographic candidates include H1818 dam without etymology claim');

const c2 = await rpc('suggest_orthographic_candidates_v1', { p_query: 'H0120G', p_limit: 100, p_min_chars: 2 });
assert.equal(c2.status, 'invalid_request');
console.log('  PASS: invalid limit > 50 rejected');

console.log('All API formation RPC tests passed successfully.');
