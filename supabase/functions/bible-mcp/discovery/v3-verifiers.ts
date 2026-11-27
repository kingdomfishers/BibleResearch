// @file: src/relationships/v3-verifiers.ts
// BibleResearch v3 Top-24 Shortlist Exact Verifiers:
// 1. Online 3-Way MT <-> LXX <-> NT Halo Smith-Waterman & Composite Splice Detector (alignTriTextualQuote)
// 2. Piecewise Polarity Sequence Aligner with 1:1, 1:2, 2:1 Clause Bundling (alignClauseSequencesPiecewise)
// Pure TypeScript; zero Node-only imports; zero hardcoded passage pairs.

export type WitnessClass =
  | 'agrees_both'
  | 'agrees_lxx_against_mt'
  | 'agrees_mt_against_lxx'
  | 'composite_splice'
  | 'nt_adaptation';

export interface NtToken {
  idx: number;
  surface: string;
  lemma: string;
  strongs?: string;
  isFunction?: boolean;
}

export interface OtAlignedSlot {
  lxxIdx: number;
  lxxSurface: string;
  lxxLemma: string;
  lxxIdf: number;
  isFunction?: boolean;
  mtIdx: number | null;
  mtSurface?: string;
  mtStrongs?: string;
  mtEquivLemmas?: string[];
  divergenceKind?: 'pronoun_person_shift' | 'lexical_theological_shift' | 'lxx_plus_expansion' | null;
  divergenceNote?: string;
}

export interface OtLxxCandidateGroup {
  ref: string;
  vid: number;
  slots: OtAlignedSlot[];
  priorScore?: number;
}

export interface TriAlignedToken {
  nt_idx: number;
  nt_surface: string;
  nt_lemma: string;
  lxx_idx: number | null;
  mt_idx: number | null;
  source_ref: string | null;
  witness: WitnessClass;
  divergence_ref?: string;
}

export interface TriTextualSplice {
  sourceRef: string;
  ntStartIdx: number;
  ntEndIdx: number;
  score: number;
  contentMatches: number;
}

export interface TriTextualResult {
  sources: string[];
  splices: TriTextualSplice[];
  tokens: TriAlignedToken[];
  evidenceBits: number;
  summary: {
    agrees_both: number;
    agrees_lxx_against_mt: number;
    agrees_mt_against_lxx: number;
    composite_splice: number;
    nt_adaptation: number;
  };
}

const NORM_GREEK_CACHE = new Map<string, string>();
function normGreekLemma(raw: string): string {
  const key = raw || '';
  const cached = NORM_GREEK_CACHE.get(key);
  if (cached !== undefined) return cached;
  const normalized = key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .trim();
  if (NORM_GREEK_CACHE.size >= 4096) NORM_GREEK_CACHE.clear();
  NORM_GREEK_CACHE.set(key, normalized);
  return normalized;
}

function greekStemPrefix(raw: string): string {
  const n = normGreekLemma(raw);
  if (n.length <= 4) return n;
  return n.replace(/(εσθαι|σθαι|ησεται|θηναι|ομαι|εω|αω|οω|ω|ον|ος|ης|ας|ων|ις|μα|σις)$/, '');
}

interface SwPeak {
  cand: OtLxxCandidateGroup;
  ntStart: number;
  ntEnd: number;
  lxxStart: number;
  lxxEnd: number;
  score: number;
  contentMatches: number;
  idfSum: number;
  pairs: Array<{ ntIdx: number; lxxIdx: number; matchKind: 'exact_lxx' | 'stem_lxx' | 'mt_equiv' | 'func' }>;
}

interface PreparedNtToken {
  norm: string;
  stem: string;
  isFunction: boolean;
}

interface PreparedSlot {
  norm: string;
  stem: string;
  equivNorms: string[];
  idf: number;
  isFunction: boolean;
}

function scorePreparedPair(
  nt: PreparedNtToken,
  slot: PreparedSlot,
): { score: number; isContentMatch: boolean; idfContribution: number; kind: 'exact_lxx' | 'stem_lxx' | 'mt_equiv' | 'func' | 'mismatch' } {
  const ntNorm = nt.norm;
  const lxxNorm = slot.norm;
  const idf = slot.idf;

  if (ntNorm && lxxNorm && ntNorm === lxxNorm) {
    if (ntNorm === 'ειμι') {
      return { score: 0.50, isContentMatch: false, idfContribution: 0, kind: 'func' };
    }
    if (nt.isFunction || slot.isFunction) {
      const rareFuncScore = idf >= 5.5 ? Math.min(2.6, Math.round(0.35 * idf * 100) / 100) : 0.60;
      return { score: rareFuncScore, isContentMatch: false, idfContribution: 0, kind: 'func' };
    }
    return { score: idf, isContentMatch: true, idfContribution: idf, kind: 'exact_lxx' };
  }

  if (!nt.isFunction && !slot.isFunction && ntNorm !== 'ειμι' && lxxNorm !== 'ειμι') {
    const mtEquivs = slot.equivNorms;
    for (let i = 0; i < mtEquivs.length; i++) {
      if (mtEquivs[i] === ntNorm) {
        return { score: 0.90 * idf, isContentMatch: true, idfContribution: 0.90 * idf, kind: 'mt_equiv' };
      }
    }
    const s1 = nt.stem;
    const s2 = slot.stem;
    if (s1.length >= 4 && s2.length >= 4 && (s1 === s2 || s1.startsWith(s2) || s2.startsWith(s1))) {
      return { score: 0.85 * idf, isContentMatch: true, idfContribution: 0.85 * idf, kind: 'stem_lxx' };
    }
  }

  return { score: -0.95, isContentMatch: false, idfContribution: 0, kind: 'mismatch' };
}

