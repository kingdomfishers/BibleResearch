import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPropertyIndex, findPropertyBridges } from './property-bridges.mjs';

function p(anchor_id, property_key, value_id, source_id, overrides = {}) {
  return {
    anchor_id,
    property_key,
    value_id,
    source_id,
    source_ref: 'https://example.test/claims/' + source_id,
    provider: 'test-source',
    release: 'pinned-v1',
    license: 'CC0',
    rights_status: 'approved',
    claim_status: 'sourced',
    mapping_status: 'verified',
    epistemic_layer: 'EXTERNAL_WORLD',
    ...overrides,
  };
}

const records = [
  p('bible:lamp', 'emits', 'LIGHT', 'lamp-light'),
  p('bible:torch', 'emits', 'LIGHT', 'torch-light'),
  p('bible:lamp', 'has_component', 'FLAME', 'lamp-flame'),
  p('bible:torch', 'has_component', 'FLAME', 'torch-flame'),
  p('bible:well', 'is_a', 'WATER_SOURCE', 'well-water'),
  p('bible:spring', 'is_a', 'WATER_SOURCE', 'spring-water', { mapping_status: 'candidate' }),
  p('bible:lamp', 'wikidata_id', 'Q123', 'metadata'),
  ...['bible:lamp', 'bible:torch', 'bible:well', 'bible:spring', 'bible:tree'].map((id, i) => p(id, 'is_a', 'THING', 'generic-' + i)),
];
const index = buildPropertyIndex(records);
assert.equal(index.metadataSkipped, 1, 'metadata must not be physical bridge');
const lamp = findPropertyBridges(index, 'bible:lamp', { maxDocumentFrequency: 4 });
const torch = lamp.results.find((x) => x.target_id === 'bible:torch');
assert.ok(torch, 'independent shared physical properties should nominate a bridge');
assert.equal(torch.shared_features.length, 2);
assert.ok(!lamp.results.find((x) => x.target_id === 'bible:well'), 'generic THING hub must not nominate');
assert.equal(torch.epistemic_layer, 'HYPOTHESIS');
assert.equal(torch.independent_biblical_support, 0);
assert.equal(torch.bridge_kind, 'shared_external_property');
const well = findPropertyBridges(index, 'bible:well', { maxDocumentFrequency: 4 });
const spring = well.results.find((x) => x.target_id === 'bible:spring');
assert.ok(spring, 'candidate lexical category mapping may create exploratory connection');
assert.ok(spring.score < torch.score, 'candidate mapping must be downweighted');
assert.equal(findPropertyBridges(index, 'not-found').coverage, 'unknown_anchor');
assert.throws(() => buildPropertyIndex([p('x', 'material', 'COPPER', 'bad', { rights_status: 'unverified' })]));
assert.throws(() => buildPropertyIndex([p('x', 'material', 'COPPER', 'bad', { source_ref: '' })]));
assert.ok(lamp.diagnostics.indexed_claims > 0);

// Negative tests: reject fabricated Wikidata predicates and synthetic statement GUIDs
assert.throws(
  () => buildPropertyIndex([
    p('lemma:H5216', 'wd:related_physical_class', 'wd:Q1138737', 'Q821952$93d8b419-49e4-a052-6120-aa9f432d1517:class:Q1138737', {
      provider: 'Wikidata',
    }),
  ]),
  TypeError,
  'synthetic :class: Wikidata row must be rejected',
);
assert.throws(
  () => buildPropertyIndex([
    p('lemma:H5216', 'wd:combustion_fuel_agent', 'wd:Q93165', 'wd-rev-2557602185:Q821952:fuel:Q93165', {
      provider: 'Wikidata',
    }),
  ]),
  TypeError,
  'synthetic wd-rev- fuel Wikidata row must be rejected',
);
assert.throws(
  () => buildPropertyIndex([
    p('lemma:H5216', 'wd:P279', 'wd:Q1138737', 'Q821952$93d8b419:class:Q1138737', {
      provider: 'Wikidata',
    }),
  ]),
  TypeError,
  'synthetic :class: suffix on valid wd:P279 must still be rejected',
);

