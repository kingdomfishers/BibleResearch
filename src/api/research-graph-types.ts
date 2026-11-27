// @file: src/api/research-graph-types.ts
// @feature: research-graph
// @tables: rg_nodes | rg_claims | rg_claim_participants | rg_claim_evidence | rg_claim_links | rg_claim_revisions | rg_research_trails | note_connection_types

export type RgNodeKind =
  | 'passage'
  | 'word_occurrence'
  | 'word_form'
  | 'lemma'
  | 'sense'
  | 'root'
  | 'letter_or_formation'
  | 'person'
  | 'place'
  | 'event'
  | 'canonical_concept'
  | 'concept'
  | 'physical_object'
  | 'component'
  | 'property'
  | 'process'
  | 'mechanism'
  | 'principle'
  | 'mathematical_structure'
  | 'literary_structure'
  | 'pattern'
  | 'discovery'
  | 'definition'
  | 'hypothesis'
  | 'question'
  | 'external_source'
  | 'note_ref';

export type RgClaimKind =
  | 'textual_observation'
  | 'linguistic_finding'
  | 'explicit_symbol'
  | 'literary_pattern'
  | 'physical_mechanism'
  | 'relational_analogy'
  | 'process_mapping'
  | 'abstract_principle'
  | 'dlm_hypothesis'
  | 'challenge_critique'
  | 'definition'
  | 'unresolved_question';

export type RgEvidenceClass =
  | 'TEXT_EXPLICIT'
  | 'TEXT_LINGUISTIC'
  | 'TEXT_INTERTEXTUAL'
  | 'TEXT_PATTERN'
  | 'SCIENCE_EMPIRICAL'
  | 'DLM_HYPOTHESIS'
  | 'DISPUTED'
  | 'OPEN';

export type RgEpistemicState =
  | 'established_observation'
  | 'well_supported_interpretation'
  | 'plausible_hypothesis'
  | 'speculative'
  | 'disputed'
  | 'open'
  | 'rejected'
  | 'superseded';

export type RgReviewStatus = 'unreviewed' | 'confirmed' | 'disputed' | 'rejected' | 'superseded';

export type RgParticipantRole =
  | 'subject'
  | 'object'
  | 'agent'
  | 'patient'
  | 'recipient'
  | 'instrument'
  | 'source'
  | 'destination'
  | 'condition'
  | 'outcome'
  | 'medium'
  | 'context'
  | 'slot_a'
  | 'slot_b'
  | 'unmatched'
  | 'control'
  | 'mention';

export type RgEvidenceKind =
  | 'scripture_verse'
  | 'word_occurrence'
  | 'lemma'
  | 'algorithm_edge'
  | 'external_source'
  | 'prior_claim'
  | 'note_ref';

export interface RgAuthorInfo {
  id: string;
  kind: 'human' | 'ai';
  display_name: string;
  ai_provider?: string | null;
  ai_model?: string | null;
}

export interface RgNodeRefSummary {
  id: string;
  node_key: string;
  label: string;
  node_kind: RgNodeKind;
  original_script?: string | null;
  strongs_code?: string | null;
}

export interface RgNode extends RgNodeRefSummary {
  origin_layer: 'canonical_ref' | 'human_research' | 'ai_research' | 'external_empirical_citation';
  transliteration?: string | null;
  aliases: string[];
  summary: string;
  definitions?: Record<string, unknown>;
  polarity_notes?: string | null;
  disambiguation_note?: string | null;
  external_uri?: string | null;
  external_citation?: Record<string, unknown>;
  verse_id?: number | null;
  word_id?: number | null;
  word_position?: number | null;
  lemma_id?: number | null;
  concept_id?: number | null;
  place_id?: number | null;
  event_id?: number | null;
  author?: RgAuthorInfo;
  review_status: RgReviewStatus;
  visibility: 'public' | 'private';
  version: number;
}

export interface RgParticipant {
  node_id: string;
  node_key: string;
  label: string;
  role: RgParticipantRole;
  ordinal: number;
  slot_key?: string | null;
  notes?: string | null;
}

export interface RgEvidenceItem {
  id?: string;
  polarity: 'supporting' | 'counterexample' | 'control' | 'limiting_case';
  evidence_kind: RgEvidenceKind;
  source_key: string;
  verse_id?: number | null;
  word_id?: number | null;
  word_position?: number | null;
  lemma_id?: number | null;
  target_claim_id?: string | null;
  algorithm_evidence_id?: string | null;
  external_title?: string | null;
  external_url?: string | null;
  explanation: string;
  is_primary_source: boolean;
}

