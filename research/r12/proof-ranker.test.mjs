import assert from 'node:assert/strict';
import {scorePath,rankDiscoveryDestinations} from './proof-ranker.mjs';
const edge=(edge_id,relation_type,quality_weight,epistemic_layer='TEXTUAL',other={})=>({
 edge_id,relation_type,quality_weight,epistemic_layer,attestation_groups:[],passage_ids:[],...other
});
const path=(target_id,steps)=>({anchor_id:'bible:spirit',target_id,steps});
const lamp=path('bible:lampstand',[
 edge('exod-seven','HAS_QUANTITY',.9,'TEXTUAL',{attestation_groups:['Ex25-clause'],passage_ids:['Ex25:37'],feature_idf:5}),
 edge('zech-lamp','EXPLICITLY_REFERENCES',.75,'TEXTUAL',{attestation_groups:['Zech4-vision'],passage_ids:['Zech4:2'],feature_idf:4}),
]);
const eyes=path('bible:lampstand',[
 edge('zech-eyes','HAS_QUANTITY',.9,'TEXTUAL',{attestation_groups:['Zech4-vision'],passage_ids:['Zech4:10'],feature_idf:5}),
 edge('rev-identification','PREDICATES',1,'TEXTUAL',{attestation_groups:['Rev5-claim'],passage_ids:['Rev5:6'],feature_idf:5}),
]);
const duplicate=path('bible:lampstand',[
 edge('exod-seven','HAS_QUANTITY',.9,'TEXTUAL',{attestation_groups:['Ex25-clause'],passage_ids:['Ex25:37']}),
 edge('zech-lamp','EXPLICITLY_REFERENCES',.75,'TEXTUAL',{attestation_groups:['Zech4-vision'],passage_ids:['Zech4:2']}),
]);
const candidate=path('bible:wind',[
 edge('lexical-sense','HAS_SENSE',.75,'LINGUISTIC',{attestation_groups:['lexicon-one'],passage_ids:['Gen1:2']}),
 edge('wordnet-bridge','SEMANTIC_HYPERNYM',.45,'EXTERNAL_WORLD',{mapping_status:'candidate',attestation_groups:['wn-synset'],feature_idf:5}),
]);
const s=scorePath(lamp);
assert.ok(Math.abs(s.score_parts.Q-Math.sqrt(.9*.75))<0.00001);
assert.equal(s.epistemic_status,'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION');
assert.equal(s.independent_evidence_groups.length,2);
assert.equal(scorePath(candidate).epistemic_status,'EXPLORATORY');
assert.throws(()=>scorePath(path('x',[edge('bad','CO_OCCURS_WITH',0,'TEXTUAL')])));
assert.throws(()=>scorePath(path('x',[edge('bad','IS_A',.2,'RECEPTION')])));
const ranked=rankDiscoveryDestinations([lamp,eyes,duplicate,candidate],{limit:5});
assert.equal(ranked.results.length,2);
const merged=ranked.results.find(r=>r.target_id==='bible:lampstand');
assert.ok(merged);
assert.equal(merged.paths.length,2,'duplicate same path IDs must not inflate number of alternative paths');
assert.equal(merged.support_group_count,3,'Zech4 appears in two paths but remains one evidence source');
assert.ok(merged.convergence>0,'distinct sources can increase convergence');
assert.equal(ranked.results.find(r=>r.target_id==='bible:wind').evidence_status,'MIXED_OR_EXPLORATORY');
assert.ok(ranked.results.every(r=>r.interest>=0&&r.interest<=1));
assert.equal(scorePath(path('x',[
 edge('technical','OCCURRENCE_OF',1,'LINGUISTIC',{administrative:true}),
 edge('actual','PREDICATES',.9,'TEXTUAL')
])).score_parts.Q,.9);
console.log('proof-ranker: 13 assertions passed');
