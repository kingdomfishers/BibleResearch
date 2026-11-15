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

export const R10_RELEASE_ID = 'r10-v1.0';

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
  const { data, error } = await callCorpusRpc<DiscoverConnectionsResult>(
    'discover_biblical_connections_v1',
    {
      query: query.query,
      concepts: query.concepts,
      filters: query.filters,
      limit: query.limit ?? 10,
      cursor: query.cursor ?? null,
      max_hops: query.max_hops ?? 3,
      release_id: query.release_id ?? R10_RELEASE_ID,
    },
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
      release_id: releaseId,
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
  options: { limit?: number; cursor?: string | null; releaseId?: string } = {}
): Promise<DataResult<ExpandConnectionResult | null>> {
  const { data, error } = await callCorpusRpc<ExpandConnectionResult>(
    'expand_biblical_connection_v1',
    {
      node_id: nodeId,
      limit: options.limit ?? 8,
      cursor: options.cursor ?? null,
      release_id: options.releaseId ?? R10_RELEASE_ID,
    },
    { timeoutMs: 15000 }
  );
  if (error || !data) {
    return errResult(null, error || 'Unable to expand connection node.');
  }
  return okResult(data);
}
