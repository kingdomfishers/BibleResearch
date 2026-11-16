/**
 * R10 Biblical Concept, Motif & Typology Discovery contracts.
 * Strictly separates source textual evidence, authorial interpretation,
 * lexical/grammatical facts, shared imagery, orthographic resemblance,
 * and candidate/interpretive patterns.
 */

export type R10NodeKind =
  | 'lemma'
  | 'sense'
  | 'root'
  | 'occurrence'
  | 'passage'
  | 'phrase'
  | 'number_entity'
  | 'motif'
  | 'event'
  | 'comparison'
  | 'xref'
  | 'concept'
  | 'interpretation';

export type R10Predicate =
  | 'explicit_identification'
  | 'explicit_comparison'
  | 'typological_interpretation'
  | 'direct_quotation'
  | 'authorial_interpretation'
  | 'verified_lexical_grammatical'
  | 'numbered_entity'
  | 'literary_correspondence'
  | 'cross_reference_witness'
  | 'shared_motif'
  | 'literary_pattern'
  | 'orthographic_wordplay'
  | 'orthographic_overlap'
  | 'cross_language_bridge'
  | 'biblical_event'
  | 'interpretive_hypothesis';

export type R10EpistemicClass =
  | 'direct_textual_evidence'
  | 'authorial_typology_or_quote'
  | 'documented_lexical_relationship'
  | 'verified_cross_reference'
  | 'shared_motif_evidence'
  | 'candidate_literary_pattern'
  | 'orthographic_similarity_only'
  | 'interpretive_hypothesis'
  | 'user_note';

/** §5 Evidence hierarchy tiers (1 = highest source-backed explicitness, 8 = unreviewed hypothesis). */
export type R10EvidenceTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type R10NumberKind =
  | 'counted_objects'
  | 'sevenfold_or_descriptive'
  | 'temporal_duration'
  | 'ordinal_occurrence'
  | 'symbolic_vision_count';

export interface R10OriginalWordRef {
  lemma_key?: string;
  strongs?: string;
  language: 'hbo' | 'grc';
  lemma_script: string;
  transliteration: string;
  gloss: string;
  sense_note?: string;
}

export interface R10PassageRef {
  verse_id: number;
  ref: string;
  mt_ref?: string;
  is_psalm_heading?: boolean;
  book: number;
  chapter: number;
  verse: number;
  end_verse?: number;
  testament: 'OT' | 'NT';
  snippet?: string;
}

export interface R10Node {
  id: string;
  kind: R10NodeKind;
  label: string;
  subtitle?: string;
  language?: 'hbo' | 'grc' | 'en';
  strongs?: string;
  lemma_key?: string;
  lemma_script?: string;
  transliteration?: string;
  gloss?: string;
  passage?: R10PassageRef;
  number_value?: number;
  number_kind?: R10NumberKind;
  motif_id?: string;
  event_id?: string;
  epistemic_class: R10EpistemicClass;
  grounding_source: string;
}

export interface R10ResolvedConcept {
  input_token: string;
  normalized: string;
  matched: boolean;
  resolution_kind:
    | 'passage_ref'
    | 'strongs'
    | 'script_or_transliteration'
    | 'english_concept'
    | 'motif'
    | 'number'
    | 'event'
    | 'unresolved';
  candidate_nodes: R10Node[];
  lemmas: R10OriginalWordRef[];
  sense_candidates?: Array<{ key: string; gl: string; note?: string }>;
  homograph_siblings?: Array<{ bs: string; lk?: string; sc: string; tr: string; gl: string }>;
  forms?: Array<{ sf: string; tr: string; gl: string; mc?: string; cnt: number }>;
  total_verses?: number;
  entity_kind?: string;
  ambiguity_note?: string;
}

export interface R10EvidenceRecord {
  evidence_id: string;
  predicate: R10Predicate;
  evidence_tier: R10EvidenceTier;
  epistemic_class: R10EpistemicClass;
  title: string;
  summary: string;
  source_node_id: string;
  target_node_id: string;
  passages: R10PassageRef[];
  original_words: R10OriginalWordRef[];
  matched_terms: string[];
  /** Number classification or orthographic analysis details when applicable. */
  number_classification?: {
    number_value: number;
    counted_entity: string;
    kind: R10NumberKind;
    coincidence_risk: 'low' | 'moderate' | 'high';
    note: string;
  };
  orthographic_analysis?: {
    source_script: string;
    target_script: string;
    source_consonants: string;
    target_consonants: string;
    shared_consonants: string;
    overlap_kind: 'documented_biblical_wordplay' | 'shared_root' | 'consonantal_subsequence_only';
    proven_common_root: boolean;
    etymology_warning: string;
  };
  linguistic_notes?: string[];
  limitations: string[];
  provenance: {
    source_dataset: string;
    source_record_ids: string[];
    license: string;
    derivation_method: string;
  };
  score_components: {
    base_tier_score: number;
    specificity_bonus: number;
    witness_bonus: number;
    common_word_penalty: number;
    number_coincidence_penalty: number;
    orthographic_penalty: number;
    final_score: number;
  };
}

export interface R10ConnectionSummary {
  connection_id: string;
  evidence_id: string;
  title: string;
  explanation: string;
  predicate: R10Predicate;
  evidence_tier: R10EvidenceTier;
  epistemic_class: R10EpistemicClass;
  score: number;
  confidence_label: 'explicit_textual' | 'strong_correspondence' | 'moderate_motif' | 'lexical_reference' | 'candidate_pattern' | 'orthographic_only' | 'interpretive';
  uncertainty_note: string;
  matched_concepts: string[];
  passages: R10PassageRef[];
  original_words: R10OriginalWordRef[];
  witness_count: number;
  penalties_applied: string[];
  cluster_id?: string;
  ranking_rationale?: {
    base_tier_score: number;
    specificity_bonus: number;
    witness_bonus: number;
    penalties: string[];
    final_score: number;
    why_ranked_high: string;
  };
}

