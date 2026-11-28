// @file: src/relationships/v3-scorer.ts
// BibleResearch v3 Submodular Multi-Axis Log-Bayes Scorer (E_perp),
// Rarity-Preserving AxisFactor, Co-Hyponym Material Correlation Damping,
// Information-Bottleneck Bridge Pivot Scoring, and Submodular Set-Cover Diversifier.
// Pure TypeScript; zero Node-only imports.

import type { PprEntry } from './v3-binary-index.ts';

export type EpistemicRegister =
  | 'TEXTUAL_WITNESS'
  | 'LINGUISTIC_GRAMMATICAL'
  | 'STRUCTURAL_RHETORICAL'
  | 'PHYSICAL_ANALOGICAL';

export interface PassagePprAnchorTerm {
  nodeId: number;
  idf: number;
  axisKey: string;
  cohyponymGroup?: string;
}

export interface PassagePprDistribution {
  anchorVids: Set<number>;
  testament: 'OT' | 'NT' | 'MIXED';
  tokenCount: number;
  mass: Map<number, number>; // nodeId -> p_hat(z)
}

export interface AxisScoreDetail {
  axis: string;
  bits: number;
  rawRatio: number;
  isPhysical: boolean;
  isExplicitCue: boolean;
  maxRarityBits: number;
  cohyponymGroup?: string;
  witnessNodes: number[];
}

export interface EPerpScoreResult {
  ePerpBits: number;
  rawTextualBits: number;
  physicalBitsCapped: number;
  nEff: number;
  axisFactor: number;
  singleAxisFloor: number;
  maxAxisRarityBits: number;
  lengthPenaltyBits: number;
  independentAxes: AxisScoreDetail[];
  dominantRegister: EpistemicRegister;
  pNullApprox: number;
}

export interface PivotCandidateInput {
  vid: number;
  ref?: string;
  anchorMasses: number[]; // p_hat_{A_i}(v*) for i=1..m
  bridgedAxes: string[];
  rarityGain: number; // mean IDF / rarity above baseline
}

export interface PivotRankedResult {
  vid: number;
  ref?: string;
  pivotScore: number;
  geometricMeanMass: number;
  axisCount: number;
  bridgedAxes: string[];
}

export interface DiversifiableClue {
  id: string;
  score: number;
  axes: string[];
  passages: number[];
  register: EpistemicRegister;
}

/**
 * Reconstruct passage typed PPR distribution p_hat_A(z) in < 150 us
 * from offline Top-64 quantized PPR vectors plus direct anchor & xref mass.
 */
export function reconstructPassagePpr(
  anchorVids: number[],
  terms: PassagePprAnchorTerm[],
  pprLookup: (seedNodeId: number) => PprEntry[],
  xrefTargets: Array<{ targetVid: number; weight: number }> = [],
  options: { alpha?: number; etaXref?: number; testament?: 'OT' | 'NT' | 'MIXED'; tokenCount?: number } = {},
): PassagePprDistribution {
  const alpha = options.alpha ?? 0.20;
  const etaXref = options.etaXref ?? 0.12;
  const anchorSet = new Set(anchorVids);
  const mass = new Map<number, number>();

  if (anchorVids.length > 0) {
    const aWeight = alpha / anchorVids.length;
    for (const vid of anchorVids) {
      mass.set(vid, (mass.get(vid) ?? 0) + aWeight);
    }
  }

  let totalIdf = 0;
  for (const t of terms) totalIdf += Math.max(0.25, t.idf);
  if (totalIdf > 0) {
    const pprScale = 1 - alpha;
    for (const t of terms) {
      const piTilde = Math.max(0.25, t.idf) / totalIdf;
      const entries = pprLookup(t.nodeId);
      const termWeight = pprScale * piTilde;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        mass.set(e.targetNodeId, (mass.get(e.targetNodeId) ?? 0) + termWeight * e.prob);
      }
      // Include direct seed node mass so exact lemma intersections contribute cleanly
      mass.set(t.nodeId, (mass.get(t.nodeId) ?? 0) + termWeight * alpha);
    }
  }

  if (xrefTargets.length > 0) {
    let xSum = 0;
    for (const x of xrefTargets) xSum += Math.max(0, x.weight);
    if (xSum > 0) {
      for (const x of xrefTargets) {
        const w = etaXref * (Math.max(0, x.weight) / xSum);
        mass.set(x.targetVid, (mass.get(x.targetVid) ?? 0) + w);
      }
    }
  }

  const minVid = anchorVids.length > 0 ? Math.min(...anchorVids) : 1;
  const maxVid = anchorVids.length > 0 ? Math.max(...anchorVids) : 1;
  const inferredTestament: 'OT' | 'NT' | 'MIXED' =
    options.testament ?? (maxVid <= 23213 ? 'OT' : minVid >= 23214 ? 'NT' : 'MIXED');

  return {
    anchorVids: anchorSet,
    testament: inferredTestament,
    tokenCount: Math.max(1, options.tokenCount ?? Math.max(4, terms.length * 2)),
    mass,
  };
}

