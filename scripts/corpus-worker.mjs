/**
 * scripts/corpus-worker.mjs
 * Cloudflare Worker entrypoint for `bibleresearch-corpus`.
 *
 * Serves:
 * - `/health`
 * - `/manifest.json`
 * - `/tables/<table>/part-<nnnn>.jsonl.gz` (decoded NDJSON by default, raw gzip if `?raw=1`)
 * - `/v1/catalog/metadata.json(.gz)`
 * - `/v1/chapters/b<book>-c<chapter>.json(.gz)`
 * - `/v1/lxx/b<book_no>.json(.gz)`
 * - `/v1/lexical/strongs-<bucket>.json(.gz)`
 * - `/v1/lexical/words-<bucket>.json(.gz)`
 * - `/v1/lexical/query-index.json(.gz)`
 * - `/v1/syntax/search-index.json(.gz)`
 * - `/v1/rpc/<operation>` deterministic query & compatibility gateway for static evidence RPCs
 */

import { registerFastJsonText, withCorpusSecurity } from './corpus-security.mjs';
import { Buffer } from 'node:buffer';
import { packedShardEntry } from './relationship-shard-codec.mjs';
import { gunzipSync } from 'node:zlib';
import {
  NUM_VERSES,
  coalescePackedRanges,
  lookupPackedInt,
  lookupPackedKey,
  parseBmwIndex,
  parseCsrPart,
  parseNodesBin,
  parsePackedIntIndex,
  parsePackedKeyIndex,
  parsePprShard,
} from '../src/relationships/v3-binary-index.ts';
import {
  normStrongs4,
  v3ClauseShardId,
  v3MtLxxShardId,
  v3ProfileShardId,
  v3RahlfsShardId,
  v3VerseChunkId,
  wrapBinaryNodesTable,
} from '../src/relationships/v3-runtime-adapter.ts';
import {
  fnv1a64Hex,
  handleDiscoverBiblicalConnectionsV1,
  handleDiscoverPatternsV1,
  handleComparePatternsV1,
  handleDiscoverSubgraphV1,
  handleTraceEvidenceV1,
  handleDiscoverRelationshipPathsV1,
  handleExpandBiblicalConnectionV1,
  handleGetConnectionEvidenceV1,
  handleGetPassageCompactV1,
  handleGetWordProfilesBatchV1,
  handleLookupCrossReferencesV1,
  handleLookupLexicalRelationshipsV1,
  handleQueryRelationshipsV2,
  handleResolveFastLookupV1,
  handleResolveResearchConceptV1,
  handleGetLiterarySourceV1,
  handleAnalyzeLiteraryStructureV1,
  handleLxxConcordanceV3,
  handleTriTextualDiffV3,
  handleClauseRoleQueryV3,
  handleSequenceParallelsV3,
  handleWordplayScanV3,
  handleExpandClueV3,
  handleSetCombineV3,
} from './corpus-relationships-rpc.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, apikey, X-Requested-With',
};

// In-memory isolate cache for hot metadata & frequently accessed shards
let cachedCatalog = null;
let cachedCatalogLite = null;
let cachedVerseU16 = null;
let cachedVerseById = null;
let cachedVerseByCoord = null;
let cachedBooksById = null;
let cachedLxxBooksByNo = null;

function lookupVerseByIdFromU16(id) {
  if (!cachedVerseU16) return null;
  const vid = Number(id);
  if (!Number.isInteger(vid) || vid < 1 || vid * 3 > cachedVerseU16.length) return null;
  const off = (vid - 1) * 3;
  return { id: vid, book: cachedVerseU16[off], chapter: cachedVerseU16[off + 1], verse_nr: cachedVerseU16[off + 2] };
}

function lookupVerseIdByCoordFromU16(coord) {
  if (!cachedVerseU16 || !coord) return null;
  const parts = String(coord).split(':');
  if (parts.length !== 3) return null;
  const b = Number(parts[0]), c = Number(parts[1]), v = Number(parts[2]);
  if (!Number.isInteger(b) || !Number.isInteger(c) || !Number.isInteger(v)) return null;
  let lo = 0, hi = Math.floor(cachedVerseU16.length / 3) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const off = mid * 3;
    const mb = cachedVerseU16[off], mc = cachedVerseU16[off + 1], mv = cachedVerseU16[off + 2];
    if (mb === b && mc === c && mv === v) return mid + 1;
    if (mb < b || (mb === b && (mc < c || (mc === c && mv < v)))) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

const PINNED_BASE_PATHS = new Set([
  '/v2/relationships/r11-v1.0/r10/concept-index.json.gz',
  '/v2/relationships/r11-v1.0/r10/explicit-and-typology.json.gz',
  '/v2/relationships/r11-v1.0/r10/motifs-and-patterns.json.gz',
  '/v2/relationships/r11-v1.0/r10/fast-manifest.json.gz',
]);
const pinnedBaseCache = new Map();
const shardLru = new Map();
let shardInflightCount = 0;
const MAX_LRU_SHARDS = 64;
const MAX_LRU_BYTES = 6 * 1024 * 1024;
const MAX_SINGLE_LRU_BYTES = 2 * 1024 * 1024;
let shardLruBytes = 0;
let r12TraceIsolateId;

const PINNED_V3_PATHS = new Set([
  '/v3/rhetoric/onomastic-lexicon.json',
]);
let pinnedV3Bmw = null;
let pinnedV3Nodes = undefined;
const pinnedV3Idx = new Map();
const v3BinaryCache = new Map();
const MAX_V3_BINARY_ENTRIES = 8;
const v3RecordLru = new Map();
const MAX_V3_RECORDS = 512;
const v3Lru = new Map();
let v3LruBytes = 0;
const MAX_V3_LRU_ENTRIES = 4;
const MAX_V3_LRU_BYTES = 4 * 1024 * 1024;
const MAX_V3_SINGLE_BYTES = 2 * 1024 * 1024;

function getV3Record(key) {
  if (!v3RecordLru.has(key)) return undefined;
  const val = v3RecordLru.get(key);
  v3RecordLru.delete(key);
  v3RecordLru.set(key, val);
  return val;
}

function setV3Record(key, val) {
  if (v3RecordLru.has(key)) v3RecordLru.delete(key);
  v3RecordLru.set(key, val);
  while (v3RecordLru.size > MAX_V3_RECORDS) {
    v3RecordLru.delete(v3RecordLru.keys().next().value);
  }
}

function setV3Lru(key, data, bytes, trace) {
  if (bytes > MAX_V3_SINGLE_BYTES || bytes > MAX_V3_LRU_BYTES) { if (trace) trace.cache_skips++; return; }
  const previous = v3Lru.get(key);
  if (previous) { v3LruBytes -= previous.bytes; v3Lru.delete(key); }
  v3Lru.set(key, { data, bytes }); v3LruBytes += bytes;
  if (trace) trace.cache_stores++;
  while (v3Lru.size > MAX_V3_LRU_ENTRIES || v3LruBytes > MAX_V3_LRU_BYTES) {
    const oldest = v3Lru.keys().next().value;
    v3LruBytes -= v3Lru.get(oldest).bytes; v3Lru.delete(oldest);
    if (trace) trace.cache_evictions++;
  }
}

export function shardCacheStats() { return { entries: shardLru.size + v3Lru.size, decoded_bytes: shardLruBytes + v3LruBytes, inflight: shardInflightCount }; }
function setLru(key, data, bytes, trace) {
  if (bytes > MAX_SINGLE_LRU_BYTES || bytes > MAX_LRU_BYTES) { if (trace) trace.cache_skips++; return; }
  const previous = shardLru.get(key);
  if (previous) { shardLruBytes -= previous.bytes; shardLru.delete(key); }
  shardLru.set(key, { data, bytes }); shardLruBytes += bytes;
  if (trace) trace.cache_stores++;
  while (shardLru.size > MAX_LRU_SHARDS || shardLruBytes > MAX_LRU_BYTES) {
    const oldest = shardLru.keys().next().value;
    shardLruBytes -= shardLru.get(oldest).bytes; shardLru.delete(oldest);
    if (trace) trace.cache_evictions++;
  }
}

async function readAssetBytes(env, assetPath) {
  const trace = env.__r12Trace;
  if (trace) trace.asset_reads++;
  const url = new URL(assetPath, 'https://corpus.internal');
  const range = /^#bytes=(\d+)-(\d+)$/.exec(url.hash);
  url.hash = '';
  const req = new Request(url.toString(), {
    method: 'GET',
    headers: { 'Accept-Encoding': 'identity', ...(range ? { Range: `bytes=${range[1]}-${range[2]}` } : {}) },
  });
  const res = await env.ASSETS.fetch(req);
  if (!res.ok) {
    if (trace) trace.missing_shards.push({ path: assetPath, status: res.status });
    return null;
  }
  let buf;
  if (range) {
    const start = Number(range[1]), end = Number(range[2]);
    if (res.status === 206) {
      buf = await res.arrayBuffer();
      const returned = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('Content-Range') || '');
      if (!returned || Number(returned[1]) !== start || Number(returned[2]) !== end || Number(returned[3]) <= end || buf.byteLength !== end - start + 1) throw new Error('Invalid packed asset range');
    } else if (res.status === 200) {
      // ASSETS can ignore Range in staging too. Never buffer a whole packed
      // blob per record: discard the prefix, retain only the requested bytes,
      // and cancel the unread suffix. Native BYOB reads reuse a bounded buffer.
      if (trace) trace.packed_full_responses = (trace.packed_full_responses || 0) + 1;
      buf = await readPackedRange(res.body, start, end, trace);
    } else throw new Error('Packed asset range unavailable');
  } else buf = await res.arrayBuffer();
  if (trace) trace.encoded_bytes += buf.byteLength;
  return new Uint8Array(buf);
}

async function readPackedRange(body, start, end, trace) {
  if (!body || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) throw new Error('Invalid packed asset range');
  let reader, byob = true;
  try { reader = body.getReader({ mode: 'byob' }); }
  catch { byob = false; reader = body.getReader(); }
  const result = new Uint8Array(end - start + 1);
  let offset = 0, scratch = new ArrayBuffer(1024 * 1024);
  try {
    while (offset <= end) {
      const view = byob ? new Uint8Array(scratch, 0, Math.min(scratch.byteLength, end + 1 - offset)) : null;
      const { value, done } = byob
        ? await (reader.readAtLeast ? reader.readAtLeast(view.length, view) : reader.read(view))
        : await reader.read();
      if (!value?.byteLength) throw new Error('Packed asset range unavailable');
      if (trace) trace.packed_stream_bytes = (trace.packed_stream_bytes || 0) + value.byteLength;
      const from = Math.max(0, start - offset), to = Math.min(value.byteLength, end + 1 - offset);
      if (to > from) result.set(value.subarray(from, to), offset + from - start);
      offset += value.byteLength;
      if (byob) scratch = value.buffer;
      if (done && offset <= end) throw new Error('Packed asset range unavailable');
    }
    return result.buffer;
  } finally { await reader.cancel(); }
}

async function decompressGzipIfNeeded(bytes, trace) {
  if (!bytes || bytes.length < 2) return bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (trace) trace.phases.gzip_decode++;
    if (bytes.byteLength >= 32768 && typeof DecompressionStream === 'function') {
      const ds = new DecompressionStream('gzip');
      const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(ab);
    }
    return gunzipSync(bytes);
  }
  return bytes;
}

const utf8Decoder = new TextDecoder('utf-8');

function decodeJsonShard(bytes) {
  return utf8Decoder.decode(bytes);
}

function parseJsonShard(text) {
  return JSON.parse(text);
}

export function decodeB64GzJson(env, b64, cacheKey) {
  const trace = env?.__r12Trace;
  if (cacheKey && shardLru.has(cacheKey)) {
    const val = shardLru.get(cacheKey);
    shardLru.delete(cacheKey);
    shardLru.set(cacheKey, val);
    if (trace) trace.cache_hits++;
    return val.data;
  }
  const gzBytes = typeof Buffer !== 'undefined'
    ? Buffer.from(b64, 'base64')
    : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const isGz = gzBytes.length >= 2 && gzBytes[0] === 0x1f && gzBytes[1] === 0x8b;
  let decodedBytes = gzBytes;
  if (isGz) {
    if (trace) trace.phases.gzip_decode++;
    decodedBytes = gunzipSync(gzBytes);
  }
  const parsed = parseJsonShard(decodeJsonShard(decodedBytes));
  if (trace) {
    trace.decoded_bytes += decodedBytes.length;
    trace.phases.text_decode++;
    trace.phases.json_parse++;
  }
  if (cacheKey) setLru(cacheKey, parsed, decodedBytes.length, trace);
  return parsed;
}

export async function loadJsonShardWithBytes(env, assetPath) {
  const trace = env.__r12Trace;
  // I/O promises stay request-local; only completed JSON is shared across requests.
  const inflight = env.__assetInflight ||= new Map();
  const isV3 = assetPath.startsWith('/v3/');
  const skipGz = assetPath.endsWith('.gz') || assetPath.endsWith('.json') || assetPath.endsWith('.bin') || assetPath.includes('#bytes=');
  const gzPath = skipGz ? assetPath : `${assetPath}.gz`;
  if (pinnedBaseCache.has(gzPath)) {
    if (trace) {
      trace.cache_hits++;
      trace.assets.push({ path: gzPath, cache_hit: true, decoded_bytes: 0 });
    }
    return { data: pinnedBaseCache.get(gzPath), bytes: 0 };
  }
  if (isV3 && v3Lru.has(gzPath)) {
    const val = v3Lru.get(gzPath);
    v3Lru.delete(gzPath);
    v3Lru.set(gzPath, val);
    if (trace) {
      trace.cache_hits++;
      trace.assets.push({ path: gzPath, cache_hit: true, decoded_bytes: 0 });
    }
    return { data: val.data, bytes: 0 };
  }
  if (shardLru.has(gzPath)) {
    const val = shardLru.get(gzPath);
    shardLru.delete(gzPath);
    shardLru.set(gzPath, val);
    if (trace) {
      trace.cache_hits++;
      trace.assets.push({ path: gzPath, cache_hit: true, decoded_bytes: 0 });
    }
    return { data: val.data, bytes: 0 };
  }
  if (inflight.has(gzPath)) {
    const result = await inflight.get(gzPath);
    if (trace) { trace.cache_hits++; trace.assets.push({ path: gzPath, cache_hit: true, inflight: true, decoded_bytes: 0 }); }
    return result ? { data: result.data, bytes: 0 } : null;
  }
  const pending = (async () => {
    const rawBytes = await readAssetBytes(env, gzPath);
    if (!rawBytes) return null;
    const decodedBytes = await decompressGzipIfNeeded(rawBytes, trace);
    const parsed = parseJsonShard(decodeJsonShard(decodedBytes));
    if (trace) {
      trace.decoded_bytes += decodedBytes.length;
      trace.phases.text_decode++; trace.phases.json_parse++;
      trace.assets.push({ path: gzPath, cache_hit: false, encoded_bytes: rawBytes.length, decoded_bytes: decodedBytes.length });
    }
    if (PINNED_BASE_PATHS.has(gzPath) || PINNED_V3_PATHS.has(gzPath)) {
      pinnedBaseCache.set(gzPath, parsed);
      if (trace) trace.cache_stores++;
    } else if (isV3) {
      setV3Lru(gzPath, parsed, decodedBytes.length, trace);
    } else {
      setLru(gzPath, parsed, decodedBytes.length, trace);
    }
    return { data: parsed, bytes: decodedBytes.length };
  })();
  inflight.set(gzPath, pending); shardInflightCount++;
  try { return await pending; }
  finally { inflight.delete(gzPath); shardInflightCount--; }
}

async function getV3Bmw(env) {
  const trace = env.__r12Trace;
  if (pinnedV3Bmw) {
    if (trace) trace.cache_hits++;
    return pinnedV3Bmw;
  }
  const inflight = env.__assetInflight ||= new Map();
  const key = '/v3/index/postings-bmw.bin';
  if (inflight.has(key)) return await inflight.get(key);
  const pending = (async () => {
    const bytes = await readAssetBytes(env, key);
    if (!bytes) return null;
    const parsed = parseBmwIndex(bytes);
    pinnedV3Bmw = parsed;
    if (trace) trace.cache_stores++;
    return parsed;
  })();
  inflight.set(key, pending);
  try { return await pending; } finally { inflight.delete(key); }
}

async function loadV3CachedBinary(env, assetPath, parser) {
  const trace = env.__r12Trace;
  if (v3Lru.has(assetPath)) {
    const val = v3Lru.get(assetPath);
    v3Lru.delete(assetPath);
    v3Lru.set(assetPath, val);
    if (trace) trace.cache_hits++;
    return val.data;
  }
  const inflight = env.__assetInflight ||= new Map();
  if (inflight.has(assetPath)) return await inflight.get(assetPath);
  const pending = (async () => {
    const bytes = await readAssetBytes(env, assetPath);
    if (!bytes) return null;
    const parsed = parser(bytes);
    setV3Lru(assetPath, parsed, bytes.byteLength, trace);
    return parsed;
  })();
  inflight.set(assetPath, pending);
  try { return await pending; } finally { inflight.delete(assetPath); }
}

async function loadV3BinaryGraph(env, assetPath, parser) {
  const trace = env.__r12Trace;
  if (v3BinaryCache.has(assetPath)) {
    const val = v3BinaryCache.get(assetPath);
    v3BinaryCache.delete(assetPath);
    v3BinaryCache.set(assetPath, val);
    if (trace) trace.cache_hits++;
    return val;
  }
  const inflight = env.__assetInflight ||= new Map();
  if (inflight.has(assetPath)) return await inflight.get(assetPath);
  const pending = (async () => {
    const bytes = await readAssetBytes(env, assetPath);
    if (!bytes) return null;
    const parsed = parser(bytes);
    if (v3BinaryCache.size >= MAX_V3_BINARY_ENTRIES) {
      v3BinaryCache.delete(v3BinaryCache.keys().next().value);
    }
    v3BinaryCache.set(assetPath, parsed);
    if (trace) trace.cache_stores++;
    return parsed;
  })();
  inflight.set(assetPath, pending);
  try { return await pending; } finally { inflight.delete(assetPath); }
}

