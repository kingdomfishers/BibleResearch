// @file: src/relationships/v4-sme-engine.ts
// Pure TypeScript Biblical Structure-Mapping Engine (Biblical-SME) and Multi-Passage
// Progressive Analogical Generalizer (SEQL-Biblical) for BibleResearch v4.
// Zero Node-only imports; runs identically in Cloudflare Workers, Deno, Browser, and Node.

import type {
  ArgRole,
  CompactHreg,
  EventArchetype,
  ForceKind,
  HoType,
  HregEvent,
  HregHoEdge,
  HregParticipant,
  HregSort,
  PredicateSimOracle,
} from './v4-hreg-types.ts';

export type SmeMode = 'CONCORDANT' | 'INVERSION';

export type SmeQuadrant =
  | 'CROSS_DOMAIN_ANALOGY'
  | 'LITERAL_PARALLEL_OR_TYPOLOGY'
  | 'MERE_SURFACE_OVERLAP'
  | 'UNRELATED';

export type SmeDivergenceKind =
  | 'POLARITY_MISMATCH'
  | 'FORCE_MISMATCH'
  | 'PREDICATE_DIVERGENCE'
  | 'CAUSATIVE_MISMATCH'
  | 'HO_TYPE_DIVERGENCE';

export interface SmeDivergence {
  kind: SmeDivergenceKind;
  baseEid?: number;
  targetEid?: number;
  baseHid?: number;
  targetHid?: number;
  detail: string;
}

export interface SmeCandidateInference {
  predicted_ho: HoType;
  direction: 'FORWARD_TO_TARGET' | 'BACKWARD_FROM_TARGET';
  anchored_target_event_eid: number;
  projected_event_arch: EventArchetype;
  projected_event_strongs: string;
  substituted_args: Array<{ role: ArgRole; targetPid: number; targetStrongs: string; targetConceptId: string }>;
  skolem_args: Array<{ role: ArgRole; basePid: number; skolemId: string; sort: HregSort }>;
  epistemic_class: 'semantic_hypothesis';
  is_candidate_inference: true;
}

export interface SmeEventMapping {
  baseEid: number;
  targetEid: number;
  baseIdx: number;
  targetIdx: number;
  w: number;
  ses: number;
  ascended: boolean;
  rung: 0 | 1 | 2 | 3;
  isInvertedMatch: boolean;
  isCausativeExpanded: boolean;
}

export interface SmeHoMapping {
  baseHid: number;
  targetHid: number;
  baseIdx: number;
  targetIdx: number;
  baseHoType: HoType;
  targetHoType: HoType;
  w: number;
  ses: number;
  isTwoStepExpansion: boolean;
}

export interface SmeParticipantMapping {
  basePid: number;
  targetPid: number;
  baseIdx: number;
  targetIdx: number;
  w: number;
  ses: number;
  sameEntityOrConcept: boolean;
}

export interface SmeMappingResult {
  mode: SmeMode;
  mappedEvents: SmeEventMapping[];
  mappedHo: SmeHoMapping[];
  mappedParticipants: SmeParticipantMapping[];
  totalSes: number;
  maxComponentSes: number;
  largestComponentEventCount: number;
  largestComponentHoCount: number;
  reentrantEdgeCount: number;
  phiConn: number;
  phiDepth: number;
  sizePenalty: number;
  sms: number;
  invertedMatchCount: number;
  candidateInferences: SmeCandidateInference[];
  unmappedBaseEvents: Array<{ eid: number; strongs: string; arch: EventArchetype; pol: 'POS' | 'NEG' }>;
  unmappedTargetEvents: Array<{ eid: number; strongs: string; arch: EventArchetype; pol: 'POS' | 'NEG' }>;
  divergences: SmeDivergence[];
}

export interface SmePairEvaluation {
  basePericopeId: number;
  targetPericopeId: number;
  regime: SmeMode;
  classification: SmeQuadrant;
  subTag: 'INVERSION' | null;
  winning: SmeMappingResult;
  concordant: SmeMappingResult;
  inversion: SmeMappingResult;
  bPerm: number;
  pStruct: number;
  deltaSmeStruct: number;
  rhoEnt: number;
  lexOverlap: number;
  candidateInferences: SmeCandidateInference[];
  unmappedBaseEvents: SmeMappingResult['unmappedBaseEvents'];
  unmappedTargetEvents: SmeMappingResult['unmappedTargetEvents'];
  divergences: SmeDivergence[];
}

export interface SeqlSchemaEvent {
  slotId: string;
  arch: EventArchetype;
  archetypesObserved: EventArchetype[];
  frequency: number;
  witnesses: Array<{
    pericopeId: number;
    eid: number;
    strongs: string;
    conceptId: string;
    arch: EventArchetype;
    pol: 'POS' | 'NEG';
    force: ForceKind;
  }>;
}

export interface SeqlSchemaHoEdge {
  hoType: HoType;
  fromSlotId: string;
  toSlotId: string;
  frequency: number;
}

export interface SeqlRoleSlotRow {
  slotId: string;
  roleHint: ArgRole;
  frequency: number;
  perPassage: Record<number, { pid: number; strongs: string; conceptId: string; sort: HregSort } | null>;
}

export interface SeqlGeneralizationResult {
  tag: 'STRUCTURAL_SCHEMA_GENERALIZATION';
  passageCount: number;
  pericopeIds: number[];
  anchorPair: [number, number];
  schemaEvents: SeqlSchemaEvent[];
  schemaHoEdges: SeqlSchemaHoEdge[];
  roleSlotTable: SeqlRoleSlotRow[];
  residualsPerPassage: Record<number, Array<{ eid: number; strongs: string; arch: EventArchetype; pol: 'POS' | 'NEG' }>>;
  pairwiseEvaluations: SmePairEvaluation[];
}

const CORE_ROLES = new Set<ArgRole>(['AGENT', 'PATIENT', 'RECIPIENT', 'THEME_2']);
const CAUSAL_EXPANSION_HO = new Set<HoType>(['CAUSE_GROUND', 'RESULT_INFERENCE', 'PURPOSE']);

const HO_IDF_WEIGHT: Record<HoType, number> = {
  CAUSE_GROUND: 1.0,
  RESULT_INFERENCE: 1.0,
  PURPOSE: 1.0,
  AVOIDANCE_LEST: 1.0,
  CONDITION: 1.0,
  CONTRAST_EXCEPT: 1.0,
  CONTRAST_ANTI: 1.0,
  CONCESSION: 1.0,
  EXPLICIT_ANALOGY: 1.0,
  A_FORTIORI: 1.0,
  PROPOSITIONAL_FRAME: 0.35,
  STATE_REVERSAL: 1.0,
  CMD_EXEC: 1.0,
  ORD: 0.0,
};

interface InternalMh {
  id: number;
  tier: 0 | 1 | 2;
  bIdx: number;
  tIdx: number;
  w: number;
  ses: number;
  ascended: boolean;
  rung: 0 | 1 | 2 | 3;
  isInvertedMatch: boolean;
  isTwoStepExpansion: boolean;
  parents: number[];
  children: number[];
}

interface AtomicKernel {
  rootMhId: number;
  mhIds: number[];
  hoBSet: Set<number>;
  hoTSet: Set<number>;
  evBSet: Set<number>;
  evTSet: Set<number>;
  pBSet: Set<number>;
  pTSet: Set<number>;
  kernelSes: number;
}

interface PredCompatResult {
  w: number;
  kPred: number;
  rung: 0 | 1 | 2 | 3;
  isInvertedMatch: boolean;
}

