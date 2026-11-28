// @file: src/relationships/v3-runtime-adapter.ts
// Pure TypeScript adapter bridging BibleResearch v3 binary indexes, typed conductance graph,
// flat packs, E_perp scorer, and Top-24 exact verifiers into runtime engines & Worker RPCs.
// Zero Node-only imports; runs identically in Cloudflare Workers, Deno, Browser, and Node.

import type { AssetReader } from './adjacency-loader.ts';
import {
  NUM_VERSES,
  coalescePackedRanges,
  lookupCsrEdges,
  lookupPackedKey,
  lookupPprTop64,
  lookupTerm,
  parseBmwIndex,
  parseCsrPart,
  parseNodesBin,
  parsePackedIntIndex,
  parsePackedKeyIndex,
  parsePprShard,
  type BinaryNodesTable,
  type BmwIndex,
  type CsrEdge,
  type CsrPart,
  type PackedIntIndex,
  type PackedKeyIndex,
  type PprEntry,
  type PprShard,
} from './v3-binary-index.ts';
import {
  computeEPerpScore,
  rankBridgePivots,
  reconstructPassagePpr,
  type EPerpScoreResult,
  type NodeAxisMeta,
  type PassagePprAnchorTerm,
  type PassagePprDistribution,
  type PivotCandidateInput,
  type PivotRankedResult,
} from './v3-scorer.ts';
import type { ClauseSig, NtToken, OtAlignedSlot, OtLxxCandidateGroup } from './v3-verifiers.ts';
import {
  decodeCompactHreg,
  parsePericopeTable,
  parsePredSimTable,
  type CompactHreg,
  type PericopeTable,
  type PredicateSimOracle,
} from './v4-hreg-types.ts';
import { parseRmacBmwIndex, type RmacBmwIndex } from './v4-rmac-index.ts';

export interface V3NodesData {
  schema_version: number;
  num_verses: number;
  entity_offset: number;
  total_nodes: number;
  key_to_id: Record<string, number>;
  id_to_key: string[];
  node_meta: Array<[string, number, number, string, number]>;
  _bin?: BinaryNodesTable;
}

export function wrapBinaryNodesTable(bin: BinaryNodesTable): V3NodesData {
  const keyToId = new Proxy({} as Record<string, number>, {
    get(_t, prop) {
      return typeof prop === 'string' ? bin.lookupNodeId(prop) : undefined;
    },
    has(_t, prop) {
      return typeof prop === 'string' && bin.lookupNodeId(prop) !== undefined;
    },
  });
  const idToKey = new Proxy([] as string[], {
    get(_t, prop) {
      if (prop === 'length') return bin.entityCount;
      const idx = typeof prop === 'string' ? Number(prop) : -1;
      return Number.isInteger(idx) && idx >= 0 && idx < bin.entityCount
        ? bin.getKey(bin.entityOffset + idx) ?? ''
        : undefined;
    },
  });
  const nodeMeta = new Proxy([] as Array<[string, number, number, string, number]>, {
    get(_t, prop) {
      if (prop === 'length') return bin.entityCount;
      const idx = typeof prop === 'string' ? Number(prop) : -1;
      return Number.isInteger(idx) && idx >= 0 && idx < bin.entityCount
        ? bin.getMetaTuple(idx)
        : undefined;
    },
  });
  return {
    schema_version: 2,
    num_verses: bin.numVerses,
    entity_offset: bin.entityOffset,
    total_nodes: bin.entityOffset + bin.entityCount,
    key_to_id: keyToId,
    id_to_key: idToKey,
    node_meta: nodeMeta,
    _bin: bin,
  };
}

export interface V3ContextHooks {
  getV3Bmw?: () => Promise<BmwIndex | null>;
  getV3Nodes?: () => Promise<V3NodesData | null>;
  getV3PprShard?: (shardId: number) => Promise<PprShard | null>;
  getV3CsrPart?: (partId: number) => Promise<CsrPart | null>;
  getV3ProfileShard?: (shardId: number) => Promise<any | null>;
  getV3VerseChunk?: (chunkId: number) => Promise<any | null>;
  getV3ClauseShard?: (shardId: number) => Promise<any | null>;
  getV3MtLxxShard?: (shardId: number) => Promise<any | null>;
  getV3RahlfsShard?: (shardId: number) => Promise<any | null>;
  getV3RhetoricIndex?: () => Promise<any | null>;
  getV3RhetoricBook?: (bookId: number) => Promise<any | null>;
  getV3Onomastic?: () => Promise<any | null>;
  getV3Profile?: (bs: string) => Promise<any | null>;
  getV3ProfilesBatch?: (strongsList: string[]) => Promise<Map<string, any>>;
  getV3Verse?: (vid: number) => Promise<any | null>;
  getV3VersesBatch?: (vids: number[]) => Promise<Map<number, any>>;
  getV3VerseClauses?: (vid: number) => Promise<any | null>;
  getV3VerseClausesBatch?: (vids: number[]) => Promise<Map<number, any>>;
  getV3MtLxx?: (vid: number) => Promise<any | null>;
  getV3MtLxxBatch?: (vids: number[]) => Promise<Map<number, any>>;
  getV3RahlfsConcordance?: (lemma: string) => Promise<any | null>;
  // v4 hooks (zero-change compatible with v3-only callers)
  getV4Pericopes?: () => Promise<PericopeTable | null>;
  getV4PredSim?: () => Promise<PredicateSimOracle | null>;
  getV4Rmac?: () => Promise<RmacBmwIndex | null>;
  getV4Hreg?: (pericopeId: number) => Promise<CompactHreg | null>;
  getV4HregBatch?: (pericopeIds: number[]) => Promise<Map<number, CompactHreg | null>>;
  getV4EsideVid?: (vid: number) => Promise<{ vid: number; records: any[] } | null>;
  getV4EsideVidBatch?: (vids: number[]) => Promise<Map<number, { vid: number; records: any[] } | null>>;
  getV4EsideBs?: (bs: string) => Promise<{ bs: string; records: any[] } | null>;
}

const NODE_ENTITY_META_CACHE = new WeakMap<V3NodesData, Array<NodeAxisMeta | null | undefined>>();
const VERSE_META_CACHE = new Map<number, NodeAxisMeta>();

const GREEK_FUNC_POS = new Set([
  'article', 'conjunction', 'preposition', 'particle', 'pronoun', 'interjection',
  'det', 'conj', 'prep', 'ptcl', 'pron', 'intj', 'cj',
]);

const GREEK_COPULA_STRONGS = new Set(['G1510']);

