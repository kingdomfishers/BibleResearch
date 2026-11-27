// @file: research/literary/benchmark.mjs
// Deterministic benchmark across Development, Held-out Evaluation, and Negative Control passages
// using local corpus shards in .artifacts-r12/staging-bundle/.

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeLiteraryPassage } from '../../src/relationships/literary-engine.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE = path.join(ROOT, '.artifacts-r12/staging-bundle');

const chapterCache = new Map();
function loadChapter(book, chapter) {
  const k = `${book}:${chapter}`;
  if (!chapterCache.has(k)) {
    const file = path.join(BUNDLE, `v1/chapters/b${book}-c${chapter}.json.gz`);
    chapterCache.set(k, JSON.parse(zlib.gunzipSync(fs.readFileSync(file))));
  }
  return chapterCache.get(k);
}

function loadLxx(bookNo) {
  const file = path.join(BUNDLE, `v1/lxx/b${bookNo}.json.gz`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file))).words ?? [];
}

function loadVerses(ranges) {
  const out = [];
  for (const [book, chapter, startV, endV] of ranges) {
    const ch = loadChapter(book, chapter);
    const list = Object.values(ch.verses)
      .filter(v => v.verse_nr >= startV && v.verse_nr <= endV)
      .sort((a, b) => a.verse_nr - b.verse_nr);
    out.push(...list);
  }
  return out;
}

const concepts = JSON.parse(
  zlib.gunzipSync(fs.readFileSync(path.join(BUNDLE, 'v2/relationships/r11-v1.0/r10/concept-index.json.gz')))
);
const r13 = { conceptAliases: concepts.aliases };

