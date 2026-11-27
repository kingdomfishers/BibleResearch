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
  R10ConnectionSummary,
  V3ScoreMeta,
} from '../relationships/r10-types';
import type {
  SubgraphDiscoveryPacket,
  SubgraphRequest,
} from '../relationships/subgraph-engine';

export const R10_RELEASE_ID = 'r11-v1.0';

export interface V3DiscoveryBridgePivot {
  vid: number;
  ref?: string;
  pivot_score?: number;
  geometric_mean_mass?: number;
  axis_count?: number;
  bridged_axes?: string[];
  expand_id?: string;
}

export interface V3DiscoveryResultExtras {
  e_perp?: V3ScoreMeta;
  v3_axes?: V3ScoreMeta['independent_axes'];
  axes?: V3ScoreMeta['independent_axes'];
  bridge_pivots?: V3DiscoveryBridgePivot[];
  epistemic_register?: V3ScoreMeta['dominant_register'];
  expand_id?: string;
}

export type V3DiscoverConnectionsResult = DiscoverConnectionsResult & V3DiscoveryResultExtras;
export type V3SubgraphDiscoveryPacket = SubgraphDiscoveryPacket & V3DiscoveryResultExtras;

export interface LxxConcordanceV3Params {
  passage?: string;
  verse_id?: number;
  book?: number;
  chapter?: number;
  verse?: number;
  strongs?: string;
  lemma?: string;
  word?: string;
  shift_type?: string;
  limit?: number;
  offset?: number;
}

export interface LxxTranslationShiftV3 {
  type: string;
  ref?: string;
  vid?: number;
  h_bs?: string;
  g_lemma?: string;
  text?: string;
  lemmas?: string[];
  strongs?: string[];
  content_len?: number;
  sum_idf?: number;
  note?: string;
  [key: string]: unknown;
}

export interface LxxConcordanceV3Equivalent {
  g_lemma: string;
  count: number;
  mean_stability?: number;
  g_strongs?: string;
  share?: number;
}

export interface LxxConcordanceV3Result {
  schema_version: 3;
  status: 'ok' | 'not_found';
  mode?: 'passage_alignment' | 'strongs_and_concordance' | 'rahlfs_concordance';
  license?: string;
  swete_included?: boolean;
  error?: string;
  alignments?: Array<{
    vid: number;
    ref: string;
    grk_book?: string;
    grk_refs?: string[];
    links: Array<Record<string, unknown>>;
    shifts: LxxTranslationShiftV3[];
    grk_tokens: Array<Record<string, unknown>>;
    mt_tokens: Array<{ idx: number; sf: string; lm: string; s: string; g: string }>;
  }>;
  profile?: {
    bs: string;
    sc: string;
    gl: string;
    lxx_equivalents: LxxConcordanceV3Equivalent[];
    lxx_shifts: LxxTranslationShiftV3[];
  };
  lemma?: string;
  total_occ?: number;
  df?: number;
  idf?: number;
  page?: { limit: number; offset: number; returned: number; total_available: number };
  verses?: Array<{ vid: number; b?: string; r?: string; ref?: string; c?: number; [key: string]: unknown }>;
  matching_shifts?: LxxTranslationShiftV3[];
}

export interface TriTextualDiffV3Params {
  target?: string;
  passage?: string;
  nt_passage?: string;
  target_verse_id?: number;
  verse_id?: number;
  book?: number;
  chapter?: number;
  verse?: number;
  source?: string;
  sources?: string[] | string;
}

export type TriTextualWitnessClass =
  | 'agrees_both'
  | 'agrees_lxx_against_mt'
  | 'agrees_mt_against_lxx'
  | 'composite_splice'
  | 'nt_adaptation';

export interface TriTextualDiffV3Result {
  schema_version: 3;
  status: 'ok' | 'no_alignment' | 'invalid_request' | 'not_found';
  license?: string;
  error?: string;
  target_ref?: string;
  target_vids?: number[];
  candidate_sources?: Array<{ ref: string; vid: number; slot_count: number }>;
  sources: string[];
  splices: Array<{
    sourceRef: string;
    ntStartIdx: number;
    ntEndIdx: number;
    score: number;
    contentMatches: number;
  }>;
  summary: {
    agrees_both: number;
    agrees_lxx_against_mt: number;
    agrees_mt_against_lxx: number;
    composite_splice: number;
    nt_adaptation: number;
  } | null;
  evidence_bits: number;
  tokens: Array<{
    nt_idx: number;
    nt_surface: string;
    nt_lemma: string;
    lxx_idx: number | null;
    mt_idx: number | null;
    source_ref: string | null;
    witness: TriTextualWitnessClass;
    divergence_ref?: string;
  }>;
  lxx_shifts_in_sources?: Record<string, LxxTranslationShiftV3[]>;
}