const GREEK_SUPPLETIVE_SURFACE_TO_LEMMA: Record<string, string[]> = {
  μου: ['εγω'], μοι: ['εγω'], με: ['εγω'], εμου: ['εγω'], εμοι: ['εγω'], εμε: ['εγω'],
  ημεις: ['εγω'], ημων: ['εγω'], ημιν: ['εγω'], ημας: ['εγω'],
  σου: ['συ'], σοι: ['συ'], σε: ['συ'], υμεις: ['συ'], υμων: ['συ'], υμιν: ['συ'], υμας: ['συ'],
  η: ['ο', 'ος', 'η', 'ειμι'], το: ['ο'], του: ['ο', 'ος'], της: ['ο', 'ος'], τω: ['ο'], τη: ['ο'],
  τον: ['ο'], την: ['ο'], οι: ['ο', 'ος'], αι: ['ο', 'ος'], τα: ['ο'], των: ['ο', 'ος'],
  τοις: ['ο'], ταις: ['ο'], τους: ['ο'], τας: ['ο'],
  ου: ['ος', 'ου'], ω: ['ος', 'ειμι'], ον: ['ος', 'ειμι'], ην: ['ος', 'ειμι'], α: ['ος'],
  οις: ['ος'], αις: ['ος'], ους: ['ος'], ας: ['ος'],
  ουτος: ['ουτος'], αυτη: ['ουτος', 'αυτος'], τουτο: ['ουτος'], τουτου: ['ουτος'], ταυτης: ['ουτος'],
  τουτω: ['ουτος'], ταυτη: ['ουτος'], τουτον: ['ουτος'], ταυτην: ['ουτος'], ουτοι: ['ουτος'],
  αυται: ['ουτος', 'αυτος'], ταυτα: ['ουτος'], τουτων: ['ουτος'], τουτοις: ['ουτος'], ταυταις: ['ουτος'],
  τουτους: ['ουτος'], ταυτας: ['ουτος'],
  ει: ['ειμι', 'ει'], εστι: ['ειμι'], εστιν: ['ειμι'], εσμεν: ['ειμι'], εστε: ['ειμι'],
  εισι: ['ειμι'], εισιν: ['ειμι'], ης: ['ειμι', 'ος'], ημεν: ['ειμι'], ητε: ['ειμι'], ησαν: ['ειμι'],
  εσται: ['ειμι'], εσονται: ['ειμι'], ειναι: ['ειμι'], ων: ['ειμι', 'ος'], ουσα: ['ειμι'],
  οντος: ['ειμι'], οντες: ['ειμι'], ωμεν: ['ειμι'], ωσιν: ['ειμι'], ωσι: ['ειμι'],
  ειπον: ['λεγω', 'ειπον'], ειπεν: ['λεγω', 'ειπον'], ειπας: ['λεγω', 'ειπον'], ειπα: ['λεγω', 'ειπον'],
  ειπω: ['λεγω', 'ειπον'], ειπειν: ['λεγω', 'ειπον'], ερω: ['λεγω'], ερει: ['λεγω'], ερεις: ['λεγω'],
  ειρηκα: ['λεγω'], ειρηκεν: ['λεγω'],
  ηλθον: ['ερχομαι'], ηλθεν: ['ερχομαι'], ελθων: ['ερχομαι'], ελθειν: ['ερχομαι'],
  ειδον: ['οραω', 'ειδω'], ειδεν: ['οραω', 'ειδω'], ιδων: ['οραω', 'ειδω'], ιδοντες: ['οραω', 'ειδω'],
  ιδου: ['οραω', 'ειδω', 'ιδου'], οψεται: ['οραω'], ωφθη: ['οραω'],
  ουκ: ['ου'], ουχ: ['ου'], ουχι: ['ου'],
  εξ: ['εκ'], αφ: ['απο'], απ: ['απο'], καθ: ['κατα'], κατ: ['κατα'],
  μεθ: ['μετα'], μετ: ['μετα'], παρ: ['παρα'], υπ: ['υπο'], υφ: ['υπο'],
  εφ: ['επι'], επ: ['επι'], δι: ['δια'], ανθ: ['αντι'], αντ: ['αντι'],
  αλλ: ['αλλα'], δε: ['δε'], δ: ['δε'], τε: ['τε'], τ: ['τε'],
};

function stripGreekPlainV3(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^\u0370-\u03ff]/g, '');
}

function scoreGreekSfLmPair(sf: string, cl: string, lm: string, gc: string): number {
  const sfP = stripGreekPlainV3(sf);
  const lmP = stripGreekPlainV3(lm);
  if (!sfP || !lmP) return 0;
  if (sfP === lmP) return 6;
  const sup = GREEK_SUPPLETIVE_SURFACE_TO_LEMMA[sfP];
  if (sup && sup.includes(lmP)) return 5;
  if (sfP.length >= 3 && lmP.length >= 3 && sfP.slice(0, 3) === lmP.slice(0, 3)) return 5;
  if (sfP.length >= 2 && lmP.length >= 2 && sfP.slice(0, 2) === lmP.slice(0, 2)) return 3;

  const clLow = String(cl || '').toLowerCase();
  const gcUp = String(gc || '').toUpperCase();
  if (sfP === 'μη' || sfP === 'ου' || sfP === 'ουκ' || sfP === 'ουχ') {
    return lmP === 'μη' || lmP === 'ου' || lmP === 'ουδεις' || lmP === 'μηδεις' ? 5 : -6;
  }
  if (clLow === 'det') return gcUp.startsWith('T-') ? 2 : -5;
  if (clLow === 'prep') return gcUp.startsWith('PREP') ? 2 : -5;
  if (clLow === 'conj') return gcUp.startsWith('CONJ') ? 2 : -4;
  if (gcUp.startsWith('T-') || gcUp.startsWith('PREP') || gcUp.startsWith('CONJ')) {
    if (clLow === 'noun' || clLow === 'verb' || clLow === 'adj') return -5;
  }
  if ((clLow === 'noun' && gcUp.startsWith('N-')) || (clLow === 'verb' && gcUp.startsWith('V-'))) return 1;
  return 0;
}

export function sanitizeV3TokenLemma(strongs: string, lemma: string): string {
  if (strongs === 'H7462' && lemma && /עֵ֫קֶד|עקד|בֵּית|בֵּית|בית/.test(lemma)) {
    return 'רָעָה';
  }
  return lemma;
}

export function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function normStrongs4(raw: string | undefined | null): string {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('lemma:')) s = s.slice(6);
  const m = /^([HGhg])0*(\d+)(?:[A-Za-z].*)?$/.exec(s);
  if (!m) return '';
  return m[1].toUpperCase() + m[2].padStart(4, '0');
}

export function v3ProfileShardId(bs: string): number {
  return fnv1a32(bs) % 48;
}

export function v3VerseChunkId(vid: number): number {
  const span = Math.ceil(NUM_VERSES / 48); // 651
  return Math.min(47, Math.max(0, Math.floor((vid - 1) / span)));
}

export function v3ClauseShardId(vid: number): number {
  return Math.min(31, Math.max(0, Math.floor((vid - 1) / 976)));
}

export function v3MtLxxShardId(vid: number): number {
  return Math.abs(vid) % 32;
}

export function v3RahlfsShardId(lemma: string): number {
  return fnv1a32(lemma) % 8;
}

export class V3RuntimeSession {
  private reader: AssetReader;
  private hooks?: V3ContextHooks;
  private bmwPromise: Promise<BmwIndex | null> | null = null;
  private nodesPromise: Promise<V3NodesData | null> | null = null;
  private rhetoricIdxPromise: Promise<any | null> | null = null;
  private onomasticPromise: Promise<any | null> | null = null;
  private pprPromises = new Map<number, Promise<PprShard | null>>();
  private csrPromises = new Map<number, Promise<CsrPart | null>>();
  private profilePromises = new Map<number, Promise<any | null>>();
  private versePromises = new Map<number, Promise<any | null>>();
  private clausePromises = new Map<number, Promise<any | null>>();
  private mtLxxPromises = new Map<number, Promise<any | null>>();
  private rahlfsPromises = new Map<number, Promise<any | null>>();
  private v4PericopePromise: Promise<PericopeTable | null> | null = null;
  private v4PredSimPromise: Promise<PredicateSimOracle | null> | null = null;
  private v4RmacPromise: Promise<RmacBmwIndex | null> | null = null;
  private v4EsideVidIdxPromise: Promise<PackedIntIndex | null> | null = null;
  private v4EsideBsIdxPromise: Promise<PackedKeyIndex | null> | null = null;
  private v4HregCache = new Map<number, CompactHreg | null>();
  private v4EsideVidCache = new Map<number, { vid: number; records: any[] } | null>();
  private v4EsideBsCache = new Map<string, { bs: string; records: any[] } | null>();
  private utf8Decoder = new TextDecoder('utf-8');