function extractNonOverlappingSmithWatermanPeaks(
  ntTokens: NtToken[],
  cand: OtLxxCandidateGroup,
  opts: { minScore: number; minContentMatches: number; minIdfSum: number },
  prepNt?: PreparedNtToken[],
): SwPeak[] {
  const n = ntTokens.length;
  const m = cand.slots.length;
  if (n === 0 || m === 0) return [];

  const pNt: PreparedNtToken[] = prepNt || ntTokens.map((t) => ({
    norm: normGreekLemma(t.lemma),
    stem: greekStemPrefix(t.lemma),
    isFunction: Boolean(t.isFunction),
  }));
  const pSlots: PreparedSlot[] = cand.slots.map((s) => ({
    norm: normGreekLemma(s.lxxLemma),
    stem: greekStemPrefix(s.lxxLemma),
    equivNorms: (s.mtEquivLemmas || []).map(normGreekLemma),
    idf: Math.max(0.8, s.lxxIdf || 1.5),
    isFunction: Boolean(s.isFunction),
  }));

  const gapOpen = -1.10;
  const gapExtend = -0.55;
  const w = m + 1;
  const H = new Float64Array((n + 1) * w);
  const dir = new Uint8Array((n + 1) * w); // 0=stop, 1=diag, 2=up(gap in cand), 3=left(gap in nt)

  const candidates: Array<{ i: number; j: number; score: number }> = [];
  for (let i = 1; i <= n; i++) {
    const ntP = pNt[i - 1];
    for (let j = 1; j <= m; j++) {
      const k = i * w + j;
      const sub = scorePreparedPair(ntP, pSlots[j - 1]).score;
      const diag = H[k - w - 1] + sub;
      const up = H[k - w] + (dir[k - w] === 2 ? gapExtend : gapOpen);
      const left = H[k - 1] + (dir[k - 1] === 3 ? gapExtend : gapOpen);
      let best = 0;
      let d = 0;
      if (diag > best) { best = diag; d = 1; }
      if (up > best) { best = up; d = 2; }
      if (left > best) { best = left; d = 3; }
      H[k] = best;
      dir[k] = d;
      if (best >= opts.minScore) {
        candidates.push({ i, j, score: best });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const usedNt = new Uint8Array(n);
  const peaks: SwPeak[] = [];

  for (const c of candidates) {
    let i = c.i;
    let j = c.j;
    const pairs: SwPeak['pairs'] = [];
    let conflict = false;
    let contentMatches = 0;
    let idfSum = 0;
    let ntMin = n;
    let ntMax = -1;
    let lxxMin = m;
    let lxxMax = -1;

    while (i > 0 && j > 0 && dir[i * w + j] !== 0) {
      const d = dir[i * w + j];
      if (d === 1) {
        if (usedNt[i - 1]) { conflict = true; break; }
        const evalRes = scorePreparedPair(pNt[i - 1], pSlots[j - 1]);
        if (evalRes.kind !== 'mismatch') {
          pairs.push({ ntIdx: i - 1, lxxIdx: j - 1, matchKind: evalRes.kind });
          if (evalRes.isContentMatch) {
            contentMatches++;
            idfSum += evalRes.idfContribution;
          }
        }
        ntMin = Math.min(ntMin, i - 1);
        ntMax = Math.max(ntMax, i - 1);
        lxxMin = Math.min(lxxMin, j - 1);
        lxxMax = Math.max(lxxMax, j - 1);
        i--;
        j--;
      } else if (d === 2) {
        if (usedNt[i - 1]) { conflict = true; break; }
        i--;
      } else {
        j--;
      }
    }

    if (conflict || pairs.length === 0) continue;
    if (contentMatches < opts.minContentMatches || idfSum < opts.minIdfSum) continue;

    for (let x = ntMin; x <= ntMax; x++) usedNt[x] = 1;
    peaks.push({
      cand,
      ntStart: ntMin,
      ntEnd: ntMax,
      lxxStart: lxxMin,
      lxxEnd: lxxMax,
      score: Math.round(c.score * 100) / 100,
      contentMatches,
      idfSum: Math.round(idfSum * 100) / 100,
      pairs: pairs.reverse(),
    });
  }

  return peaks;
}

function expandAdaptationHalo(ntTokens: NtToken[], peak: SwPeak, haloRadius = 3): SwPeak {
  const newNtStart = Math.max(0, peak.ntStart - haloRadius);
  const newNtEnd = Math.min(ntTokens.length - 1, peak.ntEnd + haloRadius);
  return {
    ...peak,
    ntStart: newNtStart,
    ntEnd: newNtEnd,
  };
}

/**
 * Online 3-Way MT <-> LXX <-> NT Halo Smith-Waterman & Composite Splice Detector.
 * Runs over Top <= 16 OT candidates in < 0.8 ms.
 */
export function alignTriTextualQuote(
  ntTokens: NtToken[],
  candidates: OtLxxCandidateGroup[],
): TriTextualResult | null {
  const prepNt: PreparedNtToken[] = ntTokens.map((t) => ({
    norm: normGreekLemma(t.lemma),
    stem: greekStemPrefix(t.lemma),
    isFunction: Boolean(t.isFunction),
  }));
  const allPeaks: SwPeak[] = [];
  for (const cand of candidates.slice(0, 20)) {
    const peaks = extractNonOverlappingSmithWatermanPeaks(ntTokens, cand, {
      minScore: 5.5,
      minContentMatches: 2,
      minIdfSum: 4.0,
    }, prepNt);
    for (const peak of peaks) {
      allPeaks.push(expandAdaptationHalo(ntTokens, peak, 3));
    }
  }
  if (allPeaks.length === 0) return null;

  // Greedily resolve multi-source composite splices (highest score + verified prior non-overlapping NT core spans)
  allPeaks.sort((a, b) => {
    const sa = a.score + Math.min(3.5, a.cand.priorScore || 0);
    const sb = b.score + Math.min(3.5, b.cand.priorScore || 0);
    return sb - sa || b.contentMatches - a.contentMatches;
  });
  const selected: SwPeak[] = [];
  const coveredNt = new Uint8Array(ntTokens.length);

  for (const p of allPeaks) {
    const coreStart = p.pairs[0]?.ntIdx ?? p.ntStart;
    const coreEnd = p.pairs[p.pairs.length - 1]?.ntIdx ?? p.ntEnd;
    let overlap = 0;
    const coreLen = Math.max(1, coreEnd - coreStart + 1);
    for (let i = coreStart; i <= coreEnd; i++) {
      if (coveredNt[i]) overlap++;
    }
    if (overlap / coreLen > 0.35) continue;
    for (let i = coreStart; i <= coreEnd; i++) coveredNt[i] = 1;
    selected.push(p);
  }

  if (selected.length === 0) return null;
  selected.sort((a, b) => a.ntStart - b.ntStart);

  // Assign each NT token to its best peak & classify witness attribution
  const tokens: TriAlignedToken[] = [];
  const summary = {
    agrees_both: 0,
    agrees_lxx_against_mt: 0,
    agrees_mt_against_lxx: 0,
    composite_splice: 0,
    nt_adaptation: 0,
  };

  for (let i = 0; i < ntTokens.length; i++) {
    const nt = ntTokens[i];
    // Find owning peak (prefer exact pair match first, else enclosing halo)
    let owner: SwPeak | null = null;
    let matchedPair: SwPeak['pairs'][number] | null = null;
    for (const p of selected) {
      const hit = p.pairs.find((pr) => pr.ntIdx === i);
      if (hit) {
        owner = p;
        matchedPair = hit;
        break;
      }
    }
    if (!owner) {
      owner = selected.find((p) => i >= p.ntStart && i <= p.ntEnd) ?? null;
    }

    if (!owner) {
      tokens.push({
        nt_idx: nt.idx,
        nt_surface: nt.surface,
        nt_lemma: nt.lemma,
        lxx_idx: null,
        mt_idx: null,
        source_ref: null,
        witness: 'nt_adaptation',
      });
      continue;
    }

    let witness: WitnessClass = 'nt_adaptation';
    let lxxIdx: number | null = null;
    let mtIdx: number | null = null;
    let divRef: string | undefined;

    if (matchedPair) {
      const slot = owner.cand.slots[matchedPair.lxxIdx];
      lxxIdx = slot.lxxIdx;
      mtIdx = slot.mtIdx;
      if (matchedPair.matchKind === 'mt_equiv') {
        witness = 'agrees_mt_against_lxx';
        divRef = `${owner.cand.ref}#MT_vs_LXX`;
      } else if (slot.divergenceKind) {
        witness = 'agrees_lxx_against_mt';
        divRef = `${owner.cand.ref}#${slot.divergenceKind}`;
      } else {
        witness = 'agrees_both';
      }
    } else {
      // Check splice boundary crossing within <= 25 NT tokens
      const idxInSelected = selected.indexOf(owner);
      const prevPeak = idxInSelected > 0 ? selected[idxInSelected - 1] : null;
      if (prevPeak && prevPeak.cand.ref !== owner.cand.ref && (owner.ntStart - prevPeak.ntEnd) <= 25 && i <= owner.ntStart + 2) {
        witness = 'composite_splice';
        divRef = `${prevPeak.cand.ref} -> ${owner.cand.ref}`;
      } else {
        witness = 'nt_adaptation';
      }
    }

    summary[witness]++;
    tokens.push({
      nt_idx: nt.idx,
      nt_surface: nt.surface,
      nt_lemma: nt.lemma,
      lxx_idx: lxxIdx,
      mt_idx: mtIdx,
      source_ref: owner.cand.ref,
      witness,
      ...(divRef ? { divergence_ref: divRef } : {}),
    });
  }

  const splices: TriTextualSplice[] = selected.map((p) => ({
    sourceRef: p.cand.ref,
    ntStartIdx: p.ntStart,
    ntEndIdx: p.ntEnd,
    score: p.score,
    contentMatches: p.contentMatches,
  }));

  // Mark splice boundaries when multiple distinct OT refs lie within 25 tokens
  for (let s = 1; s < splices.length; s++) {
    if (splices[s].sourceRef !== splices[s - 1].sourceRef && splices[s].ntStartIdx - splices[s - 1].ntEndIdx <= 25) {
      summary.composite_splice++;
    }
  }

  const totalScore = selected.reduce((acc, s) => acc + s.score, 0);
  const evidenceBits = Math.min(16.0, Math.round(totalScore * 0.65 * 100) / 100);

  return {
    sources: [...new Set(selected.map((s) => s.cand.ref))],
    splices,
    tokens,
    evidenceBits,
    summary,
  };
}

// === 2. Piecewise Polarity Sequence Aligner (SW^piece_pol) ===

export type ClausePolarity = 'POS' | 'NEG';

export interface ClauseSig {
  id: string;
  vid: number;
  ref?: string;
  summary?: string;
  concepts: string[]; // Cross-lingual ConceptIDs C_XL
  roles: Array<{ role: string; concept: string }>; // e.g. 'Agent:C_XL_01'
  strongs?: string[];
  lxxBridges?: string[];
  polarity: ClausePolarity;
  antonyms?: string[]; // optional antonym ConceptIDs for inversion matching
}

export interface AlignedClausePair {
  aIndices: number[];
  bIndices: number[];
  refA?: string;
  refB?: string;
  summaryA?: string;
  summaryB?: string;
  sharedConcepts?: string[];
  mode: 'CONCORDANT' | 'INVERSION';
  similarity: number;
  polarityA: ClausePolarity;
  polarityB: ClausePolarity;
}

export interface SequenceBlock {
  orientation: 'forward' | 'reversed';
  mode: 'CONCORDANT' | 'INVERSION';
  score: number;
  pairs: AlignedClausePair[];
}

export interface SequenceAlignment {
  raw_score: number;
  p_null: number;
  evidence_bits: number;
  arc_kind: 'parallel_scene' | 'mirror_inversion' | 'antithetical_decreation' | 'piecewise_mixed';
  blocks: SequenceBlock[];
}

interface EncodedClause {
  cIds: Int32Array;
  rIds: Int32Array;
  sIds: Int32Array;
  lIds: Int32Array;
  antIds: Int32Array;
  pol: 0 | 1; // 0 = POS, 1 = NEG
}

interface SequenceMatrices {
  n: number;
  m: number;
  polA: Uint8Array;
  polB: Uint8Array;
  sim11: Float64Array;
  conc11: Float64Array;
  inv11: Float64Array;
  sim21: Float64Array;
  conc21: Float64Array;
  inv21: Float64Array;
  get12Base: (b1: number, b2: number) => number;
  sim12: Float64Array;
  conc12: Float64Array;
  inv12: Float64Array;
}

function dedupToInt32(arr: number[]): Int32Array {
  if (arr.length === 0) return new Int32Array(0);
  if (arr.length === 1) return new Int32Array(arr);
  arr.sort((a, b) => a - b);
  let uniq = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] !== arr[uniq - 1]) arr[uniq++] = arr[i];
  }
  const out = new Int32Array(uniq);
  for (let i = 0; i < uniq; i++) out[i] = arr[i];
  return out;
}