export interface ClauseRoleQueryV3Params {
  passage?: string;
  verse_id?: number;
  book?: number;
  chapter?: number;
  verse?: number;
  predicate?: string;
  subject?: string;
  agent?: string;
  object?: string;
  patient?: string;
  polarity?: 'POS' | 'NEG' | 'POSITIVE' | 'NEGATIVE';
  idiom_only?: boolean;
  concept?: string;
  concepts?: string[] | string;
  include?: string[] | string;
  exclude?: string[] | string;
  limit?: number;
}

export interface ClauseRoleRecordV3 {
  clause_id?: string;
  polarity?: string;
  neg_markers?: string[];
  predicate?: { s?: string; lm?: string; g?: string; concept_id?: string };
  subjects?: string[];
  objects?: string[];
  concept_ids?: string[];
  slot_atom?: { verb_stem?: string; is_idiom?: boolean; [key: string]: unknown };
  token_indices?: number[];
  [key: string]: unknown;
}

export interface ClauseRoleQueryV3Result {
  schema_version: 3;
  status: 'ok' | 'unavailable' | 'invalid_request';
  mode?: 'passage_clauses' | 'corpus_role_search';
  error?: string;
  total_clauses?: number;
  verses?: Array<{
    vid: number;
    ref: string;
    clauses: ClauseRoleRecordV3[];
    tokens?: Array<Record<string, unknown>>;
  }>;
  query_keys?: string[];
  candidate_vids_count?: number;
  returned?: number;
  matches?: Array<{
    vid: number;
    ref: string;
    clauses: ClauseRoleRecordV3[];
  }>;
}

export interface SequenceParallelsV3Params {
  source?: string;
  target?: string;
  passageA?: string;
  passageB?: string;
  passage?: string;
  targets?: string[] | string;
  permutations?: number;
  switch_penalty?: number;
}

export interface SequenceAlignedPairV3 {
  aIndices: number[];
  bIndices: number[];
  mode: 'CONCORDANT' | 'INVERSION';
  similarity: number;
  polarityA: 'POS' | 'NEG';
  polarityB: 'POS' | 'NEG';
}

export interface SequenceParallelBlockV3 {
  orientation: 'forward' | 'reversed';
  mode: 'CONCORDANT' | 'INVERSION';
  score: number;
  pairs: SequenceAlignedPairV3[];
}

export interface SequenceParallelAlignmentV3 {
  target_label: string;
  target_vids: number[];
  target_clause_count: number;
  raw_score: number;
  p_null: number;
  evidence_bits: number;
  arc_kind: string;
  blocks: SequenceParallelBlockV3[];
  has_inversion: boolean;
  has_reversed_order: boolean;
}

export interface SequenceParallelsV3Result {
  schema_version: 3;
  status: 'ok' | 'invalid_request';
  error?: string;
  source?: string;
  source_clause_count?: number;
  best_alignment: SequenceParallelAlignmentV3 | null;
  alignments: SequenceParallelAlignmentV3[];
  structural_breaks?: Array<{
    at_vid: number;
    at_ref: string;
    prev_ref: string;
    reason: 'polarity_shift' | 'slot_atom_shift';
    concept_jaccard: number;
  }>;
}

export interface WordplayScanV3Params {
  passage?: string;
  verse_id?: number;
  book?: number;
  chapter?: number;
  verse?: number;
  a?: string;
  b?: string;
}

