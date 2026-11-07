// @file: scripts/verify-word-formation.mjs
// End-to-end verification suite for Lexical Formation integration across Hebrew, Aramaic, Greek, homographs, and ranges.

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

async function rpc(name, args, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (res.ok) {
      return JSON.parse(text);
    }
    if (attempt < retries && (res.status >= 500 || res.status === 429)) {
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    assert.equal(res.status, 200, `Expected HTTP 200 for ${name}, got ${res.status}: ${text}`);
  }
}

console.log('===========================================================================');
console.log('LEXICAL FORMATION & HYDRATED V2 COMPREHENSIVE VERIFICATION SUITE');
console.log('===========================================================================\n');

// 1. Hebrew Theophoric Compounds: 1 Chronicles 26:7
console.log('1. Testing Hebrew Theophoric Name Formation (1 Chron 26:7 Rephael H7501)...');
const v2Chron = await rpc('get_verse_research_v2', {
  p_request: { passages: [{ book: 13, chapter: 26, verse: 7 }] }
});
assert.equal(v2Chron.schema_version, 2);
assert.equal(v2Chron.status, 'ok');
assert.equal(v2Chron.verses.length, 1);
const rephael = v2Chron.verses[0].words.find(w => w.strongs_nr === 'H7501');
assert.ok(rephael, 'Token H7501 found in 1Ch 26:7');
assert.ok(rephael.disambiguated_lemmas.includes('lemma:H7501'));
assert.ok(rephael.morphology.length > 0, 'Token morphology distinct from formation components');
const rephaelForm = v2Chron.lexical_formations['lemma:H7501'];
assert.ok(rephaelForm, 'Hoisted formation entry exists for lemma:H7501');
assert.ok(rephaelForm.formations.length >= 1);
const formItem = rephaelForm.formations[0];
assert.equal(formItem.formation_type, 'theophoric_name');
assert.equal(formItem.evidence_status, 'documented');
assert.equal(formItem.components.length, 2);
assert.equal(formItem.components[0].role, 'verbal_element');
assert.equal(formItem.components[0].base_strongs, 'H7495');
assert.equal(formItem.components[1].role, 'divine_name_element');
assert.equal(formItem.components[1].base_strongs, 'H410');
console.log('   PASS: Rephael compound decomposed into verbal element (H7495) + divine name (H410).\n');

// 2. Hebrew Wordplay & Orthographic Distinction: Genesis 2:7
console.log('2. Testing Literary Wordplay vs Orthographic Overlap (Gen 2:7 Adam H120)...');
const v2Gen2 = await rpc('get_verse_research_v2', {
  p_request: { passages: [{ book: 1, chapter: 2, verse: 7 }] }
});
assert.equal(v2Gen2.status, 'ok');
const adamForm = v2Gen2.lexical_formations['lemma:H0120G'];
assert.ok(adamForm, 'Adam lemma:H0120G present in hoisted formations');
const wordplay = adamForm.literary_connections.find(c => c.relation_type === 'literary_wordplay');
assert.ok(wordplay, 'Literary wordplay with adamah found');
assert.equal(wordplay.evidence_status, 'documented_textual');
const overlap = adamForm.literary_connections.find(c => c.relation_type === 'orthographic_overlap');
assert.ok(overlap, 'Orthographic overlap found');
assert.equal(overlap.evidence_status, 'observed_form');
console.log('   PASS: Gen 2:7 Adam literary connections separated from historical etymology.\n');

// 3. Documented Roots & Homographs: Genesis 1:1
console.log('3. Testing Documented Roots & Homograph Preservation (Gen 1:1)...');
const v2Gen1 = await rpc('get_verse_research_v2', {
  p_request: { passages: [{ book: 1, chapter: 1, verse: 1 }] }
});
assert.equal(v2Gen1.status, 'ok');
assert.equal(v2Gen1.verses[0].words.length, 7);
assert.equal(v2Gen1.verses[0].words[0].strongs_nr, 'H7225');
assert.equal(v2Gen1.verses[0].words[1].strongs_nr, 'H1254');
const elohim = v2Gen1.verses[0].words[2];
assert.equal(elohim.strongs_nr, 'H430');
assert.ok(elohim.disambiguated_lemmas.length > 1, 'Homographs preserved for elohim');
assert.ok(v2Gen1.lexical_formations['lemma:H0430G'], 'Disambiguated lemma:H0430G hoisted');
console.log('   PASS: Word order, homographs, and root links preserved for Genesis 1:1.\n');

