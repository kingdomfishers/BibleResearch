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
    });
    const text = await res.text();
    if (res.status === 200) {
      return JSON.parse(text);
    }
    if (attempt < retries && (res.status >= 500 || res.status === 429)) {
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    assert.equal(res.status, 200, `Expected HTTP 200 for ${name}, got ${res.status}: ${text}`);
  }
}

console.log('1. Testing 1 Chronicles 26:7 (Hebrew theophoric name Rephael H7501)...');
const resChron = await rpc('get_verse_research_v2', {
  p_request: { passages: [{ book: 13, chapter: 26, verse: 7 }] },
});
assert.equal(resChron.schema_version, 2);
assert.equal(resChron.status, 'ok');
assert.equal(resChron.verses.length, 1);
const rephaelToken = resChron.verses[0].words.find(w => w.strongs_nr === 'H7501');
assert.ok(rephaelToken, 'Rephael token found in 1Ch 26:7');
assert.ok(rephaelToken.disambiguated_lemmas.includes('lemma:H7501'));
assert.ok(rephaelToken.morphology.length > 0, 'Token morphology present');
const rephaelFormation = resChron.lexical_formations['lemma:H7501'];
assert.ok(rephaelFormation, 'Rephael formation hoisted entry present');
assert.ok(rephaelFormation.formations.length >= 1);
assert.equal(rephaelFormation.formations[0].formation_type, 'theophoric_name');
assert.equal(rephaelFormation.formations[0].components.length, 2);
assert.equal(rephaelFormation.formations[0].components[0].role, 'verbal_element');
assert.equal(rephaelFormation.formations[0].components[1].role, 'divine_name_element');
console.log('   PASS: 1 Chron 26:7 theophoric name components hydrated correctly.');

console.log('2. Testing Genesis 1:1 (Hebrew word order, homographs, documented roots)...');
const resGen = await rpc('get_verse_research_v2', {
  p_request: { passages: [{ book: 1, chapter: 1, verse: 1 }] },
});
assert.equal(resGen.schema_version, 2);
assert.equal(resGen.status, 'ok');
assert.equal(resGen.verses[0].words.length, 7);
assert.equal(resGen.verses[0].words[0].strongs_nr, 'H7225');
assert.equal(resGen.verses[0].words[1].strongs_nr, 'H1254');
const elohimToken = resGen.verses[0].words[2];
assert.equal(elohimToken.strongs_nr, 'H430');
assert.ok(elohimToken.disambiguated_lemmas.length > 1, 'Homographs preserved for elohim');
assert.ok(resGen.lexical_formations['lemma:H0430G'], 'Disambiguated lemma H0430G present in hoisted formations');
console.log('   PASS: Gen 1:1 word order, homographs, and root links preserved.');

console.log('3. Testing Genesis 2:7 (Adam literary connections)...');
const resGen2 = await rpc('get_verse_research_v2', {
  p_request: { passages: [{ book: 1, chapter: 2, verse: 7 }] },
});
assert.equal(resGen2.status, 'ok');
const adamForm = resGen2.lexical_formations['lemma:H0120G'];
assert.ok(adamForm, 'Adam lemma:H0120G hoisted');
assert.ok(adamForm.literary_connections.some(c => c.relation_type === 'literary_wordplay'), 'Literary wordplay found');
assert.ok(adamForm.literary_connections.some(c => c.relation_type === 'orthographic_overlap'), 'Orthographic overlap found');
console.log('   PASS: Gen 2:7 Adam literary connections separated from etymology.');

console.log('4. Testing John 1:1 (Greek NT analysis profile)...');
const resJohn = await rpc('get_verse_research_v2', {
  p_request: { profile: 'analysis', passages: [{ book: 43, chapter: 1, verse: 1 }] },
});
assert.equal(resJohn.status, 'ok');
assert.ok(resJohn.verses[0].words.some(w => w.strongs_nr === 'G3056'), 'Logos G3056 found');
console.log('   PASS: Greek NT hydrated.');

console.log('5. Testing Daniel 2:4 (Biblical Aramaic analysis profile)...');
const resDan = await rpc('get_verse_research_v2', {
  p_request: { profile: 'analysis', passages: [{ book: 27, chapter: 2, verse: 4 }] },
});
assert.equal(resDan.status, 'ok');
assert.ok(resDan.verses[0].words.length > 0);
console.log('   PASS: Biblical Aramaic hydrated.');

console.log('6. Testing Zechariah 4:1-5 (Contiguous verse range)...');
const resZech = await rpc('get_verse_research_v2', {
  p_request: { profile: 'analysis', passages: [{ book: 38, chapter: 4, start_verse: 1, end_verse: 5 }] },
});
assert.equal(resZech.status, 'ok');
assert.equal(resZech.verses.length, 5);
console.log('   PASS: Contiguous range hydrated.');

console.log('7. Testing coverage constraints and limits...');
assert.equal(resChron.coverage.lexical_formation_coverage.deduplicated_by, 'disambiguated_lemma_key');
assert.equal(resChron.coverage.lexical_formation_coverage.homographs_preserved, true);
assert.equal(resChron.coverage.lexical_formation_coverage.spelling_similarity_not_proven_etymology, true);
assert.equal(resChron.coverage.lexical_formation_coverage.roots_do_not_imply_synonymy, true);
console.log('   PASS: Epistemic coverage constraints verified.');

console.log('ALL v2 hydrated research tests passed!');