function clamp(val: number, lo: number, hi: number): number {
  return val < lo ? lo : val > hi ? hi : val;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function capHregForSme(hreg: CompactHreg): CompactHreg {
  if (hreg.events.length <= 24 && hreg.participants.length <= 32) return hreg;
  const evScores = hreg.events.map((ev, idx) => {
    let hoDeg = 0;
    for (const h of hreg.hoEdges) {
      if (h.hoType !== 'ORD' && (h.fromEid === ev.eid || h.toEid === ev.eid)) hoDeg++;
    }
    return { idx, ev, score: hoDeg * 2 + ev.idf + ev.argRoles.length * 0.2 };
  });
  evScores.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const keptEvents = evScores.slice(0, 24).sort((a, b) => a.idx - b.idx).map((x) => x.ev);
  const keptEids = new Set(keptEvents.map((e) => e.eid));
  const keptHo = hreg.hoEdges.filter((h) => keptEids.has(h.fromEid) && keptEids.has(h.toEid));
  const usedPids = new Set<number>();
  for (const e of keptEvents) {
    for (const a of e.argRoles) usedPids.add(a.pid);
  }
  const keptParts = hreg.participants.filter((p) => usedPids.has(p.pid)).slice(0, 32);
  return {
    ...hreg,
    participants: keptParts,
    events: keptEvents,
    hoEdges: keptHo,
  };
}

function computePromotedSimilarity(
  eB: HregEvent,
  eT: HregEvent,
  basePartByPid: Map<number, HregParticipant>,
  targetPartByPid: Map<number, HregParticipant>,
  simOracle: PredicateSimOracle,
): { sim: number; rung: 0 | 1 | 2 | 3 } {
  const collectPromotedCandidates = (
    ev: HregEvent,
    partMap: Map<number, HregParticipant>,
  ): Array<{ strongs: string; conceptId: string }> => {
    const out: Array<{ strongs: string; conceptId: string }> = [];
    if (ev.promotedStrongs || ev.promotedConceptId) {
      out.push({ strongs: ev.promotedStrongs || '', conceptId: ev.promotedConceptId || '' });
    }
    for (const a of ev.argRoles) {
      if (
        a.role === 'PATIENT' ||
        a.role === 'THEME_2' ||
        (ev.isExistential && a.role === 'AGENT')
      ) {
        const p = partMap.get(a.pid);
        if (p) out.push({ strongs: p.strongs, conceptId: p.conceptId });
      }
    }
    if (out.length === 0 && (ev.strongs || ev.conceptId)) {
      out.push({ strongs: ev.strongs, conceptId: ev.conceptId });
    }
    return out;
  };

  const cB = collectPromotedCandidates(eB, basePartByPid);
  const cT = collectPromotedCandidates(eT, targetPartByPid);
  let bestSim = 0;
  let bestRung: 0 | 1 | 2 | 3 = 2;

  for (const a of cB) {
    for (const b of cT) {
      if (a.strongs && b.strongs && (a.strongs === b.strongs || simOracle.isLxxLinked?.(a.strongs, b.strongs))) {
        if (1.0 > bestSim) { bestSim = 1.0; bestRung = 0; }
      }
      if (a.conceptId && b.conceptId && a.conceptId === b.conceptId) {
        if (0.86 > bestSim) { bestSim = 0.86; bestRung = 1; }
      }
      if (a.strongs && b.strongs) {
        const prox = 0.80 * simOracle.lookupProximitySim(a.strongs, b.strongs);
        if (prox > bestSim) { bestSim = prox; bestRung = 1; }
      }
    }
  }
  return { sim: bestSim, rung: bestRung };
}

function computePredicateCompat(
  eB: HregEvent,
  eT: HregEvent,
  basePartByPid: Map<number, HregParticipant>,
  targetPartByPid: Map<number, HregParticipant>,
  simOracle: PredicateSimOracle,
  mode: SmeMode,
): PredCompatResult {
  const polOpposite = eB.pol !== eT.pol;
  const valOpposite = eB.valence !== 0 && eT.valence !== 0 && eB.valence === -eT.valence;
  const isInverted = polOpposite || valOpposite;

  if (mode === 'CONCORDANT') {
    if (polOpposite) return { w: 0, kPred: 0, rung: 2, isInvertedMatch: false };
  }

  let basePredSim = 0;
  let rung: 0 | 1 | 2 | 3 = 2;

  if (eB.isExistential && eT.isExistential) {
    const prom = computePromotedSimilarity(eB, eT, basePartByPid, targetPartByPid, simOracle);
    basePredSim = prom.sim >= 0.45 ? prom.sim : 0;
    rung = prom.rung;
  } else if (eB.isExistential || eT.isExistential) {
    const prom = computePromotedSimilarity(eB, eT, basePartByPid, targetPartByPid, simOracle);
    basePredSim = prom.sim;
    rung = prom.rung;
  } else {
    // Rung 0: exact lemma or Rahlfs LXX link
    if (eB.strongs && eT.strongs && (eB.strongs === eT.strongs || simOracle.isLxxLinked?.(eB.strongs, eT.strongs))) {
      basePredSim = 1.05;
      rung = 0;
    } else {
      // Rung 1: same C_XL concept OR Proximity.tsv similarity
      const cSame = eB.conceptId && eT.conceptId && eB.conceptId === eT.conceptId ? 0.90 : 0;
      const prox = eB.strongs && eT.strongs ? 0.85 * simOracle.lookupProximitySim(eB.strongs, eT.strongs) : 0;
      const r1 = Math.max(cSame, prox);
      if (r1 > 0) {
        basePredSim = r1;
        rung = 1;
      } else if (eB.strongs && eT.strongs && eB.arch === eT.arch) {
        // Rung 2: same canonical EventArchetype (requires real Strong's on both sides)
        basePredSim = 0.42;
        rung = 2;
      }
    }
  }

  if (basePredSim <= 0) {
    return { w: 0, kPred: 0, rung, isInvertedMatch: false };
  }

  let kPred = basePredSim;
  if (eB.isCausative && eT.isCausative) kPred += 0.15;
  if (eB.force !== 'ASSERT' && eB.force === eT.force) kPred += 0.08;

  if (kPred < 0.35) {
    return { w: 0, kPred, rung, isInvertedMatch: false };
  }

  const omegaIdf = clamp(Math.min(eB.idf, eT.idf) / 6.0, 0.20, 1.0);
  const regimeScale = mode === 'INVERSION' && !isInverted ? 0.80 : 1.0;
  return {
    w: kPred * omegaIdf * regimeScale,
    kPred,
    rung,
    isInvertedMatch: mode === 'INVERSION' && isInverted,
  };
}

function computeHoCompat(hB: HoType, hT: HoType): number {
  if (hB === 'ORD' || hT === 'ORD') return 0;
  const idf = HO_IDF_WEIGHT[hB] ?? 1.0;
  if (hB === hT) return 1.20 * idf;
  if (
    (hB === 'CAUSE_GROUND' && hT === 'RESULT_INFERENCE') ||
    (hB === 'RESULT_INFERENCE' && hT === 'CAUSE_GROUND') ||
    (hB === 'PURPOSE' && hT === 'RESULT_INFERENCE') ||
    (hB === 'RESULT_INFERENCE' && hT === 'PURPOSE')
  ) {
    return 0.75 * Math.min(idf, HO_IDF_WEIGHT[hT] ?? 1.0);
  }
  if (
    (hB === 'EXPLICIT_ANALOGY' || hT === 'EXPLICIT_ANALOGY') &&
    (hB === 'CONDITION' || hT === 'CONDITION' ||
     hB === 'CAUSE_GROUND' || hT === 'CAUSE_GROUND' ||
     hB === 'RESULT_INFERENCE' || hT === 'RESULT_INFERENCE' ||
     hB === 'PURPOSE' || hT === 'PURPOSE' ||
     hB === 'CMD_EXEC' || hT === 'CMD_EXEC')
  ) {
    return 0.70;
  }
  return 0;
}

interface NormalizedHoEdge {
  hid: number;
  hoType: HoType;
  fromIdx: number;
  toIdx: number;
  isTwoStepExpansion: boolean;
  absorbedMidIdx: number; // -1 if direct edge
}

function buildEffectiveHoEdges(hreg: CompactHreg, eidToIdx: Map<number, number>): NormalizedHoEdge[] {
  const direct: NormalizedHoEdge[] = [];
  for (const h of hreg.hoEdges) {
    if (h.hoType === 'ORD') continue;
    const fromIdx = eidToIdx.get(h.fromEid);
    const toIdx = eidToIdx.get(h.toEid);
    if (fromIdx === undefined || toIdx === undefined || fromIdx === toIdx) continue;
    direct.push({
      hid: h.hid,
      hoType: h.hoType,
      fromIdx,
      toIdx,
      isTwoStepExpansion: false,
      absorbedMidIdx: -1,
    });
  }
  return direct;
}

function collectMatchedRoleArgPairs(
  eB: HregEvent,
  eT: HregEvent,
  basePidToIdx: Map<number, number>,
  targetPidToIdx: Map<number, number>,
  causativeExtraAgentT?: number,
  causativeExtraAgentB?: number,
): Array<{ role: ArgRole; pBIdx: number; pTIdx: number; scale: number }> {
  const out: Array<{ role: ArgRole; pBIdx: number; pTIdx: number; scale: number }> = [];
  const seenPairs = new Set<string>();

  const bArgs = eB.argRoles.slice();
  const tArgs = eT.argRoles.slice();
  if (causativeExtraAgentB !== undefined && !bArgs.some((a) => a.role === 'AGENT')) {
    bArgs.push({ role: 'AGENT', pid: causativeExtraAgentB });
  }
  if (causativeExtraAgentT !== undefined && !tArgs.some((a) => a.role === 'AGENT')) {
    tArgs.push({ role: 'AGENT', pid: causativeExtraAgentT });
  }

  for (const aB of bArgs) {
    const pBIdx = basePidToIdx.get(aB.pid);
    if (pBIdx === undefined) continue;
    for (const aT of tArgs) {
      if (aB.role !== aT.role) continue;
      const pTIdx = targetPidToIdx.get(aT.pid);
      if (pTIdx === undefined) continue;
      const key = `${pBIdx}:${pTIdx}`;
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        out.push({ role: aB.role, pBIdx, pTIdx, scale: 1.0 });
      }
    }
  }

  // Compatible oblique SOURCE/GOAL_LOC fallback at 0.6x if exact match wasn't emitted
  for (const aB of bArgs) {
    if (aB.role !== 'SOURCE' && aB.role !== 'GOAL_LOC') continue;
    const pBIdx = basePidToIdx.get(aB.pid);
    if (pBIdx === undefined) continue;
    for (const aT of tArgs) {
      if ((aT.role !== 'SOURCE' && aT.role !== 'GOAL_LOC') || aB.role === aT.role) continue;
      const pTIdx = targetPidToIdx.get(aT.pid);
      if (pTIdx === undefined) continue;
      const key = `${pBIdx}:${pTIdx}`;
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        out.push({ role: aB.role, pBIdx, pTIdx, scale: 0.6 });
      }
    }
  }

  return out;
}

function precomputePredicateMatrix(
  base: CompactHreg,
  target: CompactHreg,
  simOracle: PredicateSimOracle,
  mode: SmeMode,
): PredCompatResult[] {
  const basePartByPid = new Map<number, HregParticipant>();
  for (const p of base.participants) basePartByPid.set(p.pid, p);
  const targetPartByPid = new Map<number, HregParticipant>();
  for (const p of target.participants) targetPartByPid.set(p.pid, p);

  const nB = base.events.length;
  const nT = target.events.length;
  const matrix: PredCompatResult[] = new Array(nB * nT);
  for (let i = 0; i < nB; i++) {
    for (let j = 0; j < nT; j++) {
      matrix[i * nT + j] = computePredicateCompat(
        base.events[i],
        target.events[j],
        basePartByPid,
        targetPartByPid,
        simOracle,
        mode,
      );
    }
  }
  return matrix;
}

