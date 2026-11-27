// @file: src/relationships/multihop-types.ts
// @feature: relationships-r9c
// Shared TypeScript contracts for R9C evidence-based multi-hop relationship discovery.

import type { CanonicalEpistemicClass } from './epistemic-taxonomy.ts';

// === @section:types:entities-and-layers ===
export type EntityKind = 'lemma' | 'root' | 'sense';

export type GraphLayer =
  | 'grammatical'
  | 'lexical'
  | 'contextual'
  | 'lxx_translation';

export type EpistemicClass = CanonicalEpistemicClass | 'candidate_textual_evidence';

export type EdgeDirection = 'directed' | 'symmetric';
export type TraversalDirection = 'forward' | 'reverse' | 'symmetric';
export type DirectionFilter = 'both' | 'outgoing' | 'incoming';
export type QualityThreshold = 'all' | 'exclude_candidate' | 'high_precision_only';
export type JoinScope =
  | 'direct'
  | 'same_frame'
  | 'same_passage'
  | 'cross_passage'
  | 'lexical_or_translation_bridge';

export interface GraphEntityRef {
  entity_key: string;
  entity_kind: EntityKind;
  label: string;
  transliteration: string | null;
  gloss: string | null;
  language: string | null;
  pos: string | null;
  strongs_base: string | null;
  homograph_tag: string | null;
  degree_hint?: number | null;
}

export interface HopEvidenceWitness {
  relation_id?: string;
  frame_id?: string;
  source_clause_id?: string;
  reference: string;
  edition?: string;
  rule_id?: string;
  quality?: string;
  qualifiers?: Record<string, string>;
  in_same_clause?: boolean;
  is_collocation?: boolean;
}

export interface EdgeUncertaintyInfo {
  is_uncertain: boolean;
  mapping_status: string | null;
  homograph_ambiguity: boolean;
  notes: string[];
}

export interface EdgeProvenanceInfo {
  dataset: string;
  license: string;
  locator?: string;
  rule_id?: string;
  rule_version?: string;
}

export interface EdgeStats {
  distinct_passages?: number;
  distinct_books?: number;
  occurrences?: number;
  candidate_occurrences?: number;
  same_verse?: number;
  same_clause?: number;
  collocation_distance_le_3?: number;
  near_verse_window_distance_le_3?: number;
  published_count?: number;
  translation_share?: number;
}

// === @section:types:normalized-edge ===
export interface GraphEdge {
  edge_id: string;
  source_relationship_id: string;
  layer: GraphLayer;
  predicate: string;
  display_predicate: string;
  display_label: string;
  edge_direction: EdgeDirection;
  traversal_direction: TraversalDirection;
  canonical_source: GraphEntityRef;
  canonical_target: GraphEntityRef;
  from_entity: GraphEntityRef;
  to_entity: GraphEntityRef;
  epistemic_class: EpistemicClass;
  quality: string;
  editions: string[];
  language: string | null;
  uncertainty: EdgeUncertaintyInfo;
  stats: EdgeStats;
  sample_references: string[];
  sample_witnesses: HopEvidenceWitness[];
  provenance: EdgeProvenanceInfo;
  guardrails: string[];
}

export interface AssetBudgetContext {
  asset_requests: number;
  shards_read: number;
  bytes_read: number;
  max_asset_requests: number;
  max_bytes_read: number;
  budget_exceeded: boolean;
  exceeded_reason: string | null;
}

export interface NeighborLoadOptions {
  layers?: GraphLayer[];
  predicates?: string[];
  direction?: DirectionFilter;
  min_quality?: QualityThreshold;
  languages?: string[];
  editions?: string[];
  contextual_scope?: 'all' | 'same_clause' | 'collocation' | 'same_verse';
  min_same_verse?: number;
  min_same_clause?: number;
  min_collocation?: number;
  max_contextual_pages?: number;
  target_hint?: string | null;
  target_hints?: string[];
  max_edges_per_node?: number;
  budget?: AssetBudgetContext;
}

export interface NeighborLoadResult {
  entity: GraphEntityRef | null;
  edges: GraphEdge[];
  total_available_edges: number;
  contextual_total_neighbors: number;
  contextual_pages_loaded: number;
  contextual_pages_skipped: number;
  contextual_truncated: boolean;
  shards_read: number;
  bytes_read: number;
  missing_shards: string[];
  uncovered_in_grammatical: boolean;
  incomplete_reasons: string[];
}

// === @section:types:query-and-limits ===
export interface HubPenaltyConfig {
  enabled: boolean;
  function_word_penalty: number;
  hub_degree_threshold: number;
  hub_degree_weight: number;
  allow_function_word_intermediates: boolean;
}

export interface SearchLimits {
  max_nodes_expanded: number;
  max_edges_examined: number;
  max_paths_returned: number;
  max_per_node_edges: number;
  max_contextual_pages_per_node: number;
  max_asset_requests: number;
  max_execution_ms: number;
  max_bytes_read: number;
  max_candidate_paths: number;
  max_summary_hydrations?: number;
}