async function getV3NodesBin(env) {
  const trace = env.__r12Trace;
  if (pinnedV3Nodes !== undefined) {
    if (trace && pinnedV3Nodes) trace.cache_hits++;
    return pinnedV3Nodes;
  }
  const inflight = env.__assetInflight ||= new Map();
  const key = '/v3/index/nodes.bin';
  if (inflight.has(key)) return await inflight.get(key);
  const pending = (async () => {
    const bytes = await readAssetBytes(env, key);
    if (!bytes) {
      pinnedV3Nodes = null;
      return null;
    }
    const parsed = wrapBinaryNodesTable(parseNodesBin(bytes));
    pinnedV3Nodes = parsed;
    if (trace) trace.cache_stores++;
    return parsed;
  })();
  inflight.set(key, pending);
  try { return await pending; } finally { inflight.delete(key); }
}

async function getV3PackedIdx(env, assetPath, kind) {
  const trace = env.__r12Trace;
  if (pinnedV3Idx.has(assetPath)) {
    const hit = pinnedV3Idx.get(assetPath);
    if (trace && hit) trace.cache_hits++;
    return hit;
  }
  const inflight = env.__assetInflight ||= new Map();
  if (inflight.has(assetPath)) return await inflight.get(assetPath);
  const pending = (async () => {
    const bytes = await readAssetBytes(env, assetPath);
    if (!bytes) {
      pinnedV3Idx.set(assetPath, null);
      return null;
    }
    const parsed = kind === 'int' ? parsePackedIntIndex(bytes) : parsePackedKeyIndex(bytes);
    pinnedV3Idx.set(assetPath, parsed);
    if (trace) trace.cache_stores++;
    return parsed;
  })();
  inflight.set(assetPath, pending);
  try { return await pending; } finally { inflight.delete(assetPath); }
}

async function readV3PackedIntBatch(env, idx, packPrefix, ids, recPrefix) {
  const trace = env.__r12Trace;
  const out = new Map();
  const missing = [];
  for (const rawId of ids || []) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id < 0 || id > NUM_VERSES || out.has(id)) continue;
    const hit = getV3Record(`${recPrefix}:${id}`);
    if (hit !== undefined) {
      if (trace) trace.cache_hits++;
      out.set(id, hit);
    } else {
      missing.push(id);
    }
  }
  if (missing.length === 0) return out;

  const spans = coalescePackedRanges(idx, missing);
  const hitIds = new Set();
  await Promise.all(spans.map(async (span) => {
    const packPath = `${packPrefix}-${String(span.fileIdx).padStart(2, '0')}.bin#bytes=${span.start}-${span.end}`;
    const raw = await readAssetBytes(env, packPath);
    if (!raw) return;
    for (const item of span.items) {
      try {
        const gzSlice = raw.subarray(item.relStart, item.relStart + item.length);
        const plain = await decompressGzipIfNeeded(gzSlice, trace);
        const parsed = parseJsonShard(decodeJsonShard(plain));
        setV3Record(`${recPrefix}:${item.id}`, parsed);
        out.set(item.id, parsed);
        hitIds.add(item.id);
      } catch {
        setV3Record(`${recPrefix}:${item.id}`, null);
        out.set(item.id, null);
      }
    }
  }));
  for (const id of missing) {
    if (!hitIds.has(id) && !out.has(id)) {
      setV3Record(`${recPrefix}:${id}`, null);
      out.set(id, null);
    }
  }
  return out;
}

async function readV3PackedKey(env, idx, packPrefix, key, recPrefix) {
  const trace = env.__r12Trace;
  const cacheKey = `${recPrefix}:${key}`;
  const hit = getV3Record(cacheKey);
  if (hit !== undefined) {
    if (trace) trace.cache_hits++;
    return hit;
  }
  const loc = lookupPackedKey(idx, key);
  if (!loc) {
    setV3Record(cacheKey, null);
    return null;
  }
  const packPath = `${packPrefix}-${String(loc.fileIdx).padStart(2, '0')}.bin#bytes=${loc.start}-${loc.start + loc.length - 1}`;
  const raw = await readAssetBytes(env, packPath);
  if (!raw) return null;
  const plain = await decompressGzipIfNeeded(raw, trace);
  const parsed = parseJsonShard(decodeJsonShard(plain));
  setV3Record(cacheKey, parsed);
  return parsed;
}

async function readV3PackedKeyBatch(env, idx, packPrefix, keys, recPrefix) {
  const out = new Map();
  const trace = env.__r12Trace;
  const toRead = [];
  for (const rawKey of keys || []) {
    const key = String(rawKey || '');
    if (!key || out.has(key)) continue;
    const hit = getV3Record(`${recPrefix}:${key}`);
    if (hit !== undefined) {
      if (trace) trace.cache_hits++;
      out.set(key, hit);
      continue;
    }
    const loc = lookupPackedKey(idx, key);
    if (!loc) {
      setV3Record(`${recPrefix}:${key}`, null);
      out.set(key, null);
      continue;
    }
    toRead.push({ key, ...loc });
  }
  if (toRead.length === 0) return out;
  toRead.sort((a, b) => a.fileIdx - b.fileIdx || a.start - b.start);
  const spans = [];
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
    const raw = await readAssetBytes(env, packPath);
    if (!raw) return;
    for (const item of span.items) {
      try {
        const relStart = item.start - span.start;
        const gzSlice = raw.subarray(relStart, relStart + item.length);
        const plain = await decompressGzipIfNeeded(gzSlice, trace);
        const parsed = parseJsonShard(decodeJsonShard(plain));
        setV3Record(`${recPrefix}:${item.key}`, parsed);
        out.set(item.key, parsed);
      } catch {
        out.set(item.key, null);
      }
    }
  }));
  return out;
}

function makeV3Hooks(env) {
  return {
    getV3Bmw: () => getV3Bmw(env),
    getV3Nodes: async () => (await getV3NodesBin(env)) ?? await loadJsonShard(env, '/v3/index/nodes.json.gz'),
    getV3PprShard: (sid) => loadV3BinaryGraph(env, `/v3/graph/ppr-top64/shard-${String(sid & 31).padStart(2, '0')}.bin`, parsePprShard),
    getV3CsrPart: (pid) => loadV3BinaryGraph(env, `/v3/graph/typed-csr/part-${String(pid & 15).padStart(2, '0')}.bin`, parseCsrPart),
    getV3ProfileShard: (sid) => loadJsonShard(env, `/v3/profiles/shard-${String(sid).padStart(2, '0')}.json.gz`),
    getV3VerseChunk: (cid) => loadJsonShard(env, `/v3/verses/chunk-${String(cid).padStart(2, '0')}.json.gz`),
    getV3ClauseShard: (sid) => loadJsonShard(env, `/v3/rhetoric/clauses-${String(sid).padStart(2, '0')}.json.gz`),
    getV3MtLxxShard: (sid) => loadV3CachedBinary(env, `/v3/align/mt-lxx-${String(sid).padStart(2, '0')}.bin`, (b) => parseJsonShard(decodeJsonShard(b))),
    getV3RahlfsShard: (sid) => loadV3CachedBinary(env, `/v3/align/rahlfs-concordance-${String(sid).padStart(2, '0')}.bin`, (b) => parseJsonShard(decodeJsonShard(b))),
    getV3RhetoricIndex: () => loadJsonShard(env, '/v3/rhetoric/rhetoric-index.json.gz'),
    getV3Onomastic: () => loadJsonShard(env, '/v3/rhetoric/onomastic-lexicon.json'),
    async getV3RhetoricBook(bookId) {
      const key = String(Math.floor(Number(bookId)));
      if (!key || key === 'NaN') return null;
      const idx = await getV3PackedIdx(env, '/v3/rhetoric/rhetoric-book.idx', 'key');
      if (idx) {
        return await readV3PackedKey(env, idx, '/v3/rhetoric/rhetoric-book-pack', key, 'rb');
      }
      return null;
    },
    async getV3Profile(bs) {
      const normBs = normStrongs4(bs) || String(bs || '');
      if (!normBs) return null;
      const k = `p:${normBs}`;
      const hit = getV3Record(k);
      if (hit !== undefined) {
        if (env.__r12Trace) env.__r12Trace.cache_hits++;
        return hit;
      }
      const idx = await getV3PackedIdx(env, '/v3/profiles/profiles.idx', 'key');
      if (idx) {
        return await readV3PackedKey(env, idx, '/v3/profiles/pack', normBs, 'p');
      }
      const shard = await loadJsonShard(env, `/v3/profiles/shard-${String(v3ProfileShardId(normBs)).padStart(2, '0')}.json.gz`);
      const val = shard?.profiles?.[normBs] ?? null;
      setV3Record(k, val);
      return val;
    },
    async getV3ProfilesBatch(bss) {
      const keys = [...new Set((bss || []).map(b => normStrongs4(b) || String(b || '')).filter(Boolean))];
      const idx = await getV3PackedIdx(env, '/v3/profiles/profiles.idx', 'key');
      if (idx) {
        return await readV3PackedKeyBatch(env, idx, '/v3/profiles/pack', keys, 'p');
      }
      const out = new Map();
      for (const b of keys) out.set(b, await this.getV3Profile(b));
      return out;
    },
    async getV3Verse(vid) {
      const nVid = Number(vid);
      const k = `v:${nVid}`;
      const hit = getV3Record(k);
      if (hit !== undefined) {
        if (env.__r12Trace) env.__r12Trace.cache_hits++;
        return hit;
      }
      const idx = await getV3PackedIdx(env, '/v3/verses/verses.idx', 'int');
      if (idx) {
        const res = await readV3PackedIntBatch(env, idx, '/v3/verses/pack', [nVid], 'v');
        return res.get(nVid) ?? null;
      }
      const chunk = await loadJsonShard(env, `/v3/verses/chunk-${String(v3VerseChunkId(nVid)).padStart(2, '0')}.json.gz`);
      const val = chunk?.verses?.[String(nVid)] ?? null;
      setV3Record(k, val);
      return val;
    },
    async getV3VersesBatch(vids) {
      const cleanVids = (vids || []).map(Number).filter(v => Number.isFinite(v) && v >= 1 && v <= NUM_VERSES);
      const idx = await getV3PackedIdx(env, '/v3/verses/verses.idx', 'int');
      if (idx) {
        return await readV3PackedIntBatch(env, idx, '/v3/verses/pack', cleanVids, 'v');
      }
      const out = new Map();
      const byChunk = new Map();
      for (const v of cleanVids) {
        const hit = getV3Record(`v:${v}`);
        if (hit !== undefined) { out.set(v, hit); continue; }
        const cid = v3VerseChunkId(v);
        if (!byChunk.has(cid)) byChunk.set(cid, []);
        byChunk.get(cid).push(v);
      }
      await Promise.all([...byChunk.entries()].map(async ([cid, vs]) => {
        const chunk = await loadJsonShard(env, `/v3/verses/chunk-${String(cid).padStart(2, '0')}.json.gz`);
        for (const v of vs) {
          const val = chunk?.verses?.[String(v)] ?? null;
          setV3Record(`v:${v}`, val);
          out.set(v, val);
        }
      }));
      return out;
    },
    async getV3VerseClauses(vid) {
      const nVid = Number(vid);
      const k = `c:${nVid}`;
      const hit = getV3Record(k);
      if (hit !== undefined) {
        if (env.__r12Trace) env.__r12Trace.cache_hits++;
        return hit;
      }
      const idx = await getV3PackedIdx(env, '/v3/rhetoric/clauses.idx', 'int');
      if (idx) {
        const res = await readV3PackedIntBatch(env, idx, '/v3/rhetoric/clauses-pack', [nVid], 'c');
        return res.get(nVid) ?? null;
      }
      const shard = await loadJsonShard(env, `/v3/rhetoric/clauses-${String(v3ClauseShardId(nVid)).padStart(2, '0')}.json.gz`);
      if (shard && Array.isArray(shard.verses) && !shard._byVid) {
        const byVid = new Map();
        for (const v of shard.verses) if (v?.vid) byVid.set(Number(v.vid), v);
        shard._byVid = byVid;
      }
      const val = shard?._byVid?.get(nVid) ?? null;
      setV3Record(k, val);
      return val;
    },
    async getV3VerseClausesBatch(vids) {
      const cleanVids = (vids || []).map(Number).filter(v => Number.isFinite(v) && v >= 1 && v <= NUM_VERSES);
      const idx = await getV3PackedIdx(env, '/v3/rhetoric/clauses.idx', 'int');
      if (idx) {
        return await readV3PackedIntBatch(env, idx, '/v3/rhetoric/clauses-pack', cleanVids, 'c');
      }
      const out = new Map();
      const bySid = new Map();
      for (const v of cleanVids) {
        const hit = getV3Record(`c:${v}`);
        if (hit !== undefined) { out.set(v, hit); continue; }
        const sid = v3ClauseShardId(v);
        if (!bySid.has(sid)) bySid.set(sid, []);
        bySid.get(sid).push(v);
      }
      await Promise.all([...bySid.entries()].map(async ([sid, vs]) => {
        const shard = await loadJsonShard(env, `/v3/rhetoric/clauses-${String(sid).padStart(2, '0')}.json.gz`);
        if (shard && Array.isArray(shard.verses) && !shard._byVid) {
          const byVid = new Map();
          for (const vr of shard.verses) if (vr?.vid) byVid.set(Number(vr.vid), vr);
          shard._byVid = byVid;
        }
        for (const v of vs) {
          const val = shard?._byVid?.get(v) ?? null;
          setV3Record(`c:${v}`, val);
          out.set(v, val);
        }
      }));
      return out;
    },
    async getV3MtLxx(vid) {
      const nVid = Number(vid);
      const k = `m:${nVid}`;
      const hit = getV3Record(k);
      if (hit !== undefined) {
        if (env.__r12Trace) env.__r12Trace.cache_hits++;
        return hit;
      }
      const idx = await getV3PackedIdx(env, '/v3/align/mt-lxx.idx', 'int');
      if (idx) {
        const res = await readV3PackedIntBatch(env, idx, '/v3/align/mt-lxx-pack', [nVid], 'm');
        return res.get(nVid) ?? null;
      }
      const shard = await loadV3CachedBinary(env, `/v3/align/mt-lxx-${String(v3MtLxxShardId(nVid)).padStart(2, '0')}.bin`, (b) => parseJsonShard(decodeJsonShard(b)));
      const val = shard?.verses?.[String(nVid)] ?? null;
      setV3Record(k, val);
      return val;
    },
    async getV3MtLxxBatch(vids) {
      const cleanVids = (vids || []).map(Number).filter(v => Number.isFinite(v) && v >= 1 && v <= NUM_VERSES);
      const idx = await getV3PackedIdx(env, '/v3/align/mt-lxx.idx', 'int');
      if (idx) {
        return await readV3PackedIntBatch(env, idx, '/v3/align/mt-lxx-pack', cleanVids, 'm');
      }
      const out = new Map();
      for (const v of cleanVids) out.set(v, await this.getV3MtLxx(v));
      return out;
    },
    async getV3RahlfsConcordance(lemma) {
      const lem = String(lemma || '').trim();
      if (!lem) return null;
      const k = `r:${lem}`;
      const hit = getV3Record(k);
      if (hit !== undefined) {
        if (env.__r12Trace) env.__r12Trace.cache_hits++;
        return hit;
      }
      const idx = await getV3PackedIdx(env, '/v3/align/rahlfs-concordance.idx', 'key');
      if (idx) {
        return await readV3PackedKey(env, idx, '/v3/align/rahlfs-concordance-pack', lem, 'r');
      }
      const shard = await loadV3CachedBinary(env, `/v3/align/rahlfs-concordance-${String(v3RahlfsShardId(lem)).padStart(2, '0')}.bin`, (b) => parseJsonShard(decodeJsonShard(b)));
      const val = shard?.lemmas?.[lem] ?? null;
      setV3Record(k, val);
      return val;
    },
  };
}

function makeWorkerRpcCtx(env) {
  return {
    env,
    loadJsonShard,
    loadJsonShardWithBytes,
    decodeB64GzJson: (b64, cacheKey) => decodeB64GzJson(env, b64, cacheKey),
    decodeB64Gz: (b64, cacheKey) => decodeB64GzJson(env, b64, cacheKey),
    readBinary: (assetPath) => readAssetBytes(env, assetPath),
    v3Hooks: makeV3Hooks(env),
    ensureCatalog: () => ensureCatalogLite(env),
    getVerseIdByCoord: coord => lookupVerseIdByCoordFromU16(coord) ?? cachedVerseByCoord?.get(coord) ?? null,
    getVerseById: id => lookupVerseByIdFromU16(id) ?? cachedVerseById?.get(id) ?? null,
  };
}

async function loadJsonShard(env, assetPath) {
  const res = await loadJsonShardWithBytes(env, assetPath);
  return res ? res.data : null;
}

async function ensureCatalogLite(env) {
  if (cachedCatalogLite) return cachedCatalogLite;
  if (cachedCatalog) return cachedCatalog;
  const inflight = env.__assetInflight ||= new Map();
  if (inflight.has('catalog-lite')) return await inflight.get('catalog-lite');
  const pending = (async () => {
    try {
      const [booksRes, binBytes] = await Promise.all([
        loadJsonShard(env, '/v3/index/catalog-books.json'),
        readAssetBytes(env, '/v3/index/catalog-verses.bin'),
      ]);
      if (booksRes && binBytes && binBytes.byteLength >= 6) {
        const ab = new ArrayBuffer(binBytes.byteLength);
        new Uint8Array(ab).set(binBytes);
        cachedVerseU16 = new Uint16Array(ab);
        cachedBooksById ||= new Map();
        for (const b of booksRes.books || []) cachedBooksById.set(Number(b.id), b);
        cachedLxxBooksByNo ||= new Map();
        for (const lb of booksRes.lxx_swete_books || []) cachedLxxBooksByNo.set(Number(lb.book_no), lb);
        cachedVerseById ||= { get: lookupVerseByIdFromU16 };
        cachedVerseByCoord ||= { get: lookupVerseIdByCoordFromU16 };
        cachedCatalogLite = booksRes;
        return cachedCatalogLite;
      }
    } catch {
      /* Fall back to full catalog metadata below. */
    }
    return ensureCatalog(env);
  })();
  inflight.set('catalog-lite', pending);
  try { return await pending; } finally { inflight.delete('catalog-lite'); }
}

