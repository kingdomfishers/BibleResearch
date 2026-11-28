// @file: supabase/functions/bible-mcp/discovery-runtime.ts
// Supabase Edge compute host for heavy BibleResearch discovery & Steiner subgraph RPCs.
// Streams immutable static shards (?raw=1) and packed /v3/ assets from Cloudflare Corpus,
// keeping Postgres storage at 0 MB while running on Supabase's higher CPU/RAM budget.

import type { AssetReadResult, AssetReader } from './discovery/adjacency-loader.ts';
import {
  DEFAULT_R10_RELEASE,
  discoverBiblicalConnections,
  expandBiblicalConnection,
  getConnectionEvidence,
} from './discovery/r10-discovery.ts';
import { findConnectedSubgraph } from './discovery/subgraph-engine.ts';
import {
  NUM_VERSES,
  coalescePackedRanges,
  lookupPackedKey,
  parseBmwIndex,
  parseCsrPart,
  parseNodesBin,
  parsePackedIntIndex,
  parsePackedKeyIndex,
  parsePprShard,
  type BmwIndex,
  type CsrPart,
  type PackedIntIndex,
  type PackedKeyIndex,
  type PprShard,
} from './discovery/v3-binary-index.ts';
import {
  V3RuntimeSession,
  normStrongs4,
  v3ClauseShardId,
  v3MtLxxShardId,
  v3ProfileShardId,
  v3RahlfsShardId,
  v3VerseChunkId,
  wrapBinaryNodesTable,
  type V3ContextHooks,
  type V3NodesData,
} from './discovery/v3-runtime-adapter.ts';
import {
  decodeCompactHreg,
  parsePericopeTable,
  parsePredSimTable,
  type CompactHreg,
  type PericopeTable,
  type PredicateSimOracle,
} from './discovery/v4-hreg-types.ts';
import {
  parseRmacBmwIndex,
  queryRmacCandidates,
  type RmacBmwIndex,
} from './discovery/v4-rmac-index.ts';
import {
  evaluateSmePair,
  runSeqlGeneralization,
} from './discovery/v4-sme-engine.ts';

export const SUPABASE_DISCOVERY_COMPUTE_RPCS = new Set([
  'discover_biblical_connections_v1',
  'discover_biblical_connections_v2',
  'discover_subgraph_v1',
  'get_connection_evidence_v1',
  'expand_biblical_connection_v1',
  'discover_structural_analogies_v4',
  'get_eside_interpretations_v4',
]);

const DEFAULT_CORPUS_URL = 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';

const RESTRICTED_CORPUS_KEYS = new Set([
  'semantic_frame',
  'frame',
  'greekstrong',
  'sdbh',
  'lexdomain',
  'coredomain',
  'contextualdomain',
  'domain',
  'ln',
]);

const PINNED_BASE_PATHS = new Set([
  '/v2/relationships/r11-v1.0/r10/concept-index.json.gz',
  '/v2/relationships/r11-v1.0/r10/explicit-and-typology.json.gz',
  '/v2/relationships/r11-v1.0/r10/motifs-and-patterns.json.gz',
  '/v2/relationships/r11-v1.0/r10/fast-manifest.json.gz',
]);

const MAX_SHARD_LRU_ENTRIES = 160;
const MAX_SHARD_LRU_BYTES = 24 * 1024 * 1024;
const MAX_SINGLE_SHARD_BYTES = 3 * 1024 * 1024;
const MAX_BIN_LRU_ENTRIES = 16;
const MAX_BIN_LRU_BYTES = 24 * 1024 * 1024;
const MAX_SINGLE_BIN_BYTES = 5 * 1024 * 1024;
const MAX_B64_CACHE_ENTRIES = 256;
const MAX_V3_RECORDS = 512;

const utf8Decoder = new TextDecoder('utf-8');

interface CacheEntry<T> {
  data: T;
  bytes: number;
}

class EdgeShardStore {
  readonly corpusBase: string;
  readonly fetcher: typeof fetch;
  private readonly pinnedJson = new Map<string, unknown>();
  private readonly shardLru = new Map<string, CacheEntry<unknown>>();
  private shardBytes = 0;
  private readonly binLru = new Map<string, Uint8Array>();
  private binBytes = 0;
  private readonly b64Cache = new Map<string, unknown>();
  private readonly inflightJson = new Map<string, Promise<AssetReadResult | null>>();
  private readonly inflightBin = new Map<string, Promise<Uint8Array | null>>();
  private pinnedBmw: BmwIndex | null | undefined = undefined;
  private pinnedNodes: V3NodesData | null | undefined = undefined;
  private pinnedPericopes: PericopeTable | null | undefined = undefined;
  private pinnedPredSim: PredicateSimOracle | null | undefined = undefined;
  private pinnedRmac: RmacBmwIndex | null | undefined = undefined;
  private readonly pinnedIdx = new Map<string, PackedIntIndex | PackedKeyIndex | null>();
  private readonly parsedBinLru = new Map<string, unknown>();
  private readonly v3RecordLru = new Map<string, unknown>();
  private readonly inflightParsed = new Map<string, Promise<unknown>>();

  constructor(corpusBase: string, fetcher: typeof fetch) {
    this.corpusBase = corpusBase.replace(/\/+$/, '');
    this.fetcher = fetcher;
  }

  private getV3Record(key: string): unknown | undefined {
    if (!this.v3RecordLru.has(key)) return undefined;
    const val = this.v3RecordLru.get(key);
    this.v3RecordLru.delete(key);
    this.v3RecordLru.set(key, val);
    return val;
  }

  private setV3Record(key: string, val: unknown): void {
    if (this.v3RecordLru.has(key)) this.v3RecordLru.delete(key);
    this.v3RecordLru.set(key, val);
    while (this.v3RecordLru.size > MAX_V3_RECORDS) {
      const oldest = this.v3RecordLru.keys().next().value;
      if (oldest === undefined) break;
      this.v3RecordLru.delete(oldest);
    }
  }

  private getLruJson(key: string): unknown | undefined {
    if (!this.shardLru.has(key)) return undefined;
    const entry = this.shardLru.get(key)!;
    this.shardLru.delete(key);
    this.shardLru.set(key, entry);
    return entry.data;
  }

  private setLruJson(key: string, data: unknown, bytes: number): void {
    if (bytes > MAX_SINGLE_SHARD_BYTES || bytes > MAX_SHARD_LRU_BYTES) return;
    const prev = this.shardLru.get(key);
    if (prev) {
      this.shardBytes -= prev.bytes;
      this.shardLru.delete(key);
    }
    this.shardLru.set(key, { data, bytes });
    this.shardBytes += bytes;
    while (this.shardLru.size > MAX_SHARD_LRU_ENTRIES || this.shardBytes > MAX_SHARD_LRU_BYTES) {
      const oldest = this.shardLru.keys().next().value;
      if (oldest === undefined) break;
      this.shardBytes -= this.shardLru.get(oldest)!.bytes;
      this.shardLru.delete(oldest);
    }
  }

  private getLruBin(key: string): Uint8Array | undefined {
    if (!this.binLru.has(key)) return undefined;
    const bytes = this.binLru.get(key)!;
    this.binLru.delete(key);
    this.binLru.set(key, bytes);
    return bytes;
  }

  private setLruBin(key: string, data: Uint8Array): void {
    if (data.byteLength > MAX_SINGLE_BIN_BYTES || data.byteLength > MAX_BIN_LRU_BYTES) return;
    const prev = this.binLru.get(key);
    if (prev) {
      this.binBytes -= prev.byteLength;
      this.binLru.delete(key);
    }
    this.binLru.set(key, data);
    this.binBytes += data.byteLength;
    while (this.binLru.size > MAX_BIN_LRU_ENTRIES || this.binBytes > MAX_BIN_LRU_BYTES) {
      const oldest = this.binLru.keys().next().value;
      if (oldest === undefined) break;
      this.binBytes -= this.binLru.get(oldest)!.byteLength;
      this.binLru.delete(oldest);
    }
  }

