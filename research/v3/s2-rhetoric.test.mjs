import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { analyzeLiteraryPassage } from '../../src/relationships/literary-engine.ts';
import { detectPeltChangepoints, discoverChiasms } from '../../src/relationships/literary-structure.mjs';
import {
  countHebrewNonMaterConsonants,
  detectOnomasticValenceWordplays,
  detectSyntacticTalionAndPolyptoton,
  scoreGlossValence,
  stripGreekInflectionalStem,
  stripHebrewProcliticsWithLemma,
} from '../../src/relationships/wordplay-engine.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE = path.join(ROOT, '.artifacts-r12/staging-bundle');
const RHETORIC_BUILD_DIR = path.join(ROOT, '.artifacts-r12/v3-build/rhetoric');
const RHETORIC_STAGING_DIR = path.join(BUNDLE, 'v3/rhetoric');

const RESTRICTED_KEYS = new Set([
  'gated_fields',
  'semantic_frame',
  'frame',
  'greekstrong',
  'sdbh',
  'lexdomain',
  'coredomain',
  'contextualdomain',
  'domain',
  'ln',
  'field_name',
]);

function loadVerses(ranges) {
  const out = [];
  for (const [book, chapter, startV, endV] of ranges) {
    const ch = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(path.join(BUNDLE, `v1/chapters/b${book}-c${chapter}.json.gz`)))
    );
    const list = Object.values(ch.verses)
      .filter(v => v.verse_nr >= startV && v.verse_nr <= endV)
      .sort((a, b) => a.verse_nr - b.verse_nr);
    out.push(...list);
  }
  return out;
}