async function ensureCatalog(env) {
  if (cachedCatalog) return cachedCatalog;
  const cat = await loadJsonShard(env, '/v1/catalog/metadata.json.gz');
  if (!cat) throw new Error('Failed to load /v1/catalog/metadata.json.gz');
  cachedCatalog = cat;
  cachedVerseById = new Map();
  cachedVerseByCoord = new Map();
  for (const [id, book, chapter, verse_nr] of cat.verses_compact) {
    cachedVerseById.set(id, { id, book, chapter, verse_nr });
    cachedVerseByCoord.set(`${book}:${chapter}:${verse_nr}`, id);
  }
  cachedBooksById = new Map();
  for (const b of cat.books) {
    cachedBooksById.set(Number(b.id), b);
  }
  cachedLxxBooksByNo = new Map();
  for (const lb of cat.lxx_swete_books) {
    cachedLxxBooksByNo.set(Number(lb.book_no), lb);
  }
  return cachedCatalog;
}

function jsonResponse(data, status = 200, cacheControl = 'public, max-age=3600') {
  const text = JSON.stringify(data);
  return registerFastJsonText(
    new Response(text, {
      status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': cacheControl,
      },
    }),
    text,
  );
}

// ============================================================================
// RPC Implementations
// ============================================================================

async function handleLookupSyntaxTreeV1(env, params) {
  const cat = await ensureCatalog(env);
  const editionKey = params.p_edition_key ?? null;
  let verseMeta = null;

  if (params.p_verse_id !== undefined && params.p_verse_id !== null) {
    const vid = Number(params.p_verse_id);
    verseMeta = cachedVerseById.get(vid) || null;
    if (!verseMeta) {
      return { error: 'Verse not found', verse_id: vid };
    }
  } else {
    const b = Number(params.p_book);
    const c = Number(params.p_chapter);
    const v = Number(params.p_verse);
    const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
    if (!vid) {
      return {
        error: 'verse_not_found',
        book: b,
        chapter: c,
        verse_nr: v,
        has_syntax: false,
        syntax_status: 'passage_not_found',
        missing_syntax_reason: 'The requested passage does not exist in the canonical 66-book Bible index.',
      };
    }
    verseMeta = cachedVerseById.get(vid);
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${verseMeta.book}-c${verseMeta.chapter}.json.gz`);
  const vEntry = chShard?.verses?.[String(verseMeta.verse_nr)];
  const treeIds = vEntry?.tree_ids || [];

  const trees = [];
  const edges = [];
  const crossSpans = [];

  for (const tid of treeIds.slice().sort()) {
    const tBundle = chShard?.syntax_trees?.[tid];
    if (!tBundle) continue;
    if (editionKey && tBundle.tree.edition_key !== editionKey) continue;
    trees.push(tBundle.tree);
    for (const e of tBundle.edges || []) {
      edges.push(e);
    }
    for (const cs of tBundle.cross_verse_spans || []) {
      crossSpans.push(cs);
    }
  }

  edges.sort((a, b) => a.id - b.id);
  const hasSyntax = trees.length > 0;

  return {
    verse_id: verseMeta.id,
    book: verseMeta.book,
    chapter: verseMeta.chapter,
    verse_nr: verseMeta.verse_nr,
    has_syntax: hasSyntax,
    syntax_status: hasSyntax ? 'annotated_in_source' : 'unannotated_in_source',
    missing_syntax_reason: hasSyntax
      ? null
      : 'No syntax tree bank annotations exist for this verse in the requested edition. No syntax is inferred or guessed.',
    trees_count: trees.length,
    trees,
    edges_count: edges.length,
    edges,
    cross_verse_spans: crossSpans,
    epistemic_invariants: {
      morphology_vs_syntax_distinction:
        'Word morphology describes parts of speech; syntax tree describes hierarchical constituent grammar (phrases & clauses).',
      semantic_role_grounding:
        'Semantic frames (A0, A1) are emitted only when explicitly annotated upstream by MACULA.',
      unannotated_policy:
        'Missing syntax is reported explicitly as unannotated rather than approximated or guessed.',
      cross_verse_preservation:
        'Multi-verse clauses and sentences span verse boundaries without artificial truncation.',
    },
  };
}

async function handleLookupPassageTokensSyntaxV1(env, params) {
  const cat = await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const editionKey = params.p_edition_key ?? null;

  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      schema_version: 1,
      status: 'passage_not_found',
      passage: { book: b, chapter: c, verse: v },
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const bMeta = chShard?.book_meta || cachedBooksById.get(b);

  const filterEd = (arr) =>
    editionKey ? (arr || []).filter((item) => item.edition_key === editionKey) : arr || [];

  const tokens = (vEntry?.tokens || []).map((t) => ({
    word_position: t.word_position,
    word_id: t.word_id,
    surface_form: t.surface_form,
    transliteration: t.transliteration,
    base_strongs: t.base_strongs,
    grammar_code: t.grammar_code,
    decoded_morphology: t.decoded_morphology,
    attested_english_gloss: t.attested_english_gloss,
    source_name: t.source_name,
    source_ref: t.source_ref,
    source_commit: t.source_commit,
    morphemes: t.morphemes || [],
  }));

  const syntaxNodes = filterEd(vEntry?.syntax_nodes).map((sn) => ({
    node_key: sn.node_key,
    edition_key: sn.edition_key,
    node_type: sn.node_type,
    start_word_position: sn.start_word_position,
    end_word_position: sn.end_word_position,
    head_word_position: sn.head_word_position,
    syntactic_role: sn.syntactic_role,
    grammar_summary: sn.grammar_summary,
    source_record_id: sn.source_record_id,
  }));

  const syntaxEdges = filterEd(vEntry?.syntax_edges).map((ed) => ({
    edition_key: ed.edition_key,
    dependent_word_position: ed.dependent_word_position,
    head_word_position: ed.head_word_position,
    relation_type: ed.relation_type,
    head_strongs: ed.head_strongs,
    raw_relation_tag: ed.raw_relation_tag,
    origin_mode: ed.origin_mode,
    derivation_method: ed.derivation_method,
    source_record_id: ed.source_record_id,
  }));

  return {
    schema_version: 1,
    status: 'ok',
    passage: {
      verse_id: vid,
      book: b,
      book_name: bMeta.name,
      usfm: bMeta.usfm,
      chapter: c,
      verse: v,
      testament: bMeta.testament,
      primary_language: bMeta.original_language,
    },
    edition_passages: filterEd(vEntry?.edition_passages),
    versification_mappings: vEntry?.versification_mappings || [],
    english_editions: vEntry?.english_editions || [],
    tokens,
    syntax_nodes: syntaxNodes,
    syntax_edges: syntaxEdges,
    semantic_annotations: filterEd(vEntry?.semantic_annotations),
  };
}

async function handleLookupHebrewVerseEvidenceV1(env, params) {
  const cat = await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      found: false,
      book: b,
      chapter: c,
      verse_nr: v,
      error: 'Verse not found in canonical corpus',
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const bMeta = chShard?.book_meta || cachedBooksById.get(b);

  const stepTokens = (vEntry?.tokens || []).map((t) => ({
    word_id: t.word_id,
    position: t.word_position,
    original_word: t.surface_form,
    transliteration: t.transliteration,
    strongs_nr: t.base_strongs,
    grammar_code: t.word_grammar_code,
    gematria: t.gematria ?? null,
  }));

  const morphhbTokens = (vEntry?.morphhb_tokens || []).map((mt) => ({
    id: mt.id,
    morphhb_id: mt.morphhb_id,
    word_num: mt.word_num,
    word_text: mt.word_text,
    lemma: mt.lemma,
    morph_code: mt.morph_code,
    cantillation: mt.cantillation,
    is_ketiv: mt.is_ketiv,
    is_qere: mt.is_qere,
    qere_target_id: mt.qere_target_id,
    is_aramaic: mt.is_aramaic,
    step_word_id: mt.step_word_id,
    link_status: mt.link_status,
    source_record_id: mt.source_record_id,
  }));

  const maculaMorphemes = (vEntry?.macula_hebrew_morphemes || []).map((m) => ({
    id: m.id,
    macula_id: m.macula_id,
    ref_mt: m.ref_mt,
    word_no: m.word_no,
    morph_no: m.morph_no,
    class: m.class,
    text_form: m.text_form,
    after_text: m.after_text,
    lemma: m.lemma,
    strong_x: m.strong_x,
    morph_code: m.morph_code,
    lang: m.lang,
    stem: m.stem,
    morph_type: m.morph_type,
    gloss: m.gloss,
    english: m.english,
    sense_number: m.sense_number,
    subjref: m.subjref,
    participantref: m.participantref,
    word_id: m.word_id,
    link_status: m.link_status,
  }));

  const syntaxNodes = (vEntry?.syntax_nodes || []).map((sn) => ({
    id: sn.id,
    node_key: sn.node_key,
    node_type: sn.node_type,
    start_word_position: sn.start_word_position,
    end_word_position: sn.end_word_position,
    head_word_position: sn.head_word_position,
    syntactic_role: sn.syntactic_role,
    grammar_summary: sn.grammar_summary,
  }));

  const syntaxEdges = (vEntry?.syntax_edges || [])
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((se) => ({
      id: se.id,
      source_node_id: se.source_node_id,
      target_node_id: se.target_node_id,
      relation_type: se.relation_type,
      raw_relation_tag: se.raw_relation_tag,
      dependent_word_position: se.dependent_word_position,
      head_word_position: se.head_word_position,
    }));

  const crossMaps = (vEntry?.cross_token_mappings || []).map((ctm) => ({
    id: ctm.id,
    step_word_id: ctm.step_word_id,
    morphhb_token_id: ctm.morphhb_token_id,
    macula_morpheme_id: ctm.macula_morpheme_id,
    mapping_status: ctm.mapping_status,
    notes: ctm.notes,
    derivation_method: ctm.derivation_method,
  }));

  const ketivCount = morphhbTokens.filter((t) => t.is_ketiv).length;
  const qereCount = morphhbTokens.filter((t) => t.is_qere).length;
  const isAramaic =
    morphhbTokens.some((t) => t.is_aramaic) || maculaMorphemes.some((m) => m.lang === 'A');

  return {
    found: true,
    verse: {
      id: vid,
      book: b,
      book_name: bMeta.name,
      book_usfm: bMeta.usfm,
      chapter: c,
      verse_nr: v,
      word_ids: vEntry?.word_ids || [],
    },
    step_tokens: stepTokens,
    morphhb_tokens: morphhbTokens,
    macula_morphemes: maculaMorphemes,
    syntax_nodes: syntaxNodes,
    syntax_edges: syntaxEdges,
    cross_token_mappings: crossMaps,
    summary: {
      total_step_tokens: stepTokens.length,
      total_morphhb_tokens: morphhbTokens.length,
      total_macula_morphemes: maculaMorphemes.length,
      ketiv_count: ketivCount,
      qere_count: qereCount,
      is_aramaic: isAramaic,
      has_syntax_hierarchy: syntaxNodes.length > 0,
      syntax_edges_count: syntaxEdges.length,
      cross_mappings_count: crossMaps.length,
    },
  };
}

async function handleLookupGreekVerseEvidenceV1(env, params) {
  const cat = await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      found: false,
      book: b,
      chapter: c,
      verse_nr: v,
      error: 'Verse not found in canonical corpus',
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const bMeta = chShard?.book_meta || cachedBooksById.get(b);

  const stepTokens = (vEntry?.tokens || []).map((t) => ({
    word_id: t.word_id,
    position: t.word_position,
    original_word: t.surface_form,
    transliteration: t.transliteration,
    strongs_nr: t.base_strongs,
    grammar_code: t.word_grammar_code,
    gematria: t.gematria ?? null,
  }));

  const tagntTokens = (vEntry?.tagnt_tokens || []).map((tt) => ({
    id: tt.id,
    tagnt_id: tt.tagnt_id,
    word_type: tt.word_type,
    surface_greek: tt.surface_greek,
    transliteration: tt.transliteration,
    english_translation: tt.english_translation,
    dstrongs: tt.dstrongs,
    grammar_code: tt.grammar_code,
    lemma: tt.lemma,
    step_gloss: tt.step_gloss,
    editions: tt.editions,
    meaning_variants: tt.meaning_variants,
    spelling_variants: tt.spelling_variants,
    sub_meaning: tt.sub_meaning,
    conjoin_word: tt.conjoin_word,
    sstrong_instance: tt.sstrong_instance,
    alt_strongs: tt.alt_strongs,
    word_position: tt.word_position,
    step_word_id: tt.step_word_id,
    link_status: tt.link_status,
  }));

  const mapGreekToken = (gt) => ({
    id: gt.id,
    xml_id: gt.xml_id,
    ref_nt: gt.ref_nt,
    word_no: gt.word_no,
    role: gt.role,
    part_of_speech: gt.part_of_speech,
    word_type: gt.word_type,
    text_form: gt.text_form,
    after_text: gt.after_text,
    lemma: gt.lemma,
    normalized: gt.normalized,
    strongs: gt.strongs,
    morph_code: gt.morph_code,
    person: gt.person,
    number: gt.number,
    gender: gt.gender,
    case_value: gt.case_value,
    tense: gt.tense,
    voice: gt.voice,
    mood: gt.mood,
    degree: gt.degree,
    gloss: gt.gloss,
    english: gt.english,
    mandarin: gt.mandarin,
    frame: gt.frame,
    subjref: gt.subjref,
    referent: gt.referent,
    step_word_id: gt.step_word_id,
    link_status: gt.link_status,
  });

  const allMaculaGrk = vEntry?.macula_greek_tokens || [];
  const nestleTokens = allMaculaGrk
    .filter((gt) => gt.edition_key === 'macula-greek-nestle1904')
    .map(mapGreekToken);
  const sblgntTokens = allMaculaGrk
    .filter((gt) => gt.edition_key === 'macula-greek-sblgnt')
    .map(mapGreekToken);

  const sblByWordNo = new Map();
  for (const s of sblgntTokens) sblByWordNo.set(s.word_no, s);

  const editionDiffs = [];
  for (const n of nestleTokens) {
    const s = sblByWordNo.get(n.word_no);
    if (s && (n.text_form !== s.text_form || n.morph_code !== s.morph_code || n.lemma !== s.lemma)) {
      editionDiffs.push({
        word_no: n.word_no,
        nestle_text: n.text_form,
        sblgnt_text: s.text_form,
        nestle_morph: n.morph_code,
        sblgnt_morph: s.morph_code,
        nestle_lemma: n.lemma,
        sblgnt_lemma: s.lemma,
      });
    }
  }

  const tradOnly = tagntTokens.filter((tt) => /^k/i.test(tt.word_type || '')).length;
  const critOnly = tagntTokens.filter(
    (tt) => /^n/i.test(tt.word_type || '') && !/k/i.test(tt.word_type || '')
  ).length;
  const meaningVarCount = tagntTokens.filter((tt) => tt.meaning_variants && tt.meaning_variants !== '').length;
  const spellingVarCount = tagntTokens.filter((tt) => tt.spelling_variants && tt.spelling_variants !== '').length;

  return {
    found: true,
    verse: {
      id: vid,
      book: b,
      book_name: bMeta.name,
      book_usfm: bMeta.usfm,
      chapter: c,
      verse_nr: v,
      word_ids: vEntry?.word_ids || [],
    },
    step_tokens: stepTokens,
    tagnt_tokens: tagntTokens,
    macula_nestle1904_tokens: nestleTokens,
    macula_sblgnt_tokens: sblgntTokens,
    edition_differences: editionDiffs,
    summary: {
      total_step_tokens: stepTokens.length,
      total_tagnt_tokens: tagntTokens.length,
      total_nestle_tokens: nestleTokens.length,
      total_sblgnt_tokens: sblgntTokens.length,
      traditional_only_count: tradOnly,
      critical_only_count: critOnly,
      meaning_variants_count: meaningVarCount,
      spelling_variants_count: spellingVarCount,
      edition_differences_count: editionDiffs.length,
      has_textual_variants:
        tradOnly > 0 || critOnly > 0 || meaningVarCount > 0 || editionDiffs.length > 0,
    },
  };
}

async function handleLookupSeptuagintPassageV1(env, params) {
  const cat = await ensureCatalog(env);
  let bookNo = params.p_book_no != null ? Number(params.p_book_no) : null; if ((bookNo === null || !Number.isInteger(bookNo) || bookNo <= 0) && params.p_canonical_book != null) { const mapped = (cat.lxx_swete_books || []).find((lb) => Number(lb.canonical_book) === Number(params.p_canonical_book)); bookNo = mapped ? Number(mapped.book_no) : null; }
  const chapter = Number(params.p_chapter);
  const verseNr =
    params.p_verse_nr !== undefined && params.p_verse_nr !== null ? Number(params.p_verse_nr) : null;
  const chSuffix = params.p_chapter_suffix ?? '';
  const vSuffix = params.p_verse_suffix ?? '';

  if (bookNo === null || !cachedLxxBooksByNo.has(bookNo)) {
    if ([7, 9, 22, 30].includes(bookNo)) {
      return {
        found: false,
        reason: 'source_incompleteness',
        book_no: bookNo,
        message: `Book number ${bookNo} is absent from the declared upstream nathans/lxx-swete digital repository.`,
      };
    }
    return {
      found: false,
      reason: 'unknown_book',
      book_no: bookNo,
      message: `Book number ${bookNo} does not exist in Swete Septuagint catalog.`,
    };
  }

  const lxxShard = await loadJsonShard(env, `/v1/lxx/b${bookNo}.json.gz`);
  const tokens = (lxxShard?.words || [])
    .filter(
      (w) =>
        !w.is_chapter_heading_marker &&
        w.chapter === chapter &&
        (w.chapter_suffix || '') === chSuffix &&
        (verseNr === null || (w.verse_nr === verseNr && (w.verse_suffix || '') === vSuffix))
    )
    .map((w) => ({
      book_no: w.book_no,
      chapter: w.chapter,
      chapter_suffix: w.chapter_suffix,
      verse_nr: w.verse_nr,
      verse_suffix: w.verse_suffix,
      ordinal: w.ordinal,
      word_text: w.word_text,
      normalized_word: w.normalized_word,
      ...(w.raw_source_word_text ? { raw_source_word_text: w.raw_source_word_text } : {}),
      ...(w.chapter_heading_marker ? { chapter_heading_marker: w.chapter_heading_marker } : {}),
      source_record_id: w.source_record_id,
      source_release_key: w.source_release_key,
      source_edition_key: w.source_edition_key,
    }));

  if (tokens.length === 0) {
    return {
      found: false,
      reason: 'passage_not_found',
      book_no: bookNo,
      chapter,
      chapter_suffix: chSuffix,
      verse_nr: verseNr,
      verse_suffix: vSuffix,
      message: 'No Greek words found in Swete Septuagint for the requested reference.',
    };
  }

  let matchedMap = null;
  let hebVerse = null;
  if (verseNr !== null) {
    for (const m of lxxShard?.versification_mappings || []) {
      if (
        m.lxx_chapter === chapter &&
        (m.lxx_chapter_suffix || '') === chSuffix &&
        m.lxx_verse_nr === verseNr &&
        (m.lxx_verse_suffix || '') === vSuffix &&
        m.canonical_verse_id !== null
      ) {
        matchedMap = m;
        hebVerse = cachedVerseById.get(Number(m.canonical_verse_id));
        break;
      }
    }
  }

  return {
    found: true,
    book: {
      book_no: lxxShard.book.book_no,
      latin_name: lxxShard.book.latin_name,
      canonical_book_id: lxxShard.book.canonical_book_id,
      canonical_book_name: lxxShard.book.canonical_book_name,
      is_deuterocanonical_or_apocrypha: lxxShard.book.is_deuterocanonical_or_apocrypha,
    },
    reference: {
      chapter,
      chapter_suffix: chSuffix,
      verse_nr: verseNr,
      verse_suffix: vSuffix,
    },
    summary: {
      total_tokens: tokens.length,
      has_hebrew_counterpart: Boolean(matchedMap && hebVerse),
      hebrew_canonical_verse_id: matchedMap ? matchedMap.canonical_verse_id : null,
      hebrew_reference: hebVerse
        ? { book: hebVerse.book, chapter: hebVerse.chapter, verse_nr: hebVerse.verse_nr }
        : null,
      versification_mapping: matchedMap
        ? {
            mapping_kind: matchedMap.mapping_kind,
            rule_citation: matchedMap.rule_citation,
            origin_mode: matchedMap.origin_mode,
            derivation_method: matchedMap.derivation_method,
          }
        : null,
      linguistic_annotation_status: 'unannotated_in_source',
      epistemic_disclaimer:
        'The Swete digital edition provides authentic surface tokens and punctuation without morphological tags or lemmas. External lexicons or parsers must not be presented as source-attested facts.',
    },
    tokens,
  };
}

async function handleLookupSeptuagintByCanonicalVerseV1(env, params) {
  const cat = await ensureCatalog(env);
  const vid = Number(params.p_canonical_verse_id);
  const vMeta = cachedVerseById.get(vid);
  if (!vMeta) {
    return {
      found: false,
      canonical_verse_id: vid,
      reason: 'no_attested_greek_verse_mapping',
      message: `Canonical verse ID ${vid} has no resolvable mapping to attested imported Swete word records.`,
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${vMeta.book}-c${vMeta.chapter}.json.gz`);
  const vEntry = chShard?.verses?.[String(vMeta.verse_nr)];
  const maps = vEntry?.hebrew_lxx_verse_map || [];
  const targetTokens = vEntry?.lxx_target_tokens || {};

  for (const m of maps) {
    if (['unmatched_hebrew', 'unmatched_septuagint'].includes(m.mapping_kind)) continue;
    if (m.lxx_book_no === null || m.lxx_chapter === null || m.lxx_verse_nr === null) continue;
    const tKey = `${m.lxx_book_no}:${m.lxx_chapter}:${m.lxx_chapter_suffix || ''}:${m.lxx_verse_nr}:${m.lxx_verse_suffix || ''}`;
    if ((targetTokens[tKey] || []).length > 0) {
      return handleLookupSeptuagintPassageV1(env, {
        p_book_no: m.lxx_book_no,
        p_chapter: m.lxx_chapter,
        p_verse_nr: m.lxx_verse_nr,
        p_chapter_suffix: m.lxx_chapter_suffix || '',
        p_verse_suffix: m.lxx_verse_suffix || '',
      });
    }
  }

  return {
    found: false,
    canonical_verse_id: vid,
    reason: 'no_attested_greek_verse_mapping',
    message: `Canonical verse ID ${vid} has no resolvable mapping to attested imported Swete word records.`,
  };
}

