/**
 * Synthetic Structural Intelligence Verification Suite for BibleResearch v4:
 * - BRV4MAC\0 R-MAC Index Build / Parse / Dual-Channel Stratified BMW Retrieval
 * - Biblical-SME (4-Rung Minimal Ascension, Tier-2 HO + Rung-3, Tier-0 Role Induction,
 *   Trickle-Down SES, Atomic Kernels, Bitmask Greedy + B&B MWIS, Connected-Component Gate,
 *   Conditional-Structure Permutation Null, Gentner 4-Quadrant, Candidate Inferences & Residuals)
 * - SEQL-Biblical Multi-Passage Generalization
 *
 * Uses strictly non-canonical synthetic CompactHreg fixtures (zero canonical verses).
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  buildRmacBmwIndex,
  extractRmacFeatures,
  parseRmacBmwIndex,
  queryRmacCandidates,
} from '../../src/relationships/v4-rmac-index.ts';
import {
  evaluateSmePair,
  runBiblicalSME,
  runSeqlGeneralization,
} from '../../src/relationships/v4-sme-engine.ts';

function makeSyntheticOracle({
  proximity = [],
  lxxPairs = [],
} = {}) {
  const strongsSet = new Set();
  for (const [a, b] of proximity) {
    strongsSet.add(a);
    strongsSet.add(b);
  }
  const idxToStrongs = Array.from(strongsSet).sort();
  const strongsToIdx = new Map(idxToStrongs.map((s, i) => [s, i]));

  const pairRecords = [];
  for (const [a, b, sim] of proximity) {
    const iA = strongsToIdx.get(a);
    const iB = strongsToIdx.get(b);
    const lo = Math.min(iA, iB);
    const hi = Math.max(iA, iB);
    pairRecords.push({
      key: ((lo << 16) | hi) >>> 0,
      simQ8: Math.max(0, Math.min(255, Math.round(sim * 255))),
    });
  }
  pairRecords.sort((x, y) => x.key - y.key);

  const pairKeys = new Uint32Array(pairRecords.length);
  const pairSims = new Uint8Array(pairRecords.length);
  for (let i = 0; i < pairRecords.length; i++) {
    pairKeys[i] = pairRecords[i].key;
    pairSims[i] = pairRecords[i].simQ8;
  }

  const lxxSet = new Set();
  for (const [a, b] of lxxPairs) {
    lxxSet.add(`${a}|${b}`);
    lxxSet.add(`${b}|${a}`);
  }

  return {
    strongsToIdx,
    idxToStrongs,
    pairKeys,
    pairSims,
    lookupProximitySim(bsA, bsB) {
      if (!bsA || !bsB) return 0;
      if (bsA === bsB) return 1.0;
      const iA = strongsToIdx.get(bsA);
      const iB = strongsToIdx.get(bsB);
      if (iA === undefined || iB === undefined) return 0;
      const lo = Math.min(iA, iB);
      const hi = Math.max(iA, iB);
      const target = ((lo << 16) | hi) >>> 0;
      let l = 0;
      let r = pairKeys.length - 1;
      while (l <= r) {
        const m = (l + r) >>> 1;
        if (pairKeys[m] < target) l = m + 1;
        else if (pairKeys[m] > target) r = m - 1;
        else return pairSims[m] / 255;
      }
      return 0;
    },
    sameConceptOrTipnr(pA, pB) {
      if (pA.tipnrId && pB.tipnrId && pA.tipnrId === pB.tipnrId) return true;
      if (pA.conceptId && pB.conceptId && pA.conceptId === pB.conceptId) return true;
      if (pA.strongs && pB.strongs && pA.strongs === pB.strongs) return true;
      return false;
    },
    isLxxLinked(bsA, bsB) {
      return lxxSet.has(`${bsA}|${bsB}`);
    },
  };
}

function mkPart(pid, strongs, conceptId, sort = 'ABSTRACT', valence = 0, tipnrId = '') {
  return {
    pid,
    strongs,
    conceptId,
    tipnrId,
    sort,
    valence,
    corefConf: 1.0,
    mentionVids: [40001],
  };
}

function mkEv(eid, strongs, conceptId, arch, argRoles, opts = {}) {
  return {
    eid,
    vid: opts.vid ?? 40001 + eid,
    strongs,
    conceptId,
    arch,
    pol: opts.pol ?? 'POS',
    isCausative: opts.isCausative ?? false,
    isExistential: opts.isExistential ?? false,
    isPassive: opts.isPassive ?? false,
    force: opts.force ?? 'ASSERT',
    valence: opts.valence ?? 0,
    idf: opts.idf ?? 6.5,
    promotedConceptId: opts.promotedConceptId ?? '',
    promotedStrongs: opts.promotedStrongs ?? '',
    argRoles,
  };
}

function mkHo(hid, hoType, fromEid, toEid, vid = 40001) {
  return { hid, hoType, fromEid, toEid, vid };
}

function verifyBijection(mappedPairs, getA, getB, label) {
  const seenA = new Set();
  const seenB = new Set();
  for (const m of mappedPairs) {
    const a = getA(m);
    const b = getB(m);
    assert.ok(!seenA.has(a), `${label}: duplicate base id ${a}`);
    assert.ok(!seenB.has(b), `${label}: duplicate target id ${b}`);
    seenA.add(a);
    seenB.add(b);
  }
}

const oracle = makeSyntheticOracle({
  proximity: [
    ['SYN_P_PLANT', 'SYN_P_GRAFT', 0.78],
    ['SYN_P_PRUNE', 'SYN_P_CUT', 0.75],
    ['SYN_P_FLOURISH', 'SYN_P_HEAL', 0.74],
  ],
  lxxPairs: [
    ['SYN_LXX_LIGHT', 'SYN_GRK_LIGHT'],
  ],
});

const timings = {};
const results = [];

function runCase(name, fn) {
  const t0 = performance.now();
  const detail = fn();
  const ms = Number((performance.now() - t0).toFixed(3));
  timings[name] = ms;
  results.push({ name, status: 'PASS', ms, detail });
}

// ============================================================================
// Synthetic Base Fixture 9001 & Zero-Overlap Analogy 9002 + R-MAC Tests
// ============================================================================
const base9001 = {
  pericopeId: 1,
  startVid: 40001,
  endVid: 40004,
  book: 91,
  genre: 2,
  esideTags: 1, // EXP_ANALOGY
  participants: [
    mkPart(10, 'SYN_A_SENDER', 'C_SYN_A_SRC', 'DEITY', 1, 'TIPNR_SYN_A1'),
    mkPart(11, 'SYN_A_COURIER', 'C_SYN_A_MSG', 'NATURE', 1),
    mkPart(12, 'SYN_A_ORIGIN', 'C_SYN_A_SKY', 'PLACE', 0),
    mkPart(13, 'SYN_A_TARGET', 'C_SYN_A_SOIL', 'PLACE', 0),
    mkPart(14, 'SYN_A_HARVEST', 'C_SYN_A_YIELD', 'ABSTRACT', 1),
  ],
  events: [
    mkEv(1, 'SYN_A_DISPATCH', 'C_SYN_A_EV_SEND', 'EMIT_SEND', [
      { role: 'AGENT', pid: 10 },
      { role: 'PATIENT', pid: 11 },
      { role: 'SOURCE', pid: 12 },
    ]),
    mkEv(2, 'SYN_A_REVERT', 'C_SYN_A_EV_RET', 'RETURN_TURN', [
      { role: 'AGENT', pid: 11 },
      { role: 'GOAL_LOC', pid: 12 },
    ], { pol: 'NEG' }),
    mkEv(3, 'SYN_A_ACTIVATE', 'C_SYN_A_EV_ACT', 'CREATE_MAKE', [
      { role: 'AGENT', pid: 11 },
      { role: 'PATIENT', pid: 13 },
    ], { isCausative: true }),
    mkEv(4, 'SYN_A_SPROUT', 'C_SYN_A_EV_BEAR', 'BEAR_PRODUCE', [
      { role: 'AGENT', pid: 13 },
      { role: 'PATIENT', pid: 14 },
    ], { isCausative: true, valence: 1 }),
  ],
  hoEdges: [
    mkHo(1, 'PURPOSE', 1, 3),
    mkHo(2, 'CONTRAST_EXCEPT', 2, 3),
    mkHo(3, 'RESULT_INFERENCE', 3, 4),
  ],
};

// 0% lexical/concept/tipnr overlap with 9001, identical relational topology & archetypes
// Even event #3 uses a DIFFERENT archetype (TRANSFORM_CHANGE) forced via Rung-3 Minimal Ascension!
const target9002ZeroVocab = {
  pericopeId: 2,
  startVid: 40101,
  endVid: 40104,
  book: 92,
  genre: 4,
  esideTags: 1,
  participants: [
    mkPart(20, 'SYN_B_ARTISAN', 'C_SYN_B_MAKER', 'HUMAN', 1, 'TIPNR_SYN_B1'),
    mkPart(21, 'SYN_B_TOOL', 'C_SYN_B_INSTR', 'ARTIFACT', 1),
    mkPart(22, 'SYN_B_WORKSHOP', 'C_SYN_B_HALL', 'PLACE', 0),
    mkPart(23, 'SYN_B_STONE', 'C_SYN_B_MAT', 'ARTIFACT', 0),
    mkPart(24, 'SYN_B_STATUE', 'C_SYN_B_ART', 'ARTIFACT', 1),
  ],
  events: [
    mkEv(101, 'SYN_B_LAUNCH', 'C_SYN_B_EV_SEND', 'EMIT_SEND', [
      { role: 'AGENT', pid: 20 },
      { role: 'PATIENT', pid: 21 },
      { role: 'SOURCE', pid: 22 },
    ]),
    mkEv(102, 'SYN_B_WITHDRAW', 'C_SYN_B_EV_RET', 'RETURN_TURN', [
      { role: 'AGENT', pid: 21 },
      { role: 'GOAL_LOC', pid: 22 },
    ], { pol: 'NEG' }),
    mkEv(103, 'SYN_B_SHAPE', 'C_SYN_B_EV_TRANS', 'TRANSFORM_CHANGE', [
      { role: 'AGENT', pid: 21 },
      { role: 'PATIENT', pid: 23 },
    ], { isCausative: true }),
    mkEv(104, 'SYN_B_YIELD', 'C_SYN_B_EV_BEAR', 'BEAR_PRODUCE', [
      { role: 'AGENT', pid: 23 },
      { role: 'PATIENT', pid: 24 },
    ], { isCausative: true, valence: 1 }),
  ],
  hoEdges: [
    mkHo(11, 'PURPOSE', 101, 103),
    mkHo(12, 'CONTRAST_EXCEPT', 102, 103),
    mkHo(13, 'RESULT_INFERENCE', 103, 104),
  ],
};

// Distractor 3: overlaps query startVid..endVid (must be excluded by R-MAC)
const overlap9003 = {
  ...target9002ZeroVocab,
  pericopeId: 3,
  startVid: 40003,
  endVid: 40008,
};

// Distractor 4: 100% lexical overlap with base9001, zero HO, disconnected single-event islands
const distractorBroken9004 = {
  pericopeId: 4,
  startVid: 40201,
  endVid: 40204,
  book: 93,
  genre: 1,
  esideTags: 0,
  participants: [
    mkPart(30, 'SYN_A_SENDER', 'C_SYN_A_SRC', 'DEITY', 1, 'TIPNR_SYN_A1'),
    mkPart(31, 'SYN_A_COURIER', 'C_SYN_A_MSG', 'NATURE', 1),
    mkPart(32, 'SYN_A_ORIGIN', 'C_SYN_A_SKY', 'PLACE', 0),
    mkPart(33, 'SYN_A_TARGET', 'C_SYN_A_SOIL', 'PLACE', 0),
    mkPart(34, 'SYN_A_HARVEST', 'C_SYN_A_YIELD', 'ABSTRACT', 1),
    mkPart(35, 'SYN_A_EXTRA_1', 'C_SYN_A_EX1', 'PROP', 0),
    mkPart(36, 'SYN_A_EXTRA_2', 'C_SYN_A_EX2', 'PROP', 0),
    mkPart(37, 'SYN_A_EXTRA_3', 'C_SYN_A_EX3', 'PROP', 0),
  ],
  events: [
    mkEv(201, 'SYN_A_DISPATCH', 'C_SYN_A_EV_SEND', 'EMIT_SEND', [
      { role: 'AGENT', pid: 35 },
    ]),
    mkEv(202, 'SYN_A_REVERT', 'C_SYN_A_EV_RET', 'RETURN_TURN', [
      { role: 'PATIENT', pid: 36 },
    ], { pol: 'NEG' }),
    mkEv(203, 'SYN_A_ACTIVATE', 'C_SYN_A_EV_ACT', 'CREATE_MAKE', [
      { role: 'GOAL_LOC', pid: 37 },
    ], { isCausative: true }),
    mkEv(204, 'SYN_A_SPROUT', 'C_SYN_A_EV_BEAR', 'BEAR_PRODUCE', [
      { role: 'AGENT', pid: 30 },
      { role: 'PATIENT', pid: 34 },
    ], { isCausative: true, valence: 1 }),
  ],
  hoEdges: [],
};

// Distractor 5: 100% vocab overlap with base9001, scrambled HO & swapped roles
const distractorScrambled9005 = {
  pericopeId: 5,
  startVid: 40301,
  endVid: 40304,
  book: 94,
  genre: 1,
  esideTags: 0,
  participants: base9001.participants.map((p) => ({ ...p })),
  events: [
    mkEv(301, 'SYN_A_DISPATCH', 'C_SYN_A_EV_SEND', 'EMIT_SEND', [
      { role: 'PATIENT', pid: 10 },
      { role: 'SOURCE', pid: 14 },
    ]),
    mkEv(302, 'SYN_A_REVERT', 'C_SYN_A_EV_RET', 'RETURN_TURN', [
      { role: 'AGENT', pid: 13 },
      { role: 'PATIENT', pid: 12 },
    ], { pol: 'NEG' }),
    mkEv(303, 'SYN_A_ACTIVATE', 'C_SYN_A_EV_ACT', 'CREATE_MAKE', [
      { role: 'GOAL_LOC', pid: 11 },
      { role: 'AGENT', pid: 14 },
    ], { isCausative: true }),
    mkEv(304, 'SYN_A_SPROUT', 'C_SYN_A_EV_BEAR', 'BEAR_PRODUCE', [
      { role: 'PATIENT', pid: 10 },
      { role: 'AGENT', pid: 12 },
    ], { isCausative: true, valence: 1 }),
  ],
  hoEdges: [
    // Broken/non-isomorphic HO edges with swapped roles
    mkHo(31, 'CONTRAST_ANTI', 304, 301),
    mkHo(32, 'CONDITION', 303, 302),
    mkHo(33, 'ORD', 301, 302),
  ],
};

// ============================================================================
// Test 1: Zero-Vocab Strong Structural Parallel + R-MAC Dual-Channel Retrieval
// ============================================================================
runCase('1_zero_vocab_analogy_and_rmac', () => {
  // Verify R-MAC binary serialization, parsing, and dual-channel retrieval
  const corpus = [base9001, target9002ZeroVocab, overlap9003, distractorBroken9004, distractorScrambled9005];
  const postings = new Map();
  for (const g of corpus) {
    const ext = extractRmacFeatures(g);
    assert.ok(ext.m2.length > 0, `R-MAC M2 features extracted for ${g.pericopeId}`);
    if (g.hoEdges.length > 0) {
      assert.ok(ext.m1.length > 0, `R-MAC M1 features extracted for ${g.pericopeId}`);
    }
    for (const f of ext.features) {
      let rec = postings.get(f.key);
      if (!rec) {
        rec = { pericopeIds: new Set(), flags: 0 };
        postings.set(f.key, rec);
      }
      rec.pericopeIds.add(g.pericopeId);
    }
  }
  const rmacBytes = buildRmacBmwIndex(postings, 128);
  const rmacIdx = parseRmacBmwIndex(rmacBytes);
  assert.equal(rmacIdx.numPericopes, 128);
  assert.equal(rmacIdx.numBlocks, 2);

  const cands = queryRmacCandidates(rmacIdx, base9001, {
    pericopeSpans: corpus.map((g) => ({ pericopeId: g.pericopeId, startVid: g.startVid, endVid: g.endVid })),
  });
  assert.ok(!cands.some((c) => c.pericopeId === 1), 'Query pericope excluded');
  assert.ok(!cands.some((c) => c.pericopeId === 3), 'Overlapping pericope excluded');
  const hit2 = cands.find((c) => c.pericopeId === 2);
  assert.ok(hit2, 'Zero-vocab structural parallel 2 retrieved by R-MAC');
  assert.ok(hit2.channel === 'S' || hit2.channel === 'BOTH', 'Retrieved via Structural Channel S');
  assert.ok(hit2.structuralScore > 0, 'Channel S score > 0');

  // Verify Biblical-SME on 0% vocab overlap
  const evalRes = evaluateSmePair(base9001, target9002ZeroVocab, oracle, { bPerm: 32 });
  assert.equal(evalRes.classification, 'CROSS_DOMAIN_ANALOGY');
  assert.equal(evalRes.regime, 'CONCORDANT');
  assert.ok(evalRes.pStruct < 0.05, `Expected pStruct < 0.05, got ${evalRes.pStruct}`);
  assert.ok(evalRes.deltaSmeStruct > 0, `Expected deltaSmeStruct > 0, got ${evalRes.deltaSmeStruct}`);
  assert.equal(evalRes.rhoEnt, 0, 'Zero entity concept overlap');
  assert.equal(evalRes.winning.mappedEvents.length, 4, 'All 4 events mapped including Rung-3 event 3');
  assert.equal(evalRes.winning.mappedHo.length, 3, 'All 3 HO edges mapped');
  assert.ok(evalRes.winning.mappedParticipants.length >= 4, '1-to-1 participants recovered purely by role');
  verifyBijection(evalRes.winning.mappedEvents, (m) => m.baseEid, (m) => m.targetEid, 'T1 events');
  verifyBijection(evalRes.winning.mappedParticipants, (m) => m.basePid, (m) => m.targetPid, 'T1 participants');

  return {
    rmacTopHit: hit2.pericopeId,
    pStruct: evalRes.pStruct,
    deltaSmeStruct: Number(evalRes.deltaSmeStruct.toFixed(3)),
    sms: Number(evalRes.winning.sms.toFixed(3)),
    mappedParticipants: evalRes.winning.mappedParticipants.length,
  };
});

// ============================================================================
// Test 2: High Vocab Overlap with Broken/Shuffled Structure -> MERE_SURFACE_OVERLAP
// ============================================================================
runCase('2_high_vocab_broken_structure_rejected', () => {
  const brokenEval = evaluateSmePair(base9001, distractorBroken9004, oracle, { bPerm: 32 });
  assert.equal(brokenEval.winning.sms, 0, `Disconnected 1-event islands must yield SMS=0, got ${brokenEval.winning.sms}`);
  assert.equal(brokenEval.deltaSmeStruct, 0, 'deltaSmeStruct must be 0');
  assert.equal(brokenEval.classification, 'MERE_SURFACE_OVERLAP');

  const scrambledEval = evaluateSmePair(base9001, distractorScrambled9005, oracle, { bPerm: 32 });
  assert.equal(scrambledEval.deltaSmeStruct, 0, `Scrambled HO/roles must fail null test (pStruct=${scrambledEval.pStruct})`);
  assert.ok(scrambledEval.pStruct >= 0.25 || scrambledEval.winning.sms === 0, `Expected pStruct >= 0.25 or SMS=0, got pStruct=${scrambledEval.pStruct}, sms=${scrambledEval.winning.sms}`);
  assert.equal(scrambledEval.classification, 'MERE_SURFACE_OVERLAP');

  return {
    brokenSms: brokenEval.winning.sms,
    scrambledSms: Number(scrambledEval.winning.sms.toFixed(3)),
    scrambledPStruct: scrambledEval.pStruct,
    classification: scrambledEval.classification,
  };
});

// ============================================================================
// Test 3: Swapping AGENT <-> PATIENT Breaks 1-to-1 Mapping / Degrades Score
// ============================================================================
runCase('3_agent_patient_swap_degrades_mapping', () => {
  const chainBase = {
    pericopeId: 6,
    startVid: 40401,
    endVid: 40403,
    book: 95,
    genre: 2,
    esideTags: 0,
    participants: [
      mkPart(1, 'SYN_C_X', 'C_C_X', 'HUMAN'),
      mkPart(2, 'SYN_C_Y', 'C_C_Y', 'ARTIFACT'),
      mkPart(3, 'SYN_C_Z', 'C_C_Z', 'ABSTRACT'),
    ],
    events: [
      mkEv(1, 'SYN_C_V1', 'C_C_V1', 'GIVE_TRANSFER', [{ role: 'AGENT', pid: 1 }, { role: 'PATIENT', pid: 2 }]),
      mkEv(2, 'SYN_C_V2', 'C_C_V2', 'TRANSFORM_CHANGE', [{ role: 'AGENT', pid: 1 }, { role: 'PATIENT', pid: 2 }]),
      mkEv(3, 'SYN_C_V3', 'C_C_V3', 'HEAL_RESTORE', [{ role: 'AGENT', pid: 2 }, { role: 'PATIENT', pid: 3 }]),
    ],
    hoEdges: [
      mkHo(1, 'CAUSE_GROUND', 1, 2),
      mkHo(2, 'RESULT_INFERENCE', 2, 3),
    ],
  };

  const targetAligned = {
    ...chainBase,
    pericopeId: 7,
    startVid: 40501,
    endVid: 40503,
    participants: [
      mkPart(11, 'SYN_D_X', 'C_D_X', 'HUMAN'),
      mkPart(12, 'SYN_D_Y', 'C_D_Y', 'ARTIFACT'),
      mkPart(13, 'SYN_D_Z', 'C_D_Z', 'ABSTRACT'),
    ],
    events: [
      mkEv(11, 'SYN_D_V1', 'C_D_V1', 'GIVE_TRANSFER', [{ role: 'AGENT', pid: 11 }, { role: 'PATIENT', pid: 12 }]),
      mkEv(12, 'SYN_D_V2', 'C_D_V2', 'TRANSFORM_CHANGE', [{ role: 'AGENT', pid: 11 }, { role: 'PATIENT', pid: 12 }]),
      mkEv(13, 'SYN_D_V3', 'C_D_V3', 'HEAL_RESTORE', [{ role: 'AGENT', pid: 12 }, { role: 'PATIENT', pid: 13 }]),
    ],
    hoEdges: [
      mkHo(11, 'CAUSE_GROUND', 11, 12),
      mkHo(12, 'RESULT_INFERENCE', 12, 13),
    ],
  };

  // Swap AGENT <-> PATIENT across events 12 and 13 relative to event 11
  const targetSwapped = {
    ...targetAligned,
    pericopeId: 8,
    events: [
      mkEv(11, 'SYN_D_V1', 'C_D_V1', 'GIVE_TRANSFER', [{ role: 'AGENT', pid: 11 }, { role: 'PATIENT', pid: 12 }]),
      mkEv(12, 'SYN_D_V2', 'C_D_V2', 'TRANSFORM_CHANGE', [{ role: 'AGENT', pid: 12 }, { role: 'PATIENT', pid: 11 }]),
      mkEv(13, 'SYN_D_V3', 'C_D_V3', 'HEAL_RESTORE', [{ role: 'AGENT', pid: 11 }, { role: 'PATIENT', pid: 13 }]),
    ],
  };

  const alignedRes = runBiblicalSME(chainBase, targetAligned, oracle, 'CONCORDANT');
  const swappedRes = runBiblicalSME(chainBase, targetSwapped, oracle, 'CONCORDANT');

  verifyBijection(swappedRes.mappedParticipants, (m) => m.basePid, (m) => m.targetPid, 'T3 swapped participants');
  verifyBijection(swappedRes.mappedEvents, (m) => m.baseEid, (m) => m.targetEid, 'T3 swapped events');
  assert.ok(
    swappedRes.sms < alignedRes.sms,
    `Swapping AGENT<->PATIENT must degrade SMS (aligned=${alignedRes.sms.toFixed(3)}, swapped=${swappedRes.sms.toFixed(3)})`,
  );

  return {
    alignedSms: Number(alignedRes.sms.toFixed(3)),
    swappedSms: Number(swappedRes.sms.toFixed(3)),
    alignedMappedEvents: alignedRes.mappedEvents.length,
    swappedMappedEvents: swappedRes.mappedEvents.length,
  };
});

// ============================================================================
// Test 4: Reversing Causal Direction (CAUSE_GROUND A->B vs B->A) Degrades Mapping
// ============================================================================
runCase('4_causal_direction_reversal_degrades', () => {
  const baseCausal = {
    pericopeId: 9,
    startVid: 40601,
    endVid: 40603,
    book: 96,
    genre: 2,
    esideTags: 0,
    participants: [
      mkPart(1, 'SYN_E_A', 'C_E_A', 'HUMAN'),
      mkPart(2, 'SYN_E_B', 'C_E_B', 'ABSTRACT'),
    ],
    events: [
      mkEv(1, 'SYN_E_1', 'C_E_1', 'CREATE_MAKE', [{ role: 'AGENT', pid: 1 }, { role: 'PATIENT', pid: 2 }]),
      mkEv(2, 'SYN_E_2', 'C_E_2', 'HEAL_RESTORE', [{ role: 'AGENT', pid: 1 }, { role: 'PATIENT', pid: 2 }]),
      mkEv(3, 'SYN_E_3', 'C_E_3', 'LIVE_DIE', [{ role: 'PATIENT', pid: 2 }]),
    ],
    hoEdges: [
      mkHo(1, 'CAUSE_GROUND', 1, 2),
      mkHo(2, 'PURPOSE', 2, 3),
    ],
  };

  const targetForward = {
    ...baseCausal,
    pericopeId: 10,
    participants: [
      mkPart(11, 'SYN_F_A', 'C_F_A', 'HUMAN'),
      mkPart(12, 'SYN_F_B', 'C_F_B', 'ABSTRACT'),
    ],
    events: [
      mkEv(21, 'SYN_F_1', 'C_F_1', 'CREATE_MAKE', [{ role: 'AGENT', pid: 11 }, { role: 'PATIENT', pid: 12 }]),
      mkEv(22, 'SYN_F_2', 'C_F_2', 'HEAL_RESTORE', [{ role: 'AGENT', pid: 11 }, { role: 'PATIENT', pid: 12 }]),
      mkEv(23, 'SYN_F_3', 'C_F_3', 'LIVE_DIE', [{ role: 'PATIENT', pid: 12 }]),
    ],
    hoEdges: [
      mkHo(21, 'CAUSE_GROUND', 21, 22),
      mkHo(22, 'PURPOSE', 22, 23),
    ],
  };

  const targetReversed = {
    ...targetForward,
    pericopeId: 11,
    hoEdges: [
      mkHo(21, 'CAUSE_GROUND', 22, 21), // reversed A<-B
      mkHo(22, 'PURPOSE', 23, 22),      // reversed B<-C
    ],
  };

  const fwd = runBiblicalSME(baseCausal, targetForward, oracle, 'CONCORDANT');
  const rev = runBiblicalSME(baseCausal, targetReversed, oracle, 'CONCORDANT');

  assert.equal(fwd.mappedHo.length, 2, 'Forward causal edges mapped');
  assert.ok(rev.mappedHo.length < fwd.mappedHo.length, `Reversed causal edges lose HO alignment (fwd=${fwd.mappedHo.length}, rev=${rev.mappedHo.length})`);
  assert.ok(rev.sms < fwd.sms, `Reversed causal direction must degrade SMS (fwd=${fwd.sms.toFixed(3)}, rev=${rev.sms.toFixed(3)})`);

  return {
    forwardSms: Number(fwd.sms.toFixed(3)),
    reversedSms: Number(rev.sms.toFixed(3)),
    forwardHo: fwd.mappedHo.length,
    reversedHo: rev.mappedHo.length,
  };
});

// ============================================================================
// Test 5: Polarity Flip Triggers INVERSION + Force/Verb Change Surfaces Divergences
//         + Candidate Inference Projection
// ============================================================================
runCase('5_polarity_inversion_and_explicit_divergences', () => {
  const baseCreation = {
    pericopeId: 12,
    startVid: 40701,
    endVid: 40705,
    book: 97,
    genre: 2,
    esideTags: 0,
    participants: [
      mkPart(1, 'SYN_LXX_LIGHT', 'C_SYN_LIGHT', 'NATURE', 1),
      mkPart(2, 'SYN_HUMAN', 'C_SYN_HUMAN', 'HUMAN', 1),
      mkPart(3, 'SYN_LAND', 'C_SYN_LAND', 'PLACE', 0),
      mkPart(4, 'SYN_BIRDS', 'C_SYN_BIRDS', 'CREATURE', 1),
    ],
    events: [
      mkEv(1, 'SYN_LXX_LIGHT', 'C_EV_ILLUM', 'CREATE_MAKE', [{ role: 'PATIENT', pid: 1 }], {
        pol: 'POS',
        valence: 1,
        force: 'DIRECTIVE',
      }),
      mkEv(2, 'SYN_COPULA_A', '', 'EXIST_EQUATE', [{ role: 'PATIENT', pid: 2 }], {
        pol: 'POS',
        valence: 1,
        isExistential: true,
        promotedConceptId: 'C_SYN_HUMAN',
        promotedStrongs: 'SYN_HUMAN',
      }),
      mkEv(3, 'SYN_BIRDS_V', 'C_EV_BIRDS', 'BEAR_PRODUCE', [{ role: 'PATIENT', pid: 4 }, { role: 'GOAL_LOC', pid: 3 }], {
        pol: 'POS',
        valence: 1,
      }),
      mkEv(4, 'SYN_FLOURISH_V', 'C_EV_FLOURISH', 'LIVE_DIE', [{ role: 'AGENT', pid: 2 }, { role: 'GOAL_LOC', pid: 3 }], {
        pol: 'POS',
        valence: 1,
      }),
      // Extra base event attached via HO to test Candidate Inference projection
      mkEv(5, 'SYN_BLESS_V', 'C_EV_BLESS', 'SPEAK_DECLARE', [{ role: 'PATIENT', pid: 2 }], {
        pol: 'POS',
        valence: 1,
      }),
    ],
    hoEdges: [
      mkHo(1, 'RESULT_INFERENCE', 1, 2),
      mkHo(2, 'PURPOSE', 2, 3),
      mkHo(3, 'CAUSE_GROUND', 3, 4),
      mkHo(4, 'CAUSE_GROUND', 4, 5),
    ],
  };

  const targetAntiCreation = {
    pericopeId: 13,
    startVid: 40801,
    endVid: 40804,
    book: 98,
    genre: 3,
    esideTags: 0,
    participants: [
      mkPart(11, 'SYN_GRK_LIGHT', 'C_SYN_LIGHT', 'NATURE', -1),
      mkPart(12, 'SYN_HUMAN', 'C_SYN_HUMAN', 'HUMAN', -1),
      mkPart(13, 'SYN_LAND', 'C_SYN_LAND', 'PLACE', 0),
      mkPart(14, 'SYN_BIRDS', 'C_SYN_BIRDS', 'CREATURE', -1),
    ],
    events: [
      // LXX-linked predicate, flipped polarity & valence, changed force (DIRECTIVE -> ASSERT)
      mkEv(11, 'SYN_GRK_LIGHT', 'C_EV_DARK', 'CREATE_MAKE', [{ role: 'PATIENT', pid: 11 }], {
        pol: 'NEG',
        valence: -1,
        force: 'ASSERT',
      }),
      // Existential negation promoting C_SYN_HUMAN
      mkEv(12, 'SYN_COPULA_B', '', 'EXIST_EQUATE', [{ role: 'PATIENT', pid: 12 }], {
        pol: 'NEG',
        valence: -1,
        isExistential: true,
        promotedConceptId: 'C_SYN_HUMAN',
        promotedStrongs: 'SYN_HUMAN',
      }),
      // Birds/nature negated
      mkEv(13, 'SYN_BIRDS_FLED', 'C_EV_BIRDS_FLED', 'BEAR_PRODUCE', [{ role: 'PATIENT', pid: 14 }, { role: 'GOAL_LOC', pid: 13 }], {
        pol: 'NEG',
        valence: -1,
      }),
      // Different verb (SYN_PERISH_V) at same archetype + flipped polarity
      mkEv(14, 'SYN_PERISH_V', 'C_EV_PERISH', 'LIVE_DIE', [{ role: 'AGENT', pid: 12 }, { role: 'GOAL_LOC', pid: 13 }], {
        pol: 'NEG',
        valence: -1,
      }),
    ],
    hoEdges: [
      mkHo(11, 'RESULT_INFERENCE', 11, 12),
      mkHo(12, 'PURPOSE', 12, 13),
      mkHo(13, 'CAUSE_GROUND', 13, 14),
    ],
  };

  const evalInv = evaluateSmePair(baseCreation, targetAntiCreation, oracle, { bPerm: 32 });
  assert.equal(evalInv.regime, 'INVERSION', 'Polarity flip must trigger INVERSION regime');
  assert.equal(evalInv.classification, 'LITERAL_PARALLEL_OR_TYPOLOGY');
  assert.equal(evalInv.subTag, 'INVERSION');
  assert.ok(evalInv.deltaSmeStruct > 0, `Expected deltaSmeStruct > 0, got ${evalInv.deltaSmeStruct}`);

  const divKinds = new Set(evalInv.divergences.map((d) => d.kind));
  assert.ok(divKinds.has('POLARITY_MISMATCH'), 'Surfaces POLARITY_MISMATCH');
  assert.ok(divKinds.has('FORCE_MISMATCH'), 'Surfaces FORCE_MISMATCH');
  assert.ok(divKinds.has('PREDICATE_DIVERGENCE'), 'Surfaces PREDICATE_DIVERGENCE');

  assert.ok(evalInv.candidateInferences.length >= 1, 'Projects Candidate Inference for unmapped base event 4');
  assert.equal(evalInv.candidateInferences[0].is_candidate_inference, true);
  assert.equal(evalInv.candidateInferences[0].epistemic_class, 'semantic_hypothesis');
  assert.equal(evalInv.unmappedBaseEvents.length, 1, 'Reports unmapped base event 4');

  return {
    regime: evalInv.regime,
    classification: evalInv.classification,
    subTag: evalInv.subTag,
    pStruct: evalInv.pStruct,
    divergences: Array.from(divKinds),
    candidateInferences: evalInv.candidateInferences.length,
  };
});

// ============================================================================
// Test 6: Removing Connecting HO Edge Drops SES and Phi_depth (Systematicity)
// ============================================================================
runCase('6_removing_ho_edge_drops_ses_and_phi_depth', () => {
  const targetWithoutHo = {
    ...target9002ZeroVocab,
    pericopeId: 14,
    hoEdges: [],
  };

  const withHo = runBiblicalSME(base9001, target9002ZeroVocab, oracle, 'CONCORDANT');
  const withoutHo = runBiblicalSME(base9001, targetWithoutHo, oracle, 'CONCORDANT');

  assert.ok(withHo.totalSes > withoutHo.totalSes, `Removing HO must drop totalSes (${withHo.totalSes.toFixed(3)} -> ${withoutHo.totalSes.toFixed(3)})`);
  assert.ok(withHo.phiDepth > withoutHo.phiDepth, `Removing HO must drop phiDepth (${withHo.phiDepth.toFixed(3)} -> ${withoutHo.phiDepth.toFixed(3)})`);
  assert.ok(withHo.sms > withoutHo.sms, `Removing HO must drop SMS (${withHo.sms.toFixed(3)} -> ${withoutHo.sms.toFixed(3)})`);

  return {
    withHo: { ses: Number(withHo.totalSes.toFixed(3)), phiDepth: Number(withHo.phiDepth.toFixed(3)), sms: Number(withHo.sms.toFixed(3)) },
    withoutHo: { ses: Number(withoutHo.totalSes.toFixed(3)), phiDepth: Number(withoutHo.phiDepth.toFixed(3)), sms: Number(withoutHo.sms.toFixed(3)) },
  };
});

// ============================================================================
// Test 7: Compressed vs Expanded Causative Structure & 3-Way SEQL Generalization
// ============================================================================
runCase('7_causative_expansion_and_seql_3way', () => {
  // 7a: Compressed causative 2-event passage vs expanded 3-event 2-step causal passage
  const compressed = {
    pericopeId: 15,
    startVid: 40901,
    endVid: 40902,
    book: 99,
    genre: 2,
    esideTags: 0,
    participants: [
      mkPart(1, 'SYN_G_SOWER', 'C_G_SOWER', 'HUMAN'),
      mkPart(2, 'SYN_G_SEED', 'C_G_SEED', 'NATURE'),
      mkPart(3, 'SYN_G_FRUIT', 'C_G_FRUIT', 'NATURE'),
    ],
    events: [
      mkEv(1, 'SYN_G_CAST', 'C_G_CAST', 'EMIT_SEND', [{ role: 'AGENT', pid: 1 }, { role: 'PATIENT', pid: 2 }]),
      mkEv(2, 'SYN_G_PRODUCE', 'C_G_PROD', 'BEAR_PRODUCE', [{ role: 'AGENT', pid: 2 }, { role: 'PATIENT', pid: 3 }], {
        isCausative: true,
      }),
    ],
    hoEdges: [
      mkHo(1, 'PURPOSE', 1, 2),
    ],
  };

  const expanded = {
    pericopeId: 16,
    startVid: 41001,
    endVid: 41003,
    book: 100,
    genre: 4,
    esideTags: 0,
    participants: [
      mkPart(21, 'SYN_H_FARMER', 'C_H_FARMER', 'HUMAN'),
      mkPart(22, 'SYN_H_PLANT', 'C_H_PLANT', 'NATURE'),
      mkPart(23, 'SYN_H_WATER', 'C_H_WATER', 'NATURE'),
      mkPart(24, 'SYN_H_CROP', 'C_H_CROP', 'NATURE'),
    ],
    events: [
      mkEv(10, 'SYN_H_SCATTER', 'C_H_SCAT', 'EMIT_SEND', [{ role: 'AGENT', pid: 21 }, { role: 'PATIENT', pid: 22 }]),
      mkEv(11, 'SYN_H_TEND', 'C_H_TEND', 'TRANSFORM_CHANGE', [{ role: 'AGENT', pid: 22 }, { role: 'PATIENT', pid: 23 }]),
      mkEv(12, 'SYN_H_GROW', 'C_H_GROW', 'BEAR_PRODUCE', [{ role: 'PATIENT', pid: 24 }], {
        isCausative: false,
      }),
    ],
    hoEdges: [
      mkHo(10, 'PURPOSE', 10, 11),
      mkHo(11, 'CAUSE_GROUND', 11, 12),
    ],
  };

  const compRes = runBiblicalSME(compressed, expanded, oracle, 'CONCORDANT');
  assert.equal(compRes.mappedEvents.length, 2, 'Compressed causative aligns across 2-step expansion');
  assert.equal(compRes.mappedHo.length, 1, 'Virtual 2-step causal bridge aligns PURPOSE -> PURPOSE+CAUSE_GROUND');
  assert.ok(compRes.largestComponentEventCount >= 2 && compRes.sms > 0, 'Connected component >= 2 with SMS > 0');

  // 7b: 3-way SEQL generalization across 3 disjoint-vocabulary passages
  const seqlA = {
    pericopeId: 17,
    startVid: 41101,
    endVid: 41103,
    book: 101,
    genre: 2,
    esideTags: 0,
    participants: [
      mkPart(1, 'SYN_S1_KEEPER', 'C_S1_K', 'DEITY'),
      mkPart(2, 'SYN_S1_VINE', 'C_S1_V', 'NATURE'),
    ],
    events: [
      mkEv(1, 'SYN_P_PLANT', 'C_S1_E1', 'CREATE_MAKE', [{ role: 'AGENT', pid: 1 }, { role: 'PATIENT', pid: 2 }]),
      mkEv(2, 'SYN_P_PRUNE', 'C_S1_E2', 'DESTROY_STRIKE', [{ role: 'AGENT', pid: 1 }, { role: 'PATIENT', pid: 2 }]),
      mkEv(3, 'SYN_P_FLOURISH', 'C_S1_E3', 'HEAL_RESTORE', [{ role: 'AGENT', pid: 1 }, { role: 'PATIENT', pid: 2 }]),
    ],
    hoEdges: [
      mkHo(1, 'RESULT_INFERENCE', 1, 2),
      mkHo(2, 'CONDITION', 2, 3),
    ],
  };

  const seqlB = {
    pericopeId: 18,
    startVid: 41201,
    endVid: 41203,
    book: 102,
    genre: 3,
    esideTags: 0,
    participants: [
      mkPart(11, 'SYN_S2_GARDENER', 'C_S2_K', 'HUMAN'),
      mkPart(12, 'SYN_S2_TREE', 'C_S2_V', 'NATURE'),
    ],
    events: [
      mkEv(11, 'SYN_P_GRAFT', 'C_S2_E1', 'CREATE_MAKE', [{ role: 'AGENT', pid: 11 }, { role: 'PATIENT', pid: 12 }]),
      mkEv(12, 'SYN_P_CUT', 'C_S2_E2', 'DESTROY_STRIKE', [{ role: 'AGENT', pid: 11 }, { role: 'PATIENT', pid: 12 }]),
      mkEv(13, 'SYN_P_HEAL', 'C_S2_E3', 'HEAL_RESTORE', [{ role: 'AGENT', pid: 11 }, { role: 'PATIENT', pid: 12 }]),
    ],
    hoEdges: [
      mkHo(11, 'RESULT_INFERENCE', 11, 12),
      mkHo(12, 'CONDITION', 12, 13),
    ],
  };

  const seqlC = {
    pericopeId: 19,
    startVid: 41301,
    endVid: 41304,
    book: 103,
    genre: 4,
    esideTags: 0,
    participants: [
      mkPart(21, 'SYN_S3_BUILDER', 'C_S3_K', 'HUMAN'),
      mkPart(22, 'SYN_S3_HOUSE', 'C_S3_V', 'ARTIFACT'),
    ],
    events: [
      mkEv(21, 'SYN_S3_E1', 'C_S3_E1', 'CREATE_MAKE', [{ role: 'AGENT', pid: 21 }, { role: 'PATIENT', pid: 22 }]),
      mkEv(22, 'SYN_S3_E2', 'C_S3_E2', 'DESTROY_STRIKE', [{ role: 'AGENT', pid: 21 }, { role: 'PATIENT', pid: 22 }]),
      mkEv(23, 'SYN_S3_E3', 'C_S3_E3', 'HEAL_RESTORE', [{ role: 'AGENT', pid: 21 }, { role: 'PATIENT', pid: 22 }]),
      mkEv(24, 'SYN_S3_RESIDUAL', 'C_S3_E4', 'SPEAK_DECLARE', [{ role: 'AGENT', pid: 21 }]),
    ],
    hoEdges: [
      mkHo(21, 'RESULT_INFERENCE', 21, 22),
      mkHo(22, 'CONDITION', 22, 23),
    ],
  };

  const seql = runSeqlGeneralization([seqlA, seqlB, seqlC], oracle, { bPerm: 32 });
  assert.equal(seql.tag, 'STRUCTURAL_SCHEMA_GENERALIZATION');
  assert.equal(seql.passageCount, 3);
  assert.equal(seql.schemaEvents.filter((e) => e.frequency === 3).length, 3, 'All 3 spine events generalize 3/3');
  assert.equal(seql.schemaHoEdges.filter((h) => h.frequency === 3).length, 2, 'Both HO edges generalize 3/3');
  assert.equal(seql.roleSlotTable.filter((r) => r.frequency === 3).length, 2, 'Both role slots align 3/3');
  assert.equal(seql.residualsPerPassage[19].length, 1, 'Residual event 24 surfaced explicitly');

  return {
    compressedVsExpandedSms: Number(compRes.sms.toFixed(3)),
    seqlSchemaEvents3of3: seql.schemaEvents.filter((e) => e.frequency === 3).length,
    seqlSchemaHo3of3: seql.schemaHoEdges.filter((h) => h.frequency === 3).length,
    seqlRoleSlots3of3: seql.roleSlotTable.filter((r) => r.frequency === 3).length,
    residuals19: seql.residualsPerPassage[19].length,
  };
});

console.log(JSON.stringify({
  suite: 'v4-sme-structural-intelligence',
  passed: results.length,
  total: results.length,
  timings_ms: timings,
  cases: results,
}, null, 2));