function assertNoRestrictedKeys(val, p = '') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) assertNoRestrictedKeys(val[i], `${p}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      assert.ok(!RESTRICTED_KEYS.has(k), `Restricted UBS key "${k}" found at ${p}.${k}`);
      if (v && typeof v === 'object') assertNoRestrictedKeys(v, `${p}.${k}`);
    }
  }
}

test('G2.1: Morpho-phonological helpers & Syntactic Talion / Polyptoton (Mark 2:27 & Genesis 9:6)', () => {
  assert.equal(stripGreekInflectionalStem('αιωνι', 'N-DSM', 'noun'), 'αιων');
  assert.equal(stripHebrewProcliticsWithLemma('ובדבר', 'דבר'), 'דבר');
  assert.equal(countHebrewNonMaterConsonants('תורה'), 2);
  assert.equal(countHebrewNonMaterConsonants('ילד'), 3);

  // Mark 2:27: sabbaton (G4521) N->A and anthropos (G444) A->N mirror case-inversion without function words
  const mk2 = analyzeLiteraryPassage({
    passage: 'Mark 2:27',
    verses: loadVerses([[41, 2, 27, 27]]),
  });
  const mkTalion = mk2.wordplays.filter(w => w.overlapKind === 'syntactic_talion');
  assert.ok(
    mkTalion.some(w => w.wordA.strongs === 'G4521' && w.wordB.strongs === 'G4521'),
    'Mark 2:27 must detect sabbaton (G4521) syntactic talion'
  );
  assert.ok(
    mkTalion.some(w => w.wordA.strongs === 'G444' && w.wordB.strongs === 'G444'),
    'Mark 2:27 must detect anthropos (G444) syntactic talion'
  );
  assert.ok(
    mk2.wordplays.every(w => !['G3588', 'G2532', 'G1223', 'G3756'].includes(w.wordA.strongs)),
    'Spurious articles/particles must never appear in wordplays'
  );

  // Genesis 9:6: shaphak active->passive talion + adam/adam polyptoton + adam/dam paronomasia
  const gen96 = analyzeLiteraryPassage({
    passage: 'Genesis 9:6',
    verses: loadVerses([[1, 9, 6, 6]]),
  });
  assert.ok(
    gen96.wordplays.some(w => w.overlapKind === 'syntactic_talion' && w.wordA.strongs === 'H8210'),
    'Genesis 9:6 must detect H8210 active->passive syntactic talion'
  );
  assert.ok(
    gen96.wordplays.some(w => w.overlapKind === 'clause_polyptoton' && w.wordA.strongs === 'H120' && w.wordB.strongs === 'H120'),
    'Genesis 9:6 must detect H120 clause polyptoton (הָאָדָם -> בָּאָדָם)'
  );
  assert.ok(
    gen96.wordplays.some(
      w => [w.wordA.strongs, w.wordB.strongs].includes('H120') && [w.wordA.strongs, w.wordB.strongs].includes('H1818')
    ),
    'Genesis 9:6 must recover adam/dam (H120/H1818) paronomasia'
  );
});

test('G2.2: Onomastic & Evaluative Valence wordplay (Philemon 10-11 Onesimus/achrestos/euchrestos)', () => {
  assert.equal(scoreGlossValence('useful profitable good'), 1);
  assert.equal(scoreGlossValence('useless worthless shame'), -1);

  const phlm10_11 = analyzeLiteraryPassage({
    passage: 'Philemon 1:10-11',
    verses: loadVerses([[57, 1, 10, 11]]),
  });
  assert.ok(
    phlm10_11.wordplays.some(
      w =>
        w.overlapKind === 'onomastic_valence_play' &&
        w.epistemicClass === 'attested_textual_wordplay' &&
        w.wordA.strongs === 'G3682' &&
        w.wordB.strongs === 'G890'
    ),
    'Philemon 10-11 must detect Onesimus (G3682) <-> achrestos (G890)'
  );
  assert.ok(
    phlm10_11.wordplays.some(
      w =>
        w.overlapKind === 'onomastic_valence_play' &&
        w.epistemicClass === 'attested_textual_wordplay' &&
        w.wordA.strongs === 'G3682' &&
        w.wordB.strongs === 'G2173'
    ),
    'Philemon 10-11 must detect Onesimus (G3682) <-> euchrestos (G2173)'
  );

  // Full Philemon 8-21 also picks up G3685 (onaimen) root match
  const phlm8_21 = analyzeLiteraryPassage({
    passage: 'Philemon 1:8-21',
    verses: loadVerses([[57, 1, 8, 21]]),
  });
  assert.ok(
    phlm8_21.wordplays.some(w => w.wordA.strongs === 'G3682' && w.wordB.strongs === 'G3685'),
    'Philemon 8-21 must detect Onesimus (G3682) <-> onaimen (G3685)'
  );
});

test('G2.3: Residual SSM & B=200 Refrain-Pinned Perm/MDL rejects Ps 136 FPs while recovering Gen 9:6, Ps 23, Isa 6:10, Amos 1-2, Amos 4:6-11', () => {
  // Psalm 136 refrain-driven false chiasm REJECTED
  const ps136Full = analyzeLiteraryPassage({
    passage: 'Psalm 136:1-26',
    verses: loadVerses([[19, 136, 1, 26]]),
  });
  assert.equal(
    ps136Full.symmetries.filter(s => s.kind === 'chiasm' || s.kind === 'concentric').length,
    0,
    'Psalm 136:1-26 must reject refrain-driven false chiasms'
  );
  assert.equal(ps136Full.segmentation?.units.length, 26);

  // Synthetic refrain stress test for discoverChiasms
  const refrainSeq = [];
  for (let i = 0; i < 16; i++) {
    refrainSeq.push({ id: `u${i}a`, key: `uniq${i}`, wordIds: [`w${i}a`], features: [] });
    refrainSeq.push({ id: `u${i}r`, key: 'REFRAIN', wordIds: [`w${i}r`], features: [] });
  }
  assert.equal(discoverChiasms(refrainSeq).length, 0, 'Periodic refrain sequence must produce 0 chiasms');

  // Genesis 9:6 true 3-pair chiasm recovered
  const gen96 = analyzeLiteraryPassage({ passage: 'Genesis 9:6', verses: loadVerses([[1, 9, 6, 6]]) });
  assert.ok(
    gen96.symmetries.some(s => (s.kind === 'chiasm' || s.kind === 'concentric') && s.pairs.length >= 3 && (s.pValue ?? 1) <= 0.03),
    'Genesis 9:6 must recover 3-pair chiasm passing B=200 permutation gate'
  );

  // Isaiah 6:10 true 3-pair chiasm (heart-ears-eyes-eyes-ears-heart) recovered
  const isa6 = analyzeLiteraryPassage({ passage: 'Isaiah 6:10', verses: loadVerses([[23, 6, 10, 10]]) });
  assert.ok(
    isa6.symmetries.some(s => (s.kind === 'chiasm' || s.kind === 'concentric') && s.pairs.length >= 3 && (s.pValue ?? 1) <= 0.03),
    'Isaiah 6:10 must recover 3-pair heart/ears/eyes chiasm passing B=200 permutation gate'
  );

  // Psalm 23 H3068 inclusio + speaker shift + PELT speaker framing recovered
  const ps23 = analyzeLiteraryPassage({ passage: 'Psalm 23:1-6', verses: loadVerses([[19, 23, 1, 6]]) });
  assert.ok(
    ps23.symmetries.some(s => s.kind === 'inclusio' && s.fromRef === 'Psalms 23:1' && s.toRef === 'Psalms 23:6'),
    'Psalm 23 must recover Yahweh (H3068) inclusio framing vv.1 & 6'
  );

  // Amos 1-2 (8 oracle units) & Amos 4:6-11 (5 judgment refrain units)
  const amos12 = analyzeLiteraryPassage({
    passage: 'Amos 1:3-2:16',
    verses: [...loadVerses([[30, 1, 3, 15]]), ...loadVerses([[30, 2, 1, 16]])],
  });
  assert.equal(amos12.segmentation?.units.length, 8);
  assert.ok(amos12.template?.slots.every(s => Boolean(s.slotAtom?.senseId)), 'Template slots must carry SlotAtom');

  const amos4 = analyzeLiteraryPassage({
    passage: 'Amos 4:6-11',
    verses: loadVerses([[30, 4, 6, 11]]),
  });
  assert.equal(amos4.segmentation?.units.length, 5);
});

test('G2.4: PELT changepoints recover speaker & genre/formula transitions + Idiom SlotAtom', () => {
  const synth = detectPeltChangepoints(['narr', 'narr', 'narr', 'oracle', 'oracle', 'oracle', 'hymn', 'hymn', 'hymn'], {
    penaltyScale: 0.85,
  });
  assert.deepEqual(synth.changepoints, [3, 6]);

  const ps23 = analyzeLiteraryPassage({ passage: 'Psalm 23:1-6', verses: loadVerses([[19, 23, 1, 6]]) });
  assert.ok((ps23.peltChangepoints?.length ?? 0) >= 2, 'Psalm 23 PELT must detect 2p transition at v.4 and return at v.6');
  assert.ok(
    ps23.speakerSegments?.some(seg => seg.dominantLabel === '2p' && seg.fromRef === 'Psalms 23:4'),
    'Psalm 23 speakerSegments must isolate 2p segment starting at Psalms 23:4'
  );

  const amos12 = analyzeLiteraryPassage({
    passage: 'Amos 1:3-2:16',
    verses: [...loadVerses([[30, 1, 3, 15]]), ...loadVerses([[30, 2, 1, 16]])],
  });
  assert.ok(
    amos12.peltChangepoints?.some(cp => cp >= 18 && cp <= 21),
    'Amos 1-2 PELT must detect transition from fire-judgment oracles into Israel indictment'
  );

  // Idiom SlotAtom & Dirichlet-Multinomial column surprisal on Genesis 1:1-2:3
  const gen1 = analyzeLiteraryPassage({
    passage: 'Genesis 1:1-2:3',
    verses: loadVerses([[1, 1, 1, 31], [1, 2, 1, 3]]),
  });
  assert.ok(gen1.template?.slots.some(s => s.slotAtom && typeof s.columnSurprisalBits === 'number'));
});

test('G2.5: Lossless clause compiler covers 100% of verses & tokens in v3/rhetoric/ with zero restricted UBS keys', () => {
  assert.ok(fs.existsSync(path.join(RHETORIC_BUILD_DIR, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(RHETORIC_STAGING_DIR, 'manifest.json')));

  const manifest = JSON.parse(fs.readFileSync(path.join(RHETORIC_STAGING_DIR, 'manifest.json'), 'utf8'));
  assertNoRestrictedKeys(manifest, 'manifest');
  assert.equal(manifest.restricted_ubs_keys_present, false);
  assert.equal(manifest.stats.verse_coverage_ratio, 1);
  assert.equal(manifest.stats.token_coverage_ratio, 1);
  assert.equal(manifest.stats.covered_verses, 31203);
  assert.equal(manifest.stats.total_verses, 31203);
  assert.ok(manifest.stats.covered_tokens > 400000);
  assert.ok(manifest.stats.macula_clause_verses >= 31000);
  assert.ok(manifest.stats.negated_clauses > 5000);
  assert.ok(manifest.stats.mapped_concept_tokens > 100000);

  const files = fs.readdirSync(RHETORIC_STAGING_DIR);
  assert.ok(files.length <= 64, `Expected <= 64 files, got ${files.length}`);
  for (const f of files) {
    const st = fs.statSync(path.join(RHETORIC_STAGING_DIR, f));
    assert.ok(st.size < 10 * 1024 * 1024, `File ${f} exceeds 10 MiB (${st.size})`);
    // Verify build and staging are byte-identical
    assert.ok(
      fs.readFileSync(path.join(RHETORIC_BUILD_DIR, f)).equals(fs.readFileSync(path.join(RHETORIC_STAGING_DIR, f))),
      `Mismatch between build and staging for ${f}`
    );
  }

  // Verify lossless token partition & zero restricted keys on shard 0 and last NT shard
  let totalCheckedTokens = 0;
  for (const shardFile of ['clauses-00.json.gz', 'clauses-31.json.gz']) {
    const shard = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RHETORIC_STAGING_DIR, shardFile))).toString('utf8'));
    assertNoRestrictedKeys(shard, shardFile);
    for (const v of shard.verses) {
      const seenIndices = [];
      for (const cl of v.clauses) {
        for (const ti of cl.token_indices) seenIndices.push(ti);
      }
      assert.equal(seenIndices.length, v.tokens.length, `Lossless partition mismatch at vid=${v.vid}`);
      for (let k = 0; k < v.tokens.length; k++) {
        assert.equal(seenIndices[k], k, `Non-sequential token index at vid=${v.vid}`);
      }
      totalCheckedTokens += v.tokens.length;
    }
  }
  assert.ok(totalCheckedTokens > 10000);

  // Verify rhetoric-index.json.gz contains Mark 2:27, Gen 9:6, and Philemon 10-11
  const rIdx = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(path.join(RHETORIC_STAGING_DIR, 'rhetoric-index.json.gz'))).toString('utf8')
  );
  assertNoRestrictedKeys(rIdx, 'rhetoric-index');
  assert.ok(
    rIdx.syntactic_talion_hits.some(h => h.ref === 'Mark 2:27' && h.strongsA === 'G4521'),
    'rhetoric-index must include Mark 2:27 G4521 talion'
  );
  assert.ok(
    rIdx.syntactic_talion_hits.some(h => h.ref === 'Genesis 9:6' && h.strongsA === 'H8210'),
    'rhetoric-index must include Genesis 9:6 H8210 talion'
  );
  assert.ok(
    rIdx.onomastic_valence_hits.some(
      h => h.proper_strongs === 'G3682' && h.target_strongs === 'G890' && h.proper_ref === 'Philemon 1:10'
    ),
    'rhetoric-index must include Philemon 1:10-11 Onesimus/achrestos'
  );
});

test('G2.6: supabase/functions/bible-mcp/literary/ is byte-synced with src/relationships/', () => {
  const srcDir = path.join(ROOT, 'src/relationships');
  const mcpDir = path.join(ROOT, 'supabase/functions/bible-mcp/literary');
  for (const name of [
    'literary-engine.ts',
    'literary-structure.mjs',
    'literary-structure.d.mts',
    'literary-types.ts',
    'wordplay-engine.ts',
  ]) {
    const a = fs.readFileSync(path.join(srcDir, name));
    const b = fs.readFileSync(path.join(mcpDir, name));
    assert.ok(a.equals(b), `${name} must be byte-identical in supabase/functions/bible-mcp/literary/`);
  }
});