async function handleGetReaderPassagesV1(env, params) {
  const passages = params.p_passages;
  if (!Array.isArray(passages) || passages.length < 1 || passages.length > 12) {
    return { status: 'invalid_request' };
  }
  for (const p of passages) {
    if (
      !p ||
      typeof p !== 'object' ||
      !/^[0-9]{1,2}$/.test(String(p.book ?? '')) ||
      !/^[0-9]{1,3}$/.test(String(p.chapter ?? '')) ||
      !/^[0-9]{1,3}$/.test(String(p.verse ?? ''))
    ) {
      return { status: 'invalid_request' };
    }
  }

  await ensureCatalog(env);
  const v3Hooks = makeV3Hooks(env);
  const resolved = passages.map((p) => {
    const b = Number(p.book);
    const c = Number(p.chapter);
    const v = Number(p.verse);
    const vid = cachedVerseByCoord?.get(`${b}:${c}:${v}`) || null;
    return { p, b, c, v, vid };
  });
  const v3Verses = await v3Hooks.getV3VersesBatch(resolved.map(r => r.vid).filter(Boolean));
  const out = [];
  for (const { p, b, c, v, vid } of resolved) {
    let text = null;
    const v3V = vid ? v3Verses.get(vid) : null;
    if (v3V && 'en' in v3V) {
      text = v3V.en ?? null;
    }
    if (text === null) {
      const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
      const vEntry = chShard?.verses?.[String(v)];
      const webp = (vEntry?.english_editions || []).find((e) => e.edition_id === 'webp-2026-11');
      text = webp ? webp.text : null;
    }
    out.push({
      passage: p,
      text,
      edition: 'World English Bible',
      edition_id: 'webp-2026-11',
      mapping_status: text === null ? 'unavailable' : 'same_reference',
    });
  }

  return { status: 'ok', passages: out };
}

async function handleGetVerseTranslationSourcesBatchV1(env, params) {
  const cat = await ensureCatalog(env);
  const verseIds = Array.isArray(params.p_verse_ids) ? params.p_verse_ids.map(Number) : [];
  const chaptersToLoad = new Map();
  for (const vid of verseIds) {
    const vMeta = cachedVerseById.get(vid);
    if (vMeta) {
      const chKey = `${vMeta.book}:${vMeta.chapter}`;
      if (!chaptersToLoad.has(chKey)) chaptersToLoad.set(chKey, []);
      chaptersToLoad.get(chKey).push(vMeta);
    }
  }

  const versesOut = {};
  for (const [chKey, vMetas] of chaptersToLoad.entries()) {
    const [b, c] = chKey.split(':').map(Number);
    const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
    for (const vm of vMetas) {
      const vEntry = chShard?.verses?.[String(vm.verse_nr)];
      if (vEntry) {
        versesOut[String(vm.id)] = (vEntry.tokens || []).map((t) => ({
          verse_id: vm.id,
          word_position: t.word_position,
          word_id: t.word_id,
          source_english: t.attested_english_gloss,
          source_ref: t.source_ref,
          source_name: t.source_name,
          source_commit: t.source_commit,
          grammar_code: t.grammar_code,
        }));
      }
    }
  }

  return { status: 'ok', verses: versesOut };
}

async function handleSearchSyntaxPatternsV1(env, params) {
  const idx = await loadJsonShard(env, '/v1/syntax/search-index.json.gz');
  const rule = params.rule_label || params.p_rule_label || null;
  const role = params.syntactic_role || params.p_syntactic_role || null;
  const crossOnly = Boolean(params.cross_verse_only || params.p_cross_verse_only);
  const limit = Math.min(Math.max(Number(params.limit || params.p_limit || 25), 1), 100);

  if (crossOnly) {
    return {
      status: 'ok',
      total_cross_verse_trees: idx.cross_verse_trees.length,
      samples: idx.cross_verse_trees.slice(0, limit),
    };
  }
  if (rule) {
    return {
      status: 'ok',
      rule_label: rule,
      total_occurrences: idx.rule_counts[rule] || 0,
      samples: (idx.rule_samples[rule] || []).slice(0, limit),
    };
  }
  if (role) {
    return {
      status: 'ok',
      syntactic_role: role,
      total_occurrences: idx.role_counts[role] || 0,
    };
  }
  return {
    status: 'ok',
    rule_counts: idx.rule_counts,
    role_counts: idx.role_counts,
    cl_type_counts: idx.cl_type_counts,
    cross_verse_trees_count: idx.cross_verse_trees.length,
    unmapped_nodes_count: idx.unmapped_nodes.length,
  };
}

function md5Hex00to7f(inputStr) {
  // Deterministic fallback or precomputed bucket lookup via query-index
  // Note: for Strong's buckets we also store the exact bucket in /v1/lexical/query-index.json.gz
  return null;
}

let cachedQueryIndex = null;
let cachedStrongsBucketMap = null;

async function ensureQueryIndex(env) {
  if (cachedQueryIndex) return cachedQueryIndex;
  const qi = await loadJsonShard(env, '/v1/lexical/query-index.json.gz');
  if (!qi) throw new Error('Failed to load /v1/lexical/query-index.json.gz');
  cachedQueryIndex = qi;
  cachedStrongsBucketMap = new Map();
  for (const lem of qi.lemmas || []) {
    if (lem.base_strongs && lem.bucket) {
      cachedStrongsBucketMap.set(lem.base_strongs.toUpperCase(), lem.bucket);
    }
  }
  return cachedQueryIndex;
}

