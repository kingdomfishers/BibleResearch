// @file: src/api/relationship-types.ts
// @feature: api
// @tables: entity_relationships | lemma_root_links | lexical_formations | lemma_components | lexical_connections | lemmas | lexemes | lexical_senses | notes | note_anchors | note_connections
// @candidates: none
// @toc: types:epistemology | types:provenance | types:cross-references | types:lexical-taxonomy | types:lexical-edges | types:responses

// === @section:types:epistemology ===
export type RelationshipDomain = 'cross_reference' | 'lexical';

export type RelationshipEpistemicTier =
  | 'attested_lexical_fact'
  | 'deterministic_computational'
  | 'statistical_association'
  | 'ai_hypothesis'
  | 'human_reviewed_interpretation';

export type ResearcherRelationshipStance =
  | 'agree'
  | 'disagree'
  | 'alternative_interpretation';

export type VersificationMatchStatus =
  | 'exact_canonical'
  | 'exact_psalm_heading'
  | 'combined_heading_and_verse1'
  | 'sub_verse_part'
  | 'versification_shift'
  | 'edition_only_non_canonical';

export interface CrossReferenceGuardrails {
  association_only: true;
  implies_quotation: false;
  implies_prophecy: false;
  implies_typology: false;
  implies_theological_equivalence: false;
}

export interface LexicalGuardrails {
  implies_synonymy: boolean;
  implies_common_etymology: boolean;
  inferred_from_english_gloss: false;
  inferred_from_spelling_alone: false;
}

// === @section:types:provenance ===
export interface RelationshipSourceProvenance {
  source_key: string;
  source_title: string;
  dataset_url: string;
  pinned_commit: string;
  license: string;
  attribution: string;
  locator: string;
  raw_field: string | null;
  algorithm_version: string | null;
  excluded_restricted_fields?: string[];
}

export interface CanonicalPassageEndpoint {
  book: number;
  chapter: number;
  verse_start: number;
  verse_end: number;
  start_verse_id: number | null;
  end_verse_id: number | null;
  is_psalm_heading: boolean;
  versification_status: VersificationMatchStatus;
  edition_only_ref?: {
    edition: 'KJV' | 'BSB' | 'AOV';
    book: number;
    chapter: number;
    verse: number;
    source_verse_uid: number;
  } | null;
  versification_note: string | null;
}

export interface CrossReferenceAnchorPhrase {
  anchor_sort: number;
  anchor_scope: 'phrase' | 'whole_verse';
  phrase_bsb: string | null;
  phrase_kjv: string | null;
  phrase_language: 'en';
  token_alignment: null;
  source_subverse_sort: number;
}

// === @section:types:cross-references ===
export type CrossReferenceTargetKind = 'single_verse' | 'verse_range' | 'verse_cluster';
export type CrossReferenceDirection = 'outgoing' | 'incoming';

export interface CrossReferenceEdge {
  relationship_id: string;
  schema_version: 1;
  domain: 'cross_reference';
  relation_type: 'source_passage_association';
  epistemic_tier: 'attested_lexical_fact' | 'deterministic_computational';
  direction: CrossReferenceDirection;
  source_passage: CanonicalPassageEndpoint;
  anchor: CrossReferenceAnchorPhrase;
  target_kind: CrossReferenceTargetKind;
  target_spans: CanonicalPassageEndpoint[];
  target_label: string;
  group_ordinal: number;
  rank_order: number;
  provenance: RelationshipSourceProvenance;
  guardrails: CrossReferenceGuardrails;
}

export interface CrossReferenceLookupRequest {
  book: number;
  chapter: number;
  verse: number;
  verse_end?: number | null;
  direction?: 'outgoing' | 'incoming' | 'both';
  translation_filter?: 'all' | 'bsb' | 'kjv';
  limit?: number;
  cursor?: string | null;
}

