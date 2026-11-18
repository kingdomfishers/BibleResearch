/**
 * Client RPC wrappers for R10 Biblical Concept, Motif & Typology Discovery.
 * Routes strictly through the existing Cloudflare Corpus Gateway (`callCorpusRpc`).
 */

import { callCorpusRpc } from './corpus-client';
import type { DataResult } from './types';
import type {
  ConnectionEvidenceResult,
  DiscoverConnectionsQuery,
  DiscoverConnectionsResult,
  ExpandConnectionResult,
} from '../relationships/r10-types';

export const R10_RELEASE_ID = 'r11-v1.0';

function okResult<T>(data: T): DataResult<T> {
  return {
    data,
    source: 'live',
    error: null,
  };
}

function errResult<T>(data: T, message: string): DataResult<T> {
  return {
    data,
    source: 'unavailable',
    error: message,
  };
}

export async function discoverBiblicalConnectionsRpc(
  query: DiscoverConnectionsQuery
): Promise<DataResult<DiscoverConnectionsResult | null>> {
  const payload: Record<string, unknown> = {
    query: query.query,
    concepts: query.concepts,
    mode: query.mode,
    cluster_id: query.cluster_id,
    focus_lemma: query.focus_lemma,
    compare_targets: query.compare_targets,
    filters: query.filters,
    limit: query.limit ?? 10,
    cursor: query.cursor ?? null,
    max_hops: query.max_hops ?? 3,
    release_id: query.release_id ?? R10_RELEASE_ID,
  };
  if (query.word_id !== undefined) payload.word_id = query.word_id;
  if (query.book !== undefined) payload.book = query.book;
  if (query.chapter !== undefined) payload.chapter = query.chapter;
  if (query.verse !== undefined) payload.verse = query.verse;
  if (query.position !== undefined) payload.position = query.position;
  if (query.edition_key !== undefined) payload.edition_key = query.edition_key;
  if (query.lemma_id !== undefined) payload.lemma_id = query.lemma_id;
  if (query.extended_strongs !== undefined) payload.extended_strongs = query.extended_strongs;
  if (query.anchor !== undefined) payload.anchor = query.anchor;
  const { data, error } = await callCorpusRpc<DiscoverConnectionsResult>(
    'discover_biblical_connections_v2',
    payload,
    { timeoutMs: 20000 }
  );
  if (error || !data) {
    return errResult(null, error || 'Unable to run biblical connection discovery.');
  }
  return okResult(data);
}

export async function getConnectionEvidenceRpc(
  evidenceId: string,
  releaseId: string = R10_RELEASE_ID
): Promise<DataResult<ConnectionEvidenceResult | null>> {
  const { data, error } = await callCorpusRpc<ConnectionEvidenceResult>(
    'get_connection_evidence_v1',
    {
      evidence_id: evidenceId,
      release_id: releaseId || R10_RELEASE_ID,
    },
    { timeoutMs: 15000 }
  );
  if (error || !data) {
    return errResult(null, error || 'Unable to load connection evidence.');
  }
  return okResult(data);
}

export async function expandBiblicalConnectionRpc(
  nodeId: string,
  options: { limit?: number; cursor?: string | null; releaseId?: string } | string = {},
  releaseId: string = R10_RELEASE_ID
): Promise<DataResult<ExpandConnectionResult | null>> {
  const opts = typeof options === 'string' ? { releaseId: options } : options;
  const relId = opts.releaseId ?? releaseId ?? R10_RELEASE_ID;
  const { data, error } = await callCorpusRpc<ExpandConnectionResult>(
    'expand_biblical_connection_v1',
    {
      node_id: nodeId,
      limit: opts.limit ?? 8,
      cursor: opts.cursor ?? null,
      release_id: relId,
    },
    { timeoutMs: 15000 }
  );
  if (error || !data) {
    return errResult(null, error || 'Unable to expand connection node.');
  }
  return okResult(data);
}