  constructor(reader: AssetReader, hooks?: V3ContextHooks) {
    this.reader = reader;
    this.hooks = hooks ?? (reader as unknown as { __v3Hooks?: V3ContextHooks }).__v3Hooks;
  }

  private async readJsonAsset<T = any>(assetPath: string): Promise<T | null> {
    try {
      const res = await this.reader.readJson(assetPath);
      return (res?.data as T) ?? null;
    } catch {
      return null;
    }
  }

  private async readBinaryAsset(assetPath: string): Promise<Uint8Array | null> {
    if (typeof this.reader.readBinary !== 'function') return null;
    try {
      return await this.reader.readBinary(assetPath);
    } catch {
      return null;
    }
  }

  private async readUncompressedJsonBin<T = any>(assetPath: string): Promise<T | null> {
    if (typeof this.reader.readBinary === 'function') {
      const bytes = await this.readBinaryAsset(assetPath);
      if (!bytes) return null;
      try {
        return JSON.parse(this.utf8Decoder.decode(bytes)) as T;
      } catch {
        return null;
      }
    }
    return this.readJsonAsset<T>(assetPath);
  }

  getBmw(): Promise<BmwIndex | null> {
    if (!this.bmwPromise) {
      this.bmwPromise = (async () => {
        if (this.hooks?.getV3Bmw) {
          const hit = await this.hooks.getV3Bmw();
          if (hit) return hit;
        }
        const bytes = await this.readBinaryAsset('/v3/index/postings-bmw.bin');
        if (!bytes) return null;
        try {
          return parseBmwIndex(bytes);
        } catch {
          return null;
        }
      })();
    }
    return this.bmwPromise;
  }

  getNodes(): Promise<V3NodesData | null> {
    if (!this.nodesPromise) {
      this.nodesPromise = (async () => {
        if (this.hooks?.getV3Nodes) {
          const hit = await this.hooks.getV3Nodes();
          if (hit) return hit;
        }
        const binBytes = await this.readBinaryAsset('/v3/index/nodes.bin');
        if (binBytes) {
          try {
            return wrapBinaryNodesTable(parseNodesBin(binBytes));
          } catch {
            // fallback to legacy json.gz
          }
        }
        return this.readJsonAsset<V3NodesData>('/v3/index/nodes.json.gz');
      })();
    }
    return this.nodesPromise;
  }

  getRhetoricBook(bookId: number): Promise<any | null> {
    if (this.hooks?.getV3RhetoricBook) return this.hooks.getV3RhetoricBook(bookId);
    return this.getRhetoricIndex().then((idx) => idx?.books?.[String(bookId)] ?? null);
  }

  async getVersesBatch(vids: number[]): Promise<Map<number, any>> {
    const uniq = [...new Set(vids.filter((v) => Number.isInteger(v) && v >= 1 && v <= NUM_VERSES))];
    if (uniq.length === 0) return new Map();
    if (this.hooks?.getV3VersesBatch) return this.hooks.getV3VersesBatch(uniq);
    const vals = await Promise.all(uniq.map((v) => this.getVerse(v)));
    const out = new Map<number, any>();
    for (let i = 0; i < uniq.length; i++) if (vals[i]) out.set(uniq[i], vals[i]);
    return out;
  }

  async getProfilesBatch(strongsList: string[]): Promise<Map<string, any>> {
    const uniq = [...new Set(strongsList.map((s) => normStrongs4(s)).filter(Boolean))];
    if (uniq.length === 0) return new Map();
    if (this.hooks?.getV3ProfilesBatch) return this.hooks.getV3ProfilesBatch(uniq);
    const vals = await Promise.all(uniq.map((bs) => this.getProfile(bs)));
    const out = new Map<string, any>();
    for (let i = 0; i < uniq.length; i++) if (vals[i]) out.set(uniq[i], vals[i]);
    return out;
  }

  async getVerseClausesBatch(vids: number[]): Promise<Map<number, any>> {
    const uniq = [...new Set(vids.filter((v) => Number.isInteger(v) && v >= 1 && v <= NUM_VERSES))];
    if (uniq.length === 0) return new Map();
    if (this.hooks?.getV3VerseClausesBatch) return this.hooks.getV3VerseClausesBatch(uniq);
    const vals = await Promise.all(uniq.map((v) => this.getVerseClauses(v)));
    const out = new Map<number, any>();
    for (let i = 0; i < uniq.length; i++) if (vals[i]) out.set(uniq[i], vals[i]);
    return out;
  }

  async getMtLxxBatch(vids: number[]): Promise<Map<number, any>> {
    const uniq = [...new Set(vids.filter((v) => Number.isInteger(v) && v >= 1 && v <= NUM_VERSES))];
    if (uniq.length === 0) return new Map();
    if (this.hooks?.getV3MtLxxBatch) return this.hooks.getV3MtLxxBatch(uniq);
    const vals = await Promise.all(uniq.map((v) => this.getMtLxx(v)));
    const out = new Map<number, any>();
    for (let i = 0; i < uniq.length; i++) if (vals[i]) out.set(uniq[i], vals[i]);
    return out;
  }

  getRhetoricIndex(): Promise<any | null> {
    if (!this.rhetoricIdxPromise) {
      this.rhetoricIdxPromise = (async () => {
        if (this.hooks?.getV3RhetoricIndex) {
          const hit = await this.hooks.getV3RhetoricIndex();
          if (hit) return hit;
        }
        return this.readJsonAsset('/v3/rhetoric/rhetoric-index.json.gz');
      })();
    }
    return this.rhetoricIdxPromise;
  }

  getOnomastic(): Promise<any | null> {
    if (!this.onomasticPromise) {
      this.onomasticPromise = (async () => {
        if (this.hooks?.getV3Onomastic) {
          const hit = await this.hooks.getV3Onomastic();
          if (hit) return hit;
        }
        return this.readJsonAsset('/v3/rhetoric/onomastic-lexicon.json');
      })();
    }
    return this.onomasticPromise;
  }

  getPprShard(shardId: number): Promise<PprShard | null> {
    const id = shardId & 31;
    let p = this.pprPromises.get(id);
    if (!p) {
      p = (async () => {
        if (this.hooks?.getV3PprShard) {
          const hit = await this.hooks.getV3PprShard(id);
          if (hit) return hit;
        }
        const bytes = await this.readBinaryAsset(`/v3/graph/ppr-top64/shard-${String(id).padStart(2, '0')}.bin`);
        if (!bytes) return null;
        try {
          return parsePprShard(bytes);
        } catch {
          return null;
        }
      })();
      this.pprPromises.set(id, p);
    }
    return p;
  }

  getCsrPart(partId: number): Promise<CsrPart | null> {
    const id = partId & 15;
    let p = this.csrPromises.get(id);
    if (!p) {
      p = (async () => {
        if (this.hooks?.getV3CsrPart) {
          const hit = await this.hooks.getV3CsrPart(id);
          if (hit) return hit;
        }
        const bytes = await this.readBinaryAsset(`/v3/graph/typed-csr/part-${String(id).padStart(2, '0')}.bin`);
        if (!bytes) return null;
        try {
          return parseCsrPart(bytes);
        } catch {
          return null;
        }
      })();
      this.csrPromises.set(id, p);
    }
    return p;
  }