export interface WordplayScanV3Result {
  schema_version: 3;
  status: 'ok' | 'invalid_request';
  mode?: 'pair_scan' | 'passage_scan';
  error?: string;
  disclaimer?: string;
  passage?: string;
  a?: { input: string; strongs: string | null; script: string; consonantal: string; stripped?: string };
  b?: { input: string; strongs: string | null; script: string; consonantal: string; stripped?: string };
  comparable?: boolean;
  overlap_kind?: string;
  shared_consonants?: string;
  edit_distance?: number;
  phonetic_distance?: number;
  formal_score?: number;
  proven_common_root?: boolean;
  attested_textual_wordplay?: boolean;
  wordplay_candidate?: boolean;
  syntactic_talion?: Array<{
    vid?: number;
    ref: string;
    kind: string;
    strongsA: string;
    strongsB: string;
    formA: string;
    formB: string;
    shift?: string;
    cues?: string[];
    score: number;
  }>;
  onomastic_valence?: Array<{
    proper_ref: string;
    target_ref: string;
    proper_strongs: string;
    target_strongs: string;
    proper_form: string;
    target_form: string;
    channel: string;
    cues?: string[];
    score: number;
  }>;
  consonantal_candidates?: Array<{
    strongsA: string;
    strongsB: string;
    formA: string;
    formB: string;
    refA: string;
    refB: string;
    overlap_kind: string;
    shared_consonants: string;
    formal_score: number;
  }>;
}

export interface ExpandClueV3Params {
  expand_id: string;
  detail?: 'clue' | 'evidence' | 'full';
  limit?: number;
}

export interface ExpandClueV3Result {
  schema_version: 3;
  status?: string;
  expand_id: string;
  detail: 'clue' | 'evidence' | 'full';
  kind?: string;
  error?: string;
  pivot?: { vid: number; ref: string; en?: string; concepts?: string[] } | null;
  anchors?: Array<{ vid: number; ref: string; en?: string }>;
  e_perp?: Record<string, unknown>;
  csr_edge_count?: number;
  clauses?: ClauseRoleRecordV3[];
  verse?: { vid: number; ref: string; en?: string; toks?: Array<Record<string, unknown>>; concepts?: string[] } | null;
  title?: string;
  predicate?: string;
  epistemic_class?: string;
  evidence_tier?: number;
  passages?: string[] | Array<Record<string, unknown>>;
  evidence?: Record<string, unknown> | null;
  passage_details?: Array<Record<string, unknown>>;
  connections?: R10ConnectionSummary[];
  sources?: string[];
  alignments?: SequenceParallelAlignmentV3[];
  [key: string]: unknown;
}

export interface SetCombineV3Params {
  include: string[] | string;
  exclude?: string[] | string;
  testament?: 'ALL' | 'OT' | 'NT';
  book?: number;
  mode?: 'intersect' | 'ranked';
  limit?: number;
  hydrate_verses?: boolean;
}

export interface SetCombineV3Result {
  schema_version: 3;
  status: 'ok' | 'unavailable' | 'invalid_request';
  mode?: 'intersect' | 'ranked';
  error?: string;
  include?: string[];
  exclude?: string[];
  testament?: string;
  book?: number;
  total_matched?: number;
  returned?: number;
  vids?: number[];
  verses?: Array<{
    vid: number;
    expand_id: string;
    ref: string;
    en?: string;
    score?: number;
    matched_count?: number;
    sample_lemmas?: Array<{ strongs: string; surface: string; gloss: string }>;
  }>;
}

