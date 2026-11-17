import assert from 'node:assert/strict';
import { buildStructuralIndex, findStructuralCandidates } from './structural-candidates.mjs';
const scenes = [
  { id: 'gen16', lineage_id: 'gen16', witness_ids: ['Gen16:7','Gen16:13'], features: [
    {role:'participant',value:'HAGAR'}, {role:'action',value:'SEE'},
    {role:'object_class',value:'WATER_SOURCE'}, {role:'location',value:'WILDERNESS'}] },
  { id: 'gen21', lineage_id: 'gen21', witness_ids: ['Gen21:19'], features: [
    {role:'participant',value:'HAGAR'}, {role:'action',value:'SEE'},
    {role:'object_class',value:'WATER_SOURCE'}, {role:'location',value:'WILDERNESS'}] },
  { id: 'duplicate-annotation', lineage_id: 'gen16', witness_ids: ['Gen16:7'], features: [
    {role:'participant',value:'HAGAR'}, {role:'action',value:'SEE'},
    {role:'object_class',value:'WATER_SOURCE'}] },
  { id: 'generic', features: [{role:'participant',value:'PERSON'}, {role:'action',value:'GO'}, {role:'object',value:'UNKNOWN'}] },
  { id: 'unrelated', features: [{role:'participant',value:'PROPHET'}, {role:'action',value:'HEAR'}, {role:'object_class',value:'FIRE'}] },
];
const index = buildStructuralIndex(scenes);
const result = findStructuralCandidates(index, 'gen16');
assert.ok(result.results.some(r=>r.candidate_scene_id==='gen21'), 'Hagar-like independent scene should be found');
assert.ok(!result.results.some(r=>r.candidate_scene_id==='duplicate-annotation'), 'same source lineage must not count as independent');
assert.ok(!result.results.some(r=>r.candidate_scene_id==='generic'), 'generic actions must not nominate a pattern');
assert.ok(result.results.every(r=>r.distinctive_shared_features.length>=2));
assert.equal(result.results[0].epistemic_layer,'HYPOTHESIS');
assert.equal(findStructuralCandidates(index,'unknown').coverage,'unknown_anchor');
assert.throws(()=>buildStructuralIndex([{id:'x',features:[]},{id:'x',features:[]}]));
console.log('structural-candidates: 7 assertions passed');
