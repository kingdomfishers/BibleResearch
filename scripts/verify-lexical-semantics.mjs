// @file: scripts/verify-lexical-semantics.mjs
// @feature: canonical-lexical-evidence-db
// @description: Acceptance test suite for F5 — Reliable Lexical Semantics.
//               Verifies Unicode-aware normalization, Hebrew with/without niqqud,
//               Greek with/without accents, homograph preservation, sense vs gloss separation,
//               source attribution on every interpretation, and concordance reproducibility.

import { deepStrictEqual } from 'node:assert';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

async function rpc(name, body = {}) {
  const res = await fetch(`${REST_URL}/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RPC ${name} failed: HTTP ${res.status} - ${text}`);
  }
  return res.json();
}

console.log('=== Reliable Lexical Semantics Verification Suite (F5) ===\n');

// ---------------------------------------------------------------------------
// Test 1: Hebrew Searches With and Without Vowel Marks
// ---------------------------------------------------------------------------
console.log('Test 1: Hebrew Searches With and Without Vowel Marks');

// 1a. רוח (ruach / ravach / revach)
const ruachUnpointed = await rpc('lookup_lexical_semantics_v1', { p_query: 'רוח' });
assert(ruachUnpointed.status === 'ok', 'Unpointed רוח lookup failed');
assert(
  ruachUnpointed.total_matching_lemmas >= 4,
  `Expected >= 4 matching lemmas for unpointed רוח, got ${ruachUnpointed.total_matching_lemmas}`
);
const ruachKeys = ruachUnpointed.lemmas.map(l => l.lemma_key);
assert(ruachKeys.includes('lemma:H7307'), 'Unpointed רוח must include H7307 (spirit/wind/breath)');
assert(ruachKeys.includes('lemma:H7304'), 'Unpointed רוח must include H7304 (ravach - be wide)');
assert(ruachKeys.includes('lemma:H7305'), 'Unpointed רוח must include H7305 (revach - space)');
assert(ruachKeys.includes('lemma:H7308'), 'Unpointed רוח must include H7308 (Aramaic spirit)');
console.log(`  [PASS] Unpointed רוח returns all ${ruachUnpointed.total_matching_lemmas} distinct homographs/cognates`);

const ruachPointed = await rpc('lookup_lexical_semantics_v1', { p_query: 'רוּחַ' });
assert(ruachPointed.status === 'ok', 'Pointed רוּחַ lookup failed');
assert(
  ruachPointed.lemmas[0].lemma_key === 'lemma:H7307',
  `Expected top lemma for רוּחַ to be lemma:H7307, got ${ruachPointed.lemmas[0]?.lemma_key}`
);
assert(
  ruachPointed.query_analysis.has_vowels_or_accents === true,
  'Query analysis must detect vowel points on רוּחַ'
);
console.log('  [PASS] Pointed רוּחַ matches lemma:H7307 as top lemma');

const revachPointed = await rpc('lookup_lexical_semantics_v1', { p_query: 'רֶוַח' });
assert(revachPointed.status === 'ok', 'Pointed רֶוַח lookup failed');
assert(
  revachPointed.lemmas[0].lemma_key === 'lemma:H7305',
  `Expected top lemma for רֶוַח to be lemma:H7305 (space), got ${revachPointed.lemmas[0]?.lemma_key}`
);
assert(
  revachPointed.lemmas[0].lemma_key !== 'lemma:H7307',
  'Pointed רֶוַח must NOT collapse to רוּחַ (H7307)'
);
console.log('  [PASS] Pointed רֶוַח matches lemma:H7305 (space) without collapsing to H7307');

const ravachPointed = await rpc('lookup_lexical_semantics_v1', { p_query: 'רָוַח' });
assert(ravachPointed.status === 'ok', 'Pointed רָוַח lookup failed');
assert(
  ravachPointed.lemmas[0].lemma_key === 'lemma:H7304',
  `Expected top lemma for רָוַח to be lemma:H7304 (be wide), got ${ravachPointed.lemmas[0]?.lemma_key}`
);
console.log('  [PASS] Pointed רָוַח matches lemma:H7304 (be wide)');

// 1b. כפר (kaphar / kipper / kopher)
const kapharUnpointed = await rpc('lookup_lexical_semantics_v1', { p_query: 'כפר' });
assert(kapharUnpointed.status === 'ok', 'Unpointed כפר lookup failed');
assert(
  kapharUnpointed.total_matching_lemmas >= 8,
  `Expected >= 8 matching lemmas for unpointed כפר, got ${kapharUnpointed.total_matching_lemmas}`
);
console.log(`  [PASS] Unpointed כפר returns all ${kapharUnpointed.total_matching_lemmas} distinct homographs`);

