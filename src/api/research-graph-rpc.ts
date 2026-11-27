// @file: src/api/research-graph-rpc.ts
// @feature: research-graph
// @tables: rg_nodes | rg_claims | rg_claim_participants | rg_claim_evidence | rg_claim_links | rg_research_trails

import { supabase } from './supabase';
import type { DataResult } from './types';
import type {
  RgBatchPayload,
  RgContradictionsResponse,
  RgDossierResponse,
  RgEpistemicState,
  RgNeighborhoodResponse,
  RgPathsResponse,
  RgResolveEntityResponse,
  RgReviewStatus,
  RgSearchResponse,
  RgTraceResponse,
  RgTrailSummary,
} from './research-graph-types';

async function call<T>(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 10000,
  signal?: AbortSignal,
): Promise<DataResult<T | null>> {
  if (!supabase) return { data: null, source: 'unavailable', error: 'Database connection is not configured.' };
  try {
    const combinedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const { data, error } = await supabase.rpc(name, args).abortSignal(combinedSignal);
    if (error) return { data: null, source: 'unavailable', error: error.message || 'Database request failed.' };
    return { data: (data as T) ?? null, source: 'live', error: null };
  } catch (err) {
    return {
      data: null,
      source: 'unavailable',
      error: err instanceof Error ? err.message : 'Research graph request failed.',
    };
  }
}

export const ResearchGraphRPC = {
  resolveEntity(query: string, kinds?: string[] | null, limit = 20, signal?: AbortSignal) {
    return call<RgResolveEntityResponse>('rg_resolve_entity_v1', {
      p_query: query,
      p_kinds: kinds ?? null,
      p_limit: limit,
    }, 8000, signal);
  },

  search(
    query?: string | null,
    filters?: Record<string, unknown>,
    limit = 20,
    offset = 0,
    signal?: AbortSignal,
  ) {
    return call<RgSearchResponse>('rg_search_v1', {
      p_query: query ?? null,
      p_filters: filters ?? {},
      p_limit: limit,
      p_offset: offset,
    }, 8000, signal);
  },

  getDossier(nodeRef: string, includeStale = true, limit = 40, signal?: AbortSignal) {
    return call<RgDossierResponse>('rg_concept_dossier_v1', {
      p_node_ref: nodeRef,
      p_include_stale: includeStale,
      p_limit: limit,
    }, 8000, signal);
  },

  expandNeighborhood(
    nodeRef: string,
    direction: 'both' | 'outgoing' | 'incoming' = 'both',
    filters: Record<string, unknown> = {},
    limit = 25,
    offset = 0,
    signal?: AbortSignal,
  ) {
    return call<RgNeighborhoodResponse>('rg_expand_neighborhood_v1', {
      p_node_ref: nodeRef,
      p_direction: direction,
      p_filters: filters,
      p_limit: limit,
      p_offset: offset,
    }, 8000, signal);
  },

  findPaths(
    fromRefs: string[],
    toRefs: string[],
    maxHops = 3,
    filters: Record<string, unknown> = {},
    limit = 10,
    signal?: AbortSignal,
  ) {
    return call<RgPathsResponse>('rg_find_paths_v1', {
      p_from_refs: fromRefs,
      p_to_refs: toRefs,
      p_max_hops: maxHops,
      p_filters: filters,
      p_limit: limit,
    }, 10000, signal);
  },

  traceEvidence(claimId: string, maxDepth = 5, signal?: AbortSignal) {
    return call<RgTraceResponse>('rg_trace_evidence_v1', {
      p_claim_id: claimId,
      p_max_depth: maxDepth,
    }, 8000, signal);
  },

  findContradictions(nodeRef?: string | null, claimId?: string | null, limit = 25, signal?: AbortSignal) {
    return call<RgContradictionsResponse>('rg_find_contradictions_v1', {
      p_node_ref: nodeRef ?? null,
      p_claim_id: claimId ?? null,
      p_limit: limit,
    }, 8000, signal);
  },

  listTrails(status?: string | null, query?: string | null, limit = 20, signal?: AbortSignal) {
    return call<{ status: string; trails: RgTrailSummary[] }>('rg_list_trails_v1', {
      p_status: status ?? null,
      p_query: query ?? null,
      p_limit: limit,
    }, 8000, signal);
  },

  getTrail(trailRef: string, signal?: AbortSignal) {
    return call<{ status: string; trail: RgTrailSummary | null }>('rg_get_trail_v1', {
      p_trail_ref: trailRef,
    }, 8000, signal);
  },

  async saveBatch(payload: RgBatchPayload): Promise<Record<string, unknown>> {
    const res = await call<Record<string, unknown>>('rg_save_batch_v1', { p_payload: payload }, 15000);
    return res.data ?? { ok: false, error: { code: 'network_error', message: res.error || 'Save failed' } };
  },

  async reviewClaim(
    claimId: string,
    reviewStatus: RgReviewStatus,
    opts?: { epistemicState?: RgEpistemicState | null; reviewNote?: string | null; clearStale?: boolean },
  ): Promise<Record<string, unknown>> {
    const res = await call<Record<string, unknown>>('rg_review_claim_v1', {
      p_claim_id: claimId,
      p_review_status: reviewStatus,
      p_epistemic_state: opts?.epistemicState ?? null,
      p_review_note: opts?.reviewNote ?? null,
      p_clear_stale: opts?.clearStale ?? false,
    }, 12000);
    return res.data ?? { ok: false, error: { code: 'network_error', message: res.error || 'Review failed' } };
  },

  async deleteClaim(claimId: string, expectedVersion?: number): Promise<Record<string, unknown>> {
    const res = await call<Record<string, unknown>>('rg_delete_claim_v1', {
      p_claim_id: claimId,
      p_expected_version: expectedVersion ?? null,
    }, 12000);
    return res.data ?? { ok: false, error: { code: 'network_error', message: res.error || 'Delete failed' } };
  },

  async saveTrail(trail: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await call<Record<string, unknown>>('rg_save_trail_v1', { p_trail: trail }, 12000);
    return res.data ?? { ok: false, error: { code: 'network_error', message: res.error || 'Trail save failed' } };
  },
};
