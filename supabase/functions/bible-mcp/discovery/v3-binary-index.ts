// @file: src/relationships/v3-binary-index.ts
// Pure TypeScript binary readers and allocation-free kernels for BibleResearch v3:
// 1. Hybrid Bitset + Block-Max WAND index (BRV3BMW\0)
// 2. Quantized Top-64 Typed PPR shards (BRV3PPR\0)
// 3. 6-Partition Typed Conductance CSR shards (BRV3CSR\0)
// 4. Dense integer-key pack index (BRV3PIDX), sorted string-key pack index (BRV3KIDX), binary nodes table (BRV3NODE)
// Zero Node-only imports; runs identically in Cloudflare Workers, Deno, Browser, and Node.

export const BMW_MAGIC = 'BRV3BMW\0';
export const PPR_MAGIC = 'BRV3PPR\0';
export const CSR_MAGIC = 'BRV3CSR\0';
export const PIDX_MAGIC = 'BRV3PIDX';
export const KIDX_MAGIC = 'BRV3KIDX';
export const NODE_MAGIC = 'BRV3NODE';

export const NUM_VERSES = 31203;
export const NUM_BLOCKS = 488; // ceil(31203 / 64)
export const BITSET_WORDS = 976; // 488 * 2 uint32 words = 3904 bytes

export const BMW_FLAG_DENSE = 1 << 0;
export const BMW_FLAG_FUNC_STOP = 1 << 1;
export const BMW_FLAG_LXX = 1 << 2;
export const BMW_FLAG_CONCEPT = 1 << 3;
export const BMW_FLAG_ACTANT = 1 << 4;

export const GRAPH_PARTITIONS = ['OCC', 'XREF', 'LXX', 'LEX_SYN', 'WP', 'CONCEPT_PROC'] as const;
export type GraphPartitionName = (typeof GRAPH_PARTITIONS)[number];

export interface TermEntry {
  index: number;
  hi: number;
  lo: number;
  df: number;
  flags: number;
  idf: number;
  payloadOffset: number;
  bmwOffset: number;
}

export interface BmwIndex {
  bytes: Uint8Array;
  view: DataView;
  numVerses: number;
  numBlocks: number;
  numTerms: number;
  dirOffset: number;
  denseOffset: number;
  sparseOffset: number;
  bmwOffset: number;
  denseWords: Uint32Array | null;
}

export interface WandHit {
  vid: number;
  score: number;
  matchedCount: number;
}

export interface PprEntry {
  targetNodeId: number;
  prob: number;
  metapathMask: number;
}

export interface PprShard {
  bytes: Uint8Array;
  view: DataView;
  shardId: number;
  numShards: number;
  numSeeds: number;
  indexOffset: number;
  dataOffset: number;
}

export interface CsrEdge {
  toNodeId: number;
  partition: number; // 0..5 index into GRAPH_PARTITIONS
  weight: number;
  epistemicFlags: number;
}

export interface CsrPart {
  bytes: Uint8Array;
  view: DataView;
  partId: number;
  numParts: number;
  numNodes: number;
  dirOffset: number;
  adjOffset: number;
}

// Deterministic FNV-1a 64-bit hash split into (hi, lo) uint32 pairs for fast JS compare.
export function hashKey64(key: string): { hi: number; lo: number } {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask64 = 0xffffffffffffffffn;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 0x80) {
      hash ^= BigInt(code);
      hash = (hash * prime) & mask64;
    } else if (code < 0x800) {
      hash ^= BigInt(0xc0 | (code >> 6));
      hash = (hash * prime) & mask64;
      hash ^= BigInt(0x80 | (code & 0x3f));
      hash = (hash * prime) & mask64;
    } else {
      hash ^= BigInt(0xe0 | (code >> 12));
      hash = (hash * prime) & mask64;
      hash ^= BigInt(0x80 | ((code >> 6) & 0x3f));
      hash = (hash * prime) & mask64;
      hash ^= BigInt(0x80 | (code & 0x3f));
      hash = (hash * prime) & mask64;
    }
  }
  return {
    hi: Number((hash >> 32n) & 0xffffffffn) >>> 0,
    lo: Number(hash & 0xffffffffn) >>> 0,
  };
}