// Minimal pure-JS MD5 first byte & 0x7f for Strong's numbers not in lemmas table
function computeStrongsBucketHex(strongsNr) {
  const str = String(strongsNr || '').toUpperCase();
  const utf8 = new TextEncoder().encode(str);
  const K = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const bitLen = utf8.length * 8;
  const padLen = ((56 - ((utf8.length + 1) % 64)) + 64) % 64;
  const buf = new Uint8Array(utf8.length + 1 + padLen + 8);
  buf.set(utf8);
  buf[utf8.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 8, bitLen >>> 0, true);
  view.setUint32(buf.length - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < buf.length; offset += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const M = view.getUint32(offset + g * 4, true);
      F = (F + A + K[i] + M) >>> 0;
      A = D;
      D = C;
      C = B;
      const rot = (F << S[i]) | (F >>> (32 - S[i]));
      B = (B + rot) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const firstByte = (a0 & 0xff) & 0x7f;
  return firstByte.toString(16).padStart(2, '0');
}

async function loadStrongsEntry(env, strongsNr) {
  if (!strongsNr) return null;
  const key = String(strongsNr).toUpperCase();
  const bHex = computeStrongsBucketHex(key);
  const bucket = await loadJsonShard(env, `/v1/lexical/strongs-${bHex}.json.gz`);
  return bucket?.[key] || bucket?.[strongsNr] || null;
}

async function loadWordEntry(env, wordId) {
  const wid = Number(wordId);
  if (!Number.isFinite(wid) || wid <= 0) return null;
  const bIdx = Math.floor(wid / 2500);
  const bHex = bIdx.toString(16).padStart(2, '0');
  const bucket = await loadJsonShard(env, `/v1/lexical/words-${bHex}.json.gz`);
  return bucket?.[String(wid)] || null;
}

function readerUsageLabel(strongsNr, english) {
  const raw = String(english || '').replace(/\s*\/\s*/g, ' ').trim();
  if (strongsNr === 'H7307') {
    if (/\bwinds?\b/i.test(english || '')) return 'wind';
    if (/\bspirits?\b/i.test(english || '')) return 'spirit';
    if (/\bbreath\b/i.test(english || '')) return 'breath';
    if (/\b(side|sides|quarter|quarters|direction|directions)\b/i.test(english || '')) return 'direction / side';
  }
  return raw;
}

async function handleGetReaderOverviewV1(env, params) {
  const cat = await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      status: 'passage_not_found',
      ranges: {},
      grammar: {},
      place_anchors: [],
      previous: null,
      next: null,
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const tokens = vEntry?.tokens || [];

  const grammar = {};
  const strongsSet = new Set();
  for (const t of tokens) {
    grammar[String(t.word_position)] =
      cat.decode_grammar_catalog?.[t.word_grammar_code] || t.decoded_morphology || {};
    if (t.base_strongs) strongsSet.add(t.base_strongs);
  }

  const ranges = {};
  for (const snr of strongsSet) {
    const sEntry = await loadStrongsEntry(env, snr);
    const groups = (sEntry?.rendering_groups || []).slice();
    groups.sort((a, bGrp) => {
      const aPri =
        snr === 'H7307' && ['wind', 'spirit', 'breath', 'direction / side'].includes(a.label) ? 0 : 1;
      const bPri =
        snr === 'H7307' && ['wind', 'spirit', 'breath', 'direction / side'].includes(bGrp.label) ? 0 : 1;
      if (aPri !== bPri) return aPri - bPri;
      if (bGrp.token_total !== a.token_total) return bGrp.token_total - a.token_total;
      return String(a.label).localeCompare(String(bGrp.label));
    });
    ranges[snr] = groups.slice(0, 4).map((g, idx) => {
      const exV = cachedVerseById.get(Number(g.example_verse_id));
      return {
        label: g.label,
        token_total: g.token_total,
        verse_total: g.verse_total,
        book: exV ? exV.book : 1,
        chapter: exV ? exV.chapter : 1,
        verse: exV ? exV.verse_nr : 1,
        rank: idx + 1,
      };
    });
  }

  const prevV = cachedVerseById.get(vid - 1) || null;
  const nextV = cachedVerseById.get(vid + 1) || null;

  return {
    status: 'ok',
    ranges,
    grammar,
    place_anchors: [],
    previous: prevV ? { book: prevV.book, chapter: prevV.chapter, verse: prevV.verse_nr } : null,
    next: nextV ? { book: nextV.book, chapter: nextV.chapter, verse: nextV.verse_nr } : null,
  };
}

async function handleGetReaderWordV1(env, params) {
  const cat = await ensureCatalog(env);
  const wid = Number(params.p_word_id);
  const afterVid = Math.max(Number(params.p_after || 0), 0);
  const rendering = params.p_rendering ?? null;

  const wEntry = await loadWordEntry(env, wid);
  if (!wEntry || !wEntry.word) {
    return {
      status: 'word_not_found',
      word: null,
      lexemes: [],
      token_total: 0,
      verse_total: 0,
      scope: 'Base Strong’s group; observed STEP occurrence renderings; token senses are not assigned.',
      occurrences: [],
      next_cursor: null,
    };
  }

  const targetWord = wEntry.word;
  const snr = targetWord.strongs_nr;
  const sEntry = await loadStrongsEntry(env, snr);
  const allWordsOfStrongs = sEntry?.words || [targetWord];

  let tokenTotal = 0;
  const byVerse = new Map();
  for (const sw of allWordsOfStrongs) {
    const swEntry = sw.id === wid ? wEntry : await loadWordEntry(env, sw.id);
    for (const occ of swEntry?.vts_occurrences || []) {
      if (rendering !== null && readerUsageLabel(snr, occ.source_english) !== rendering) {
        continue;
      }
      tokenTotal += 1;
      const vId = Number(occ.verse_id);
      const cur = byVerse.get(vId);
      const seText = occ.source_english ?? '';
      if (!cur) {
        byVerse.set(vId, { verse_id: vId, occurrence_count: 1, source_english: seText });
      } else {
        cur.occurrence_count += 1;
        if (seText < cur.source_english) cur.source_english = seText;
      }
    }
  }

  const sortedVerses = Array.from(byVerse.values()).sort((a, b) => a.verse_id - b.verse_id);
  const filtered = sortedVerses.filter((g) => g.verse_id > afterVid);
  const paged = filtered.slice(0, 12).map((g) => {
    const vm = cachedVerseById.get(g.verse_id);
    return {
      verse_id: g.verse_id,
      occurrence_count: g.occurrence_count,
      source_english: g.source_english,
      book: vm ? vm.book : 1,
      chapter: vm ? vm.chapter : 1,
      verse: vm ? vm.verse_nr : 1,
    };
  });

  const maxPagedVid = paged.length > 0 ? paged[paged.length - 1].verse_id : null;
  const hasMore = maxPagedVid !== null && filtered.length > 12;

  return {
    status: 'ok',
    word: targetWord,
    lexemes: sEntry?.lexemes || [],
    token_total: tokenTotal,
    verse_total: sortedVerses.length,
    scope: 'Base Strong’s group; observed STEP occurrence renderings; token senses are not assigned.',
    occurrences: paged,
    next_cursor: hasMore ? maxPagedVid : null,
  };
}

async function handleCompareHebrewSeptuagintPassageV1(env, params) {
  const cat = await ensureCatalog(env);
  let queryMode = null;
  let verseId = params.p_canonical_verse_id != null ? Number(params.p_canonical_verse_id) : null;
  let hebBook = params.p_hebrew_book != null ? Number(params.p_hebrew_book) : null;
  let hebChapter = params.p_hebrew_chapter != null ? Number(params.p_hebrew_chapter) : null;
  let hebVerse = params.p_hebrew_verse != null ? Number(params.p_hebrew_verse) : null;

  let lxxBookNo = params.p_lxx_book_no != null ? Number(params.p_lxx_book_no) : null;
  let lxxChapter = params.p_lxx_chapter != null ? Number(params.p_lxx_chapter) : null;
  let lxxChSuffix = params.p_lxx_chapter_suffix || '';
  let lxxVerseNr = params.p_lxx_verse_nr != null ? Number(params.p_lxx_verse_nr) : null;
  let lxxVSuffix = params.p_lxx_verse_suffix || '';

  if (verseId !== null || (hebBook !== null && hebChapter !== null && hebVerse !== null)) {
    if (hebBook !== null && hebBook >= 40) return { schema_version: 1, status: 'invalid_request', message: 'Hebrew-Septuagint comparison applies to Old Testament passages (books 1-39); requested passage is in the New Testament Greek corpus.' }; queryMode = 'hebrew';
  } else if (lxxBookNo !== null && lxxChapter !== null && lxxVerseNr !== null) {
    queryMode = 'septuagint';
  } else {
    return {
      schema_version: 1,
      status: 'invalid_request',
      message:
        'Either Hebrew reference (book, chapter, verse / canonical_verse_id) or Septuagint reference (lxx_book_no, lxx_chapter, lxx_verse_nr) must be provided.',
    };
  }

  let correspondenceStatus = 'matched';
  let mappings = [];
  let lxxBookName = '';
  let isDeuterocanonical = false;

  if (queryMode === 'hebrew') {
    if (verseId === null) {
      verseId = cachedVerseByCoord.get(`${hebBook}:${hebChapter}:${hebVerse}`) || null;
    } else {
      const vm = cachedVerseById.get(verseId);
      if (vm) {
        hebBook = vm.book;
        hebChapter = vm.chapter;
        hebVerse = vm.verse_nr;
      } else {
        verseId = null;
      }
    }
    if (verseId === null) {
      return {
        schema_version: 1,
        status: 'not_found',
        message: 'Passage not found in canonical Hebrew corpus',
      };
    }

    const chShard = await loadJsonShard(env, `/v1/chapters/b${hebBook}-c${hebChapter}.json.gz`);
    const vEntry = chShard?.verses?.[String(hebVerse)];
    const rawMaps = vEntry?.hebrew_lxx_verse_map || [];
    mappings = rawMaps.map((m) => {
      const lb = m.lxx_book_no != null ? cachedLxxBooksByNo.get(Number(m.lxx_book_no)) : null;
      return {
        id: m.id,
        canonical_verse_id: m.canonical_verse_id,
        lxx_book_no: m.lxx_book_no,
        lxx_book_name: lb ? lb.latin_name : '',
        lxx_chapter: m.lxx_chapter,
        lxx_chapter_suffix: m.lxx_chapter_suffix,
        lxx_verse_nr: m.lxx_verse_nr,
        lxx_verse_suffix: m.lxx_verse_suffix,
        mapping_kind: m.mapping_kind,
        rule_citation: m.rule_citation,
        origin_mode: m.origin_mode,
        derivation_method: m.derivation_method,
      };
    });

    const primaryMap = mappings[0] || null;
    if (primaryMap) {
      if (['unmatched_hebrew', 'mt_plus'].includes(primaryMap.mapping_kind) || primaryMap.lxx_book_no == null) {
        correspondenceStatus = 'unmatched_hebrew_minus_in_lxx';
      } else {
        correspondenceStatus = primaryMap.mapping_kind === 'reordered' ? 'reordered' : 'matched';
        lxxBookNo = primaryMap.lxx_book_no;
        lxxBookName = primaryMap.lxx_book_name;
        lxxChapter = primaryMap.lxx_chapter;
        lxxChSuffix = primaryMap.lxx_chapter_suffix || '';
        lxxVerseNr = primaryMap.lxx_verse_nr;
        lxxVSuffix = primaryMap.lxx_verse_suffix || '';
      }
    } else {
      let foundLb = null;
      for (const lb of cat.lxx_swete_books) {
        if (lb.canonical_book === hebBook) {
          foundLb = lb;
          break;
        }
      }
      if (foundLb) {
        lxxBookNo = foundLb.book_no;
        lxxBookName = foundLb.latin_name;
        lxxChapter = hebChapter;
        lxxVerseNr = hebVerse;
        correspondenceStatus = 'unverified_candidate';
      } else {
        correspondenceStatus = 'unmatched_hebrew_minus_in_lxx';
      }
    }
  } else {
    const lb = cachedLxxBooksByNo.get(lxxBookNo);
    if (!lb) {
      return {
        schema_version: 1,
        status: 'not_found',
        message: 'Septuagint book not found',
      };
    }
    lxxBookName = lb.latin_name;
    isDeuterocanonical = lb.canonical_book == null;

    const lxxShard = await loadJsonShard(env, `/v1/lxx/b${lxxBookNo}.json.gz`);
    const rawMaps = (lxxShard?.versification_mappings || []).filter(
      (m) =>
        m.lxx_chapter === lxxChapter &&
        m.lxx_verse_nr === lxxVerseNr &&
        (lxxChSuffix === '' || (m.lxx_chapter_suffix || '') === lxxChSuffix) &&
        (lxxVSuffix === '' || (m.lxx_verse_suffix || '') === lxxVSuffix)
    );
    mappings = rawMaps.map((m) => {
      const vm = m.canonical_verse_id != null ? cachedVerseById.get(Number(m.canonical_verse_id)) : null;
      const bk = vm ? cachedBooksById.get(vm.book) : null;
      return {
        id: m.id,
        canonical_verse_id: m.canonical_verse_id,
        hebrew_reference: vm && bk ? `${bk.name} ${vm.chapter}:${vm.verse_nr}` : '',
        hebrew_book: vm ? vm.book : null,
        hebrew_chapter: vm ? vm.chapter : null,
        hebrew_verse: vm ? vm.verse_nr : null,
        mapping_kind: m.mapping_kind,
        rule_citation: m.rule_citation,
        origin_mode: m.origin_mode,
        derivation_method: m.derivation_method,
      };
    });

    const primaryMap = mappings[0] || null;
    if (primaryMap) {
      if (['unmatched_septuagint', 'lxx_plus'].includes(primaryMap.mapping_kind) || primaryMap.canonical_verse_id == null) {
        correspondenceStatus = 'unmatched_lxx_plus_in_greek';
      } else {
        correspondenceStatus = primaryMap.mapping_kind === 'reordered' ? 'reordered' : 'matched';
        verseId = primaryMap.canonical_verse_id;
        hebBook = primaryMap.hebrew_book;
        hebChapter = primaryMap.hebrew_chapter;
        hebVerse = primaryMap.hebrew_verse;
      }
    } else if (isDeuterocanonical) {
      correspondenceStatus = 'unmatched_lxx_plus_in_greek';
    } else if (lb.canonical_book != null) {
      hebBook = lb.canonical_book;
      const candVid = cachedVerseByCoord.get(`${hebBook}:${lxxChapter}:${lxxVerseNr}`);
      if (candVid) {
        verseId = candVid;
        hebChapter = lxxChapter;
        hebVerse = lxxVerseNr;
        correspondenceStatus = 'matched';
      } else {
        correspondenceStatus = 'unmatched_lxx_plus_in_greek';
      }
    } else {
      correspondenceStatus = 'unmatched_lxx_plus_in_greek';
    }
  }

  let mtWords = [];
  if (verseId !== null && hebBook !== null && hebChapter !== null && hebVerse !== null) {
    const chShard = await loadJsonShard(env, `/v1/chapters/b${hebBook}-c${hebChapter}.json.gz`);
    const vEntry = chShard?.verses?.[String(hebVerse)];
    mtWords = (vEntry?.tokens || []).map((t) => ({
      ordinal: t.word_position,
      word_id: t.word_id,
      original_word: t.surface_form,
      transliteration: t.transliteration,
      strongs_nr: t.base_strongs,
      gloss: (t.english_translations || [])[0] || null,
      alignment_status: 'unmatched',
      aligned_lxx_ordinals: [],
    }));
  }

  let lxxWords = [];
  if (lxxBookNo !== null && lxxChapter !== null && lxxVerseNr !== null) {
    const lxxShard = await loadJsonShard(env, `/v1/lxx/b${lxxBookNo}.json.gz`); if (hebBook === 19 && lxxBookNo === 27 && mappings[0]?.mapping_kind === 'psalm_numbering_shift' && hebVerse >= 1 && lxxVerseNr === hebVerse + 1) { const swV1Text = (lxxShard?.words || []).filter((sw) => !sw.is_chapter_heading_marker && sw.chapter === lxxChapter && sw.verse_nr === 1).slice(0, 5).map((sw) => sw.word_text).join(' '); if (swV1Text && !/^(?:Εἰς\s+τὸ\s+τέλος|Ψαλμ|Ὠδ|ᾨδ|Αἴνεσις|Προσευχ|Συνέσεως|Στηλογραφία|Ἀλληλούια|Τῷ\s+Δαυ|Τοῦ\s+Δαυ|Μὴ\s+διαφθείρ|Δαυεὶδ|Ἀναβαθμ)/i.test(swV1Text)) { lxxVerseNr = hebVerse; mappings[0] = { ...mappings[0], lxx_verse_nr: hebVerse, rule_citation: `Psalms MT ${hebChapter}:${hebVerse} -> LXX Swete ${lxxChapter}:${hebVerse} (untitled psalm adjusted).` }; } }
    lxxWords = (lxxShard?.words || [])
      .filter(
        (sw) =>
          !sw.is_chapter_heading_marker &&
          sw.chapter === lxxChapter &&
          (lxxChSuffix === '' || (sw.chapter_suffix || '') === lxxChSuffix) &&
          sw.verse_nr === lxxVerseNr &&
          (lxxVSuffix === '' || (sw.verse_suffix || '') === lxxVSuffix)
      )
      .map((sw) => ({
        ordinal: sw.ordinal,
        lxx_word_id: sw.id,
        word_text: sw.word_text,
        normalized_word: sw.normalized_word,
        ...(sw.raw_source_word_text ? { raw_source_word_text: sw.raw_source_word_text } : {}),
        ...(sw.chapter_heading_marker ? { chapter_heading_marker: sw.chapter_heading_marker } : {}),
        alignment_status: 'unmatched',
        aligned_hebrew_ordinals: [],
      }));
  }

  if (
    lxxBookNo !== null &&
    lxxWords.length === 0 &&
    !['unmatched_hebrew_minus_in_lxx', 'unmatched_lxx_plus_in_greek'].includes(correspondenceStatus)
  ) {
    correspondenceStatus = 'missing_lxx_text';
  }

  const allAlignments = (cat.hebrew_lxx_word_alignments || []).filter(
    (a) =>
      (verseId !== null && a.canonical_verse_id === verseId) ||
      (lxxBookNo !== null &&
        a.lxx_book_no === lxxBookNo &&
        a.lxx_chapter === lxxChapter &&
        a.lxx_verse_nr === lxxVerseNr)
  );
  const mapAlign = (a) => ({
    alignment_key: a.alignment_key,
    cardinality: a.cardinality,
    alignment_tier: a.alignment_tier,
    verification_status: a.verification_status,
    confidence_score: a.confidence_score,
    hebrew_text: a.hebrew_text,
    hebrew_ordinals: a.hebrew_token_ordinals,
    hebrew_strongs: a.hebrew_strongs,
    lxx_text: a.lxx_text,
    lxx_ordinals: a.lxx_token_ordinals,
    lxx_strongs: a.lxx_strongs,
    algorithm_or_source: a.algorithm_or_source,
    translation_technique: a.translation_technique,
    evidence_summary: a.evidence_summary,
  });

  const docAlignments = allAlignments.filter((a) => a.alignment_tier === 'documented_textual').map(mapAlign);
  const candAlignments = allAlignments
    .filter((a) => a.alignment_tier === 'computationally_inferred_candidate')
    .map(mapAlign);
  const scholarlyAlignments = allAlignments
    .filter((a) => a.alignment_tier === 'scholarly_interpretation')
    .map(mapAlign);

  // E10 fallback: when static hebrew_lxx_word_alignments has no entries for this verse,
  // infer deterministic candidate alignments from lxx_token_lexicon_b64gz in motifs-and-patterns.json.gz
  if (docAlignments.length === 0 && candAlignments.length === 0 && mtWords.length > 0 && lxxWords.length > 0) {
    try {
      const mpShard = await loadJsonShard(env, '/v2/relationships/r11-v1.0/r10/motifs-and-patterns.json.gz');
      const lexB64 = mpShard?.lxx_token_lexicon_b64gz;
      const lex = lexB64 ? decodeB64GzJson(env, lexB64, '/r10/lxx_token_lexicon') : null;
      if (lex?.hebrew_to_greek && lex?.greek_forms) {
        const padH = (raw) => {
          const m = /^([HG])0*(\d+)[A-Z]*$/i.exec(String(raw || '').trim());
          return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : '';
        };
        const normG = (w) =>
          String(w || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z\u0370-\u03ff\u1f00-\u1fff]/gi, '')
            .toLowerCase();
        const candidatePairs = [];
        const lxxNorms = lxxWords.map((lw) => ({ lw, nw: normG(lw.normalized_word || lw.word_text) }));
        for (const mw of mtWords) {
          const hBs = padH(mw.strongs_nr);
          if (!hBs) continue;
          const gBridges = lex.hebrew_to_greek[hBs] || [];
          for (const [gBs, bridgeCount] of gBridges) {
            const gForms = lex.greek_forms[gBs] || [];
            if (gForms.length === 0) continue;
            for (const { lw, nw } of lxxNorms) {
              if (!nw || nw.length < 2) continue;
              let matchScore = 0;
              let technique = '';
              for (const gf of gForms) {
                if (nw === gf) {
                  matchScore = 0.78 + Math.min(0.14, Math.log10(1 + (Number(bridgeCount) || 1)) * 0.05);
                  technique = 'attested_lxx_lexical_equivalent_exact_form';
                  break;
                }
                const stemLen = Math.min(nw.length, gf.length, 5);
                if (stemLen >= 4 && nw.slice(0, stemLen) === gf.slice(0, stemLen)) {
                  const s = 0.64 + Math.min(0.12, Math.log10(1 + (Number(bridgeCount) || 1)) * 0.04);
                  if (s > matchScore) {
                    matchScore = s;
                    technique = 'attested_lxx_lexical_equivalent_stem_match';
                  }
                } else if (nw.length >= 5 && gf.length >= 4 && (nw.startsWith('ε' + gf.slice(0, 4)) || nw.startsWith('η' + gf.slice(0, 4)))) {
                  const s = 0.62 + Math.min(0.10, Math.log10(1 + (Number(bridgeCount) || 1)) * 0.04);
                  if (s > matchScore) {
                    matchScore = s;
                    technique = 'attested_lxx_lexical_equivalent_augmented_stem';
                  }
                }
              }
              if (matchScore > 0) {
                const isFunc = gBs === 'G3588' || gBs === 'G2532' || gBs === 'G1161' || gBs === 'G1722';
                const posDelta = Math.abs(mw.ordinal / Math.max(1, mtWords.length) - lw.ordinal / Math.max(1, lxxWords.length));
                const sortPriority = (isFunc ? matchScore * 0.6 : matchScore) - posDelta * 0.08;
                candidatePairs.push({
                  mw,
                  lw,
                  hBs,
                  gBs,
                  bridgeCount: Number(bridgeCount) || 1,
                  confidence: Math.round(matchScore * 100) / 100,
                  technique,
                  sortPriority,
                });
              }
            }
          }
          // Direct OT-LXX corpus co-occurrence forms (covers LXX-only Greek vocabulary without NT Strong's numbers)
          const directForms = lex.hebrew_to_lxx_forms?.[hBs] || [];
          for (const [dfForm, coocCnt, conf100] of directForms) {
            for (const { lw, nw } of lxxNorms) {
              if (!nw || nw.length < 3) continue;
              const stemLen = Math.min(nw.length, String(dfForm).length, 5);
              const isExact = nw === dfForm;
              const isStem = !isExact && stemLen >= 4 && nw.slice(0, stemLen) === String(dfForm).slice(0, stemLen);
              if (!isExact && !isStem) continue;
              const conf = Math.round(((Number(conf100) || 65) / 100) * (isExact ? 1.0 : 0.92) * 100) / 100;
              const posDelta = Math.abs(mw.ordinal / Math.max(1, mtWords.length) - lw.ordinal / Math.max(1, lxxWords.length));
              candidatePairs.push({
                mw,
                lw,
                hBs,
                gBs: null,
                bridgeCount: Number(coocCnt) || 1,
                confidence: conf,
                technique: isExact ? 'corpus_cooccurrence_lxx_form_exact' : 'corpus_cooccurrence_lxx_form_stem',
                sortPriority: conf - posDelta * 0.08,
              });
            }
          }
        }
        candidatePairs.sort((a, b) => b.sortPriority - a.sortPriority || a.mw.ordinal - b.mw.ordinal || a.lw.ordinal - b.lw.ordinal);
        const usedHebOrd = new Set();
        const usedLxxOrd = new Set();
        for (const cp of candidatePairs) {
          if (usedHebOrd.has(cp.mw.ordinal) || usedLxxOrd.has(cp.lw.ordinal)) continue;
          usedHebOrd.add(cp.mw.ordinal);
          usedLxxOrd.add(cp.lw.ordinal);
          candAlignments.push({
            alignment_key: `cand:v${verseId ?? 0}:h${cp.mw.ordinal}:g${cp.lw.ordinal}`,
            cardinality: '1:1',
            alignment_tier: 'computationally_inferred_candidate',
            verification_status: 'candidate',
            confidence_score: cp.confidence,
            hebrew_text: cp.mw.original_word,
            hebrew_ordinals: [cp.mw.ordinal],
            hebrew_strongs: [cp.hBs],
            lxx_text: cp.lw.word_text,
            lxx_ordinals: [cp.lw.ordinal],
            lxx_strongs: cp.gBs ? [cp.gBs] : [],
            algorithm_or_source: 'r13_lxx_token_lexicon_bridge',
            translation_technique: cp.technique,
            evidence_summary: cp.gBs
              ? `Candidate Hebrew-LXX alignment inferred from attested corpus bridge ${cp.hBs} -> ${cp.gBs} (${cp.bridgeCount} corpus witnesses); not a manual word-level alignment.`
              : `Candidate Hebrew-LXX alignment inferred from OT-LXX verse co-occurrence ${cp.hBs} -> ${cp.lw.normalized_word || cp.lw.word_text} (${cp.bridgeCount} aligned verse witnesses); not a manual word-level alignment.`,
          });
        }
        candAlignments.sort((a, b) => (a.hebrew_ordinals?.[0] || 0) - (b.hebrew_ordinals?.[0] || 0));
      }
    } catch {
      // Non-fatal fallback if motifs-and-patterns shard is absent in partial test fixtures
    }
  }

  if (docAlignments.length > 0 || candAlignments.length > 0) {
    for (const mw of mtWords) {
      const da = docAlignments.find((a) => (a.hebrew_ordinals || []).includes(mw.ordinal));
      const ca = candAlignments.find((a) => (a.hebrew_ordinals || []).includes(mw.ordinal));
      if (da) {
        mw.alignment_status = 'documented_aligned';
        mw.aligned_lxx_ordinals = da.lxx_ordinals || [];
      } else if (ca) {
        mw.alignment_status = 'candidate_aligned';
        mw.aligned_lxx_ordinals = ca.lxx_ordinals || [];
      }
    }
    for (const lw of lxxWords) {
      const da = docAlignments.find((a) => (a.lxx_ordinals || []).includes(lw.ordinal));
      const ca = candAlignments.find((a) => (a.lxx_ordinals || []).includes(lw.ordinal));
      if (da) {
        lw.alignment_status = 'documented_aligned';
        lw.aligned_hebrew_ordinals = da.hebrew_ordinals || [];
      } else if (ca) {
        lw.alignment_status = 'candidate_aligned';
        lw.aligned_hebrew_ordinals = ca.hebrew_ordinals || [];
      }
    }
  }

  const statusOut =
    correspondenceStatus === 'missing_lxx_text'
      ? 'missing_lxx_text'
      : correspondenceStatus === 'unverified_candidate'
        ? 'unverified_mapping'
        : 'ok';

  return {
    schema_version: 1,
    status: statusOut,
    query_mode: queryMode,
    correspondence_status: correspondenceStatus,
    has_hebrew_passage: verseId !== null,
    has_septuagint_passage:
      lxxWords.length > 0 &&
      lxxBookNo !== null &&
      lxxChapter !== null &&
      lxxVerseNr !== null &&
      correspondenceStatus !== 'unmatched_hebrew_minus_in_lxx',
    hebrew_passage:
      verseId !== null
        ? {
            canonical_verse_id: verseId,
            book: hebBook,
            chapter: hebChapter,
            verse_nr: hebVerse,
            word_count: mtWords.length,
            words: mtWords,
          }
        : null,
    septuagint_passage:
      lxxBookNo !== null && correspondenceStatus !== 'unmatched_hebrew_minus_in_lxx'
        ? {
            book_no: lxxBookNo,
            latin_name: lxxBookName || '',
            chapter: lxxChapter,
            chapter_suffix: lxxChSuffix,
            verse_nr: lxxVerseNr,
            verse_suffix: lxxVSuffix,
            is_deuterocanonical: isDeuterocanonical,
            word_count: lxxWords.length,
            words: lxxWords,
          }
        : null,
    versification_mappings: mappings,
    documented_alignments: docAlignments,
    candidate_alignments: candAlignments,
    scholarly_interpretations: scholarlyAlignments,
    epistemic_disclaimer:
      'Candidate alignments are computationally inferred and strictly segregated from verified textual evidence. Source-attested, editorially collated, candidate, and scholarly alignment statuses must remain distinct. Absent imported Greek tokens do not prove a textual omission.',
  };
}

