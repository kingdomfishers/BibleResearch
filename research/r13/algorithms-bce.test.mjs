import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beamSearchMotifPaths,
  computeHighPmiCollocations,
  mineMultiPassageMotifs,
} from '../../src/relationships/motif-discovery.ts';
import {
  assembleSymbolicChains,
  compareStructuredRoleFrames,
  extractScripturalInterpretations,
} from '../../src/relationships/symbolic-patterns.ts';
import {
  scoreCrossTestamentPair,
  synthesizeEvidencePatterns,
} from '../../src/relationships/evidence-synthesis.ts';

test('Algorithm B: computes high-PMI collocations and mines Adam-Ground-Blood triangle across multiple passages', () => {
  const profiles = [
    { bs: 'H0120', total_verses: 10, all_vids: [38, 80, 222, 223, 500, 501, 502, 503, 504, 505] },
    { bs: 'H0127', total_verses: 8, all_vids: [38, 80, 91, 92, 600, 601, 602, 603] },
    { bs: 'H1818', total_verses: 9, all_vids: [91, 92, 222, 223, 3100, 3101, 3102, 3103, 3104] },
    { bs: 'H5315', total_verses: 8, all_vids: [38, 3100, 3101, 3102, 3103, 700, 701, 702] },
  ];
  const vidToChapter = new Map([
    [38, '1:2'], [80, '1:3'], [91, '1:4'], [92, '1:4'],
    [222, '1:9'], [223, '1:9'], [3100, '3:17'], [3101, '3:17'], [3102, '3:17'], [3103, '3:17'],
  ]);

  const collocs = computeHighPmiCollocations(profiles, 31203, { maxPerLemma: 10 });
  const bloodCollocs = collocs.get('H1818') || [];
  assert.ok(bloodCollocs.some(c => c.target_bs === 'H5315' && c.shared_count === 4), 'H1818 collocates strongly with H5315');

  const wordplayMap = new Map([
    ['H0120', [
      {
        source_bs: 'H0120', target_bs: 'H0127', source_script: 'אָדָם', target_script: 'אֲדָמָה',
        evidence_type: 'attested_textual_wordplay', overlap_kind: 'prefix_suffix_overlap',
        epistemic_class: 'direct_textual_evidence', proven_common_root: false,
        shared_consonants: 'אדמ', source_consonants: 'אדמ', target_consonants: 'אדמה',
        edit_distance: 1, phonetic_distance: 1, idf_overlap: 4, proximity_same_verse: 2,
        proximity_adjacent_verse: 0, has_explicit_cue: true, cue_kinds: ['explanatory_clause_cue'],
        witness_vids: [38, 80], score: 0.9, etymology_disclaimer: 'test',
      },
      {
        source_bs: 'H0120', target_bs: 'H1818', source_script: 'אָדָם', target_script: 'דָּם',
        evidence_type: 'proximate_wordplay_candidate', overlap_kind: 'shared_consonantal_substring',
        epistemic_class: 'candidate_literary_pattern', proven_common_root: false,
        shared_consonants: 'דמ', source_consonants: 'אדמ', target_consonants: 'דמ',
        edit_distance: 1, phonetic_distance: 1, idf_overlap: 3, proximity_same_verse: 2,
        proximity_adjacent_verse: 0, has_explicit_cue: false, cue_kinds: [],
        witness_vids: [222, 223], score: 0.78, etymology_disclaimer: 'test',
      },
    ]],
  ]);

  const mined = mineMultiPassageMotifs({
    profiles,
    collocMap: collocs,
    wordplayMap,
    vidToChapter,
  });

  const tri = mined.motifs.find(m =>
    m.nodes.includes('H0120') && m.nodes.includes('H0127') && m.nodes.includes('H1818'),
  );
  assert.ok(tri, 'Mined Adam-Ground-Blood multi-passage motif');
  assert.ok(tri.independent_chapters >= 3);
  assert.ok(tri.distinct_edge_types >= 2);

  // Runtime beam search reaches H5315 from H0120 via H1818
  const profByBs = new Map([
    ['H0120', { bs: 'H0120', r13_colloc: [['H1818', 2, 45, [222, 223]]] }],
    ['H1818', { bs: 'H1818', r13_colloc: [['H5315', 4, 68, [3100, 3101]]] }],
    ['H5315', { bs: 'H5315', r13_colloc: [] }],
  ]);
  const paths = beamSearchMotifPaths({
    startBs: 'H0120',
    targetBs: new Set(['H5315']),
    profilesByBs: profByBs,
    maxHops: 2,
  });
  assert.ok(paths.some(p => p.reached_target && p.nodes.join('->') === 'H0120->H1818->H5315'));
});