  private buildAssetUrl(assetPath: string): { url: string; range: [number, number] | null; cacheKey: string } {
    const [rawPath, rangeText] = assetPath.split('#bytes=');
    const normPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const rangeMatch = rangeText?.match(/^(\d+)-(\d+)$/);
    const range: [number, number] | null = rangeMatch ? [Number(rangeMatch[1]), Number(rangeMatch[2])] : null;
    if (normPath.startsWith('/v3/') || normPath.startsWith('/v4/')) {
      return {
        url: `${this.corpusBase}${normPath}`,
        range,
        cacheKey: range ? `${normPath}#bytes=${range[0]}-${range[1]}` : normPath,
      };
    }
    const gzPath = normPath.endsWith('.gz') || normPath.endsWith('.json') || normPath.endsWith('.bin')
      ? normPath
      : `${normPath}.gz`;
    const sep = gzPath.includes('?') ? '&' : '?';
    return {
      url: `${this.corpusBase}${gzPath}${sep}raw=1`,
      range,
      cacheKey: range ? `${gzPath}#bytes=${range[0]}-${range[1]}` : gzPath,
    };
  }

  private async fetchBytes(assetPath: string): Promise<Uint8Array | null> {
    const { url, range } = this.buildAssetUrl(assetPath);
    const headers: Record<string, string> = { 'Accept-Encoding': 'identity' };
    if (range) headers.Range = `bytes=${range[0]}-${range[1]}`;
    const res = await this.fetcher(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Corpus static asset HTTP ${res.status} for ${assetPath}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (range && res.status === 200 && buf.byteLength > range[1]) {
      return buf.subarray(range[0], range[1] + 1);
    }
    return buf;
  }

  async readJson(assetPath: string): Promise<AssetReadResult | null> {
    const { cacheKey } = this.buildAssetUrl(assetPath);
    if (this.pinnedJson.has(cacheKey)) {
      return { data: this.pinnedJson.get(cacheKey), bytes: 0 };
    }
    const hit = this.getLruJson(cacheKey);
    if (hit !== undefined) {
      return { data: hit, bytes: 0 };
    }
    const existing = this.inflightJson.get(cacheKey);
    if (existing) return await existing;

    const task = (async (): Promise<AssetReadResult | null> => {
      const raw = await this.fetchBytes(assetPath);
      if (!raw) return null;
      const decoded = await gunzipIfNeeded(raw);
      const data = JSON.parse(utf8Decoder.decode(decoded));
      if (PINNED_BASE_PATHS.has(cacheKey)) {
        this.pinnedJson.set(cacheKey, data);
      } else {
        this.setLruJson(cacheKey, data, decoded.byteLength);
      }
      return { data, bytes: decoded.byteLength };
    })();

    this.inflightJson.set(cacheKey, task);
    try {
      return await task;
    } finally {
      this.inflightJson.delete(cacheKey);
    }
  }

  async readBinary(assetPath: string): Promise<Uint8Array | null> {
    const { cacheKey } = this.buildAssetUrl(assetPath);
    const hit = this.getLruBin(cacheKey);
    if (hit !== undefined) return hit;
    const existing = this.inflightBin.get(cacheKey);
    if (existing) return await existing;

    const task = (async (): Promise<Uint8Array | null> => {
      const bytes = await this.fetchBytes(assetPath);
      if (!bytes) return null;
      this.setLruBin(cacheKey, bytes);
      return bytes;
    })();

    this.inflightBin.set(cacheKey, task);
    try {
      return await task;
    } finally {
      this.inflightBin.delete(cacheKey);
    }
  }

  async decodeB64GzJson<T = unknown>(b64: string, cacheKey?: string): Promise<T> {
    if (cacheKey && this.b64Cache.has(cacheKey)) {
      const val = this.b64Cache.get(cacheKey) as T;
      this.b64Cache.delete(cacheKey);
      this.b64Cache.set(cacheKey, val);
      return val;
    }
    const raw = decodeBase64(b64);
    const decoded = await gunzipIfNeeded(raw);
    const parsed = JSON.parse(utf8Decoder.decode(decoded)) as T;
    if (cacheKey) {
      this.b64Cache.set(cacheKey, parsed);
      while (this.b64Cache.size > MAX_B64_CACHE_ENTRIES) {
        const oldest = this.b64Cache.keys().next().value;
        if (oldest === undefined) break;
        this.b64Cache.delete(oldest);
      }
    }
    return parsed;
  }

  private async getV3Bmw(): Promise<BmwIndex | null> {
    if (this.pinnedBmw !== undefined) return this.pinnedBmw;
    const key = '/v3/index/postings-bmw.bin';
    if (this.inflightParsed.has(key)) return (await this.inflightParsed.get(key)) as BmwIndex | null;
    const p = (async () => {
      const bytes = await this.fetchBytes(key);
      if (!bytes) {
        this.pinnedBmw = null;
        return null;
      }
      const parsed = parseBmwIndex(bytes);
      this.pinnedBmw = parsed;
      return parsed;
    })();
    this.inflightParsed.set(key, p);
    try { return await p; } finally { this.inflightParsed.delete(key); }
  }

  private async getV3NodesBin(): Promise<V3NodesData | null> {
    if (this.pinnedNodes !== undefined) return this.pinnedNodes;
    const key = '/v3/index/nodes.bin';
    if (this.inflightParsed.has(key)) return (await this.inflightParsed.get(key)) as V3NodesData | null;
    const p = (async () => {
      const bytes = await this.fetchBytes(key);
      if (!bytes) {
        this.pinnedNodes = null;
        return null;
      }
      const parsed = wrapBinaryNodesTable(parseNodesBin(bytes));
      this.pinnedNodes = parsed;
      return parsed;
    })();
    this.inflightParsed.set(key, p);
    try { return await p; } finally { this.inflightParsed.delete(key); }
  }

  private async loadParsedBin<T>(assetPath: string, parser: (bytes: Uint8Array) => T): Promise<T | null> {
    if (this.parsedBinLru.has(assetPath)) {
      const hit = this.parsedBinLru.get(assetPath) as T;
      this.parsedBinLru.delete(assetPath);
      this.parsedBinLru.set(assetPath, hit);
      return hit;
    }
    if (this.inflightParsed.has(assetPath)) return (await this.inflightParsed.get(assetPath)) as T | null;
    const p = (async () => {
      const bytes = await this.fetchBytes(assetPath);
      if (!bytes) return null;
      const parsed = parser(bytes);
      this.parsedBinLru.set(assetPath, parsed);
      while (this.parsedBinLru.size > 16) {
        const oldest = this.parsedBinLru.keys().next().value;
        if (oldest === undefined) break;
        this.parsedBinLru.delete(oldest);
      }
      return parsed;
    })();
    this.inflightParsed.set(assetPath, p);
    try { return await p; } finally { this.inflightParsed.delete(assetPath); }
  }

  private async getPackedIdx(assetPath: string, kind: 'int'): Promise<PackedIntIndex | null>;
  private async getPackedIdx(assetPath: string, kind: 'key'): Promise<PackedKeyIndex | null>;
  private async getPackedIdx(assetPath: string, kind: 'int' | 'key'): Promise<PackedIntIndex | PackedKeyIndex | null> {
    if (this.pinnedIdx.has(assetPath)) return this.pinnedIdx.get(assetPath) ?? null;
    if (this.inflightParsed.has(assetPath)) return (await this.inflightParsed.get(assetPath)) as PackedIntIndex | PackedKeyIndex | null;
    const p = (async () => {
      const bytes = await this.fetchBytes(assetPath);
      if (!bytes) {
        this.pinnedIdx.set(assetPath, null);
        return null;
      }
      const parsed = kind === 'int' ? parsePackedIntIndex(bytes) : parsePackedKeyIndex(bytes);
      this.pinnedIdx.set(assetPath, parsed);
      return parsed;
    })();
    this.inflightParsed.set(assetPath, p);
    try { return await p; } finally { this.inflightParsed.delete(assetPath); }
  }

  async readPackedIntBatch<T = unknown>(
    idxPath: string,
    packPrefix: string,
    ids: number[],
    recPrefix: string,
    decodeSlice?: (plainOrRaw: Uint8Array) => T,
  ): Promise<Map<number, T | null>> {
    const out = new Map<number, T | null>();
    const idx = await this.getPackedIdx(idxPath, 'int');
    if (!idx) return out;
    const missing: number[] = [];
    for (const rawId of ids || []) {
      const id = Number(rawId);
      if (!Number.isFinite(id) || id < 0 || id > NUM_VERSES || out.has(id)) continue;
      const hit = this.getV3Record(`${recPrefix}:${id}`);
      if (hit !== undefined) out.set(id, hit as T | null);
      else missing.push(id);
    }
    if (missing.length === 0) return out;

    const spans = coalescePackedRanges(idx, missing);
    const hitIds = new Set<number>();
    await Promise.all(spans.map(async (span) => {
      const packPath = `${packPrefix}-${String(span.fileIdx).padStart(2, '0')}.bin#bytes=${span.start}-${span.end}`;
      const raw = await this.fetchBytes(packPath);
      if (!raw) return;
      for (const item of span.items) {
        try {
          const gzSlice = raw.subarray(item.relStart, item.relStart + item.length);
          const plain = await gunzipIfNeeded(gzSlice);
          const parsed = decodeSlice ? decodeSlice(plain) : (JSON.parse(utf8Decoder.decode(plain)) as T);
          this.setV3Record(`${recPrefix}:${item.id}`, parsed);
          out.set(item.id, parsed);
          hitIds.add(item.id);
        } catch {
          this.setV3Record(`${recPrefix}:${item.id}`, null);
          out.set(item.id, null);
        }
      }
    }));
    for (const id of missing) {
      if (!hitIds.has(id) && !out.has(id)) {
        this.setV3Record(`${recPrefix}:${id}`, null);
        out.set(id, null);
      }
    }
    return out;
  }

  private async readPackedKey<T = unknown>(idxPath: string, packPrefix: string, key: string, recPrefix: string): Promise<T | null> {
    const cacheKey = `${recPrefix}:${key}`;
    const hit = this.getV3Record(cacheKey);
    if (hit !== undefined) return hit as T | null;
    const idx = await this.getPackedIdx(idxPath, 'key');
    if (!idx) return null;
    const loc = lookupPackedKey(idx, key);
    if (!loc) {
      this.setV3Record(cacheKey, null);
      return null;
    }
    const packPath = `${packPrefix}-${String(loc.fileIdx).padStart(2, '0')}.bin#bytes=${loc.start}-${loc.start + loc.length - 1}`;
    const raw = await this.fetchBytes(packPath);
    if (!raw) return null;
    const plain = await gunzipIfNeeded(raw);
    const parsed = JSON.parse(utf8Decoder.decode(plain)) as T;
    this.setV3Record(cacheKey, parsed);
    return parsed;
  }

  private async readPackedKeyBatch<T = unknown>(idxPath: string, packPrefix: string, keys: string[], recPrefix: string): Promise<Map<string, T | null>> {
    const out = new Map<string, T | null>();
    const idx = await this.getPackedIdx(idxPath, 'key');
    if (!idx) return out;
    const toRead: Array<{ key: string; fileIdx: number; start: number; length: number }> = [];
    for (const rawKey of keys || []) {
      const key = String(rawKey || '');
      if (!key || out.has(key)) continue;
      const hit = this.getV3Record(`${recPrefix}:${key}`);
      if (hit !== undefined) {
        out.set(key, hit as T | null);
        continue;
      }
      const loc = lookupPackedKey(idx, key);
      if (!loc) {
        this.setV3Record(`${recPrefix}:${key}`, null);
        out.set(key, null);
        continue;
      }
      toRead.push({ key, ...loc });
    }
    if (toRead.length === 0) return out;
    toRead.sort((a, b) => a.fileIdx - b.fileIdx || a.start - b.start);
    const spans: Array<{ fileIdx: number; start: number; end: number; items: typeof toRead }> = [];
    for (const item of toRead) {
      const itemEnd = item.start + item.length - 1;
      const prev = spans[spans.length - 1];
      if (prev && prev.fileIdx === item.fileIdx && item.start - prev.end - 1 <= 8192 && itemEnd - prev.start + 1 <= 196608) {
        prev.end = Math.max(prev.end, itemEnd);
        prev.items.push(item);
      } else {
        spans.push({ fileIdx: item.fileIdx, start: item.start, end: itemEnd, items: [item] });
      }
    }
    await Promise.all(spans.map(async (span) => {
      const packPath = `${packPrefix}-${String(span.fileIdx).padStart(2, '0')}.bin#bytes=${span.start}-${span.end}`;
      const raw = await this.fetchBytes(packPath);
      if (!raw) return;
      for (const item of span.items) {
        try {
          const relStart = item.start - span.start;
          const gzSlice = raw.subarray(relStart, relStart + item.length);
          const plain = await gunzipIfNeeded(gzSlice);
          const parsed = JSON.parse(utf8Decoder.decode(plain)) as T;
          this.setV3Record(`${recPrefix}:${item.key}`, parsed);
          out.set(item.key, parsed);
        } catch {
          out.set(item.key, null);
        }
      }
    }));
    return out;
  }

  private createV3Hooks(): V3ContextHooks {
    return {
      getV3Bmw: () => this.getV3Bmw(),
      getV3Nodes: async () => (await this.getV3NodesBin()) ?? ((await this.readJson('/v3/index/nodes.json.gz'))?.data as V3NodesData | null ?? null),
      getV3PprShard: (sid: number) => this.loadParsedBin<PprShard>(`/v3/graph/ppr-top64/shard-${String(sid & 31).padStart(2, '0')}.bin`, parsePprShard),
      getV3CsrPart: (pid: number) => this.loadParsedBin<CsrPart>(`/v3/graph/typed-csr/part-${String(pid & 15).padStart(2, '0')}.bin`, parseCsrPart),
      getV3ProfileShard: async (sid: number) => (await this.readJson(`/v3/profiles/shard-${String(sid).padStart(2, '0')}.json.gz`))?.data ?? null,
      getV3VerseChunk: async (cid: number) => (await this.readJson(`/v3/verses/chunk-${String(cid).padStart(2, '0')}.json.gz`))?.data ?? null,
      getV3ClauseShard: async (sid: number) => (await this.readJson(`/v3/rhetoric/clauses-${String(sid).padStart(2, '0')}.json.gz`))?.data ?? null,
      getV3MtLxxShard: (sid: number) => this.loadParsedBin(`/v3/align/mt-lxx-${String(sid).padStart(2, '0')}.bin`, (b) => JSON.parse(utf8Decoder.decode(b))),
      getV3RahlfsShard: (sid: number) => this.loadParsedBin(`/v3/align/rahlfs-concordance-${String(sid).padStart(2, '0')}.bin`, (b) => JSON.parse(utf8Decoder.decode(b))),
      getV3RhetoricIndex: async () => (await this.readJson('/v3/rhetoric/rhetoric-index.json.gz'))?.data ?? null,
      getV3Onomastic: async () => (await this.readJson('/v3/rhetoric/onomastic-lexicon.json'))?.data ?? null,
      getV3RhetoricBook: async (bookId: number) => {
        const key = String(Math.floor(Number(bookId)));
        if (!key || key === 'NaN') return null;
        return await this.readPackedKey('/v3/rhetoric/rhetoric-book.idx', '/v3/rhetoric/rhetoric-book-pack', key, 'rb');
      },
      getV3Profile: async (bs: string) => {
        const normBs = normStrongs4(bs) || String(bs || '');
        if (!normBs) return null;
        const idx = await this.getPackedIdx('/v3/profiles/profiles.idx', 'key');
        if (idx) return await this.readPackedKey('/v3/profiles/profiles.idx', '/v3/profiles/pack', normBs, 'p');
        const shard = (await this.readJson(`/v3/profiles/shard-${String(v3ProfileShardId(normBs)).padStart(2, '0')}.json.gz`))?.data as { profiles?: Record<string, unknown> } | null;
        return shard?.profiles?.[normBs] ?? null;
      },
      getV3ProfilesBatch: async (bss: string[]) => {
        const keys = [...new Set((bss || []).map(b => normStrongs4(b) || String(b || '')).filter(Boolean))];
        const idx = await this.getPackedIdx('/v3/profiles/profiles.idx', 'key');
        if (idx) return await this.readPackedKeyBatch('/v3/profiles/profiles.idx', '/v3/profiles/pack', keys, 'p');
        const out = new Map<string, unknown>();
        for (const k of keys) {
          const shard = (await this.readJson(`/v3/profiles/shard-${String(v3ProfileShardId(k)).padStart(2, '0')}.json.gz`))?.data as { profiles?: Record<string, unknown> } | null;
          out.set(k, shard?.profiles?.[k] ?? null);
        }
        return out;
      },
      getV3Verse: async (vid: number) => {
        const nVid = Number(vid);
        const idx = await this.getPackedIdx('/v3/verses/verses.idx', 'int');
        if (idx) {
          const res = await this.readPackedIntBatch('/v3/verses/verses.idx', '/v3/verses/pack', [nVid], 'v');
          return res.get(nVid) ?? null;
        }
        const chunk = (await this.readJson(`/v3/verses/chunk-${String(v3VerseChunkId(nVid)).padStart(2, '0')}.json.gz`))?.data as { verses?: Record<string, unknown> } | null;
        return chunk?.verses?.[String(nVid)] ?? null;
      },
      getV3VersesBatch: async (vids: number[]) => {
        const cleanVids = (vids || []).map(Number).filter(v => Number.isFinite(v) && v >= 1 && v <= NUM_VERSES);
        const idx = await this.getPackedIdx('/v3/verses/verses.idx', 'int');
        if (idx) return await this.readPackedIntBatch('/v3/verses/verses.idx', '/v3/verses/pack', cleanVids, 'v');
        const out = new Map<number, unknown>();
        for (const v of cleanVids) {
          const chunk = (await this.readJson(`/v3/verses/chunk-${String(v3VerseChunkId(v)).padStart(2, '0')}.json.gz`))?.data as { verses?: Record<string, unknown> } | null;
          out.set(v, chunk?.verses?.[String(v)] ?? null);
        }
        return out;
      },
      getV3VerseClauses: async (vid: number) => {
        const nVid = Number(vid);
        const idx = await this.getPackedIdx('/v3/rhetoric/clauses.idx', 'int');
        if (idx) {
          const res = await this.readPackedIntBatch('/v3/rhetoric/clauses.idx', '/v3/rhetoric/clauses-pack', [nVid], 'c');
          return res.get(nVid) ?? null;
        }
        const shard = (await this.readJson(`/v3/rhetoric/clauses-${String(v3ClauseShardId(nVid)).padStart(2, '0')}.json.gz`))?.data as { verses?: Array<{ vid?: number }> } | null;
        return shard?.verses?.find(vr => Number(vr?.vid) === nVid) ?? null;
      },
      getV3VerseClausesBatch: async (vids: number[]) => {
        const cleanVids = (vids || []).map(Number).filter(v => Number.isFinite(v) && v >= 1 && v <= NUM_VERSES);
        const idx = await this.getPackedIdx('/v3/rhetoric/clauses.idx', 'int');
        if (idx) return await this.readPackedIntBatch('/v3/rhetoric/clauses.idx', '/v3/rhetoric/clauses-pack', cleanVids, 'c');
        const out = new Map<number, unknown>();
        for (const v of cleanVids) {
          const shard = (await this.readJson(`/v3/rhetoric/clauses-${String(v3ClauseShardId(v)).padStart(2, '0')}.json.gz`))?.data as { verses?: Array<{ vid?: number }> } | null;
          out.set(v, shard?.verses?.find(vr => Number(vr?.vid) === v) ?? null);
        }
        return out;
      },
      getV3MtLxx: async (vid: number) => {
        const nVid = Number(vid);
        const idx = await this.getPackedIdx('/v3/align/mt-lxx.idx', 'int');
        if (idx) {
          const res = await this.readPackedIntBatch('/v3/align/mt-lxx.idx', '/v3/align/mt-lxx-pack', [nVid], 'm');
          return res.get(nVid) ?? null;
        }
        const shard = await this.loadParsedBin(`/v3/align/mt-lxx-${String(v3MtLxxShardId(nVid)).padStart(2, '0')}.bin`, (b) => JSON.parse(utf8Decoder.decode(b)) as { verses?: Record<string, unknown> });
        return shard?.verses?.[String(nVid)] ?? null;
      },
      getV3MtLxxBatch: async (vids: number[]) => {
        const cleanVids = (vids || []).map(Number).filter(v => Number.isFinite(v) && v >= 1 && v <= NUM_VERSES);
        const idx = await this.getPackedIdx('/v3/align/mt-lxx.idx', 'int');
        if (idx) return await this.readPackedIntBatch('/v3/align/mt-lxx.idx', '/v3/align/mt-lxx-pack', cleanVids, 'm');
        const out = new Map<number, unknown>();
        for (const v of cleanVids) {
          const shard = await this.loadParsedBin(`/v3/align/mt-lxx-${String(v3MtLxxShardId(v)).padStart(2, '0')}.bin`, (b) => JSON.parse(utf8Decoder.decode(b)) as { verses?: Record<string, unknown> });
          out.set(v, shard?.verses?.[String(v)] ?? null);
        }
        return out;
      },
      getV3RahlfsConcordance: async (lemma: string) => {
        const lem = String(lemma || '').trim();
        if (!lem) return null;
        const idx = await this.getPackedIdx('/v3/align/rahlfs-concordance.idx', 'key');
        if (idx) return await this.readPackedKey('/v3/align/rahlfs-concordance.idx', '/v3/align/rahlfs-concordance-pack', lem, 'r');
        const shard = await this.loadParsedBin(`/v3/align/rahlfs-concordance-${String(v3RahlfsShardId(lem)).padStart(2, '0')}.bin`, (b) => JSON.parse(utf8Decoder.decode(b)) as { lemmas?: Record<string, unknown> });
        return shard?.lemmas?.[lem] ?? null;
      },
      getV4Pericopes: async () => {
        if (this.pinnedPericopes !== undefined) return this.pinnedPericopes;
        const key = 'v4:pericopes';
        if (this.inflightParsed.has(key)) return (await this.inflightParsed.get(key)) as PericopeTable | null;
        const p = (async () => {
          const [pBytes, vBytes] = await Promise.all([
            this.fetchBytes('/v4/index/pericopes.bin'),
            this.fetchBytes('/v4/index/vid-to-pericopes.bin'),
          ]);
          const parsed = pBytes && vBytes ? parsePericopeTable(pBytes, vBytes) : null;
          this.pinnedPericopes = parsed;
          return parsed;
        })();
        this.inflightParsed.set(key, p);
        try { return await p; } finally { this.inflightParsed.delete(key); }
      },
      getV4PredSim: async () => {
        if (this.pinnedPredSim !== undefined) return this.pinnedPredSim;
        const key = '/v4/index/pred-sim.bin';
        if (this.inflightParsed.has(key)) return (await this.inflightParsed.get(key)) as PredicateSimOracle | null;
        const p = (async () => {
          const bytes = await this.fetchBytes(key);
          const parsed = bytes ? parsePredSimTable(bytes) : null;
          this.pinnedPredSim = parsed;
          return parsed;
        })();
        this.inflightParsed.set(key, p);
        try { return await p; } finally { this.inflightParsed.delete(key); }
      },
      getV4Rmac: async () => {
        if (this.pinnedRmac !== undefined) return this.pinnedRmac;
        const key = '/v4/index/rmac-bmw.bin';
        if (this.inflightParsed.has(key)) return (await this.inflightParsed.get(key)) as RmacBmwIndex | null;
        const p = (async () => {
          const bytes = await this.fetchBytes(key);
          const parsed = bytes ? parseRmacBmwIndex(bytes) : null;
          this.pinnedRmac = parsed;
          return parsed;
        })();
        this.inflightParsed.set(key, p);
        try { return await p; } finally { this.inflightParsed.delete(key); }
      },
      getV4Hreg: async (pericopeId: number) => {
        const res = await this.createV3Hooks().getV4HregBatch!([pericopeId]);
        return res.get(pericopeId) ?? null;
      },
      getV4HregBatch: async (pericopeIds: number[]) => {
        const out = new Map<number, CompactHreg | null>();
        const perTable = await this.createV3Hooks().getV4Pericopes!();
        if (!perTable) return out;
        const missing: Array<{ id: number; fileIdx: number; start: number; length: number }> = [];
        for (const id of pericopeIds || []) {
          if (!(id > 0) || out.has(id)) continue;
          const hit = this.getV3Record(`h:${id}`);
          if (hit !== undefined) { out.set(id, hit as CompactHreg | null); continue; }
          const meta = perTable.records[id - 1];
          if (!meta) { out.set(id, null); continue; }
          missing.push({ id, fileIdx: meta.packFile, start: meta.byteOff, length: meta.byteLen });
        }
        if (missing.length === 0) return out;
        missing.sort((a, b) => a.fileIdx - b.fileIdx || a.start - b.start);
        const spans: Array<{ fileIdx: number; start: number; end: number; items: typeof missing }> = [];
        for (const item of missing) {
          const itemEnd = item.start + item.length - 1;
          const prev = spans[spans.length - 1];
          if (prev && prev.fileIdx === item.fileIdx && item.start - prev.end - 1 <= 8192 && itemEnd - prev.start + 1 <= 196608) {
            prev.end = Math.max(prev.end, itemEnd);
            prev.items.push(item);
          } else {
            spans.push({ fileIdx: item.fileIdx, start: item.start, end: itemEnd, items: [item] });
          }
        }
        await Promise.all(spans.map(async (span) => {
          const raw = await this.fetchBytes(`/v4/hreg/pack-${String(span.fileIdx).padStart(2, '0')}.bin#bytes=${span.start}-${span.end}`);
          if (!raw) return;
          for (const item of span.items) {
            try {
              const sl = raw.subarray(item.start - span.start, item.start - span.start + item.length);
              const plain = await gunzipIfNeeded(sl);
              const parsed = decodeCompactHreg(plain);
              this.setV3Record(`h:${item.id}`, parsed);
              out.set(item.id, parsed);
            } catch {
              out.set(item.id, null);
            }
          }
        }));
        return out;
      },
      getV4EsideVid: async (vid: number) => {
        const res = await this.readPackedIntBatch<{ vid: number; records: unknown[] }>('/v4/eside/eside-vid.idx', '/v4/eside/pack', [vid], 'ev');
        return res.get(vid) ?? null;
      },
      getV4EsideVidBatch: async (vids: number[]) => {
        const cleanVids = (vids || []).map(Number).filter(v => Number.isFinite(v) && v >= 1 && v <= NUM_VERSES);
        return await this.readPackedIntBatch<{ vid: number; records: unknown[] }>('/v4/eside/eside-vid.idx', '/v4/eside/pack', cleanVids, 'ev');
      },
      getV4EsideBs: async (bs: string) => {
        const norm = normStrongs4(bs) || String(bs || '').trim();
        if (!norm) return null;
        return await this.readPackedKey<{ bs: string; records: unknown[] }>('/v4/eside/eside-bs.idx', '/v4/eside/pack', norm, 'eb');
      },
    };
  }

  createReader(): AssetReader {
    const reader: AssetReader & { __v3Hooks?: V3ContextHooks; __v4Store?: EdgeShardStore } = {
      readJson: (assetPath: string) => this.readJson(assetPath),
      readBinary: (assetPath: string) => this.readBinary(assetPath),
      decodeB64GzJson: <T = unknown>(b64: string, cacheKey?: string) =>
        this.decodeB64GzJson<T>(b64, cacheKey),
      __v3Hooks: this.createV3Hooks(),
      __v4Store: this,
    };
    return reader;
  }
}

const storesByCorpusBase = new Map<string, EdgeShardStore>();
const BASE_WARM_PATHS = [
  '/v2/relationships/r11-v1.0/r10/concept-index.json.gz',
  '/v2/relationships/r11-v1.0/r10/explicit-and-typology.json.gz',
  '/v2/relationships/r11-v1.0/r10/motifs-and-patterns.json.gz',
  '/v2/relationships/r11-v1.0/r10/fast-manifest.json.gz',
];
const warmedBases = new Set<string>();

function getStore(corpusBase: string, fetcher: typeof fetch): EdgeShardStore {
  const norm = (corpusBase || DEFAULT_CORPUS_URL).replace(/\/+$/, '');
  // Always use the injected fetcher when custom test doubles are supplied
  if (fetcher !== fetch) {
    return new EdgeShardStore(norm, fetcher);
  }
  let store = storesByCorpusBase.get(norm);
  if (!store) {
    store = new EdgeShardStore(norm, fetcher);
    storesByCorpusBase.set(norm, store);
  }
  return store;
}

async function warmPinnedBaseIndexes(store: EdgeShardStore): Promise<void> {
  if (warmedBases.has(store.corpusBase)) return;
  warmedBases.add(store.corpusBase);
  await Promise.all(BASE_WARM_PATHS.map(p => store.readJson(p).catch(() => null)));
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const ds = new DecompressionStream('gzip');
  const ab = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}

function parseOptionalListParam(val: unknown): string[] | undefined {
  if (Array.isArray(val)) {
    const out = val.map(v => String(v ?? '').trim()).filter(Boolean);
    return out.length > 0 ? out : undefined;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parseOptionalListParam(parsed);
      } catch {
        // Fall through to comma/pipe split
      }
    }
    const out = trimmed.split(/[|,]/).map(s => s.trim()).filter(Boolean);
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

function finiteOr(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolParam(val: unknown, fallback = false): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const low = val.trim().toLowerCase();
    if (low === 'true' || low === '1' || low === 'yes') return true;
    if (low === 'false' || low === '0' || low === 'no') return false;
  }
  return fallback;
}

