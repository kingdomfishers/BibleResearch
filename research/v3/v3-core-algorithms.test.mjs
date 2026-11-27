// Unit tests for pure-TS v3-binary-index.ts, v3-scorer.ts, and v3-verifiers.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BMW_FLAG_DENSE,
  BMW_MAGIC,
  BITSET_WORDS,
  NUM_BLOCKS,
  NUM_VERSES,
  blockMaxWandTopK,
  hashKey64,
  intersectTerms,
  lookupPprTop64,
  lookupCsrEdges,
  parseBmwIndex,
  parseCsrPart,
  parsePprShard,
  PPR_MAGIC,
  CSR_MAGIC,
} from '../../src/relationships/v3-binary-index.ts';
import {
  computeEPerpScore,
  rankBridgePivots,
  selectDiversifiedClues,
} from '../../src/relationships/v3-scorer.ts';
import {
  alignClauseSequencesPiecewise,
  alignTriTextualQuote,
} from '../../src/relationships/v3-verifiers.ts';

function buildTestBmw(termsMap) {
  // termsMap: Map<key, { vids: number[], idf: number, flags?: number }>
  const entries = [...termsMap.entries()].map(([key, val]) => ({
    key,
    ...hashKey64(key),
    vids: [...val.vids].sort((a, b) => a - b),
    idf: val.idf,
    extraFlags: val.flags || 0,
  }));
  entries.sort((a, b) => (a.hi !== b.hi ? a.hi - b.hi : a.lo - b.lo));

  const headerSize = 64;
  const dirSize = entries.length * 20;
  const denseChunks = [];
  const sparseChunks = [];
  const bmwChunks = [];
  let denseOff = 0;
  let sparseOff = 0;
  let bmwOff = 0;

  const dirMeta = [];
  for (const e of entries) {
    const isDense = e.vids.length >= 64;
    const flags = (isDense ? BMW_FLAG_DENSE : 0) | e.extraFlags;
    let payloadOffset = 0;
    if (isDense) {
      payloadOffset = denseOff;
      const words = new Uint32Array(BITSET_WORDS);
      for (const vid of e.vids) {
        const idx = vid - 1;
        words[idx >>> 5] |= 1 << (idx & 31);
      }
      denseChunks.push(new Uint8Array(words.buffer));
      denseOff += BITSET_WORDS * 4;
    } else {
      payloadOffset = sparseOff;
      const bytes = [];
      let prev = 0;
      for (const vid of e.vids) {
        const idx = vid - 1;
        let d = idx - prev;
        prev = idx;
        while (d >= 0x80) {
          bytes.push((d & 0x7f) | 0x80);
          d >>>= 7;
        }
        bytes.push(d);
      }
      const arr = Uint8Array.from(bytes);
      sparseChunks.push(arr);
      sparseOff += arr.byteLength;
    }

    const blocks = new Set(e.vids.map((v) => (v - 1) >>> 6));
    const sortedBlocks = [...blocks].sort((a, b) => a - b);
    const bmwBuf = new Uint8Array(2 + sortedBlocks.length * 4);
    const bv = new DataView(bmwBuf.buffer);
    bv.setUint16(0, sortedBlocks.length, true);
    const idfQ8 = Math.min(255, Math.round(e.idf * 20));
    for (let i = 0; i < sortedBlocks.length; i++) {
      bv.setUint16(2 + i * 4, sortedBlocks[i], true);
      bv.setUint8(2 + i * 4 + 2, idfQ8);
      bv.setUint8(2 + i * 4 + 3, 20); // 0.50 relational bonus
    }
    dirMeta.push({ ...e, flags, idfQ8, payloadOffset, bmwOffset: bmwOff });
    bmwChunks.push(bmwBuf);
    bmwOff += bmwBuf.byteLength;
  }

  const denseOffset = headerSize + dirSize;
  const sparseOffset = denseOffset + denseOff;
  const bmwOffset = sparseOffset + sparseOff;
  const totalLen = bmwOffset + bmwOff;
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) out[i] = BMW_MAGIC.charCodeAt(i);
  view.setUint32(8, 3, true);
  view.setUint32(12, NUM_VERSES, true);
  view.setUint32(16, NUM_BLOCKS, true);
  view.setUint32(20, dirMeta.length, true);
  view.setUint32(24, headerSize, true);
  view.setUint32(28, denseOffset, true);
  view.setUint32(32, sparseOffset, true);
  view.setUint32(36, bmwOffset, true);

  for (let i = 0; i < dirMeta.length; i++) {
    const m = dirMeta[i];
    const off = headerSize + i * 20;
    view.setUint32(off, m.lo, true);
    view.setUint32(off + 4, m.hi, true);
    view.setUint16(off + 8, m.vids.length, true);
    view.setUint8(off + 10, m.flags);
    view.setUint8(off + 11, m.idfQ8);
    view.setUint32(off + 12, m.payloadOffset, true);
    view.setUint32(off + 16, m.bmwOffset, true);
  }
  let cur = denseOffset;
  for (const c of denseChunks) { out.set(c, cur); cur += c.byteLength; }
  for (const c of sparseChunks) { out.set(c, cur); cur += c.byteLength; }
  for (const c of bmwChunks) { out.set(c, cur); cur += c.byteLength; }
  return out;
}