test('Algorithm C: extracts Rev 4:5, Rev 5:6, Rev 1:20 self-interpretations without conflating referents', () => {
  const verses = [
    {
      verse_id: 30770, book: 66, chapter: 4, verse: 5, ref: 'Revelation 4:5',
      en: 'seven lamps of fire burning before the throne, which are the seven Spirits of God',
      toks: [
        { s: 'G2033', lm: 'ἑπτά', g: 'seven', cl: 'num' },
        { s: 'G2985', lm: 'λαμπάς', g: 'lamps', cl: 'noun' },
        { s: 'G4442', lm: 'πῦρ', g: 'fire', cl: 'noun' },
        { s: 'G3739', lm: 'ὅς', g: 'which', cl: 'rel' },
        { s: 'G1510', lm: 'εἰμί', g: 'are', cl: 'verb' },
        { s: 'G2033', lm: 'ἑπτά', g: 'seven', cl: 'num' },
        { s: 'G4151', lm: 'πνεῦμα', g: 'Spirits', cl: 'noun' },
        { s: 'G2316', lm: 'θεός', g: 'God', cl: 'noun' },
      ],
    },
    {
      verse_id: 30789, book: 66, chapter: 5, verse: 6, ref: 'Revelation 5:6',
      en: 'having seven horns and seven eyes, which are the seven Spirits of God',
      toks: [
        { s: 'G2768', lm: 'κέρας', g: 'horns', cl: 'noun' },
        { s: 'G2532', lm: 'καί', g: 'and', cl: 'conj' },
        { s: 'G3788', lm: 'ὀφθαλμός', g: 'eyes', cl: 'noun' },
        { s: 'G2033', lm: 'ἑπτά', g: 'seven', cl: 'num' },
        { s: 'G3739', lm: 'ὅς', g: 'which', cl: 'rel' },
        { s: 'G1510', lm: 'εἰμί', g: 'are', cl: 'verb' },
        { s: 'G4151', lm: 'πνεῦμα', g: 'Spirits', cl: 'noun' },
        { s: 'G2316', lm: 'θεός', g: 'God', cl: 'noun' },
      ],
    },
    {
      verse_id: 30719, book: 66, chapter: 1, verse: 20, ref: 'Revelation 1:20',
      en: 'the seven stars are the angels of the seven churches and the seven lampstands are seven churches',
      toks: [
        { s: 'G0792', lm: 'ἀστήρ', g: 'stars', cl: 'noun' },
        { s: 'G3739', lm: 'ὅς', g: 'which', cl: 'rel' },
        { s: 'G1510', lm: 'εἰμί', g: 'are', cl: 'verb' },
        { s: 'G0032', lm: 'ἄγγελος', g: 'angels', cl: 'noun' },
        { s: 'G2532', lm: 'καί', g: 'and', cl: 'conj' },
        { s: 'G3087', lm: 'λυχνία', g: 'lampstands', cl: 'noun' },
        { s: 'G3778', lm: 'οὗτος', g: 'these', cl: 'dem' },
        { s: 'G1510', lm: 'εἰμί', g: 'are', cl: 'verb' },
        { s: 'G1577', lm: 'ἐκκλησία', g: 'churches', cl: 'noun' },
      ],
    },
  ];
  const dfMap = new Map([['G2985', 9], ['G3788', 95], ['G3087', 12], ['G0792', 24]]);
  const recs = extractScripturalInterpretations(verses, dfMap);

  const rev45 = recs.find(r => r.verse_id === 30770);
  const rev56 = recs.find(r => r.verse_id === 30789);
  const rev120Lamps = recs.find(r => r.verse_id === 30719 && r.symbol_strongs.includes('G3087'));

  assert.ok(rev45 && rev45.symbol_strongs.includes('G2985') && rev45.referent_strongs.includes('G4151'));
  assert.ok(rev56 && rev56.symbol_strongs.includes('G3788') && !rev56.symbol_strongs.includes('G2768') && rev56.referent_strongs.includes('G4151'));
  assert.ok(rev120Lamps && rev120Lamps.referent_strongs.includes('G1577') && !rev120Lamps.referent_strongs.includes('G4151'));

  const chains = assembleSymbolicChains({
    seedStrongOrVid: 'H8247',
    wordplayTargets: [{ source_bs: 'H8247', target_bs: 'H8245', witness_refs: ['Jeremiah 1:11-12'], score: 0.95, detail: 'shaqed/shoqed' }],
    collocNeighborsByBs: new Map([
      ['H8247', [{ target_bs: 'H4501', shared_count: 3, npmi: 0.55, sample_refs: ['Exodus 25:33'] }]],
      ['H4501', [{ target_bs: 'H5216', shared_count: 6, npmi: 0.62, sample_refs: ['Zechariah 4:2'] }]],
    ]),
    lxxEquivalentsByBs: new Map([['H5216', ['G2985']], ['H4501', ['G3087']]]),
    selfInterpretations: recs,
  });
  assert.equal(chains.length, 1);
  assert.ok(chains[0].covered_refs.includes('Revelation 4:5'));
  assert.ok(chains[0].covered_refs.includes('Revelation 1:20'));

  const fa = compareStructuredRoleFrames(
    [{ pred: 'H5216', subj: ['H0430'], obj: ['H4501'], other: [] }],
    [{ pred: 'G2985', subj: ['G2316'], obj: ['G3087'], other: [] }],
    new Map([
      ['H5216', new Set(['G2985'])],
      ['H0430', new Set(['G2316'])],
      ['H4501', new Set(['G3087'])],
    ]),
  );
  assert.ok(fa.score >= 0.7 && fa.aligned_roles.length >= 2);
});

