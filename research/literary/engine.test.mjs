// @file: research/literary/engine.test.mjs
// Multi-edition unit & integration tests for literary-engine.ts against real local corpus shards.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeLiteraryPassage } from '../../src/relationships/literary-engine.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE = path.join(ROOT, '.artifacts-r12/staging-bundle');

function loadVerses(ranges) {
  const out = [];
  for (const [book, chapter, startV, endV] of ranges) {
    const ch = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(BUNDLE, `v1/chapters/b${book}-c${chapter}.json.gz`))));
    const list = Object.values(ch.verses)
      .filter(v => v.verse_nr >= startV && v.verse_nr <= endV)
      .sort((a, b) => a.verse_nr - b.verse_nr);
    out.push(...list);
  }
  return out;
}

function loadLxx(bookNo) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(BUNDLE, `v1/lxx/b${bookNo}.json.gz`)))).words ?? [];
}

test('Genesis 1:1-2:3 discovers intro, 6 days, Sabbath transformation, deviations, correspondences, and LXX Gen 1:8', () => {
  const verses = loadVerses([[1, 1, 1, 31], [1, 2, 1, 3]]);
  const lxxWords = loadLxx(1).filter(w => w.chapter <= 2);
  const res = analyzeLiteraryPassage(
    { passage: 'Genesis 1:1-2:3', verses, lxxWords },
    { compareLxx: true, includeAlternatives: true }
  );

  assert.equal(res.edition, 'hbo');
  assert.equal(res.segmentation?.introduction?.fromRef, 'Genesis 1:1');
  assert.equal(res.segmentation?.introduction?.toRef, 'Genesis 1:2');
  assert.equal(res.segmentation?.units.length, 6);
  assert.equal(res.segmentation?.units[0].fromRef, 'Genesis 1:3');
  assert.equal(res.segmentation?.conclusion?.fromRef, 'Genesis 2:1');
  assert.equal(res.segmentation?.conclusion?.toRef, 'Genesis 2:3');

  assert.ok(res.deviations.some(d => d.kind === 'omission' && d.unitIndex === 1 && String(d.expected).includes('evaluation')));
  assert.ok(res.deviations.some(d => d.kind === 'addition' && (d.unitIndex === 2 || d.unitIndex === 5)));
  assert.ok(res.deviations.some(d => d.kind === 'intensification' && d.ref === 'Genesis 1:31'));
  assert.ok(res.deviations.some(d => d.kind === 'person_shift' && d.ref === 'Genesis 1:26' && d.observed === '1cp'));
  assert.ok(res.deviations.some(d => d.kind === 'emerging_motif' && String(d.observed).includes('H1288')));

  const pairs = new Set(res.correspondences.map(c => `${c.unitA}-${c.unitB}`));
  assert.ok(pairs.has('0-3') && pairs.has('1-4') && pairs.has('2-5'), 'Expected Days 1-4, 2-5, 3-6 correspondences');
  assert.ok(res.commandFulfillments.length >= 4);
  assert.ok(res.lxxComparison?.divergences.some(d => d.kind === 'lxx_formula_addition' && d.mtRef === 'Genesis 1:8'));

  // Security check: no restricted MACULA fields leaked
  const serialized = JSON.stringify(res);
  assert.ok(!serialized.includes('"gated_fields"'));
  assert.ok(!serialized.includes('"sdbh"'));
  assert.ok(!serialized.includes('"greekstrong"'));
});

test('Acrostics: Psalm 111 half-verse, Proverbs 31 full-verse, Psalm 119 8-verse stanzas', () => {
  const ps111 = analyzeLiteraryPassage({ passage: 'Psalm 111', verses: loadVerses([[19, 111, 1, 10]]) });
  assert.ok(ps111.acrostics.some(a => a.mode === 'half_verse_atnach' && a.lettersCovered >= 20));

  const prov31 = analyzeLiteraryPassage({ passage: 'Proverbs 31:10-31', verses: loadVerses([[20, 31, 10, 31]]) });
  assert.ok(prov31.acrostics.some(a => a.mode === 'verse_initial' && a.lettersCovered === 22));

  const ps119 = analyzeLiteraryPassage({ passage: 'Psalm 119:1-24', verses: loadVerses([[19, 119, 1, 24]]) });
  assert.ok(ps119.acrostics.some(a => a.mode === 'multi_verse_stanza' && a.stanzaSize === 8));
});