function buildSequenceMatrices(clausesA: ClauseSig[], clausesB: ClauseSig[]): SequenceMatrices {
  const n = clausesA.length;
  const m = clausesB.length;
  const conceptMap = new Map<string, number>();
  const roleMap = new Map<string, number>();
  const strongsMap = new Map<string, number>();
  const lxxMap = new Map<string, number>();

  const getId = (map: Map<string, number>, key: string): number => {
    let id = map.get(key);
    if (id === undefined) {
      id = map.size;
      map.set(key, id);
    }
    return id;
  };

  for (let i = 0; i < n; i++) {
    const cl = clausesA[i];
    for (let k = 0; k < cl.concepts.length; k++) getId(conceptMap, cl.concepts[k]);
    for (let k = 0; k < cl.roles.length; k++) getId(roleMap, `${cl.roles[k].role}\0${cl.roles[k].concept}`);
    if (cl.strongs) for (let k = 0; k < cl.strongs.length; k++) getId(strongsMap, cl.strongs[k]);
    if (cl.lxxBridges) for (let k = 0; k < cl.lxxBridges.length; k++) getId(lxxMap, cl.lxxBridges[k]);
  }
  for (let j = 0; j < m; j++) {
    const cl = clausesB[j];
    for (let k = 0; k < cl.concepts.length; k++) getId(conceptMap, cl.concepts[k]);
    for (let k = 0; k < cl.roles.length; k++) getId(roleMap, `${cl.roles[k].role}\0${cl.roles[k].concept}`);
    if (cl.strongs) for (let k = 0; k < cl.strongs.length; k++) getId(strongsMap, cl.strongs[k]);
    if (cl.lxxBridges) for (let k = 0; k < cl.lxxBridges.length; k++) getId(lxxMap, cl.lxxBridges[k]);
  }

  const offR = conceptMap.size;
  const offS = offR + roleMap.size;
  const offL = offS + strongsMap.size;
  const totalTokens = offL + lxxMap.size;

  const encodeClause = (cl: ClauseSig): EncodedClause => {
    const cArr: number[] = [];
    for (let k = 0; k < cl.concepts.length; k++) cArr.push(conceptMap.get(cl.concepts[k])!);
    const rArr: number[] = [];
    for (let k = 0; k < cl.roles.length; k++) rArr.push(offR + roleMap.get(`${cl.roles[k].role}\0${cl.roles[k].concept}`)!);
    const sArr: number[] = [];
    if (cl.strongs) for (let k = 0; k < cl.strongs.length; k++) sArr.push(offS + strongsMap.get(cl.strongs[k])!);
    const lArr: number[] = [];
    if (cl.lxxBridges) for (let k = 0; k < cl.lxxBridges.length; k++) lArr.push(offL + lxxMap.get(cl.lxxBridges[k])!);
    const antArr: number[] = [];
    if (cl.antonyms) {
      for (let k = 0; k < cl.antonyms.length; k++) {
        const cid = conceptMap.get(cl.antonyms[k]);
        if (cid !== undefined) antArr.push(cid);
      }
    }
    return {
      cIds: dedupToInt32(cArr),
      rIds: dedupToInt32(rArr),
      sIds: dedupToInt32(sArr),
      lIds: dedupToInt32(lArr),
      antIds: dedupToInt32(antArr),
      pol: cl.polarity === 'NEG' ? 1 : 0,
    };
  };

  const encA: EncodedClause[] = new Array(n);
  const polA = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    encA[i] = encodeClause(clausesA[i]);
    polA[i] = encA[i].pol;
  }
  const encB: EncodedClause[] = new Array(m);
  const polB = new Uint8Array(m);
  for (let j = 0; j < m; j++) {
    encB[j] = encodeClause(clausesB[j]);
    polB[j] = encB[j].pol;
  }

  const seen = new Uint32Array(Math.max(1, totalTokens));
  const seenAnt = new Uint32Array(Math.max(1, offR));
  let stamp = 0;
  let antStamp = 0;

  const computeSimFromMarked = (
    a: EncodedClause,
    bCLen: number,
    bRLen: number,
    bSLen: number,
    bLLen: number,
    st: number,
  ): number => {
    const aCLen = a.cIds.length;
    let cInter = 0;
    if (aCLen > 0 && bCLen > 0) {
      for (let k = 0; k < aCLen; k++) if (seen[a.cIds[k]] === st) cInter++;
    }
    const cMin = aCLen < bCLen ? aCLen : bCLen;
    const cDice = aCLen + bCLen > 0 ? (2 * cInter) / (aCLen + bCLen) : 0;
    const cOverlap = cMin > 0 ? cInter / cMin : 0;
    const conceptSim = 0.65 * cDice + 0.35 * cOverlap;

    const aRLen = a.rIds.length;
    let rInter = 0;
    if (aRLen > 0 && bRLen > 0) {
      for (let k = 0; k < aRLen; k++) if (seen[a.rIds[k]] === st) rInter++;
    }
    const rUnion = aRLen + bRLen - rInter;
    const roleSim = rUnion > 0 ? (2 * rInter) / (aRLen + bRLen) : 0;

    let bridgeBonus = 0;
    const aLLen = a.lIds.length;
    if (aLLen > 0 && bLLen > 0) {
      let lInter = 0;
      for (let k = 0; k < aLLen; k++) if (seen[a.lIds[k]] === st) lInter++;
      if (lInter > 0) {
        const lMin = aLLen < bLLen ? aLLen : bLLen;
        const bL = 0.25 * (lInter / lMin);
        if (bL > bridgeBonus) bridgeBonus = bL;
      }
    }
    const aSLen = a.sIds.length;
    if (aSLen > 0 && bSLen > 0) {
      let sInter = 0;
      for (let k = 0; k < aSLen; k++) if (seen[a.sIds[k]] === st) sInter++;
      if (sInter > 0) {
        const sMin = aSLen < bSLen ? aSLen : bSLen;
        const bS = 0.20 * (sInter / sMin);
        if (bS > bridgeBonus) bridgeBonus = bS;
      }
    }

    const base = rUnion > 0 ? 0.68 * conceptSim + 0.32 * roleSim : conceptSim;
    const out = base + bridgeBonus;
    return out > 1.0 ? 1.0 : out;
  };

  const scoreConc = (sim: number, pA: number, pB: number): number => {
    if (sim < 0.14) return -0.65;
    return pA === pB ? 1.85 * sim : -0.60;
  };
  const scoreInv = (baseSim: number, pA: number, pB: number, hasAnt: boolean): number => {
    const antBonus = hasAnt ? 0.45 : 0;
    const sim = baseSim + antBonus > 1.0 ? 1.0 : baseSim + antBonus;
    if (sim < 0.14) return -0.65;
    return pA !== pB || hasAnt ? 1.9 * sim : 0.4 * sim;
  };

  // Precompute 1:1 matrices (n * m)
  const sim11 = new Float64Array(n * m);
  const conc11 = new Float64Array(n * m);
  const inv11 = new Float64Array(n * m);
  const hasAnt11 = new Uint8Array(n * m);

  for (let j = 0; j < m; j++) {
    const b = encB[j];
    stamp++;
    for (let k = 0; k < b.cIds.length; k++) seen[b.cIds[k]] = stamp;
    for (let k = 0; k < b.rIds.length; k++) seen[b.rIds[k]] = stamp;
    for (let k = 0; k < b.sIds.length; k++) seen[b.sIds[k]] = stamp;
    for (let k = 0; k < b.lIds.length; k++) seen[b.lIds[k]] = stamp;
    antStamp++;
    for (let k = 0; k < b.antIds.length; k++) seenAnt[b.antIds[k]] = antStamp;

    for (let i = 0; i < n; i++) {
      const a = encA[i];
      const idx = i * m + j;
      const sim = computeSimFromMarked(a, b.cIds.length, b.rIds.length, b.sIds.length, b.lIds.length, stamp);
      let hasAnt = false;
      for (let k = 0; k < a.antIds.length; k++) {
        if (seen[a.antIds[k]] === stamp) { hasAnt = true; break; }
      }
      if (!hasAnt && b.antIds.length > 0) {
        for (let k = 0; k < a.cIds.length; k++) {
          if (seenAnt[a.cIds[k]] === antStamp) { hasAnt = true; break; }
        }
      }
      hasAnt11[idx] = hasAnt ? 1 : 0;
      sim11[idx] = sim;
      conc11[idx] = scoreConc(sim, a.pol, b.pol);
      inv11[idx] = scoreInv(sim, a.pol, b.pol, hasAnt);
    }
  }

  // Precompute 2:1 matrices ((n - 1) * m) - A is never permuted
  const n21 = Math.max(0, n - 1);
  const sim21 = new Float64Array(n21 * m);
  const conc21 = new Float64Array(n21 * m);
  const inv21 = new Float64Array(n21 * m);
  const encA21: EncodedClause[] = new Array(n21);

  for (let i = 0; i < n21; i++) {
    const a1 = encA[i];
    const a2 = encA[i + 1];
    encA21[i] = {
      cIds: dedupToInt32([...a1.cIds, ...a2.cIds]),
      rIds: dedupToInt32([...a1.rIds, ...a2.rIds]),
      sIds: dedupToInt32([...a1.sIds, ...a2.sIds]),
      lIds: dedupToInt32([...a1.lIds, ...a2.lIds]),
      antIds: dedupToInt32([...a1.antIds, ...a2.antIds]),
      pol: (a1.pol | a2.pol) as 0 | 1,
    };
  }
  for (let j = 0; j < m; j++) {
    const b = encB[j];
    stamp++;
    for (let k = 0; k < b.cIds.length; k++) seen[b.cIds[k]] = stamp;
    for (let k = 0; k < b.rIds.length; k++) seen[b.rIds[k]] = stamp;
    for (let k = 0; k < b.sIds.length; k++) seen[b.sIds[k]] = stamp;
    for (let k = 0; k < b.lIds.length; k++) seen[b.lIds[k]] = stamp;
    antStamp++;
    for (let k = 0; k < b.antIds.length; k++) seenAnt[b.antIds[k]] = antStamp;

    for (let i = 0; i < n21; i++) {
      const a = encA21[i];
      const idx = i * m + j;
      const sim = computeSimFromMarked(a, b.cIds.length, b.rIds.length, b.sIds.length, b.lIds.length, stamp);
      let hasAnt = false;
      for (let k = 0; k < a.antIds.length; k++) {
        if (seen[a.antIds[k]] === stamp) { hasAnt = true; break; }
      }
      if (!hasAnt && b.antIds.length > 0) {
        for (let k = 0; k < a.cIds.length; k++) {
          if (seenAnt[a.cIds[k]] === antStamp) { hasAnt = true; break; }
        }
      }
      sim21[idx] = sim;
      conc21[idx] = scoreConc(sim, a.pol, b.pol);
      inv21[idx] = scoreInv(sim, a.pol, b.pol, hasAnt);
    }
  }

  // Lazy cached 1:2 matrices over unordered pairs {lo, hi} of clausesB
  const numPairs12 = (m * (m - 1)) >> 1;
  const pairReady = new Uint8Array(numPairs12);
  const sim12 = new Float64Array(numPairs12 * n);
  const conc12 = new Float64Array(numPairs12 * n);
  const inv12 = new Float64Array(numPairs12 * n);

  const get12Base = (b1Idx: number, b2Idx: number): number => {
    const lo = b1Idx < b2Idx ? b1Idx : b2Idx;
    const hi = b1Idx < b2Idx ? b2Idx : b1Idx;
    const triIdx = ((lo * (2 * m - lo - 1)) >> 1) + (hi - lo - 1);
    const base = triIdx * n;
    if (pairReady[triIdx] === 0) {
      pairReady[triIdx] = 1;
      const b1 = encB[lo];
      const b2 = encB[hi];
      if (++stamp >= 0x7fffffff) {
        seen.fill(0);
        stamp = 1;
      }
      let uC = 0;
      for (let k = 0; k < b1.cIds.length; k++) { seen[b1.cIds[k]] = stamp; uC++; }
      for (let k = 0; k < b2.cIds.length; k++) { const id = b2.cIds[k]; if (seen[id] !== stamp) { seen[id] = stamp; uC++; } }
      let uR = 0;
      for (let k = 0; k < b1.rIds.length; k++) { seen[b1.rIds[k]] = stamp; uR++; }
      for (let k = 0; k < b2.rIds.length; k++) { const id = b2.rIds[k]; if (seen[id] !== stamp) { seen[id] = stamp; uR++; } }
      let uS = 0;
      for (let k = 0; k < b1.sIds.length; k++) { seen[b1.sIds[k]] = stamp; uS++; }
      for (let k = 0; k < b2.sIds.length; k++) { const id = b2.sIds[k]; if (seen[id] !== stamp) { seen[id] = stamp; uS++; } }
      let uL = 0;
      for (let k = 0; k < b1.lIds.length; k++) { seen[b1.lIds[k]] = stamp; uL++; }
      for (let k = 0; k < b2.lIds.length; k++) { const id = b2.lIds[k]; if (seen[id] !== stamp) { seen[id] = stamp; uL++; } }

      const bPol = b1.pol | b2.pol;
      for (let i = 0; i < n; i++) {
        const a = encA[i];
        const sim = computeSimFromMarked(a, uC, uR, uS, uL, stamp);
        const hasAnt = hasAnt11[i * m + lo] !== 0 || hasAnt11[i * m + hi] !== 0;
        sim12[base + i] = sim;
        conc12[base + i] = scoreConc(sim, a.pol, bPol);
        inv12[base + i] = scoreInv(sim, a.pol, bPol, hasAnt);
      }
    }
    return base;
  };

  return { n, m, polA, polB, sim11, conc11, inv11, sim21, conc21, inv21, get12Base, sim12, conc12, inv12 };
}