test('Algorithms D & E: scores cross-testament bipartite alignment and synthesizes explicit vs exploratory layers', () => {
  const ct = scoreCrossTestamentPair({
    sourceVid: 2242,
    targetVid: 30207,
    sourceRef: 'Exodus 25:31',
    targetRef: 'Hebrews 9:2',
    otTokens: [{ bs: 'H4501', script: 'מְנוֹרָה', gloss: 'lampstand', idf: 3.4 }],
    ntTokens: [{ bs: 'G3087', script: 'λυχνία', gloss: 'lampstand', idf: 3.9 }],
    lxxEquivMap: new Map([['H4501', [{ target_bs: 'G3087', count: 35 }]]]),
    isReciprocalXref: true,
  });
  assert.ok(ct && ct.kind === 'shared_rare_artifact_motif' && ct.bipartite_idf_sum > 3);

  const patterns = synthesizeEvidencePatterns({
    anchors: ['H0120', 'H1818'],
    edges: [
      {
        evidence_id: 'r13:wp:H0120:H0127',
        evidence_type: 'attested_textual_wordplay',
        epistemic_class: 'direct_textual_evidence',
        tier: 2,
        from_node: 'H0120',
        to_node: 'H0127',
        witness_refs: ['Genesis 2:7'],
        summary: 'adam / adamah in Genesis 2:7',
        score: 920,
      },
      {
        evidence_id: 'r13:colloc:H0127:H1818',
        evidence_type: 'collocation',
        epistemic_class: 'documented_collocation_or_cooccurrence',
        tier: 3,
        from_node: 'H0127',
        to_node: 'H1818',
        witness_refs: ['Genesis 4:10', 'Genesis 4:11'],
        summary: 'ground receives blood in Genesis 4:10-11',
        score: 840,
      },
      {
        evidence_id: 'r13:wp:H0120:H1818',
        evidence_type: 'shared_consonantal_pattern',
        epistemic_class: 'orthographic_similarity_only',
        tier: 5,
        from_node: 'H0120',
        to_node: 'H1818',
        witness_refs: ['Genesis 9:6'],
        summary: 'adam shares consonantal sequence dm with dam',
        score: 710,
      },
    ],
  });
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].explicit_vs_inferred.explicit_textual_facts.length, 1);
  assert.equal(patterns[0].explicit_vs_inferred.structural_correspondences.length, 1);
  assert.equal(patterns[0].explicit_vs_inferred.exploratory_hypotheses.length, 1);
  assert.ok(patterns[0].counterexamples_and_limits.length >= 1);
});