const CASES = [
  // === DEVELOPMENT SET ===
  {
    split: 'dev',
    name: 'Genesis 1:1-2:3',
    ranges: [[1, 1, 1, 31], [1, 2, 1, 3]],
    compareLxx: true,
    expectations: [
      { label: 'intro_gen1_1_2', fn: r => r.segmentation?.introduction?.fromRef === 'Genesis 1:1' && r.segmentation?.introduction?.toRef === 'Genesis 1:2' },
      { label: 'six_creation_units', fn: r => r.segmentation?.units.length === 6 && r.segmentation.units[0].fromRef === 'Genesis 1:3' },
      { label: 'sabbath_conclusion', fn: r => r.segmentation?.conclusion?.fromRef === 'Genesis 2:1' && r.segmentation?.conclusion?.toRef === 'Genesis 2:3' },
      { label: 'day2_omission_eval', fn: r => r.deviations.some(d => d.kind === 'omission' && d.unitIndex === 1 && String(d.expected).includes('evaluation')) },
      { label: 'day3_or_6_addition_eval', fn: r => r.deviations.some(d => d.kind === 'addition' && (d.unitIndex === 2 || d.unitIndex === 5)) },
      { label: 'day6_intensification_1_31', fn: r => r.deviations.some(d => d.kind === 'intensification' && d.ref === 'Genesis 1:31') },
      { label: 'day6_person_shift_1_26', fn: r => r.deviations.some(d => d.kind === 'person_shift' && d.ref === 'Genesis 1:26' && d.observed === '1cp') },
      { label: 'blessing_emerging_motif', fn: r => r.deviations.some(d => d.kind === 'emerging_motif' && String(d.observed).includes('H1288')) },
      { label: 'day1_4_and_2_5_and_3_6_correspondence', fn: r => {
        const pairs = new Set(r.correspondences.map(c => `${c.unitA}-${c.unitB}`));
        return pairs.has('0-3') && pairs.has('1-4') && pairs.has('2-5');
      }},
      { label: 'command_fulfillment_links', fn: r => r.commandFulfillments.length >= 4 },
      { label: 'lxx_gen1_8_divergence', fn: r => r.lxxComparison?.divergences.some(d => d.kind === 'lxx_formula_addition' && d.mtRef === 'Genesis 1:8') },
    ],
  },
  {
    split: 'dev',
    name: 'Psalm 136:1-12',
    ranges: [[19, 136, 1, 12]],
    expectations: [
      { label: '12_refrain_units', fn: r => r.segmentation?.units.length === 12 },
    ],
  },
  {
    split: 'dev',
    name: 'Amos 4:6-11',
    ranges: [[30, 4, 6, 11]],
    expectations: [
      { label: '5_judgment_units', fn: r => r.segmentation?.units.length === 5 },
    ],
  },
  {
    split: 'dev',
    name: 'Genesis 9:6',
    ranges: [[1, 9, 6, 6]],
    expectations: [
      { label: 'chiasm_3_pairs', fn: r => r.symmetries.some(s => (s.kind === 'chiasm' || s.kind === 'concentric') && s.pairs.length >= 3) },
      { label: 'wordplay_adam_dam', fn: r => r.wordplays.some(w => [w.wordA.strongs, w.wordB.strongs].includes('H120') && [w.wordA.strongs, w.wordB.strongs].includes('H1818')) },
    ],
  },
  {
    split: 'dev',
    name: 'Jeremiah 1:11-12',
    ranges: [[24, 1, 11, 12]],
    expectations: [
      { label: 'wordplay_shaqed_shoqed', fn: r => r.wordplays.some(w => [w.wordA.strongs, w.wordB.strongs].includes('H8247') && [w.wordA.strongs, w.wordB.strongs].includes('H8245')) },
    ],
  },
  {
    split: 'dev',
    name: 'Genesis 2:7',
    ranges: [[1, 2, 7, 7]],
    expectations: [
      { label: 'wordplay_adam_adamah', fn: r => r.wordplays.some(w => [w.wordA.strongs, w.wordB.strongs].includes('H120') && [w.wordA.strongs, w.wordB.strongs].includes('H127')) },
    ],
  },
  {
    split: 'dev',
    name: 'Psalm 119:1-24',
    ranges: [[19, 119, 1, 24]],
    expectations: [
      { label: 'stanza8_acrostic', fn: r => r.acrostics.some(a => a.mode === 'multi_verse_stanza' && a.stanzaSize === 8 && a.lettersCovered >= 3) },
    ],
  },
  {
    split: 'dev',
    name: 'Matthew 5:3-12',
    ranges: [[40, 5, 3, 12]],
    expectations: [
      { label: 'beatitudes_units', fn: r => (r.segmentation?.units.length ?? 0) >= 8 },
      { label: 'person_shift_2p_at_v11', fn: r => r.speakerShifts.some(s => s.ref === 'Matthew 5:11' && s.nextPerson.startsWith('2')) || r.deviations.some(d => d.kind === 'person_shift') },
      { label: 'keyword_makarios', fn: r => r.keyWords.some(k => k.strongs === 'G3107' && k.count >= 9) },
    ],
  },

  // === HELD-OUT EVALUATION SET ===
  {
    split: 'heldout',
    name: 'Genesis 11:1-9',
    ranges: [[1, 11, 1, 9]],
    expectations: [
      { label: 'pericope_chiasm_or_inclusio', fn: r => r.symmetries.some(s => s.level === 'unit' && (s.kind === 'chiasm' || s.kind === 'concentric' || s.kind === 'inclusio')) },
      { label: 'babel_wordplay_balal', fn: r => r.wordplays.some(w => [w.wordA.strongs, w.wordB.strongs].includes('H894') || [w.wordA.strongs, w.wordB.strongs].includes('H1101')) },
      { label: 'leitwort_earth_or_lip', fn: r => r.keyWords.some(k => k.strongs === 'H776' || k.strongs === 'H8193') },
    ],
  },
  {
    split: 'heldout',
    name: 'Psalm 111:1-10',
    ranges: [[19, 111, 1, 10]],
    expectations: [
      { label: 'half_verse_acrostic', fn: r => r.acrostics.some(a => a.mode === 'half_verse_atnach' && a.lettersCovered >= 18) },
    ],
  },
  {
    split: 'heldout',
    name: 'Proverbs 31:10-31',
    ranges: [[20, 31, 10, 31]],
    expectations: [
      { label: 'verse_initial_acrostic_22', fn: r => r.acrostics.some(a => a.mode === 'verse_initial' && a.lettersCovered >= 20) },
    ],
  },
  {
    split: 'heldout',
    name: 'Isaiah 6:10',
    ranges: [[23, 6, 10, 10]],
    expectations: [
      { label: 'chiasm_heart_ears_eyes', fn: r => r.symmetries.some(s => (s.kind === 'chiasm' || s.kind === 'concentric') && s.pairs.length >= 3) },
    ],
  },
  {
    split: 'heldout',
    name: 'Amos 1:3-2:6',
    ranges: [[30, 1, 3, 15], [30, 2, 1, 6]],
    expectations: [
      { label: 'oracles_recurring_units', fn: r => (r.segmentation?.units.length ?? 0) >= 6 },
      { label: 'numerical_three_four_formula', fn: r => r.keyWords.some(k => k.strongs === 'H7969' && k.count >= 7) },
    ],
  },
  {
    split: 'heldout',
    name: 'Psalm 23:1-6',
    ranges: [[19, 23, 1, 6]],
    expectations: [
      { label: 'person_shift_3p_to_2p', fn: r => r.speakerShifts.some(s => s.ref === 'Psalm 23:4' || s.ref === 'Psalms 23:4') },
    ],
  },
  {
    split: 'heldout',
    name: 'John 1:1-18',
    ranges: [[43, 1, 1, 18]],
    expectations: [
      { label: 'staircase_parallelism', fn: r => r.symmetries.some(s => s.kind === 'progressive_parallelism') },
      { label: 'leitwort_logos_light_life', fn: r => r.keyWords.some(k => k.strongs === 'G3056' || k.strongs === 'G5457') },
    ],
  },
  {
    split: 'heldout',
    name: '1 Corinthians 13:1-13',
    ranges: [[46, 13, 1, 13]],
    expectations: [
      { label: 'leitwort_agape', fn: r => r.keyWords.some(k => k.strongs === 'G26' && k.count >= 8) },
      { label: 'antithetical_or_template', fn: r => r.symmetries.some(s => s.kind === 'antithetical_parallelism') || (r.segmentation?.units.length ?? 0) >= 3 },
    ],
  },
  {
    split: 'heldout',
    name: 'Psalm 1:1-6',
    ranges: [[19, 1, 1, 6]],
    expectations: [
      { label: 'antithetical_or_inclusio', fn: r => r.symmetries.some(s => s.kind === 'inclusio' || s.kind === 'antithetical_parallelism') },
    ],
  },
  {
    split: 'heldout',
    name: 'Revelation 2:1-3:22',
    ranges: [[66, 2, 1, 29], [66, 3, 1, 22]],
    expectations: [
      { label: 'seven_exact_churches', fn: r => r.segmentation?.units.length === 7 && r.segmentation.units[0].fromRef === 'Revelation 2:1' && r.segmentation.units[6].toRef === 'Revelation 3:22' },
      { label: 'repent_omissions_u1_u5', fn: r => r.deviations.some(d => d.kind === 'omission' && d.unitIndex === 1 && d.expected === 'G3340') && r.deviations.some(d => d.kind === 'omission' && d.unitIndex === 5 && d.expected === 'G3340') },
      { label: 'hearing_overcomer_swap', fn: r => r.deviations.some(d => d.kind === 'reordering' && String(d.expected).includes('G3528') && String(d.expected).includes('G3775')) },
    ],
  },
  {
    split: 'heldout',
    name: 'Revelation 16:1-21',
    ranges: [[66, 16, 1, 21]],
    expectations: [
      { label: 'seven_bowls_full_tail', fn: r => r.segmentation?.introduction?.fromRef === 'Revelation 16:1' && r.segmentation?.units.length === 7 && r.segmentation.units[6].toRef === 'Revelation 16:21' },
    ],
  },
  {
    split: 'heldout',
    name: 'Deuteronomy 27:15-26',
    ranges: [[5, 27, 15, 26]],
    expectations: [
      { label: 'twelve_exact_curses', fn: r => r.segmentation?.units.length === 12 && r.segmentation.units[0].fromRef === 'Deuteronomy 27:15' && r.segmentation.units[11].toRef === 'Deuteronomy 27:26' },
    ],
  },
  {
    split: 'heldout',
    name: 'Psalm 42:1-43:5',
    ranges: [[19, 42, 1, 11], [19, 43, 1, 5]],
    expectations: [
      { label: 'three_refrain_stanzas', fn: r => r.segmentation?.units.length === 3 && r.segmentation.units[0].toRef === 'Psalms 42:5' && r.segmentation.units[2].toRef === 'Psalms 43:5' },
    ],
  },
  {
    split: 'heldout',
    name: 'Numbers 7:12-35',
    ranges: [[4, 7, 12, 35]],
    expectations: [
      { label: 'four_exact_tribal_days', fn: r => r.segmentation?.units.length === 4 && r.segmentation.units[0].toRef === 'Numbers 7:17' && r.segmentation.units[3].toRef === 'Numbers 7:35' },
    ],
  },
  {
    split: 'heldout',
    name: 'Isaiah 5:8-23',
    ranges: [[23, 5, 8, 23]],
    expectations: [
      { label: 'six_woes', fn: r => r.segmentation?.units.length === 6 && r.segmentation.units[0].fromRef === 'Isaiah 5:8' && r.segmentation.units[5].toRef === 'Isaiah 5:23' },
    ],
  },
  {
    split: 'heldout',
    name: 'Matthew 23:13-33',
    ranges: [[40, 23, 13, 33]],
    expectations: [
      { label: 'seven_woes_full_end', fn: r => r.segmentation?.units.length === 7 && r.segmentation.units[6].toRef === 'Matthew 23:33' },
    ],
  },
  {
    split: 'heldout',
    name: 'Genesis 5:1-32',
    ranges: [[1, 5, 1, 32]],
    expectations: [
      { label: 'nine_patriarchs_enoch_isolated', fn: r => r.segmentation?.units.length === 9 && r.segmentation.units[6].toRef === 'Genesis 5:24' && r.segmentation?.conclusion?.fromRef === 'Genesis 5:32' },
      { label: 'enoch_missing_death_formula', fn: r => r.deviations.some(d => d.kind === 'omission' && d.unitIndex === 6 && d.expected === 'H4191') },
      { label: 'no_false_unit_chiasm', fn: r => r.symmetries.filter(s => s.level === 'unit').length === 0 },
    ],
  },
  {
    split: 'heldout',
    name: 'Psalm 107:4-32',
    ranges: [[19, 107, 4, 32]],
    expectations: [
      { label: 'four_complete_cycles', fn: r => r.segmentation?.units.length === 4 && r.segmentation.units[0].fromRef === 'Psalms 107:4' && r.segmentation.units[3].toRef === 'Psalms 107:32' },
    ],
  },
  {
    split: 'heldout',
    name: 'Matthew 5:21-48',
    ranges: [[40, 5, 21, 48]],
    expectations: [
      { label: 'six_antitheses', fn: r => r.segmentation?.units.length === 6 && r.segmentation.units[2].fromRef === 'Matthew 5:31' && r.segmentation.units[2].toRef === 'Matthew 5:32' },
      { label: 'unit3_omits_heard', fn: r => r.deviations.some(d => d.kind === 'omission' && d.unitIndex === 2 && d.expected === 'G191') },
    ],
  },
  {
    split: 'heldout',
    name: 'Isaiah 55:1-13',
    ranges: [[23, 55, 1, 13]],
    expectations: [
      { label: 'analogical_comparison_detected', fn: r => r.thematicClusters.some(c => c.themeLabel.startsWith('Analogical comparison')) },
    ],
  },
  {
    split: 'heldout',
    name: 'Ecclesiastes 3:1-8',
    ranges: [[21, 3, 1, 8]],
    expectations: [
      { label: 'temporal_series_and_opposites', fn: r => (r.segmentation?.units.length ?? 0) >= 7 && r.thematicClusters.some(c => c.themeLabel.startsWith('Paired opposing series')) },
    ],
  },
  {
    split: 'heldout',
    name: 'Amos 8:1-2',
    ranges: [[30, 8, 1, 2]],
    expectations: [
      { label: 'attested_qayits_qets_wordplay', fn: r => r.wordplays.length > 0 && r.wordplays[0].epistemicClass === 'attested_textual_wordplay' && [r.wordplays[0].wordA.strongs, r.wordplays[0].wordB.strongs].includes('H7019') },
    ],
  },
  {
    split: 'heldout',
    name: 'Micah 1:10-15',
    ranges: [[33, 1, 10, 15]],
    expectations: [
      { label: 'geographical_paronomasia', fn: r => r.wordplays.some(w => w.epistemicClass === 'attested_textual_wordplay' && [w.wordA.strongs, w.wordB.strongs].includes('H392')) },
    ],
  },
  {
    split: 'heldout',
    name: 'Mark 2:27',
    ranges: [[41, 2, 27, 27]],
    expectations: [
      { label: 'reversed_sabbath_chiasm', fn: r => r.symmetries.some(s => (s.kind === 'chiasm' || s.kind === 'concentric') && s.pairs.length >= 2) },
    ],
  },
  {
    split: 'heldout',
    name: 'Lamentations 1:1-22',
    ranges: [[25, 1, 1, 22]],
    expectations: [
      { label: 'acrostic_22', fn: r => r.acrostics.some(a => a.mode === 'verse_initial' && a.lettersCovered === 22) },
    ],
  },
  {
    split: 'heldout',
    name: 'Psalm 19:1-14',
    ranges: [[19, 19, 1, 14]],
    expectations: [
      { label: 'torah_synonym_cluster_and_shifts', fn: r => r.thematicClusters.length >= 1 && r.speakerShifts.length >= 1 },
    ],
  },
  {
    split: 'heldout',
    name: 'Romans 8:31-39',
    ranges: [[45, 8, 31, 39]],
    expectations: [
      { label: 'rhetorical_themes_detected', fn: r => r.keyWords.length >= 1 || r.thematicClusters.length >= 1 },
    ],
  },

  // === NEGATIVE CONTROLS ===
  {
    split: 'negative',
    name: 'Genesis 5:1-20',
    ranges: [[1, 5, 1, 20]],
    expectations: [
      { label: 'no_spurious_token_chiasms', fn: r => r.symmetries.filter(s => s.kind === 'chiasm' && s.level === 'token').length === 0 },
      { label: 'genealogy_units_found', fn: r => (r.segmentation?.units.length ?? 0) >= 4 },
    ],
  },
  {
    split: 'negative',
    name: 'Numbers 33:1-15',
    ranges: [[4, 33, 1, 15]],
    expectations: [
      { label: 'no_spurious_chiasms', fn: r => r.symmetries.filter(s => s.kind === 'chiasm' || s.kind === 'concentric').length <= 1 },
      { label: 'itinerary_units_found', fn: r => (r.segmentation?.units.length ?? 0) >= 6 },
    ],
  },
  {
    split: 'negative',
    name: 'Romans 16:3-15',
    ranges: [[45, 16, 3, 15]],
    expectations: [
      { label: 'no_spurious_chiasms', fn: r => r.symmetries.filter(s => s.kind === 'chiasm' || s.kind === 'concentric').length === 0 },
      { label: 'low_false_deviations', fn: r => r.deviations.length <= 2 },
    ],
  },
];