  async lookupPpr(nodeId: number): Promise<PprEntry[]> {
    const shard = await this.getPprShard(nodeId & 31);
    return shard ? lookupPprTop64(shard, nodeId) : [];
  }

  async lookupCsr(nodeId: number): Promise<CsrEdge[]> {
    const part = await this.getCsrPart(nodeId & 15);
    return part ? lookupCsrEdges(part, nodeId) : [];
  }

  async preloadPprShards(nodeIds: number[], maxShards = 8): Promise<Map<number, PprShard>> {
    const seen = new Set<number>();
    const shardIds: number[] = [];
    for (const id of nodeIds) {
      if (!(id > 0)) continue;
      const sid = id & 31;
      if (seen.has(sid)) continue;
      seen.add(sid);
      shardIds.push(sid);
      if (shardIds.length >= maxShards) break;
    }
    const loaded = await Promise.all(shardIds.map((sid) => this.getPprShard(sid)));
    const map = new Map<number, PprShard>();
    for (let i = 0; i < shardIds.length; i++) {
      if (loaded[i]) map.set(shardIds[i], loaded[i]!);
    }
    return map;
  }

  async getProfile(rawBs: string): Promise<any | null> {
    const bs = normStrongs4(rawBs);
    if (!bs) return null;
    if (this.hooks?.getV3Profile) return this.hooks.getV3Profile(bs);
    const sid = v3ProfileShardId(bs);
    let p = this.profilePromises.get(sid);
    if (!p) {
      p = (async () => {
        if (this.hooks?.getV3ProfileShard) {
          const hit = await this.hooks.getV3ProfileShard(sid);
          if (hit) return hit;
        }
        return this.readJsonAsset(`/v3/profiles/shard-${String(sid).padStart(2, '0')}.json.gz`);
      })();
      this.profilePromises.set(sid, p);
    }
    const shard = await p;
    return shard?.profiles?.[bs] ?? null;
  }

  async getVerse(vid: number): Promise<any | null> {
    if (!Number.isInteger(vid) || vid < 1 || vid > NUM_VERSES) return null;
    if (this.hooks?.getV3Verse) return this.hooks.getV3Verse(vid);
    const cid = v3VerseChunkId(vid);
    let p = this.versePromises.get(cid);
    if (!p) {
      p = (async () => {
        if (this.hooks?.getV3VerseChunk) {
          const hit = await this.hooks.getV3VerseChunk(cid);
          if (hit) return hit;
        }
        return this.readJsonAsset(`/v3/verses/chunk-${String(cid).padStart(2, '0')}.json.gz`);
      })();
      this.versePromises.set(cid, p);
    }
    const chunk = await p;
    return chunk?.verses?.[String(vid)] ?? null;
  }

  async getVerseClauses(vid: number): Promise<any | null> {
    if (!Number.isInteger(vid) || vid < 1 || vid > NUM_VERSES) return null;
    if (this.hooks?.getV3VerseClauses) return this.hooks.getV3VerseClauses(vid);
    const sid = v3ClauseShardId(vid);
    let p = this.clausePromises.get(sid);
    if (!p) {
      p = (async () => {
        const data = this.hooks?.getV3ClauseShard
          ? await this.hooks.getV3ClauseShard(sid)
          : await this.readJsonAsset(`/v3/rhetoric/clauses-${String(sid).padStart(2, '0')}.json.gz`);
        if (data && Array.isArray(data.verses) && !data._byVid) {
          const byVid = new Map<number, any>();
          for (const v of data.verses) {
            if (v?.vid) byVid.set(Number(v.vid), v);
          }
          data._byVid = byVid;
        }
        return data ?? null;
      })();
      this.clausePromises.set(sid, p);
    }
    const shard = await p;
    return shard?._byVid?.get(vid) ?? null;
  }

  async getMtLxx(vid: number): Promise<any | null> {
    if (!Number.isInteger(vid) || vid < 1 || vid > NUM_VERSES) return null;
    if (this.hooks?.getV3MtLxx) return this.hooks.getV3MtLxx(vid);
    const sid = v3MtLxxShardId(vid);
    let p = this.mtLxxPromises.get(sid);
    if (!p) {
      p = (async () => {
        if (this.hooks?.getV3MtLxxShard) {
          const hit = await this.hooks.getV3MtLxxShard(sid);
          if (hit) return hit;
        }
        return this.readUncompressedJsonBin(`/v3/align/mt-lxx-${String(sid).padStart(2, '0')}.bin`);
      })();
      this.mtLxxPromises.set(sid, p);
    }
    const shard = await p;
    return shard?.verses?.[String(vid)] ?? null;
  }

  async getRahlfsConcordance(lemma: string): Promise<any | null> {
    const clean = String(lemma || '').normalize('NFC').trim();
    if (!clean) return null;
    if (this.hooks?.getV3RahlfsConcordance) return this.hooks.getV3RahlfsConcordance(clean);
    const sid = v3RahlfsShardId(clean);
    let p = this.rahlfsPromises.get(sid);
    if (!p) {
      p = (async () => {
        if (this.hooks?.getV3RahlfsShard) {
          const hit = await this.hooks.getV3RahlfsShard(sid);
          if (hit) return hit;
        }
        return this.readUncompressedJsonBin(`/v3/align/rahlfs-concordance-${String(sid).padStart(2, '0')}.bin`);
      })();
      this.rahlfsPromises.set(sid, p);
    }
    const shard = await p;
    return shard?.lemmas?.[clean] ?? null;
  }

  private async gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
    if (bytes.byteLength < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
    if (typeof DecompressionStream === 'function') {
      const ds = new DecompressionStream('gzip');
      const ab = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(ab);
    }
    return bytes;
  }

  getV4Pericopes(): Promise<PericopeTable | null> {
    if (!this.v4PericopePromise) {
      this.v4PericopePromise = (async () => {
        if (this.hooks?.getV4Pericopes) {
          const hit = await this.hooks.getV4Pericopes();
          if (hit) return hit;
        }
        const [pBytes, vBytes] = await Promise.all([
          this.readBinaryAsset('/v4/index/pericopes.bin'),
          this.readBinaryAsset('/v4/index/vid-to-pericopes.bin'),
        ]);
        if (!pBytes || !vBytes) return null;
        try {
          return parsePericopeTable(pBytes, vBytes);
        } catch {
          return null;
        }
      })();
    }
    return this.v4PericopePromise;
  }

  getV4PredSim(): Promise<PredicateSimOracle | null> {
    if (!this.v4PredSimPromise) {
      this.v4PredSimPromise = (async () => {
        if (this.hooks?.getV4PredSim) {
          const hit = await this.hooks.getV4PredSim();
          if (hit) return hit;
        }
        const bytes = await this.readBinaryAsset('/v4/index/pred-sim.bin');
        if (!bytes) return null;
        try {
          return parsePredSimTable(bytes);
        } catch {
          return null;
        }
      })();
    }
    return this.v4PredSimPromise;
  }

  getV4Rmac(): Promise<RmacBmwIndex | null> {
    if (!this.v4RmacPromise) {
      this.v4RmacPromise = (async () => {
        if (this.hooks?.getV4Rmac) {
          const hit = await this.hooks.getV4Rmac();
          if (hit) return hit;
        }
        const bytes = await this.readBinaryAsset('/v4/index/rmac-bmw.bin');
        if (!bytes) return null;
        try {
          return parseRmacBmwIndex(bytes);
        } catch {
          return null;
        }
      })();
    }
    return this.v4RmacPromise;
  }