function runBundledGotohDP(
  mat: SequenceMatrices,
  permB: Int32Array,
  orientation: 'forward' | 'reversed',
  mode: 'CONCORDANT' | 'INVERSION',
): SequenceBlock[] {
  const n = mat.n;
  const m = mat.m;
  if (n === 0 || m === 0) return [];

  const isInv = mode === 'INVERSION';
  const isRev = orientation === 'reversed';
  const mat11 = isInv ? mat.inv11 : mat.conc11;
  const mat21 = isInv ? mat.inv21 : mat.conc21;
  const mat12 = isInv ? mat.inv12 : mat.conc12;

  const bOrig = new Int32Array(m);
  for (let j = 0; j < m; j++) {
    bOrig[j] = isRev ? permB[m - 1 - j] : permB[j];
  }

  const w = m + 1;
  const H = new Float64Array((n + 1) * w);
  // op codes: 0=stop, 1=1:1, 2=1:2 (bundle b[j-2..j-1]), 3=2:1 (bundle a[i-2..i-1]), 4=skipA, 5=skipB
  const trace = new Uint8Array((n + 1) * w);
  const gapPen = -0.45;
  const bundlePen = 0.15;

  const base12Arr = new Int32Array(m + 1);
  for (let j = 2; j <= m; j++) {
    base12Arr[j] = mat.get12Base(bOrig[j - 2], bOrig[j - 1]);
  }

  const peaks: Array<{ i: number; j: number; score: number }> = [];

  for (let i = 1; i <= n; i++) {
    const i1 = i - 1;
    const i2 = i - 2;
    const row11 = i1 * m;
    const row21 = i2 * m;
    for (let j = 1; j <= m; j++) {
      const k = i * w + j;
      const bj1 = bOrig[j - 1];
      let best = 0;
      let op = 0;

      // 1:1
      const s11 = H[k - w - 1] + mat11[row11 + bj1];
      if (s11 > best) { best = s11; op = 1; }

      // 1:2 bundle (one clause in A covers two adjacent clauses in B)
      if (j >= 2) {
        const s12 = H[k - w - 2] + mat12[base12Arr[j] + i1] - bundlePen;
        if (s12 > best) { best = s12; op = 2; }
      }

      // 2:1 bundle (two adjacent clauses in A cover one clause in B)
      if (i >= 2) {
        const s21 = H[k - 2 * w - 1] + mat21[row21 + bj1] - bundlePen;
        if (s21 > best) { best = s21; op = 3; }
      }

      const skipA = H[k - w] + gapPen;
      if (skipA > best) { best = skipA; op = 4; }

      const skipB = H[k - 1] + gapPen;
      if (skipB > best) { best = skipB; op = 5; }

      H[k] = best;
      trace[k] = op;
      if (best >= 1.2 && op <= 3) peaks.push({ i, j, score: best });
    }
  }

  peaks.sort((a, b) => b.score - a.score);
  const usedA = new Uint8Array(n);
  const usedB = new Uint8Array(m);
  const blocks: SequenceBlock[] = [];

  const mapB = (idxInB: number) => (orientation === 'forward' ? idxInB : m - 1 - idxInB);

  for (const pk of peaks) {
    let i = pk.i;
    let j = pk.j;
    const pairs: AlignedClausePair[] = [];
    let conflict = false;

    while (i > 0 && j > 0) {
      const op = trace[i * w + j];
      if (op === 0) break;
      if (op === 1) {
        if (usedA[i - 1] || usedB[j - 1]) { conflict = true; break; }
        const bIdx = bOrig[j - 1];
        pairs.push({
          aIndices: [i - 1],
          bIndices: [mapB(j - 1)],
          mode,
          similarity: mat.sim11[(i - 1) * m + bIdx],
          polarityA: mat.polA[i - 1] ? 'NEG' : 'POS',
          polarityB: mat.polB[bIdx] ? 'NEG' : 'POS',
        });
        i--; j--;
      } else if (op === 2) {
        if (usedA[i - 1] || usedB[j - 1] || usedB[j - 2]) { conflict = true; break; }
        const b1 = bOrig[j - 2];
        const b2 = bOrig[j - 1];
        const base12 = mat.get12Base(b1, b2);
        pairs.push({
          aIndices: [i - 1],
          bIndices: [mapB(j - 2), mapB(j - 1)].sort((x, y) => x - y),
          mode,
          similarity: mat.sim12[base12 + (i - 1)],
          polarityA: mat.polA[i - 1] ? 'NEG' : 'POS',
          polarityB: (mat.polB[b1] | mat.polB[b2]) ? 'NEG' : 'POS',
        });
        i--; j -= 2;
      } else if (op === 3) {
        if (usedA[i - 1] || usedA[i - 2] || usedB[j - 1]) { conflict = true; break; }
        const bIdx = bOrig[j - 1];
        pairs.push({
          aIndices: [i - 2, i - 1],
          bIndices: [mapB(j - 1)],
          mode,
          similarity: mat.sim21[(i - 2) * m + bIdx],
          polarityA: (mat.polA[i - 2] | mat.polA[i - 1]) ? 'NEG' : 'POS',
          polarityB: mat.polB[bIdx] ? 'NEG' : 'POS',
        });
        i -= 2; j--;
      } else if (op === 4) {
        if (usedA[i - 1]) { conflict = true; break; }
        i--;
      } else {
        if (usedB[j - 1]) { conflict = true; break; }
        j--;
      }
    }

    if (conflict || pairs.length < 2) continue;
    for (const pr of pairs) {
      for (const ai of pr.aIndices) usedA[ai] = 1;
      for (const bi of pr.bIndices) {
        const bLocal = orientation === 'forward' ? bi : m - 1 - bi;
        usedB[bLocal] = 1;
      }
    }
    blocks.push({
      orientation,
      mode,
      score: Math.round(pk.score * 100) / 100,
      pairs: pairs.reverse(),
    });
  }

  return blocks;
}