export interface NodeAxisMeta {
  axisKey: string;
  nullP0: number; // baseline prior P_0(z) in same-testament null
  df: number;
  isPhysical?: boolean;
  isExplicitCue?: boolean;
  cohyponymGroup?: string;
  register?: EpistemicRegister;
}

/**
 * Compute Submodular Multi-Axis Log-Bayes Score E_perp(A, B) with:
 * - Within-axis log2(1 + sum LR) saturation (suppressing redundant single-axis xrefs)
 * - Cross-testament P0 = 0.28 * P0_same normalization
 * - Co-hyponym material correlation damping (1 / (1 + 0.65 * (k_group - 1))) inside N_eff
 * - Rarity-preserving AxisFactor: preserves rare single-channel breakthroughs (df <= 10 or explicit cue)
 *   while crushing medium-frequency single-axis traps (H1817 door, df=78 -> -74%).
 */
export function computeEPerpScore(
  distA: PassagePprDistribution,
  distB: PassagePprDistribution,
  getNodeMeta: (nodeId: number) => NodeAxisMeta | null,
  extras: {
    deltaSeqBits?: number;
    deltaSmeStructBits?: number;
    deltaEsideBits?: number;
    delta3WayBits?: number;
    deltaWordplayBits?: number;
    cLen?: number;
  } = {},
): EPerpScoreResult {
  const isCrossTestament =
    (distA.testament === 'OT' && distB.testament === 'NT') ||
    (distA.testament === 'NT' && distB.testament === 'OT');
  const p0Scale = isCrossTestament ? 0.28 : 1.0;

  // Iterate smaller mass map for O(min(|A|, |B|)) speed
  const [small, large] = distA.mass.size <= distB.mass.size ? [distA.mass, distB.mass] : [distB.mass, distA.mass];
  const axisAccum = new Map<
    string,
    {
      lrSum: number;
      isPhysical: boolean;
      isExplicitCue: boolean;
      maxRarityBits: number;
      cohyponymGroup?: string;
      witnessNodes: number[];
      register: EpistemicRegister;
    }
  >();

  for (const [nodeId, pSmall] of small) {
    const pLarge = large.get(nodeId);
    if (!pLarge || pLarge <= 0 || pSmall <= 0) continue;
    const meta = getNodeMeta(nodeId);
    if (!meta) continue;
    const p0 = Math.max(1e-7, meta.nullP0 * p0Scale);
    const lr = (pSmall * pLarge) / p0;
    const rarityBits = Math.max(0, Math.log2(31203 / Math.max(1, meta.df)));

    let entry = axisAccum.get(meta.axisKey);
    if (!entry) {
      entry = {
        lrSum: 0,
        isPhysical: Boolean(meta.isPhysical),
        isExplicitCue: Boolean(meta.isExplicitCue),
        maxRarityBits: rarityBits,
        cohyponymGroup: meta.cohyponymGroup,
        witnessNodes: [],
        register: meta.register ?? (meta.isPhysical ? 'PHYSICAL_ANALOGICAL' : 'LINGUISTIC_GRAMMATICAL'),
      };
      axisAccum.set(meta.axisKey, entry);
    }
    entry.lrSum += lr;
    if (rarityBits > entry.maxRarityBits) entry.maxRarityBits = rarityBits;
    if (meta.isExplicitCue) entry.isExplicitCue = true;
    if (entry.witnessNodes.length < 8) entry.witnessNodes.push(nodeId);
  }

  const textualAxes: AxisScoreDetail[] = [];
  const physicalAxes: AxisScoreDetail[] = [];

  for (const [axis, acc] of axisAccum) {
    const bits = Math.log2(1 + acc.lrSum);
    if (bits < 0.05) continue;
    const detail: AxisScoreDetail = {
      axis,
      bits,
      rawRatio: acc.lrSum,
      isPhysical: acc.isPhysical,
      isExplicitCue: acc.isExplicitCue,
      maxRarityBits: acc.maxRarityBits,
      cohyponymGroup: acc.cohyponymGroup,
      witnessNodes: acc.witnessNodes,
    };
    if (acc.isPhysical) physicalAxes.push(detail);
    else textualAxes.push(detail);
  }

  const deltaSeq = Math.max(0, extras.deltaSeqBits ?? 0);
  const deltaSme = Math.max(0, extras.deltaSmeStructBits ?? 0);
  const combinedStructBits = Math.max(deltaSeq, deltaSme);
  const deltaEside = Math.max(0, extras.deltaEsideBits ?? 0);
  const delta3Way = Math.max(0, extras.delta3WayBits ?? 0);
  const deltaWp = Math.max(0, extras.deltaWordplayBits ?? 0);

  // Anti-double-counting rule: Biblical-SME and SW^piece_pol share ONE structural axis family.
  if (combinedStructBits > 0) {
    textualAxes.push({
      axis: deltaSme >= deltaSeq ? 'AXIS:STRUCTURAL_MAPPING' : 'AXIS:SEQUENCE_ALIGNMENT',
      bits: combinedStructBits,
      rawRatio: Math.pow(2, combinedStructBits) - 1,
      isPhysical: false,
      isExplicitCue: combinedStructBits >= 4.0,
      maxRarityBits: combinedStructBits + 6.0,
      witnessNodes: [],
    });
  }
  if (deltaEside > 0) {
    textualAxes.push({
      axis: 'AXIS:EXPLICIT_INTERP',
      bits: deltaEside,
      rawRatio: Math.pow(2, deltaEside) - 1,
      isPhysical: false,
      isExplicitCue: true,
      maxRarityBits: Math.max(13.5, deltaEside + 8.0),
      witnessNodes: [],
    });
  }
  if (delta3Way > 0) {
    textualAxes.push({
      axis: 'AXIS:TRITEXTUAL_WITNESS',
      bits: delta3Way,
      rawRatio: Math.pow(2, delta3Way) - 1,
      isPhysical: false,
      isExplicitCue: true,
      maxRarityBits: delta3Way + 8.0,
      witnessNodes: [],
    });
  }
  if (deltaWp > 0) {
    textualAxes.push({
      axis: 'AXIS:WORDPLAY_CUE',
      bits: deltaWp,
      rawRatio: Math.pow(2, deltaWp) - 1,
      isPhysical: false,
      isExplicitCue: true,
      maxRarityBits: deltaWp + 7.5,
      witnessNodes: [],
    });
  }

  // Co-hyponym material correlation weighting inside N_eff
  const groupCounts = new Map<string, number>();
  for (const a of textualAxes) {
    if (a.cohyponymGroup) {
      groupCounts.set(a.cohyponymGroup, (groupCounts.get(a.cohyponymGroup) ?? 0) + 1);
    }
  }

  let rawTextualBits = 0;
  let weightedSum = 0;
  const weightedBits: number[] = [];
  let maxAxisRarityBits = 0;

  for (const a of textualAxes) {
    rawTextualBits += a.bits;
    const effRarity = a.isExplicitCue ? Math.max(a.maxRarityBits, 13.0) : a.maxRarityBits;
    if (effRarity > maxAxisRarityBits) maxAxisRarityBits = effRarity;

    const kGroup = a.cohyponymGroup ? (groupCounts.get(a.cohyponymGroup) ?? 1) : 1;
    const corrWeight = 1 / (1 + 0.65 * (kGroup - 1));
    const wb = a.bits * corrWeight;
    weightedBits.push(wb);
    weightedSum += wb;
  }

  let nEff = 1.0;
  if (weightedSum > 0 && weightedBits.length > 0) {
    let entropy = 0;
    for (const wb of weightedBits) {
      const q = wb / weightedSum;
      if (q > 1e-12) entropy -= q * Math.log(q);
    }
    nEff = Math.exp(entropy);
  }

  // v3.1 Rarity-Preserving Single-Axis Floor
  // df=78 -> rarity ~8.64 -> floor ~0.135 (damped -74% as intended against NEG6)
  // df<=10 -> rarity >= 11.6 -> floor >= 0.75; df<=4 or explicit cue -> floor >= 0.92
  const singleAxisFloor = maxAxisRarityBits > 0 ? 1 / (1 + Math.exp(-(maxAxisRarityBits - 10.5))) : 0;
  const nEffFactor = Math.max(0, Math.min(1.0, (nEff - 0.65) / 1.35));
  const axisFactor = Math.max(singleAxisFloor, nEffFactor);

  const rawPhysBits = physicalAxes.reduce((s, a) => s + a.bits, 0);
  const physicalBitsCapped = rawTextualBits > 0 ? Math.min(rawPhysBits, 0.15 * rawTextualBits) : Math.min(rawPhysBits, 1.5);

  const cLen = extras.cLen ?? 0.015;
  const lengthPenaltyBits = Math.log2(1 + cLen * Math.sqrt(distA.tokenCount * distB.tokenCount));

  const convergedTextual = rawTextualBits * axisFactor;
  const ePerpBits = Math.max(0, convergedTextual + physicalBitsCapped - lengthPenaltyBits);

  let dominantRegister: EpistemicRegister = 'LINGUISTIC_GRAMMATICAL';
  if (delta3Way >= 3.0 || deltaEside >= 3.0) dominantRegister = 'TEXTUAL_WITNESS';
  else if (combinedStructBits >= 3.0) dominantRegister = 'STRUCTURAL_RHETORICAL';
  else if (physicalBitsCapped > convergedTextual && physicalBitsCapped > 0) dominantRegister = 'PHYSICAL_ANALOGICAL';

  const pNullApprox = Math.min(1, Math.pow(2, -ePerpBits));

  return {
    ePerpBits: Math.round(ePerpBits * 1000) / 1000,
    rawTextualBits: Math.round(rawTextualBits * 1000) / 1000,
    physicalBitsCapped: Math.round(physicalBitsCapped * 1000) / 1000,
    nEff: Math.round(nEff * 1000) / 1000,
    axisFactor: Math.round(axisFactor * 1000) / 1000,
    singleAxisFloor: Math.round(singleAxisFloor * 1000) / 1000,
    maxAxisRarityBits: Math.round(maxAxisRarityBits * 100) / 100,
    lengthPenaltyBits: Math.round(lengthPenaltyBits * 1000) / 1000,
    independentAxes: [...textualAxes, ...physicalAxes].sort((a, b) => b.bits - a.bits),
    dominantRegister,
    pNullApprox,
  };
}