test('v3-binary-index: hybrid dense+sparse bitset intersection & BMW Top-K parity', () => {
  const denseVids = Array.from({ length: 80 }, (_, i) => i * 100 + 1);
  const sparseVids = [1, 201, 401, 999];
  const exclVids = [201];
  const bin = buildTestBmw(new Map([
    ['S:H7760', { vids: denseVids, idf: 4.0 }],
    ['S:H0068', { vids: sparseVids, idf: 6.5 }],
    ['S:EXCL', { vids: exclVids, idf: 2.0 }],
  ]));
  const idx = parseBmwIndex(bin);
  assert.deepEqual(intersectTerms(idx, ['S:H7760', 'S:H0068'], ['S:EXCL']), [1, 401]);
  const hits = blockMaxWandTopK(idx, ['S:H7760', 'S:H0068'], 5, 1.0);
  assert.equal(hits[0].matchedCount, 2);
  assert.ok(hits.slice(0, 3).map((h) => h.vid).includes(201));
});

test('v3-binary-index: PPR Top-64 and CSR shard binary lookup', () => {
  const pprBuf = new Uint8Array(32 + 12 + 14);
  const pv = new DataView(pprBuf.buffer);
  for (let i = 0; i < 8; i++) pprBuf[i] = PPR_MAGIC.charCodeAt(i);
  pv.setUint32(8, 3, true);
  pv.setUint32(16, 32, true);
  pv.setUint32(20, 1, true);
  pv.setUint32(24, 32, true);
  pv.setUint32(28, 44, true);
  pv.setUint32(32, 31205, true);
  pv.setUint32(36, 0, true);
  pv.setUint16(40, 2, true);
  pv.setUint32(44, 1500, true);
  pv.setUint16(48, Math.round(-Math.log(0.25) * 4096), true);
  pprBuf[50] = 0b00101;
  pv.setUint32(51, 28000, true);
  pv.setUint16(55, Math.round(-Math.log(0.10) * 4096), true);
  pprBuf[57] = 0b00010;
  const ppr = parsePprShard(pprBuf);
  const entries = lookupPprTop64(ppr, 31205);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].targetNodeId, 1500);
  assert.ok(Math.abs(entries[0].prob - 0.25) < 0.002);

  const csrBuf = new Uint8Array(32 + 12 + 8);
  const cv = new DataView(csrBuf.buffer);
  for (let i = 0; i < 8; i++) csrBuf[i] = CSR_MAGIC.charCodeAt(i);
  cv.setUint32(8, 3, true);
  cv.setUint32(16, 16, true);
  cv.setUint32(20, 1, true);
  cv.setUint32(24, 32, true);
  cv.setUint32(28, 44, true);
  cv.setUint32(32, 31205, true);
  cv.setUint32(36, 0, true);
  cv.setUint16(40, 1, true);
  cv.setUint32(44, 1500, true);
  csrBuf[48] = 2; // LXX
  csrBuf[49] = 1;
  cv.setUint16(50, 32768, true);
  const csr = parseCsrPart(csrBuf);
  const edges = lookupCsrEdges(csr, 31205);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].partition, 2);
});