const kipperPointed = await rpc('lookup_lexical_semantics_v1', { p_query: 'כִּפֶּר' });
assert(
  kipperPointed.lemmas[0].lemma_key === 'lemma:H3722A',
  `Expected top lemma for כִּפֶּר to be lemma:H3722A (to atone), got ${kipperPointed.lemmas[0]?.lemma_key}`
);
console.log('  [PASS] Pointed כִּפֶּר matches lemma:H3722A (to atone)');

const kopherPointed = await rpc('lookup_lexical_semantics_v1', { p_query: 'כֹּפֶר' });
assert(
  kipperPointed.lemmas[0].lemma_key !== kopherPointed.lemmas[0].lemma_key,
  'כִּפֶּר and כֹּפֶר must not be collapsed'
);
assert(
  kopherPointed.lemmas[0].lemma_key === 'lemma:H3724A',
  `Expected top lemma for כֹּפֶר to be lemma:H3724A (ransom), got ${kopherPointed.lemmas[0]?.lemma_key}`
);
console.log('  [PASS] Pointed כֹּפֶר matches lemma:H3724A (ransom)');

// 1c. דבר (davar verb / davar noun / dever pestilence / dover pasture)
const davarUnpointed = await rpc('lookup_lexical_semantics_v1', { p_query: 'דבר' });
assert(davarUnpointed.status === 'ok', 'Unpointed דבר lookup failed');
assert(
  davarUnpointed.total_matching_lemmas >= 6,
  `Expected >= 6 matching lemmas for unpointed דבר, got ${davarUnpointed.total_matching_lemmas}`
);
console.log(`  [PASS] Unpointed דבר returns all ${davarUnpointed.total_matching_lemmas} distinct homographs`);

const davarVerb = await rpc('lookup_lexical_semantics_v1', { p_query: 'דָבַר' });
assert(
  davarVerb.lemmas[0].lemma_key === 'lemma:H1696G',
  `Expected top lemma for דָבַר to be lemma:H1696G (verb to speak), got ${davarVerb.lemmas[0]?.lemma_key}`
);
console.log('  [PASS] Pointed דָבַר matches lemma:H1696G (verb to speak)');

const davarNoun = await rpc('lookup_lexical_semantics_v1', { p_query: 'דָּבָר' });
assert(
  davarNoun.lemmas[0].lemma_key === 'lemma:H1697G',
  `Expected top lemma for דָּבָר to be lemma:H1697G (noun word/matter), got ${davarNoun.lemmas[0]?.lemma_key}`
);
console.log('  [PASS] Pointed דָּבָר matches lemma:H1697G (noun word/matter)');

const deverPestilence = await rpc('lookup_lexical_semantics_v1', { p_query: 'דֶּבֶר' });
assert(
  deverPestilence.lemmas[0].lemma_key === 'lemma:H1698',
  `Expected top lemma for דֶּבֶר to be lemma:H1698 (pestilence), got ${deverPestilence.lemmas[0]?.lemma_key}`
);
console.log('  [PASS] Pointed דֶּבֶר matches lemma:H1698 (pestilence)');

// ---------------------------------------------------------------------------
// Test 2: Greek Searches Handle Accents Consistently
// ---------------------------------------------------------------------------
console.log('\nTest 2: Greek Searches Handle Accents Consistently');

const logosTonos = await rpc('lookup_lexical_semantics_v1', { p_query: 'λόγος' });
const logosOxia = await rpc('lookup_lexical_semantics_v1', { p_query: 'λόγος' });
const logosStripped = await rpc('lookup_lexical_semantics_v1', { p_query: 'λογος' });

assert(
  logosTonos.lemmas[0]?.lemma_key === 'lemma:G3056',
  'Monotonic tonos λόγος must match lemma:G3056'
);
assert(
  logosOxia.lemmas[0]?.lemma_key === 'lemma:G3056',
  'Polytonic oxia λόγος must match lemma:G3056'
);
assert(
  logosStripped.lemmas[0]?.lemma_key === 'lemma:G3056',
  'Unaccented λογος must match lemma:G3056'
);
console.log('  [PASS] λόγος (tonos), λόγος (oxia), and λογος (unaccented) all resolve consistently to lemma:G3056');

const agapePolytonic = await rpc('lookup_lexical_semantics_v1', { p_query: 'ἀγάπη' });
const agapeStripped = await rpc('lookup_lexical_semantics_v1', { p_query: 'αγαπη' });

