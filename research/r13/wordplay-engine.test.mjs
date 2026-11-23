import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCorpusWordplayIndex,
  compareOriginalForms,
  normalizeOriginalForm,
} from '../../src/relationships/wordplay-engine.ts';

test('Algorithm A: consonantal, no-matres, and phonetic normalization works across Hebrew and Greek', () => {
  const shaqed = normalizeOriginalForm('שָׁקֵד', 'H8247');
  const shaqad = normalizeOriginalForm('שָׁקַד', 'H8245');
  assert.equal(shaqed.consonantal, 'שקד');
  assert.equal(shaqad.consonantal, 'שקד');
  const pair1 = compareOriginalForms(shaqed, shaqad);
  assert.equal(pair1.overlap_kind, 'consonantal_exact');

  const qayits = normalizeOriginalForm('קַיִץ', 'H7019');
  const qets = normalizeOriginalForm('קֵץ', 'H7093');
  const pair2 = compareOriginalForms(qayits, qets);
  assert.equal(pair2.overlap_kind, 'consonantal_exact');

  const adam = normalizeOriginalForm('אָדָם', 'H0120');
  const dam = normalizeOriginalForm('דָּם', 'H1818');
  const pair3 = compareOriginalForms(adam, dam);
  assert.equal(pair3.comparable, true);
  assert.equal(pair3.shared_consonants, 'דמ');

  const petros = normalizeOriginalForm('Πέτρος', 'G4074');
  const petra = normalizeOriginalForm('πέτρα', 'G4073');
  const pair4 = compareOriginalForms(petros, petra);
  assert.equal(pair4.comparable, true);
  assert.ok(pair4.shared_consonants.startsWith('πετρ'));
});

test('Algorithm A: corpus indexer discovers Jer 1:11-12, Gen 2:7/9:6, Gen 6:14, Amos 8:1-2 without hardcoding', () => {
  const profiles = [
    { bs: 'H8247', script: 'שָׁקֵד', total_verses: 4, all_vids: [2244, 18978] },
    { bs: 'H8245', script: 'שָׁקַד', total_verses: 11, all_vids: [18979] },
    { bs: 'H8246', script: 'שָׁקַד', total_verses: 4, all_vids: [2244] },
    { bs: 'H0120', script: 'אָדָם', total_verses: 500, all_vids: [38, 222] },
    { bs: 'H0127', script: 'אֲדָמָה', total_verses: 200, all_vids: [38] },
    { bs: 'H1818', script: 'דָּם', total_verses: 320, all_vids: [222] },
    { bs: 'H3722', script: 'כָּפַר', total_verses: 90, all_vids: [152] },
    { bs: 'H3724', script: 'כֹּפֶר', total_verses: 15, all_vids: [152] },
    { bs: 'H7019', script: 'קַיִץ', total_verses: 18, all_vids: [22481] },
    { bs: 'H7093', script: 'קֵץ', total_verses: 60, all_vids: [22482] },
    { bs: 'H5288', script: 'נַעַר', total_verses: 220, all_vids: [5000] },
  ];

  const verseLookup = new Map([
    [38, { verse_id: 38, book: 1, strongsList: ['H0430', 'H0120', 'H4480', 'H0127'], englishText: 'formed man from the ground' }],
    [152, { verse_id: 152, book: 1, strongsList: ['H3722', 'H3724'], englishText: 'pitch it with pitch' }],
    [222, { verse_id: 222, book: 1, strongsList: ['H1818', 'H0120', 'H3588'], englishText: 'man blood because in the image' }],
    [18978, { verse_id: 18978, book: 24, strongsList: ['H4100', 'H7200', 'H8247'], englishText: 'What do you see? I see an almond branch.' }],
    [18979, { verse_id: 18979, book: 24, strongsList: ['H3190', 'H7200', 'H3588', 'H8245'], englishText: 'You have seen well, for I am watching.' }],
    [22481, { verse_id: 22481, book: 30, strongsList: ['H4100', 'H7200', 'H7019'], englishText: 'What do you see? A basket of summer fruit.' }],
    [22482, { verse_id: 22482, book: 30, strongsList: ['H3588', 'H7093'], englishText: 'The end has come.' }],
  ]);

  const idx = buildCorpusWordplayIndex(profiles, verseLookup);

  const almondEdges = idx.get('H8247') || [];
  const toWatch = almondEdges.find(e => e.target_bs === 'H8245');
  assert.ok(toWatch, 'H8247 discovers H8245');
  assert.equal(toWatch.evidence_type, 'attested_textual_wordplay');
  assert.equal(toWatch.proven_common_root, false, 'Does not invent root without STEP link');

  const adamEdges = idx.get('H0120') || [];
  assert.ok(adamEdges.some(e => e.target_bs === 'H0127' && e.evidence_type === 'attested_textual_wordplay'), 'H0120 discovers H0127');
  assert.ok(adamEdges.some(e => e.target_bs === 'H1818'), 'H0120 discovers H1818');

  const kprEdges = idx.get('H3722') || [];
  assert.ok(kprEdges.some(e => e.target_bs === 'H3724' && e.evidence_type === 'attested_textual_wordplay'), 'H3722 discovers H3724');

  const fruitEdges = idx.get('H7019') || [];
  assert.ok(fruitEdges.some(e => e.target_bs === 'H7093' && e.evidence_type === 'attested_textual_wordplay'), 'Unseen Amos 8:1-2 pair discovered');

  const noise = almondEdges.find(e => e.target_bs === 'H5288');
  assert.equal(noise, undefined, 'Does not link unrelated consonants');
});