/**
 * Information-Bottleneck Bridge Pivot Score (§3.3C):
 * Ranks intermediate verses v* linking anchors A_1..A_m by geometric cross-anchor PPR mass
 * * ln(1 + N_eff(v*)) * RarityGain(v*).
 */
export function rankBridgePivots(candidates: PivotCandidateInput[], limit = 10): PivotRankedResult[] {
  const scored: PivotRankedResult[] = [];
  for (const c of candidates) {
    const m = c.anchorMasses.length;
    if (m === 0) continue;
    let prod = 1;
    let valid = true;
    for (let i = 0; i < m; i++) {
      const p = c.anchorMasses[i];
      if (p <= 0) {
        valid = false;
        break;
      }
      prod *= p;
    }
    if (!valid) continue;
    const geom = Math.pow(prod, 1 / m);
    const axisCount = new Set(c.bridgedAxes).size;
    const pivotScore = geom * Math.log(1 + Math.max(1, axisCount)) * Math.max(0.5, c.rarityGain);
    scored.push({
      vid: c.vid,
      ref: c.ref,
      pivotScore,
      geometricMeanMass: geom,
      axisCount,
      bridgedAxes: [...new Set(c.bridgedAxes)],
    });
  }
  return scored.sort((a, b) => b.pivotScore - a.pivotScore).slice(0, limit);
}

