import assert from 'node:assert/strict';
import { R12_SCORE_VERSION, scorePath, rankDiscoveryDestinations } from './proof-ranker.mjs';

const edge = (edge_id, relation_type, quality_weight, epistemic_layer = 'TEXTUAL', other = {}) => ({
  edge_id,
  relation_type,
  quality_weight,
  epistemic_layer,
  attestation_groups: [],
  passage_ids: [],
  ...other,
});

const path = (target_id, steps, extra = {}) => ({
  anchor_id: 'bible:spirit',
  target_id,
  steps,
  ...extra,
});

assert.equal(R12_SCORE_VERSION, 'r12-ranker-v2');

const lamp = path('bible:lampstand', [
  edge('exod-seven', 'HAS_QUANTITY', 0.9, 'TEXTUAL', {
    attestation_groups: ['Ex25-clause'],
    passage_ids: ['Ex25:37'],
    feature_idf: 5,
  }),
  edge('zech-lamp', 'EXPLICITLY_REFERENCES', 0.75, 'TEXTUAL', {
    attestation_groups: ['Zech4-vision'],
    passage_ids: ['Zech4:2'],
    feature_idf: 4,
  }),
]);

const eyes = path('bible:lampstand', [
  edge('zech-eyes', 'HAS_QUANTITY', 0.9, 'TEXTUAL', {
    attestation_groups: ['Zech4-vision'],
    passage_ids: ['Zech4:10'],
    feature_idf: 5,
  }),
  edge('rev-identification', 'PREDICATES', 1, 'TEXTUAL', {
    attestation_groups: ['Rev5-claim'],
    passage_ids: ['Rev5:6'],
    feature_idf: 5,
  }),
]);

const duplicate = path('bible:lampstand', [
  edge('exod-seven', 'HAS_QUANTITY', 0.9, 'TEXTUAL', {
    attestation_groups: ['Ex25-clause'],
    passage_ids: ['Ex25:37'],
  }),
  edge('zech-lamp', 'EXPLICITLY_REFERENCES', 0.75, 'TEXTUAL', {
    attestation_groups: ['Zech4-vision'],
    passage_ids: ['Zech4:2'],
  }),
]);

const candidate = path('bible:wind', [
  edge('lexical-sense', 'HAS_SENSE', 0.75, 'LINGUISTIC', {
    attestation_groups: ['lexicon-one'],
    passage_ids: ['Gen1:2'],
  }),
  edge('wordnet-bridge', 'SEMANTIC_HYPERNYM', 0.45, 'EXTERNAL_WORLD', {
    mapping_status: 'candidate',
    attestation_groups: ['wn-synset'],
    feature_idf: 5,
  }),
]);

