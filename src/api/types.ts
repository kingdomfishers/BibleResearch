// @file: src/api/types.ts
// @feature: api
// @tables: words | verses | verse_translation_sources | word_translation_choices | chronology_models | chronology_runs | chronology_assertions | chronology_evidence | places | place_locations | verse_geography | passage_geography | geography_sources | lexemes | concepts | assertions | assertion_evidence
// @candidates: none
// @toc: types | types:chronology-models | types:chronology-packet | types:geography-packet | types:research-packet | types:hydrated-words | types:hydrated-packet

// === @section:types ===
export interface ActivePassage { book: number; chapter: number; verse: number }
export interface CoOccurrenceItem { word_id: number; score: number; freq: number; avg_dist: number }
export interface WordRecord {
  id: number;
  strongs_nr: string;
  grammar_code: string | null;
  original_word: string;
  transliteration: string;
  co_occurrences: CoOccurrenceItem[] | null;
  biblical_def: string | null;
  physical_def: string | null;
  english_translations: string[] | null;
}
export interface VerseWordToken {
  word_position: number;
  word_id: number;
  original_word: string;
  transliteration: string;
  strongs_nr: string;
  grammar_code: string | null;
  primary_english: string | null;
  millennium: number | null;
}
export interface VerseTranslationToken extends VerseWordToken {
  source_english: string | null;
  english_translations: string[];
  selected_english: string | null;
  has_choice: boolean;
  source_ref: string | null;
}
export interface TranslationSaveResult {
  saved: boolean;
  english: string;
  source_english: string;
}
export interface WordOccurrence {
  book: number; chapter: number; verse_nr: number;
  millennium: number | null; occurrence_count: number;
}
export interface HydratedCoOccurrence {
  word_id: number; strongs_nr: string; original_word: string;
  transliteration: string; primary_english: string | null;
  score: number; frequency: number; avg_distance: number;
}
export interface WordRelationship {
  book: number; chapter: number; verse_nr: number;
  millennium: number | null; relationship_score: number;
}
export interface DataResult<T> {
  data: T; source: 'sample' | 'live' | 'unavailable'; error: string | null;
}

// === @section:types:chronology-models ===
export type ChronologyAxis = 'source_placement' | 'setting' | 'composition' | 'mentioned_event';
export type ChronologyReview = 'source_import' | 'model_assumption' | 'reviewed' | 'candidate';
export interface ChronologyCoverage { passages: number; dated: number; unresolved: number; conflicting: number }
export interface ChronologyModel {
  id: string; name: string; assumptions: Record<string, unknown>;
  adam_year: number | null; resurrection_year: number | null;
  run_id?: string; coverage?: ChronologyCoverage;
}
export interface ChronologyAssertion {
  id: string; model_id: string; axis: ChronologyAxis;
  earliest_year: number; latest_year: number; preferred_year: number | null;
  date_label: string; precision: string; method: string; rationale: string;
  author: string; review_status: ChronologyReview; mapping: Record<string, unknown>;
  source: { dataset: string; version: string; locator: string; license: string; attribution: string };
  supersedes: string | null; event_title: string | null; original_date: string | null; duration: string | null;
}
export interface ChronologyEvidence {
  id: string; assertion_id: string;
  category: 'textual' | 'archaeological' | 'model_premise' | 'scholarly_interpretation';
  title: string; citation: string; locator: string; summary: string; dating_method: string;
  scope: string; uncertainty: string; review_status: ChronologyReview;
  object_year: number | null; object_date_label: string | null;
  event_year: number | null; event_date_label: string | null;
  relationship: 'supporting' | 'challenging' | 'contextual'; applicability: 'direct' | 'inherited'; explanation: string;
}

// === @section:types:chronology-packet ===
export interface ChronologyRun { id: string; label: string; created_at: string; coverage: ChronologyCoverage }
export interface ChronologySummary {
  axis: ChronologyAxis | null; earliest_year: number | null; latest_year: number | null;
  label: string; millennium_first: number | null; millennium_last: number | null;
}
export interface ChronologyAlternative {
  id: string; model_id: string; model_name: string; run_id: string; axis: ChronologyAxis;
  date_label: string; earliest_year: number; latest_year: number;
  event_title: string | null; review_status: ChronologyReview;
}
export interface ChronologyPacket {
  schema_version: 1; status: 'ok'; models: ChronologyModel[];
  passage: ActivePassage & { is_heading: boolean }; model: ChronologyModel; run: ChronologyRun;
  assignment_status: 'source_estimate' | 'estimated' | 'conflicting' | 'unresolved';
  summary: ChronologySummary; assertions: ChronologyAssertion[]; assertion_count: number;
  assertions_truncated: boolean; evidence: ChronologyEvidence[]; evidence_truncated: boolean;
  next_evidence_cursor: string | null; has_archaeological_evidence: boolean;
  alternatives: ChronologyAlternative[]; history: Pick<ChronologyRun, 'id' | 'label' | 'created_at'>[];
}
export interface ChronologyErrorPacket {
  schema_version: 1; models: ChronologyModel[];
  status: 'invalid_reference' | 'passage_not_found' | 'invalid_model' | 'invalid_run'
    | 'release_unavailable' | 'invalid_cursor' | 'packet_limit_exceeded';
}
export type ChronologyResponse = ChronologyPacket | ChronologyErrorPacket;

