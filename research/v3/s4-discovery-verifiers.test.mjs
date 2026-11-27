// Gate G4 Verification Suite for Stage S4:
// E_perp Multi-Axis Scorer, Intermediate Bridge Pivots, Typed Conductance Subgraph Proofs,
// Top-24 Shortlist Verifiers (3-way Halo-SW & SW^piece_pol), All 7 New v3 Worker RPCs,
// and 100% Negative Rejection (NEG1..NEG8 + adversarial controls).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { corpusRpc } from '../../scripts/local-corpus-harness.mjs';
import {
  computeEPerpScore,
  rankBridgePivots,
} from '../../src/relationships/v3-scorer.ts';
import {
  alignClauseSequencesPiecewise,
  alignTriTextualQuote,
} from '../../src/relationships/v3-verifiers.ts';
import {
  lookupTerm,
  parseBmwIndex,
} from '../../src/relationships/v3-binary-index.ts';
import {
  V3RuntimeSession,
  scoreV3EPerpPair,
  findV3BridgePivots,
} from '../../src/relationships/v3-runtime-adapter.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V3_DIR = path.join(ROOT, '.artifacts-r12/staging-bundle/v3');

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

function assertNoRestrictedKeys(val, p = '') {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) assertNoRestrictedKeys(val[i], `${p}[${i}]`);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      assert.ok(!RESTRICTED_KEYS.has(k), `Restricted UBS key "${k}" leaked at ${p}.${k}`);
      if (v && typeof v === 'object') assertNoRestrictedKeys(v, `${p}.${k}`);
    }
  }
}

function makeFsSession() {
  const reader = {
    async readJson(assetPath) {
      const rel = assetPath.replace(/^\/+/, '');
      const full = path.join(ROOT, '.artifacts-r12/staging-bundle', rel);
      if (!fs.existsSync(full)) return null;
      const raw = fs.readFileSync(full);
      const buf = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
      return { data: JSON.parse(buf.toString('utf8')), bytes: buf.length };
    },
    async readBinary(assetPath) {
      const rel = assetPath.replace(/^\/+/, '');
      const full = path.join(ROOT, '.artifacts-r12/staging-bundle', rel);
      return fs.existsSync(full) ? new Uint8Array(fs.readFileSync(full)) : null;
    },
  };
  return new V3RuntimeSession(reader);
}