test('Greek NT: Matthew 5:3-12 Beatitudes template + 2nd-person shift & John 1:1-18 staircase parallelism', () => {
  const mt5 = analyzeLiteraryPassage({ passage: 'Matthew 5:3-12', verses: loadVerses([[40, 5, 3, 12]]) });
  assert.equal(mt5.edition, 'grc_nt');
  assert.ok((mt5.segmentation?.units.length ?? 0) >= 8);
  assert.ok(mt5.speakerShifts.some(s => s.ref === 'Matthew 5:11' && s.nextPerson.startsWith('2')));

  const jn1 = analyzeLiteraryPassage({ passage: 'John 1:1-18', verses: loadVerses([[43, 1, 1, 18]]) });
  assert.ok(jn1.symmetries.some(s => s.kind === 'progressive_parallelism'));
  assert.ok(jn1.keyWords.some(k => k.strongs === 'G3056'));
});

test('Chiasms & Wordplay letter-level highlight indices', () => {
  const isa6 = analyzeLiteraryPassage({ passage: 'Isaiah 6:10', verses: loadVerses([[23, 6, 10, 10]]) });
  assert.ok(isa6.symmetries.some(s => (s.kind === 'chiasm' || s.kind === 'concentric') && s.pairs.length >= 3));

  const gen2 = analyzeLiteraryPassage({ passage: 'Genesis 2:7', verses: loadVerses([[1, 2, 7, 7]]) });
  const wp = gen2.wordplays.find(w => [w.wordA.strongs, w.wordB.strongs].includes('H120') && [w.wordA.strongs, w.wordB.strongs].includes('H127'));
  assert.ok(wp);
  assert.ok(wp.wordA.matchedCharIndices.length >= 2 && wp.wordB.matchedCharIndices.length >= 2);
});

test('Revelation 2-3: 7 churches exact boundaries, opening+closing agreement, repentance omissions, and 3+4 order swap', () => {
  const rev = analyzeLiteraryPassage(
    { passage: 'Revelation 2:1-3:22', verses: loadVerses([[66, 2, 1, 29], [66, 3, 1, 22]]) },
    { includeAlternatives: true }
  );
  assert.equal(rev.edition, 'grc_nt');
  assert.equal(rev.segmentation?.introduction, null);
  assert.equal(rev.segmentation?.conclusion, null);
  assert.deepEqual(
    rev.segmentation?.units.map(u => `${u.fromRef}..${u.toRef}`),
    [
      'Revelation 2:1..Revelation 2:7',
      'Revelation 2:8..Revelation 2:11',
      'Revelation 2:12..Revelation 2:17',
      'Revelation 2:18..Revelation 2:29',
      'Revelation 3:1..Revelation 3:6',
      'Revelation 3:7..Revelation 3:13',
      'Revelation 3:14..Revelation 3:22',
    ]
  );
  assert.ok(rev.segmentation?.signals.includes('opening_closing_agreement'));
  // G3340 (repent) genuinely omitted in Smyrna (unit 1) and Philadelphia (unit 5); no false G3528 omission on Smyrna
  assert.ok(rev.deviations.some(d => d.kind === 'omission' && d.unitIndex === 1 && d.expected === 'G3340'));
  assert.ok(rev.deviations.some(d => d.kind === 'omission' && d.unitIndex === 5 && d.expected === 'G3340'));
  assert.ok(!rev.deviations.some(d => d.kind === 'omission' && d.unitIndex === 1 && d.expected === 'G3528'));
  // Famous 3+4 flip between Hearing formula (G3775) and Overcomer promise (G3528)
  assert.ok(
    rev.deviations.some(
      d =>
        d.kind === 'reordering' &&
        String(d.expected).includes('G3528') &&
        String(d.expected).includes('G3775')
    )
  );

  const rev2 = analyzeLiteraryPassage({ passage: 'Revelation 2:1-29', verses: loadVerses([[66, 2, 1, 29]]) });
  assert.equal(rev2.segmentation?.units.length, 4);
  assert.equal(rev2.segmentation?.units[3].toRef, 'Revelation 2:29');

  const rev16 = analyzeLiteraryPassage({ passage: 'Revelation 16:1-21', verses: loadVerses([[66, 16, 1, 21]]) });
  assert.equal(rev16.segmentation?.introduction?.fromRef, 'Revelation 16:1');
  assert.equal(rev16.segmentation?.units.length, 7);
  assert.equal(rev16.segmentation?.units[6].toRef, 'Revelation 16:21');
});