function solveBiblicalSmeWithMatrix(
  base: CompactHreg,
  target: CompactHreg,
  simOracle: PredicateSimOracle,
  mode: SmeMode,
  predMatrix: PredCompatResult[],
  samePartMatrix: Uint8Array,
  skipProjections = false,
): SmeMappingResult {
  const nB = base.events.length;
  const nT = target.events.length;
  const nPB = base.participants.length;
  const nPT = target.participants.length;

  const baseEidToIdx = new Map<number, number>();
  for (let i = 0; i < nB; i++) baseEidToIdx.set(base.events[i].eid, i);
  const targetEidToIdx = new Map<number, number>();
  for (let j = 0; j < nT; j++) targetEidToIdx.set(target.events[j].eid, j);

  const basePidToIdx = new Map<number, number>();
  for (let i = 0; i < nPB; i++) basePidToIdx.set(base.participants[i].pid, i);
  const targetPidToIdx = new Map<number, number>();
  for (let j = 0; j < nPT; j++) targetPidToIdx.set(target.participants[j].pid, j);

  const mhs: InternalMh[] = [];
  const evMhIdx = new Int16Array(nB * nT).fill(-1);

  // 1. Top-4 Event MHs per Base event (Rungs 0..2)
  for (let i = 0; i < nB; i++) {
    const cands: Array<{ j: number; res: PredCompatResult }> = [];
    for (let j = 0; j < nT; j++) {
      const res = predMatrix[i * nT + j];
      if (res.kPred >= 0.35 && res.w > 0) {
        cands.push({ j, res });
      }
    }
    cands.sort((a, b) => b.res.w - a.res.w || a.j - b.j);
    const keep = Math.min(4, cands.length);
    for (let c = 0; c < keep; c++) {
      const { j, res } = cands[c];
      const id = mhs.length;
      evMhIdx[i * nT + j] = id;
      mhs.push({
        id,
        tier: 1,
        bIdx: i,
        tIdx: j,
        w: res.w,
        ses: res.w,
        ascended: false,
        rung: res.rung,
        isInvertedMatch: res.isInvertedMatch,
        isTwoStepExpansion: false,
        parents: [],
        children: [],
      });
    }
  }

  // Helper: ensure Rung-3 Minimal Ascension event MH when forced by a Tier-2 HO MH
  const ensureAscendedEventMh = (i: number, j: number): number => {
    const existing = evMhIdx[i * nT + j];
    if (existing >= 0) return existing;
    const eB = base.events[i];
    const eT = target.events[j];
    const polOpposite = eB.pol !== eT.pol;
    const valOpposite = eB.valence !== 0 && eT.valence !== 0 && eB.valence === -eT.valence;
    if (mode === 'CONCORDANT' && polOpposite) return -1;

    const id = mhs.length;
    if (id >= 128) return -1;
    evMhIdx[i * nT + j] = id;
    mhs.push({
      id,
      tier: 1,
      bIdx: i,
      tIdx: j,
      w: 0.16,
      ses: 0.16,
      ascended: true,
      rung: 3,
      isInvertedMatch: mode === 'INVERSION' && (polOpposite || valOpposite),
      isTwoStepExpansion: false,
      parents: [],
      children: [],
    });
    return id;
  };

  // 2. Tier-2 HO MHs + Rung-3 Minimal Ascension + Causative 2-Step Expansion
  const baseHo = buildEffectiveHoEdges(base, baseEidToIdx);
  const targetHo = buildEffectiveHoEdges(target, targetEidToIdx);

  // Also detect 2-step causal expansions when one side has a causative target/base event
  const baseHasCausative = base.events.some((e) => e.isCausative);
  const targetHasCausative = target.events.some((e) => e.isCausative);

  const augmentTwoStep = (
    direct: NormalizedHoEdge[],
    hreg: CompactHreg,
    enable: boolean,
  ): NormalizedHoEdge[] => {
    if (!enable) return direct;
    const out = direct.slice();
    const existingPair = new Set(direct.map((d) => `${d.fromIdx}:${d.toIdx}:${d.hoType}`));
    for (let a = 0; a < direct.length; a++) {
      const h1 = direct[a];
      if (!CAUSAL_EXPANSION_HO.has(h1.hoType)) continue;
      for (let b = 0; b < direct.length; b++) {
        if (a === b) continue;
        const h2 = direct[b];
        if (!CAUSAL_EXPANSION_HO.has(h2.hoType)) continue;
        if (h1.toIdx !== h2.fromIdx || h1.fromIdx === h2.toIdx) continue;
        const midEv = hreg.events[h1.toIdx];
        const endEv = hreg.events[h2.toIdx];
        if (midEv.isCausative || endEv.isCausative || h2.hoType === 'CAUSE_GROUND' || h2.hoType === 'RESULT_INFERENCE') {
          const key = `${h1.fromIdx}:${h2.toIdx}:${h1.hoType}`;
          if (!existingPair.has(key)) {
            existingPair.add(key);
            out.push({
              hid: h1.hid,
              hoType: h1.hoType,
              fromIdx: h1.fromIdx,
              toIdx: h2.toIdx,
              isTwoStepExpansion: true,
              absorbedMidIdx: h1.toIdx,
            });
          }
        }
      }
    }
    return out;
  };

  const effBaseHo = augmentTwoStep(baseHo, base, targetHasCausative);
  const effTargetHo = augmentTwoStep(targetHo, target, baseHasCausative);

  const hoPairsToEvaluate: Array<{
    hi: number;
    hj: number;
    hw: number;
    anchoredCount: number;
    sortScore: number;
    hB: NormalizedHoEdge;
    hT: NormalizedHoEdge;
    swapTarget: boolean;
  }> = [];

  const pushHoCandidate = (
    hi: number,
    hj: number,
    hw: number,
    hB: NormalizedHoEdge,
    hT: NormalizedHoEdge,
    swapTarget: boolean,
  ) => {
    const tFrom = swapTarget ? hT.toIdx : hT.fromIdx;
    const tTo = swapTarget ? hT.fromIdx : hT.toIdx;
    if (hB.fromIdx === hB.toIdx || tFrom === tTo) return;
    const e1 = evMhIdx[hB.fromIdx * nT + tFrom];
    const e2 = evMhIdx[hB.toIdx * nT + tTo];
    const m1Strong = e1 >= 0 && (mhs[e1].rung <= 1 || mhs[e1].w >= 0.25);
    const m2Strong = e2 >= 0 && (mhs[e2].rung <= 1 || mhs[e2].w >= 0.25);

    if (hB.hoType === 'PROPOSITIONAL_FRAME' || hT.hoType === 'PROPOSITIONAL_FRAME') {
      if (!(e1 >= 0 && e2 >= 0)) return;
    } else if (!(e1 >= 0 && e2 >= 0) && !m1Strong && !m2Strong) {
      return;
    }

    const anchoredCount = (e1 >= 0 ? 1 : 0) + (e2 >= 0 ? 1 : 0);
    const w1 = e1 >= 0 ? mhs[e1].w : 0;
    const w2 = e2 >= 0 ? mhs[e2].w : 0;
    hoPairsToEvaluate.push({
      hi,
      hj,
      hw,
      anchoredCount,
      sortScore: hw + w1 + w2,
      hB,
      hT,
      swapTarget,
    });
  };

  for (let hi = 0; hi < effBaseHo.length; hi++) {
    const hB = effBaseHo[hi];
    for (let hj = 0; hj < effTargetHo.length; hj++) {
      const hT = effTargetHo[hj];
      if (hB.isTwoStepExpansion && hT.isTwoStepExpansion) continue;
      if (hB.isTwoStepExpansion && !target.events[hT.toIdx].isCausative) continue;
      if (hT.isTwoStepExpansion && !base.events[hB.toIdx].isCausative) continue;
      const hwBase = computeHoCompat(hB.hoType, hT.hoType);
      if (hwBase <= 0) continue;
      const hw = (hB.isTwoStepExpansion || hT.isTwoStepExpansion) ? hwBase * 0.85 : hwBase;
      pushHoCandidate(hi, hj, hw, hB, hT, false);
      if (hB.hoType === 'CONTRAST_ANTI' && hT.hoType === 'CONTRAST_ANTI') {
        pushHoCandidate(hi, hj, hw * 0.95, hB, hT, true);
      }
    }
  }

  hoPairsToEvaluate.sort((a, b) => b.anchoredCount - a.anchoredCount || b.sortScore - a.sortScore || a.hi - b.hi || a.hj - b.hj);
  if (hoPairsToEvaluate.length > 48) hoPairsToEvaluate.length = 48;

  for (const cand of hoPairsToEvaluate) {
    if (mhs.length >= 120) break;
    const tFrom = cand.swapTarget ? cand.hT.toIdx : cand.hT.fromIdx;
    const tTo = cand.swapTarget ? cand.hT.fromIdx : cand.hT.toIdx;
    const m1Before = evMhIdx[cand.hB.fromIdx * nT + tFrom] >= 0;
    const m2Before = evMhIdx[cand.hB.toIdx * nT + tTo] >= 0;
    const m1 = ensureAscendedEventMh(cand.hB.fromIdx, tFrom);
    const m2 = ensureAscendedEventMh(cand.hB.toIdx, tTo);
    if (m1 < 0 || m2 < 0 || m1 === m2) continue;

    const effectiveHw = m1Before && m2Before ? cand.hw : cand.hw * 0.70;
    const hid = mhs.length;
    mhs.push({
      id: hid,
      tier: 2,
      bIdx: cand.hi,
      tIdx: cand.hj,
      w: effectiveHw,
      ses: effectiveHw,
      ascended: false,
      rung: 0,
      isInvertedMatch: false,
      isTwoStepExpansion: cand.hB.isTwoStepExpansion || cand.hT.isTwoStepExpansion,
      parents: [],
      children: [m1, m2],
    });
    mhs[m1].parents.push(hid);
    mhs[m2].parents.push(hid);
  }

  // Track optional causative agent inheritance for 2-step expansions
  const extraAgentBByEv = new Map<number, number>();
  const extraAgentTByEv = new Map<number, number>();
  for (const h of effBaseHo) {
    if (h.isTwoStepExpansion && h.absorbedMidIdx >= 0) {
      const ag = base.events[h.absorbedMidIdx].argRoles.find((a) => a.role === 'AGENT');
      if (ag) extraAgentBByEv.set(h.toIdx, ag.pid);
    }
  }
  for (const h of effTargetHo) {
    if (h.isTwoStepExpansion && h.absorbedMidIdx >= 0) {
      const ag = target.events[h.absorbedMidIdx].argRoles.find((a) => a.role === 'AGENT');
      if (ag) extraAgentTByEv.set(h.toIdx, ag.pid);
    }
  }

  // 3. Tier-0 Entity MHs strictly induced by Parallel Connectivity on shared normalized roles
  const entMhIdx = new Int16Array(nPB * nPT).fill(-1);
  const numNonEnt = mhs.length;
  for (let m = 0; m < numNonEnt; m++) {
    if (mhs[m].tier !== 1) continue;
    const bIdx = mhs[m].bIdx;
    const tIdx = mhs[m].tIdx;
    const eB = base.events[bIdx];
    const eT = target.events[tIdx];
    const pairs = collectMatchedRoleArgPairs(
      eB,
      eT,
      basePidToIdx,
      targetPidToIdx,
      extraAgentTByEv.get(tIdx),
      extraAgentBByEv.get(bIdx),
    );
    for (const pair of pairs) {
      const key = pair.pBIdx * nPT + pair.pTIdx;
      let eid = entMhIdx[key];
      if (eid < 0) {
        if (mhs.length >= 128) continue;
        const same = samePartMatrix[key] === 1;
        const ew = (same ? 0.26 : 0.10) * pair.scale;
        eid = mhs.length;
        entMhIdx[key] = eid;
        mhs.push({
          id: eid,
          tier: 0,
          bIdx: pair.pBIdx,
          tIdx: pair.pTIdx,
          w: ew,
          ses: ew,
          ascended: false,
          rung: 0,
          isInvertedMatch: false,
          isTwoStepExpansion: false,
          parents: [],
          children: [],
        });
      }
      if (!mhs[m].children.includes(eid)) {
        mhs[m].children.push(eid);
        mhs[eid].parents.push(m);
      }
    }
  }

  // 4. Top-Down Trickle-Down Systematicity (tier 2 -> 1 -> 0)
  for (const tier of [2, 1, 0] as const) {
    for (const m of mhs) {
      if (m.tier !== tier) continue;
      let pSum = 0;
      for (const pid of m.parents) {
        pSum += 0.80 * mhs[pid].ses;
      }
      m.ses = m.w + Math.min(3.5, pSum);
    }
  }

  // 5. Strict Atomic Joint Kernels + 4 x Uint32 Bitmask No-Goods
  const kernels: AtomicKernel[] = [];

  const buildConsistentClosure = (rootMh: InternalMh): AtomicKernel | null => {
    const hoBSet = new Set<number>();
    const hoTSet = new Set<number>();
    const evBSet = new Set<number>();
    const evTSet = new Set<number>();
    const pBMap = new Map<number, number>(); // bPartIdx -> tPartIdx
    const pTMap = new Map<number, number>(); // tPartIdx -> bPartIdx
    const mhIdSet = new Set<number>([rootMh.id]);

    const addEventAndCheck = (evMh: InternalMh): boolean => {
      const prevT = evBSet.has(evMh.bIdx);
      const prevB = evTSet.has(evMh.tIdx);
      if (prevT !== prevB) return false;
      evBSet.add(evMh.bIdx);
      evTSet.add(evMh.tIdx);
      mhIdSet.add(evMh.id);
      return true;
    };

    const requiredEvMhs: InternalMh[] = [];
    if (rootMh.tier === 2) {
      const hB = effBaseHo[rootMh.bIdx];
      const hT = effTargetHo[rootMh.tIdx];
      hoBSet.add(hB.hid);
      hoTSet.add(hT.hid);
      for (const cid of rootMh.children) {
        const cm = mhs[cid];
        if (!addEventAndCheck(cm)) return null;
        requiredEvMhs.push(cm);
      }
      if (requiredEvMhs.length === 2) {
        if (requiredEvMhs[0].bIdx === requiredEvMhs[1].bIdx || requiredEvMhs[0].tIdx === requiredEvMhs[1].tIdx) {
          return null;
        }
      }
    } else if (rootMh.tier === 1 && !rootMh.ascended) {
      if (!addEventAndCheck(rootMh)) return null;
      requiredEvMhs.push(rootMh);
    } else {
      return null;
    }

    // Collect core role entity MHs first; discard kernel if required events contradict on core roles
    const coreCandidates: Array<{ mh: InternalMh; isCore: boolean }> = [];
    for (const evMh of requiredEvMhs) {
      const eB = base.events[evMh.bIdx];
      const eT = target.events[evMh.tIdx];
      const pairs = collectMatchedRoleArgPairs(
        eB,
        eT,
        basePidToIdx,
        targetPidToIdx,
        extraAgentTByEv.get(evMh.tIdx),
        extraAgentBByEv.get(evMh.bIdx),
      );
      for (const pair of pairs) {
        const eid = entMhIdx[pair.pBIdx * nPT + pair.pTIdx];
        if (eid < 0) continue;
        coreCandidates.push({
          mh: mhs[eid],
          isCore: CORE_ROLES.has(pair.role),
        });
      }
    }

    coreCandidates.sort((a, b) => {
      if (a.isCore !== b.isCore) return a.isCore ? -1 : 1;
      return b.mh.ses - a.mh.ses || a.mh.id - b.mh.id;
    });

    for (const cand of coreCandidates) {
      const { bIdx: pB, tIdx: pT, id: entId } = cand.mh;
      const mappedT = pBMap.get(pB);
      const mappedB = pTMap.get(pT);
      if (mappedT !== undefined && mappedT !== pT) {
        if (cand.isCore && rootMh.tier === 2) return null;
        continue;
      }
      if (mappedB !== undefined && mappedB !== pB) {
        if (cand.isCore && rootMh.tier === 2) return null;
        continue;
      }
      pBMap.set(pB, pT);
      pTMap.set(pT, pB);
      mhIdSet.add(entId);
    }

    const mhIds = Array.from(mhIdSet).sort((a, b) => a - b);
    let kernelSes = 0;
    for (const mid of mhIds) kernelSes += mhs[mid].ses;

    return {
      rootMhId: rootMh.id,
      mhIds,
      hoBSet,
      hoTSet,
      evBSet,
      evTSet,
      pBSet: new Set(pBMap.keys()),
      pTSet: new Set(pTMap.keys()),
      kernelSes,
    };
  };

  for (const m of mhs) {
    if (m.tier === 2 || (m.tier === 1 && !m.ascended)) {
      const k = buildConsistentClosure(m);
      if (k) kernels.push(k);
    }
  }

  kernels.sort((a, b) => b.kernelSes - a.kernelSes || a.rootMhId - b.rootMhId);
  if (kernels.length > 128) kernels.length = 128;

  const K = kernels.length;
  // 4 x Uint32 conflict vectors per kernel
  const noGoods = new Uint32Array(K * 4);

  const kernelsConflict = (k1: AtomicKernel, k2: AtomicKernel): boolean => {
    // Check HO 1-to-1 bijection across mapped HO MHs
    for (const id1 of k1.mhIds) {
      const m1 = mhs[id1];
      for (const id2 of k2.mhIds) {
        const m2 = mhs[id2];
        if (m1.tier !== m2.tier) continue;
        if (m1.tier === 2) {
          const h1B = effBaseHo[m1.bIdx].hid;
          const h1T = effTargetHo[m1.tIdx].hid;
          const h2B = effBaseHo[m2.bIdx].hid;
          const h2T = effTargetHo[m2.tIdx].hid;
          if ((h1B === h2B) !== (h1T === h2T)) return true;
        } else {
          if ((m1.bIdx === m2.bIdx) !== (m1.tIdx === m2.tIdx)) return true;
        }
      }
    }
    return false;
  };

  for (let i = 0; i < K; i++) {
    for (let j = i + 1; j < K; j++) {
      if (kernelsConflict(kernels[i], kernels[j])) {
        noGoods[i * 4 + (j >>> 5)] |= 1 << (j & 31);
        noGoods[j * 4 + (i >>> 5)] |= 1 << (i & 31);
      }
    }
  }

  // Recompute exact consistent SES on a chosen set of MH IDs
  const scoreMhSet = (mhIdSet: Set<number>): number => {
    const localSes = new Map<number, number>();
    for (const id of mhIdSet) {
      const m = mhs[id];
      if (m.tier === 2) localSes.set(id, m.w);
    }
    for (const id of mhIdSet) {
      const m = mhs[id];
      if (m.tier === 1) {
        let pSum = 0;
        for (const pid of m.parents) {
          if (mhIdSet.has(pid)) pSum += 0.80 * (localSes.get(pid) ?? 0);
        }
        localSes.set(id, m.w + Math.min(3.5, pSum));
      }
    }
    for (const id of mhIdSet) {
      const m = mhs[id];
      if (m.tier === 0) {
        let pSum = 0;
        for (const pid of m.parents) {
          if (mhIdSet.has(pid)) pSum += 0.80 * (localSes.get(pid) ?? 0);
        }
        localSes.set(id, m.w + Math.min(3.5, pSum));
      }
    }
    let total = 0;
    for (const v of localSes.values()) total += v;
    return total;
  };

  interface GmapCandidate {
    mhIdSet: Set<number>;
    totalSes: number;
  }

  const gmaps: GmapCandidate[] = [];
  const seedsToTry = Math.min(3, K);

  for (let s = 0; s < seedsToTry; s++) {
    let w0 = 0, w1 = 0, w2 = 0, w3 = 0;
    let c0 = 0, c1 = 0, c2 = 0, c3 = 0;

    const addKernel = (idx: number) => {
      const word = idx >>> 5;
      const bit = 1 << (idx & 31);
      if (word === 0) w0 |= bit;
      else if (word === 1) w1 |= bit;
      else if (word === 2) w2 |= bit;
      else w3 |= bit;
      c0 |= noGoods[idx * 4];
      c1 |= noGoods[idx * 4 + 1];
      c2 |= noGoods[idx * 4 + 2];
      c3 |= noGoods[idx * 4 + 3];
    };

    const conflictsWithCurrent = (idx: number): boolean => {
      const word = idx >>> 5;
      const bit = 1 << (idx & 31);
      if (word === 0) return (c0 & bit) !== 0;
      if (word === 1) return (c1 & bit) !== 0;
      if (word === 2) return (c2 & bit) !== 0;
      return (c3 & bit) !== 0;
    };

    addKernel(s);
    for (let i = 0; i < K; i++) {
      if (i === s) continue;
      if (!conflictsWithCurrent(i)) addKernel(i);
    }

    const chosenMask = [w0, w1, w2, w3];
    const mhIdSet = new Set<number>();
    for (let i = 0; i < K; i++) {
      if ((chosenMask[i >>> 5] & (1 << (i & 31))) !== 0) {
        for (const mid of kernels[i].mhIds) mhIdSet.add(mid);
      }
    }
    gmaps.push({ mhIdSet, totalSes: scoreMhSet(mhIdSet) });
  }

  gmaps.sort((a, b) => b.totalSes - a.totalSes);

  // Bounded Branch-and-Bound MWIS refinement when K <= 28 (maxNodes = 256)
  if (K > 0 && K <= 28) {
    let bestScore = gmaps[0]?.totalSes ?? 0;
    let bestMhSet: Set<number> | null = gmaps[0]?.mhIdSet ?? null;
    let nodesVisited = 0;
    const maxNodes = 256;

    // Precompute optimistic upper bound of unique MHs from suffix [idx..K-1]
    const suffixMhWeights = new Float64Array(K + 1);
    const seenInSuffix = new Set<number>();
    for (let i = K - 1; i >= 0; i--) {
      let add = 0;
      for (const mid of kernels[i].mhIds) {
        if (!seenInSuffix.has(mid)) {
          seenInSuffix.add(mid);
          add += mhs[mid].ses;
        }
      }
      suffixMhWeights[i] = suffixMhWeights[i + 1] + add;
    }

    const dfs = (idx: number, chosenMask: number, conflictMask: number, currentMhs: Set<number>, currentUbApprox: number) => {
      if (nodesVisited >= maxNodes) return;
      nodesVisited++;

      if (idx === K) {
        const s = scoreMhSet(currentMhs);
        if (s > bestScore) {
          bestScore = s;
          bestMhSet = new Set(currentMhs);
        }
        return;
      }

      if (currentUbApprox + suffixMhWeights[idx] <= bestScore) {
        return;
      }

      const bit = 1 << idx;
      if ((conflictMask & bit) === 0) {
        const added: number[] = [];
        let addedWeight = 0;
        for (const mid of kernels[idx].mhIds) {
          if (!currentMhs.has(mid)) {
            currentMhs.add(mid);
            added.push(mid);
            addedWeight += mhs[mid].ses;
          }
        }
        dfs(idx + 1, chosenMask | bit, conflictMask | noGoods[idx * 4], currentMhs, currentUbApprox + addedWeight);
        for (const mid of added) currentMhs.delete(mid);
      }

      dfs(idx + 1, chosenMask, conflictMask, currentMhs, currentUbApprox);
    };

    dfs(0, 0, 0, new Set<number>(), 0);
    if (bestMhSet && bestScore > (gmaps[0]?.totalSes ?? 0)) {
      gmaps.unshift({ mhIdSet: bestMhSet, totalSes: bestScore });
    }
  }

  const winningMhs = gmaps[0]?.mhIdSet ?? new Set<number>();
  return finalizeMappingAndProjectInferences(
    winningMhs,
    mhs,
    effBaseHo,
    effTargetHo,
    base,
    target,
    mode,
    simOracle,
    skipProjections,
  );
}