export interface RgClaimSummary {
  id: string;
  claim_key: string;
  claim_kind: RgClaimKind;
  relation_role?: 'outgoing' | 'incoming' | 'participant';
  title: string;
  assertion_text: string;
  contextual_scope: string;
  limitations: string;
  unresolved_questions?: string[];
  predicate: string;
  predicate_label: string;
  predicate_inverse_label?: string | null;
  predicate_is_transitive?: boolean;
  predicate_is_symmetric?: boolean;
  predicate_category?: string;
  direction: 'directed' | 'bidirectional' | 'undirected';
  subject?: RgNodeRefSummary | null;
  object?: RgNodeRefSummary | null;
  participants?: RgParticipant[];
  evidence?: RgEvidenceItem[];
  origin_layer: 'human_research' | 'ai_research';
  evidence_class: RgEvidenceClass;
  epistemic_state: RgEpistemicState;
  review_status: RgReviewStatus;
  confidence?: number | null;
  is_potentially_stale: boolean;
  stale_reason?: string | null;
  independent_primary_witness_count?: number;
  challenge_count?: number;
  quality_score?: number;
  dlm_metadata?: Record<string, unknown>;
  author: RgAuthorInfo;
  version: number;
  visibility?: 'public' | 'private';
  updated_at?: string;
}

export interface RgSearchResponse {
  status: string;
  epistemic_layer: 'research_knowledge_graph';
  untrusted_content_notice: string;
  total: number;
  shown: number;
  offset: number;
  items: RgClaimSummary[];
}

export interface RgDossierResponse {
  status: 'ok' | 'not_found';
  epistemic_layer: 'research_knowledge_graph';
  untrusted_content_notice?: string;
  node: RgNode | null;
  claims: RgClaimSummary[];
  linked_notes?: Array<{
    id: string;
    title: string | null;
    note_kind: string;
    author_kind: 'human' | 'ai';
    review_status: string;
    excerpt: string;
    updated_at: string;
  }>;
  summary_counts?: {
    claims_shown: number;
    potentially_stale: number;
    challenges_or_disputed: number;
    linked_notes: number;
  };
}

export interface RgNeighborhoodEdge {
  claim_id: string;
  claim_key: string;
  claim_kind: RgClaimKind;
  title: string;
  assertion_text: string;
  contextual_scope: string;
  limitations: string;
  predicate: string;
  predicate_label: string;
  predicate_inverse_label: string;
  is_transitive: boolean;
  is_symmetric: boolean;
  direction: 'directed' | 'bidirectional' | 'undirected';
  traversal_dir: 'outgoing' | 'incoming';
  neighbor_id: string;
  neighbor_key: string;
  neighbor_label: string;
  neighbor_kind: RgNodeKind;
  neighbor_strongs?: string | null;
  neighbor_script?: string | null;
  origin_layer: 'human_research' | 'ai_research';
  evidence_class: RgEvidenceClass;
  epistemic_state: RgEpistemicState;
  review_status: RgReviewStatus;
  confidence?: number | null;
  is_potentially_stale: boolean;
  author_display_name: string;
  author_kind: 'human' | 'ai';
  ai_model?: string | null;
  independent_witness_count: number;
  challenge_count: number;
}

export interface RgNeighborhoodResponse {
  status: string;
  epistemic_layer: 'research_knowledge_graph';
  center_node_id?: string;
  total_degree: number;
  hub_truncated?: boolean;
  edges: RgNeighborhoodEdge[];
}

export interface RgPathStep {
  claim_id: string;
  from_node_id: string;
  to_node_id: string;
  predicate: string;
  predicate_label: string;
  step_direction: 'forward' | 'reverse';
  is_transitive: boolean;
  evidence_class: RgEvidenceClass;
  review_status: RgReviewStatus;
  origin_layer: 'human_research' | 'ai_research';
  author_kind: 'human' | 'ai';
  title: string;
  is_potentially_stale: boolean;
}

export interface RgPathItem {
  hop_count: number;
  path_classification: 'validated_inference_path' | 'exploratory_path';
  transitivity_valid: boolean;
  transitivity_warning: string | null;
  node_ids: string[];
  steps: RgPathStep[];
}

export interface RgPathsResponse {
  status: string;
  epistemic_layer: 'research_knowledge_graph';
  untrusted_content_notice?: string;
  from_node_ids?: string[];
  to_node_ids?: string[];
  paths: RgPathItem[];
}