const report = [];
for (const c of CASES) {
  const verses = loadVerses(c.ranges);
  const lxxWords = c.compareLxx ? loadLxx(c.ranges[0][0]) : undefined;
  const t0 = performance.now();
  const res = analyzeLiteraryPassage(
    { passage: c.name, verses, lxxWords, r13 },
    { compareLxx: Boolean(c.compareLxx), includeAlternatives: true }
  );
  const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;
  const checks = c.expectations.map(e => ({ label: e.label, pass: Boolean(e.fn(res)) }));
  report.push({
    split: c.split,
    name: c.name,
    elapsedMs,
    tokens: res.tokenCount,
    units: res.segmentation?.units.length ?? 0,
    deviations: res.deviations.length,
    symmetries: res.symmetries.length,
    wordplays: res.wordplays.length,
    acrostics: res.acrostics.length,
    checks,
  });
}

for (const split of ['dev', 'heldout', 'negative']) {
  const rows = report.filter(r => r.split === split);
  const total = rows.reduce((s, r) => s + r.checks.length, 0);
  const passed = rows.reduce((s, r) => s + r.checks.filter(x => x.pass).length, 0);
  console.log(`\n=== ${split.toUpperCase()} (${passed}/${total}) ===`);
  for (const r of rows) {
    const fails = r.checks.filter(x => !x.pass).map(x => x.label);
    console.log(
      `[${fails.length === 0 ? 'PASS' : 'MISS'}] ${r.name} (${r.elapsedMs}ms, ${r.tokens} tok, units=${r.units}, dev=${r.deviations}, sym=${r.symmetries}, wp=${r.wordplays}, acr=${r.acrostics})` +
        (fails.length ? ` -> missed: ${fails.join(', ')}` : '')
    );
  }
}
const allTimes = report.map(r => r.elapsedMs).sort((a, b) => a - b);
console.log(`\nMedian runtime: ${allTimes[Math.floor(allTimes.length / 2)]}ms, Max runtime: ${allTimes[allTimes.length - 1]}ms`);