test('v3-scorer: E_perp crushes medium-df single-axis NEG6 while preserving rare single-channel & multi-axis', () => {
  const neg6A = { anchorVids: new Set([491]), testament: 'OT', tokenCount: 16, mass: new Map([[32001, 0.28], [32002, 0.05]]) };
  const neg6B = { anchorVids: new Set([21555]), testament: 'OT', tokenCount: 4, mass: new Map([[32001, 0.28], [32002, 0.05]]) };
  const metaMap = new Map([
    [32001, { axisKey: 'AXIS:DOOR', nullP0: 0.0025, df: 78 }],
    [32002, { axisKey: 'AXIS:DOOR', nullP0: 0.003, df: 60 }], // correlated xref inside same AXIS:DOOR
    [32010, { axisKey: 'AXIS:ALMOND', nullP0: 0.0001, df: 4, isExplicitCue: true }],
    [32011, { axisKey: 'AXIS:STONE', nullP0: 0.002, df: 120 }],
    [32012, { axisKey: 'AXIS:LAY', nullP0: 0.004, df: 450 }],
    [32013, { axisKey: 'AXIS:CORNER', nullP0: 0.0008, df: 35 }],
    [32014, { axisKey: 'AXIS:TRUST', nullP0: 0.001, df: 55 }],
  ]);

  const neg6Res = computeEPerpScore(neg6A, neg6B, (id) => metaMap.get(id) ?? null);
  assert.equal(neg6Res.nEff, 1.0);
  assert.ok(neg6Res.axisFactor < 0.30, `NEG6 single medium-df axisFactor must damp heavily, got ${neg6Res.axisFactor}`);

  // Rare single-channel (df=4, explicit cue) must be preserved
  const rareA = { anchorVids: new Set([18900]), testament: 'OT', tokenCount: 12, mass: new Map([[32010, 0.35]]) };
  const rareB = { anchorVids: new Set([18901]), testament: 'OT', tokenCount: 10, mass: new Map([[32010, 0.35]]) };
  const rareRes = computeEPerpScore(rareA, rareB, (id) => metaMap.get(id) ?? null);
  assert.ok(rareRes.axisFactor >= 0.90, `Rare single-channel floor must preserve discovery, got ${rareRes.axisFactor}`);
  assert.ok(rareRes.ePerpBits > neg6Res.ePerpBits * 1.8);

  // Multi-axis cross-testament convergence
  const posA = { anchorVids: new Set([790]), testament: 'OT', tokenCount: 18, mass: new Map([[32011, 0.2], [32012, 0.15], [32013, 0.15], [32014, 0.1]]) };
  const posB = { anchorVids: new Set([30405]), testament: 'NT', tokenCount: 20, mass: new Map([[32011, 0.2], [32012, 0.15], [32013, 0.15], [32014, 0.1]]) };
  const posRes = computeEPerpScore(posA, posB, (id) => metaMap.get(id) ?? null);
  assert.ok(posRes.nEff > 3.0);
  assert.equal(posRes.axisFactor, 1);
  assert.ok(posRes.ePerpBits > 12);

  // Pivot ranking & submodular diversification
  const pivots = rankBridgePivots([
    { vid: 17822, ref: 'Isaiah 8:14', anchorMasses: [0.18, 0.22], bridgedAxes: ['STONE', 'ROCK', 'SANCTUARY'], rarityGain: 4.5 },
    { vid: 500, ref: 'Generic', anchorMasses: [0.10, 0.10], bridgedAxes: ['STONE'], rarityGain: 1.5 },
  ]);
  assert.equal(pivots[0].ref, 'Isaiah 8:14');

  const div = selectDiversifiedClues([
    { id: 'c1', score: 10, axes: ['A'], passages: [1], register: 'TEXTUAL_WITNESS' },
    { id: 'c2', score: 9.8, axes: ['A'], passages: [1], register: 'TEXTUAL_WITNESS' },
    { id: 'c3', score: 9.0, axes: ['B'], passages: [2], register: 'STRUCTURAL_RHETORICAL' },
  ], 2);
  assert.deepEqual(div.map((d) => d.id), ['c1', 'c3']);
});