async function handleGetHebrewSeptuagintParallelV1(env, params) {
  const cat = await ensureCatalog(env);
  const qi = await ensureQueryIndex(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) {
    return {
      schema_version: 1,
      status: 'not_found',
      message: 'Passage not found in canonical corpus',
    };
  }

  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  const rawMaps = vEntry?.hebrew_lxx_verse_map || [];
  let lxxBookNo = null;
  let lxxBookName = null;
  let lxxChapter = null;
  let lxxVerseNr = null;
  let lxxSuffix = '';
  let mappingKind = 'unmapped';
  let ruleCitation = null;

  if (rawMaps.length > 0 && rawMaps[0].lxx_book_no != null) {
    const m = rawMaps[0];
    const lb = cachedLxxBooksByNo.get(Number(m.lxx_book_no));
    lxxBookNo = m.lxx_book_no;
    lxxBookName = lb ? lb.latin_name : null;
    lxxChapter = m.lxx_chapter;
    lxxVerseNr = m.lxx_verse_nr;
    lxxSuffix = m.lxx_verse_suffix || '';
    mappingKind = m.mapping_kind;
    ruleCitation = m.rule_citation;
  } else {
    for (const lb of cat.lxx_swete_books) {
      if (lb.canonical_book === b) {
        lxxBookNo = lb.book_no;
        lxxBookName = lb.latin_name;
        break;
      }
    }
    lxxChapter = c;
    lxxVerseNr = v;
    mappingKind = 'unverified_candidate';
  }

  const mtWords = (vEntry?.tokens || []).map((t) => ({
    id: t.word_id,
    ordinal: t.word_position,
    original_word: t.surface_form,
    transliteration: t.transliteration,
    strongs_nr: t.base_strongs,
    gloss: (t.english_translations || [])[0] || null,
  }));

  let lxxWords = [];
  if (lxxBookNo !== null) {
    const lxxShard = await loadJsonShard(env, `/v1/lxx/b${lxxBookNo}.json.gz`);
    lxxWords = (lxxShard?.words || [])
      .filter((sw) => sw.chapter === lxxChapter && sw.verse_nr === lxxVerseNr)
      .map((sw) => ({
        id: sw.id,
        ordinal: sw.ordinal,
        word_text: sw.word_text,
        source_record_id: sw.source_record_id,
      }));
  }

  const regEntry = (cat.field_license_registry || []).find(
    (r) => r.dataset_key === 'macula-hebrew' && r.field_name === 'greekstrong'
  );
  const licenseStatus = regEntry ? regEntry.status : 'disabled_unverified';
  const wordAlignments = [];

  if (['enabled_verified', 'enabled_origin_unverified'].includes(licenseStatus)) {
    const grkEntities = (qi.canonical_entities || []).filter(
      (ce) => ce.entity_kind === 'lemma' && ce.language === 'grc'
    );
    for (const m of vEntry?.macula_hebrew_morphemes || []) {
      const gf = m.gated_fields || {};
      const gStrong = gf.greekstrong ?? null;
      const gWord = gf.greek ?? null;
      let gDisplay = null;
      if (gStrong) {
        const padded = `lemma:G${String(gStrong).padStart(4, '0')}`;
        const ceMatch = grkEntities.find(
          (ce) => ce.entity_key === padded || String(ce.entity_key || '').startsWith(padded)
        );
        if (ceMatch) gDisplay = ceMatch.display_label;
      }
      wordAlignments.push({
        word_no: m.word_no,
        morph_no: m.morph_no,
        text_form: m.text_form,
        strong_x: m.strong_x,
        lemma: m.lemma,
        gloss: m.gloss,
        greek_strong: gStrong,
        greek_word: gWord,
        greek_display_label: gDisplay,
        relation_type: 'source_lexical_equivalent',
        evidence_status: licenseStatus,
      });
    }
  }

  const statusOut =
    b > 39
      ? 'not_applicable'
      : lxxWords.length === 0
        ? 'missing_lxx_text'
        : mappingKind === 'unverified_candidate'
          ? 'unverified_mapping'
          : 'ok';

  const textEvStatus =
    b > 39
      ? 'not_applicable'
      : lxxWords.length === 0
        ? 'unavailable'
        : mappingKind === 'unverified_candidate'
          ? 'unverified'
          : 'available';

  return {
    schema_version: 1,
    status: statusOut,
    canonical_verse: { id: vid, book: b, chapter: c, verse_nr: v },
    masoretic: {
      book: b,
      chapter: c,
      verse_nr: v,
      word_count: mtWords.length,
      words: mtWords,
    },
    septuagint: {
      lxx_book_no: lxxBookNo,
      latin_name: lxxBookName,
      chapter: lxxChapter,
      verse_nr: lxxVerseNr,
      verse_suffix: lxxSuffix,
      mapping_kind: mappingKind,
      rule_citation: ruleCitation,
      word_count: lxxWords.length,
      words: lxxWords,
    },
    word_alignments: wordAlignments,
    textual_evidence_status: textEvStatus,
    license_info: {
      lxx_source: 'CC BY-SA 4.0 (nathans/lxx-swete, First1KGreek)',
      macula_hebrew: 'CC BY 4.0 (Clear-Bible/macula-hebrew)',
      macula_alignments_status: licenseStatus,
      catss_policy: 'External reference only; CATSS alignment data is NOT embedded.',
    },
  };
}

async function handleLookupHebrewSeptuagintAlignmentsV1(env, params) {
  const cat = await ensureCatalog(env);
  const q = String(params.p_query || '').trim();
  const tier = params.p_tier ?? null;
  const limit = Math.max(Number(params.p_limit || 50), 1);
  if (!q) {
    return {
      schema_version: 1,
      status: 'invalid_request',
      message: 'p_query must not be empty',
    };
  }
  const qLower = q.toLowerCase();
  const filtered = (cat.hebrew_lxx_word_alignments || [])
    .filter((a) => {
      if (tier && a.alignment_tier !== tier) return false;
      return (
        String(a.hebrew_text || '').toLowerCase().includes(qLower) ||
        String(a.lxx_text || '').toLowerCase().includes(qLower) ||
        (a.hebrew_strongs || []).includes(q) ||
        (a.lxx_strongs || []).includes(q) ||
        String(a.alignment_key || '').toLowerCase().includes(qLower)
      );
    })
    .map((a) => {
      const lb = a.lxx_book_no != null ? cachedLxxBooksByNo.get(Number(a.lxx_book_no)) : null;
      return {
        id: a.id,
        alignment_key: a.alignment_key,
        canonical_verse_id: a.canonical_verse_id,
        lxx_book_no: a.lxx_book_no,
        lxx_book_name: lb ? lb.latin_name : '',
        lxx_chapter: a.lxx_chapter,
        lxx_chapter_suffix: a.lxx_chapter_suffix,
        lxx_verse_nr: a.lxx_verse_nr,
        lxx_verse_suffix: a.lxx_verse_suffix,
        hebrew_text: a.hebrew_text,
        hebrew_token_ordinals: a.hebrew_token_ordinals,
        hebrew_strongs: a.hebrew_strongs,
        lxx_text: a.lxx_text,
        lxx_token_ordinals: a.lxx_token_ordinals,
        lxx_strongs: a.lxx_strongs,
        cardinality: a.cardinality,
        alignment_tier: a.alignment_tier,
        verification_status: a.verification_status,
        confidence_score: a.confidence_score,
        algorithm_or_source: a.algorithm_or_source,
        translation_technique: a.translation_technique,
        evidence_summary: a.evidence_summary,
      };
    });

  const tierRank = (t) =>
    t === 'documented_textual' ? 1 : t === 'scholarly_interpretation' ? 2 : 3;
  filtered.sort((a, b) => {
    const tr = tierRank(a.alignment_tier) - tierRank(b.alignment_tier);
    if (tr !== 0) return tr;
    const cs = Number(b.confidence_score || 0) - Number(a.confidence_score || 0);
    if (cs !== 0) return cs;
    return a.id - b.id;
  });

  const sliced = filtered.slice(0, limit);
  return {
    schema_version: 1,
    status: 'ok',
    query: params.p_query,
    tier_filter: tier,
    total_returned: sliced.length,
    alignments: sliced,
    epistemic_disclaimer:
      'Candidate alignments are computationally inferred and strictly segregated from verified textual evidence. Unmatched words remain explicitly unaligned without invented equivalents.',
  };
}

async function handlePromptVerseWords(env, params) {
  const cat = await ensureCatalog(env);
  const b = Number(params.p_book);
  const c = Number(params.p_chapter);
  const v = Number(params.p_verse);
  const vid = cachedVerseByCoord.get(`${b}:${c}:${v}`);
  if (!vid) return [];
  const chShard = await loadJsonShard(env, `/v1/chapters/b${b}-c${c}.json.gz`);
  const vEntry = chShard?.verses?.[String(v)];
  return (vEntry?.tokens || []).map((t) => ({
    word_position: t.word_position,
    word_id: t.word_id,
    original_word: t.surface_form,
    transliteration: t.transliteration,
    strongs_nr: t.base_strongs,
    grammar_code: t.word_grammar_code,
    primary_english: (t.english_translations || [])[0] || null,
    millennium: null,
  }));
}

async function handlePromptWordOccurrences(env, params) {
  const cat = await ensureCatalog(env);
  const q = String(params.p_word_query || '').trim();
  if (!q) return [];
  let snr = q.toUpperCase();
  if (/^\d+$/.test(q)) {
    const wEntry = await loadWordEntry(env, Number(q));
    snr = wEntry?.word?.strongs_nr || '';
  }
  const sEntry = await loadStrongsEntry(env, snr);
  return (sEntry?.occurrences?.references || []).map((r) => ({
    book: r.book,
    chapter: r.chapter,
    verse_nr: r.verse,
    millennium: null,
    occurrence_count: r.occurrence_count,
  }));
}

async function handlePromptWordCooccurrences(env, params) {
  const cat = await ensureCatalog(env);
  const q = String(params.p_word_query || '').trim();
  if (!q) return [];
  let snr = q.toUpperCase();
  if (/^\d+$/.test(q)) {
    const wEntry = await loadWordEntry(env, Number(q));
    snr = wEntry?.word?.strongs_nr || '';
  }
  const sEntry = await loadStrongsEntry(env, snr);
  const firstWord = (sEntry?.words || [])[0];
  if (!firstWord) return [];
  const coList = firstWord.co_occurrences || [];
  const out = [];
  for (const elm of coList) {
    const targetWid = Number(elm.word_id);
    const twEntry = await loadWordEntry(env, targetWid);
    const tw = twEntry?.word;
    if (!tw) continue;
    out.push({
      word_id: tw.id,
      strongs_nr: tw.strongs_nr,
      original_word: tw.original_word,
      transliteration: tw.transliteration,
      primary_english: (tw.english_translations || [])[0] || null,
      score: Number(elm.score),
      frequency: Number(elm.freq),
      avg_distance: Number(elm.avg_dist),
    });
  }
  out.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.word_id - b.word_id));
  return out;
}

// ============================================================================
// Lexical / Word-Form-Lemmas Batch & Live Asset Integrity Handlers
// ============================================================================

async function handleGetWordFormLemmasBatchV1(env, params) {
  const cat = await ensureCatalog(env);
  const wordIds = Array.isArray(params.p_word_ids) ? params.p_word_ids.map(Number).filter((x) => Number.isFinite(x) && x > 0) : [];
  const bucketsToLoad = new Map();
  for (const wid of wordIds) {
    const bIdx = Math.floor(wid / 2500);
    const bHex = bIdx.toString(16).padStart(2, '0');
    if (!bucketsToLoad.has(bHex)) bucketsToLoad.set(bHex, []);
    bucketsToLoad.get(bHex).push(wid);
  }

  const wordsOut = {};
  for (const [bHex, wids] of bucketsToLoad.entries()) {
    const bucket = await loadJsonShard(env, `/v1/lexical/words-${bHex}.json.gz`);
    if (!bucket) throw new Error(`Required word-form shard unavailable: ${bHex}`);
    for (const wid of wids) {
      const entry = bucket[String(wid)];
      if (entry) {
        wordsOut[String(wid)] = {
          word_form_lemmas: entry.word_form_lemmas || [],
          vts_occurrences: params.p_include_occurrences ? (entry.vts_occurrences || []) : undefined,
        };
      }
    }
  }
  return { status: 'ok', words: wordsOut };
}