assert(
  agapePolytonic.lemmas[0]?.lemma_key === 'lemma:G0026',
  'Polytonic ἀγάπη must match lemma:G0026'
);
assert(
  agapeStripped.lemmas[0]?.lemma_key === 'lemma:G0026',
  'Unaccented αγαπη must match lemma:G0026'
);
console.log('  [PASS] ἀγάπη (polytonic breathing + accent) and αγαπη (unaccented) resolve to lemma:G0026');

// ---------------------------------------------------------------------------
// Test 3: Homographs and Distinct Lexical Senses Remain Distinguishable
// ---------------------------------------------------------------------------
console.log('\nTest 3: Homographs and Distinct Lexical Senses Remain Distinguishable');

const baraLookup = await rpc('lookup_lexical_semantics_v1', { p_query: 'H1254' });
assert(baraLookup.total_matching_lemmas >= 3, 'H1254 must return >= 3 distinct homograph lemmas');
const baraKeys = baraLookup.lemmas.map(l => l.lemma_key.toLowerCase());
assert(baraKeys.includes('lemma:h1254a'), 'H1254 must include H1254A (to create)');
assert(baraKeys.includes('lemma:h1254b'), 'H1254 must include H1254B (to fatten)');
assert(baraKeys.includes('lemma:h1254c'), 'H1254 must include H1254C (to clear wood)');
console.log('  [PASS] H1254 preserves all 3 homographs (H1254A create, H1254B fatten, H1254C clear wood)');

const kapharSensesA = kipperPointed.lemmas[0].documented_senses;
assert(
  kapharSensesA.some(s => s.short_gloss.toLowerCase().includes('atone')),
  'H3722A must have sense "to atone"'
);
const kapharB = await rpc('lookup_lexical_semantics_v1', { p_query: 'lemma:H3722B' });
const kapharSensesB = kapharB.lemmas[0].documented_senses;
assert(
  kapharSensesB.some(s => s.short_gloss.toLowerCase().includes('cover')),
  'H3722B must have sense "to cover"'
);
assert(
  kapharSensesA[0].sense_key !== kapharSensesB[0].sense_key,
  'H3722A and H3722B must have distinct sense keys'
);
console.log('  [PASS] H3722A (to atone) and H3722B (to cover) maintain distinct documented senses');

// ---------------------------------------------------------------------------
// Test 4: Sense vs Translation Gloss Separation & Caveat Invariant
// ---------------------------------------------------------------------------
console.log('\nTest 4: Sense vs Translation Gloss Separation & Caveat Invariant');

const ruachLemma = ruachPointed.lemmas[0];
assert(
  Array.isArray(ruachLemma.documented_senses) && ruachLemma.documented_senses.length > 0,
  'H7307 must have documented_senses'
);
assert(
  Array.isArray(ruachLemma.attested_translation_glosses) && ruachLemma.attested_translation_glosses.length > 0,
  'H7307 must have attested_translation_glosses'
);

for (const gloss of ruachLemma.attested_translation_glosses) {
  assert(
    typeof gloss.attested_gloss === 'string' && gloss.attested_gloss.length > 0,
    'Translation gloss must have attested_gloss text'
  );
  assert(
    gloss.token_count >= 1 && gloss.verse_count >= 1,
    'Translation gloss must have token_count and verse_count >= 1'
  );
  assert(
    gloss.sample_passage && gloss.sample_passage.verse_id && gloss.sample_passage.source_ref,
    'Translation gloss must have sample_passage citation'
  );
  assert(
    gloss.caveat.includes('contextual equivalence only, does not constitute a dictionary definition'),
    'Translation gloss must carry explicit caveat preventing gloss from being presented as definitive sense'
  );
}
console.log(
  `  [PASS] Separated ${ruachLemma.documented_senses.length} documented dictionary senses from ${ruachLemma.attested_translation_glosses.length} attested translation glosses with explicit caveats`
);

// ---------------------------------------------------------------------------
// Test 5: Source Attribution on Every Returned Lexical Interpretation
// ---------------------------------------------------------------------------
console.log('\nTest 5: Source Attribution on Every Returned Lexical Interpretation');

for (const lemma of [ruachLemma, logosTonos.lemmas[0], agapePolytonic.lemmas[0]]) {
  assert(lemma.source_record_id, `Lemma ${lemma.lemma_key} missing source_record_id`);
  for (const sense of lemma.documented_senses) {
    assert(
      sense.source_attribution && sense.source_attribution.length > 5,
      `Sense ${sense.sense_key} missing source_attribution`
    );
    assert(
      sense.source_record_id && sense.source_edition_key,
      `Sense ${sense.sense_key} missing source provenance`
    );
  }
  for (const gloss of lemma.attested_translation_glosses) {
    assert(
      gloss.source_attribution && gloss.source_attribution.includes('('),
      `Gloss ${gloss.attested_gloss} missing source commit attribution`
    );
  }
}
console.log('  [PASS] 100% of tested lemmas, senses, and translation glosses retain verified source attribution');