export type R12EpistemicLayer = 'TEXTUAL' | 'LINGUISTIC' | 'EXTERNAL_WORLD' | 'HYPOTHESIS' | 'RECEPTION';

export type R12EndpointEpistemicStatus =
  | 'DIRECT_ENDPOINT_WITNESS'
  | 'COHERENT_MULTIHOP_LEAD'
  | 'EXPLORATORY_STEP_CHAIN';

export interface R12EndpointContext {
  direct_cooccurrence_refs?: string[];
  lxx_bridge_cooccurrence_refs?: string[];
  same_chapter_overlap?: boolean;
  intermediate_is_proper?: boolean[];
  intermediate_verse_counts?: number[];
}

export interface R12ProofStepInput {
  edge_id: string;
  from_id?: string;
  to_id?: string;
  relation_type: string;
  direction?: 'forward' | 'reverse' | 'undirected' | 'symmetric';
  reversed?: boolean;
  epistemic_layer: R12EpistemicLayer;
  quality_weight: number;
  administrative?: boolean;
  mapping_status?: 'verified' | 'candidate' | 'unmapped' | 'unsupported';
  attestation_groups: string[];
  passage_ids: string[];
  feature_idf?: number;
  intermediate_degree?: number;
  proper_entity?: boolean;
  source_verse_count?: number;
  source_dataset?: string;
  endpoint_context?: R12EndpointContext;
}

export interface R12PathInput {
  path_id?: string;
  anchor_id: string;
  target_id: string;
  steps: R12ProofStepInput[];
  endpoint_context?: R12EndpointContext;
}

export interface R12ScoredPath {
  path_id: string;
  path_key: string;
  anchor_id: string;
  target_id: string;
  steps: R12ProofStepInput[];
  score_version: string;
  meaningful_hops: number;
  physical_hops: number;
  Q: number;
  K: number;
  endpoint_coherence: number;
  D: number;
  T: number;
  hub_penalty: number;
  partial_interest: number;
  C?: number;
  interest?: number;
  mmr_score?: number;
  independent_evidence_groups: string[];
  step_support_group_count: number;
  endpoint_support_group_count: number;
  edge_ids: string[];
  passage_ids: string[];
  relation_types: string[];
  epistemic_status: 'EXPLORATORY' | 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION';
  endpoint_epistemic_status: R12EndpointEpistemicStatus;
  score_parts: {
    Q: number;
    K?: number;
    C?: number;
    D: number;
    T: number;
    hub_penalty: number;
  };
}

export interface R12DestinationRecommendation {
  anchor_id: string;
  target_id: string;
  score_version: string;
  best_path_quality: number;
  K?: number;
  endpoint_coherence: number;
  interest: number;
  C: number;
  convergence: number;
  independent_group_count: number;
  support_group_count: number;
  step_support_group_count: number;
  endpoint_support_group_count: number;
  independent_evidence_groups: string[];
  best_path: R12ScoredPath;
  alternative_paths: R12ScoredPath[];
  paths: R12ScoredPath[];
  mmr_score?: number;
  evidence_status: 'MIXED_OR_EXPLORATORY' | 'SUPPORTED_STEPS_NOT_ENDPOINT_INTERPRETATION';
  endpoint_epistemic_status: R12EndpointEpistemicStatus;
  limitation: string;
}

export interface MultiHopQuery {
  source: string;
  target?: string | null;
  targets?: string[];
  max_hops?: number;
  min_hops?: number;
  offline_mode?: 'r12';
  max_physical_steps?: number;
  beam_width?: number;
  layers?: GraphLayer[];
  predicates?: string[];
  direction?: DirectionFilter;
  min_quality?: QualityThreshold;
  languages?: string[];
  editions?: string[];
  contextual_scope?: 'all' | 'same_clause' | 'collocation' | 'same_verse';
  min_same_verse?: number;
  min_same_clause?: number;
  min_collocation?: number;
  allow_cycles?: boolean;
  hub_penalty?: Partial<HubPenaltyConfig>;
  limits?: Partial<SearchLimits>;
  limit?: number;
  offset?: number;
  cursor?: string | null;
}

// === @section:types:paths-and-ranking ===
export interface PathStep {
  hop_index: number;
  from_entity: GraphEntityRef;
  to_entity: GraphEntityRef;
  canonical_source_entity: GraphEntityRef;
  canonical_target_entity: GraphEntityRef;
  predicate: string;
  display_predicate: string;
  display_label: string;
  direction: EdgeDirection;
  traversal_direction: TraversalDirection;
  layer: GraphLayer;
  epistemic_class: EpistemicClass;
  source_relationship_id: string;
  quality: string;
  editions: string[];
  language: string | null;
  uncertainty: EdgeUncertaintyInfo;
  evidence_summary: EdgeStats & {
    sample_references: string[];
    sample_witnesses: HopEvidenceWitness[];
  };
  provenance: EdgeProvenanceInfo;
  guardrails: string[];
}