  async getV4Hreg(pericopeId: number): Promise<CompactHreg | null> {
    if (!(pericopeId > 0)) return null;
    if (this.v4HregCache.has(pericopeId)) return this.v4HregCache.get(pericopeId) ?? null;
    if (this.hooks?.getV4Hreg) {
      const h = await this.hooks.getV4Hreg(pericopeId);
      this.v4HregCache.set(pericopeId, h);
      return h;
    }
    const batch = await this.getV4HregBatch([pericopeId]);
    return batch.get(pericopeId) ?? null;
  }

  async getV4HregBatch(pericopeIds: number[]): Promise<Map<number, CompactHreg | null>> {
    const uniq = [...new Set((pericopeIds || []).filter((id) => Number.isInteger(id) && id > 0))];
    const out = new Map<number, CompactHreg | null>();
    if (uniq.length === 0) return out;
    const missing: number[] = [];
    for (const id of uniq) {
      if (this.v4HregCache.has(id)) out.set(id, this.v4HregCache.get(id) ?? null);
      else missing.push(id);
    }
    if (missing.length === 0) return out;
    if (this.hooks?.getV4HregBatch) {
      const res = await this.hooks.getV4HregBatch(missing);
      for (const [id, val] of res.entries()) {
        this.v4HregCache.set(id, val ?? null);
        out.set(id, val ?? null);
      }
      return out;
    }
    const perTable = await this.getV4Pericopes();
    if (!perTable) return out;
    const byPack = new Map<number, Array<{ id: number; off: number; len: number }>>();
    for (const id of missing) {
      const meta = perTable.records[id - 1];
      if (!meta) {
        this.v4HregCache.set(id, null);
        out.set(id, null);
        continue;
      }
      let arr = byPack.get(meta.packFile);
      if (!arr) { arr = []; byPack.set(meta.packFile, arr); }
      arr.push({ id, off: meta.byteOff, len: meta.byteLen });
    }
    for (const [packFile, items] of byPack.entries()) {
      items.sort((a, b) => a.off - b.off);
      const packPath = `/v4/hreg/pack-${String(packFile).padStart(2, '0')}.bin`;
      let packBytes: Uint8Array | null = null;
      if (items.length <= 6 && typeof this.reader.readBinary === 'function') {
        for (const it of items) {
          const slice = await this.readBinaryAsset(`${packPath}#bytes=${it.off}-${it.off + it.len - 1}`);
          if (!slice) { out.set(it.id, null); continue; }
          try {
            const plain = await this.gunzipBytes(slice);
            const hreg = decodeCompactHreg(plain);
            this.v4HregCache.set(it.id, hreg);
            out.set(it.id, hreg);
          } catch {
            out.set(it.id, null);
          }
        }
        continue;
      }
      packBytes = await this.readBinaryAsset(packPath);
      if (!packBytes) continue;
      for (const it of items) {
        try {
          const plain = await this.gunzipBytes(packBytes.subarray(it.off, it.off + it.len));
          const hreg = decodeCompactHreg(plain);
          this.v4HregCache.set(it.id, hreg);
          out.set(it.id, hreg);
        } catch {
          out.set(it.id, null);
        }
      }
    }
    return out;
  }

  private getV4EsideVidIdx(): Promise<PackedIntIndex | null> {
    if (!this.v4EsideVidIdxPromise) {
      this.v4EsideVidIdxPromise = this.readBinaryAsset('/v4/eside/eside-vid.idx').then((b) =>
        b ? parsePackedIntIndex(b) : null,
      ).catch(() => null);
    }
    return this.v4EsideVidIdxPromise;
  }

  private getV4EsideBsIdx(): Promise<PackedKeyIndex | null> {
    if (!this.v4EsideBsIdxPromise) {
      this.v4EsideBsIdxPromise = this.readBinaryAsset('/v4/eside/eside-bs.idx').then((b) =>
        b ? parsePackedKeyIndex(b) : null,
      ).catch(() => null);
    }
    return this.v4EsideBsIdxPromise;
  }

  async getV4EsideVid(vid: number): Promise<{ vid: number; records: any[] } | null> {
    if (!(vid >= 1 && vid <= NUM_VERSES)) return null;
    if (this.v4EsideVidCache.has(vid)) return this.v4EsideVidCache.get(vid) ?? null;
    if (this.hooks?.getV4EsideVid) {
      const r = await this.hooks.getV4EsideVid(vid);
      this.v4EsideVidCache.set(vid, r ?? null);
      return r ?? null;
    }
    const batch = await this.getV4EsideVidBatch([vid]);
    return batch.get(vid) ?? null;
  }

  async getV4EsideVidBatch(vids: number[]): Promise<Map<number, { vid: number; records: any[] } | null>> {
    const uniq = [...new Set((vids || []).filter((v) => Number.isInteger(v) && v >= 1 && v <= NUM_VERSES))];
    const out = new Map<number, { vid: number; records: any[] } | null>();
    if (uniq.length === 0) return out;
    const missing: number[] = [];
    for (const v of uniq) {
      if (this.v4EsideVidCache.has(v)) out.set(v, this.v4EsideVidCache.get(v) ?? null);
      else missing.push(v);
    }
    if (missing.length === 0) return out;
    if (this.hooks?.getV4EsideVidBatch) {
      const res = await this.hooks.getV4EsideVidBatch(missing);
      for (const [v, val] of res.entries()) {
        this.v4EsideVidCache.set(v, val ?? null);
        out.set(v, val ?? null);
      }
      return out;
    }
    const idx = await this.getV4EsideVidIdx();
    if (!idx) return out;
    const spans = coalescePackedRanges(idx, missing);
    for (const span of spans) {
      const packPath = `/v4/eside/pack-${String(span.fileIdx).padStart(2, '0')}.bin#bytes=${span.start}-${span.end}`;
      const raw = await this.readBinaryAsset(packPath);
      if (!raw) continue;
      for (const it of span.items) {
        try {
          const plain = await this.gunzipBytes(raw.subarray(it.relStart, it.relStart + it.length));
          const parsed = JSON.parse(this.utf8Decoder.decode(plain));
          this.v4EsideVidCache.set(it.id, parsed);
          out.set(it.id, parsed);
        } catch {
          this.v4EsideVidCache.set(it.id, null);
          out.set(it.id, null);
        }
      }
    }
    return out;
  }