export interface RgTraceResponse {
  status: string;
  epistemic_layer: 'research_knowledge_graph';
  untrusted_content_notice?: string;
  claim?: Record<string, unknown>;
  independent_primary_witness_count: number;
  primary_witnesses: Array<{
    source_key: string;
    evidence_kind: string;
    verse_id?: number | null;
    word_id?: number | null;
    lemma_id?: number | null;
    external_url?: string | null;
    external_title?: string | null;
    citing_claim_count: number;
  }>;
  shared_upstream_warnings: Array<{
    source_key: string;
    citing_claim_count: number;
    warning: string;
  }>;
  upstream_claims: Array<Record<string, unknown>>;
  challenges: Array<{
    challenge_claim_id: string;
    link_type: string;
    title: string;
    assertion_text: string;
    explanation: string;
    review_status: RgReviewStatus;
    author_kind: 'human' | 'ai';
  }>;
  counterexamples: Array<Record<string, unknown>>;
  stale_or_disputed_dependencies: Array<Record<string, unknown>>;
  circular_dependency_detected: boolean;
}

export interface RgContradictionsResponse {
  status: string;
  epistemic_layer: 'research_knowledge_graph';
  challenges: Array<Record<string, unknown>>;
  disputed_stale_or_open: Array<Record<string, unknown>>;
  competing_claims: Array<Record<string, unknown>>;
}

export interface RgTrailSummary {
  id: string;
  trail_key: string;
  title: string;
  research_question: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  open_frontier_count?: number;
  checkpoint_count?: number;
  frontier?: Array<Record<string, unknown>>;
  checkpoints?: Array<Record<string, unknown>>;
  author_kind: 'human' | 'ai';
  author_display_name: string;
  ai_model?: string | null;
  visibility: 'public' | 'private';
  version: number;
  updated_at: string;
}

export interface RgResolveEntityResponse {
  status: string;
  epistemic_layer: 'research_knowledge_graph';
  query: string;
  rg_nodes: RgNode[];
  canonical_candidates: Array<{
    node_kind: RgNodeKind;
    suggested_node_key: string;
    label: string;
    original_script?: string | null;
    transliteration?: string | null;
    strongs_code?: string | null;
    lemma_id?: number | null;
    verse_id?: number | null;
    concept_id?: number | null;
    place_id?: number | null;
    event_id?: number | null;
    summary: string;
  }>;
}

export interface RgBatchPayload {
  nodes: Array<{
    client_key?: string;
    node_key?: string;
    node_kind: RgNodeKind;
    origin_layer?: 'canonical_ref' | 'human_research' | 'external_empirical_citation';
    verse_id?: number;
    end_verse_id?: number;
    word_id?: number;
    word_position?: number;
    lemma_id?: number;
    concept_id?: number;
    place_id?: number;
    event_id?: number;
    note_id?: string;
    label: string;
    original_script?: string;
    transliteration?: string;
    strongs_code?: string;
    aliases?: string[];
    summary?: string;
    definitions?: Record<string, unknown>;
    polarity_notes?: string;
    disambiguation_note?: string;
    external_uri?: string;
    visibility?: 'public' | 'private';
    update_if_exists?: boolean;
  }>;
  claims: Array<{
    id?: string;
    expected_version?: number;
    client_key?: string;
    claim_key?: string;
    client_request_id?: string;
    claim_kind: RgClaimKind;
    subject_ref?: string;
    predicate: string;
    object_ref?: string;
    direction?: 'directed' | 'bidirectional' | 'undirected';
    title: string;
    assertion_text: string;
    explanation_md?: string;
    contextual_scope?: string;
    limitations?: string;
    unresolved_questions?: string[];
    dlm_metadata?: Record<string, unknown>;
    evidence_class: RgEvidenceClass;
    epistemic_state?: RgEpistemicState;
    review_status?: RgReviewStatus;
    confidence?: number;
    supersedes_claim_id?: string;
    source_note_id?: string;
    visibility?: 'public' | 'private';
    participants?: Array<{
      node_ref: string;
      role: RgParticipantRole;
      ordinal?: number;
      slot_key?: string;
      notes?: string;
    }>;
    evidence?: Array<{
      polarity: 'supporting' | 'counterexample' | 'control' | 'limiting_case';
      evidence_kind: RgEvidenceKind;
      source_key?: string;
      node_ref?: string;
      verse_id?: number;
      word_id?: number;
      word_position?: number;
      lemma_id?: number;
      target_claim_ref?: string;
      algorithm_evidence_id?: string;
      external_title?: string;
      external_url?: string;
      explanation?: string;
      is_primary_source?: boolean;
    }>;
  }>;
  links: Array<{
    from_claim_ref: string;
    to_claim_ref: string;
    link_type: 'supports' | 'challenges' | 'depends_on' | 'supersedes' | 'refines' | 'contradicts' | 'explains';
    explanation?: string;
  }>;
}
