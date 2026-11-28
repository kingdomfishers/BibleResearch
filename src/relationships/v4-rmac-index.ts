// @file: src/relationships/v4-rmac-index.ts
// Pure TypeScript R-MAC (Relational Many-Are-Called) Index Reader, Feature Extractor,
// and Stratified Dual-Channel Block-Max WAND Retriever for BibleResearch v4 (BRV4MAC\0).
// Zero Node-only imports; runs identically in Cloudflare Workers, Deno, Browser, and Node.

import {
  RMAC_MAGIC,
  type ArgRole,
  type CompactHreg,
  type HregEvent,
  type HregHoEdge,
  type HregParticipant,
  type PericopeTable,
} from './v4-hreg-types.ts';
import {
  BMW_FLAG_DENSE,
  BMW_FLAG_FUNC_STOP,
  hashKey64,
  type TermEntry,
} from './v3-binary-index.ts';

export type RmacFamily = 'M1F' | 'M1D' | 'M1V' | 'M2' | 'M3' | 'M4';

export interface RmacFeature {
  key: string;
  family: RmacFamily;
  weight: number;
}

export interface RmacExtractedFeatures {
  m1: string[];
  m2: string[];
  m3: string[];
  m4: string[];
  features: RmacFeature[];
}

export interface RmacBmwIndex {
  bytes: Uint8Array;
  view: DataView;
  version: number;
  numPericopes: number;
  numBlocks: number;
  bitsetWords: number;
  numTerms: number;
  dirOffset: number;
  denseOffset: number;
  sparseOffset: number;
  bmwOffset: number;
  denseWords: Uint32Array | null;
}

export interface RmacPostingInput {
  pericopeIds: Iterable<number>;
  flags?: number;
}

export interface RmacBuildOptions {
  version?: number;
  denseThreshold?: number;
  relBoostedPericopes?: Set<number>;
  enforceGoldilocksM2Band?: boolean;
}

export interface RmacQueryOptions {
  kStructural?: number;
  kHybrid?: number;
  kTotal?: number;
  minThetaStructural?: number;
  minThetaHybrid?: number;
  pericopeTable?: PericopeTable | null;
  pericopeSpans?: Map<number, { startVid: number; endVid: number }> | Array<{ pericopeId: number; startVid: number; endVid: number }>;
  excludePericopeIds?: Set<number>;
  maxDfRatio?: number;
}

export interface RmacCandidateHit {
  pericopeId: number;
  channel: 'S' | 'H' | 'BOTH';
  structuralScore: number;
  hybridScore: number;
  combinedScore: number;
  matchedStructuralCount: number;
  matchedHybridCount: number;
  matchedFamilies: RmacFamily[];
}

export const M4_FRAME_TAGS = [
  'EXP_ANALOGY',
  'VISION_DECODE',
  'PARABLE_DECODE',
  'COVENANT_COND',
  'QUOTATION_SPLICE',
  'NAMING_ETIOLOGY',
] as const;

const ROLE_SHORT_CODE: Record<ArgRole, string> = {
  AGENT: 'A',
  PATIENT: 'P',
  RECIPIENT: 'R',
  THEME_2: 'T',
  SOURCE: 'S',
  GOAL_LOC: 'G',
  INSTRUMENT: 'I',
  MANNER_TIME: 'M',
};

const CANONICAL_ROLE_TRANSITIONS = new Set<string>([
  'A->A',
  'A->P',
  'P->A',
  'P->P',
  'I->P',
  'S->G',
]);

const FAMILY_DEFAULT_WEIGHT: Record<RmacFamily, number> = {
  M1F: 1.0,
  M1D: 1.15,
  M1V: 1.10,
  M2: 1.05,
  M3: 0.90,
  M4: 1.25,
};