/**
 * Submodular Marginal-Information Set Cover Diversifier:
 * Greedily selects non-redundant clues maximizing marginal gain over uncovered axes & passages.
 */
export function selectDiversifiedClues<T extends DiversifiableClue>(
  clues: T[],
  limit = 10,
  redundancyDecay = 0.45,
): T[] {
  if (clues.length <= limit) return [...clues].sort((a, b) => b.score - a.score);
  const remaining = [...clues];
  const selected: T[] = [];
  const coveredAxes = new Map<string, number>();
  const coveredPassages = new Map<number, number>();

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestGain = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      let axisNovelty = 0;
      for (const ax of c.axes) {
        const seen = coveredAxes.get(ax) ?? 0;
        axisNovelty += Math.pow(redundancyDecay, seen);
      }
      const axFactor = c.axes.length > 0 ? axisNovelty / c.axes.length : 1;

      let passageNovelty = 0;
      for (const vid of c.passages) {
        const seen = coveredPassages.get(vid) ?? 0;
        passageNovelty += Math.pow(0.5, seen);
      }
      const pFactor = c.passages.length > 0 ? passageNovelty / c.passages.length : 1;

      const gain = c.score * (0.35 + 0.40 * axFactor + 0.25 * pFactor);
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push(chosen);
    for (const ax of chosen.axes) coveredAxes.set(ax, (coveredAxes.get(ax) ?? 0) + 1);
    for (const vid of chosen.passages) coveredPassages.set(vid, (coveredPassages.get(vid) ?? 0) + 1);
  }

  return selected;
}
