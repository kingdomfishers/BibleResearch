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
import { V3RuntimeSession, normStrongs4 } from './discovery/v3-runtime-adapter.ts';

export const SUPABASE_DISCOVERY_COMPUTE_RPCS = new Set([
  'discover_biblical_connections_v1',
  'discover_biblical_connections_v2',
  'discover_subgraph_v1',
  'get_connection_evidence_v1',
  'expand_biblical_connection_v1',
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

  constructor(corpusBase: string, fetcher: typeof fetch) {
    this.corpusBase = corpusBase.replace(/\/+$/, '');
    this.fetcher = fetcher;
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
    if (normPath.startsWith('/v3/')) {
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

  createReader(): AssetReader {
    return {
      readJson: (assetPath: string) => this.readJson(assetPath),
      readBinary: (assetPath: string) => this.readBinary(assetPath),
      decodeB64GzJson: <T = unknown>(b64: string, cacheKey?: string) =>
        this.decodeB64GzJson<T>(b64, cacheKey),
    };
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
    const result = await discoverBiblicalConnections(
      reader,
      {
        query: queryText || (concepts ? concepts.join(' ') : ''),
        concepts,
        mode: params.mode ? (String(params.mode) as 'auto' | 'lexeme' | 'motif' | 'topic' | 'passage' | 'compare') : undefined,
        cluster_id: params.cluster_id ? String(params.cluster_id) : undefined,
        focus_lemma: focusLemma,
        compare_targets: parseOptionalListParam(params.compare_targets),
        filters: params.filters && typeof params.filters === 'object' ? (params.filters as Record<string, unknown>) : undefined,
        limit,
        cursor: params.cursor ? String(params.cursor) : null,
        max_hops: params.max_hops !== undefined ? finiteOr(params.max_hops, 3) : 3,
        ...(params.include_v3_verification !== undefined
          ? { include_v3_verification: parseBoolParam(params.include_v3_verification, false) }
          : {}),
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
      ...(params.include_v3_ppr !== undefined ? { include_v3_ppr: parseBoolParam(params.include_v3_ppr, false) } : {}),
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

  throw new Error(`Unsupported Supabase discovery compute RPC: ${name}`);
}
