// @file: src/api/corpus-client.ts
// @feature: api
// @tables: syntax_nodes | syntax_edges | macula_hebrew_morphemes | macula_greek_tokens | lxx_swete_words | morphhb_tokens | tagnt_tokens | verse_translation_sources | hebrew_lxx_verse_map | reader_english_verses | reader_rendering_groups | edition_passages
// @candidates: none
// @toc: imports | types | logic:cache | logic:registry | logic:client

// === @section:imports ===
import type { DataResult } from './types';

// === @section:types ===
export interface CorpusClientOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  bypassCache?: boolean;
}

// === @section:logic:cache ===
const MAX_CORPUS_CACHE_ENTRIES = 128;
const corpusSessionCache = new Map<string, unknown>();

function readCorpusCache<T>(key: string): T | undefined {
  if (!corpusSessionCache.has(key)) return undefined;
  const val = corpusSessionCache.get(key) as T;
  corpusSessionCache.delete(key);
  corpusSessionCache.set(key, val);
  return val;
}

function writeCorpusCache(key: string, value: unknown): void {
  if (corpusSessionCache.has(key)) corpusSessionCache.delete(key);
  else if (corpusSessionCache.size >= MAX_CORPUS_CACHE_ENTRIES) {
    const oldest = corpusSessionCache.keys().next().value;
    if (oldest !== undefined) corpusSessionCache.delete(oldest);
  }
  corpusSessionCache.set(key, value);
}

export function clearCorpusSessionCache(): void {
  corpusSessionCache.clear();
}

// === @section:logic:registry ===
const DEFAULT_CORPUS_URL = 'https://bibleresearch-corpus.kingdomfishers-custom.workers.dev';

const rawEnvUrl = (import.meta.env?.VITE_CORPUS_BASE_URL as string | undefined)?.trim();
export const CORPUS_BASE_URL = (rawEnvUrl && rawEnvUrl.length > 0 ? rawEnvUrl : DEFAULT_CORPUS_URL).replace(/\/+$/, '');

// Pure static-evidence RPCs only (`get_reader_word_v1` excluded because Supabase merges mutable custom_definition).
const CORPUS_RO_OPS = new Set<string>([
  'lookup_syntax_tree_v1',
  'validate_syntax_tree_integrity_v1',
  'lookup_passage_tokens_syntax_v1',
  'lookup_hebrew_verse_evidence_v1',
  'lookup_greek_verse_evidence_v1',
  'lookup_septuagint_passage_v1',
  'lookup_septuagint_by_canonical_verse_v1',
  'compare_hebrew_septuagint_passage_v1',
  'get_hebrew_septuagint_parallel_v1',
  'lookup_hebrew_septuagint_alignments_v1',
  'get_reader_passages_v1',
  'audit_evidence_coverage_v1',
  'verify_referential_integrity_v1',
  'get_hebrew_import_status_v1',
  'search_syntax_patterns_v1',
  'lookup_cross_references_v1',
  'lookup_lexical_relationships_v1',
]);

export function isStaticCorpusRpc(name: string): boolean {
  return CORPUS_RO_OPS.has(name);
}

// === @section:logic:client ===

export async function fetchCorpusJson<T>(
  assetPath: string,
  opts: CorpusClientOptions = {}
): Promise<DataResult<T | null>> {
  const cleanPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  const cacheKey = `asset:${CORPUS_BASE_URL}${cleanPath}`;
  if (!opts.bypassCache) {
    const hit = readCorpusCache<T>(cacheKey);
    if (hit !== undefined) return { data: hit, source: 'live', error: null };
  }
  const timeoutMs = opts.timeoutMs ?? 8000;
  try {
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const response = await fetch(`${CORPUS_BASE_URL}${cleanPath}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      return { data: null, source: 'unavailable', error: `Corpus asset HTTP ${response.status}` };
    }
    const data = (await response.json()) as T;
    writeCorpusCache(cacheKey, data);
    return { data, source: 'live', error: null };
  } catch (err) {
    return {
      data: null,
      source: 'unavailable',
      error: err instanceof Error ? err.message : 'Static corpus asset fetch failed.',
    };
  }
}

export async function callCorpusRpc<T>(
  name: string,
  args: Record<string, unknown>,
  opts: CorpusClientOptions = {}
): Promise<DataResult<T | null>> {
  const cacheKey = `rpc:${CORPUS_BASE_URL}:${name}:${JSON.stringify(args ?? {})}`;
  if (!opts.bypassCache) {
    const hit = readCorpusCache<T>(cacheKey);
    if (hit !== undefined) return { data: hit, source: 'live', error: null };
  }
  const timeoutMs = opts.timeoutMs ?? 8000;
  try {
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const response = await fetch(`${CORPUS_BASE_URL}/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args ?? {}),
      signal,
    });
    if (!response.ok) {
      return { data: null, source: 'unavailable', error: `Corpus HTTP ${response.status}` };
    }
    const data = (await response.json()) as T;
    writeCorpusCache(cacheKey, data);
    return { data, source: 'live', error: null };
  } catch (err) {
    return {
      data: null,
      source: 'unavailable',
      error: err instanceof Error ? err.message : 'Static corpus request failed.',
    };
  }
}
