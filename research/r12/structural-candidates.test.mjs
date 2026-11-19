import assert from 'node:assert/strict';
import { buildStructuralIndex, findStructuralCandidates } from './structural-candidates.mjs';

const scenes = [
  { id: 'gen16', lineage_id: 'gen16', witness_ids: ['Gen16:7', 'Gen16:13'], features: [
    { role: 'participant', value: 'HAGAR' }, { role: 'action', value: 'SEE' },
    { role: 'object_class', value: 'WATER_SOURCE' }, { role: 'location', value: 'WILDERNESS' },
  ] },
  { id: 'gen21', lineage_id: 'gen21', witness_ids: ['Gen21:19'], features: [
    { role: 'participant', value: 'HAGAR' }, { role: 'action', value: 'SEE' },
    { role: 'object_class', value: 'WATER_SOURCE' }, { role: 'location', value: 'WILDERNESS' },
  ] },
  { id: 'duplicate-annotation', lineage_id: 'gen16', witness_ids: ['Gen16:7'], features: [
    { role: 'participant', value: 'HAGAR' }, { role: 'action', value: 'SEE' },
    { role: 'object_class', value: 'WATER_SOURCE' },
  ] },
  { id: 'generic', features: [{ role: 'participant', value: 'PERSON' }, { role: 'action', value: 'GO' }, { role: 'object', value: 'UNKNOWN' }] },
  { id: 'unrelated', features: [{ role: 'participant', value: 'PROPHET' }, { role: 'action', value: 'HEAR' }, { role: 'object_class', value: 'FIRE' }] },
];
const index = buildStructuralIndex(scenes);
const result = findStructuralCandidates(index, 'gen16');
assert.ok(result.results.some((r) => r.candidate_scene_id === 'gen21'), 'Hagar-like independent scene should be found');
assert.ok(!result.results.some((r) => r.candidate_scene_id === 'duplicate-annotation'), 'same source lineage must not count as independent');
assert.ok(!result.results.some((r) => r.candidate_scene_id === 'generic'), 'generic actions must not nominate a pattern');
assert.ok(result.results.every((r) => r.distinctive_shared_features.length >= 2));
assert.ok(result.results[0].shared_feature_families.length >= 2);
assert.equal(result.results[0].epistemic_layer, 'HYPOTHESIS');
assert.equal(findStructuralCandidates(index, 'unknown').coverage, 'unknown_anchor');
assert.throws(() => buildStructuralIndex([{ id: 'x', features: [] }, { id: 'x', features: [] }]));

// Negative test: 3 correlated encodings of ONE H5869->H5375 grammatical relation must yield 0 matches under minDistinctFamilies: 2
const correlatedScenes = [
  {
    id: 'scene-a',
    lineage_id: 'lin-a',
    features: [
      { role: 'anchor:H5869', value: 'grammatical_object_of' },
      { role: 'participant:H5375', value: 'attested' },
      { role: 'role:grammatical_object_of', value: 'H5869->H5375' },
    ],
  },
  {
    id: 'scene-b',
    lineage_id: 'lin-b',
    features: [
      { role: 'anchor:H5869', value: 'grammatical_object_of' },
      { role: 'participant:H5375', value: 'attested' },
      { role: 'role:grammatical_object_of', value: 'H5869->H5375' },
    ],
  },
  {
    id: 'scene-c-multi-family',
    lineage_id: 'lin-c',
    features: [
      { role: 'action_rel:grammatical_object_of', value: 'H5375' },
      { role: 'co_lemma:H8064', value: 'heaven' },
      { role: 'qty:seven', value: '7' },
    ],
  },
  {
    id: 'scene-d-multi-family',
    lineage_id: 'lin-d',
    features: [
      { role: 'action_rel:grammatical_object_of', value: 'H5375' },
      { role: 'co_lemma:H8064', value: 'heaven' },
      { role: 'discourse:simile', value: 'lifting_eyes' },
    ],
  },
];
const correlatedIndex = buildStructuralIndex(correlatedScenes);
const correlatedRes = findStructuralCandidates(correlatedIndex, 'scene-a', { minDistinctFamilies: 2 });
assert.equal(correlatedRes.results.length, 0, '3 correlated encodings of 1 relation must produce 0 matches under minDistinctFamilies: 2');

const multiFamRes = findStructuralCandidates(correlatedIndex, 'scene-c-multi-family', { minDistinctFamilies: 2 });
assert.equal(multiFamRes.results.length, 1, '2 distinct families (action_rel + co_participant) must pass cleanly');
assert.deepEqual(multiFamRes.results[0].shared_feature_families, ['action_rel', 'co_participant']);

console.log('structural-candidates: all assertions passed');