function finalizeMappingAndProjectInferences(
  winningMhs: Set<number>,
  mhs: InternalMh[],
  effBaseHo: NormalizedHoEdge[],
  effTargetHo: NormalizedHoEdge[],
  base: CompactHreg,
  target: CompactHreg,
  mode: SmeMode,
  simOracle: PredicateSimOracle,
  skipProjections = false,
): SmeMappingResult {
  const nB = base.events.length;
  const nT = target.events.length;

  // Recompute consistent trickle-down SES inside winning M*
  const localSes = new Map<number, number>();
  for (const id of winningMhs) {
    if (mhs[id].tier === 2) localSes.set(id, mhs[id].w);
  }
  for (const id of winningMhs) {
    const m = mhs[id];
    if (m.tier === 1) {
      let pSum = 0;
      for (const pid of m.parents) {
        if (winningMhs.has(pid)) pSum += 0.80 * (localSes.get(pid) ?? 0);
      }
      localSes.set(id, m.w + Math.min(3.5, pSum));
    }
  }
  for (const id of winningMhs) {
    const m = mhs[id];
    if (m.tier === 0) {
      let pSum = 0;
      for (const pid of m.parents) {
        if (winningMhs.has(pid)) pSum += 0.80 * (localSes.get(pid) ?? 0);
      }
      localSes.set(id, m.w + Math.min(3.5, pSum));
    }
  }

  const mappedEvents: SmeEventMapping[] = [];
  const mappedHo: SmeHoMapping[] = [];
  const mappedParticipants: SmeParticipantMapping[] = [];
  const mappedEvByBaseIdx = new Map<number, SmeEventMapping>();
  const mappedEvByBaseEid = new Map<number, SmeEventMapping>();
  const mappedEvByTargetEid = new Map<number, SmeEventMapping>();
  const mappedPartByBasePid = new Map<number, SmeParticipantMapping>();

  let totalSes = 0;
  let invertedMatchCount = 0;

  for (const id of winningMhs) {
    const m = mhs[id];
    const ses = localSes.get(id) ?? m.w;
    totalSes += ses;

    if (m.tier === 1) {
      const eB = base.events[m.bIdx];
      const eT = target.events[m.tIdx];
      if (m.isInvertedMatch) invertedMatchCount++;
      const em: SmeEventMapping = {
        baseEid: eB.eid,
        targetEid: eT.eid,
        baseIdx: m.bIdx,
        targetIdx: m.tIdx,
        w: m.w,
        ses,
        ascended: m.ascended,
        rung: m.rung,
        isInvertedMatch: m.isInvertedMatch,
        isCausativeExpanded: false,
      };
      mappedEvents.push(em);
      mappedEvByBaseIdx.set(m.bIdx, em);
      mappedEvByBaseEid.set(eB.eid, em);
      mappedEvByTargetEid.set(eT.eid, em);
    } else if (m.tier === 2) {
      const hB = effBaseHo[m.bIdx];
      const hT = effTargetHo[m.tIdx];
      mappedHo.push({
        baseHid: hB.hid,
        targetHid: hT.hid,
        baseIdx: m.bIdx,
        targetIdx: m.tIdx,
        baseHoType: hB.hoType,
        targetHoType: hT.hoType,
        w: m.w,
        ses,
        isTwoStepExpansion: m.isTwoStepExpansion,
      });
    } else {
      const pB = base.participants[m.bIdx];
      const pT = target.participants[m.tIdx];
      const pm: SmeParticipantMapping = {
        basePid: pB.pid,
        targetPid: pT.pid,
        baseIdx: m.bIdx,
        targetIdx: m.tIdx,
        w: m.w,
        ses,
        sameEntityOrConcept: simOracle.sameConceptOrTipnr(pB, pT),
      };
      mappedParticipants.push(pm);
      mappedPartByBasePid.set(pB.pid, pm);
    }
  }

  // Construct Mapped System Graph H(M*) over mappedEvents
  const numME = mappedEvents.length;
  const adj: number[][] = Array.from({ length: numME }, () => []);
  const reentEdges = new Set<string>();
  const hoEdgePairs = new Set<string>();
  const evPosByBaseIdx = new Map<number, number>();
  for (let i = 0; i < numME; i++) evPosByBaseIdx.set(mappedEvents[i].baseIdx, i);

  // Edges from mapped Tier-2 HO MHs
  const hoCountPerComponentEdge = new Map<string, number>();
  for (const hm of mappedHo) {
    const hB = effBaseHo[hm.baseIdx];
    const pos1 = evPosByBaseIdx.get(hB.fromIdx);
    const pos2 = evPosByBaseIdx.get(hB.toIdx);
    if (pos1 !== undefined && pos2 !== undefined && pos1 !== pos2) {
      adj[pos1].push(pos2);
      adj[pos2].push(pos1);
      const a = Math.min(pos1, pos2);
      const b = Math.max(pos1, pos2);
      const key = `${a}:${b}`;
      hoEdgePairs.add(key);
      hoCountPerComponentEdge.set(key, (hoCountPerComponentEdge.get(key) ?? 0) + 1);
    }
  }

  // Edges from consistently mapped participants appearing in BOTH events in BOTH Base and Target
  for (const pm of mappedParticipants) {
    const containing: number[] = [];
    for (let i = 0; i < numME; i++) {
      const em = mappedEvents[i];
      const eB = base.events[em.baseIdx];
      const eT = target.events[em.targetIdx];
      const inB = eB.argRoles.some((a) => a.pid === pm.basePid);
      const inT = eT.argRoles.some((a) => a.pid === pm.targetPid);
      if (inB && inT) containing.push(i);
    }
    for (let i = 0; i < containing.length; i++) {
      for (let j = i + 1; j < containing.length; j++) {
        const u = containing[i];
        const v = containing[j];
        adj[u].push(v);
        adj[v].push(u);
        const a = Math.min(u, v);
        const b = Math.max(u, v);
        reentEdges.add(`${a}:${b}:${pm.basePid}`);
      }
    }
  }

  // Find connected components of H(M*)
  const visited = new Uint8Array(numME);
  let bestCompNodes: number[] = [];
  let maxComponentSes = 0;
  let bestCompHoCount = 0;
  let bestCompReentCount = 0;

  for (let start = 0; start < numME; start++) {
    if (visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    const comp: number[] = [];
    while (stack.length > 0) {
      const u = stack.pop()!;
      comp.push(u);
      for (const v of adj[u]) {
        if (!visited[v]) {
          visited[v] = 1;
          stack.push(v);
        }
      }
    }

    const compSet = new Set(comp);
    let compSes = 0;
    for (const u of comp) compSes += mappedEvents[u].ses;

    let compHoCount = 0;
    for (const hm of mappedHo) {
      const hB = effBaseHo[hm.baseIdx];
      const p1 = evPosByBaseIdx.get(hB.fromIdx);
      const p2 = evPosByBaseIdx.get(hB.toIdx);
      if (p1 !== undefined && p2 !== undefined && compSet.has(p1) && compSet.has(p2)) {
        compSes += hm.ses;
        compHoCount++;
      }
    }

    // Add entity SES for mapped participants anchored in this component
    const compPids = new Set<number>();
    for (const u of comp) {
      const eB = base.events[mappedEvents[u].baseIdx];
      for (const a of eB.argRoles) {
        if (mappedPartByBasePid.has(a.pid)) compPids.add(a.pid);
      }
    }
    for (const pid of compPids) {
      compSes += mappedPartByBasePid.get(pid)!.ses;
    }

    let compReent = 0;
    for (const key of reentEdges) {
      const parts = key.split(':');
      const u = Number(parts[0]);
      const v = Number(parts[1]);
      if (compSet.has(u) && compSet.has(v)) compReent++;
    }

    if (
      compSes > maxComponentSes ||
      (compSes === maxComponentSes && comp.length > bestCompNodes.length)
    ) {
      maxComponentSes = compSes;
      bestCompNodes = comp;
      bestCompHoCount = compHoCount;
      bestCompReentCount = compReent;
    }
  }

  const largestComponentEventCount = bestCompNodes.length;
  const phiConn = totalSes > 0 ? maxComponentSes / Math.max(1e-6, totalSes) : 0;
  const phiDepth = Math.min(1.0, 0.22 + 0.18 * bestCompHoCount + 0.14 * bestCompReentCount);
  const sizePenalty = Math.log2(1 + 0.08 * Math.sqrt(Math.max(1, nB * nT)));

  // Hard Structural Admission Gate: |V(C_max)| >= 2 & require >= 1 Rung<=1 predicate or >= 2 mapped HO edges (or 2 non-ascended + 1 HO)
  const nonAscRung01 = mappedEvents.filter((m) => !m.ascended && m.rung <= 1).length;
  const nonAscCount = mappedEvents.filter((m) => !m.ascended).length;
  const hasGenuineSignal = nonAscRung01 >= 1 || mappedHo.length >= 2 || (nonAscCount >= 2 && mappedHo.length >= 1);
  const sms =
    largestComponentEventCount >= 2 && hasGenuineSignal
      ? Math.max(0, maxComponentSes * Math.sqrt(phiConn) * phiDepth - sizePenalty)
      : 0;

  if (skipProjections) {
    return {
      mode,
      mappedEvents,
      mappedHo,
      mappedParticipants,
      totalSes,
      maxComponentSes,
      largestComponentEventCount,
      largestComponentHoCount: bestCompHoCount,
      reentrantEdgeCount: bestCompReentCount,
      phiConn,
      phiDepth,
      sizePenalty,
      sms,
      invertedMatchCount,
      candidateInferences: [],
      unmappedBaseEvents: [],
      unmappedTargetEvents: [],
      divergences: [],
    };
  }

  // Candidate Inferences (SME Projection)
  const candidateInferences: SmeCandidateInference[] = [];
  const baseEventByEid = new Map<number, HregEvent>();
  for (const e of base.events) baseEventByEid.set(e.eid, e);
  const targetEventByEid = new Map<number, HregEvent>();
  for (const e of target.events) targetEventByEid.set(e.eid, e);
  const basePartByPid = new Map<number, HregParticipant>();
  for (const p of base.participants) basePartByPid.set(p.pid, p);
  const targetPartByPid = new Map<number, HregParticipant>();
  for (const p of target.participants) targetPartByPid.set(p.pid, p);

  for (const h of base.hoEdges) {
    if (h.hoType === 'ORD') continue;
    const fromMapped = mappedEvByBaseEid.get(h.fromEid);
    const toMapped = mappedEvByBaseEid.get(h.toEid);
    if ((fromMapped && !toMapped) || (!fromMapped && toMapped)) {
      const anchored = (fromMapped ?? toMapped)!;
      const unmappedBaseEid = fromMapped ? h.toEid : h.fromEid;
      const unmappedEv = baseEventByEid.get(unmappedBaseEid);
      if (!unmappedEv) continue;

      const substituted_args: SmeCandidateInference['substituted_args'] = [];
      const skolem_args: SmeCandidateInference['skolem_args'] = [];
      for (const a of unmappedEv.argRoles) {
        const pm = mappedPartByBasePid.get(a.pid);
        if (pm) {
          const tp = targetPartByPid.get(pm.targetPid);
          substituted_args.push({
            role: a.role,
            targetPid: pm.targetPid,
            targetStrongs: tp?.strongs ?? '',
            targetConceptId: tp?.conceptId ?? '',
          });
        } else {
          const bp = basePartByPid.get(a.pid);
          skolem_args.push({
            role: a.role,
            basePid: a.pid,
            skolemId: `SKOLEM_${base.pericopeId}_${a.pid}`,
            sort: bp?.sort ?? 'PROP',
          });
        }
      }

      candidateInferences.push({
        predicted_ho: h.hoType,
        direction: fromMapped ? 'FORWARD_TO_TARGET' : 'BACKWARD_FROM_TARGET',
        anchored_target_event_eid: anchored.targetEid,
        projected_event_arch: unmappedEv.arch,
        projected_event_strongs: unmappedEv.strongs,
        substituted_args,
        skolem_args,
        epistemic_class: 'semantic_hypothesis',
        is_candidate_inference: true,
      });
    }
  }

  // Explicit Residuals & Divergences
  const unmappedBaseEvents = base.events
    .filter((e) => !mappedEvByBaseEid.has(e.eid))
    .map((e) => ({ eid: e.eid, strongs: e.strongs, arch: e.arch, pol: e.pol }));
  const unmappedTargetEvents = target.events
    .filter((e) => !mappedEvByTargetEid.has(e.eid))
    .map((e) => ({ eid: e.eid, strongs: e.strongs, arch: e.arch, pol: e.pol }));

  const divergences: SmeDivergence[] = [];
  for (const em of mappedEvents) {
    const eB = baseEventByEid.get(em.baseEid)!;
    const eT = targetEventByEid.get(em.targetEid)!;
    if (eB.pol !== eT.pol || (eB.valence !== 0 && eT.valence !== 0 && eB.valence === -eT.valence)) {
      divergences.push({
        kind: 'POLARITY_MISMATCH',
        baseEid: eB.eid,
        targetEid: eT.eid,
        detail: `${eB.pol}(${eB.valence}) vs ${eT.pol}(${eT.valence})`,
      });
    }
    if (eB.force !== eT.force) {
      divergences.push({
        kind: 'FORCE_MISMATCH',
        baseEid: eB.eid,
        targetEid: eT.eid,
        detail: `${eB.force} vs ${eT.force}`,
      });
    }
    if (eB.isCausative !== eT.isCausative) {
      divergences.push({
        kind: 'CAUSATIVE_MISMATCH',
        baseEid: eB.eid,
        targetEid: eT.eid,
        detail: `causative(${eB.isCausative}) vs causative(${eT.isCausative})`,
      });
    }
    if (eB.strongs !== eT.strongs && !simOracle.isLxxLinked?.(eB.strongs, eT.strongs)) {
      divergences.push({
        kind: 'PREDICATE_DIVERGENCE',
        baseEid: eB.eid,
        targetEid: eT.eid,
        detail: `${eB.strongs || eB.arch} -> ${eT.strongs || eT.arch} (rung ${em.rung})`,
      });
    }
  }
  for (const hm of mappedHo) {
    if (hm.baseHoType !== hm.targetHoType) {
      divergences.push({
        kind: 'HO_TYPE_DIVERGENCE',
        baseHid: hm.baseHid,
        targetHid: hm.targetHid,
        detail: `${hm.baseHoType} vs ${hm.targetHoType}`,
      });
    }
  }

  return {
    mode,
    mappedEvents,
    mappedHo,
    mappedParticipants,
    totalSes,
    maxComponentSes,
    largestComponentEventCount,
    largestComponentHoCount: bestCompHoCount,
    reentrantEdgeCount: bestCompReentCount,
    phiConn,
    phiDepth,
    sizePenalty,
    sms,
    invertedMatchCount,
    candidateInferences,
    unmappedBaseEvents,
    unmappedTargetEvents,
    divergences,
  };
}

function buildSamePartMatrix(base: CompactHreg, target: CompactHreg, simOracle: PredicateSimOracle): Uint8Array {
  const nPB = base.participants.length;
  const nPT = target.participants.length;
  const mat = new Uint8Array(nPB * nPT);
  for (let i = 0; i < nPB; i++) {
    for (let j = 0; j < nPT; j++) {
      mat[i * nPT + j] = simOracle.sameConceptOrTipnr(base.participants[i], target.participants[j]) ? 1 : 0;
    }
  }
  return mat;
}

/**
 * Run `Biblical-SME` in a specific polarity regime (`CONCORDANT` or `INVERSION`).
 */
export function runBiblicalSME(
  baseInput: CompactHreg,
  targetInput: CompactHreg,
  simOracle: PredicateSimOracle,
  mode: SmeMode,
): SmeMappingResult {
  const base = capHregForSme(baseInput);
  const target = capHregForSme(targetInput);
  const predMatrix = precomputePredicateMatrix(base, target, simOracle, mode);
  const samePartMatrix = buildSamePartMatrix(base, target, simOracle);
  return solveBiblicalSmeWithMatrix(base, target, simOracle, mode, predMatrix, samePartMatrix);
}

function createRewiredTargetHreg(target: CompactHreg, rng: () => number): CompactHreg {
  const nE = target.events.length;
  const eids = target.events.map((e) => e.eid);

  // Permute event indices for HO endpoint rewiring (preserving HO degree structure & event predicates)
  const permE = eids.slice();
  for (let i = permE.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = permE[i];
    permE[i] = permE[j];
    permE[j] = tmp;
  }
  const eidMap = new Map<number, number>();
  for (let i = 0; i < nE; i++) eidMap.set(eids[i], permE[i]);

  // Also shuffle toEid across multiple non-ORD HO edges to prevent fixed-point motifs
  const nonOrd = target.hoEdges.filter((h) => h.hoType !== 'ORD');
  const shuffledTos = nonOrd.map((h) => eidMap.get(h.toEid) ?? h.toEid);
  for (let i = shuffledTos.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffledTos[i];
    shuffledTos[i] = shuffledTos[j];
    shuffledTos[j] = tmp;
  }

  let nonOrdIdx = 0;
  const rewiredHo: HregHoEdge[] = target.hoEdges.map((h) => {
    if (h.hoType === 'ORD') return h;
    const fromEid = eidMap.get(h.fromEid) ?? h.fromEid;
    let toEid = shuffledTos[nonOrdIdx++] ?? (eidMap.get(h.toEid) ?? h.toEid);
    if (toEid === fromEid && nE >= 2) {
      toEid = eids.find((id) => id !== fromEid) ?? toEid;
    }
    return { ...h, fromEid, toEid };
  });

  // Permute participant IDs across all event role slots (preserving slot counts per event & participant lexemes)
  const allSlotPids: number[] = [];
  for (const e of target.events) {
    for (const a of e.argRoles) allSlotPids.push(a.pid);
  }
  for (let i = allSlotPids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = allSlotPids[i];
    allSlotPids[i] = allSlotPids[j];
    allSlotPids[j] = tmp;
  }

  let slotCursor = 0;
  const rewiredEvents: HregEvent[] = target.events.map((e) => {
    const newArgs = e.argRoles.map((a) => ({
      role: a.role,
      pid: allSlotPids[slotCursor++],
    }));
    // With 50% probability on multi-arg events, swap two role assignments to break role lock
    if (newArgs.length >= 2 && rng() < 0.5) {
      const tmpRole = newArgs[0].role;
      newArgs[0] = { role: newArgs[1].role, pid: newArgs[0].pid };
      newArgs[1] = { role: tmpRole, pid: newArgs[1].pid };
    }
    return { ...e, argRoles: newArgs };
  });

  return {
    ...target,
    events: rewiredEvents,
    hoEdges: rewiredHo,
  };
}

function computeLexicalOverlap(base: CompactHreg, target: CompactHreg, simOracle: PredicateSimOracle): number {
  let hits = 0;
  const total = Math.max(1, base.events.length + base.participants.length);

  for (const eB of base.events) {
    const matched = target.events.some(
      (eT) =>
        (eB.strongs && eT.strongs && (eB.strongs === eT.strongs || simOracle.isLxxLinked?.(eB.strongs, eT.strongs))) ||
        (eB.conceptId && eT.conceptId && eB.conceptId === eT.conceptId),
    );
    if (matched) hits++;
  }
  for (const pB of base.participants) {
    const matched = target.participants.some((pT) => simOracle.sameConceptOrTipnr(pB, pT));
    if (matched) hits++;
  }
  return hits / total;
}

/**
 * Evaluate a passage pair across BOTH `CONCORDANT` and `INVERSION` regimes,
 * execute the Conditional-Structure Permutation Null (`B_perm = 32`), and classify
 * into Gentner's 4 quadrants with Candidate Inferences & Explicit Residuals.
 */
export function evaluateSmePair(
  baseInput: CompactHreg,
  targetInput: CompactHreg,
  simOracle: PredicateSimOracle,
  opts: { bPerm?: number } = {},
): SmePairEvaluation {
  const bPerm = opts.bPerm ?? 32;
  const base = capHregForSme(baseInput);
  const target = capHregForSme(targetInput);
  const samePartMatrix = buildSamePartMatrix(base, target, simOracle);

  const concPredMatrix = precomputePredicateMatrix(base, target, simOracle, 'CONCORDANT');
  const concRes = solveBiblicalSmeWithMatrix(base, target, simOracle, 'CONCORDANT', concPredMatrix, samePartMatrix);

  const invPredMatrix = precomputePredicateMatrix(base, target, simOracle, 'INVERSION');
  const invRes = solveBiblicalSmeWithMatrix(base, target, simOracle, 'INVERSION', invPredMatrix, samePartMatrix);

  const inversionWins =
    invRes.invertedMatchCount >= 1 &&
    invRes.sms > concRes.sms;
  const regime: SmeMode = inversionWins ? 'INVERSION' : 'CONCORDANT';
  const winning = inversionWins ? invRes : concRes;
  const winPredMatrix = inversionWins ? invPredMatrix : concPredMatrix;

  let geCount = 0;
  if (winning.sms > 0.15 && winning.largestComponentEventCount >= 2 && bPerm > 0) {
    const seed = ((base.pericopeId * 2654435761) ^ (target.pericopeId * 2246822519) ^ (regime === 'INVERSION' ? 0x9e3779b9 : 0x85ebca6b)) >>> 0;
    const rng = mulberry32(seed || 1);
    for (let b = 0; b < bPerm; b++) {
      const rewired = createRewiredTargetHreg(target, rng);
      const permRes = solveBiblicalSmeWithMatrix(base, rewired, simOracle, regime, winPredMatrix, samePartMatrix, true);
      if (permRes.sms >= winning.sms) {
        geCount++;
        if (geCount >= 3) break;
      }
    }
  } else if (bPerm > 0) {
    geCount = bPerm;
  }

  const pStruct = (1 + geCount) / (bPerm + 1);
  const deltaSmeStruct =
    pStruct < 0.05 && winning.largestComponentEventCount >= 2 && winning.sms > 0
      ? Math.min(12.0, -Math.log2(Math.max(pStruct, 1e-4)))
      : 0;

  let sameEntCount = 0;
  for (const pm of winning.mappedParticipants) {
    if (pm.sameEntityOrConcept) sameEntCount++;
  }
  const rhoEnt = winning.mappedParticipants.length > 0
    ? sameEntCount / winning.mappedParticipants.length
    : 0;

  const lexOverlap = computeLexicalOverlap(base, target, simOracle);

  let classification: SmeQuadrant;
  let subTag: 'INVERSION' | null = null;
  if (deltaSmeStruct > 0 && rhoEnt < 0.35) {
    classification = 'CROSS_DOMAIN_ANALOGY';
    if (regime === 'INVERSION') subTag = 'INVERSION';
  } else if (deltaSmeStruct > 0 && rhoEnt >= 0.35) {
    classification = 'LITERAL_PARALLEL_OR_TYPOLOGY';
    if (regime === 'INVERSION') subTag = 'INVERSION';
  } else if (deltaSmeStruct === 0 && lexOverlap > 0) {
    classification = 'MERE_SURFACE_OVERLAP';
  } else {
    classification = 'UNRELATED';
  }

  return {
    basePericopeId: base.pericopeId,
    targetPericopeId: target.pericopeId,
    regime,
    classification,
    subTag,
    winning,
    concordant: concRes,
    inversion: invRes,
    bPerm,
    pStruct,
    deltaSmeStruct,
    rhoEnt,
    lexOverlap,
    candidateInferences: winning.candidateInferences,
    unmappedBaseEvents: winning.unmappedBaseEvents,
    unmappedTargetEvents: winning.unmappedTargetEvents,
    divergences: winning.divergences,
  };
}

/**
 * Multi-Passage Progressive Analogical Generalization (`SEQL-Biblical`, m = 3..6 passages).
 * Produces a `STRUCTURAL_SCHEMA_GENERALIZATION` with abstract relational schema,
 * `passage x role-slot` table, and unmatched residuals.
 */
export function runSeqlGeneralization(
  hregs: CompactHreg[],
  simOracle: PredicateSimOracle,
  opts: { bPerm?: number } = {},
): SeqlGeneralizationResult {
  if (hregs.length < 3 || hregs.length > 6) {
    throw new Error(`SEQL-Biblical requires 3..6 passages, got ${hregs.length}`);
  }

  const pairwiseEvaluations: SmePairEvaluation[] = [];
  let bestPairEval: SmePairEvaluation | null = null;
  let bestIdxPair: [number, number] = [0, 1];

  for (let i = 0; i < hregs.length; i++) {
    for (let j = i + 1; j < hregs.length; j++) {
      const ev = evaluateSmePair(hregs[i], hregs[j], simOracle, opts);
      pairwiseEvaluations.push(ev);
      const score = ev.winning.sms + ev.winning.mappedHo.length * 0.25 + ev.winning.mappedEvents.length * 0.1;
      const bestScore = bestPairEval
        ? bestPairEval.winning.sms + bestPairEval.winning.mappedHo.length * 0.25 + bestPairEval.winning.mappedEvents.length * 0.1
        : -1;
      if (score > bestScore) {
        bestPairEval = ev;
        bestIdxPair = [i, j];
      }
    }
  }

  const [i0, j0] = bestIdxPair;
  const anchorA = hregs[i0];
  const anchorB = hregs[j0];
  const initMap = bestPairEval!.winning;

  const aEvByEid = new Map(anchorA.events.map((e) => [e.eid, e]));
  const bEvByEid = new Map(anchorB.events.map((e) => [e.eid, e]));
  const aPartByPid = new Map(anchorA.participants.map((p) => [p.pid, p]));
  const bPartByPid = new Map(anchorB.participants.map((p) => [p.pid, p]));

  // Build initial schema events & slots from (anchorA, anchorB)
  const schemaEvents: SeqlSchemaEvent[] = [];
  const anchorAEidToSlot = new Map<number, number>();
  const anchorBEidToSlot = new Map<number, number>();

  for (let k = 0; k < initMap.mappedEvents.length; k++) {
    const em = initMap.mappedEvents[k];
    const eA = aEvByEid.get(em.baseEid)!;
    const eB = bEvByEid.get(em.targetEid)!;
    const slotId = `SE_${k}`;
    anchorAEidToSlot.set(eA.eid, k);
    anchorBEidToSlot.set(eB.eid, k);
    schemaEvents.push({
      slotId,
      arch: eA.arch,
      archetypesObserved: eA.arch === eB.arch ? [eA.arch] : [eA.arch, eB.arch],
      frequency: 2,
      witnesses: [
        { pericopeId: anchorA.pericopeId, eid: eA.eid, strongs: eA.strongs, conceptId: eA.conceptId, arch: eA.arch, pol: eA.pol, force: eA.force },
        { pericopeId: anchorB.pericopeId, eid: eB.eid, strongs: eB.strongs, conceptId: eB.conceptId, arch: eB.arch, pol: eB.pol, force: eB.force },
      ],
    });
  }

  const roleSlotTable: SeqlRoleSlotRow[] = [];
  const anchorAPidToSlot = new Map<number, number>();
  const anchorBPidToSlot = new Map<number, number>();

  const inferRoleHint = (pidA: number): ArgRole => {
    for (const e of anchorA.events) {
      for (const a of e.argRoles) {
        if (a.pid === pidA) return a.role;
      }
    }
    return 'PATIENT';
  };

  for (let k = 0; k < initMap.mappedParticipants.length; k++) {
    const pm = initMap.mappedParticipants[k];
    const pA = aPartByPid.get(pm.basePid)!;
    const pB = bPartByPid.get(pm.targetPid)!;
    anchorAPidToSlot.set(pA.pid, k);
    anchorBPidToSlot.set(pB.pid, k);
    const perPassage: SeqlRoleSlotRow['perPassage'] = {};
    for (const h of hregs) perPassage[h.pericopeId] = null;
    perPassage[anchorA.pericopeId] = { pid: pA.pid, strongs: pA.strongs, conceptId: pA.conceptId, sort: pA.sort };
    perPassage[anchorB.pericopeId] = { pid: pB.pid, strongs: pB.strongs, conceptId: pB.conceptId, sort: pB.sort };
    roleSlotTable.push({
      slotId: `X_${k}`,
      roleHint: inferRoleHint(pA.pid),
      frequency: 2,
      perPassage,
    });
  }

  const schemaHoEdges: SeqlSchemaHoEdge[] = [];
  const schemaHoMap = new Map<string, SeqlSchemaHoEdge>();
  const aHoByHid = new Map(anchorA.hoEdges.map((h) => [h.hid, h]));
  for (const hm of initMap.mappedHo) {
    const hA = aHoByHid.get(hm.baseHid);
    if (!hA) continue;
    const fromSlotIdx = anchorAEidToSlot.get(hA.fromEid);
    const toSlotIdx = anchorAEidToSlot.get(hA.toEid);
    if (fromSlotIdx === undefined || toSlotIdx === undefined) continue;
    const key = `${hm.baseHoType}:${fromSlotIdx}:${toSlotIdx}`;
    if (!schemaHoMap.has(key)) {
      const entry: SeqlSchemaHoEdge = {
        hoType: hm.baseHoType,
        fromSlotId: `SE_${fromSlotIdx}`,
        toSlotId: `SE_${toSlotIdx}`,
        frequency: 2,
      };
      schemaHoMap.set(key, entry);
      schemaHoEdges.push(entry);
    }
  }

  // Track residuals per passage
  const residualsPerPassage: SeqlGeneralizationResult['residualsPerPassage'] = {};
  residualsPerPassage[anchorA.pericopeId] = anchorA.events
    .filter((e) => !anchorAEidToSlot.has(e.eid))
    .map((e) => ({ eid: e.eid, strongs: e.strongs, arch: e.arch, pol: e.pol }));
  residualsPerPassage[anchorB.pericopeId] = anchorB.events
    .filter((e) => !anchorBEidToSlot.has(e.eid))
    .map((e) => ({ eid: e.eid, strongs: e.strongs, arch: e.arch, pol: e.pol }));

  // Step 2: Progressively align each remaining anchor A_k against schema represented on anchorA
  for (let idx = 0; idx < hregs.length; idx++) {
    if (idx === i0 || idx === j0) continue;
    const anchorK = hregs[idx];
    const kEvByEid = new Map(anchorK.events.map((e) => [e.eid, e]));
    const kPartByPid = new Map(anchorK.participants.map((p) => [p.pid, p]));

    // Build synthetic schema HREG grounded on anchorA's aligned subgraph (or best of anchorA / anchorB)
    const evalVsA = pairwiseEvaluations.find(
      (ev) =>
        (ev.basePericopeId === anchorA.pericopeId && ev.targetPericopeId === anchorK.pericopeId) ||
        (ev.basePericopeId === anchorK.pericopeId && ev.targetPericopeId === anchorA.pericopeId),
    ) ?? evaluateSmePair(anchorA, anchorK, simOracle, opts);
    const evalVsB = pairwiseEvaluations.find(
      (ev) =>
        (ev.basePericopeId === anchorB.pericopeId && ev.targetPericopeId === anchorK.pericopeId) ||
        (ev.basePericopeId === anchorK.pericopeId && ev.targetPericopeId === anchorB.pericopeId),
    ) ?? evaluateSmePair(anchorB, anchorK, simOracle, opts);

    const useAnchorA = evalVsA.winning.sms >= evalVsB.winning.sms;
    const chosenEval = useAnchorA ? evalVsA : evalVsB;
    const refPericopeId = useAnchorA ? anchorA.pericopeId : anchorB.pericopeId;
    const refEidToSlot = useAnchorA ? anchorAEidToSlot : anchorBEidToSlot;
    const refPidToSlot = useAnchorA ? anchorAPidToSlot : anchorBPidToSlot;
    const kIsTarget = chosenEval.targetPericopeId === anchorK.pericopeId;

    const mappedKEids = new Set<number>();
    const kEidToSlot = new Map<number, number>();

    for (const em of chosenEval.winning.mappedEvents) {
      const refEid = kIsTarget ? em.baseEid : em.targetEid;
      const kEid = kIsTarget ? em.targetEid : em.baseEid;
      const slotIdx = refEidToSlot.get(refEid);
      if (slotIdx === undefined) continue;
      const evK = kEvByEid.get(kEid);
      if (!evK) continue;

      mappedKEids.add(kEid);
      kEidToSlot.set(kEid, slotIdx);
      const se = schemaEvents[slotIdx];
      if (!se.witnesses.some((w) => w.pericopeId === anchorK.pericopeId)) {
        se.frequency++;
        if (!se.archetypesObserved.includes(evK.arch)) se.archetypesObserved.push(evK.arch);
        se.witnesses.push({
          pericopeId: anchorK.pericopeId,
          eid: evK.eid,
          strongs: evK.strongs,
          conceptId: evK.conceptId,
          arch: evK.arch,
          pol: evK.pol,
          force: evK.force,
        });
      }
    }

    for (const pm of chosenEval.winning.mappedParticipants) {
      const refPid = kIsTarget ? pm.basePid : pm.targetPid;
      const kPid = kIsTarget ? pm.targetPid : pm.basePid;
      const slotIdx = refPidToSlot.get(refPid);
      if (slotIdx === undefined) continue;
      const pK = kPartByPid.get(kPid);
      if (!pK) continue;

      const row = roleSlotTable[slotIdx];
      if (row.perPassage[anchorK.pericopeId] === null) {
        row.frequency++;
        row.perPassage[anchorK.pericopeId] = {
          pid: pK.pid,
          strongs: pK.strongs,
          conceptId: pK.conceptId,
          sort: pK.sort,
        };
      }
    }

    const refHreg = refPericopeId === anchorA.pericopeId ? anchorA : anchorB;
    const refHoByHid = new Map(refHreg.hoEdges.map((h) => [h.hid, h]));
    const incrementedHoKeys = new Set<string>();
    for (const hm of chosenEval.winning.mappedHo) {
      const refHid = kIsTarget ? hm.baseHid : hm.targetHid;
      const hRef = refHoByHid.get(refHid);
      if (!hRef) continue;
      const fromSlotIdx = refEidToSlot.get(hRef.fromEid);
      const toSlotIdx = refEidToSlot.get(hRef.toEid);
      if (fromSlotIdx === undefined || toSlotIdx === undefined) continue;
      const key = `${hm.baseHoType}:${fromSlotIdx}:${toSlotIdx}`;
      const existing = schemaHoMap.get(key);
      if (existing && !incrementedHoKeys.has(key)) {
        incrementedHoKeys.add(key);
        existing.frequency++;
      }
    }

    residualsPerPassage[anchorK.pericopeId] = anchorK.events
      .filter((e) => !mappedKEids.has(e.eid))
      .map((e) => ({ eid: e.eid, strongs: e.strongs, arch: e.arch, pol: e.pol }));
  }

  return {
    tag: 'STRUCTURAL_SCHEMA_GENERALIZATION',
    passageCount: hregs.length,
    pericopeIds: hregs.map((h) => h.pericopeId),
    anchorPair: [anchorA.pericopeId, anchorB.pericopeId],
    schemaEvents,
    schemaHoEdges,
    roleSlotTable,
    residualsPerPassage,
    pairwiseEvaluations,
  };
}