test('G4.1: E_perp convergence, rare single-channel floor, 0.15 physical cap, 0.65 co-hyponym damping, 4 registers', async () => {
  const makeDist = (testament, entries, tokenCount = 12) => ({
    anchorVids: new Set(),
    testament,
    tokenCount,
    mass: new Map(entries),
  });
  const makeMeta = (map) => (nid) => map.get(nid) ?? null;

  // 1. Medium-df single-axis H1817 (door, df=88) damped (-74%) compared to rare single-axis (df=4) and multi-axis
  const mediumSingle = computeEPerpScore(
    makeDist('OT', [[101, 0.25]]),
    makeDist('OT', [[101, 0.25]]),
    makeMeta(new Map([[101, { axisKey: 'LEMMA:H1817', nullP0: 88 / 31203, df: 88, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL' }]])),
  );
  const rareSingle = computeEPerpScore(
    makeDist('OT', [[102, 0.25]]),
    makeDist('OT', [[102, 0.25]]),
    makeMeta(new Map([[102, { axisKey: 'LEMMA:H8247', nullP0: 4 / 31203, df: 4, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL' }]])),
  );
  const multiTextual = computeEPerpScore(
    makeDist('OT', [[102, 0.25], [103, 0.20], [104, 0.20]]),
    makeDist('OT', [[102, 0.25], [103, 0.20], [104, 0.20]]),
    makeMeta(new Map([
      [102, { axisKey: 'LEMMA:H8247', nullP0: 4 / 31203, df: 4, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL' }],
      [103, { axisKey: 'WP:shqd', nullP0: 2 / 31203, df: 2, isPhysical: false, isExplicitCue: true, register: 'LINGUISTIC_GRAMMATICAL' }],
      [104, { axisKey: 'LXX:amygdalinos', nullP0: 3 / 31203, df: 3, isPhysical: false, isExplicitCue: false, register: 'TEXTUAL_WITNESS' }],
    ])),
    { delta3WayBits: 3.5 },
  );
  const structRhet = computeEPerpScore(
    makeDist('OT', [[102, 0.25]]),
    makeDist('OT', [[102, 0.25]]),
    makeMeta(new Map([[102, { axisKey: 'LEMMA:H8247', nullP0: 4 / 31203, df: 4, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL' }]])),
    { deltaSeqBits: 3.5 },
  );

  assert.ok(mediumSingle.axisFactor <= 0.30, `Medium-df single-axis factor (${mediumSingle.axisFactor}) must be heavily damped`);
  assert.ok(rareSingle.singleAxisFloor >= 0.90, `Rare single-channel (df=4) must preserve floor >= 0.90 (got ${rareSingle.singleAxisFloor})`);
  assert.ok(rareSingle.ePerpBits > mediumSingle.ePerpBits * 3.0, `Rare single-channel (${rareSingle.ePerpBits}) must crush medium-df H1817 (${mediumSingle.ePerpBits})`);
  assert.ok(multiTextual.ePerpBits > rareSingle.ePerpBits, 'Multi-axis convergence must outrank single-axis');
  assert.equal(multiTextual.dominantRegister, 'TEXTUAL_WITNESS');
  assert.equal(rareSingle.dominantRegister, 'LINGUISTIC_GRAMMATICAL');
  assert.equal(structRhet.dominantRegister, 'STRUCTURAL_RHETORICAL');

  // 2. Physical cap <= 0.15 * rawTextualBits (when textual present) and PHYSICAL_ANALOGICAL register when physical-only
  const physAndText = computeEPerpScore(
    makeDist('OT', [[101, 0.25], [201, 0.45], [202, 0.45]]),
    makeDist('NT', [[101, 0.25], [201, 0.45], [202, 0.45]]),
    makeMeta(new Map([
      [101, { axisKey: 'LEMMA:H5216', nullP0: 30 / 31203, df: 30, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL' }],
      [201, { axisKey: 'PHYS:lamp_fuel', nullP0: 10 / 31203, df: 10, isPhysical: true, isExplicitCue: false, register: 'PHYSICAL_ANALOGICAL' }],
      [202, { axisKey: 'PHYS:vessel', nullP0: 15 / 31203, df: 15, isPhysical: true, isExplicitCue: false, register: 'PHYSICAL_ANALOGICAL' }],
    ])),
  );
  assert.ok(
    physAndText.physicalBitsCapped <= 0.15 * physAndText.rawTextualBits + 1e-3,
    `Physical contribution (${physAndText.physicalBitsCapped}) must respect <= 0.15 * rawTextual (${physAndText.rawTextualBits})`,
  );
  const physOnly = computeEPerpScore(
    makeDist('OT', [[201, 0.3], [202, 0.3]]),
    makeDist('NT', [[201, 0.3], [202, 0.3]]),
    makeMeta(new Map([
      [201, { axisKey: 'PHYS:lamp_fuel', nullP0: 15 / 31203, df: 15, isPhysical: true, isExplicitCue: false, register: 'PHYSICAL_ANALOGICAL' }],
      [202, { axisKey: 'PHYS:vessel', nullP0: 25 / 31203, df: 25, isPhysical: true, isExplicitCue: false, register: 'PHYSICAL_ANALOGICAL' }],
    ])),
  );
  assert.ok(physOnly.physicalBitsCapped <= 1.5 + 1e-6);
  assert.equal(physOnly.dominantRegister, 'PHYSICAL_ANALOGICAL');

  // 3. Co-hyponym 0.65 correlation damping lowers nEff when co-hyponyms compete alongside an independent axis
  const coHyp = computeEPerpScore(
    makeDist('OT', [[300, 0.25], [301, 0.2], [302, 0.2], [303, 0.2], [304, 0.2]]),
    makeDist('OT', [[300, 0.25], [301, 0.2], [302, 0.2], [303, 0.2], [304, 0.2]]),
    makeMeta(new Map([
      [300, { axisKey: 'XREF:explicit', nullP0: 5 / 31203, df: 5, isPhysical: false, isExplicitCue: true, register: 'TEXTUAL_WITNESS' }],
      [301, { axisKey: 'LEX_SYN:H2617:a', nullP0: 40 / 31203, df: 40, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL', cohyponymGroup: 'grp_mercy' }],
      [302, { axisKey: 'LEX_SYN:H7356:b', nullP0: 50 / 31203, df: 50, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL', cohyponymGroup: 'grp_mercy' }],
      [303, { axisKey: 'LEX_SYN:H2580:c', nullP0: 60 / 31203, df: 60, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL', cohyponymGroup: 'grp_mercy' }],
      [304, { axisKey: 'LEX_SYN:H0571:d', nullP0: 70 / 31203, df: 70, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL', cohyponymGroup: 'grp_mercy' }],
    ])),
  );
  const indep = computeEPerpScore(
    makeDist('OT', [[300, 0.25], [301, 0.2], [302, 0.2], [303, 0.2], [304, 0.2]]),
    makeDist('OT', [[300, 0.25], [301, 0.2], [302, 0.2], [303, 0.2], [304, 0.2]]),
    makeMeta(new Map([
      [300, { axisKey: 'XREF:explicit', nullP0: 5 / 31203, df: 5, isPhysical: false, isExplicitCue: true, register: 'TEXTUAL_WITNESS' }],
      [301, { axisKey: 'LEX_SYN:H2617:a', nullP0: 40 / 31203, df: 40, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL' }],
      [302, { axisKey: 'LEX_SYN:H7356:b', nullP0: 50 / 31203, df: 50, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL' }],
      [303, { axisKey: 'LEX_SYN:H2580:c', nullP0: 60 / 31203, df: 60, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL' }],
      [304, { axisKey: 'LEX_SYN:H0571:d', nullP0: 70 / 31203, df: 70, isPhysical: false, isExplicitCue: false, register: 'LINGUISTIC_GRAMMATICAL' }],
    ])),
  );
  assert.ok(coHyp.nEff < indep.nEff, `Co-hyponym damping must reduce nEff (${coHyp.nEff} < ${indep.nEff})`);

  // 4. Live session PPR pair: Jer 1:11 (19074) <-> Jer 1:12 (19075) beats Gen 19:10 (468) <-> Ezek 41:23 (21666)
  const session = makeFsSession();
  const strongsOf = async (vid) => {
    const vv = await session.getVerse(vid);
    return (vv?.toks || []).filter((t) => !t.is_func && t.s).map((t) => t.s);
  };
  const [s19074, s19075, s468, s21666] = await Promise.all([
    strongsOf(19074),
    strongsOf(19075),
    strongsOf(468),
    strongsOf(21666),
  ]);
  const [almondPair, doorTrap] = await Promise.all([
    scoreV3EPerpPair(session, [19074], s19074, [19075], s19075),
    scoreV3EPerpPair(session, [468], s468, [21666], s21666),
  ]);
  assert.ok(almondPair && doorTrap, 'Live session scoreV3EPerpPair must return results');
  assert.ok(almondPair.ePerpBits > doorTrap.ePerpBits, `Jer 1:11<->1:12 (${almondPair.ePerpBits}) must outrank NEG6 door trap (${doorTrap.ePerpBits})`);
  assert.ok(doorTrap.nEff < almondPair.nEff && doorTrap.pNullApprox > 0.05, `NEG6 door trap must stay non-significant (${doorTrap.ePerpBits}, p=${doorTrap.pNullApprox})`);
});

test('G4.2: Intermediate bridge pivots & Typed Conductance PPR subgraph proofs (incl. C10 rejection)', async () => {
  const session = makeFsSession();
  const pivots = await findV3BridgePivots(
    session,
    [{ vids: [], strongs: ['H8247'] }, { vids: [], strongs: ['H8245'] }],
    8,
  );
  assert.ok(pivots.length > 0, 'findV3BridgePivots(H8247, H8245) must surface intermediate pivots');
  assert.ok(pivots.some(p => p.vid === 21141 || p.vid === 21142 || String(p.ref).includes('Jeremiah 1:')), 'Pivots should include Jer 1:11-12');

  // Subgraph positive proof: Adam-Ground-Blood
  const adamSubgraph = await corpusRpc('discover_subgraph_v1', {
    anchors: ['H0120', 'H1818', 'H0127'],
    max_hops: 2,
  });
  assert.equal(adamSubgraph.all_endpoints_connected, true, 'Adam-Ground-Blood anchors must be connected');
  assert.ok((adamSubgraph.edges || []).length >= 2, 'Subgraph must return typed edges');
  assertNoRestrictedKeys(adamSubgraph, 'discover_subgraph_v1(adam)');

  // Subgraph negative control C10: H1904 (Heikal) / H3629 (Kilyah kidneys) must NOT connect
  const c10 = await corpusRpc('discover_subgraph_v1', {
    anchors: ['H1904', 'H3629'],
    max_hops: 2,
  });
  assert.equal(c10.all_endpoints_connected, false, 'C10 negative control H1904/H3629 must remain unconnected');

  // Discovery v2 integration with v3 BMW + E_perp metadata + expand_id
  const disc = await corpusRpc('discover_biblical_connections_v2', {
    query: 'H8247 H8245',
    limit: 8,
  });
  assert.equal(disc.status, 'ok');
  const allConns = [
    ...(disc.strongest_connections || []),
    ...(disc.lexical_and_symbolic_bridges || []),
    ...(disc.all || []),
  ];
  assert.ok(allConns.some(c => JSON.stringify(c).includes('Jeremiah 1:11') || c.expand_id?.includes('v3')), 'v3 BMW/E_perp must surface Jer 1:11 or v3 expand_id');
  assertNoRestrictedKeys(disc, 'discover_biblical_connections_v2');
});

test('G4.3: All 7 new v3 Worker RPCs pass end-to-end & preserve CC BY 4.0 / zero restricted keys', async () => {
  // 1. lxx_concordance_v3
  const lxx = await corpusRpc('lxx_concordance_v3', { strongs: 'H0241', shift_type: 'LxxTranslationShift', limit: 10 });
  assert.equal(lxx.status, 'ok');
  assert.equal(lxx.swete_included, false);
  assert.ok(String(lxx.license || '').includes('CC BY 4.0'));
  assert.ok((lxx.matching_shifts || []).length >= 1, 'lxx_concordance_v3(H0241, LxxTranslationShift) must surface matching shifts');
  const lxxPs40 = await corpusRpc('lxx_concordance_v3', { passage: 'Ps 40:6', shift_type: 'LxxTranslationShift' });
  assert.equal(lxxPs40.status, 'ok');
  assert.ok((lxxPs40.alignments?.[0]?.shifts || []).some(s => s.h_bs === 'H0241'), 'lxx_concordance_v3(Ps 40:6) must surface H0241 shift');
  assertNoRestrictedKeys(lxx, 'lxx_concordance_v3');

  // 2. tri_textual_diff_v3 (Heb 10:5 / Ps 40:6, 1 Pet 2:6 / Isa 28:16, Acts 15:16 / Amos 9:11)
  const heb10 = await corpusRpc('tri_textual_diff_v3', { target: 'Heb 10:5', source: 'Ps 40:6' });
  assert.equal(heb10.status, 'ok');
  assert.ok(heb10.sources.includes('Psalms 40:6'));
  assert.ok(heb10.evidence_bits > 0);
  assert.ok(Object.keys(heb10.lxx_shifts_in_sources || {}).length >= 1, 'Heb 10:5/Ps 40:6 must surface LXX shift');

  const heb10Auto = await corpusRpc('tri_textual_diff_v3', { target: 'Heb 10:5' });
  assert.equal(heb10Auto.status, 'ok');
  assert.ok((heb10Auto.candidate_sources || []).some(c => c.vid === 14568 || c.ref === 'Psalms 40:6'));

  const pet26 = await corpusRpc('tri_textual_diff_v3', { target: '1 Pet 2:6', source: 'Isa 28:16' });
  assert.equal(pet26.status, 'ok');
  assert.ok(pet26.sources.includes('Isaiah 28:16'));

  const acts15 = await corpusRpc('tri_textual_diff_v3', { target: 'Acts 15:16', source: 'Amos 9:11' });
  assert.equal(acts15.status, 'ok');
  assert.ok(acts15.sources.includes('Amos 9:11'));
  assertNoRestrictedKeys(heb10, 'tri_textual_diff_v3');

  // 3. clause_role_query_v3
  const clNeg = await corpusRpc('clause_role_query_v3', { polarity: 'NEG', limit: 8 });
  assert.equal(clNeg.status, 'ok');
  assert.equal(clNeg.mode, 'corpus_role_search');
  assert.ok(clNeg.returned >= 1);
  for (const m of clNeg.matches) {
    assert.ok(m.clauses.some(c => c.polarity === 'negative' || (c.neg_markers?.length ?? 0) > 0), 'Every returned clause match must be negative polarity');
  }
  const clGen = await corpusRpc('clause_role_query_v3', { passage: 'Genesis 1:1' });
  assert.equal(clGen.status, 'ok');
  assert.equal(clGen.mode, 'passage_clauses');
  assert.ok(clGen.total_clauses >= 1);
  assertNoRestrictedKeys(clNeg, 'clause_role_query_v3');

  // 4. sequence_parallels_v3 (both real passage RPC & synthetic CONCORDANT vs INVERSION + 1:2 bundling)
  const seqRpc = await corpusRpc('sequence_parallels_v3', { source: 'Gen 1:1-3', target: 'John 1:1-3' });
  assert.equal(seqRpc.status, 'ok');
  assert.ok(seqRpc.source_clause_count >= 3);
  assert.ok((seqRpc.alignments || []).length >= 1);
  assertNoRestrictedKeys(seqRpc, 'sequence_parallels_v3');

  const concordA = [
    { id: 'a1', vid: 1, ref: 'A1', concepts: ['C_XL:light', 'C_XL:speak'], roles: [{ role: 'Pred', concept: 'C_XL:create' }], polarity: 'POS' },
    { id: 'a2', vid: 2, ref: 'A2', concepts: ['C_XL:waters', 'C_XL:divide'], roles: [{ role: 'Pred', concept: 'C_XL:separate' }], polarity: 'POS' },
    { id: 'a3', vid: 3, ref: 'A3', concepts: ['C_XL:luminaries', 'C_XL:heaven'], roles: [{ role: 'Pred', concept: 'C_XL:appoint' }], polarity: 'POS' },
    { id: 'a4', vid: 4, ref: 'A4', concepts: ['C_XL:human', 'C_XL:blessing'], roles: [{ role: 'Pred', concept: 'C_XL:bless' }], polarity: 'POS' },
  ];
  const invertedB = [
    { id: 'b1', vid: 10, ref: 'B1', concepts: ['C_XL:human', 'C_XL:blessing'], roles: [{ role: 'Pred', concept: 'C_XL:bless' }], polarity: 'NEG' },
    { id: 'b2', vid: 11, ref: 'B2', concepts: ['C_XL:luminaries'], roles: [{ role: 'Pred', concept: 'C_XL:appoint' }], polarity: 'NEG' },
    { id: 'b3', vid: 12, ref: 'B3', concepts: ['C_XL:heaven'], roles: [], polarity: 'NEG' },
    { id: 'b4', vid: 13, ref: 'B4', concepts: ['C_XL:waters', 'C_XL:divide'], roles: [{ role: 'Pred', concept: 'C_XL:separate' }], polarity: 'NEG' },
    { id: 'b5', vid: 14, ref: 'B5', concepts: ['C_XL:light', 'C_XL:speak'], roles: [{ role: 'Pred', concept: 'C_XL:create' }], polarity: 'NEG' },
  ];
  const invRes = alignClauseSequencesPiecewise(concordA, invertedB, { permutations: 64 });
  assert.ok(invRes.blocks.some(b => b.mode === 'INVERSION'), 'Must detect INVERSION polarity flip');
  assert.ok(invRes.blocks.some(b => b.orientation === 'reversed'), 'Must detect reversed chiasm/de-creation ordering');
  assert.ok(invRes.blocks.some(b => b.pairs.some(p => p.aIndices.length > 1 || p.bIndices.length > 1)), 'Must exercise 1:2 / 2:1 clause bundling');

  // 5. wordplay_scan_v3
  const wpPass = await corpusRpc('wordplay_scan_v3', { passage: 'Jer 1:11-12' });
  assert.equal(wpPass.status, 'ok');
  assert.ok((wpPass.consonantal_candidates || []).some(c =>
    (c.strongsA === 'H8247' && c.strongsB === 'H8245') || (c.strongsA === 'H8245' && c.strongsB === 'H8247')
  ), 'wordplay_scan_v3(Jer 1:11-12) must surface H8247/H8245');
  assertNoRestrictedKeys(wpPass, 'wordplay_scan_v3');

  // 6. set_combine_v3
  const sc = await corpusRpc('set_combine_v3', { include: ['H2617', 'H0571'], testament: 'OT', limit: 10 });
  assert.equal(sc.status, 'ok');
  assert.equal(sc.total_matched, 33);
  assert.ok(sc.verses[0]?.expand_id?.startsWith('v3:bmw:'));
  assertNoRestrictedKeys(sc, 'set_combine_v3');

  // 7. expand_clue_v3 (clue vs evidence vs full progressive hydration)
  const expClue = await corpusRpc('expand_clue_v3', { expand_id: sc.verses[0].expand_id, detail: 'clue' });
  const expFull = await corpusRpc('expand_clue_v3', { expand_id: sc.verses[0].expand_id, detail: 'full' });
  assert.equal(expClue.status, 'ok');
  assert.equal(expClue.verse?.en, undefined, 'detail=clue must stay compact without full verse text');
  assert.equal(expFull.status, 'ok');
  assert.ok(typeof expFull.verse?.en === 'string' && expFull.verse.en.length > 0, 'detail=full must include verse text');
  assert.ok(Array.isArray(expFull.clauses), 'detail=full must include clauses');
  assertNoRestrictedKeys(expFull, 'expand_clue_v3');
});

test('G4.4: 100% Negative Rejection (NEG1-NEG8 + adversarial chiasm, wordplay, homograph, hub & false-quote controls)', async () => {
  const bmw = parseBmwIndex(fs.readFileSync(path.join(V3_DIR, 'index/postings-bmw.bin')));

  // NEG1: False shared roots melach (H4417 salt) / melek (H4428 king)
  const neg1 = await corpusRpc('wordplay_scan_v3', { a: 'H4417', b: 'H4428' });
  assert.equal(neg1.proven_common_root, false, 'NEG1: melach/melek must not claim common root');
  assert.equal(neg1.attested_textual_wordplay, false, 'NEG1: melach/melek must not be attested wordplay');
  assert.equal(neg1.wordplay_candidate, false, 'NEG1: melach/melek must not pass wordplay candidate threshold');

  // NEG2: Homographs H5869 (spring vs eye) & H3722 (Gen 6:14 pitch vs atone)
  const springTerm = lookupTerm(bmw, 'H5869#spring');
  assert.ok(springTerm && springTerm.df > 0 && springTerm.df < 60, 'NEG2: H5869#spring polyseme must remain isolated from general eye df');
  const gen614 = await corpusRpc('get_passage_compact_v1', { book: 1, chapter: 6, verse: 14 });
  const gen614Text = JSON.stringify(gen614?.verses || []).toLowerCase();
  assert.ok(!gen614Text.includes('atone'), 'NEG2: Gen 6:14 H3722 pitch must not leak atone');

  // NEG3: Hebrew prefix stopwords excluded from BMW, and high-df function hubs blocked by df>450 bridge guard
  assert.equal(lookupTerm(bmw, 'H9002'), null, 'NEG3: H9002 prefix stopword must be excluded from BMW');
  const session = makeFsSession();
  const hubPivots = await findV3BridgePivots(session, [{ vids: [], strongs: ['H0853'] }, { vids: [], strongs: ['G2532'] }], 5);
  assert.ok(!hubPivots.some(p => p.bridgedAxes?.some(a => /:(H0853|G2532|G0846)$/.test(a))), 'NEG3: high-df function hubs must not act as bridged axes');

  // NEG4: C10 negative control H1904 / H3629
  const neg4 = await corpusRpc('discover_subgraph_v1', { anchors: ['H1904', 'H3629'], max_hops: 2 });
  assert.equal(neg4.all_endpoints_connected, false, 'NEG4: C10 H1904/H3629 must return all_endpoints_connected=false');

  // NEG5: Single-axis hub collision ADV-HUB-01 (Gen 19:10 vs Ezek 41:23 H1817)
  const [g468, e21666] = await Promise.all([session.getVerse(468), session.getVerse(21666)]);
  const gs = (g468?.toks || []).filter((t) => !t.is_func && t.s).map((t) => t.s);
  const es = (e21666?.toks || []).filter((t) => !t.is_func && t.s).map((t) => t.s);
  const neg5 = await scoreV3EPerpPair(session, [468], gs, [21666], es);
  assert.ok(neg5 && neg5.pNullApprox > 0.05 && neg5.dominantRegister !== 'TEXTUAL_WITNESS', `NEG5: Gen 19:10/Ezek 41:23 must stay non-significant (got ${neg5?.ePerpBits}, p=${neg5?.pNullApprox})`);

  // NEG6: Pseudo-refrain chiasms (Amos 1:3-5, Ps 136:1-6, Gen 5:1-6) must NOT trigger reversed inversion significance
  for (const p of ['Amos 1:3-5', 'Ps 136:1-6', 'Gen 5:1-6']) {
    const seq = await corpusRpc('sequence_parallels_v3', { source: p, target: p });
    const hasSigReversed = (seq.alignments || []).some(a => a.has_reversed_order && a.p_null <= 0.05);
    assert.equal(hasSigReversed, false, `NEG6: refrain passage ${p} must not emit significant reversed chiasm`);
  }

  // NEG7: Suffix / 2-consonant wordplay traps (ADV-WP-01..06)
  for (const [a, b] of [
    ['Χριστός', 'ἄχρηστος'],
    ['φρονεῖν', 'μέτρον'],
    ['δεσμοῖς', 'Ὀνήσιμον'],
    ['מָרוֹת', 'רְתֹם'],
    ['וְהָיָה', 'יְהוָה'],
    ['κρατέω', 'περιπατέω'],
  ]) {
    const res = await corpusRpc('wordplay_scan_v3', { a, b });
    assert.equal(res.attested_textual_wordplay, false, `NEG7: ${a}/${b} must not be attested wordplay`);
    assert.equal(res.wordplay_candidate, false, `NEG7: ${a}/${b} must not be a wordplay candidate (got score=${res.formal_score})`);
  }

  // NEG8: False quote (John 1:1-3 vs Ezekiel 41:23)
  const neg8 = await corpusRpc('tri_textual_diff_v3', { target: 'John 1:1-3', source: 'Ezekiel 41:23' });
  assert.equal(neg8.status, 'no_alignment', 'NEG8: John 1:1-3 vs Ezek 41:23 must be rejected');
});