export function stripRestrictedCorpusFields(value: unknown, depth = 0): unknown {
  if (depth > 70) throw new Error('Corpus response exceeds safe recursion depth');
  if (Array.isArray(value)) {
    return value
      .filter(
        x => !(x && typeof x === 'object' && RESTRICTED_CORPUS_KEYS.has(String((x as { field_name?: unknown }).field_name || '')))
      )
      .map(x => stripRestrictedCorpusFields(x, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (RESTRICTED_CORPUS_KEYS.has(k)) continue;
      out[k] = stripRestrictedCorpusFields(v, depth + 1);
    }
    return out;
  }
  return value;
}

async function resolveOccurrenceAnchor(
  reader: AssetReader,
  corpusBase: string,
  fetcher: typeof fetch,
  params: Record<string, unknown>,
  initialQuery: string,
): Promise<{
  queryText: string;
  focusLemma?: string;
  selectedOccurrence?: Record<string, unknown>;
  discoveryScope?: Record<string, unknown>;
}> {
  const anchorObj = params.anchor && typeof params.anchor === 'object' ? (params.anchor as Record<string, unknown>) : {};
  const occWordId = params.word_id ?? anchorObj.word_id;
  const occBook = params.book ?? anchorObj.book;
  const occChapter = params.chapter ?? anchorObj.chapter;
  const occVerse = params.verse ?? anchorObj.verse;
  const occPosition = params.position ?? params.word_position ?? anchorObj.position;
  const occEdition = params.edition_key ?? params.edition ?? anchorObj.edition_key;
  const occLemmaId = params.lemma_id ?? anchorObj.lemma_id;
  const occExtendedStrongs = params.extended_strongs ?? anchorObj.extended_strongs;

  let queryText = initialQuery;
  let focusLemma = params.focus_lemma ? String(params.focus_lemma).trim() : undefined;

  if (occBook != null && occChapter != null && occVerse != null) {
    const session = new V3RuntimeSession(reader);
    const compactRes = await fetcher(`${corpusBase}/v1/rpc/get_passage_compact_v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: Number(occBook), chapter: Number(occChapter), verse: Number(occVerse) }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    const compactJson = compactRes?.ok ? (await compactRes.json() as { verse_id?: number; verse?: { id?: number } }) : null;
    const vid = Number(compactJson?.verse_id ?? compactJson?.verse?.id ?? 0);
    const v3Verse = vid > 0 ? await session.getVerse(vid).catch(() => null) : null;
    const posNum = occPosition != null ? Number(occPosition) : null;
    const tok = v3Verse?.toks?.find(
      (t: { wn?: number; wid?: number }) =>
        (posNum != null && Number(t.wn) === posNum) ||
        (occWordId != null && Number(t.wid) === Number(occWordId))
    ) || null;
    const bs = normStrongs4(String(tok?.s || occExtendedStrongs || occLemmaId || queryText || ''));
    const prof = bs ? await session.getProfile(bs).catch(() => null) : null;
    const resolvedLemmaId = tok?.lk || prof?.lk || (bs ? `lemma:${bs}` : null);
    const occAnchored = Boolean(tok && posNum != null);
    if (!queryText && bs) queryText = bs;
    if (!focusLemma && bs) focusLemma = bs;
    const lemmaLabel = resolvedLemmaId || bs || 'the resolved lemma';
    return {
      queryText,
      focusLemma,
      selectedOccurrence: {
        word_id: tok?.wid ?? (occWordId != null ? Number(occWordId) : null),
        book: Number(occBook),
        chapter: Number(occChapter),
        verse: Number(occVerse),
        position: tok?.wn ?? posNum,
        edition_key: occEdition ? String(occEdition) : (Number(occBook) <= 39 ? 'macula-hebrew-wlc' : 'macula-greek-nestle1904'),
        reference: v3Verse?.ref ?? null,
        surface_form: tok?.sf ?? null,
        source_token_id: null,
        lemma_id: resolvedLemmaId,
        occurrence_resolution_status: occAnchored
          ? 'verified_occurrence'
          : (bs ? 'lemma_scoped_no_occurrence_position' : 'unresolved'),
      },
      discoveryScope: {
        level: 'lemma_and_concept_index',
        occurrence_anchored: occAnchored,
        word_id_alone_is_not_unique_occurrence: true,
        scope_explanation: occAnchored
          ? `Exact occurrence identity preserved (${v3Verse?.ref} position ${tok?.wn}, STEP word_id ${tok?.wid}, ${lemmaLabel}). Discovery results query the corpus-wide lemma and concept index for ${lemmaLabel}.`
          : `Discovery results reflect corpus-wide lemma and concept connections for ${lemmaLabel}.`,
      },
    };
  }

  const rawToken = String(occExtendedStrongs || occLemmaId || '').replace(/^lemma:/i, '').trim();
  const bs = normStrongs4(rawToken);
  if (!queryText && bs) queryText = bs;
  if (!focusLemma && bs) focusLemma = bs;
  if (!queryText && occWordId != null) queryText = String(occWordId);

  return {
    queryText,
    focusLemma,
    selectedOccurrence: {
      word_id: occWordId != null ? Number(occWordId) : null,
      book: occBook != null ? Number(occBook) : null,
      chapter: occChapter != null ? Number(occChapter) : null,
      verse: occVerse != null ? Number(occVerse) : null,
      position: occPosition != null ? Number(occPosition) : null,
      edition_key: occEdition ? String(occEdition) : null,
      reference: null,
      lemma_id: occLemmaId ? String(occLemmaId) : (bs ? `lemma:${bs}` : null),
      occurrence_resolution_status:
        occWordId != null && occPosition == null
          ? 'word_form_only_not_unique_occurrence'
          : 'lemma_scoped_no_occurrence_position',
    },
    discoveryScope: {
      level: 'lemma_and_concept_index',
      occurrence_anchored: false,
      word_id_alone_is_not_unique_occurrence: true,
      scope_explanation:
        `A STEP word_id alone identifies a word form, not a unique verse occurrence. Supply {word_id, book, chapter, verse, position, edition_key?} for exact occurrence identity. Discovery results reflect corpus-wide lemma and concept connections for ${bs || 'the resolved lemma'}.`,
    },
  };
}

export function createEdgeReader(corpusBase = DEFAULT_CORPUS_URL, fetcher: typeof fetch = fetch): AssetReader {
  return getStore(corpusBase, fetcher).createReader();
}

async function resolveEdgePassageRefsToVids(
  store: EdgeShardStore,
  rawRefs: string[],
): Promise<number[]> {
  if (rawRefs.length === 0) return [];
  const conceptIdxRes = await store
    .readJson<{ book_names?: Array<{ id: number; name: string; abbrev?: string; usfm?: string }> }>(
      '/v2/relationships/r11-v1.0/r10/concept-index.json.gz',
    )
    .catch(() => null);
  const conceptIdx = conceptIdxRes?.data;
  const bookLookup = new Map<string, number>();
  const registerBookKey = (rawKey: string | undefined, id: number) => {
    if (!rawKey) return;
    const norm = rawKey.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    if (!norm) return;
    bookLookup.set(norm, id);
    if (norm.endsWith('s') && norm.length > 3) {
      bookLookup.set(norm.slice(0, -1), id);
    }
  };
  for (const b of conceptIdx?.book_names || []) {
    registerBookKey(b?.name, b.id);
    registerBookKey(b?.abbrev, b.id);
    registerBookKey(b?.usfm, b.id);
  }
  const parsed: Array<{ bid: number; ch: number; vStart: number | null; vEnd: number | null }> = [];
  const neededBooks = new Set<number>();
  for (const raw of rawRefs) {
    const m = /^(\d?\s*[A-Za-z.]+(?:\s+[A-Za-z.]+)*)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/.exec(String(raw || '').trim());
    if (!m) continue;
    const bKey = m[1].toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    const bid = bookLookup.get(bKey) || [...bookLookup.entries()].find(([k]) => k.startsWith(bKey))?.[1];
    if (!bid) continue;
    const ch = Number(m[2]);
    const vStart = m[3] ? Number(m[3]) : null;
    const vEnd = vStart != null ? (m[4] ? Math.min(vStart + 24, Number(m[4])) : vStart) : null;
    parsed.push({ bid, ch, vStart, vEnd });
    neededBooks.add(bid);
  }
  if (parsed.length === 0) return [];
  const bookEntries = await Promise.all(
    [...neededBooks].map(async (bid) => {
      const pad = String(bid).padStart(2, '0');
      const res = await store
        .readJson<{ coord_to_vid?: Record<string, number>; chapter_vids?: Record<string, number[]> }>(
          `/v2/relationships/r11-v1.0/r10/evidence-passages/book-${pad}.json.gz`,
        )
        .catch(() => null);
      return [bid, res?.data ?? null] as const;
    }),
  );
  const bookMap = new Map(bookEntries);
  const out = new Set<number>();
  for (const p of parsed) {
    const bookData = bookMap.get(p.bid);
    if (!bookData) continue;
    if (p.vStart != null && p.vEnd != null) {
      for (let v = p.vStart; v <= p.vEnd; v++) {
        const vid = Number(bookData.coord_to_vid?.[`${p.ch}:${v}`] || 0);
        if (vid > 0) out.add(vid);
      }
    } else {
      const vids = bookData.chapter_vids?.[String(p.ch)] || [];
      for (const v of vids.slice(0, 24)) {
        const vid = Number(v);
        if (vid > 0) out.add(vid);
      }
    }
  }
  return [...out];
}

export async function executeSupabaseDiscoveryRpc(
  name: string,
  params: Record<string, unknown>,
  options: { corpusBase?: string; fetcher?: typeof fetch } = {},
): Promise<Record<string, unknown>> {
  const fetcher = options.fetcher ?? fetch;
  const corpusBase = (options.corpusBase || DEFAULT_CORPUS_URL).replace(/\/+$/, '');
  const store = getStore(corpusBase, fetcher);
  await warmPinnedBaseIndexes(store);
  const reader = store.createReader();
  const releaseId = params.release_id ? String(params.release_id).trim() : DEFAULT_R10_RELEASE;

  if (name === 'discover_biblical_connections_v1' || name === 'discover_biblical_connections_v2') {
    const anchorObj = params.anchor && typeof params.anchor === 'object' ? (params.anchor as Record<string, unknown>) : {};
    const hasOccSelector =
      params.word_id != null ||
      anchorObj.word_id != null ||
      params.position != null ||
      params.word_position != null ||
      anchorObj.position != null ||
      Boolean(params.lemma_id ?? anchorObj.lemma_id) ||
      Boolean(params.extended_strongs ?? anchorObj.extended_strongs) ||
      Boolean(params.edition_key ?? params.edition ?? anchorObj.edition_key);

    let queryText = String(params.query || params.q || params.topic || '').trim();
    const concepts = parseOptionalListParam(params.concepts);
    if (!queryText && (!concepts || concepts.length === 0) && !hasOccSelector) {
      return {
        schema_version: 1,
        status: 'invalid_request',
        error: 'Provide non-empty query, concepts, or occurrence anchor for biblical connection discovery.',
      };
    }

    let focusLemma = params.focus_lemma ? String(params.focus_lemma).trim() : undefined;
    let selectedOccurrence: Record<string, unknown> | undefined;
    let discoveryScope: Record<string, unknown> | undefined;

    if (hasOccSelector) {
      const occ = await resolveOccurrenceAnchor(reader, corpusBase, fetcher, params, queryText);
      queryText = occ.queryText;
      focusLemma = occ.focusLemma;
      selectedOccurrence = occ.selectedOccurrence;
      discoveryScope = occ.discoveryScope;
    }

    if (!queryText && (!concepts || concepts.length === 0)) {
      return {
        schema_version: 1,
        status: 'invalid_request',
        error: 'Could not derive a discovery query from the supplied occurrence anchor.',
        ...(selectedOccurrence ? { selected_occurrence: selectedOccurrence } : {}),
      };
    }

    const limit = params.limit !== undefined ? Math.min(25, Math.max(1, finiteOr(params.limit, 10))) : 10;
    const anchorPassage = params.anchor_passage ? String(params.anchor_passage).trim() : undefined;
    const anchorLemmaKey = params.anchor_lemma_key
      ? String(params.anchor_lemma_key).trim()
      : (selectedOccurrence?.lemma_id ? String(selectedOccurrence.lemma_id).trim() : undefined);
    const anchorExtendedStrongs = params.anchor_extended_strongs
      ? String(params.anchor_extended_strongs).trim()
      : (params.extended_strongs ? String(params.extended_strongs).trim() : undefined);
    const result = await discoverBiblicalConnections(
      reader,
      {
        query: queryText || (concepts ? concepts.join(' ') : ''),
        concepts,
        mode: params.mode ? (String(params.mode) as 'discover' | 'expand' | 'bridge' | 'compare' | 'explain' | 'challenge') : undefined,
        cluster_id: params.cluster_id ? String(params.cluster_id) : undefined,
        focus_lemma: focusLemma,
        ...(anchorPassage ? { anchor_passage: anchorPassage } : {}),
        ...(anchorLemmaKey ? { anchor_lemma_key: anchorLemmaKey } : {}),
        ...(anchorExtendedStrongs ? { anchor_extended_strongs: anchorExtendedStrongs } : {}),
        compare_targets: parseOptionalListParam(params.compare_targets),
        filters: params.filters && typeof params.filters === 'object' ? (params.filters as Record<string, unknown>) : undefined,
        limit,
        cursor: params.cursor ? String(params.cursor) : null,
        max_hops: params.max_hops !== undefined ? finiteOr(params.max_hops, 3) : 3,
        include_v3_verification: params.include_v3_verification !== undefined
          ? parseBoolParam(params.include_v3_verification, true)
          : true,
        release_id: releaseId,
      },
      releaseId,
    );

    const payload = selectedOccurrence || discoveryScope
      ? {
          ...result,
          ...(selectedOccurrence ? { selected_occurrence: selectedOccurrence } : {}),
          ...(discoveryScope ? { discovery_scope: discoveryScope } : {}),
        }
      : result;
    return stripRestrictedCorpusFields(payload) as Record<string, unknown>;
  }

  if (name === 'discover_subgraph_v1') {
    const rawAnchors =
      parseOptionalListParam(params.anchors) ||
      parseOptionalListParam(params.targets) ||
      parseOptionalListParam(params.items) ||
      parseOptionalListParam(params.concepts) ||
      (params.query ? String(params.query).split(/\s*[;|,]\s*|\s+\+\s+/).filter(Boolean) : []);
    const result = await findConnectedSubgraph(reader, {
      anchors: rawAnchors,
      max_hops: params.max_hops !== undefined ? finiteOr(params.max_hops, 3) : 3,
      max_nodes: params.max_nodes !== undefined ? finiteOr(params.max_nodes, 60) : 60,
      max_edges: params.max_edges !== undefined ? finiteOr(params.max_edges, 110) : 110,
      include_exploratory: params.include_exploratory !== false,
      include_v3_ppr: params.include_v3_ppr !== undefined
        ? parseBoolParam(params.include_v3_ppr, true)
        : true,
      release_id: releaseId,
    });
    return stripRestrictedCorpusFields(result) as Record<string, unknown>;
  }

  if (name === 'get_connection_evidence_v1') {
    const evidenceId = String(params.evidence_id || params.connection_id || params.id || '').trim();
    if (!evidenceId) {
      return { schema_version: 1, status: 'invalid_request', error: 'evidence_id is required.' };
    }
    const result = await getConnectionEvidence(reader, evidenceId, releaseId);
    return stripRestrictedCorpusFields(result) as Record<string, unknown>;
  }

  if (name === 'expand_biblical_connection_v1') {
    const nodeId = String(params.node_id || params.node || params.concept || '').trim();
    if (!nodeId) {
      return { schema_version: 1, status: 'invalid_request', error: 'node_id is required.' };
    }
    const result = await expandBiblicalConnection(reader, nodeId, {
      limit: params.limit !== undefined ? finiteOr(params.limit, 8) : 8,
      cursor: params.cursor ? String(params.cursor) : null,
      release_id: releaseId,
    });
    return stripRestrictedCorpusFields(result) as Record<string, unknown>;
  }

  if (name === 'get_eside_interpretations_v4') {
    const session = new V3RuntimeSession(reader);
    const bs = params.strongs ? String(params.strongs).trim() : '';
    const rawVids = parseOptionalListParam(params.vids) ?? parseOptionalListParam(params.verse_ids);
    let vids = (rawVids || (params.vid != null ? [String(params.vid)] : []))
      .map(Number)
      .filter((v) => Number.isInteger(v) && v >= 1 && v <= NUM_VERSES);
    if (vids.length === 0) {
      const rawRefs = [
        ...(parseOptionalListParam(params.passages) || []),
        ...(params.passage ? [String(params.passage)] : []),
        ...(params.ref ? [String(params.ref)] : []),
      ];
      if (rawRefs.length > 0) vids = await resolveEdgePassageRefsToVids(store, rawRefs);
    }
    if (vids.length > 0) {
      const batch = await session.getV4EsideVidBatch(vids.slice(0, 24));
      const records: unknown[] = [];
      for (const vid of vids.slice(0, 24)) {
        const entry = batch.get(vid);
        if (entry?.records?.length) records.push(...entry.records);
      }
      return stripRestrictedCorpusFields({ schema_version: 4, status: 'ok', vids, records }) as Record<string, unknown>;
    }
    if (bs) {
      const rec = await session.getV4EsideBs(bs);
      return stripRestrictedCorpusFields({ schema_version: 4, status: 'ok', strongs: bs, records: rec?.records || [] }) as Record<string, unknown>;
    }
    return { schema_version: 4, status: 'invalid_request', error: 'Provide vid/vids, passage/passages, or strongs.' };
  }

  if (name === 'discover_structural_analogies_v4') {
    const session = new V3RuntimeSession(reader);
    const [perTable, simOracle, rmacIdx] = await Promise.all([
      session.getV4Pericopes(),
      session.getV4PredSim(),
      session.getV4Rmac(),
    ]);
    if (!perTable || !simOracle || !rmacIdx) {
      return { schema_version: 4, status: 'unavailable', error: 'v4 HREG/R-MAC indexes unavailable.' };
    }
    let vidList = (parseOptionalListParam(params.vids) || (params.vid != null ? [String(params.vid)] : []))
      .map(Number)
      .filter((v) => Number.isInteger(v) && v >= 1 && v <= NUM_VERSES);
    if (vidList.length === 0) {
      const seedRefs = [
        ...(parseOptionalListParam(params.seed_passages) || []),
        ...(parseOptionalListParam(params.passages) || []),
        ...(params.passage ? [String(params.passage)] : []),
        ...(params.ref ? [String(params.ref)] : []),
      ];
      if (seedRefs.length > 0) vidList = await resolveEdgePassageRefsToVids(store, seedRefs);
    }
    const pidSet = new Set<number>();
    const rawPids = parseOptionalListParam(params.pericope_ids) || [];
    for (const p of rawPids) {
      const n = Number(p);
      if (Number.isInteger(n) && n >= 1 && n <= perTable.records.length) pidSet.add(n);
    }
    for (const v of vidList) {
      for (const pid of perTable.lookupVidPericopes(v)) pidSet.add(pid);
    }
    const seedPids = [...pidSet].slice(0, 6);
    if (seedPids.length === 0) {
      return { schema_version: 4, status: 'not_found', matches: [], analogies: [] };
    }
    const targetPidsSet = new Set<number>(
      (parseOptionalListParam(params.target_pericope_ids) || [])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= perTable.records.length),
    );
    const compareRefs = parseOptionalListParam(params.compare_passages) || parseOptionalListParam(params.compare_targets) || [];
    if (compareRefs.length > 0) {
      const cmpVids = await resolveEdgePassageRefsToVids(store, compareRefs);
      for (const v of cmpVids) {
        for (const pid of perTable.lookupVidPericopes(v)) {
          if (!pidSet.has(pid)) targetPidsSet.add(pid);
        }
      }
    }
    const targetPidsParam = [...targetPidsSet];
    const bHregMap = await session.getV4HregBatch(seedPids);

    // Multi-anchor SEQL if >= 3 seed/target pericopes explicitly provided with seql=true
    if (parseBoolParam(params.seql, false) && seedPids.length >= 3) {
      const seqlHregs = seedPids.slice(0, 6).map((p) => bHregMap.get(p)).filter((h): h is CompactHreg => Boolean(h));
      if (seqlHregs.length >= 3) {
        const schema = runSeqlGeneralization(seqlHregs, simOracle, { bPerm: 24 });
        return stripRestrictedCorpusFields({ schema_version: 4, status: 'ok', mode: 'seql', schema }) as Record<string, unknown>;
      }
    }

    const limit = params.limit !== undefined ? Math.min(16, Math.max(1, finiteOr(params.limit, 8))) : 8;
    const candMap = new Map<number, number>();
    if (targetPidsParam.length > 0) {
      for (const tp of targetPidsParam.slice(0, 12)) candMap.set(tp, 1);
    } else {
      for (const sp of seedPids.slice(0, 2)) {
        const bh = bHregMap.get(sp);
        if (!bh) continue;
        const cands = queryRmacCandidates(rmacIdx, bh, { kTotal: 24, pericopeTable: perTable });
        for (const c of cands) {
          candMap.set(c.pericopeId, Math.max(candMap.get(c.pericopeId) || 0, c.combinedScore));
        }
      }
    }

    const rankedCandPids = [...candMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map((e) => e[0]);
    const tHregMap = await session.getV4HregBatch(rankedCandPids);
    const matches: unknown[] = [];
    for (const sp of seedPids.slice(0, 2)) {
      const bh = bHregMap.get(sp);
      if (!bh) continue;
      for (const tp of rankedCandPids) {
        if (tp === sp) continue;
        const th = tHregMap.get(tp);
        if (!th) continue;
        const ev = evaluateSmePair(bh, th, simOracle, { bPerm: 24 });
        if (targetPidsParam.length > 0 || (ev.pStruct < 0.05 && ev.deltaSmeStruct > 0)) {
          matches.push({
            base_pericope_id: bh.pericopeId,
            target_pericope_id: th.pericopeId,
            target_start_vid: th.startVid,
            target_end_vid: th.endVid,
            regime: ev.regime,
            classification: ev.classification,
            sub_tag: ev.subTag,
            sms: Number(ev.winning.sms.toFixed(3)),
            p_struct: Number(ev.pStruct.toFixed(4)),
            delta_sme_struct: Number(ev.deltaSmeStruct.toFixed(3)),
            rho_ent: Number(ev.rhoEnt.toFixed(3)),
            mapped_events_count: ev.winning.mappedEvents.length,
            mapped_ho_count: ev.winning.mappedHo.length,
            mapped_events: ev.winning.mappedEvents.length,
            mapped_ho: ev.winning.mappedHo.length,
            candidate_inferences: ev.candidateInferences.slice(0, 4),
            divergences: ev.divergences.slice(0, 6),
          });
        }
      }
    }
    matches.sort((a: any, b: any) => b.delta_sme_struct - a.delta_sme_struct || b.sms - a.sms);
    const topMatches = matches.slice(0, limit);
    return stripRestrictedCorpusFields({
      schema_version: 4,
      status: 'ok',
      mode: 'sme_rmac',
      seed_pericope_ids: seedPids,
      matches: topMatches,
      analogies: topMatches,
    }) as Record<string, unknown>;
  }

  throw new Error(`Unsupported Supabase discovery compute RPC: ${name}`);
}
