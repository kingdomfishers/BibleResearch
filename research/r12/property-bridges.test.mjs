import assert from 'node:assert/strict';
import {buildPropertyIndex,findPropertyBridges} from './property-bridges.mjs';

function p(anchor_id,property_key,value_id,source_id,overrides={}){
  return {anchor_id,property_key,value_id,source_id,
    source_ref:'https://example.test/claims/'+source_id,provider:'test-source',
    release:'pinned-v1',license:'CC0',rights_status:'approved',claim_status:'sourced',
    mapping_status:'verified',epistemic_layer:'EXTERNAL_WORLD',...overrides};
}
const records=[
  p('bible:lamp','emits','LIGHT','lamp-light'),
  p('bible:torch','emits','LIGHT','torch-light'),
  p('bible:lamp','has_component','FLAME','lamp-flame'),
  p('bible:torch','has_component','FLAME','torch-flame'),
  p('bible:well','is_a','WATER_SOURCE','well-water'),
  p('bible:spring','is_a','WATER_SOURCE','spring-water',{mapping_status:'candidate'}),
  p('bible:lamp','wikidata_id','Q123','metadata'),
  ...['bible:lamp','bible:torch','bible:well','bible:spring','bible:tree'].map((id,i)=>p(id,'is_a','THING','generic-'+i)),
];
const index=buildPropertyIndex(records);
assert.equal(index.metadataSkipped,1,'metadata must not be physical bridge');
const lamp=findPropertyBridges(index,'bible:lamp',{maxDocumentFrequency:4});
const torch=lamp.results.find(x=>x.target_id==='bible:torch');
assert.ok(torch,'independent shared physical properties should nominate a bridge');
assert.equal(torch.shared_features.length,2);
assert.ok(!lamp.results.find(x=>x.target_id==='bible:well'),'generic THING hub must not nominate');
assert.equal(torch.epistemic_layer,'HYPOTHESIS');
assert.equal(torch.independent_biblical_support,0);
const well=findPropertyBridges(index,'bible:well',{maxDocumentFrequency:4});
const spring=well.results.find(x=>x.target_id==='bible:spring');
assert.ok(spring,'candidate lexical category mapping may create exploratory connection');
assert.ok(spring.score<torch.score,'candidate mapping must be downweighted');
assert.equal(findPropertyBridges(index,'not-found').coverage,'unknown_anchor');
assert.throws(()=>buildPropertyIndex([p('x','material','COPPER','bad',{rights_status:'unverified'})]));
assert.throws(()=>buildPropertyIndex([p('x','material','COPPER','bad',{source_ref:''})]));
assert.ok(lamp.diagnostics.indexed_claims>0);
console.log('property-bridges: 12 assertions passed');