// === @section:types:geography-packet ===
export type GeographyRelationshipType =
  | 'event_location' | 'contextual_location' | 'composition_location' | 'audience_location'
  | 'mentioned_location' | 'travel_origin' | 'travel_destination' | 'uncertain_location';
export type GeographyConfidence = 'established' | 'probable' | 'disputed' | 'regional' | 'symbolic_non_physical' | 'unknown';
export type GeographyLocationStatus = 'established' | 'probable' | 'disputed' | 'regional_only' | 'unknown';
export type GeographyPrecisionKind = 'point' | 'site_area' | 'approximate_region' | 'route_segment' | 'none';
export interface GeographyGeoJSON {
  type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'Point';
  coordinates: unknown;
  credit?: string;
}
export interface GeographySourceCitation {
  id: string; display_name: string; year: number | null; url: string | null;
}
export interface GeographyAlternativeLocation {
  id: string; rank_order: number; modern_name: string;
  latitude: number | null; longitude: number | null;
  geometry: GeographyGeoJSON | null; bbox: number[] | null;
  precision_kind: GeographyPrecisionKind; location_status: GeographyLocationStatus;
  confidence_label: string; raw_source_score: Record<string, unknown>;
  is_alternative: boolean; evidence_summary: string; source_citations: GeographySourceCitation[];
}
export interface GeographyLocation {
  place_id: string; place_key: string; biblical_name: string; ancient_name?: string;
  historical_names: string[]; hebrew_name: string | null; greek_name: string | null;
  strongs_numbers: string[]; place_type: string; is_non_physical: boolean;
  modern_name: string | null; latitude: number | null; longitude: number | null;
  geometry: GeographyGeoJSON | null; bbox: number[] | null;
  precision_kind: GeographyPrecisionKind; relationship_type: GeographyRelationshipType;
  resolution_tier: number; is_inferred: boolean;
  confidence_level: GeographyConfidence; location_status: GeographyLocationStatus;
  confidence_label: string; raw_source_score: Record<string, unknown>;
  evidence_ref: string; establishing_refs: string; passage_title: string | null;
  evidence_explanation: string; identification_evidence: string;
  external_ids: Record<string, string | null>; source_citations: GeographySourceCitation[];
  source: { dataset: string; license: string; attribution: string };
  alternative_locations: GeographyAlternativeLocation[];
}
export interface GeographyEraPlace {
  place_key: string; biblical_name: string; ancient_name: string;
  modern_name: string; place_type: string; latitude: number; longitude: number;
}
export interface GeographyChronologicalContext {
  era_key: string; era_label: string; date_label: string;
  earliest_year: number | null; latest_year: number | null;
}
export interface PassageGeographyContext {
  passage_key: string; title: string; book: number;
  start_chapter: number; start_verse: number; end_chapter: number; end_verse: number;
  relationship_type: GeographyRelationshipType; resolution_tier: number;
  confidence_level: GeographyConfidence; evidence_refs: string; evidence_explanation: string;
}
export interface VerseGeographyPacket {
  schema_version: 1; status: 'ok';
  passage: ActivePassage & { is_heading: boolean };
  chronological_context?: GeographyChronologicalContext;
  resolution_status: 'direct_event_location' | 'passage_context' | 'event_metadata' | 'regional_context' | 'symbolic_non_physical' | 'unknown';
  has_physical_location: boolean; message: string | null; bounds: number[] | null;
  locations: GeographyLocation[]; era_gazetteer?: GeographyEraPlace[];
  passage_contexts: PassageGeographyContext[];
  sources: { source_key: string; dataset: string; version: string; license: string; attribution: string; locator: string }[];
}
export interface VerseGeographyErrorPacket {
  schema_version: 1; status: 'invalid_reference' | 'passage_not_found' | 'packet_limit_exceeded';
}
export type VerseGeographyResponse = VerseGeographyPacket | VerseGeographyErrorPacket;

// === @section:types:research-packet ===
export interface ResearchLexemeCandidate {
  lexeme_key: string; language: 'hbo' | 'arc' | 'grc';
  base_strongs: string; extended_strongs: string; disambiguated_strongs: string | null;
  original_lemma: string; transliteration: string; pos: string | null;
  primary_gloss: string; homograph_note: string | null;
}
export interface ResearchEvidenceSpan {
  role: string; reference: string; book: number;
  start_chapter: number; start_verse: number; end_chapter?: number; end_verse?: number;
  original_terms: string[]; explanation: string; step_url: string | null;
}
export interface ResearchAssertionPath {
  assertion_key: string; subject?: string; predicate: string; object?: string;
  epistemic_category: 'lexical' | 'linguistic' | 'statistical' | 'textual' | 'interpretive';
  review_status?: string; scope_reference: string; denominator_note: string | null;
  summary: string; limitations_note: string; source_attribution?: string;
  evidence_spans: ResearchEvidenceSpan[];
}
export interface RelationshipResearchPacket {
  schema_version: 1; status: 'ok' | 'invalid_request';
  mode?: 'explain' | 'discover'; message?: string;
  query?: { subject: string; target: string | null };
  resolution: {
    subject_concepts: { concept_key: string; title: string; kind: string; primary_strongs: string[]; distinct_from_note: string | null }[];
    target_concepts: { concept_key: string; title: string; kind: string; primary_strongs: string[]; distinct_from_note: string | null }[];
    subject_lexemes: ResearchLexemeCandidate[];
    target_lexemes: ResearchLexemeCandidate[];
    needs_disambiguation: boolean;
  };
  evidence_paths: ResearchAssertionPath[];
  controls_and_distinctions: ResearchAssertionPath[];
  statistical_cooccurrences: HydratedCoOccurrence[];
  coverage: { corpus_passages: number; corpus_tokens: number; truncation: { paths_truncated: boolean; byte_cap_bytes: number } };
}