// ---------------------------------------------------------------------------
// Test 6: Non-Synonymous Root Invariant & Attested Etymology
// ---------------------------------------------------------------------------
console.log('\nTest 6: Non-Synonymous Root Invariant & Attested Etymology');

const elohimLookup = await rpc('lookup_lexical_semantics_v1', { p_query: 'H0430' });
const elohimLemma = elohimLookup.lemmas[0];
assert(elohimLemma.documented_roots.length > 0, 'H0430 must have documented_roots');
for (const root of elohimLemma.documented_roots) {
  assert(
    root.implies_synonymy === false,
    `Root ${root.root_key} on ${elohimLemma.lemma_key} must NOT imply synonymy`
  );
  assert(
    root.source_record_id && root.etymology_type,
    `Root ${root.root_key} missing provenance or etymology_type`
  );
}

const aramaicRuach = ruachUnpointed.lemmas.find(l => l.lemma_key === 'lemma:H7308');
assert(aramaicRuach, 'Aramaic ruach lemma:H7308 must be present in unpointed search');
assert(
  aramaicRuach.documented_roots.some(r => r.etymology_type === 'aramaic_cognate_of'),
  'H7308 must be documented as aramaic_cognate_of root:H7307'
);
assert(
  aramaicRuach.documented_roots.every(r => r.implies_synonymy === false),
  'Aramaic cognate root link must have implies_synonymy === false'
);
console.log('  [PASS] Root invariant verified: implies_synonymy === false across all roots; Aramaic cognate explicitly identified');

// ---------------------------------------------------------------------------
// Test 7: Concordance Reproducibility Verification
// ---------------------------------------------------------------------------
console.log('\nTest 7: Concordance Reproducibility Verification');

// 7a. lookup_lemma_occurrences_v1 for G3056 (logos)
const logosOccs = await rpc('lookup_lemma_occurrences_v1', { p_lemma_query: 'G3056', p_limit: 10 });
assert(logosOccs.status === 'ok', 'lookup_lemma_occurrences_v1(G3056) failed');
assert(
  logosOccs.totals.total_tokens === 330,
  `Concordance count for G3056 changed: expected 330, got ${logosOccs.totals.total_tokens}`
);
console.log(`  [PASS] Concordance for G3056 reproduced exactly: 330 tokens across ${logosOccs.totals.total_verses} verses`);

// 7b. lookup_lemma_occurrences_v1 for H7307 (ruach Hebrew) and H7308 (ruach Aramaic)
const ruachOccs = await rpc('lookup_lemma_occurrences_v1', { p_lemma_query: 'H7307', p_limit: 10 });
assert(ruachOccs.status === 'ok', 'lookup_lemma_occurrences_v1(H7307) failed');
assert(
  ruachOccs.totals.total_tokens === 378,
  `Concordance count for Hebrew H7307 changed: expected 378, got ${ruachOccs.totals.total_tokens}`
);
const aramaicRuachOccs = await rpc('lookup_lemma_occurrences_v1', { p_lemma_query: 'H7308', p_limit: 10 });
assert(aramaicRuachOccs.status === 'ok', 'lookup_lemma_occurrences_v1(H7308) failed');
assert(
  aramaicRuachOccs.totals.total_tokens === 11,
  `Concordance count for Aramaic H7308 changed: expected 11, got ${aramaicRuachOccs.totals.total_tokens}`
);
console.log(
  `  [PASS] Concordance for H7307 (Hebrew: 378 tokens across ${ruachOccs.totals.total_verses} verses) and H7308 (Aramaic: 11 tokens) reproduced exactly (total: 389 tokens, non-conflated)`
);

// 7c. lookup_word_to_lemma_senses_v1 with vocalized Hebrew
const wordSenses = await rpc('lookup_word_to_lemma_senses_v1', { p_query: 'רוּחַ' });
assert(wordSenses.status === 'ok', 'lookup_word_to_lemma_senses_v1(רוּחַ) failed');
assert(
  wordSenses.word_forms.length >= 1,
  'lookup_word_to_lemma_senses_v1(רוּחַ) must return matched words'
);
assert(
  wordSenses.word_forms[0].base_strongs === 'H7307',
  'lookup_word_to_lemma_senses_v1(רוּחַ) must match H7307'
);
console.log('  [PASS] lookup_word_to_lemma_senses_v1 multi-tier matching reproduced successfully');

console.log('\n======================================================');
console.log('ALL TESTS PASSED: Reliable Lexical Semantics verified.');