// Sense isolation & bridge_kind tests (H5869_eye vs H5869_spring, plus identical external_id equivalence)
const senseIndex = buildPropertyIndex([
  p('lemma:H5869', 'wd:P31', 'wd:Q3355930', 'Q7364$15ca3c30-498d-6655-7c9c-181da8a1dd54', {
    sense_id: 'H5869_eye',
    provider: 'Wikidata',
    external_id: 'wd:Q7364',
    assertion_origin: 'ORIGINAL_WIKIDATA_STATEMENT',
  }),
  p('lemma:G3788', 'wd:P31', 'wd:Q3355930', 'Q7364$15ca3c30-498d-6655-7c9c-181da8a1dd54', {
    sense_id: 'G3788_eye',
    provider: 'Wikidata',
    external_id: 'wd:Q7364',
    assertion_origin: 'ORIGINAL_WIKIDATA_STATEMENT',
  }),
  p('lemma:H5869', 'oewn:hypernym', 'oewn:09412891-n', 'oewn-2025:09466357-n:oewn:hypernym->oewn:09412891-n', {
    sense_id: 'H5869_spring',
    provider: 'OpenEnglishWordNet',
    external_id: 'oewn:09466357-n',
    mapping_status: 'candidate',
    assertion_origin: 'ORIGINAL_OEWN_RELATION',
  }),
  p('lemma:H0875', 'oewn:hypernym', 'oewn:09412891-n', 'oewn-2025:04579630-n:oewn:hypernym->oewn:09412891-n', {
    sense_id: 'H0875_well',
    provider: 'OpenEnglishWordNet',
    external_id: 'oewn:04579630-n',
    assertion_origin: 'ORIGINAL_OEWN_RELATION',
  }),
]);

const eyeOnly = findPropertyBridges(senseIndex, 'H5869_eye', { maxDocumentFrequency: 4 });
assert.equal(eyeOnly.results.length, 1);
assert.equal(eyeOnly.results[0].anchor_sense_id, 'H5869_eye');
assert.equal(eyeOnly.results[0].target_sense_id, 'G3788_eye');
assert.equal(eyeOnly.results[0].target_id, 'lemma:G3788');
assert.equal(eyeOnly.results[0].bridge_kind, 'external_concept_equivalence');
assert.equal(eyeOnly.results[0].assertion_origin, 'ORIGINAL_WIKIDATA_STATEMENT');

const springOnly = findPropertyBridges(senseIndex, 'H5869_spring', { maxDocumentFrequency: 4 });
assert.equal(springOnly.results.length, 1);
assert.equal(springOnly.results[0].anchor_sense_id, 'H5869_spring');
assert.equal(springOnly.results[0].target_sense_id, 'H0875_well');
assert.equal(springOnly.results[0].bridge_kind, 'shared_external_property');
assert.equal(springOnly.results[0].assertion_origin, 'ORIGINAL_OEWN_RELATION');

const combinedH5869 = findPropertyBridges(senseIndex, 'lemma:H5869', { maxDocumentFrequency: 4 });
assert.equal(combinedH5869.results.length, 2, 'polysemous anchor must emit separate sense-keyed bridges');
assert.ok(combinedH5869.results.some((r) => r.anchor_sense_id === 'H5869_eye' && r.target_sense_id === 'G3788_eye'));
assert.ok(combinedH5869.results.some((r) => r.anchor_sense_id === 'H5869_spring' && r.target_sense_id === 'H0875_well'));

// Verify the pinned external pilot fixture builds cleanly without provenance violations
const pinnedFixture = JSON.parse(fs.readFileSync(new URL('../../scripts/fixtures/r12-external-pilot.json', import.meta.url), 'utf8'));
const pinnedIndex = buildPropertyIndex(pinnedFixture.property_assertions);
assert.ok(pinnedIndex.recordCount > 300);
const h5869Bridges = findPropertyBridges(pinnedIndex, 'lemma:H5869', { maxDocumentFrequency: 12 });
const h5869EyeTargets = h5869Bridges.results.filter((r) => r.anchor_sense_id === 'H5869_eye').map((r) => r.target_id);
const h5869SpringTargets = h5869Bridges.results.filter((r) => r.anchor_sense_id === 'H5869_spring').map((r) => r.target_id);
assert.ok(h5869EyeTargets.includes('lemma:G3788'), 'H5869_eye must bridge to G3788_eye');
assert.ok(!h5869EyeTargets.includes('lemma:G4077'), 'H5869_eye must never leak spring targets');
assert.ok(h5869SpringTargets.includes('lemma:G4077'), 'H5869_spring must bridge to G4077_spring');
assert.ok(!h5869SpringTargets.includes('lemma:G3788'), 'H5869_spring must never leak eye targets');

console.log('property-bridges: all assertions passed');
