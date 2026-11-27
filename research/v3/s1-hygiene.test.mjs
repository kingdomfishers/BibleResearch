import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EXPLICIT_PREFIX_BUGS,
  normalizeHebrewPointed,
  isProperOrConstructName,
} from '../../scripts/v3/sanitize-step-lexicon.mjs';

const LEXICON_PATH = '.artifacts-r12/v3-build/sanitized-lexicon.json';

let cachedLexicon;
function loadLexicon() {
  if (!cachedLexicon) {
    cachedLexicon = JSON.parse(fs.readFileSync(LEXICON_PATH, 'utf8'));
  }
  return cachedLexicon;
}

test('S1-H1: Prefix bug purge flags explicit bugs, H90xx, FUNC_POS, and assigns IDF=0 when df=0', () => {
  const lex = loadLexicon();
  assert.equal(lex.license, 'CC BY 4.0 (STEPBible-Data)');
  assert.ok(lex.stats.total_profiles >= 19500);

  for (const bs of EXPLICIT_PREFIX_BUGS) {
    const p = lex.profiles[bs];
    assert.ok(p, `Expected profile ${bs}`);
    assert.equal(p.is_grammatical_marker, true, `${bs} must be flagged is_grammatical_marker=true`);
  }

  for (const [bs, p] of Object.entries(lex.profiles)) {
    if (/^H90\d{2}$/.test(bs)) {
      assert.equal(p.is_grammatical_marker, true, `${bs} (^H90xx) must be purged`);
    }
    if (p.canonical_df === 0) {
      assert.equal(p.idf, 0, `${bs} with canonical_df=0 must have idf=0`);
    } else {
      assert.ok(p.idf > 0, `${bs} with canonical_df=${p.canonical_df} must have idf>0`);
    }
  }
});

test('S1-H2: Rule 1 rescues all hijacked headwords and segregates proper/title variants into B#prop', () => {
  const lex = loadLexicon();
  assert.ok(lex.stats.headwords_rescued >= 74, `Expected >=74 hijacked headwords rescued, got ${lex.stats.headwords_rescued}`);
  assert.ok(lex.stats.proper_segregated >= 100);

  const checks = [
    ['H6697', /\brock\b/i, 'H6697#prop'],
    ['H6438', /\bcorner\b/i, 'H6438#prop'],
    ['H7462', /\bpasture\b/i, 'H7462#prop'],
    ['H5158', /\bwadi\b|\btorrent\b/i, 'H5158#prop'],
    ['H1540', /\breveal\b/i, 'H1540#prop'],
    ['H2319', /\bnew\b/i, 'H2319#prop'],
    ['H4417', /\bsalt\b/i, 'H4417#prop'],
  ];

  for (const [bs, expectedRe, propKey] of checks) {
    const p = lex.profiles[bs];
    assert.ok(p, `Missing profile ${bs}`);
    assert.equal(p.headword_rescued, true, `${bs} must be marked headword_rescued`);
    assert.match(p.gl, expectedRe, `${bs} primary gloss (${p.gl}) must match ${expectedRe}`);
    assert.equal(isProperOrConstructName(p.gl, p.pos, p.entity_kind), false, `${bs} primary gloss must not remain a proper name`);
    if (propKey !== 'H1540#prop' || lex.segregated_proper[propKey]) {
      assert.ok(lex.segregated_proper[propKey]?.variants?.length >= 1, `Expected segregated variants under ${propKey}`);
    }
  }

  assert.doesNotMatch(lex.profiles.H5158.gl, /palm-tree/i, 'H5158 must be rescued from palm-tree');
  assert.doesNotMatch(lex.profiles.H1540.gl, /Heglam/i, 'H1540 must be rescued from Heglam');
});

test('S1-H3: Rule 2 collapses inflection/state splits and Rule 3 retains true polysemes', () => {
  const lex = loadLexicon();
  assert.ok(lex.stats.inflections_collapsed >= 1000);
  assert.ok(lex.stats.polysemes_retained >= 300);

  // H5869 retains both eye and spring senses
  const h5869 = lex.profiles.H5869;
  assert.match(h5869.gl, /eye/i);
  assert.ok(h5869.senses.some(s => /spring/i.test(s.gl)), 'H5869 must retain spring polyseme');

  // H7307 retains spirit/wind and side
  const h7307 = lex.profiles.H7307;
  assert.ok(h7307.senses.some(s => /side/i.test(s.gl)), 'H7307 must retain side sense');

  // H3722 retains both atone and cover
  const h3722 = lex.profiles.H3722;
  assert.ok(h3722.senses.some(s => /atone/i.test(s.gl)) && h3722.senses.some(s => /cover/i.test(s.gl)), 'H3722 must retain atone and cover');

  // H1253 (lye) and H1252 (cleanness) remain distinct
  assert.match(lex.profiles.H1253.gl, /lye/i);
  assert.match(lex.profiles.H1252.gl, /cleanness/i);
});

test('S1-H4: Niqqud-aware pointed Hebrew, Greek ASCII transliteration, and English gloss lookup', () => {
  const lex = loadLexicon();
  const borHits = lex.lookup.pointed[normalizeHebrewPointed('בֹּר')];
  assert.ok(Array.isArray(borHits) && borHits.length >= 1);
  assert.equal(borHits[0], 'H1253', `Expected בֹּר -> H1253 #1, got ${JSON.stringify(borHits)}`);

  const shayitHits = lex.lookup.pointed[normalizeHebrewPointed('שַׁיִת')];
  assert.ok(Array.isArray(shayitHits) && shayitHits[0] === 'H7898', `Expected שַׁיִת -> H7898 #1, got ${JSON.stringify(shayitHits)}`);

  assert.ok(lex.lookup.translit.pyroo?.includes('G4448'), 'pyroo must resolve to G4448');
  assert.ok(lex.lookup.translit.dokimazo?.includes('G1381'), 'dokimazo must resolve to G1381');

  const furnaceHits = lex.lookup.gloss.furnace || [];
  for (const bs of ['H3564', 'H3536', 'G2575', 'H0861']) {
    assert.ok(furnaceHits.includes(bs), `furnace gloss lookup must include ${bs}, got ${JSON.stringify(furnaceHits)}`);
  }
});