test('Diverse corpus templates: Matthew 23 woes, Deut 27 curses, Ps 42-43 refrains, Num 7 days, Isa 5 woes', () => {
  const mt23 = analyzeLiteraryPassage({ passage: 'Matthew 23:13-33', verses: loadVerses([[40, 23, 13, 33]]) });
  assert.equal(mt23.segmentation?.units.length, 7);
  assert.equal(mt23.segmentation?.units[6].toRef, 'Matthew 23:33');

  const dt27 = analyzeLiteraryPassage({ passage: 'Deuteronomy 27:15-26', verses: loadVerses([[5, 27, 15, 26]]) });
  assert.equal(dt27.segmentation?.units.length, 12);

  const ps42 = analyzeLiteraryPassage({ passage: 'Psalm 42:1-43:5', verses: loadVerses([[19, 42, 1, 11], [19, 43, 1, 5]]) });
  assert.deepEqual(
    ps42.segmentation?.units.map(u => `${u.fromRef}..${u.toRef}`),
    ['Psalms 42:1..Psalms 42:5', 'Psalms 42:6..Psalms 42:11', 'Psalms 43:1..Psalms 43:5']
  );

  const num7 = analyzeLiteraryPassage({ passage: 'Numbers 7:12-35', verses: loadVerses([[4, 7, 12, 35]]) });
  assert.deepEqual(
    num7.segmentation?.units.map(u => `${u.fromRef}..${u.toRef}`),
    ['Numbers 7:12..Numbers 7:17', 'Numbers 7:18..Numbers 7:23', 'Numbers 7:24..Numbers 7:29', 'Numbers 7:30..Numbers 7:35']
  );

  const isa5 = analyzeLiteraryPassage({ passage: 'Isaiah 5:8-23', verses: loadVerses([[23, 5, 8, 23]]) });
  assert.equal(isa5.segmentation?.units.length, 6);
});