function assemblePiecewiseBlocks(
  allBlocks: SequenceBlock[],
  switchPenalty = 1.8,
): SequenceBlock[] {
  const sorted = [...allBlocks].sort((a, b) => b.score - a.score);
  const chosen: SequenceBlock[] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();

  for (const blk of sorted) {
    let overlaps = false;
    for (const pr of blk.pairs) {
      if (pr.aIndices.some((x) => usedA.has(x)) || pr.bIndices.some((y) => usedB.has(y))) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    const prev = chosen[chosen.length - 1];
    const switchCost = prev && (prev.orientation !== blk.orientation || prev.mode !== blk.mode) ? switchPenalty : 0;
    if (blk.score - switchCost < 1.2) continue;
    chosen.push(switchCost > 0 ? { ...blk, score: Math.round((blk.score - switchCost) * 100) / 100 } : blk);
    for (const pr of blk.pairs) {
      pr.aIndices.forEach((x) => usedA.add(x));
      pr.bIndices.forEach((y) => usedB.add(y));
    }
  }
  return chosen.sort((a, b) => (a.pairs[0]?.aIndices[0] ?? 0) - (b.pairs[0]?.aIndices[0] ?? 0));
}

function deterministicMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PermBlock {
  orientMode: number;
  score: number;
  aMask: number;
  bMask: number;
  aIndices?: number[];
  bIndices?: number[];
}

function estimateSequenceNullPValue(
  mat: SequenceMatrices,
  observedScore: number,
  numPermutations = 64,
  switchPenalty = 1.8,
): number {
  const n = mat.n;
  const m = mat.m;
  if (observedScore <= 0 || n < 2 || m < 2) return 1.0;

  const rng = deterministicMulberry32(n * 997 + m * 313 + 42);
  let geCount = 0;

  const useMasks = n <= 30 && m <= 30;
  const w = m + 1;
  const H = new Float64Array((n + 1) * w);
  const trace = new Uint8Array((n + 1) * w);
  const usedA = new Uint8Array(n);
  const usedB = new Uint8Array(m);
  const peakI = new Int32Array(n * m);
  const peakJ = new Int32Array(n * m);
  const peakScore = new Float64Array(n * m);
  const peakOrder = new Int32Array(n * m);
  const perm = new Int32Array(m);
  const bOrig = new Int32Array(m);
  const gUsedA = new Uint8Array(n);
  const gUsedB = new Uint8Array(m);
  const tmpA = new Int32Array(n);
  const tmpB = new Int32Array(m);
  const base12Arr = new Int32Array(m + 1);

  const gapPen = -0.45;
  const bundlePen = 0.15;
  const matConc11 = mat.conc11;
  const matInv11 = mat.inv11;
  const matConc21 = mat.conc21;
  const matInv21 = mat.inv21;
  const matConc12 = mat.conc12;
  const matInv12 = mat.inv12;

  const extractBlocks = (
    isRev: boolean,
    isInv: boolean,
    orientMode: number,
    outBlocks: PermBlock[],
  ) => {
    const mat11 = isInv ? matInv11 : matConc11;
    const mat21 = isInv ? matInv21 : matConc21;
    const mat12 = isInv ? matInv12 : matConc12;
    for (let j = 0; j < m; j++) {
      bOrig[j] = isRev ? perm[m - 1 - j] : perm[j];
    }
    for (let j = 2; j <= m; j++) {
      base12Arr[j] = mat.get12Base(bOrig[j - 2], bOrig[j - 1]);
    }

    let peakCount = 0;

    for (let i = 1; i <= n; i++) {
      const i1 = i - 1;
      const i2 = i - 2;
      const row11 = i1 * m;
      const row21 = i2 * m;
      for (let j = 1; j <= m; j++) {
        const k = i * w + j;
        const bj1 = bOrig[j - 1];
        let best = 0;
        let op = 0;

        const s11 = H[k - w - 1] + mat11[row11 + bj1];
        if (s11 > best) { best = s11; op = 1; }

        if (j >= 2) {
          const s12 = H[k - w - 2] + mat12[base12Arr[j] + i1] - bundlePen;
          if (s12 > best) { best = s12; op = 2; }
        }

        if (i >= 2) {
          const s21 = H[k - 2 * w - 1] + mat21[row21 + bj1] - bundlePen;
          if (s21 > best) { best = s21; op = 3; }
        }

        const skipA = H[k - w] + gapPen;
        if (skipA > best) { best = skipA; op = 4; }

        const skipB = H[k - 1] + gapPen;
        if (skipB > best) { best = skipB; op = 5; }

        H[k] = best;
        trace[k] = op;
        if (best >= 1.2 && op <= 3) {
          peakI[peakCount] = i;
          peakJ[peakCount] = j;
          peakScore[peakCount] = best;
          peakOrder[peakCount] = peakCount;
          peakCount++;
        }
      }
    }

    if (peakCount === 0) return;
    // Insertion sort peakOrder[0..peakCount-1] descending by peakScore (stable)
    for (let p = 1; p < peakCount; p++) {
      const keyIdx = peakOrder[p];
      const keyScore = peakScore[keyIdx];
      let q = p - 1;
      while (q >= 0 && peakScore[peakOrder[q]] < keyScore) {
        peakOrder[q + 1] = peakOrder[q];
        q--;
      }
      peakOrder[q + 1] = keyIdx;
    }

    usedA.fill(0);
    usedB.fill(0);

    for (let pIdx = 0; pIdx < peakCount; pIdx++) {
      const pk = peakOrder[pIdx];
      let i = peakI[pk];
      let j = peakJ[pk];
      let lenA = 0;
      let lenB = 0;
      let pairCount = 0;
      let conflict = false;

      while (i > 0 && j > 0) {
        const op = trace[i * w + j];
        if (op === 0) break;
        if (op === 1) {
          if (usedA[i - 1] || usedB[j - 1]) { conflict = true; break; }
          tmpA[lenA++] = i - 1;
          tmpB[lenB++] = j - 1;
          pairCount++;
          i--; j--;
        } else if (op === 2) {
          if (usedA[i - 1] || usedB[j - 1] || usedB[j - 2]) { conflict = true; break; }
          tmpA[lenA++] = i - 1;
          tmpB[lenB++] = j - 2;
          tmpB[lenB++] = j - 1;
          pairCount++;
          i--; j -= 2;
        } else if (op === 3) {
          if (usedA[i - 1] || usedA[i - 2] || usedB[j - 1]) { conflict = true; break; }
          tmpA[lenA++] = i - 2;
          tmpA[lenA++] = i - 1;
          tmpB[lenB++] = j - 1;
          pairCount++;
          i -= 2; j--;
        } else if (op === 4) {
          if (usedA[i - 1]) { conflict = true; break; }
          i--;
        } else {
          if (usedB[j - 1]) { conflict = true; break; }
          j--;
        }
      }

      if (conflict || pairCount < 2) continue;
      if (useMasks) {
        let aMask = 0;
        let bMask = 0;
        for (let t = 0; t < lenA; t++) {
          const ai = tmpA[t];
          usedA[ai] = 1;
          aMask |= (1 << ai);
        }
        for (let t = 0; t < lenB; t++) {
          const bLocal = tmpB[t];
          usedB[bLocal] = 1;
          const bOrigIdx = isRev ? m - 1 - bLocal : bLocal;
          bMask |= (1 << bOrigIdx);
        }
        outBlocks.push({
          orientMode,
          score: Math.round(peakScore[pk] * 100) / 100,
          aMask,
          bMask,
        });
      } else {
        const aIndices: number[] = new Array(lenA);
        const bIndices: number[] = new Array(lenB);
        for (let t = 0; t < lenA; t++) {
          usedA[tmpA[t]] = 1;
          aIndices[t] = tmpA[t];
        }
        for (let t = 0; t < lenB; t++) {
          const bLocal = tmpB[t];
          usedB[bLocal] = 1;
          bIndices[t] = isRev ? m - 1 - bLocal : bLocal;
        }
        outBlocks.push({
          orientMode,
          score: Math.round(peakScore[pk] * 100) / 100,
          aMask: 0,
          bMask: 0,
          aIndices,
          bIndices,
        });
      }
    }
  };

  const candidates: PermBlock[] = [];

  for (let p = 0; p < numPermutations; p++) {
    for (let i = 0; i < m; i++) perm[i] = i;
    for (let i = m - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = perm[i];
      perm[i] = perm[j];
      perm[j] = tmp;
    }

    candidates.length = 0;
    extractBlocks(false, false, 0, candidates);
    extractBlocks(false, true, 1, candidates);
    extractBlocks(true, false, 2, candidates);
    extractBlocks(true, true, 3, candidates);

    const candLen = candidates.length;
    if (candLen > 1) {
      candidates.sort((a, b) => b.score - a.score);
    }

    let lastOrientMode = -1;
    let nullScore = 0;

    if (useMasks) {
      let maskA = 0;
      let maskB = 0;
      for (let c = 0; c < candLen; c++) {
        const blk = candidates[c];
        if ((maskA & blk.aMask) !== 0 || (maskB & blk.bMask) !== 0) continue;
        const switchCost = lastOrientMode !== -1 && lastOrientMode !== blk.orientMode ? switchPenalty : 0;
        if (blk.score - switchCost < 1.2) continue;
        const adjScore = switchCost > 0 ? Math.round((blk.score - switchCost) * 100) / 100 : blk.score;
        lastOrientMode = blk.orientMode;
        nullScore += adjScore;
        maskA |= blk.aMask;
        maskB |= blk.bMask;
      }
    } else {
      gUsedA.fill(0);
      gUsedB.fill(0);
      for (let c = 0; c < candLen; c++) {
        const blk = candidates[c];
        const aIdx = blk.aIndices!;
        const bIdx = blk.bIndices!;
        let overlaps = false;
        for (let t = 0; t < aIdx.length; t++) if (gUsedA[aIdx[t]]) { overlaps = true; break; }
        if (!overlaps) for (let t = 0; t < bIdx.length; t++) if (gUsedB[bIdx[t]]) { overlaps = true; break; }
        if (overlaps) continue;
        const switchCost = lastOrientMode !== -1 && lastOrientMode !== blk.orientMode ? switchPenalty : 0;
        if (blk.score - switchCost < 1.2) continue;
        const adjScore = switchCost > 0 ? Math.round((blk.score - switchCost) * 100) / 100 : blk.score;
        lastOrientMode = blk.orientMode;
        nullScore += adjScore;
        for (let t = 0; t < aIdx.length; t++) gUsedA[aIdx[t]] = 1;
        for (let t = 0; t < bIdx.length; t++) gUsedB[bIdx[t]] = 1;
      }
    }

    if (nullScore >= observedScore) geCount++;
  }

  return (geCount + 1) / (numPermutations + 1);
}

/**
 * Piecewise Polarity Sequence Aligner (SW^piece_pol) over lossless clauses.
 * Handles 1:1, 1:2, and 2:1 clause bundling, forward + reversed orientations,
 * and CONCORDANT vs INVERSION (POS <-> NEG / antonym) modes.
 */
export function alignClauseSequencesPiecewise(
  clausesA: ClauseSig[],
  clausesB: ClauseSig[],
  options: { switchPenalty?: number; permutations?: number } = {},
): SequenceAlignment {
  const switchPenalty = options.switchPenalty ?? 1.8;
  const permutations = options.permutations ?? 64;

  if (clausesA.length < 2 || clausesB.length < 2) {
    return { raw_score: 0, p_null: 1, evidence_bits: 0, arc_kind: 'parallel_scene', blocks: [] };
  }
  const aTokens = new Set<string>();
  for (const a of clausesA) {
    for (const c of a.concepts) aTokens.add(c);
    for (const r of a.roles) aTokens.add(r.concept);
    if (a.antonyms) for (const ant of a.antonyms) aTokens.add(ant);
  }
  let hasOverlap = false;
  outerOverlap: for (const b of clausesB) {
    for (const c of b.concepts) if (aTokens.has(c)) { hasOverlap = true; break outerOverlap; }
    for (const r of b.roles) if (aTokens.has(r.concept)) { hasOverlap = true; break outerOverlap; }
    if (b.antonyms) for (const ant of b.antonyms) if (aTokens.has(ant)) { hasOverlap = true; break outerOverlap; }
  }
  if (!hasOverlap) {
    return { raw_score: 0, p_null: 1, evidence_bits: 0, arc_kind: 'parallel_scene', blocks: [] };
  }

  const mat = buildSequenceMatrices(clausesA, clausesB);
  const idPerm = new Int32Array(clausesB.length);
  for (let j = 0; j < idPerm.length; j++) idPerm[j] = j;

  const candidates = [
    ...runBundledGotohDP(mat, idPerm, 'forward', 'CONCORDANT'),
    ...runBundledGotohDP(mat, idPerm, 'forward', 'INVERSION'),
    ...runBundledGotohDP(mat, idPerm, 'reversed', 'CONCORDANT'),
    ...runBundledGotohDP(mat, idPerm, 'reversed', 'INVERSION'),
  ];

  const blocks = assemblePiecewiseBlocks(candidates, switchPenalty);
  const rawScore = Math.round(blocks.reduce((acc, b) => acc + b.score, 0) * 100) / 100;
  if (rawScore < 1.15 || blocks.length === 0) {
    return { raw_score: rawScore, p_null: 1, evidence_bits: 0, arc_kind: 'parallel_scene', blocks };
  }
  const pNull = estimateSequenceNullPValue(mat, rawScore, permutations, 1.8);
  const evidenceBits = pNull < 0.05 ? Math.min(12.0, -Math.log2(Math.max(pNull, 1e-4))) : 0;

  const hasInv = blocks.some((b) => b.mode === 'INVERSION');
  const hasRev = blocks.some((b) => b.orientation === 'reversed');
  const hasFwd = blocks.some((b) => b.orientation === 'forward');

  let arcKind: SequenceAlignment['arc_kind'] = 'parallel_scene';
  if (hasInv && hasRev && hasFwd) arcKind = 'piecewise_mixed';
  else if (hasInv) arcKind = 'antithetical_decreation';
  else if (hasRev && !hasFwd) arcKind = 'mirror_inversion';
  else if (hasRev && hasFwd) arcKind = 'piecewise_mixed';

  return {
    raw_score: rawScore,
    p_null: Math.round(pNull * 10000) / 10000,
    evidence_bits: Math.round(evidenceBits * 100) / 100,
    arc_kind: arcKind,
    blocks,
  };
}