function checkMagic(bytes: Uint8Array, expected: string): boolean {
  if (bytes.byteLength < expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

function hashKey64Hex(key: string): string {
  const { hi, lo } = hashKey64(key);
  return `${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
}

/**
 * Parse a `BRV4MAC\0` binary Block-Max WAND index parameterized by `numPericopes`
 * and `numBlocks = ceil(numPericopes / 64)`.
 */
export function parseRmacBmwIndex(buf: ArrayBuffer | Uint8Array): RmacBmwIndex {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!checkMagic(bytes, RMAC_MAGIC)) {
    throw new Error('Invalid BRV4MAC magic header');
  }
  if (bytes.byteLength < 64) {
    throw new Error('Truncated BRV4MAC header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  if (version !== 4 && version !== 1 && version !== 3) {
    throw new Error(`Unsupported BRV4MAC version: ${version}`);
  }
  const numPericopes = view.getUint32(12, true);
  const rawNumBlocks = view.getUint32(16, true);
  const numBlocks = rawNumBlocks > 0 ? rawNumBlocks : Math.ceil(numPericopes / 64);
  const bitsetWords = numBlocks * 2;
  const numTerms = view.getUint32(20, true);
  const dirOffset = view.getUint32(24, true);
  const denseOffset = view.getUint32(28, true);
  const sparseOffset = view.getUint32(32, true);
  const bmwOffset = view.getUint32(36, true);

  let denseWords: Uint32Array | null = null;
  if ((bytes.byteOffset + denseOffset) % 4 === 0 && sparseOffset >= denseOffset) {
    denseWords = new Uint32Array(
      bytes.buffer,
      bytes.byteOffset + denseOffset,
      Math.floor((sparseOffset - denseOffset) / 4),
    );
  }

  return {
    bytes,
    view,
    version,
    numPericopes,
    numBlocks,
    bitsetWords,
    numTerms,
    dirOffset,
    denseOffset,
    sparseOffset,
    bmwOffset,
    denseWords,
  };
}

/**
 * Build a `BRV4MAC\0` binary Block-Max WAND buffer in pure TypeScript.
 */
export function buildRmacBmwIndex(
  postingsMap: Map<string, RmacPostingInput>,
  numPericopes: number,
  opts: RmacBuildOptions = {},
): Uint8Array {
  const version = opts.version ?? 4;
  const numBlocks = Math.max(1, Math.ceil(numPericopes / 64));
  const bitsetWords = numBlocks * 2;
  const denseThreshold = opts.denseThreshold ?? Math.max(64, Math.min(256, Math.floor(numPericopes * 0.04)));
  const relBoosted = opts.relBoostedPericopes ?? new Set<number>();
  const enforceM2Band = opts.enforceGoldilocksM2Band ?? numPericopes >= 100;
  const maxM2Df = Math.floor(0.06 * numPericopes);

  interface BuildEntry {
    key: string;
    hi: number;
    lo: number;
    df: number;
    pids: number[];
    flags: number;
    idfQ8: number;
    payloadOffset: number;
    bmwOffset: number;
  }

  const entries: BuildEntry[] = [];
  const seenHashes = new Set<string>();

  for (const [key, rec] of postingsMap.entries()) {
    const pidSet = new Set<number>();
    for (const pid of rec.pericopeIds) {
      if (pid >= 1 && pid <= numPericopes) pidSet.add(pid);
    }
    if (pidSet.size === 0) continue;
    if (enforceM2Band && key.startsWith('M2:') && (pidSet.size < 2 || pidSet.size > maxM2Df)) {
      continue;
    }

    const { hi, lo } = hashKey64(key);
    const hashTag = `${hi}:${lo}`;
    if (seenHashes.has(hashTag)) {
      throw new Error(`64-bit hash collision on BRV4MAC key "${key}"`);
    }
    seenHashes.add(hashTag);

    const pids = Array.from(pidSet).sort((a, b) => a - b);
    const df = pids.length;
    const isDense = df > denseThreshold;
    const flags = (isDense ? BMW_FLAG_DENSE : 0) | (rec.flags ?? 0);
    const idf = Math.max(0.25, Math.log2(Math.max(2, numPericopes) / df));
    const idfQ8 = Math.min(255, Math.max(1, Math.round(idf * 20)));
    entries.push({ key, hi, lo, df, pids, flags, idfQ8, payloadOffset: 0, bmwOffset: 0 });
  }

  entries.sort((a, b) => (a.hi !== b.hi ? a.hi - b.hi : a.lo - b.lo));

  const headerSize = 64;
  const dirSize = entries.length * 20;
  const denseChunks: Uint8Array[] = [];
  const sparseChunks: Uint8Array[] = [];
  const bmwChunks: Uint8Array[] = [];
  let denseOff = 0;
  let sparseOff = 0;
  let bmwOff = 0;

  for (const e of entries) {
    if ((e.flags & BMW_FLAG_DENSE) !== 0) {
      e.payloadOffset = denseOff;
      const words = new Uint32Array(bitsetWords);
      for (const pid of e.pids) {
        const idx0 = pid - 1;
        words[idx0 >>> 5] |= 1 << (idx0 & 31);
      }
      const buf = new Uint8Array(bitsetWords * 4);
      const dv = new DataView(buf.buffer);
      for (let w = 0; w < bitsetWords; w++) dv.setUint32(w * 4, words[w], true);
      denseChunks.push(buf);
      denseOff += buf.byteLength;
    } else {
      e.payloadOffset = sparseOff;
      const bytes: number[] = [];
      let prev = 0;
      for (const pid of e.pids) {
        const idx0 = pid - 1;
        let d = idx0 - prev;
        prev = idx0;
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

    const blockHasRel = new Map<number, boolean>();
    for (const pid of e.pids) {
      const b = (pid - 1) >>> 6;
      const rel = relBoosted.has(pid);
      if (!blockHasRel.has(b) || rel) blockHasRel.set(b, rel);
    }
    const sortedBlocks = Array.from(blockHasRel.keys()).sort((a, b) => a - b);
    const bmwBuf = new Uint8Array(2 + sortedBlocks.length * 4);
    const bv = new DataView(bmwBuf.buffer);
    bv.setUint16(0, sortedBlocks.length, true);
    for (let i = 0; i < sortedBlocks.length; i++) {
      const b = sortedBlocks[i];
      const ubRelQ8 = blockHasRel.get(b) ? 24 : 12;
      bv.setUint16(2 + i * 4, b, true);
      bv.setUint8(2 + i * 4 + 2, e.idfQ8);
      bv.setUint8(2 + i * 4 + 3, ubRelQ8);
    }
    e.bmwOffset = bmwOff;
    bmwChunks.push(bmwBuf);
    bmwOff += bmwBuf.byteLength;
  }

  const denseOffset = headerSize + dirSize;
  const sparseOffset = denseOffset + denseOff;
  const bmwOffset = sparseOffset + sparseOff;
  const totalBytes = bmwOffset + bmwOff;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  for (let i = 0; i < 8; i++) out[i] = RMAC_MAGIC.charCodeAt(i);
  view.setUint32(8, version, true);
  view.setUint32(12, numPericopes, true);
  view.setUint32(16, numBlocks, true);
  view.setUint32(20, entries.length, true);
  view.setUint32(24, headerSize, true);
  view.setUint32(28, denseOffset, true);
  view.setUint32(32, sparseOffset, true);
  view.setUint32(36, bmwOffset, true);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = headerSize + i * 20;
    view.setUint32(off, e.lo, true);
    view.setUint32(off + 4, e.hi, true);
    view.setUint16(off + 8, e.df, true);
    view.setUint8(off + 10, e.flags);
    view.setUint8(off + 11, e.idfQ8);
    view.setUint32(off + 12, e.payloadOffset, true);
    view.setUint32(off + 16, e.bmwOffset, true);
  }

  let cur = denseOffset;
  for (const c of denseChunks) { out.set(c, cur); cur += c.byteLength; }
  for (const c of sparseChunks) { out.set(c, cur); cur += c.byteLength; }
  for (const c of bmwChunks) { out.set(c, cur); cur += c.byteLength; }
  return out;
}

export function lookupRmacTerm(idx: RmacBmwIndex, key: string): TermEntry | null {
  const { hi, lo } = hashKey64(key);
  let left = 0;
  let right = idx.numTerms - 1;
  const { view, dirOffset } = idx;

  while (left <= right) {
    const mid = (left + right) >>> 1;
    const off = dirOffset + mid * 20;
    const mLo = view.getUint32(off, true);
    const mHi = view.getUint32(off + 4, true);
    if (mHi < hi || (mHi === hi && mLo < lo)) {
      left = mid + 1;
    } else if (mHi > hi || (mHi === hi && mLo > lo)) {
      right = mid - 1;
    } else {
      return {
        index: mid,
        hi: mHi,
        lo: mLo,
        df: view.getUint16(off + 8, true),
        flags: view.getUint8(off + 10),
        idf: view.getUint8(off + 11) / 20,
        payloadOffset: view.getUint32(off + 12, true),
        bmwOffset: view.getUint32(off + 16, true),
      };
    }
  }
  return null;
}

export function fillRmacTermBitset(
  idx: RmacBmwIndex,
  term: TermEntry,
  outWords: Uint32Array = new Uint32Array(idx.bitsetWords),
): Uint32Array {
  const { bitsetWords } = idx;
  if (term.flags & BMW_FLAG_DENSE) {
    const wordStart = term.payloadOffset >>> 2;
    if (idx.denseWords && wordStart + bitsetWords <= idx.denseWords.length) {
      outWords.set(idx.denseWords.subarray(wordStart, wordStart + bitsetWords));
    } else {
      const byteStart = idx.denseOffset + term.payloadOffset;
      for (let w = 0; w < bitsetWords; w++) {
        outWords[w] = idx.view.getUint32(byteStart + w * 4, true);
      }
    }
    return outWords;
  }

  outWords.fill(0);
  const posCount = term.df;
  let pos = idx.sparseOffset + term.payloadOffset;
  let prev = 0;
  for (let i = 0; i < posCount; i++) {
    let delta = 0;
    let shift = 0;
    while (true) {
      const b = idx.bytes[pos++];
      delta |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    prev += delta;
    const wordIdx = prev >>> 5;
    if (wordIdx < outWords.length) {
      outWords[wordIdx] |= 1 << (prev & 31);
    }
  }
  return outWords;
}

function getRmacDenseSlice(idx: RmacBmwIndex, term: TermEntry): Uint32Array | null {
  if (!(term.flags & BMW_FLAG_DENSE) || !idx.denseWords) return null;
  const wordStart = term.payloadOffset >>> 2;
  if (wordStart + idx.bitsetWords > idx.denseWords.length) return null;
  return idx.denseWords.subarray(wordStart, wordStart + idx.bitsetWords);
}

/**
 * Extract the 4 factored R-MAC signature families (`M1F`, `M1D`, `M1V`, `M2` entity-blind 2-RWL,
 * `M3`/`M3E`, and `M4`) from a CompactHreg per ALGORITHM_DESIGN.md §3.1.
 */
export function extractRmacFeatures(hreg: CompactHreg): RmacExtractedFeatures {
  const featureMap = new Map<string, RmacFeature>();
  const addFeature = (key: string, family: RmacFamily, weight = FAMILY_DEFAULT_WEIGHT[family]) => {
    const existing = featureMap.get(key);
    if (!existing) {
      featureMap.set(key, { key, family, weight });
    } else if (weight > existing.weight) {
      existing.weight = weight;
    }
  };

  const eventByEid = new Map<number, { idx: number; ev: HregEvent }>();
  for (let i = 0; i < hreg.events.length; i++) {
    eventByEid.set(hreg.events[i].eid, { idx: i, ev: hreg.events[i] });
  }
  const partByPid = new Map<number, HregParticipant>();
  for (const p of hreg.participants) {
    partByPid.set(p.pid, p);
  }

  // Helper: shared participant role transitions between two events
  const getSharedTransitions = (e1: HregEvent, e2: HregEvent): Array<{ pid: number; rt: string }> => {
    const out: Array<{ pid: number; rt: string }> = [];
    for (const a1 of e1.argRoles) {
      for (const a2 of e2.argRoles) {
        if (a1.pid === a2.pid) {
          out.push({
            pid: a1.pid,
            rt: `${ROLE_SHORT_CODE[a1.role]}->${ROLE_SHORT_CODE[a2.role]}`,
          });
        }
      }
    }
    return out;
  };

  // --- Family M1: Factored Relational Dyads (M1F, M1D, M1V) ---
  const hoEdgePairs = new Set<string>();
  const nonOrdHoEdges: HregHoEdge[] = [];

  for (const h of hreg.hoEdges) {
    if (h.hoType === 'ORD') continue;
    const fromEntry = eventByEid.get(h.fromEid);
    const toEntry = eventByEid.get(h.toEid);
    if (!fromEntry || !toEntry) continue;
    nonOrdHoEdges.push(h);

    const ei = fromEntry.ev;
    const ej = toEntry.ev;
    hoEdgePairs.add(`${ei.eid}:${ej.eid}`);

    const polSig = `${ei.pol === 'NEG' ? 'N' : 'P'}${ej.pol === 'NEG' ? 'N' : 'P'}`;
    const causSig = `${ei.isCausative ? 1 : 0}${ej.isCausative ? 1 : 0}`;
    const transitions = getSharedTransitions(ei, ej);

    addFeature(`M1F:${ei.arch}|${h.hoType}|${ej.arch}`, 'M1F');
    if (transitions.length === 0) {
      addFeature(`M1D:${h.hoType}|${polSig}|${causSig}|NONE`, 'M1D');
    } else {
      for (const tr of transitions) {
        addFeature(`M1D:${h.hoType}|${polSig}|${causSig}|${tr.rt}`, 'M1D');
      }
    }
  }

  // Ordered adjacent non-filler archetype bigrams for poetic / narrative chains (zero-HO coverage)
  const FILLER_ARCH = new Set(['EXIST_EQUATE', 'SPEAK_DECLARE']);
  const nonFillerEvs = hreg.events.filter((e) => !FILLER_ARCH.has(e.arch));
  for (let i = 0; i < nonFillerEvs.length; i++) {
    const ei = nonFillerEvs[i];
    const limit = Math.min(nonFillerEvs.length, i + 3);
    for (let j = i + 1; j < limit; j++) {
      const ej = nonFillerEvs[j];
      addFeature(`M1B:${ei.arch}->${ej.arch}`, 'M1F', j === i + 1 ? 0.85 : 0.65);
    }
  }

  for (let i = 0; i < hreg.events.length; i++) {
    const ei = hreg.events[i];
    const limit = Math.min(hreg.events.length, i + 5);
    for (let j = i + 1; j < limit; j++) {
      const ej = hreg.events[j];
      const transitions = getSharedTransitions(ei, ej);
      if (transitions.length === 0) continue;

      const polSig = `${ei.pol === 'NEG' ? 'N' : 'P'}${ej.pol === 'NEG' ? 'N' : 'P'}`;
      const causSig = `${ei.isCausative ? 1 : 0}${ej.isCausative ? 1 : 0}`;
      const hasHo = hoEdgePairs.has(`${ei.eid}:${ej.eid}`) || hoEdgePairs.has(`${ej.eid}:${ei.eid}`);

      let sawAtoP = false;
      let sawPtoA = false;

      for (const tr of transitions) {
        if (!hasHo && CANONICAL_ROLE_TRANSITIONS.has(tr.rt)) {
          addFeature(`M1F:${ei.arch}|${tr.rt}|${ej.arch}`, 'M1F', 0.85);
          addFeature(`M1D:COREF:${tr.rt}|${polSig}|${causSig}|${tr.rt}`, 'M1D', 0.85);
        }
        if (tr.rt === 'A->P') sawAtoP = true;
        if (tr.rt === 'P->A') sawPtoA = true;
        if (tr.rt === 'A->P' || tr.rt === 'P->A') {
          addFeature(`M1V:TALION|A<->P`, 'M1V');
        }
        if ((ei.valence !== 0 && ej.valence !== 0 && ei.valence === -ej.valence) || ei.pol !== ej.pol) {
          addFeature(`M1V:VAL_REV|${tr.rt}|${ei.valence}->${ej.valence}`, 'M1V');
        }
      }
      if (sawAtoP && sawPtoA) {
        addFeature(`M1V:TALION_SWAP|A<->P`, 'M1V', 1.2);
      }
    }
  }

  // --- Family M2: Entity-Blind 2-Round Typed Relational Weisfeiler-Leman (2-RWL) ---
  // Node indexing: 0..nP-1 participants, nP..nP+nE-1 events, nP+nE..nP+nE+nH-1 non-ORD HO nodes
  const nP = hreg.participants.length;
  const nE = hreg.events.length;
  const nH = nonOrdHoEdges.length;
  const totalNodes = nP + nE + nH;

  if (totalNodes > 0) {
    const pidToNode = new Map<number, number>();
    for (let i = 0; i < nP; i++) pidToNode.set(hreg.participants[i].pid, i);
    const eidToNode = new Map<number, number>();
    for (let i = 0; i < nE; i++) eidToNode.set(hreg.events[i].eid, nP + i);

    const adj: Array<Array<{ edgeType: string; to: number }>> = Array.from({ length: totalNodes }, () => []);

    for (let i = 0; i < nE; i++) {
      const ev = hreg.events[i];
      const eNode = nP + i;
      for (const arg of ev.argRoles) {
        const pNode = pidToNode.get(arg.pid);
        if (pNode === undefined) continue;
        adj[eNode].push({ edgeType: `ARG:${arg.role}`, to: pNode });
        adj[pNode].push({ edgeType: `ARG_REV:${arg.role}`, to: eNode });
      }
    }

    for (let i = 0; i < nH; i++) {
      const h = nonOrdHoEdges[i];
      const hNode = nP + nE + i;
      const fromNode = eidToNode.get(h.fromEid);
      const toNode = eidToNode.get(h.toEid);
      if (fromNode !== undefined) {
        adj[hNode].push({ edgeType: 'HO_FROM', to: fromNode });
        adj[fromNode].push({ edgeType: 'IN_HO_FROM', to: hNode });
      }
      if (toNode !== undefined) {
        adj[hNode].push({ edgeType: 'HO_TO', to: toNode });
        adj[toNode].push({ edgeType: 'IN_HO_TO', to: hNode });
      }
    }

    const seenBHashes = new Set<string>();
    const runRwlChannel = (channelTag: 'B' | 'S', useSort: boolean) => {
      let colors: string[] = new Array(totalNodes);
      for (let i = 0; i < nP; i++) {
        colors[i] = useSort ? `SORT:${hreg.participants[i].sort}` : 'ENT';
      }
      for (let i = 0; i < nE; i++) {
        const ev = hreg.events[i];
        colors[nP + i] = `EV:${ev.arch}|${ev.pol}|${ev.isCausative ? 1 : 0}`;
      }
      for (let i = 0; i < nH; i++) {
        colors[nP + nE + i] = `HO:${nonOrdHoEdges[i].hoType}`;
      }

      for (let round = 1; round <= 2; round++) {
        const nextColors: string[] = new Array(totalNodes);
        for (let u = 0; u < totalNodes; u++) {
          const neigh = adj[u].map((edge) => `${edge.edgeType}=${colors[edge.to]}`).sort();
          const sig = `${colors[u]}|${neigh.join(',')}`;
          const h = hashKey64Hex(sig);
          nextColors[u] = h;
          if (u >= nP) {
            if (adj[u].length <= 1) continue;
            if (!useSort) seenBHashes.add(h);
            else if (seenBHashes.has(h)) continue;
            const weight = round === 2 ? 1.15 : 0.90;
            addFeature(`M2:${channelTag}${round}:${h}`, 'M2', weight);
          }
        }
        colors = nextColors;
      }
    };

    runRwlChannel('B', false);
    runRwlChannel('S', true);
  }

  // --- Family M3: Cross-Lingual Concept x Role & Existential-Concept Signatures (proper nouns omitted to avoid entity hijacking) ---
  const isGenericConcept = (c: string): boolean => !c || c === 'C_XL:0444' || c.startsWith('sense:');
  for (const ev of hreg.events) {
    if (ev.conceptId && !isGenericConcept(ev.conceptId)) {
      addFeature(`M3:EV:${ev.conceptId}:${ev.pol}`, 'M3', 1.0);
      addFeature(`M3C:${ev.conceptId}`, 'M3', 1.15);
    }
    if (ev.isExistential) {
      const promoted = ev.promotedConceptId || ev.promotedStrongs || ev.conceptId;
      if (promoted && !isGenericConcept(promoted)) {
        addFeature(`M3E:EXIST:${ev.pol}:${promoted}`, 'M3', 1.25);
        addFeature(`M3C:${promoted}`, 'M3', 1.15);
      }
    }
    for (const arg of ev.argRoles) {
      const p = partByPid.get(arg.pid);
      if (!p || p.sort === 'PROP') continue;
      if (p.conceptId && !isGenericConcept(p.conceptId)) {
        addFeature(`M3:${p.conceptId}:${arg.role}`, 'M3', 0.90);
        addFeature(`M3C:${p.conceptId}`, 'M3', 1.15);
      }
    }
  }

  // --- Family M4: Explicit ESIDE Discourse Frame Tags ---
  let hasExplicitAnalogyHo = false;
  for (const h of nonOrdHoEdges) {
    if (h.hoType === 'EXPLICIT_ANALOGY') {
      hasExplicitAnalogyHo = true;
      break;
    }
  }
  for (let b = 0; b < M4_FRAME_TAGS.length; b++) {
    if ((hreg.esideTags & (1 << b)) !== 0 || (b === 0 && hasExplicitAnalogyHo)) {
      addFeature(`M4:${M4_FRAME_TAGS[b]}`, 'M4');
    }
  }

  const m1: string[] = [];
  const m2: string[] = [];
  const m3: string[] = [];
  const m4: string[] = [];
  const features: RmacFeature[] = [];

  for (const f of featureMap.values()) {
    features.push(f);
    if (f.family === 'M1F' || f.family === 'M1D' || f.family === 'M1V') m1.push(f.key);
    else if (f.family === 'M2') m2.push(f.key);
    else if (f.family === 'M3') m3.push(f.key);
    else m4.push(f.key);
  }

  return { m1, m2, m3, m4, features };
}

interface RmacBmwCursor {
  family: RmacFamily;
  weight: number;
  idf: number;
  activeCount: number;
  bmwDataStart: number;
  pos: number;
  curBlock: number;
  curUb: number;
  denseSlice: Uint32Array | null;
  sparseWords: Uint32Array | null;
}

interface ChannelHit {
  pericopeId: number;
  score: number;
  matchedCount: number;
  families: Set<RmacFamily>;
}

const ALL_FAMILIES: readonly RmacFamily[] = ['M1F', 'M1D', 'M1V', 'M2', 'M3', 'M4'];

function readRmacBmwBlock(idx: RmacBmwIndex, cursor: RmacBmwCursor): void {
  if (cursor.pos >= cursor.activeCount) {
    cursor.curBlock = 0xffff;
    cursor.curUb = 0;
    return;
  }
  const off = cursor.bmwDataStart + cursor.pos * 4;
  cursor.curBlock = idx.view.getUint16(off, true);
  const ubLex = idx.view.getUint8(off + 2) / 20;
  const ubRel = idx.view.getUint8(off + 3) / 40;
  cursor.curUb = (ubLex + ubRel) * cursor.weight;
}

function advanceRmacCursorToBlock(idx: RmacBmwIndex, cursor: RmacBmwCursor, targetBlock: number): void {
  while (cursor.curBlock < targetBlock) {
    cursor.pos++;
    readRmacBmwBlock(idx, cursor);
  }
}

function buildExcludedPericopeSet(queryHreg: CompactHreg, opts: RmacQueryOptions): Set<number> {
  const excluded = new Set<number>(opts.excludePericopeIds);
  if (queryHreg.pericopeId > 0) excluded.add(queryHreg.pericopeId);

  const qStart = queryHreg.startVid;
  const qEnd = queryHreg.endVid;
  const hasSpan = qStart > 0 && qEnd >= qStart;
  if (!hasSpan) return excluded;

  const wStart = Math.max(1, qStart - 15);
  const wEnd = qEnd + 15;
  if (opts.pericopeTable) {
    const vtp = opts.pericopeTable.vidToPericopes;
    if (vtp && vtp.length >= 31203 * 2) {
      const capEnd = Math.min(31203, wEnd);
      for (let v = wStart; v <= capEnd; v++) {
        const base = (v - 1) * 2;
        const p1 = vtp[base];
        const p2 = vtp[base + 1];
        if (p1 > 0) excluded.add(p1);
        if (p2 > 0) excluded.add(p2);
      }
    } else {
      for (const r of opts.pericopeTable.records) {
        if (r.startVid > 0 && r.endVid >= r.startVid && !(r.endVid < wStart || r.startVid > wEnd)) {
          excluded.add(r.pericopeId);
        }
      }
    }
  }
  if (opts.pericopeSpans) {
    const iter = Array.isArray(opts.pericopeSpans)
      ? opts.pericopeSpans.map((s) => [s.pericopeId, s] as const)
      : opts.pericopeSpans.entries();
    for (const [pid, span] of iter) {
      if (span.startVid > 0 && span.endVid >= span.startVid && !(span.endVid < wStart || span.startVid > wEnd)) {
        excluded.add(pid);
      }
    }
  }
  return excluded;
}

function runSubmodularBmwChannel(
  idx: RmacBmwIndex,
  features: RmacFeature[],
  allowedFamilies: Set<RmacFamily>,
  excludedPericopes: Set<number>,
  k: number,
  minTheta: number,
  maxDfRatio: number,
  pericopeTable?: PericopeTable | null,
): ChannelHit[] {
  if (k <= 0) return [];
  const cursors: RmacBmwCursor[] = [];
  const maxDfM2 = idx.numPericopes >= 100 ? Math.max(2, Math.floor(idx.numPericopes * maxDfRatio)) : idx.numPericopes;
  const maxDfGeneral = idx.numPericopes >= 100 ? Math.max(2, Math.floor(idx.numPericopes * Math.max(maxDfRatio, 0.055))) : idx.numPericopes;

  for (const feat of features) {
    if (!allowedFamilies.has(feat.family)) continue;
    const term = lookupRmacTerm(idx, feat.key);
    if (!term || (term.flags & BMW_FLAG_FUNC_STOP) !== 0) continue;
    if (idx.numPericopes >= 100) {
      const famMaxDf = feat.family === 'M2' ? maxDfM2 : maxDfGeneral;
      if (term.df < 2 || term.df > famMaxDf) continue;
    }

    const baseOff = idx.bmwOffset + term.bmwOffset;
    const activeCount = idx.view.getUint16(baseOff, true);
    if (activeCount === 0) continue;

    const denseSlice = getRmacDenseSlice(idx, term);
    const sparseWords = denseSlice ? null : fillRmacTermBitset(idx, term, new Uint32Array(idx.bitsetWords));

    const rarityBoost = Math.min(2.5, Math.pow(Math.max(1.0, term.idf) / 3.0, 0.85));
    const effWeight = feat.weight * rarityBoost;

    const cursor: RmacBmwCursor = {
      family: feat.family,
      weight: effWeight,
      idf: Math.max(0.20, term.idf) * effWeight,
      activeCount,
      bmwDataStart: baseOff + 2,
      pos: 0,
      curBlock: 0,
      curUb: 0,
      denseSlice,
      sparseWords,
    };
    readRmacBmwBlock(idx, cursor);
    cursors.push(cursor);
  }

  if (cursors.length === 0) return [];

  const heap: ChannelHit[] = [];
  let theta = minTheta;

  const pushHit = (hit: ChannelHit) => {
    if (heap.length < k) {
      heap.push(hit);
      if (heap.length === k) {
        heap.sort((a, b) => a.score - b.score || a.pericopeId - b.pericopeId);
        theta = Math.max(minTheta, heap[0].score);
      }
      return;
    }
    if (hit.score > heap[0].score || (hit.score === heap[0].score && hit.pericopeId < heap[0].pericopeId)) {
      heap[0] = hit;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && heap[l].score < heap[smallest].score) smallest = l;
        if (r < heap.length && heap[r].score < heap[smallest].score) smallest = r;
        if (smallest === i) break;
        const tmp = heap[i];
        heap[i] = heap[smallest];
        heap[smallest] = tmp;
        i = smallest;
      }
      theta = Math.max(minTheta, heap[0].score);
    }
  };

  const familyUb: Record<RmacFamily, number> = { M1F: 0, M1D: 0, M1V: 0, M2: 0, M3: 0, M4: 0 };
  const familySum: Record<RmacFamily, number> = { M1F: 0, M1D: 0, M1V: 0, M2: 0, M3: 0, M4: 0 };

  while (true) {
    cursors.sort((a, b) => a.curBlock - b.curBlock);

    for (const f of ALL_FAMILIES) familyUb[f] = 0;
    let pivotIdx = -1;
    for (let i = 0; i < cursors.length; i++) {
      if (cursors[i].curBlock === 0xffff) break;
      familyUb[cursors[i].family] += cursors[i].curUb;
      let ubSaturated = 0;
      for (const f of ALL_FAMILIES) {
        if (familyUb[f] > 0) ubSaturated += Math.log2(1 + familyUb[f]) + 0.45 * familyUb[f];
      }
      if (ubSaturated >= theta) {
        pivotIdx = i;
        break;
      }
    }
    if (pivotIdx < 0) break;

    const pivotBlock = cursors[pivotIdx].curBlock;
    if (pivotBlock === 0xffff) break;

    if (cursors[0].curBlock === pivotBlock) {
      const w0 = pivotBlock * 2;
      const w1 = w0 + 1;
      let unionLo = 0;
      let unionHi = 0;
      let blockRelBonus = 0;

      for (let i = 0; i < cursors.length; i++) {
        if (cursors[i].curBlock !== pivotBlock) break;
        const words = cursors[i].denseSlice || cursors[i].sparseWords!;
        if (w0 < words.length) unionLo |= words[w0];
        if (w1 < words.length) unionHi |= words[w1];
        const off = cursors[i].bmwDataStart + cursors[i].pos * 4;
        const rel = idx.view.getUint8(off + 3) / 40;
        if (rel > blockRelBonus) blockRelBonus = rel;
      }

      for (let half = 0; half < 2; half++) {
        let mask = half === 0 ? unionLo : unionHi;
        const wordIdx = half === 0 ? w0 : w1;
        while (mask !== 0) {
          const tz = Math.clz32(mask & -mask) ^ 31;
          const bit = 1 << tz;
          mask &= mask - 1;
          const pericopeId = (wordIdx << 5) + tz + 1;
          if (pericopeId < 1 || pericopeId > idx.numPericopes) continue;
          if (excludedPericopes.has(pericopeId)) continue;

          for (const f of ALL_FAMILIES) familySum[f] = 0;
          let matchedCount = 0;
          for (let i = 0; i < cursors.length; i++) {
            const words = cursors[i].denseSlice || cursors[i].sparseWords!;
            if (wordIdx < words.length && (words[wordIdx] & bit) !== 0) {
              familySum[cursors[i].family] += cursors[i].idf;
              matchedCount++;
            }
          }

          let score = 0;
          const families = new Set<RmacFamily>();
          for (const f of ALL_FAMILIES) {
            if (familySum[f] > 0) {
              score += Math.log2(1 + familySum[f]) + 0.45 * familySum[f];
              families.add(f);
            }
          }
          if (matchedCount >= 2) score += 0.25 * blockRelBonus;
          if (pericopeTable && pericopeId <= pericopeTable.records.length) {
            const rec = pericopeTable.records[pericopeId - 1];
            const span = Math.max(8, rec.endVid - rec.startVid + 1);
            score /= Math.pow(span / 8, 0.30);
          }
          if (score > theta) {
            pushHit({ pericopeId, score, matchedCount, families });
          }
        }
      }

      for (let i = 0; i < cursors.length; i++) {
        if (cursors[i].curBlock === pivotBlock) {
          advanceRmacCursorToBlock(idx, cursors[i], pivotBlock + 1);
        } else {
          break;
        }
      }
    } else {
      for (let i = 0; i < pivotIdx; i++) {
        advanceRmacCursorToBlock(idx, cursors[i], pivotBlock);
      }
    }
  }

  return heap.sort((a, b) => b.score - a.score || b.matchedCount - a.matchedCount || a.pericopeId - b.pericopeId);
}

const CHANNEL_S_FAMILIES = new Set<RmacFamily>(['M1F', 'M1D', 'M1V', 'M2']);
const CHANNEL_C_FAMILIES = new Set<RmacFamily>(['M3', 'M4']);
const CHANNEL_H_FAMILIES = new Set<RmacFamily>(['M1F', 'M1D', 'M1V', 'M2', 'M3', 'M4']);

/**
 * Execute Stratified 3-Channel Block-Max WAND retrieval over `BRV4MAC\0`:
 * - Channel S (`M1 + M2` entity-blind structure, Top 10)
 * - Channel C (`M3 + M4` cross-lingual concept/frame, Top 12)
 * - Channel H (`M1..M4` combined hybrid, Top 10)
 * Excludes pericopes overlapping `[queryHreg.startVid, queryHreg.endVid]`,
 * and returns up to `K_FAC <= 32` deduplicated candidate pericopes.
 */
export function queryRmacCandidates(
  index: RmacBmwIndex,
  queryHreg: CompactHreg,
  opts: RmacQueryOptions = {},
): RmacCandidateHit[] {
  const kTotal = Math.min(32, opts.kTotal ?? 32);
  const kStructural = Math.min(10, opts.kStructural ?? 10);
  const kConcept = Math.min(12, Math.max(8, Math.floor(kTotal * 0.375)));
  const kHybrid = Math.min(10, opts.kHybrid ?? 10);
  const minThetaStructural = opts.minThetaStructural ?? 0.25;
  const minThetaHybrid = opts.minThetaHybrid ?? 0.25;
  const maxDfRatio = opts.maxDfRatio ?? 0.05;

  const { features } = extractRmacFeatures(queryHreg);
  if (features.length === 0) return [];

  const excludedPericopes = buildExcludedPericopeSet(queryHreg, opts);

  const hitsS = runSubmodularBmwChannel(
    index,
    features,
    CHANNEL_S_FAMILIES,
    excludedPericopes,
    kStructural,
    minThetaStructural,
    maxDfRatio,
    opts.pericopeTable,
  );
  const hitsC = runSubmodularBmwChannel(
    index,
    features,
    CHANNEL_C_FAMILIES,
    excludedPericopes,
    kConcept,
    minThetaHybrid,
    maxDfRatio,
    opts.pericopeTable,
  );
  const hitsH = runSubmodularBmwChannel(
    index,
    features,
    CHANNEL_H_FAMILIES,
    excludedPericopes,
    kHybrid,
    minThetaHybrid,
    maxDfRatio,
    opts.pericopeTable,
  );

  const merged = new Map<number, RmacCandidateHit>();
  for (const h of hitsS) {
    merged.set(h.pericopeId, {
      pericopeId: h.pericopeId,
      channel: 'S',
      structuralScore: h.score,
      hybridScore: 0,
      combinedScore: h.score,
      matchedStructuralCount: h.matchedCount,
      matchedHybridCount: 0,
      matchedFamilies: Array.from(h.families),
    });
  }

  for (const h of [...hitsC, ...hitsH]) {
    const existing = merged.get(h.pericopeId);
    if (!existing) {
      merged.set(h.pericopeId, {
        pericopeId: h.pericopeId,
        channel: 'H',
        structuralScore: 0,
        hybridScore: h.score,
        combinedScore: h.score,
        matchedStructuralCount: 0,
        matchedHybridCount: h.matchedCount,
        matchedFamilies: Array.from(h.families),
      });
    } else {
      const wasS = existing.channel === 'S' || existing.channel === 'BOTH';
      existing.channel = wasS ? 'BOTH' : 'H';
      existing.hybridScore = Math.max(existing.hybridScore, h.score);
      existing.matchedHybridCount = Math.max(existing.matchedHybridCount, h.matchedCount);
      existing.combinedScore =
        Math.max(existing.structuralScore, existing.hybridScore) +
        0.18 * Math.min(existing.structuralScore, existing.hybridScore);
      const famSet = new Set<RmacFamily>([...existing.matchedFamilies, ...h.families]);
      existing.matchedFamilies = Array.from(famSet);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.combinedScore - a.combinedScore || b.structuralScore - a.structuralScore || a.pericopeId - b.pericopeId)
    .slice(0, kTotal);
}