// === @section:types:lexical-taxonomy ===
export type BiblicalLanguageCode = 'hbo' | 'arc' | 'grc';

export type LexicalRelationshipCategory =
  | 'same_lemma'
  | 'same_documented_root'
  | 'derivation'
  | 'cognate'
  | 'loan_transliteration'
  | 'morphological_relationship'
  | 'source_lexical_equivalence'
  | 'semantic_overlap'
  | 'synonymy'
  | 'antonymy'
  | 'related_translation'
  | 'literary_wordplay'
  | 'orthographic_overlap'
  | 'co_occurrence';

export interface LexicalEndpointRef {
  entity_kind: 'lemma' | 'lexeme' | 'word_form' | 'root' | 'sense';
  canonical_key: string;
  lemma_id: number | null;
  word_id: number | null;
  language: BiblicalLanguageCode;
  base_strongs: string | null;
  extended_strongs: string | null;
  disambiguated_strongs: string | null;
  unified_strongs: string | null;
  homograph_tag: string | null;
  lemma_text: string;
  transliteration: string | null;
  primary_gloss: string | null;
  sense_ambiguous: boolean;
}

// === @section:types:lexical-edges ===
export interface LexicalStatisticalMetrics {
  shared_count: number;
  subject_total: number;
  object_total: number | null;
  score: number | null;
  metric_formula: string;
  shared_renderings?: string[];
}

export interface LexicalRelationshipEdge {
  relationship_id: string;
  schema_version: 1;
  domain: 'lexical';
  category: LexicalRelationshipCategory;
  raw_relation_code: string;
  epistemic_tier: RelationshipEpistemicTier;
  direction: 'directed' | 'symmetric' | 'inverse';
  subject: LexicalEndpointRef;
  target: LexicalEndpointRef;
  reused_source_table:
    | 'lemma_root_links'
    | 'entity_relationships'
    | 'lexical_formations'
    | 'lemma_components'
    | 'lexical_connections'
    | 'word_form_lemmas'
    | 'words.co_occurrences'
    | 'stepbible_lexicon'
    | 'verse_translation_sources';
  explanation: string;
  evidence_verses: CanonicalPassageEndpoint[];
  statistics: LexicalStatisticalMetrics | null;
  provenance: RelationshipSourceProvenance;
  guardrails: LexicalGuardrails;
}

export interface LexicalRelationshipLookupRequest {
  query?: string | null;
  word_id?: number | null;
  lemma_key?: string | null;
  categories?: LexicalRelationshipCategory[];
  epistemic_tiers?: RelationshipEpistemicTier[];
  include_statistical?: boolean;
  limit?: number;
  cursor?: string | null;
}

// === @section:types:responses ===
export interface RelationshipPageInfo {
  limit: number;
  returned: number;
  total_available: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface CrossReferenceLookupResponse {
  schema_version: 1;
  status: 'ok' | 'invalid_reference' | 'edition_only_passage' | 'not_in_slice' | 'invalid_cursor';
  epistemic_layer: 'static_source_evidence';
  query_passage: CanonicalPassageEndpoint | null;
  direction: 'outgoing' | 'incoming' | 'both';
  outgoing: CrossReferenceEdge[];
  incoming: CrossReferenceEdge[];
  page: RelationshipPageInfo;
  guardrails: CrossReferenceGuardrails;
  dataset_attribution: RelationshipSourceProvenance;
  error_message?: string | null;
}

export interface LexicalRelationshipLookupResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request' | 'invalid_cursor';
  epistemic_layer: 'static_source_evidence';
  focus: LexicalEndpointRef | null;
  homograph_siblings: LexicalEndpointRef[];
  edges: LexicalRelationshipEdge[];
  category_counts: Partial<Record<LexicalRelationshipCategory, number>>;
  epistemic_counts: Partial<Record<RelationshipEpistemicTier, number>>;
  page: RelationshipPageInfo;
  error_message?: string | null;
}