function checkMagic(bytes: Uint8Array, expected: string): boolean {
  if (bytes.byteLength < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

export function parseBmwIndex(buf: ArrayBuffer | Uint8Array): BmwIndex {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!checkMagic(bytes, BMW_MAGIC)) {
    throw new Error('Invalid BRV3BMW magic header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  if (version !== 3) {
    throw new Error(`Unsupported BRV3BMW version: ${version}`);
  }
  const numVerses = view.getUint32(12, true);
  const numBlocks = view.getUint32(16, true);
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
    numVerses,
    numBlocks,
    numTerms,
    dirOffset,
    denseOffset,
    sparseOffset,
    bmwOffset,
    denseWords,
  };
}

export function lookupTerm(idx: BmwIndex, key: string): TermEntry | null {
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

export function decodeSparseVidIndices(
  bytes: Uint8Array,
  startOffset: number,
  count: number,
  outIndices: Int32Array,
): number {
  let pos = startOffset;
  let prev = 0;
  for (let i = 0; i < count; i++) {
    let delta = 0;
    let shift = 0;
    while (true) {
      const b = bytes[pos++];
      delta |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    prev += delta;
    outIndices[i] = prev;
  }
  return count;
}

export function fillTermBitset(
  idx: BmwIndex,
  term: TermEntry,
  outWords: Uint32Array = new Uint32Array(BITSET_WORDS),
): Uint32Array {
  if (term.flags & BMW_FLAG_DENSE) {
    const wordStart = term.payloadOffset >>> 2;
    if (idx.denseWords) {
      outWords.set(idx.denseWords.subarray(wordStart, wordStart + BITSET_WORDS));
    } else {
      const byteStart = idx.denseOffset + term.payloadOffset;
      for (let w = 0; w < BITSET_WORDS; w++) {
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
    outWords[prev >>> 5] |= 1 << (prev & 31);
  }
  return outWords;
}

export function getDenseWordSlice(idx: BmwIndex, term: TermEntry): Uint32Array | null {
  if (!(term.flags & BMW_FLAG_DENSE) || !idx.denseWords) return null;
  const wordStart = term.payloadOffset >>> 2;
  return idx.denseWords.subarray(wordStart, wordStart + BITSET_WORDS);
}

/**
 * Exact set intersection/difference over arbitrary terms (< 10 us for dense bitsets).
 * Returns 1-based canonical verse IDs.
 */
export function intersectTerms(
  idx: BmwIndex,
  includeKeys: string[],
  excludeKeys: string[] = [],
  limit = 200,
): number[] {
  if (includeKeys.length === 0) return [];
  const acc = new Uint32Array(BITSET_WORDS);
  const tmp = new Uint32Array(BITSET_WORDS);

  for (let i = 0; i < includeKeys.length; i++) {
    const term = lookupTerm(idx, includeKeys[i]);
    if (!term) return [];
    const slice = getDenseWordSlice(idx, term);
    if (i === 0) {
      if (slice) acc.set(slice);
      else fillTermBitset(idx, term, acc);
    } else {
      const words = slice || fillTermBitset(idx, term, tmp);
      for (let w = 0; w < BITSET_WORDS; w++) acc[w] &= words[w];
    }
  }

  for (let i = 0; i < excludeKeys.length; i++) {
    const term = lookupTerm(idx, excludeKeys[i]);
    if (!term) continue;
    const words = getDenseWordSlice(idx, term) || fillTermBitset(idx, term, tmp);
    for (let w = 0; w < BITSET_WORDS; w++) acc[w] &= ~words[w];
  }

  const vids: number[] = [];
  for (let w = 0; w < BITSET_WORDS; w++) {
    let word = acc[w];
    while (word !== 0) {
      const tz = Math.clz32(word & -word) ^ 31;
      const vid = (w << 5) + tz + 1;
      if (vid <= idx.numVerses) {
        vids.push(vid);
        if (vids.length >= limit) return vids;
      }
      word &= word - 1;
    }
  }
  return vids;
}

interface BmwCursor {
  term: TermEntry;
  idf: number;
  activeCount: number;
  bmwDataStart: number;
  pos: number;
  curBlock: number;
  curUb: number;
  denseSlice: Uint32Array | null;
  sparseWords: Uint32Array | null;
}

function readBmwBlock(idx: BmwIndex, cursor: BmwCursor): void {
  if (cursor.pos >= cursor.activeCount) {
    cursor.curBlock = 0xffff;
    cursor.curUb = 0;
    return;
  }
  const off = cursor.bmwDataStart + cursor.pos * 4;
  cursor.curBlock = idx.view.getUint16(off, true);
  const ubLex = idx.view.getUint8(off + 2) / 20;
  const ubRel = idx.view.getUint8(off + 3) / 40;
  cursor.curUb = ubLex + ubRel;
}

function advanceCursorToBlock(idx: BmwIndex, cursor: BmwCursor, targetBlock: number): void {
  while (cursor.curBlock < targetBlock) {
    cursor.pos++;
    readBmwBlock(idx, cursor);
  }
}

/**
 * Allocation-bounded Block-Max WAND retrieval across up to 16 query terms.
 * Returns Top-K verses ordered by IDF + relational upper-bound score.
 */
export function blockMaxWandTopK(
  idx: BmwIndex,
  keys: string[],
  k = 32,
  minTheta = 1.5,
  termWeights?: number[],
): WandHit[] {
  const cursors: BmwCursor[] = [];
  for (let i = 0; i < keys.length; i++) {
    const term = lookupTerm(idx, keys[i]);
    if (!term || (term.flags & BMW_FLAG_FUNC_STOP)) continue;
    const baseOff = idx.bmwOffset + term.bmwOffset;
    const activeCount = idx.view.getUint16(baseOff, true);
    if (activeCount === 0) continue;
    const weightMul = termWeights && termWeights[i] !== undefined ? termWeights[i] : 1;
    const denseSlice = getDenseWordSlice(idx, term);
    let sparseWords: Uint32Array | null = null;
    if (!denseSlice) {
      sparseWords = fillTermBitset(idx, term, new Uint32Array(BITSET_WORDS));
    }
    const cursor: BmwCursor = {
      term,
      idf: term.idf * weightMul,
      activeCount,
      bmwDataStart: baseOff + 2,
      pos: 0,
      curBlock: 0,
      curUb: 0,
      denseSlice,
      sparseWords,
    };
    readBmwBlock(idx, cursor);
    cursors.push(cursor);
  }

  if (cursors.length === 0) return [];

  const heap: WandHit[] = [];
  let theta = minTheta;

  const pushHit = (vid: number, score: number, matchedCount: number) => {
    if (heap.length < k) {
      heap.push({ vid, score, matchedCount });
      if (heap.length === k) {
        heap.sort((a, b) => a.score - b.score || a.vid - b.vid);
        theta = Math.max(minTheta, heap[0].score);
      }
      return;
    }
    if (score > heap[0].score || (score === heap[0].score && vid < heap[0].vid)) {
      heap[0] = { vid, score, matchedCount };
      // Bubble down small k (<= 64)
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

  while (true) {
    cursors.sort((a, b) => a.curBlock - b.curBlock);
    let ubSum = 0;
    let pivotIdx = -1;
    for (let i = 0; i < cursors.length; i++) {
      if (cursors[i].curBlock === 0xffff) break;
      ubSum += cursors[i].curUb;
      if (ubSum >= theta) {
        pivotIdx = i;
        break;
      }
    }
    if (pivotIdx < 0) break;

    const pivotBlock = cursors[pivotIdx].curBlock;
    if (pivotBlock === 0xffff) break;

    if (cursors[0].curBlock === pivotBlock) {
      // Exact bit-parallel evaluation inside 64-verse block [pivotBlock*2, pivotBlock*2 + 1]
      const w0 = pivotBlock * 2;
      const w1 = w0 + 1;
      let unionLo = 0;
      let unionHi = 0;
      let blockRelBonus = 0;
      for (let i = 0; i < cursors.length; i++) {
        if (cursors[i].curBlock !== pivotBlock) break;
        const words = cursors[i].denseSlice || cursors[i].sparseWords!;
        unionLo |= words[w0];
        unionHi |= words[w1];
        const off = cursors[i].bmwDataStart + cursors[i].pos * 4;
        const rel = idx.view.getUint8(off + 3) / 40;
        if (rel > blockRelBonus) blockRelBonus = rel;
      }

      // Evaluate each active bit in the 64-verse block
      for (let half = 0; half < 2; half++) {
        let mask = half === 0 ? unionLo : unionHi;
        const wordIdx = half === 0 ? w0 : w1;
        while (mask !== 0) {
          const tz = Math.clz32(mask & -mask) ^ 31;
          const bit = 1 << tz;
          mask &= mask - 1;
          const vid = (wordIdx << 5) + tz + 1;
          if (vid > idx.numVerses) continue;
          let score = 0;
          let matchedCount = 0;
          for (let i = 0; i < cursors.length; i++) {
            const words = cursors[i].denseSlice || cursors[i].sparseWords!;
            if ((words[wordIdx] & bit) !== 0) {
              score += cursors[i].idf;
              matchedCount++;
            }
          }
          if (matchedCount >= 2) score += blockRelBonus;
          if (score > theta) {
            pushHit(vid, score, matchedCount);
          }
        }
      }

      for (let i = 0; i < cursors.length; i++) {
        if (cursors[i].curBlock === pivotBlock) {
          advanceCursorToBlock(idx, cursors[i], pivotBlock + 1);
        } else {
          break;
        }
      }
    } else {
      // Advance leading cursors up to pivotBlock
      for (let i = 0; i < pivotIdx; i++) {
        advanceCursorToBlock(idx, cursors[i], pivotBlock);
      }
    }
  }

  return heap.sort((a, b) => b.score - a.score || b.matchedCount - a.matchedCount || a.vid - b.vid);
}

// === Top-64 Quantized PPR Shard Reader ===
// Header (32B): magic(8) | version:u32(3) | shardId:u32 | numShards:u32 | numSeeds:u32 | indexOffset:u32 | dataOffset:u32 | reserved:u32
// Index entry (12B sorted by seedNodeId): seedNodeId:u32 | dataOffset:u32 | count:u16 | reserved:u16
// Record (7B): targetNodeId:u32 | logProbQ16:u16 (-ln(p) * 4096 clamped [0..65535]) | metapathMask:u8

export function parsePprShard(buf: ArrayBuffer | Uint8Array): PprShard {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!checkMagic(bytes, PPR_MAGIC)) {
    throw new Error('Invalid BRV3PPR magic header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  if (version !== 3) throw new Error(`Unsupported BRV3PPR version: ${version}`);
  return {
    bytes,
    view,
    shardId: view.getUint32(12, true),
    numShards: view.getUint32(16, true),
    numSeeds: view.getUint32(20, true),
    indexOffset: view.getUint32(24, true),
    dataOffset: view.getUint32(28, true),
  };
}

let EXP_Q16_LUT: Float32Array | null = null;
function getExpQ16Lut(): Float32Array {
  if (!EXP_Q16_LUT) {
    const lut = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) lut[i] = Math.exp(-i / 4096);
    EXP_Q16_LUT = lut;
  }
  return EXP_Q16_LUT;
}

const PPR_SHARD_ENTRY_CACHE = new WeakMap<PprShard, Map<number, PprEntry[]>>();
const CSR_PART_EDGE_CACHE = new WeakMap<CsrPart, Map<number, CsrEdge[]>>();

export function lookupPprTop64(shard: PprShard, seedNodeId: number): PprEntry[] {
  let cache = PPR_SHARD_ENTRY_CACHE.get(shard);
  if (cache) {
    const cached = cache.get(seedNodeId);
    if (cached !== undefined) return cached;
  } else {
    cache = new Map();
    PPR_SHARD_ENTRY_CACHE.set(shard, cache);
  }
  const { view, numSeeds, indexOffset, dataOffset } = shard;
  let left = 0;
  let right = numSeeds - 1;
  while (left <= right) {
    const mid = (left + right) >>> 1;
    const off = indexOffset + mid * 12;
    const id = view.getUint32(off, true);
    if (id < seedNodeId) left = mid + 1;
    else if (id > seedNodeId) right = mid - 1;
    else {
      const recOff = dataOffset + view.getUint32(off + 4, true);
      const count = view.getUint16(off + 8, true);
      const lut = getExpQ16Lut();
      const out: PprEntry[] = new Array(count);
      for (let i = 0; i < count; i++) {
        const p = recOff + i * 7;
        const targetNodeId = view.getUint32(p, true);
        const logProbQ16 = view.getUint16(p + 4, true);
        const metapathMask = view.getUint8(p + 6);
        out[i] = {
          targetNodeId,
          prob: lut[logProbQ16],
          metapathMask,
        };
      }
      if (cache.size < 4096) cache.set(seedNodeId, out);
      return out;
    }
  }
  if (cache.size < 4096) cache.set(seedNodeId, []);
  return [];
}

// === Typed Conductance CSR Part Reader ===
// Header (32B): magic(8) | version:u32(3) | partId:u32 | numParts:u32 | numNodes:u32 | dirOffset:u32 | adjOffset:u32 | reserved:u32
// Node Dir (12B sorted by nodeId): nodeId:u32 | adjOffset:u32 | degree:u16 | reserved:u16
// Edge (8B): toNodeId:u32 | partition:u8 | epistemicFlags:u8 | weightQ16:u16 (weight * 65535)

export function parseCsrPart(buf: ArrayBuffer | Uint8Array): CsrPart {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!checkMagic(bytes, CSR_MAGIC)) {
    throw new Error('Invalid BRV3CSR magic header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  if (version !== 3) throw new Error(`Unsupported BRV3CSR version: ${version}`);
  return {
    bytes,
    view,
    partId: view.getUint32(12, true),
    numParts: view.getUint32(16, true),
    numNodes: view.getUint32(20, true),
    dirOffset: view.getUint32(24, true),
    adjOffset: view.getUint32(28, true),
  };
}

export function lookupCsrEdges(part: CsrPart, nodeId: number): CsrEdge[] {
  let cache = CSR_PART_EDGE_CACHE.get(part);
  if (cache) {
    const cached = cache.get(nodeId);
    if (cached !== undefined) return cached;
  } else {
    cache = new Map();
    CSR_PART_EDGE_CACHE.set(part, cache);
  }
  const { view, numNodes, dirOffset, adjOffset } = part;
  let left = 0;
  let right = numNodes - 1;
  while (left <= right) {
    const mid = (left + right) >>> 1;
    const off = dirOffset + mid * 12;
    const id = view.getUint32(off, true);
    if (id < nodeId) left = mid + 1;
    else if (id > nodeId) right = mid - 1;
    else {
      const eOff = adjOffset + view.getUint32(off + 4, true);
      const deg = view.getUint16(off + 8, true);
      const out: CsrEdge[] = new Array(deg);
      for (let i = 0; i < deg; i++) {
        const p = eOff + i * 8;
        out[i] = {
          toNodeId: view.getUint32(p, true),
          partition: view.getUint8(p + 4),
          epistemicFlags: view.getUint8(p + 5),
          weight: view.getUint16(p + 6, true) / 65535,
        };
      }
      if (cache.size < 4096) cache.set(nodeId, out);
      return out;
    }
  }
  if (cache.size < 4096) cache.set(nodeId, []);
  return [];
}

// === Dense Integer-Key Byte-Range Pack Index (BRV3PIDX) ===
// Header (20B): magic(8) | version:u32(1) | maxId:u32 | fileCount:u32
// Table at 20 ((maxId+1)*8 B): [byteOffset:u32, ((fileIdx & 0xff) << 24) | (byteLength & 0xffffff)]

export interface PackedIntIndex {
  bytes: Uint8Array;
  view: DataView;
  maxId: number;
  fileCount: number;
}

export interface PackedSliceLocation {
  fileIdx: number;
  start: number;
  length: number;
}

export interface CoalescedPackRange {
  fileIdx: number;
  start: number;
  end: number;
  items: Array<{ id: number; relStart: number; length: number }>;
}

export function parsePackedIntIndex(buf: ArrayBuffer | Uint8Array): PackedIntIndex {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!checkMagic(bytes, PIDX_MAGIC)) throw new Error('Invalid BRV3PIDX magic header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  if (version !== 1) throw new Error(`Unsupported BRV3PIDX version: ${version}`);
  return {
    bytes,
    view,
    maxId: view.getUint32(12, true),
    fileCount: view.getUint32(16, true),
  };
}

export function lookupPackedInt(idx: PackedIntIndex, id: number): PackedSliceLocation | null {
  if (!Number.isInteger(id) || id < 0 || id > idx.maxId) return null;
  const off = 20 + id * 8;
  const start = idx.view.getUint32(off, true);
  const meta = idx.view.getUint32(off + 4, true);
  const length = meta & 0x00ffffff;
  if (length === 0) return null;
  const fileIdx = (meta >>> 24) & 0xff;
  return { fileIdx, start, length };
}

export function coalescePackedRanges(
  idx: PackedIntIndex,
  ids: number[],
  maxGapBytes = 8192,
  maxSpanBytes = 196608,
): CoalescedPackRange[] {
  const locs: Array<{ id: number; fileIdx: number; start: number; end: number; length: number }> = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const loc = lookupPackedInt(idx, id);
    if (loc) locs.push({ id, fileIdx: loc.fileIdx, start: loc.start, end: loc.start + loc.length - 1, length: loc.length });
  }
  locs.sort((a, b) => a.fileIdx - b.fileIdx || a.start - b.start);
  const out: CoalescedPackRange[] = [];
  let cur: { fileIdx: number; start: number; end: number; items: Array<{ id: number; start: number; length: number }> } | null = null;
  for (const loc of locs) {
    if (
      cur &&
      cur.fileIdx === loc.fileIdx &&
      loc.start - (cur.end + 1) <= maxGapBytes &&
      loc.end - cur.start + 1 <= maxSpanBytes
    ) {
      if (loc.end > cur.end) cur.end = loc.end;
      cur.items.push({ id: loc.id, start: loc.start, length: loc.length });
    } else {
      if (cur) {
        out.push({
          fileIdx: cur.fileIdx,
          start: cur.start,
          end: cur.end,
          items: cur.items.map(it => ({ id: it.id, relStart: it.start - cur!.start, length: it.length })),
        });
      }
      cur = { fileIdx: loc.fileIdx, start: loc.start, end: loc.end, items: [{ id: loc.id, start: loc.start, length: loc.length }] };
    }
  }
  if (cur) {
    out.push({
      fileIdx: cur.fileIdx,
      start: cur.start,
      end: cur.end,
      items: cur.items.map(it => ({ id: it.id, relStart: it.start - cur!.start, length: it.length })),
    });
  }
  return out;
}

// === Sorted String-Key Byte-Range Pack Index (BRV3KIDX) ===
// Header (24B): magic(8) | version:u32(1) | numKeys:u32 | fileCount:u32 | dirOffset:u32(24)
// Entry (16B, sorted ascending by UTF-8 bytes of key):
//   keyOff:u32 (from strOffset) | keyLen:u32 | byteOffset:u32 | fileAndLen:u32

export interface PackedKeyIndex {
  bytes: Uint8Array;
  view: DataView;
  numKeys: number;
  fileCount: number;
  dirOffset: number;
  strOffset: number;
}

const V3_UTF8_ENCODER = new TextEncoder();
const V3_UTF8_DECODER = new TextDecoder('utf-8');

function compareUtf8Slice(bytes: Uint8Array, off: number, len: number, needle: Uint8Array): number {
  const minLen = Math.min(len, needle.length);
  for (let i = 0; i < minLen; i++) {
    const d = bytes[off + i] - needle[i];
    if (d !== 0) return d;
  }
  return len - needle.length;
}

export function parsePackedKeyIndex(buf: ArrayBuffer | Uint8Array): PackedKeyIndex {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!checkMagic(bytes, KIDX_MAGIC)) throw new Error('Invalid BRV3KIDX magic header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  if (version !== 1) throw new Error(`Unsupported BRV3KIDX version: ${version}`);
  const numKeys = view.getUint32(12, true);
  const fileCount = view.getUint32(16, true);
  const dirOffset = view.getUint32(20, true);
  const strOffset = dirOffset + numKeys * 16;
  return { bytes, view, numKeys, fileCount, dirOffset, strOffset };
}

export function lookupPackedKey(idx: PackedKeyIndex, key: string): PackedSliceLocation | null {
  const needle = V3_UTF8_ENCODER.encode(key);
  let lo = 0;
  let hi = idx.numKeys - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const recOff = idx.dirOffset + mid * 16;
    const kOff = idx.strOffset + idx.view.getUint32(recOff, true);
    const kLen = idx.view.getUint32(recOff + 4, true);
    const cmp = compareUtf8Slice(idx.bytes, kOff, kLen, needle);
    if (cmp < 0) lo = mid + 1;
    else if (cmp > 0) hi = mid - 1;
    else {
      const start = idx.view.getUint32(recOff + 8, true);
      const meta = idx.view.getUint32(recOff + 12, true);
      const length = meta & 0x00ffffff;
      if (length === 0) return null;
      return { fileIdx: (meta >>> 24) & 0xff, start, length };
    }
  }
  return null;
}

// === Binary Zero-Parse Node Dictionary (BRV3NODE) ===
// Header (32B): magic(8) | version:u32(1) | numVerses:u32 | entityOffset:u32 | entityCount:u32 | lookupDirOff:u32 | metaOff:u32 | strOffset:u32
// lookupDir (entityCount * 12B, sorted by UTF-8 key): keyOff:u32 | keyLen:u16 | reserved:u16 | nodeId:u32
// metaTable (entityCount * 24B, indexed by nodeId - entityOffset):
//   keyOff:u32 | keyLen:u16 | flags:u8 (bit0=isPhysical, bit1=isExplicitCue) | reserved:u8 | df:u32 | axisOff:u32 | axisLen:u16 | cohypLen:u16 | cohypOff:u32

export interface BinaryNodesTable {
  bytes: Uint8Array;
  view: DataView;
  numVerses: number;
  entityOffset: number;
  entityCount: number;
  lookupDirOff: number;
  metaOff: number;
  strOffset: number;
  lookupNodeId(key: string): number | undefined;
  getKey(nodeId: number): string | null;
  getMetaTuple(entityIdx: number): [string, number, number, string, number] | undefined;
  keysWithPrefix(prefix: string): Array<[string, number]>;
}

export function parseNodesBin(buf: ArrayBuffer | Uint8Array): BinaryNodesTable {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!checkMagic(bytes, NODE_MAGIC)) throw new Error('Invalid BRV3NODE magic header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  if (version !== 1) throw new Error(`Unsupported BRV3NODE version: ${version}`);
  const numVerses = view.getUint32(12, true);
  const entityOffset = view.getUint32(16, true);
  const entityCount = view.getUint32(20, true);
  const lookupDirOff = view.getUint32(24, true);
  const metaOff = view.getUint32(28, true);
  const strOffset = metaOff + entityCount * 24;

  const strAt = (off: number, len: number): string =>
    len > 0 ? V3_UTF8_DECODER.decode(bytes.subarray(strOffset + off, strOffset + off + len)) : '';

  const lookupNodeId = (key: string): number | undefined => {
    const needle = V3_UTF8_ENCODER.encode(key);
    let lo = 0;
    let hi = entityCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const off = lookupDirOff + mid * 12;
      const kOff = strOffset + view.getUint32(off, true);
      const kLen = view.getUint16(off + 4, true);
      const cmp = compareUtf8Slice(bytes, kOff, kLen, needle);
      if (cmp < 0) lo = mid + 1;
      else if (cmp > 0) hi = mid - 1;
      else return view.getUint32(off + 8, true);
    }
    return undefined;
  };

  const getKey = (nodeId: number): string | null => {
    if (nodeId >= 1 && nodeId <= numVerses) return `V:${nodeId}`;
    const idx = nodeId - entityOffset;
    if (idx < 0 || idx >= entityCount) return null;
    const off = metaOff + idx * 24;
    return strAt(view.getUint32(off, true), view.getUint16(off + 4, true));
  };

  const getMetaTuple = (entityIdx: number): [string, number, number, string, number] | undefined => {
    if (entityIdx < 0 || entityIdx >= entityCount) return undefined;
    const off = metaOff + entityIdx * 24;
    const flags = view.getUint8(off + 6);
    const df = view.getUint32(off + 8, true);
    const axis = strAt(view.getUint32(off + 12, true), view.getUint16(off + 16, true));
    const cohypLen = view.getUint16(off + 18, true);
    const cohyp = strAt(view.getUint32(off + 20, true), cohypLen);
    return [axis, df, flags & 1, cohyp, (flags >>> 1) & 1];
  };

  const keysWithPrefix = (prefix: string): Array<[string, number]> => {
    const needle = V3_UTF8_ENCODER.encode(prefix);
    let lo = 0;
    let hi = entityCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const off = lookupDirOff + mid * 12;
      const kOff = strOffset + view.getUint32(off, true);
      const kLen = view.getUint16(off + 4, true);
      const cmp = compareUtf8Slice(bytes, kOff, kLen, needle);
      if (cmp < 0) lo = mid + 1;
      else hi = mid;
    }
    const out: Array<[string, number]> = [];
    for (let i = lo; i < entityCount; i++) {
      const off = lookupDirOff + i * 12;
      const kOff = view.getUint32(off, true);
      const kLen = view.getUint16(off + 4, true);
      if (kLen < needle.length) break;
      let match = true;
      for (let j = 0; j < needle.length; j++) {
        if (bytes[strOffset + kOff + j] !== needle[j]) {
          match = false;
          break;
        }
      }
      if (!match) break;
      out.push([strAt(kOff, kLen), view.getUint32(off + 8, true)]);
    }
    return out;
  };

  return {
    bytes,
    view,
    numVerses,
    entityOffset,
    entityCount,
    lookupDirOff,
    metaOff,
    strOffset,
    lookupNodeId,
    getKey,
    getMetaTuple,
    keysWithPrefix,
  };
}