export interface ComparePatternsV1Result extends Record<string, unknown> {
  sequence_alignment?: {
    raw_score: number;
    p_null: number;
    evidence_bits: number;
    arc_kind: string;
    blocks: SequenceParallelBlockV3[];
  };
  tri_textual_alignment?: TriTextualDiffV3Result;
  e_perp?: V3ScoreMeta;
  epistemic_register?: V3ScoreMeta['dominant_register'];
}

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
): Promise<DataResult<V3DiscoverConnectionsResult | null>> {
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
  const { data, error } = await callCorpusRpc<V3DiscoverConnectionsResult>(
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

export async function discoverSubgraphRpc(
  request: SubgraphRequest
): Promise<DataResult<V3SubgraphDiscoveryPacket | null>> {
  const { data, error } = await callCorpusRpc<V3SubgraphDiscoveryPacket>(
    'discover_subgraph_v1',
    {
      anchors: request.anchors,
      max_hops: request.max_hops ?? 3,
      max_nodes: request.max_nodes ?? 60,
      max_edges: request.max_edges ?? 160,
      include_exploratory: request.include_exploratory !== false,
      release_id: request.release_id ?? R10_RELEASE_ID,
    },
    { timeoutMs: 20000 }
  );
  if (error || !data) {
    return errResult(null, error || 'Unable to compute connected subgraph.');
  }
  return okResult(data);
}

export async function discoverPatternsRpc(
  params: Record<string, unknown>
): Promise<DataResult<Record<string, unknown> | null>> {
  const { data, error } = await callCorpusRpc<Record<string, unknown>>(
    'discover_patterns_v1',
    { ...params, release_id: (params.release_id as string) ?? R10_RELEASE_ID },
    { timeoutMs: 20000 }
  );
  if (error || !data) {
    return errResult(null, error || 'Unable to discover patterns.');
  }
  return okResult(data);
}

export async function comparePatternsRpc(
  params: { targets: string[]; limit?: number; release_id?: string }
): Promise<DataResult<ComparePatternsV1Result | null>> {
  const { data, error } = await callCorpusRpc<ComparePatternsV1Result>(
    'compare_patterns_v1',
    {
      targets: params.targets,
      limit: params.limit ?? 8,
      release_id: params.release_id ?? R10_RELEASE_ID,
    },
    { timeoutMs: 20000 }
  );
  if (error || !data) {
    return errResult(null, error || 'Unable to compare patterns.');
  }
  return okResult(data);
}

export async function traceEvidenceRpc(
  params: { evidence_id?: string; from?: string; to?: string; max_hops?: number; release_id?: string }
): Promise<DataResult<Record<string, unknown> | null>> {
  const { data, error } = await callCorpusRpc<Record<string, unknown>>(
    'trace_evidence_v1',
    { ...params, release_id: params.release_id ?? R10_RELEASE_ID },
    { timeoutMs: 15000 }
  );
  if (error || !data) {
    return errResult(null, error || 'Unable to trace evidence.');
  }
  return okResult(data);
}

async function callV3Rpc<T>(
  op: string,
  params: object,
  fallbackErr: string,
  timeoutMs = 15000
): Promise<DataResult<T | null>> {
  const { data, error } = await callCorpusRpc<T>(op, { ...params }, { timeoutMs });
  if (error || !data) {
    return errResult(null, error || fallbackErr);
  }
  return okResult(data);
}

export function lxxConcordanceV3Rpc(
  params: LxxConcordanceV3Params
): Promise<DataResult<LxxConcordanceV3Result | null>> {
  return callV3Rpc<LxxConcordanceV3Result>(
    'lxx_concordance_v3',
    params,
    'Unable to load Rahlfs 1935 LXX concordance.'
  );
}

export function triTextualDiffV3Rpc(
  params: TriTextualDiffV3Params
): Promise<DataResult<TriTextualDiffV3Result | null>> {
  return callV3Rpc<TriTextualDiffV3Result>(
    'tri_textual_diff_v3',
    params,
    'Unable to compute MT ↔ Rahlfs LXX ↔ NT tri-textual alignment.',
    20000
  );
}

export function clauseRoleQueryV3Rpc(
  params: ClauseRoleQueryV3Params
): Promise<DataResult<ClauseRoleQueryV3Result | null>> {
  return callV3Rpc<ClauseRoleQueryV3Result>(
    'clause_role_query_v3',
    params,
    'Unable to run clause role query.'
  );
}

export function sequenceParallelsV3Rpc(
  params: SequenceParallelsV3Params
): Promise<DataResult<SequenceParallelsV3Result | null>> {
  return callV3Rpc<SequenceParallelsV3Result>(
    'sequence_parallels_v3',
    params,
    'Unable to compute sequence parallels.',
    20000
  );
}

export function wordplayScanV3Rpc(
  params: WordplayScanV3Params
): Promise<DataResult<WordplayScanV3Result | null>> {
  return callV3Rpc<WordplayScanV3Result>(
    'wordplay_scan_v3',
    params,
    'Unable to run wordplay & talion scan.'
  );
}

export function expandClueV3Rpc(
  params: ExpandClueV3Params
): Promise<DataResult<ExpandClueV3Result | null>> {
  return callV3Rpc<ExpandClueV3Result>(
    'expand_clue_v3',
    params,
    'Unable to expand v3 clue evidence.'
  );
}

export function setCombineV3Rpc(
  params: SetCombineV3Params
): Promise<DataResult<SetCombineV3Result | null>> {
  return callV3Rpc<SetCombineV3Result>(
    'set_combine_v3',
    params,
    'Unable to run set_combine_v3 query.'
  );
}