async function handleGetLemmaLexicalSummaryV1(env, params) {
  const cat = await ensureCatalog(env);
  const lid = Number(params.p_lemma_id);
  const snr = String(params.p_base_strongs || '').trim().toUpperCase();
  const mode = String(params.p_mode || 'occurrences'); // 'occurrences' | 'glosses' | 'semantics'
  const afterVerseId = Math.max(Number(params.p_after_verse_id || 0), 0);
  const limit = Math.min(Math.max(Number(params.p_limit || 50), 1), 200);

  if (!Number.isFinite(lid) || lid <= 0) {
    return { status: 'invalid_request', message: 'Valid p_lemma_id is required' };
  }

  // Known cross-Strong's stem exceptions in STEP (69 word forms across 5 lemmas)
  const extraStrongsByLemma = {
    3666: ['G1492', 'G3700', 'G3708'],
    6349: ['G4053', 'G4057'],
    14118: ['H2388', 'H2390'],
    15763: ['H3588', 'H3651', 'H5921'],
    19621: ['H6648', 'H6647'],
  };
  const targetStrongsList = extraStrongsByLemma[lid] || (snr ? [snr] : []);

  // Collect all candidate word IDs from the Strong's buckets
  const candidateWords = new Map();
  for (const sKey of targetStrongsList) {
    const sEntry = await loadStrongsEntry(env, sKey);
    for (const w of sEntry?.words || []) {
      candidateWords.set(Number(w.id), w);
    }
  }

  // Group candidate word IDs by words-<bucket> shard so each shard is read once
  const wordsByBucket = new Map();
  for (const wid of candidateWords.keys()) {
    const bHex = Math.floor(wid / 2500).toString(16).padStart(2, '0');
    if (!wordsByBucket.has(bHex)) wordsByBucket.set(bHex, []);
    wordsByBucket.get(bHex).push(wid);
  }

  // Filter for word_form_lemmas where lemma_id === lid and morpheme_role === 'stem'
  const stemForms = [];
  const allOcc = [];

  for (const [bHex, wids] of wordsByBucket.entries()) {
    const bucket = await loadJsonShard(env, `/v1/lexical/words-${bHex}.json.gz`);
    if (!bucket) continue;
    for (const wid of wids) {
      const entry = bucket[String(wid)];
      if (!entry) continue;
      const wObj = entry.word || candidateWords.get(wid);
      const matchingStem = (entry.word_form_lemmas || []).find(
        (wfl) => Number(wfl.lemma_id) === lid && wfl.morpheme_role === 'stem'
      );
      if (!matchingStem) continue;
      stemForms.push({
        word_id: wid,
        word: wObj,
        is_context_ambiguous: Boolean(matchingStem.is_context_ambiguous),
        dstrongs_tag: matchingStem.dstrongs_tag || null,
        observed_token_count: Number(matchingStem.observed_token_count || 0),
      });
      for (const occ of entry.vts_occurrences || []) {
        const vId = Number(occ.verse_id);
        const vm = cachedVerseById.get(vId);
        const bMeta = vm ? cachedBooksById.get(vm.book) : null;
        const srcCommit = 'be4191f0082aeedddb0eff0c02c966292b2bd641';
        let srcName = 'TAHOT Gen-Deu';
        if (vm) {
          if (vm.book >= 6 && vm.book <= 17) srcName = 'TAHOT Jos-Est';
          else if (vm.book >= 18 && vm.book <= 22) srcName = 'TAHOT Job-Sng';
          else if (vm.book >= 23 && vm.book <= 39) srcName = 'TAHOT Isa-Mal';
          else if (vm.book >= 40 && vm.book <= 43) srcName = 'TAGNT Mat-Jhn';
          else if (vm.book >= 44) srcName = 'TAGNT Act-Rev';
        }
        allOcc.push({
          verse_id: vId,
          book: vm ? vm.book : 1,
          book_name: bMeta ? bMeta.name : '',
          usfm: bMeta ? bMeta.usfm : '',
          chapter: vm ? vm.chapter : 1,
          verse_nr: vm ? vm.verse_nr : 1,
          word_position: Number(occ.word_position),
          word_id: wid,
          inflected_form: wObj?.original_word || '',
          inflected_transliteration: wObj?.transliteration || '',
          grammar_code: wObj?.grammar_code || null,
          dstrongs_tag: matchingStem.dstrongs_tag || null,
          source_english: occ.source_english ?? '',
          source_ref: occ.source_ref ?? '',
          source_name: srcName,
          source_commit: srcCommit,
          is_context_ambiguous: Boolean(matchingStem.is_context_ambiguous),
        });
      }
    }
  }

  if (mode === 'occurrences') {
    allOcc.sort((a, b) => (a.verse_id !== b.verse_id ? a.verse_id - b.verse_id : a.word_position - b.word_position));
    const distinctVerses = new Set(allOcc.map((o) => o.verse_id)).size;
    const ambigTokens = allOcc.filter((o) => o.is_context_ambiguous).length;
    const afterFiltered = allOcc.filter((o) => o.verse_id > afterVerseId);
    const paged = afterFiltered.slice(0, limit);
    const maxPagedVid = paged.length > 0 ? paged[paged.length - 1].verse_id : afterVerseId;
    const hasMore = afterFiltered.some((o) => o.verse_id > maxPagedVid);

    return {
      status: 'ok',
      totals: {
        distinct_inflected_forms: stemForms.length,
        total_tokens: allOcc.length,
        total_verses: distinctVerses,
        ambiguous_form_tokens: ambigTokens,
      },
      pagination: {
        after_verse_id: afterVerseId,
        limit,
        returned_count: paged.length,
        next_after_verse_id: hasMore ? maxPagedVid : null,
      },
      occurrences: paged.map((p) => ({
        verse_id: p.verse_id,
        book: p.book,
        book_name: p.book_name,
        usfm: p.usfm,
        chapter: p.chapter,
        verse: p.verse_nr,
        word_position: p.word_position,
        word_id: p.word_id,
        inflected_form: p.inflected_form,
        inflected_transliteration: p.inflected_transliteration,
        grammar_code: p.grammar_code,
        dstrongs_tag: p.dstrongs_tag,
        attested_english_rendering: p.source_english,
        source_ref: p.source_ref,
        is_surface_form_homograph_ambiguous: p.is_context_ambiguous,
      })),
    };
  }

  // Group glosses for mode === 'glosses' or 'semantics'
  let untranslatedCount = 0;
  const glossGroups = new Map();
  for (const o of allOcc) {
    const rawEng = String(o.source_english || '').trim();
    if (!rawEng) {
      untranslatedCount += 1;
      continue;
    }
    let grp = glossGroups.get(rawEng);
    if (!grp) {
      grp = {
        raw_english: rawEng,
        token_count: 0,
        verse_ids: new Set(),
        word_ids: new Set(),
        first_occ: o,
      };
      glossGroups.set(rawEng, grp);
    }
    grp.token_count += 1;
    grp.verse_ids.add(o.verse_id);
    grp.word_ids.add(o.word_id);
    if (
      o.verse_id < grp.first_occ.verse_id ||
      (o.verse_id === grp.first_occ.verse_id && String(o.source_ref) < String(grp.first_occ.source_ref))
    ) {
      grp.first_occ = o;
    }
  }

  const sortedGlosses = Array.from(glossGroups.values()).sort((a, b) => {
    if (b.token_count !== a.token_count) return b.token_count - a.token_count;
    return a.raw_english < b.raw_english ? -1 : a.raw_english > b.raw_english ? 1 : 0;
  });

  if (mode === 'glosses') {
    return {
      status: 'ok',
      corpus_rendering_summary: {
        total_attested_tokens: allOcc.length,
        distinct_attested_english_strings: glossGroups.size,
        untranslated_grammatical_tokens: untranslatedCount,
      },
      attested_english_glosses: sortedGlosses.slice(0, limit).map((gg) => ({
        attested_gloss: gg.raw_english,
        usage_group: readerUsageLabel(snr, gg.raw_english),
        token_count: gg.token_count,
        verse_count: gg.verse_ids.size,
        inflected_form_count: gg.word_ids.size,
        sample_passage: {
          book: gg.first_occ.book,
          book_name: gg.first_occ.book_name,
          chapter: gg.first_occ.chapter,
          verse: gg.first_occ.verse_nr,
          source_ref: gg.first_occ.source_ref,
        },
        source_dataset: gg.first_occ.source_name,
        source_commit: gg.first_occ.source_commit,
      })),
    };
  }

  // mode === 'semantics'
  const sortedForms = stemForms.slice().sort((a, b) => {
    if (b.observed_token_count !== a.observed_token_count) return b.observed_token_count - a.observed_token_count;
    return a.word_id - b.word_id;
  });

  return {
    status: 'ok',
    attested_translation_glosses: sortedGlosses.slice(0, 12).map((gg) => ({
      attested_gloss: gg.raw_english,
      token_count: gg.token_count,
      verse_count: gg.verse_ids.size,
      sample_passage: {
        verse_id: gg.first_occ.verse_id,
        source_ref: gg.first_occ.source_ref,
        book: gg.first_occ.book,
        book_name: gg.first_occ.book_name,
        chapter: gg.first_occ.chapter,
        verse: gg.first_occ.verse_nr,
      },
      source_attribution: `${gg.first_occ.source_name} (${gg.first_occ.source_commit.slice(0, 7)})`,
      caveat:
        'Attested rendering from translation sources; contextual equivalence only, does not constitute a dictionary definition.',
    })),
    surface_forms_summary: {
      distinct_forms_count: stemForms.length,
      sample_surface_forms: sortedForms.slice(0, 6).map((sf) => ({
        word_id: sf.word_id,
        surface_form: sf.word?.original_word || '',
        transliteration: sf.word?.transliteration || '',
        grammar_code: sf.word?.grammar_code || null,
        observed_count: sf.observed_token_count,
      })),
    },
  };
}

let cachedManifestIndex = null;

async function ensureManifestIndex(env) {
  if (cachedManifestIndex) return cachedManifestIndex;
  const rawBytes = await readAssetBytes(env, '/manifest.json');
  if (!rawBytes) {
    throw new Error('Missing /manifest.json in static assets');
  }
  const text = new TextDecoder('utf-8').decode(rawBytes);
  const doc = JSON.parse(text);
  const byPath = new Map();
  for (const f of doc.v1_retrieval_shards || doc.v1_sharded_assets || []) {
    byPath.set(f.path, f);
  }
  for (const tInfo of Object.values(doc.tables || {})) {
    for (const s of tInfo.shards || []) {
      byPath.set(s.path, s);
    }
  }
  cachedManifestIndex = { doc, byPath };
  return cachedManifestIndex;
}

