import assert from 'node:assert/strict';
import { buildOrthographicIndex, findOrthographicCandidates, normalizeOriginalForm } from './orthographic-candidates.mjs';

assert.equal(normalizeOriginalForm('אָדָם', 'he'), 'אדם');
assert.equal(normalizeOriginalForm('דָּם', 'he'), 'דם');
assert.equal(normalizeOriginalForm('ἄγγελος', 'grc'), 'αγγελοσ');
const index = buildOrthographicIndex([
  { id: 'H120', language: 'he', form: 'אָדָם' },
  { id: 'H1818', language: 'he', form: 'דָּם' },
  { id: 'h-other', language: 'he', form: 'גַּן' },
  { id: 'h-same', language: 'he', form: 'אָדָם' },
  { id: 'g-one', language: 'grc', form: 'ἄγγελος' },
  { id: 'g-two', language: 'grc', form: 'αγγελος' },
]);
const hit = findOrthographicCandidates(index, 'H120');
const dam = hit.results.find((v) => v.target_id === 'H1818');
assert.ok(dam, 'Adam/dam substring must be discoverable without hardcoding');
assert.equal(dam.matched_normalized_text, 'דם');
assert.equal(dam.epistemic_layer, 'HYPOTHESIS');
assert.match(dam.limitation, /does not establish/);
assert.ok(!hit.results.some((v) => v.target_id === 'h-other'), 'single-letter match must be filtered');
assert.ok(!hit.results.some((v) => v.target_id === 'g-one'), 'cross-language form match forbidden');
assert.equal(hit.results.find((v) => v.target_id === 'h-same').normalized_form_equal, true);
const greek = findOrthographicCandidates(index, 'g-one');
assert.equal(greek.results.find((v) => v.target_id === 'g-two').normalized_form_equal, true);
assert.equal(findOrthographicCandidates(index, 'missing').coverage, 'unknown_anchor');
assert.throws(() => buildOrthographicIndex([{ id: 'x', language: 'he', form: 'אב' }, { id: 'x', language: 'he', form: 'דם' }]));

// Distinct-root filtering (excludeIds) and co-occurrence promotion (H0120 <-> H1818)
const refinedIndex = buildOrthographicIndex([
  { id: 'H0120', language: 'he', form: 'אָדָם' },
  { id: 'H0127', language: 'he', form: 'אֲדָמָה' }, // same-root cognate (adamah)
  { id: 'H0121', language: 'he', form: 'אָדֹם' },   // same-root cognate (adom)
  { id: 'H1818', language: 'he', form: 'דָּם' },   // distinct root (dam), shares דם (raw 0.825)
  { id: 'H9999', language: 'he', form: 'מְאָדָם' }, // longer non-cooccurring form containing אדם (raw ~0.879)
]);

const excluded = findOrthographicCandidates(refinedIndex, 'H0120', {
  excludeIds: new Set(['H0127', 'H0121']),
});
assert.ok(!excluded.results.some((r) => r.target_id === 'H0127'), 'excluded same-root cognate H0127 must be filtered');
assert.ok(!excluded.results.some((r) => r.target_id === 'H0121'), 'excluded same-root cognate H0121 must be filtered');
assert.ok(excluded.results.some((r) => r.target_id === 'H1818'), 'distinct-root H1818 must remain');

// Verify cooccurrenceCounts promotes H0120 <-> H1818 while preserving raw_orthographic_score and HYPOTHESIS
const unboosted = findOrthographicCandidates(refinedIndex, 'H0120', {
  excludeIds: ['H0127', 'H0121'],
});
assert.equal(unboosted.results[0].target_id, 'H9999', 'without co-occurrence boost, H9999 outranks H1818 on raw orthography');
const damUnboosted = unboosted.results.find((r) => r.target_id === 'H1818');

const boosted = findOrthographicCandidates(refinedIndex, 'H0120', {
  excludeIds: ['H0127', 'H0121'],
  cooccurrenceCounts: new Map([['H1818', 15]]),
  preferCooccurring: true,
});
const damBoosted = boosted.results.find((r) => r.target_id === 'H1818');
assert.equal(boosted.results[0].target_id, 'H1818', 'cooccurrenceCounts must promote H0120<->H1818');
assert.equal(damBoosted.cooccurrence_verses, 15);
assert.equal(damBoosted.raw_orthographic_score, damUnboosted.raw_orthographic_score);
assert.ok(damBoosted.score > damBoosted.raw_orthographic_score && damBoosted.score <= 1);
assert.equal(damBoosted.epistemic_layer, 'HYPOTHESIS');
assert.equal(damBoosted.limitation, 'Shared spelling does not establish root, etymology, meaning, or intentional wordplay.');

console.log('orthographic-candidates: all assertions passed');