export interface RankingFactors {
  evidence_strength: number;
  directness_bonus: number;
  passage_support: number;
  distinctiveness: number;
  provenance_quality: number;
  hop_penalty: number;
  uncertainty_penalty: number;
  hub_penalty: number;
  same_frame_bonus: number;
}

export interface RankingSummary {
  score: number;
  score_kind: 'heuristic_evidence_relevance_not_truth_probability';
  factors: RankingFactors;
  why_ranked: string;
}

export interface PathExplanation {
  establishes: string;
  does_not_establish: string[];
  join_scope: JoinScope;
  shared_frame_ids: string[];
  shared_references: string[];
}

export interface MultiHopPath {
  path_id: string;
  hop_count: number;
  entities: GraphEntityRef[];
  steps: PathStep[];
  layers_used: GraphLayer[];
  epistemic_classes: EpistemicClass[];
  ranking: RankingSummary;
  uncertainty_indicators: string[];
  interpretation_guardrails: string[];
  explanation: PathExplanation;
}

// === @section:types:response-and-coverage ===
export interface SearchCoverageMetadata {
  exhaustive: boolean;
  search_stopped_by_limits: boolean;
  limits_reached: string[];
  source_coverage_incomplete: boolean;
  incomplete_reasons: string[];
  missing_shards: string[];
  truncated_contextual_entities: string[];
  nodes_expanded: number;
  edges_examined: number;
  asset_requests: number;
  shards_read: number;
  bytes_read: number;
  execution_ms: number;
  contextual_pages_loaded: number;
  total_paths_found: number;
  paths_returned: number;
}

export interface MultiHopPagination {
  limit: number;
  offset: number;
  returned: number;
  total_available: number;
  has_more: boolean;
  next_offset: number | null;
  next_cursor: string | null;
}

export interface MultiHopResult {
  schema_version: '1.0';
  release_version: string;
  status: 'ok' | 'no_supported_path' | 'invalid_request' | 'unknown_entity' | 'incomplete_coverage';
  message: string;
  query: {
    starting_entity: GraphEntityRef | { entity_key: string };
    target_entity: GraphEntityRef | { entity_key: string } | null;
    target_entities?: Array<GraphEntityRef | { entity_key: string }>;
    applied_filters: {
      layers: GraphLayer[];
      predicates: string[] | null;
      direction: DirectionFilter;
      min_quality: QualityThreshold;
      languages: string[] | null;
      editions: string[] | null;
      allow_cycles: boolean;
      allow_function_word_intermediates: boolean;
    };
    max_hops: number;
  };
  paths: MultiHopPath[];
  r12_recommendations?: {
    top: R12DestinationRecommendation[];
    tail: R12DestinationRecommendation[];
    next_cursor: string | null;
    score_version: string;
    coverage: 'ranked_top_n' | 'complete_candidate_pool';
    unreturned_destinations: number;
    pruned_incoherent_count?: number;
  };
  pagination: MultiHopPagination;
  coverage: SearchCoverageMetadata;
  guardrails: {
    ranking_is_not_truth_probability: true;
    preserves_distinct_epistemic_classes: true;
    requires_verifiable_source_edges: true;
    cross_language_path_not_nt_theology_proof: true;
  };
}

// === @section:types:concept-and-loader ===
export interface ConceptCandidate {
  entity_key: string;
  entity_kind: EntityKind;
  language: string | null;
  label: string;
  transliteration: string | null;
  gloss: string | null;
  pos: string | null;
  strongs_base: string | null;
  extended_strongs: string | null;
  match_kind: 'exact_id' | 'extended_strongs' | 'base_strongs_candidate' | 'surface_form' | 'transliteration' | 'licensed_gloss_candidate';
  in_grammatical_graph: boolean;
  grammatical_degree: number;
}

export interface ConceptResolutionResult {
  schema_version: '1.0';
  query: string;
  status: 'resolved' | 'needs_disambiguation' | 'not_found' | 'invalid_request' | 'incomplete_coverage';
  requires_explicit_selection: boolean;
  candidates: ConceptCandidate[];
  guardrails: {
    english_concept_never_auto_picks_single_lemma: true;
    gloss_similarity_never_creates_graph_edges: true;
    homographs_preserved_distinct: true;
  };
  guidance: string;
}

export interface AdjacencyLoader {
  getReleaseVersion(budget?: AssetBudgetContext): Promise<string>;
  getEntityProfile(entityKey: string, budget?: AssetBudgetContext): Promise<GraphEntityRef | null>;
  getNeighbors(entityKey: string, options?: NeighborLoadOptions): Promise<NeighborLoadResult>;
  getSummaryEvidence(summaryId: string, budget?: AssetBudgetContext): Promise<HopEvidenceWitness[]>;
  getManifestSummary(budget?: AssetBudgetContext): Promise<Record<string, unknown> | null>;
  getResolverIndex?(budget?: AssetBudgetContext): Promise<unknown | null>;
}