// === @section:types:hydrated-words ===
export type VerseSpanInput = ActivePassage | { book: number; chapter: number; start_verse: number; end_verse: number };
export interface VerseResearchRequest {
  passages: VerseSpanInput[];
  profile?: 'analysis' | 'full';
  occurrences?: { mode: 'all' | 'sample'; limit?: number };
  chronology_model_id?: string;
}
export interface HydratedResearchWord {
  word_position: number; word_id: number; original_word: string;
  transliteration: string; strongs_nr: string; lexical_entry_key: string;
  grammar: { raw_code: string | null; scheme: string | null;
    decoded_grammar: Record<string, unknown>;
    decoded_features: Record<string, unknown>; unresolved_tags: string[] };
  translations: { source_english: string | null; source_ref: string | null;
    source_name: string | null; source_commit: string | null;
    corpus_gloss: string | null; available_renderings: string[] };
  definitions: { biblical: string | null; physical: string | null; source_release_key: string };
  lexeme_candidates: ResearchLexemeCandidate[];
}
export interface HydratedLexicalEntry {
  identity_scope: 'base_strongs'; strongs_nr: string;
  lexeme_candidates: ResearchLexemeCandidate[]; needs_disambiguation: boolean;
  sense_status: 'not_assigned_to_token'; semantic_annotation_status: 'unavailable' | 'candidate_lexemes_only';
  occurrences: { counting_method: string; corpus_token_total: number; distinct_passage_total: number;
    returned_reference_count: number; complete: boolean;
    references: (ActivePassage & { occurrence_count: number })[] };
  top_connected_words: (HydratedCoOccurrence & { rank: number; english_translations: string[];
    biblical_def: string | null; physical_def: string | null; source_release_key: string })[];
  connection_coverage: { requested: number; returned: number; status: 'cached' | 'no_cached_connections'; method: string };
  limitations: string;
}

// === @section:types:hydrated-packet ===
export interface HydratedSemanticEvidence {
  assertion_key: string; subject: string; object: string; predicate: string;
  epistemic_category: ResearchAssertionPath['epistemic_category']; review_status: string;
  scope_reference: string; denominator_note: string | null; summary: string;
  limitations_note: string; source_attribution: string; rank_order: number;
  evidence_spans: { evidence_role: string; reference_display: string; book: number;
    start_chapter: number; start_verse: number; end_chapter: number; end_verse: number;
    original_terms: string[]; explanation: string; step_url: string | null; step_order: number }[];
}
export interface VerseResearchPacket {
  schema_version: 1; status: 'ok';
  verses: { verse_id: number; verse_ref: string; passage: ActivePassage & { is_heading: boolean };
    words: HydratedResearchWord[]; chronology?: ChronologyResponse; geography?: VerseGeographyResponse;
    semantic_evidence?: HydratedSemanticEvidence[];
    coverage: { semantic_scope: string; grammar_decoding: string; semantic_domains: string; token_senses: string } }[];
  chronology: Record<string, ChronologyResponse>;
  geography: Record<string, VerseGeographyResponse>;
  semantic_evidence: Record<string, HydratedSemanticEvidence[]>;
  lexical_entries: Record<string, HydratedLexicalEntry>;
  sources: { release_key: string; dataset: string; commit_sha: string; license: string; attribution: string }[];
  coverage: { corpus: string; requested_passage_count: number; returned_passage_count: number;
    lexical_entry_count: number; occurrence_mode: 'all' | 'sample'; occurrences_complete: boolean;
    chronology_evidence_complete: boolean;
    component_statuses: { verse_ref?: string; passage: ActivePassage & { is_heading: boolean }; chronology: string; geography: string }[];
    max_passages: number; max_packet_bytes: number; semantic_coverage: string;
    polysemy_homographs_preserved?: boolean; payload_deduplication?: string;
    private_translation_choices_included: false };
}
export interface VerseResearchError {
  schema_version: 1; status: 'invalid_request' | 'passage_not_found' | 'packet_limit_exceeded';
  message?: string; requested_passages?: VerseSpanInput[]; measured_bytes?: number; max_packet_bytes?: number;
}
export type VerseResearchResponse = VerseResearchPacket | VerseResearchError;