export interface R10PathStep {
  from_node_id: string;
  from_label: string;
  to_node_id: string;
  to_label: string;
  predicate: R10Predicate;
  evidence_tier: R10EvidenceTier;
  epistemic_class: R10EpistemicClass;
  evidence_id: string;
  relation_summary: string;
  key_passage?: R10PassageRef;
}

export interface R10ConnectionPath {
  path_id: string;
  start_node: R10Node;
  end_node: R10Node;
  steps: R10PathStep[];
  matched_concepts: string[];
  weakest_tier: R10EvidenceTier;
  aggregate_score: number;
  explanation: string;
  limitations: string[];
}

export interface R10Cluster {
  cluster_id: string;
  label: string;
  category?: string;
  concepts: string[];
  anchor_nodes: R10Node[];
  connection_ids: string[];
  summary: string;
  total_passages?: number;
  passages?: R10PassageRef[];
  uncertainty_note?: string;
  collocated_words?: Array<{ bs: string; sc: string; tr: string; gl: string; hits: number; score: number }>;
}

export interface R10ClusterBridge {
  bridge_id: string;
  from_cluster_id: string;
  to_cluster_id: string;
  bridging_node: R10Node;
  evidence_id: string;
  evidence_tier: R10EvidenceTier;
  explanation: string;
}

export interface R10ControlOrWarning {
  control_id: string;
  kind:
    | 'negative_control'
    | 'number_coincidence_warning'
    | 'orthographic_false_positive_warning'
    | 'distinct_context_warning'
    | 'alternative_explanation'
    | 'missing_evidence'
    | 'homograph_disambiguation';
  title: string;
  explanation: string;
  passages?: R10PassageRef[];
  original_words?: R10OriginalWordRef[];
}

export interface DiscoverConnectionsQuery {
  query: string;
  concepts?: string[];
  mode?: 'discover' | 'expand' | 'bridge' | 'compare' | 'explain' | 'challenge';
  cluster_id?: string;
  focus_lemma?: string;
  compare_targets?: string[];
  filters?: {
    predicates?: R10Predicate[];
    max_tier?: R10EvidenceTier;
    include_orthographic?: boolean;
    include_candidate_patterns?: boolean;
    include_interpretive?: boolean;
    testaments?: Array<'OT' | 'NT'>;
  };
  limit?: number;
  cursor?: string | null;
  max_hops?: number;
  release_id?: string;
}

export interface DiscoverConnectionsResult {
  schema_version: 1;
  status: 'ok' | 'partial' | 'no_match';
  release_id: string;
  parsed_query: {
    raw_query: string;
    extracted_terms: string[];
    explicit_passages: R10PassageRef[];
    resolved_concepts: R10ResolvedConcept[];
    missing_concepts: string[];
    multi_cluster_mode: boolean;
  };
  strongest_connections: R10ConnectionSummary[];
  clusters: R10Cluster[];
  bridges: R10ClusterBridge[];
  connection_paths: R10ConnectionPath[];
  related_discoveries: {
    additional_motifs: Array<{ motif_id: string; label: string; summary: string; passage_count: number }>;
    roots_and_wordplay: R10ConnectionSummary[];
    cross_references: Array<{ from_ref: string; to_ref: string; anchor_phrase: string; from_passage: R10PassageRef; to_passage: R10PassageRef }>;
    literary_parallels: R10ConnectionSummary[];
    biblical_events: Array<{ event_id: string; title: string; timing_label?: string; passages: R10PassageRef[] }>;
  };
  controls_and_alternatives: R10ControlOrWarning[];
  pagination: {
    total_available: number;
    returned: number;
    next_cursor: string | null;
    has_more: boolean;
  };
  search_metadata: {
    exhaustive: boolean;
    bounded_by: string[];
    asset_requests_used: number;
    execution_ms: number;
    source_attribution: string[];
  };
  iterative_analysis?: {
    mode: string;
    explanation?: string;
    comparison?: any;
    bridges?: any[];
    challenges?: R10ControlOrWarning[];
    lemma_occurrences?: {
      strongs: string;
      total_verses: number;
      offset: number;
      returned: number;
      next_cursor: string | null;
      has_more: boolean;
      passages: R10PassageRef[];
    };
  };
}

export interface ConnectionEvidenceResult {
  schema_version: 1;
  status: 'ok' | 'not_found';
  release_id: string;
  evidence: R10EvidenceRecord | null;
  passage_details: Array<{
    passage: R10PassageRef;
    english_text: string | null;
    english_edition: string | null;
    original_tokens: Array<{
      word_no: number;
      surface: string;
      lemma: string;
      strongs: string;
      transliteration?: string;
      gloss: string;
      grammar?: string;
      is_highlighted: boolean;
    }>;
  }>;
  notes_overlay_hint?: {
    has_interpretive_layer: boolean;
    separation_notice: string;
  };
}

export interface ExpandConnectionResult {
  schema_version: 1;
  status: 'ok' | 'not_found';
  release_id: string;
  center_node: R10Node | null;
  connections: R10ConnectionSummary[];
  controls: R10ControlOrWarning[];
  pagination: {
    returned: number;
    next_cursor: string | null;
    has_more: boolean;
  };
}