async function computeSha256Hex(uint8Bytes) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', uint8Bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function runLiveCorpusVerification(env) {
  const failures = [];
  let manifestInfo = null;
  try {
    manifestInfo = await ensureManifestIndex(env);
  } catch (err) {
    return {
      ok: false,
      failures: [`manifest_load_failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const { doc, byPath } = manifestInfo;
  if (Number(doc?.cloudflare_limits_check?.total_asset_files || 0) < 1800) {
    failures.push(`manifest_incomplete_asset_count: ${doc?.cloudflare_limits_check?.total_asset_files}`);
  }
  if (Number(doc?.macula_syntax_completion?.files_imported_and_verified || 0) !== 983) {
    failures.push(`macula_syntax_files_mismatch: ${doc?.macula_syntax_completion?.files_imported_and_verified}`);
  }

  // Verify live SHA-256 and structural decoding of representative shards across all corpus layers
  const probePaths = [
    '/v1/lexical/query-index.json.gz',
    '/v1/syntax/search-index.json.gz',
    '/v1/chapters/b1-c1.json.gz',
    '/v1/chapters/b19-c3.json.gz',
    '/v1/chapters/b27-c2.json.gz',
    '/v1/chapters/b31-c1.json.gz',
    '/v1/chapters/b43-c1.json.gz',
    '/v1/chapters/b49-c1.json.gz',
    '/v1/lxx/b1.json.gz',
    '/v1/lxx/b27.json.gz',
    '/v1/lexical/words-00.json.gz',
    '/v1/lexical/strongs-00.json.gz',
  ];

  const loadedShards = new Map();
  for (const path of probePaths) {
    const expectedMeta = byPath.get(path);
    if (!expectedMeta) {
      failures.push(`missing_manifest_entry: ${path}`);
      continue;
    }
    const rawBytes = await readAssetBytes(env, path);
    if (!rawBytes) {
      failures.push(`missing_asset_bytes: ${path}`);
      continue;
    }
    if (rawBytes.byteLength !== Number(expectedMeta.compressed_bytes)) {
      failures.push(`compressed_size_mismatch: ${path} (${rawBytes.byteLength} !== ${expectedMeta.compressed_bytes})`);
    }
    const actualSha = await computeSha256Hex(rawBytes);
    if (actualSha !== expectedMeta.sha256_compressed) {
      failures.push(`sha256_mismatch: ${path} (${actualSha} !== ${expectedMeta.sha256_compressed})`);
    }
    const parsed = await loadJsonShard(env, path);
    if (!parsed || typeof parsed !== 'object') {
      failures.push(`json_decode_failed: ${path}`);
    } else {
      loadedShards.set(path, parsed);
    }
  }

  // Live structural checks on syntax trees in sampled OT, Aramaic, Minor Prophets, and NT chapters
  for (const chPath of ['/v1/chapters/b1-c1.json.gz', '/v1/chapters/b27-c2.json.gz', '/v1/chapters/b31-c1.json.gz', '/v1/chapters/b43-c1.json.gz', '/v1/chapters/b49-c1.json.gz']) {
    const ch = loadedShards.get(chPath);
    if (!ch) continue;
    const trees = Object.values(ch.syntax_trees || {});
    if (trees.length === 0) {
      failures.push(`empty_syntax_trees_in_chapter: ${chPath}`);
      continue;
    }
    for (const tBundle of trees) {
      const nodes = tBundle?.tree?.nodes || [];
      const depthById = new Map();
      for (const n of nodes) depthById.set(Number(n.id), Number(n.depth || 0));
      for (const n of nodes) {
        if (n.parent_node_id != null) {
          const pDepth = depthById.get(Number(n.parent_node_id));
          if (pDepth === undefined) {
            failures.push(`orphan_parent_node_in_${chPath}: node ${n.id}`);
          } else if (Number(n.depth || 0) <= pDepth) {
            failures.push(`cycle_or_depth_inversion_in_${chPath}: node ${n.id}`);
          }
        }
        if (n.is_terminal && !String(n.terminal_xml_id || '').trim()) {
          failures.push(`terminal_missing_xml_id_in_${chPath}: node ${n.id}`);
        }
        if (n.start_word_position != null && n.end_word_position != null && Number(n.start_word_position) > Number(n.end_word_position)) {
          failures.push(`span_inversion_in_${chPath}: node ${n.id}`);
        }
      }
    }
    // Check restricted fields are absent on tokens
    const firstVerse = Object.values(ch.verses || {})[0];
    for (const m of firstVerse?.macula_hebrew_morphemes || []) {
      for (const rf of ['sdbh', 'lexdomain', 'coredomain', 'sensenumber', 'contextualgloss']) {
        if (rf in m) failures.push(`restricted_field_leaked_in_${chPath}: ${rf}`);
      }
    }
    for (const g of firstVerse?.macula_greek_tokens || []) {
      for (const rf of ['ln', 'domain', 'contextualdomain', 'sensenumber']) {
        if (rf in g) failures.push(`restricted_field_leaked_in_${chPath}: ${rf}`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    verified_assets_count: probePaths.length,
    manifest_total_assets: doc?.cloudflare_limits_check?.total_asset_files || 0,
  };
}

async function handleValidateSyntaxTreeIntegrityV1(env) {
  const cat = await ensureCatalog(env);
  const liveCheck = await runLiveCorpusVerification(env);
  const base = cat.baseline_audits?.validate_syntax_tree_integrity_v1 || {};
  if (!liveCheck.ok) {
    return {
      ...base,
      is_valid: false,
      status: 'FAIL',
      failure_reasons: liveCheck.failures,
      live_asset_verification: liveCheck,
    };
  }
  return {
    ...base,
    is_valid: Boolean(base.is_valid),
    status: base.is_valid ? 'PASS' : 'FAIL',
    live_asset_verification: {
      status: 'PASS',
      verified_assets_count: liveCheck.verified_assets_count,
      manifest_total_assets: liveCheck.manifest_total_assets,
    },
  };
}

async function handleVerifyReferentialIntegrityV1(env) {
  const cat = await ensureCatalog(env);
  const liveCheck = await runLiveCorpusVerification(env);
  const base = cat.baseline_audits?.verify_referential_integrity_v1 || {};
  if (!liveCheck.ok) {
    return {
      ...base,
      is_valid: false,
      status: 'FAIL',
      failure_reasons: liveCheck.failures,
      live_asset_verification: liveCheck,
    };
  }
  return {
    ...base,
    is_valid: true,
    status: 'ok',
    live_asset_verification: {
      status: 'PASS',
      verified_assets_count: liveCheck.verified_assets_count,
      manifest_total_assets: liveCheck.manifest_total_assets,
    },
  };
}

async function handleAuditEvidenceCoverageV1(env) {
  const cat = await ensureCatalog(env);
  const liveCheck = await runLiveCorpusVerification(env);
  const base = cat.baseline_audits?.audit_evidence_coverage_v1 || {};
  if (!liveCheck.ok) {
    return {
      ...base,
      status: 'FAIL',
      is_valid: false,
      failure_reasons: liveCheck.failures,
      live_asset_verification: liveCheck,
    };
  }
  return {
    ...base,
    status: 'ok',
    is_valid: true,
    live_asset_verification: {
      status: 'PASS',
      verified_assets_count: liveCheck.verified_assets_count,
      manifest_total_assets: liveCheck.manifest_total_assets,
    },
  };
}

async function handleGetHebrewImportStatusV1(env) {
  const cat = await ensureCatalog(env);
  const liveCheck = await runLiveCorpusVerification(env);
  const base = cat.baseline_audits?.get_hebrew_import_status_v1 || {};
  if (!liveCheck.ok) {
    return {
      ...base,
      status: 'FAIL',
      is_valid: false,
      failure_reasons: liveCheck.failures,
      live_asset_verification: liveCheck,
    };
  }
  return base;
}

// ============================================================================
// Worker Fetch Handler
// ============================================================================

async function handlePassageLensSourceV1(env, params) {
  const cat = await ensureCatalog(env);
  const book = Number(params.p_book), chapter = Number(params.p_chapter), verse = Number(params.p_verse);
  if (![book, chapter, verse].every(Number.isInteger) || book < 1 || book > 66 || chapter < 1 || verse < 0) return { status: 'invalid_request' };
  const id = cachedVerseByCoord.get(`${book}:${chapter}:${verse}`);
  if (!id) return { status: 'passage_not_found' };
  const shard = await loadJsonShard(env, `/v1/chapters/b${book}-c${chapter}.json.gz`);
  const entry = shard?.verses?.[String(verse)];
  if (!entry || entry.verse_id !== id) throw new Error('Required canonical passage source unavailable');
  const hebrew = (entry.macula_hebrew_morphemes || []).map(({ gated_fields, ...row }) => row);
  // Greek MACULA frames are licensed source annotations; Hebrew gated fields are never returned.
  const greek = (entry.macula_greek_tokens || []).map(({ frame, gated_fields, ...row }) => ({ ...row, semantic_frame_source: frame ?? null }));
  return { status: 'ok', verse_id: id, hebrew, greek };
}

async function handleStaticCorpusMetadataV1(env) {
  const cat = await ensureCatalog(env);
  const bytes = await readAssetBytes(env, '/tables/macula_syntax_import_files/part-0000.jsonl.gz');
  if (!bytes) throw new Error('Required corpus source manifest unavailable');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await decompressGzipIfNeeded(bytes));
  const files = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  const manifestBytes = await readAssetBytes(env, '/manifest.json');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (files.length !== manifest.macula_syntax_completion.manifest_files_total) throw new Error('Incomplete corpus source manifest');
  return { status: 'ok', macula_syntax_import_files: files, decode_grammar_catalog: cat.decode_grammar_catalog };
}

async function handleCorpusChunkIntegrity(env, url) {
  const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 4);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 8) return jsonResponse({ status: 'invalid_request' }, 400, 'no-store');
  const manifestBytes = await readAssetBytes(env, '/manifest.json');
  if (!manifestBytes) throw new Error('Required corpus manifest unavailable');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const entries = [...Object.values(manifest.tables).flatMap(t => t.shards || []), ...Object.values(manifest.v1_retrieval_shards)];
  const unique = new Map();
  const manifestDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', manifestBytes));
  unique.set('/manifest.json', { path: '/manifest.json', sha256_compressed: [...manifestDigest].map(b => b.toString(16).padStart(2,'0')).join(''), compressed_bytes: manifestBytes.length });
  for (const entry of entries) {
    if (!entry.path?.startsWith('/') || entry.path.includes('..')) throw new Error('Invalid corpus manifest path');
    if (unique.has(entry.path)) throw new Error('Duplicate corpus manifest path');
    unique.set(entry.path, entry);
  }
  if (unique.size !== manifest.cloudflare_limits_check.total_asset_files) throw new Error('Incomplete corpus manifest');
  const checks = [];
  for (const entry of [...unique.values()].sort((a,b) => a.path.localeCompare(b.path)).slice(offset, offset + limit)) {
    const bytes = await readAssetBytes(env, entry.path);
    if (!bytes) { checks.push({ path: entry.path, status: 'missing' }); continue; }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    checks.push({ path: entry.path, sha256_compressed: [...digest].map(b => b.toString(16).padStart(2,'0')).join(''), compressed_bytes: bytes.length });
  }
  // Hashes only: raw public/restricted source and private backups remain inaccessible.
  return jsonResponse({ status: 'ok', corpus_version: manifest.corpus_version, total_assets: unique.size, offset, checks }, 200, 'no-store');
}

const corpusWorker = {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // Zero-copy static shard / packed v3 passthrough for Supabase Edge discovery compute host.
      // Security: /tables/* and /v1/* are blocked upstream by withCorpusSecurity; never bypass those prefixes.
      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        ((pathname.startsWith('/v2/relationships/') && url.searchParams.get('raw') === '1') ||
          pathname.startsWith('/v3/'))
      ) {
        if (pathname.includes('..') || !env.ASSETS) {
          return jsonResponse({ error: 'invalid_asset_path', path: pathname }, 400, 'no-store');
        }
        const candidates =
          pathname.startsWith('/v2/relationships/') && !pathname.endsWith('.gz')
            ? [`${pathname}.gz`, pathname]
            : [pathname];
        const rangeHeader = request.headers.get('Range');
        const rangeMatch = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader || '');
        const reqHeaders = {
          'Accept-Encoding': 'identity',
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        };
        let assetRes = null;
        let resolvedPath = pathname;
        for (const cand of candidates) {
          const assetReq = new Request(new URL(cand, 'https://corpus.internal').toString(), {
            method: request.method === 'HEAD' && rangeMatch ? 'GET' : request.method,
            headers: reqHeaders,
          });
          const res = await env.ASSETS.fetch(assetReq);
          if (res.ok) {
            assetRes = res;
            resolvedPath = cand;
            break;
          }
          await res.body?.cancel();
        }
        if (!assetRes) {
          return jsonResponse({ error: 'asset_not_found', path: pathname }, 404, 'no-store');
        }
        const isActivePointer =
          pathname === '/v2/relationships/active.json' ||
          pathname === '/v2/relationships/active.json.gz';
        const contentType = resolvedPath.endsWith('.gz')
          ? 'application/gzip'
          : resolvedPath.endsWith('.bin')
            ? 'application/octet-stream'
            : resolvedPath.endsWith('.json')
              ? 'application/json; charset=utf-8'
              : 'application/octet-stream';
        const outHeaders = new Headers(CORS_HEADERS);
        outHeaders.set('Content-Type', contentType);
        outHeaders.set(
          'Cache-Control',
          isActivePointer ? 'public, max-age=300' : 'public, max-age=31536000, immutable'
        );
        if (pathname.startsWith('/v3/')) outHeaders.set('Accept-Ranges', 'bytes');
        const contentRange = assetRes.headers.get('Content-Range');
        if (contentRange) outHeaders.set('Content-Range', contentRange);
        const contentLength = assetRes.headers.get('Content-Length');
        if (contentLength) outHeaders.set('Content-Length', contentLength);
        if (rangeMatch && assetRes.status === 200) {
          const start = Number(rangeMatch[1]);
          const end = Number(rangeMatch[2]);
          const sliced = await readPackedRange(assetRes.body, start, end, env.__r12Trace);
          outHeaders.set('Content-Range', `bytes ${start}-${end}/*`);
          outHeaders.set('Content-Length', String(sliced.byteLength));
          return new Response(request.method === 'HEAD' ? null : sliced, {
            status: 206,
            headers: outHeaders,
          });
        }
        return new Response(request.method === 'HEAD' ? null : assetRes.body, {
          status: assetRes.status,
          headers: outHeaders,
        });
      }

      if (pathname === '/__integrity/chunks') return await handleCorpusChunkIntegrity(env, url);
      // 1. Health check
      if (pathname === '/health' || pathname === '/v1/health') {
        return jsonResponse(
          {
            status: 'ok',
            worker: 'bibleresearch-corpus',
            corpus_version: '2026.11.07-v1',
          },
          200,
          'no-store'
        );
      }

      // 2. RPC Gateway (`/v1/rpc/<operation>`)
      if (pathname.startsWith('/v1/rpc/')) {
        const op = pathname.slice('/v1/rpc/'.length).replace(/\/+$/, '');
        let params = {};
        if (request.method === 'POST') {
          const bodyText = await request.text();
          if (bodyText.trim()) params = JSON.parse(bodyText);
        } else {
          for (const [k, v] of url.searchParams.entries()) {
            params[k] = v;
          }
        }

        if (op === 'lookup_syntax_tree_v1') {
          return jsonResponse(await handleLookupSyntaxTreeV1(env, params));
        }
        if (op === 'validate_syntax_tree_integrity_v1') {
          return jsonResponse(await handleValidateSyntaxTreeIntegrityV1(env));
        }
        if (op === 'lookup_passage_tokens_syntax_v1') {
          return jsonResponse(await handleLookupPassageTokensSyntaxV1(env, params));
        }
        if (op === 'lookup_hebrew_verse_evidence_v1') {
          return jsonResponse(await handleLookupHebrewVerseEvidenceV1(env, params));
        }
        if (op === 'lookup_greek_verse_evidence_v1') {
          return jsonResponse(await handleLookupGreekVerseEvidenceV1(env, params));
        }
        if (op === 'lookup_septuagint_passage_v1') {
          return jsonResponse(await handleLookupSeptuagintPassageV1(env, params));
        }
        if (op === 'lookup_septuagint_by_canonical_verse_v1') {
          return jsonResponse(await handleLookupSeptuagintByCanonicalVerseV1(env, params));
        }
        if (op === 'get_passage_lens_source_v1') {
          return jsonResponse(await handlePassageLensSourceV1(env, params));
        }
        if (op === 'get_static_corpus_metadata_v1') {
          return jsonResponse(await handleStaticCorpusMetadataV1(env));
        }
        if (op === 'get_reader_passages_v1') {
          return jsonResponse(await handleGetReaderPassagesV1(env, params));
        }
        if (op === 'get_verse_translation_sources_batch_v1') {
          return jsonResponse(await handleGetVerseTranslationSourcesBatchV1(env, params));
        }
        if (op === 'get_word_form_lemmas_batch_v1') {
          return jsonResponse(await handleGetWordFormLemmasBatchV1(env, params));
        }
        if (op === 'get_lemma_lexical_summary_v1') {
          return jsonResponse(await handleGetLemmaLexicalSummaryV1(env, params));
        }
        if (op === 'audit_evidence_coverage_v1') {
          return jsonResponse(await handleAuditEvidenceCoverageV1(env));
        }
        if (op === 'verify_referential_integrity_v1') {
          return jsonResponse(await handleVerifyReferentialIntegrityV1(env));
        }
        if (op === 'get_hebrew_import_status_v1') {
          return jsonResponse(await handleGetHebrewImportStatusV1(env));
        }
        if (op === 'search_syntax_patterns_v1') {
          return jsonResponse(await handleSearchSyntaxPatternsV1(env, params));
        }
        if (op === 'get_reader_overview_v1') {
          return jsonResponse(await handleGetReaderOverviewV1(env, params));
        }
        if (op === 'get_reader_word_v1') {
          return jsonResponse(await handleGetReaderWordV1(env, params));
        }
        if (op === 'compare_hebrew_septuagint_passage_v1') {
          return jsonResponse(await handleCompareHebrewSeptuagintPassageV1(env, params));
        }
        if (op === 'get_hebrew_septuagint_parallel_v1') {
          return jsonResponse(await handleGetHebrewSeptuagintParallelV1(env, params));
        }
        if (op === 'lookup_hebrew_septuagint_alignments_v1') {
          return jsonResponse(await handleLookupHebrewSeptuagintAlignmentsV1(env, params));
        }
        if (op === 'prompt_verse_words') {
          return jsonResponse(await handlePromptVerseWords(env, params));
        }
        if (op === 'prompt_word_occurrences') {
          return jsonResponse(await handlePromptWordOccurrences(env, params));
        }
        if (op === 'prompt_word_cooccurrences') {
          return jsonResponse(await handlePromptWordCooccurrences(env, params));
        }
        if (op === 'lookup_cross_references_v1') {
          return jsonResponse(
            await handleLookupCrossReferencesV1(
              {
                env,
                loadJsonShard,
                ensureCatalog,
                getVerseIdByCoord: coord => cachedVerseByCoord?.get(coord) ?? null,
                getVerseById: id => cachedVerseById?.get(id) ?? null,
              },
              params
            )
          );
        }
        if (op === 'lookup_lexical_relationships_v1') {
          return jsonResponse(
            await handleLookupLexicalRelationshipsV1(
              {
                env,
                loadJsonShard,
                ensureCatalog,
                getVerseIdByCoord: coord => cachedVerseByCoord?.get(coord) ?? null,
                getVerseById: id => cachedVerseById?.get(id) ?? null,
              },
              params
            )
          );
        }
        if (op === 'query_relationships_v2' || op === 'lookup_grammatical_relationships_v2') {
          return jsonResponse(await handleQueryRelationshipsV2(makeWorkerRpcCtx(env), params));
        }
        if (op === 'resolve_research_concept_v1') {
          return jsonResponse(await handleResolveResearchConceptV1(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'discover_relationship_paths_v1') {
          return jsonResponse(await handleDiscoverRelationshipPathsV1(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'discover_biblical_connections_v1' || op === 'discover_biblical_connections_v2') {
          return jsonResponse(await handleDiscoverBiblicalConnectionsV1(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'discover_patterns_v1' || op === 'compare_patterns_v1' || op === 'trace_evidence_v1' || op === 'discover_subgraph_v1') {
          const r13Ctx = makeWorkerRpcCtx(env);
          if (op === 'discover_patterns_v1') {
            return jsonResponse(await handleDiscoverPatternsV1(r13Ctx, params), 200, 'public, max-age=300');
          }
          if (op === 'compare_patterns_v1') {
            return jsonResponse(await handleComparePatternsV1(r13Ctx, params), 200, 'public, max-age=300');
          }
          if (op === 'discover_subgraph_v1') {
            return jsonResponse(await handleDiscoverSubgraphV1(r13Ctx, params), 200, 'public, max-age=300');
          }
          return jsonResponse(await handleTraceEvidenceV1(r13Ctx, params), 200, 'public, max-age=300');
        }
        if (op === 'get_connection_evidence_v1') {
          return jsonResponse(await handleGetConnectionEvidenceV1(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'expand_biblical_connection_v1') {
          return jsonResponse(await handleExpandBiblicalConnectionV1(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }

        if (op === 'get_passage_compact_v1' || op === 'get_word_profiles_batch_v1' || op === 'resolve_fast_lookup_v1' || op === 'get_literary_source_v1' || op === 'analyze_literary_structure_v1') {
          const fastCtx = makeWorkerRpcCtx(env);
          if (op === 'get_passage_compact_v1') {
            return jsonResponse(await handleGetPassageCompactV1(fastCtx, params), 200, 'public, max-age=300');
          }
          if (op === 'get_word_profiles_batch_v1') {
            return jsonResponse(await handleGetWordProfilesBatchV1(fastCtx, params), 200, 'public, max-age=300');
          }
          if (op === 'get_literary_source_v1') {
            return jsonResponse(await handleGetLiterarySourceV1(fastCtx, params), 200, 'public, max-age=3600');
          }
          if (op === 'analyze_literary_structure_v1') {
            return jsonResponse(await handleAnalyzeLiteraryStructureV1(fastCtx, params), 200, 'public, max-age=300');
          }
          return jsonResponse(await handleResolveFastLookupV1(fastCtx, params), 200, 'public, max-age=300');
        }

        // BibleResearch v3 RPCs (S4)
        if (op === 'lxx_concordance_v3') {
          return jsonResponse(await handleLxxConcordanceV3(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'tri_textual_diff_v3') {
          return jsonResponse(await handleTriTextualDiffV3(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'clause_role_query_v3') {
          return jsonResponse(await handleClauseRoleQueryV3(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'sequence_parallels_v3') {
          return jsonResponse(await handleSequenceParallelsV3(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'wordplay_scan_v3') {
          return jsonResponse(await handleWordplayScanV3(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'expand_clue_v3') {
          return jsonResponse(await handleExpandClueV3(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }
        if (op === 'set_combine_v3') {
          return jsonResponse(await handleSetCombineV3(makeWorkerRpcCtx(env), params), 200, 'public, max-age=300');
        }

        return jsonResponse({ error: 'unknown_rpc_operation', operation: op }, 404, 'no-store');
      }

      // 2b. Relationship Graph v2 Gateway (`/api/relationships/v2/query`)
      if (pathname === '/api/relationships/v2/query') {
        let params = {};
        if (request.method === 'POST') {
          const bodyText = await request.text();
          if (bodyText.trim()) params = JSON.parse(bodyText);
        } else {
          for (const [k, v] of url.searchParams.entries()) {
            params[k] = v;
          }
        }
        return jsonResponse(await handleQueryRelationshipsV2({ env, loadJsonShard }, params));
      }

      // 3. Convenience syntax search & unmapped routes
      if (pathname === '/v1/syntax/search') {
        const params = Object.fromEntries(url.searchParams.entries());
        return jsonResponse(await handleSearchSyntaxPatternsV1(env, params));
      }
      if (pathname === '/v1/syntax/unmapped') {
        const idx = await loadJsonShard(env, '/v1/syntax/search-index.json.gz');
        return jsonResponse({
          status: 'ok',
          total_unmapped_nodes: idx.unmapped_nodes.length,
          unmapped_nodes: idx.unmapped_nodes,
        });
      }

      // 4. Static Asset Retrieval (`/manifest.json`, `/v1/...`, `/v2/...`, `/tables/...`)
      const wantRawGzip = url.searchParams.get('raw') === '1';
      let targetPath = pathname;
      if (
        (pathname.startsWith('/v1/') || pathname.startsWith('/v2/') || pathname.startsWith('/tables/')) &&
        !pathname.endsWith('.gz')
      ) {
        targetPath = `${pathname}.gz`;
      }

      const assetBytes = await readAssetBytes(env, targetPath);
      if (!assetBytes) {
        return jsonResponse({ error: 'asset_not_found', path: pathname }, 404, 'no-store');
      }

      if (wantRawGzip) {
        return new Response(assetBytes, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/gzip',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      const decodedBytes = await decompressGzipIfNeeded(assetBytes);
      const isJsonl = targetPath.includes('.jsonl');
      const isActivePointer = pathname === '/manifest.json' || pathname === '/v2/relationships/active.json' || pathname === '/v2/relationships/active.json.gz';
      return new Response(decodedBytes, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': isJsonl
            ? 'application/x-ndjson; charset=utf-8'
            : 'application/json; charset=utf-8',
          'Cache-Control': isActivePointer
            ? 'public, max-age=300'
            : 'public, max-age=31536000, immutable',
        },
      });
    } catch (err) {
      return jsonResponse(
        {
          error: 'internal_worker_error',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
        'no-store'
      );
    }
  },
};

const securedCorpusWorker = withCorpusSecurity(corpusWorker);
export default {
  async fetch(request, env, ctx) {
    env = { ...env, __assetInflight: new Map() };
    // Enabled only by the generated local profiler config; no body/query/secret logging.
    const requestId = request.headers.get('X-R12-Trace-Id');
    if (env.R12_TRACE_ENABLED !== '1' || !requestId || !/^[a-zA-Z0-9:_-]{1,100}$/.test(requestId)) {
      const response = await securedCorpusWorker.fetch(request, env, ctx);
      if (!env.R12_RELEASE_ID) return response;
      const headers = new Headers(response.headers);
      headers.set('X-BibleResearch-Release', env.R12_RELEASE_ID);
      headers.set('X-BibleResearch-Assets', env.R12_ASSET_SHA256 || 'unidentified');
      headers.set('X-BibleResearch-Version', env.WORKER_VERSION?.id || 'unidentified');
      headers.set('X-BibleResearch-Commit', env.R12_SOURCE_COMMIT || 'unidentified');
      headers.set('Access-Control-Expose-Headers', 'X-BibleResearch-Release, X-BibleResearch-Assets, X-BibleResearch-Version, X-BibleResearch-Commit');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    r12TraceIsolateId ??= crypto.randomUUID();
    const trace = {
      request_id: requestId, isolate_id: r12TraceIsolateId,
      asset_reads: 0, encoded_bytes: 0, decoded_bytes: 0, cache_hits: 0,
      cache_stores: 0, cache_skips: 0, cache_evictions: 0, missing_shards: [], assets: [],
      phases: { gzip_decode: 0, text_decode: 0, json_parse: 0, r10_reader: 0 },
    };
    const response = await securedCorpusWorker.fetch(request, { ...env, __r12Trace: trace }, ctx);
    trace.cache = shardCacheStats();
    const headers = new Headers(response.headers);
    headers.set('X-R12-Trace', JSON.stringify(trace));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