test('Genealogies, phase-shifted cycles, analogies, paronomasia, and patternFamilies spans', () => {
  const gen5 = analyzeLiteraryPassage({ passage: 'Genesis 5:1-32', verses: loadVerses([[1, 5, 1, 32]]) });
  assert.equal(gen5.segmentation?.introduction?.fromRef, 'Genesis 5:1');
  assert.equal(gen5.segmentation?.units.length, 9);
  assert.equal(gen5.segmentation?.units[6].fromRef, 'Genesis 5:21');
  assert.equal(gen5.segmentation?.units[6].toRef, 'Genesis 5:24');
  assert.equal(gen5.segmentation?.conclusion?.fromRef, 'Genesis 5:32');
  assert.ok(gen5.deviations.some(d => d.kind === 'omission' && d.unitIndex === 6 && d.expected === 'H4191'));
  assert.equal(gen5.symmetries.filter(s => s.level === 'unit').length, 0);

  const ps107 = analyzeLiteraryPassage({ passage: 'Psalm 107:4-32', verses: loadVerses([[19, 107, 4, 32]]) });
  assert.deepEqual(
    ps107.segmentation?.units.map(u => `${u.fromRef}..${u.toRef}`),
    ['Psalms 107:4..Psalms 107:9', 'Psalms 107:10..Psalms 107:16', 'Psalms 107:17..Psalms 107:22', 'Psalms 107:23..Psalms 107:32']
  );
  assert.ok(ps107.keyWords.some(k => k.strongs === 'H3034') && ps107.keyWords.some(k => k.strongs === 'H2617'));
  assert.ok(ps107.patternFamilies?.some(f => f.id === 'fam:slot:H3034'));

  const ps136 = analyzeLiteraryPassage({ passage: 'Psalm 136:1-12', verses: loadVerses([[19, 136, 1, 12]]) });
  assert.equal(ps136.segmentation?.units.length, 12);
  assert.ok(ps136.segmentation?.signals.some(s => s.includes('H3588+H5769+H2617')));

  const amos4 = analyzeLiteraryPassage({ passage: 'Amos 4:6-11', verses: loadVerses([[30, 4, 6, 11]]) });
  assert.equal(amos4.segmentation?.units.length, 5);
  assert.ok(amos4.segmentation?.signals.some(s => s.includes('H7725')));

  const gen96 = analyzeLiteraryPassage({ passage: 'Genesis 9:6', verses: loadVerses([[1, 9, 6, 6]]) });
  assert.ok(gen96.symmetries.some(s => s.kind === 'chiasm' && s.pairs.length === 3));
  assert.ok(gen96.wordplays.some(w => [w.wordA.strongs, w.wordB.strongs].includes('H120') && [w.wordA.strongs, w.wordB.strongs].includes('H1818')));

  const jer1 = analyzeLiteraryPassage({ passage: 'Jeremiah 1:11-12', verses: loadVerses([[24, 1, 11, 12]]) });
  assert.ok(jer1.wordplays.some(w => w.epistemicClass === 'attested_textual_wordplay' && [w.wordA.strongs, w.wordB.strongs].includes('H8247') && [w.wordA.strongs, w.wordB.strongs].includes('H8245')));

  const mt5 = analyzeLiteraryPassage({ passage: 'Matthew 5:21-48', verses: loadVerses([[40, 5, 21, 48]]) });
  assert.deepEqual(
    mt5.segmentation?.units.map(u => `${u.fromRef}..${u.toRef}`),
    [
      'Matthew 5:21..Matthew 5:26',
      'Matthew 5:27..Matthew 5:30',
      'Matthew 5:31..Matthew 5:32',
      'Matthew 5:33..Matthew 5:37',
      'Matthew 5:38..Matthew 5:42',
      'Matthew 5:43..Matthew 5:48',
    ]
  );
  assert.ok(mt5.deviations.some(d => d.kind === 'omission' && d.unitIndex === 2 && d.expected === 'G191'));

  const isa55 = analyzeLiteraryPassage({ passage: 'Isaiah 55:1-13', verses: loadVerses([[23, 55, 1, 13]]) });
  assert.ok(isa55.thematicClusters.some(c => c.themeLabel.startsWith('Analogical comparison')));

  const eccl3 = analyzeLiteraryPassage({ passage: 'Ecclesiastes 3:1-8', verses: loadVerses([[21, 3, 1, 8]]) });
  assert.ok((eccl3.segmentation?.units.length ?? 0) >= 7);
  assert.ok(eccl3.thematicClusters.some(c => c.themeLabel.startsWith('Paired opposing series')));

  const am8 = analyzeLiteraryPassage({ passage: 'Amos 8:1-2', verses: loadVerses([[30, 8, 1, 2]]) });
  assert.equal(am8.wordplays[0]?.epistemicClass, 'attested_textual_wordplay');
  assert.ok([am8.wordplays[0]?.wordA.strongs, am8.wordplays[0]?.wordB.strongs].includes('H7019'));

  const mic1 = analyzeLiteraryPassage({ passage: 'Micah 1:10-15', verses: loadVerses([[33, 1, 10, 15]]) });
  assert.ok(mic1.wordplays.some(w => w.epistemicClass === 'attested_textual_wordplay' && w.wordA.strongs === 'H392' || w.wordB.strongs === 'H392'));

  const mk2 = analyzeLiteraryPassage({ passage: 'Mark 2:27', verses: loadVerses([[41, 2, 27, 27]]) });
  assert.ok(mk2.symmetries.some(s => (s.kind === 'chiasm' || s.kind === 'concentric') && s.pairs.length >= 2));

  const lam1 = analyzeLiteraryPassage({ passage: 'Lamentations 1:1-22', verses: loadVerses([[25, 1, 1, 22]]) });
  assert.ok(lam1.acrostics.some(a => a.mode === 'verse_initial' && a.lettersCovered === 22));

  const gen1 = analyzeLiteraryPassage({ passage: 'Genesis 1:1-2:3', verses: loadVerses([[1, 1, 1, 31], [1, 2, 1, 3]]) });
  assert.ok((gen1.patternFamilies?.length ?? 0) >= 4);
  assert.ok(gen1.patternFamilies.some(f => f.category === 'template_function' && f.defaultVisible && f.spans.some(s => s.hasDeviation)));
  assert.ok(gen1.patternFamilies.filter(f => f.category === 'keyword').every(f => !f.defaultVisible));
});