  async getV4EsideBs(rawBs: string): Promise<{ bs: string; records: any[] } | null> {
    const bs = normStrongs4(rawBs) || String(rawBs || '').trim();
    if (!bs) return null;
    if (this.v4EsideBsCache.has(bs)) return this.v4EsideBsCache.get(bs) ?? null;
    if (this.hooks?.getV4EsideBs) {
      const r = await this.hooks.getV4EsideBs(bs);
      this.v4EsideBsCache.set(bs, r ?? null);
      return r ?? null;
    }
    const idx = await this.getV4EsideBsIdx();
    if (!idx) return null;
    const loc = lookupPackedKey(idx, bs);
    if (!loc) {
      this.v4EsideBsCache.set(bs, null);
      return null;
    }
    const raw = await this.readBinaryAsset(`/v4/eside/pack-${String(loc.fileIdx).padStart(2, '0')}.bin#bytes=${loc.start}-${loc.start + loc.length - 1}`);
    if (!raw) return null;
    try {
      const plain = await this.gunzipBytes(raw);
      const parsed = JSON.parse(this.utf8Decoder.decode(plain));
      this.v4EsideBsCache.set(bs, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  resolveNodeKey(nodes: V3NodesData, nodeId: number): string | null {
    if (nodeId >= 1 && nodeId <= nodes.num_verses) return `V:${nodeId}`;
    const idx = nodeId - nodes.entity_offset;
    return idx >= 0 && idx < nodes.id_to_key.length ? nodes.id_to_key[idx] : null;
  }

  buildNodeMetaLookup(nodes: V3NodesData): (nodeId: number) => NodeAxisMeta | null {
    const offset = nodes.entity_offset;
    const metaArr = nodes.node_meta;
    const numVerses = nodes.num_verses || NUM_VERSES;
    let entityCache = NODE_ENTITY_META_CACHE.get(nodes);
    if (!entityCache) {
      entityCache = new Array<NodeAxisMeta | null | undefined>(metaArr.length);
      NODE_ENTITY_META_CACHE.set(nodes, entityCache);
    }
    const verseP0 = 1 / numVerses;
    return (nodeId: number): NodeAxisMeta | null => {
      if (nodeId >= 1 && nodeId <= numVerses) {
        let vm = VERSE_META_CACHE.get(nodeId);
        if (!vm) {
          vm = {
            axisKey: `VERSE:${nodeId}`,
            nullP0: verseP0,
            df: 1,
            isPhysical: false,
            isExplicitCue: false,
            register: 'TEXTUAL_WITNESS',
          };
          if (VERSE_META_CACHE.size < 8192) VERSE_META_CACHE.set(nodeId, vm);
        }
        return vm;
      }
      const idx = nodeId - offset;
      if (idx < 0 || idx >= metaArr.length) return null;
      const cached = entityCache[idx];
      if (cached !== undefined) return cached;
      const t = metaArr[idx];
      if (!t) {
        entityCache[idx] = null;
        return null;
      }
      const df = Math.max(1, Number(t[1]) || 1);
      const isPhysical = Boolean(t[2]);
      const meta: NodeAxisMeta = {
        axisKey: String(t[0] || `NODE:${nodeId}`),
        nullP0: Math.max(1e-7, df / numVerses),
        df,
        isPhysical,
        cohyponymGroup: t[3] ? String(t[3]) : undefined,
        isExplicitCue: Boolean(t[4]),
        register: isPhysical ? 'PHYSICAL_ANALOGICAL' : 'LINGUISTIC_GRAMMATICAL',
      };
      entityCache[idx] = meta;
      return meta;
    };
  }
}

export async function scoreV3EPerpPair(
  session: V3RuntimeSession,
  anchorVids: number[],
  anchorStrongs: string[],
  candVids: number[],
  candStrongs: string[],
  extras: { deltaSeqBits?: number; delta3WayBits?: number; deltaWordplayBits?: number; cLen?: number } = {},
): Promise<EPerpScoreResult | null> {
  const nodes = await session.getNodes();
  if (!nodes) return null;

  const toTerms = (strongsList: string[]): PassagePprAnchorTerm[] => {
    const out: PassagePprAnchorTerm[] = [];
    const seen = new Set<number>();
    for (const raw of strongsList) {
      const bs = normStrongs4(raw);
      if (!bs) continue;
      const nid = nodes.key_to_id[bs];
      if (!nid || seen.has(nid)) continue;
      seen.add(nid);
      const meta = nodes.node_meta[nid - nodes.entity_offset];
      const df = Math.max(1, Number(meta?.[1]) || 10);
      const idf = Math.max(0.25, Math.log2(NUM_VERSES / df));
      out.push({
        nodeId: nid,
        idf,
        axisKey: String(meta?.[0] || `LEMMA:${bs}`),
        ...(meta?.[3] ? { cohyponymGroup: String(meta[3]) } : {}),
      });
    }
    return out;
  };

  const termsA = toTerms(anchorStrongs);
  const termsB = toTerms(candStrongs);
  const allSeedIds = [...anchorVids, ...candVids, ...termsA.map((t) => t.nodeId), ...termsB.map((t) => t.nodeId)];
  const pprShards = await session.preloadPprShards(allSeedIds);
  const pprLookup = (seedId: number): PprEntry[] => {
    const sh = pprShards.get(seedId & 31);
    return sh ? lookupPprTop64(sh, seedId) : [];
  };

  const distA: PassagePprDistribution = reconstructPassagePpr(anchorVids, termsA, pprLookup, [], {
    tokenCount: Math.max(4, anchorVids.length * 10, termsA.length * 3),
  });
  const distB: PassagePprDistribution = reconstructPassagePpr(candVids, termsB, pprLookup, [], {
    tokenCount: Math.max(4, candVids.length * 10, termsB.length * 3),
  });

  const getNodeMeta = session.buildNodeMetaLookup(nodes);
  return computeEPerpScore(distA, distB, getNodeMeta, extras);
}

export async function findV3BridgePivots(
  session: V3RuntimeSession,
  anchorGroups: Array<{ vids: number[]; strongs: string[] }>,
  limit = 8,
): Promise<PivotRankedResult[]> {
  if (anchorGroups.length < 2) return [];
  const nodes = await session.getNodes();
  if (!nodes) return [];
  const getNodeMeta = session.buildNodeMetaLookup(nodes);

  const seedIds: number[] = [];
  const anchorInputs = anchorGroups.map((g) => {
    const terms: PassagePprAnchorTerm[] = [];
    for (const raw of g.strongs) {
      const bs = normStrongs4(raw);
      const nid = bs ? nodes.key_to_id[bs] : undefined;
      if (!nid) continue;
      seedIds.push(nid);
      const meta = nodes.node_meta[nid - nodes.entity_offset];
      const df = Math.max(1, Number(meta?.[1]) || 10);
      terms.push({
        nodeId: nid,
        idf: Math.max(0.25, Math.log2(NUM_VERSES / df)),
        axisKey: String(meta?.[0] || `LEMMA:${bs}`),
      });
    }
    for (const vid of g.vids) seedIds.push(vid);
    return { vids: g.vids, terms };
  });

  const pprShards = await session.preloadPprShards(seedIds);
  const pprLookup = (seedId: number): PprEntry[] => {
    const sh = pprShards.get(seedId & 31);
    return sh ? lookupPprTop64(sh, seedId) : [];
  };

  const dists = anchorInputs.map((a) => reconstructPassagePpr(a.vids, a.terms, pprLookup));
  const anchorVidSets = anchorInputs.map((a) => new Set(a.vids));

  // Intersect candidate verse/entity nodes present in >= 2 anchor PPR distributions (excluding direct anchors & high-df hubs)
  const candidateNodes = new Map<number, { masses: number[]; axes: Set<string>; rarity: number }>();
  for (let i = 0; i < dists.length; i++) {
    for (const [nid, mass] of dists[i].mass.entries()) {
      if (mass < 0.001) continue;
      if (nid >= 1 && nid <= NUM_VERSES && anchorVidSets.some((s) => s.has(nid))) continue;
      const meta = getNodeMeta(nid);
      if (meta && meta.df > 450) continue;
      let rec = candidateNodes.get(nid);
      if (!rec) {
        rec = {
          masses: new Array(dists.length).fill(0),
          axes: new Set<string>(),
          rarity: meta ? Math.max(0.5, Math.log2(NUM_VERSES / Math.max(1, meta.df)) / 3) : 2.5,
        };
        candidateNodes.set(nid, rec);
      }
      rec.masses[i] = mass;
      if (meta) rec.axes.add(meta.axisKey);
    }
  }

  // Only keep verse pivots (1..NUM_VERSES) that carry non-zero mass across all anchors
  const pivotInputs: PivotCandidateInput[] = [];
  for (const [nid, rec] of candidateNodes.entries()) {
    if (nid > NUM_VERSES) continue;
    if (rec.masses.some((m) => m <= 0)) continue;
    // Collect bridged axes from CSR neighbors of this verse
    const csr = await session.lookupCsr(nid);
    for (const e of csr) {
      if (e.partition === 5) continue;
      const eMeta = getNodeMeta(e.toNodeId);
      if (eMeta && eMeta.df <= 450) rec.axes.add(eMeta.axisKey);
    }
    pivotInputs.push({
      vid: nid,
      anchorMasses: rec.masses,
      bridgedAxes: [...rec.axes],
      rarityGain: rec.rarity,
    });
  }

  const ranked = rankBridgePivots(pivotInputs, limit);
  // Hydrate refs for returned pivot verses
  for (const r of ranked) {
    const v = await session.getVerse(r.vid);
    if (v?.ref) r.ref = v.ref;
  }
  return ranked;
}

const CLAUSE_SIGS_CACHE = new WeakMap<object, ClauseSig[]>();

export function buildClauseSigsFromV3Verse(clauseVerse: any): ClauseSig[] {
  if (!clauseVerse || !Array.isArray(clauseVerse.clauses)) return [];
  const cached = CLAUSE_SIGS_CACHE.get(clauseVerse);
  if (cached) return cached;
  const toks: any[] = Array.isArray(clauseVerse.tokens) ? clauseVerse.tokens : [];
  const tokByLk = new Map<string, any>();
  for (const t of toks) {
    if (t?.lk && !tokByLk.has(t.lk)) tokByLk.set(t.lk, t);
  }

  const out: ClauseSig[] = clauseVerse.clauses.map((cl: any) => {
    const concepts = new Set<string>();
    if (cl.predicate?.concept_id) concepts.add(String(cl.predicate.concept_id));
    for (const cid of cl.concept_ids || []) {
      if (cid) concepts.add(String(cid));
    }

    const roles: Array<{ role: string; concept: string }> = [];
    if (cl.predicate?.concept_id) {
      roles.push({ role: 'Pred', concept: String(cl.predicate.concept_id) });
    }
    for (const slk of cl.subjects || []) {
      const c = tokByLk.get(slk)?.concept_id || slk;
      if (c) roles.push({ role: 'Subj', concept: String(c) });
    }
    for (const olk of cl.objects || []) {
      const c = tokByLk.get(olk)?.concept_id || olk;
      if (c) roles.push({ role: 'Obj', concept: String(c) });
    }

    return {
      id: String(cl.clause_id || `cl:${clauseVerse.vid}`),
      vid: Number(clauseVerse.vid),
      ref: clauseVerse.ref,
      concepts: [...concepts],
      roles,
      polarity: cl.polarity === 'negative' || (Array.isArray(cl.neg_markers) && cl.neg_markers.length > 0) ? 'NEG' : 'POS',
    };
  });
  CLAUSE_SIGS_CACHE.set(clauseVerse, out);
  return out;
}

const NT_TOKENS_CACHE = new WeakMap<object, NtToken[]>();
const REPAIRED_TOKS_CACHE = new WeakMap<object, any[]>();

/**
 * Repair off-by-1 NT surface vs lemma/Strong's pairing caused when SBLGNT omits a
 * bracketed variant word (e.g., 1 Peter 5:2 ἐπισκοποῦντες) while TAGNT keeps it.
 * Also guards H7462 lemma hygiene.
 */
export function repairV3VerseToks(verseObj: any): any[] {
  if (!verseObj || !Array.isArray(verseObj.toks)) return [];
  const cached = REPAIRED_TOKS_CACHE.get(verseObj);
  if (cached) return cached;
  const toks = verseObj.toks as any[];
  const isNt = Number(verseObj.book || 0) >= 40 || Number(verseObj.vid || 0) >= 23214;

  if (!isNt || toks.length === 0) {
    const out = toks.map((t) => {
      const s = normStrongs4(t.s) || String(t.s || '');
      const lm = sanitizeV3TokenLemma(s, String(t.lm || ''));
      return lm !== t.lm ? { ...t, lm } : t;
    });
    REPAIRED_TOKS_CACHE.set(verseObj, out);
    return out;
  }

  // First fix local 2-token adjacent transpositions cleanly (e.g. 1 Pet 2:6 ἐκλεκτὸν / ἀκρογωνιαῖον same-POS swap)
  let workToks = toks;
  let swappedAny = false;
  for (let i = 0; i + 1 < workToks.length; i++) {
    const t = workToks[i];
    const n = workToks[i + 1];
    const diag =
      scoreGreekSfLmPair(String(t.sf || ''), String(t.cl || ''), String(t.lm || ''), String(t.gc || '')) +
      scoreGreekSfLmPair(String(n.sf || ''), String(n.cl || ''), String(n.lm || ''), String(n.gc || ''));
    const flipped =
      scoreGreekSfLmPair(String(t.sf || ''), String(t.cl || ''), String(n.lm || ''), String(n.gc || '')) +
      scoreGreekSfLmPair(String(n.sf || ''), String(n.cl || ''), String(t.lm || ''), String(t.gc || ''));
    if (flipped >= diag + 4) {
      if (!swappedAny) workToks = [...toks];
      swappedAny = true;
      workToks[i] = {
        ...t,
        wid: n.wid, lm: n.lm, s: n.s, lk: n.lk, gc: n.gc,
        sense_id: n.sense_id, concept_id: n.concept_id, is_func: n.is_func,
      };
      workToks[i + 1] = {
        ...n,
        wid: t.wid, lm: t.lm, s: t.s, lk: t.lk, gc: t.gc,
        sense_id: t.sense_id, concept_id: t.concept_id, is_func: t.is_func,
      };
      i++;
    }
  }

  let hasShift = false;
  for (let i = 0; i < workToks.length; i++) {
    const t = workToks[i];
    if (scoreGreekSfLmPair(String(t.sf || ''), String(t.cl || ''), String(t.lm || ''), String(t.gc || '')) < 0) {
      hasShift = true;
      break;
    }
  }
  if (!hasShift) {
    REPAIRED_TOKS_CACHE.set(verseObj, workToks);
    return workToks;
  }

  const n = workToks.length;
  const NEG_INF = -1e6;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(n + 1).fill(NEG_INF));
  const choice = Array.from({ length: n + 1 }, () => new Uint8Array(n + 1)); // 1=pair(i,j), 2=skip sf[i], 3=skip lm[j]
  dp[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    dp[i][0] = dp[i - 1][0] - 2.0;
    choice[i][0] = 2;
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = dp[0][j - 1] - 1.5;
    choice[0][j] = 3;
  }
  for (let i = 1; i <= n; i++) {
    const sfTok = workToks[i - 1];
    for (let j = 1; j <= n; j++) {
      const lmTok = workToks[j - 1];
      const sc = scoreGreekSfLmPair(String(sfTok.sf || ''), String(sfTok.cl || ''), String(lmTok.lm || ''), String(lmTok.gc || ''));
      const pScore = dp[i - 1][j - 1] + (sc < 0 ? sc - 2 : sc);
      const skipSf = dp[i - 1][j] - 2.0;
      const skipLm = dp[i][j - 1] - 1.5;
      let best = pScore;
      let ch = 1;
      if (skipSf > best) { best = skipSf; ch = 2; }
      if (skipLm > best) { best = skipLm; ch = 3; }
      dp[i][j] = best;
      choice[i][j] = ch;
    }
  }

  const pairedLmIdx = new Int32Array(n).fill(-1);
  let i = n;
  let j = n;
  while (i > 0 || j > 0) {
    const ch = choice[i][j];
    if (ch === 1 && i > 0 && j > 0) {
      const sfTok = workToks[i - 1];
      const lmTok = workToks[j - 1];
      const sc = scoreGreekSfLmPair(String(sfTok.sf || ''), String(sfTok.cl || ''), String(lmTok.lm || ''), String(lmTok.gc || ''));
      if (sc >= 0) pairedLmIdx[i - 1] = j - 1;
      i--;
      j--;
    } else if (ch === 2 && i > 0) {
      i--;
    } else if (j > 0) {
      j--;
    } else {
      i--;
    }
  }

  const out = workToks.map((t, idx) => {
    const mj = pairedLmIdx[idx];
    if (mj === idx) return t;
    if (mj >= 0) {
      const src = workToks[mj];
      return {
        ...t,
        wid: src.wid,
        lm: src.lm,
        s: src.s,
        lk: src.lk,
        gc: src.gc,
        sense_id: src.sense_id,
        concept_id: src.concept_id,
        is_func: src.is_func,
      };
    }
    const clLow = String(t.cl || '').toLowerCase();
    return {
      ...t,
      lm: String(t.sf || ''),
      s: undefined,
      lk: undefined,
      gc: undefined,
      is_func: GREEK_FUNC_POS.has(clLow),
    };
  });
  REPAIRED_TOKS_CACHE.set(verseObj, out);
  return out;
}

export function buildNtTokensFromV3Verse(verseObj: any): NtToken[] {
  if (!verseObj || !Array.isArray(verseObj.toks)) return [];
  const cached = NT_TOKENS_CACHE.get(verseObj);
  if (cached) return cached;
  const repaired = repairV3VerseToks(verseObj);
  const out: NtToken[] = repaired.map((t: any, i: number) => {
    const strongs = t.s ? normStrongs4(t.s) : '';
    const lemma = String(t.lm || t.sf || '');
    const isCopula = Boolean(strongs && GREEK_COPULA_STRONGS.has(strongs)) || stripGreekPlainV3(lemma) === 'ειμι';
    return {
      idx: typeof t.idx === 'number' ? t.idx : i,
      surface: String(t.sf || ''),
      lemma,
      ...(strongs ? { strongs } : {}),
      isFunction: isCopula || Boolean(t.is_func || GREEK_FUNC_POS.has(String(t.cl || '').toLowerCase())),
    };
  });
  NT_TOKENS_CACHE.set(verseObj, out);
  return out;
}

const OT_CANDIDATE_CACHE = new WeakMap<object, OtLxxCandidateGroup>();
const OT_CANDIDATE_LIGHT_CACHE = new WeakMap<object, OtLxxCandidateGroup>();

export async function buildOtCandidateFromV3(
  session: V3RuntimeSession,
  otVid: number,
  nodes: V3NodesData | null,
  bmw?: BmwIndex | null,
  opts?: { loadProfiles?: boolean; maxProfiles?: number },
): Promise<OtLxxCandidateGroup | null> {
  const loadProfiles = opts?.loadProfiles !== false;
  const maxProfiles = opts?.maxProfiles ?? 8;
  const mtLxx = await session.getMtLxx(otVid);
  if (!mtLxx || !Array.isArray(mtLxx.grk_tokens) || mtLxx.grk_tokens.length === 0) {
    return null;
  }
  const cached = OT_CANDIDATE_CACHE.get(mtLxx);
  if (cached) return cached;
  if (!loadProfiles) {
    const lightCached = OT_CANDIDATE_LIGHT_CACHE.get(mtLxx);
    if (lightCached) return lightCached;
  }
  const otVerse = await session.getVerse(otVid);

  const linkByG = new Map<number, any>();
  for (const l of mtLxx.links || []) {
    const prev = linkByG.get(l.g);
    if (!prev || (l.stability ?? 0) > (prev.stability ?? 0)) {
      linkByG.set(l.g, l);
    }
  }
  const shiftByG = new Map<number, any>();
  for (const sh of mtLxx.shifts || []) {
    if (typeof sh.g === 'number') shiftByG.set(sh.g, sh);
    else if (typeof sh.g_start === 'number' && typeof sh.g_end === 'number') {
      for (let gi = sh.g_start; gi <= sh.g_end; gi++) shiftByG.set(gi, sh);
    }
  }

  // Load Hebrew equivalent lemmas from v3/profiles only when requested (bounded content tokens)
  const equivByHeb = new Map<string, string[]>();
  if (loadProfiles && maxProfiles > 0) {
    const uniqueHebBs = [...new Set(
      (mtLxx.links || [])
        .filter((l: any) => !otVerse?.toks?.[l.h]?.is_func)
        .map((l: any) => normStrongs4(l.h_bs))
        .filter(Boolean) as string[],
    )].slice(0, maxProfiles);
    const hebProfs = await Promise.all(uniqueHebBs.map((bs) => session.getProfile(bs)));
    for (let i = 0; i < uniqueHebBs.length; i++) {
      const prof = hebProfs[i];
      if (prof?.lxx_equivalents?.length) {
        equivByHeb.set(
          uniqueHebBs[i],
          prof.lxx_equivalents.slice(0, 6).map((e: any) => String(e.g_lemma || '')).filter(Boolean),
        );
      }
    }
  }

  const slots: OtAlignedSlot[] = mtLxx.grk_tokens.map((gt: any, gi: number) => {
    const lemma = String(gt.l || gt.s || '').normalize('NFC');
    const isFunction = GREEK_FUNC_POS.has(String(gt.p || '').toLowerCase()) || stripGreekPlainV3(lemma) === 'ειμι';
    let lxxIdf = isFunction ? 0.6 : 3.2;
    if (nodes) {
      const nid = nodes.key_to_id[`lxx:${lemma}`];
      if (nid) {
        const meta = nodes.node_meta[nid - nodes.entity_offset];
        if (meta && meta[1] > 0) {
          lxxIdf = Math.max(0.5, Math.min(9.5, Math.log2(NUM_VERSES / meta[1])));
        }
      }
    } else if (bmw) {
      const term = lookupTerm(bmw, `lxx:${lemma}`);
      if (term && term.df > 0) {
        lxxIdf = Math.max(0.5, Math.min(9.5, Math.log2(NUM_VERSES / term.df)));
      }
    }
    const lnk = linkByG.get(gi);
    const hBs = lnk ? normStrongs4(lnk.h_bs) : '';
    const hTok = lnk && otVerse?.toks?.[lnk.h] ? otVerse.toks[lnk.h] : null;
    const sh = shiftByG.get(gi);
    const divKind = sh?.type === 'pronoun_person_shift' || sh?.type === 'lexical_theological_shift' || sh?.type === 'lxx_plus_expansion'
      ? sh.type
      : null;
    return {
      lxxIdx: gi,
      lxxSurface: String(gt.s || ''),
      lxxLemma: lemma,
      lxxIdf: Number(lxxIdf.toFixed(2)),
      isFunction,
      mtIdx: lnk ? Number(lnk.h) : null,
      ...(hTok?.sf ? { mtSurface: String(hTok.sf) } : {}),
      ...(hBs ? { mtStrongs: hBs } : {}),
      ...(hBs && equivByHeb.get(hBs) ? { mtEquivLemmas: equivByHeb.get(hBs) } : {}),
      divergenceKind: divKind,
    };
  });

  const out: OtLxxCandidateGroup = {
    ref: otVerse?.ref || String(mtLxx.ref || `Verse ${otVid}`),
    vid: otVid,
    slots,
  };
  if (loadProfiles) OT_CANDIDATE_CACHE.set(mtLxx, out);
  else OT_CANDIDATE_LIGHT_CACHE.set(mtLxx, out);
  return out;
}