test('v3-verifiers: 3-way Halo SW detects composite splices + MT vs LXX divergences', () => {
  // Simulate 1 Pet 2:6-8 splicing Isa 28:16 + Isa 8:14
  const ntTokens = [
    { idx: 0, surface: 'Ἰδοὺ', lemma: 'ἰδού', isFunction: false },
    { idx: 1, surface: 'τίθημι', lemma: 'τίθημι', isFunction: false },
    { idx: 2, surface: 'ἐν', lemma: 'ἐν', isFunction: true },
    { idx: 3, surface: 'Σιὼν', lemma: 'Σιών', isFunction: false },
    { idx: 4, surface: 'λίθον', lemma: 'λίθος', isFunction: false },
    { idx: 5, surface: 'ἀκρογωνιαῖον', lemma: 'ἀκρογωνιαῖος', isFunction: false },
    { idx: 6, surface: 'καὶ', lemma: 'καί', isFunction: true },
    { idx: 7, surface: 'πέτρα', lemma: 'πέτρα', isFunction: false },
    { idx: 8, surface: 'σκανδάλου', lemma: 'σκάνδαλον', isFunction: false },
  ];
  const cands = [
    {
      ref: 'Isaiah 28:16',
      vid: 18181,
      slots: [
        { lxxIdx: 0, lxxSurface: 'ἐμβαλῶ', lxxLemma: 'ἐμβάλλω', lxxIdf: 3.5, mtIdx: 0 },
        { lxxIdx: 1, lxxSurface: 'εἰς', lxxLemma: 'εἰς', lxxIdf: 0.5, isFunction: true, mtIdx: 1 },
        { lxxIdx: 2, lxxSurface: 'Σιὼν', lxxLemma: 'Σιών', lxxIdf: 4.1, mtIdx: 2 },
        { lxxIdx: 3, lxxSurface: 'λίθον', lxxLemma: 'λίθος', lxxIdf: 2.8, mtIdx: 3 },
        { lxxIdx: 4, lxxSurface: 'ἀκρογωνιαῖον', lxxLemma: 'ἀκρογωνιαῖος', lxxIdf: 6.2, mtIdx: 4, divergenceKind: 'lexical_theological_shift' },
      ],
    },
    {
      ref: 'Isaiah 8:14',
      vid: 17822,
      slots: [
        { lxxIdx: 0, lxxSurface: 'πέτρας', lxxLemma: 'πέτρα', lxxIdf: 3.4, mtIdx: 0 },
        { lxxIdx: 1, lxxSurface: 'πτώματι', lxxLemma: 'πτῶμα', lxxIdf: 4.2, mtIdx: 1, mtEquivLemmas: ['σκάνδαλον'] },
      ],
    },
  ];
  const res = alignTriTextualQuote(ntTokens, cands);
  assert.ok(res);
  assert.deepEqual(res.sources, ['Isaiah 28:16', 'Isaiah 8:14']);
  assert.equal(res.tokens[1].witness, 'nt_adaptation'); // τίθημι in halo
  assert.equal(res.tokens[5].witness, 'agrees_lxx_against_mt'); // ἀκρογωνιαῖον
  assert.equal(res.tokens[8].witness, 'agrees_mt_against_lxx'); // σκανδάλου matches MT equiv
  assert.ok(res.summary.composite_splice >= 1);
});

test('v3-verifiers: SW^piece_pol aligns 1:2 bundled clauses & polarity inversion (de-creation)', () => {
  const gen1 = [
    { id: 'c1', vid: 1, concepts: ['C:CREATE', 'C:EARTH', 'C:FORMLESS'], roles: [], polarity: 'POS' },
    { id: 'c2', vid: 3, concepts: ['C:LIGHT'], roles: [], polarity: 'POS' },
    { id: 'c3', vid: 20, concepts: ['C:BIRD', 'C:SKY'], roles: [], polarity: 'POS' },
    { id: 'c4', vid: 26, concepts: ['C:HUMAN'], roles: [{ role: 'Subj', concept: 'C:HUMAN' }], polarity: 'POS' },
  ];
  const jer4 = [
    { id: 'j1', vid: 19060, concepts: ['C:EARTH', 'C:FORMLESS'], roles: [], polarity: 'POS' },
    { id: 'j2', vid: 19060, concepts: ['C:LIGHT'], roles: [], polarity: 'NEG' },
    { id: 'j3', vid: 19062, concepts: ['C:HUMAN'], roles: [{ role: 'Subj', concept: 'C:HUMAN' }], polarity: 'NEG' },
    { id: 'j4', vid: 19062, concepts: ['C:BIRD', 'C:SKY'], roles: [], polarity: 'NEG' },
  ];
  const align = alignClauseSequencesPiecewise(gen1, jer4, { permutations: 32 });
  assert.ok(align.raw_score > 3.0);
  assert.ok(align.blocks.some((b) => b.mode === 'INVERSION'));
  assert.ok(['antithetical_decreation', 'piecewise_mixed'].includes(align.arc_kind));

  // 1:2 bundling test (Deut 8:2 single clause -> Matt 4:1-2 two clauses)
  const deut = [
    { id: 'd1', vid: 5130, concepts: ['C:WILDERNESS', 'C:FORTY', 'C:TEST', 'C:HUNGER'], roles: [], polarity: 'POS' },
    { id: 'd2', vid: 5131, concepts: ['C:BREAD', 'C:WORD', 'C:GOD'], roles: [], polarity: 'POS' },
  ];
  const matt = [
    { id: 'm1', vid: 23225, concepts: ['C:WILDERNESS', 'C:TEST'], roles: [], polarity: 'POS' },
    { id: 'm2', vid: 23226, concepts: ['C:FORTY', 'C:HUNGER'], roles: [], polarity: 'POS' },
    { id: 'm3', vid: 23228, concepts: ['C:BREAD', 'C:WORD', 'C:GOD'], roles: [], polarity: 'POS' },
  ];
  const bundleAlign = alignClauseSequencesPiecewise(deut, matt, { permutations: 32 });
  assert.ok(bundleAlign.blocks[0].pairs.some((p) => p.bIndices.length === 2));
});