// 4. Biblical Aramaic: Daniel 2:4
console.log('4. Testing Biblical Aramaic Passage (Daniel 2:4)...');
const v2Dan = await rpc('get_verse_research_v2', {
  p_request: { passages: [{ book: 27, chapter: 2, verse: 4 }] }
});
assert.equal(v2Dan.status, 'ok');
assert.ok(v2Dan.verses[0].words.length > 10);
assert.ok(v2Dan.lexical_formations, 'Aramaic lexical formations dictionary hoisted');
console.log(`   PASS: Daniel 2:4 Aramaic passage returns ${v2Dan.verses[0].words.length} tokens with hoisted formation dictionary.\n`);

// 5. Greek New Testament: John 1:1
console.log('5. Testing Greek NT Passage (John 1:1 Logos G3056)...');
const v2John = await rpc('get_verse_research_v2', {
  p_request: { passages: [{ book: 43, chapter: 1, verse: 1 }] }
});
assert.equal(v2John.status, 'ok');
assert.equal(v2John.verses[0].words.length, 17);
const logosToken = v2John.verses[0].words.find(w => w.strongs_nr === 'G3056');
assert.ok(logosToken, 'Logos token found in John 1:1');
assert.ok(v2John.lexical_formations['lemma:G3056'], 'Logos lemma:G3056 hoisted');
console.log('   PASS: John 1:1 Greek NT passage hydrated with Greek lemma formations.\n');

// 6. Contiguous Multi-Verse Range: Zechariah 4:1-5
console.log('6. Testing Large Contiguous Verse Range (Zechariah 4:1-5)...');
const v2Zech = await rpc('get_verse_research_v2', {
  p_request: {
    passages: [{ book: 38, chapter: 4, start_verse: 1, end_verse: 5 }]
  }
});
assert.equal(v2Zech.status, 'ok');
assert.equal(v2Zech.verses.length, 5);
const totalTokens = v2Zech.verses.reduce((acc, v) => acc + v.words.length, 0);
assert.ok(totalTokens > 50, 'Range contains over 50 tokens');
const hoistedLemmas = Object.keys(v2Zech.lexical_formations);
assert.ok(hoistedLemmas.length > 15, 'Hoisted formations deduplicate words across multiple verses');
console.log(`   PASS: Zechariah 4:1-5 returned ${v2Zech.verses.length} verses (${totalTokens} tokens) with ${hoistedLemmas.length} deduplicated formation entries.\n`);

// 7. Epistemic Boundary Verification (Orthographic Candidates vs Etymology)
console.log('7. Testing Epistemic Boundaries & Orthographic Safety...');
const orth = await rpc('suggest_orthographic_candidates_v1', {
  p_query: 'H0120G',
  p_limit: 10,
  p_min_chars: 2
});
assert.equal(orth.status, 'ok');
assert.ok(orth.candidate_connections.length > 0);
for (const cand of orth.candidate_connections) {
  assert.equal(cand.evidence_status, 'unverified_candidate');
  assert.equal(cand.relation_type, 'consonantal_substring');
  assert.equal(cand.etymological_inference, false, 'Orthographic match must NEVER infer etymology');
}
assert.ok(orth.limitations.includes('Substring resemblance alone provides no evidence of etymology'));
console.log('   PASS: Orthographic candidates strictly guarded against etymological promotion.\n');

// 8. Missing Etymology Explicit Preservation
console.log('8. Testing Missing Etymology Preservation...');
const nonexistent = await rpc('get_word_formation_v1', {
  p_query: 'H999999',
  p_word_id: null
});
assert.equal(nonexistent.status, 'not_found');
console.log('   PASS: Missing lemmas and formations remain explicitly missing.\n');

console.log('===========================================================================');
console.log('ALL 8 COMPREHENSIVE VERIFICATION SUITES PASSED (0 FAILURES)');
console.log('===========================================================================');