const s = scorePath(lamp);
assert.equal(s.score_version, 'r12-ranker-v2');
assert.ok(Math.abs(s.score_parts.Q - Math.sqrt(0.9 * 0.75)) < 0.00001);
assert.equal(s.epistemic_status, 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION');
assert.equal(s.independent_evidence_groups.length, 2);
assert.equal(s.step_support_group_count, 2);
assert.equal(s.K, 0.28);

const candScored = scorePath(candidate);
assert.equal(candScored.epistemic_status, 'EXPLORATORY');
assert.equal(candScored.K, 0.75);
assert.equal(candScored.endpoint_epistemic_status, 'EXPLORATORY_STEP_CHAIN');
assert.deepEqual(candScored.independent_evidence_groups, ['lexicon-one']);

assert.throws(() => scorePath(path('x', [edge('bad', 'CO_OCCURS_WITH', 0, 'TEXTUAL')])));
assert.throws(() => scorePath(path('x', [edge('bad', 'IS_A', 0.2, 'RECEPTION')])));

const ranked = rankDiscoveryDestinations([lamp, eyes, duplicate, candidate], { limit: 5 });
assert.equal(ranked.results.length, 2);
const merged = ranked.results.find((r) => r.target_id === 'bible:lampstand');
assert.ok(merged);
assert.equal(merged.paths.length, 2, 'duplicate same path IDs must not inflate number of alternative paths');
assert.equal(merged.support_group_count, 3, 'Zech4 appears in two paths but remains one step evidence source');
assert.equal(merged.step_support_group_count, 3);
assert.equal(merged.endpoint_support_group_count, 0, 'disjoint un-contextualized routes must not synthesize endpoint convergence');
assert.equal(merged.convergence, 0);
assert.equal(ranked.results.find((r) => r.target_id === 'bible:wind').evidence_status, 'MIXED_OR_EXPLORATORY');
assert.ok(ranked.results.every((r) => r.interest >= 0 && r.interest <= 1));

assert.equal(
  scorePath(
    path('x', [
      edge('technical', 'OCCURRENCE_OF', 1, 'LINGUISTIC', { administrative: true }),
      edge('actual', 'PREDICATES', 0.9, 'TEXTUAL'),
    ]),
  ).score_parts.Q,
  0.9,
);

// Coherent multi-route convergence (two single-event + LXX routes to same destination)
const coherentRoute1 = {
  anchor_id: 'lemma:H5869',
  target_id: 'lemma:G4077',
  steps: [
    edge('g-h5869-h4325', 'gram_subject_of', 0.9, 'TEXTUAL', {
      attestation_groups: ['gram:GEN 16:7|cl1'],
      passage_ids: ['Genesis 16:7'],
      feature_idf: 4.5,
      intermediate_degree: 20,
    }),
    edge('lxx-h4325-g4077', 'lxx_translation_bridge', 0.88, 'LINGUISTIC', {
      attestation_groups: ['lxx:catss:G4077<->H4325'],
      passage_ids: ['Genesis 16:7'],
      feature_idf: 4.8,
    }),
  ],
};
const coherentRoute2 = {
  anchor_id: 'lemma:H5869',
  target_id: 'lemma:G4077',
  steps: [
    edge('g-h5869-h0875', 'gram_object_of', 0.88, 'TEXTUAL', {
      attestation_groups: ['gram:GEN 21:19|cl1'],
      passage_ids: ['Genesis 21:19'],
      feature_idf: 5.0,
      intermediate_degree: 18,
    }),
    edge('lxx-h0875-g4077', 'lxx_translation_bridge', 0.86, 'LINGUISTIC', {
      attestation_groups: ['lxx:catss:G4077<->H0875'],
      passage_ids: ['Genesis 21:19'],
      feature_idf: 4.9,
    }),
  ],
};
const coherentMultiRanked = rankDiscoveryDestinations([coherentRoute1, coherentRoute2], { limit: 5 });
assert.equal(coherentMultiRanked.results.length, 1);
assert.ok(coherentMultiRanked.results[0].K >= 0.72);
assert.ok(coherentMultiRanked.results[0].endpoint_support_group_count >= 1);
assert.ok(coherentMultiRanked.results[0].convergence > 0, 'coherent multi-route destination must yield positive convergence');
assert.equal(coherentMultiRanked.results[0].endpoint_epistemic_status, 'COHERENT_MULTIHOP_LEAD');

// 1) Disconnected 3-hop chain (N001: H1904->H3205->H1323->H3284 across Gen 16 / 1 Chr 14 / Deut 14)
const n001Chain = {
  anchor_id: 'lemma:H1904',
  target_id: 'lemma:H3284',
  steps: [
    edge('n001-1', 'gram_subject_of', 0.92, 'TEXTUAL', {
      from_id: 'lemma:H1904',
      to_id: 'lemma:H3205',
      direction: 'forward',
      attestation_groups: ['gram:GEN 16:15|c1', 'gram:GEN 16:15|c2', 'gram:GEN 16:16|c1'],
      passage_ids: ['Gen 16:15', 'Gen 16:16'],
      feature_idf: 5.2,
      intermediate_degree: 180,
      proper_entity: false,
    }),
    edge('n001-2', 'gram_object_of', 0.89, 'TEXTUAL', {
      from_id: 'lemma:H3205',
      to_id: 'lemma:H1323',
      direction: 'reverse',
      attestation_groups: ['gram:1CH 14:3|c1', 'gram:1CH 14:3|c2', 'gram:1CH 14:3|c3'],
      passage_ids: ['1 Chr 14:3'],
      feature_idf: 4.8,
      intermediate_degree: 420,
      proper_entity: false,
    }),
    edge('n001-3', 'gram_construct_of', 0.87, 'TEXTUAL', {
      from_id: 'lemma:H1323',
      to_id: 'lemma:H3284',
      direction: 'forward',
      attestation_groups: ['gram:DEU 14:15|c1', 'gram:DEU 14:15|c2', 'gram:DEU 14:15|c3'],
      passage_ids: ['Deut 14:15'],
      feature_idf: 5.8,
      intermediate_degree: 6,
    }),
  ],
};

const n001Scored = scorePath(n001Chain);
assert.ok(n001Scored.K < 0.25, `Expected N001 coherence K < 0.25, got ${n001Scored.K}`);
assert.equal(n001Scored.endpoint_epistemic_status, 'EXPLORATORY_STEP_CHAIN');

const n001Pruned = rankDiscoveryDestinations([n001Chain]);
assert.equal(n001Pruned.results.length, 0, 'Disconnected 3-hop chain must be pruned by default');
assert.equal(n001Pruned.pruned_incoherent_count, 1);

const n001Included = rankDiscoveryDestinations([n001Chain], { includeIncoherent: true });
assert.equal(n001Included.results.length, 1);
assert.equal(n001Included.results[0].C, 0, 'Disconnected 3-hop chain must have C === 0 even with 9 step groups');
assert.equal(n001Included.results[0].endpoint_support_group_count, 0);
assert.equal(n001Included.results[0].endpoint_epistemic_status, 'EXPLORATORY_STEP_CHAIN');
assert.equal(n001Included.results[0].evidence_status, 'MIXED_OR_EXPLORATORY');

// 2) Direct endpoint witness path (G3088->G5461->G5459 with direct_cooccurrence_refs: ['2 Peter 1:19'])
const directWitnessPath = {
  anchor_id: 'lemma:G3088',
  target_id: 'lemma:G5459',
  endpoint_context: {
    direct_cooccurrence_refs: ['2 Peter 1:19'],
  },
  steps: [
    edge('g3088-g5461', 'gram_object_of', 0.9, 'TEXTUAL', {
      from_id: 'lemma:G3088',
      to_id: 'lemma:G5461',
      direction: 'forward',
      attestation_groups: ['gram:LUK 11:36|c1'],
      passage_ids: ['Luke 11:36'],
      feature_idf: 5.5,
      intermediate_degree: 11,
    }),
    edge('g5461-g5459', 'gram_subject_of', 0.88, 'TEXTUAL', {
      from_id: 'lemma:G5461',
      to_id: 'lemma:G5459',
      direction: 'forward',
      attestation_groups: ['gram:JHN 1:9|c1'],
      passage_ids: ['John 1:9'],
      feature_idf: 5.7,
      intermediate_degree: 1,
    }),
  ],
};

const directScored = scorePath(directWitnessPath);
assert.ok(directScored.K >= 0.95, `Expected direct witness K >= 0.95, got ${directScored.K}`);
assert.equal(directScored.endpoint_epistemic_status, 'DIRECT_ENDPOINT_WITNESS');

const directVsIncoherent = rankDiscoveryDestinations([n001Chain, directWitnessPath], { includeIncoherent: true });
assert.equal(directVsIncoherent.results[0].target_id, 'lemma:G5459');
assert.ok(directVsIncoherent.results[0].C > 0);
assert.equal(directVsIncoherent.results[0].endpoint_epistemic_status, 'DIRECT_ENDPOINT_WITNESS');
assert.ok(
  directVsIncoherent.results[0].interest > directVsIncoherent.results[1].interest,
  'Direct endpoint witness must cleanly outrank incoherent 3-hop chain',
);

// 3) Single-event LXX + lexical root chain (H1285->H7911 (Deut 4:23)->G20433->G1953)
const singleEventLxxLex = {
  anchor_id: 'lemma:H1285',
  target_id: 'lemma:G1953',
  steps: [
    edge('h1285-h7911', 'gram_object_of', 0.91, 'TEXTUAL', {
      from_id: 'lemma:H1285',
      to_id: 'lemma:H7911',
      direction: 'forward',
      attestation_groups: ['gram:DEU 4:23|c1'],
      passage_ids: ['Deut 4:23'],
      feature_idf: 4.7,
      intermediate_degree: 85,
    }),
    edge('h7911-g20433', 'lxx_translation_bridge', 0.86, 'LINGUISTIC', {
      from_id: 'lemma:H7911',
      to_id: 'lemma:G20433',
      direction: 'forward',
      attestation_groups: ['lxx:catss:G20433<->H7911'],
      passage_ids: ['Deut 4:23'],
      feature_idf: 5.1,
      intermediate_degree: 12,
    }),
    edge('g20433-g1953', 'lex_shares_root', 0.88, 'LINGUISTIC', {
      from_id: 'lemma:G20433',
      to_id: 'lemma:G1953',
      direction: 'symmetric',
      attestation_groups: ['lex:step:shares_root:G1953<->G20433'],
      passage_ids: [],
      feature_idf: 5.4,
      intermediate_degree: 5,
    }),
  ],
};

const singleEventScored = scorePath(singleEventLxxLex);
assert.ok(singleEventScored.K >= 0.75, `Expected single-event LXX+lex K >= 0.75, got ${singleEventScored.K}`);
assert.equal(singleEventScored.endpoint_epistemic_status, 'COHERENT_MULTIHOP_LEAD');

const singleEventRanked = rankDiscoveryDestinations([singleEventLxxLex, n001Chain]);
assert.equal(singleEventRanked.results.length, 1);
assert.equal(singleEventRanked.results[0].target_id, 'lemma:G1953');
assert.equal(singleEventRanked.pruned_incoherent_count, 1);

// 4) Unwitnessed LXX bridge between disjoint grammatical hops (N002-style) + proper-entity vs generic hub + ref normalization
const n002Chain = {
  anchor_id: 'lemma:H5869',
  target_id: 'lemma:G0032',
  steps: [
    edge('n002-1', 'gram_subject_of', 0.88, 'TEXTUAL', {
      passage_ids: ['Deut 13:8'],
      intermediate_degree: 24,
    }),
    edge('n002-lxx', 'lxx_translation_bridge', 0.84, 'LINGUISTIC', {
      passage_ids: [],
      intermediate_degree: 10,
    }),
    edge('n002-2', 'gram_object_of', 0.9, 'TEXTUAL', {
      passage_ids: ['2 Pet 2:4'],
      intermediate_degree: 175,
    }),
  ],
};
const n002Scored = scorePath(n002Chain);
assert.ok(n002Scored.K < 0.25, `Expected unwitnessed LXX disjoint chain K < 0.25, got ${n002Scored.K}`);

const normalizedSameVerse = scorePath({
  anchor_id: 'lemma:A',
  target_id: 'lemma:B',
  steps: [
    edge('sv-1', 'gram_subject_of', 0.9, 'TEXTUAL', {
      direction: 'forward',
      passage_ids: ['GEN 16:15'],
      intermediate_degree: 40,
      proper_entity: true,
    }),
    edge('sv-2', 'gram_object_of', 0.9, 'TEXTUAL', {
      direction: 'reverse',
      passage_ids: ['Genesis 16:15'],
      intermediate_degree: 5,
    }),
  ],
});
assert.equal(normalizedSameVerse.K, 1.0, 'Canonicalized identical verse refs must score K = 1.0 without role-flip or hub penalty');

const properVsNonProper = {
  proper: scorePath({
    anchor_id: 'lemma:A',
    target_id: 'lemma:B',
    steps: [
      edge('p-1', 'gram_subject_of', 0.9, 'TEXTUAL', {
        passage_ids: ['Gen 16:15'],
        intermediate_degree: 60,
        proper_entity: true,
      }),
      edge('p-2', 'gram_object_of', 0.9, 'TEXTUAL', {
        passage_ids: ['Deut 14:15'],
      }),
    ],
  }),
  nonProper: scorePath({
    anchor_id: 'lemma:A',
    target_id: 'lemma:B',
    steps: [
      edge('np-1', 'gram_subject_of', 0.9, 'TEXTUAL', {
        passage_ids: ['Gen 16:15'],
        intermediate_degree: 60,
        proper_entity: false,
      }),
      edge('np-2', 'gram_object_of', 0.9, 'TEXTUAL', {
        passage_ids: ['Deut 14:15'],
      }),
    ],
  }),
};
assert.ok(properVsNonProper.proper.K > properVsNonProper.nonProper.K, 'proper_entity intermediate must avoid generic hub penalty');

console.log('proof-ranker: all assertions passed');
