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
const dam = hit.results.find(v => v.target_id === 'H1818');
assert.ok(dam, 'Adam/dam substring must be discoverable without hardcoding');
assert.equal(dam.matched_normalized_text, 'דם');
assert.equal(dam.epistemic_layer, 'HYPOTHESIS');
assert.match(dam.limitation, /does not establish/);
assert.ok(!hit.results.some(v => v.target_id === 'h-other'), 'single-letter match must be filtered');
assert.ok(!hit.results.some(v => v.target_id === 'g-one'), 'cross-language form match forbidden');
assert.equal(hit.results.find(v => v.target_id === 'h-same').normalized_form_equal, true);
const greek = findOrthographicCandidates(index, 'g-one');
assert.equal(greek.results.find(v => v.target_id === 'g-two').normalized_form_equal, true);
assert.equal(findOrthographicCandidates(index, 'missing').coverage, 'unknown_anchor');
assert.throws(() => buildOrthographicIndex([{id:'x',language:'he',form:'אב'},{id:'x',language:'he',form:'דם'}]));
console.log('orthographic-candidates: 11 assertions passed');
