// @file: src/api/formation-types.ts
// @feature: api
// @tables: lexical_formations | lemma_components | lexical_connections | lemmas | lexical_roots | lemma_root_links | lexical_senses | word_form_lemmas
// @candidates: none
// @toc: types:common | types:records | types:formation | types:orthographic | types:hydrated-v2

// === @section:types:common ===
export type FormationType = 'compound' | 'theophoric_name' | 'derivation' | 'other';
export type EvidenceStatus = 'documented' | 'proposed' | 'disputed' | 'rejected';
export type ComponentRole = 'verbal_element' | 'nominal_element' | 'divine_name_element' | 'prefix' | 'suffix' | 'other';
export type ConnectionRelationType = 'literary_wordplay' | 'orthographic_overlap' | 'phonetic_resemblance' | 'proposed_derivation';
export type ConnectionEvidenceStatus = 'documented_textual' | 'observed_form' | 'unverified_hypothesis' | 'disputed' | 'rejected';

export interface FormationSource {
  title: string | null;
  url: string | null;
  record_id: string | null;
}

export interface ComponentSense {
  sense_code: string;
  short_gloss: string;
  source_attribution: string | null;
}

export interface LemmaComponentRecord {
  order: number;
  surface_text: string;
  role: ComponentRole;
  semantic_contribution: string | null;
  component_note: string | null;
  lemma_id: number | null;
  lemma_key: string | null;
  base_strongs: string | null;
  original_lemma: string | null;
  transliteration: string | null;
  lexeme_id: number | null;
  primary_gloss: string | null;
  senses: ComponentSense[];
}

export interface LexicalFormationRecord {
  formation_id: number;
  lemma_id: number;
  analysis_key: string;
  formation_type: FormationType;
  whole_word_gloss: string | null;
  evidence_status: EvidenceStatus;
  evidence_note: string;
  origin_mode: string;
  review_status: string;
  source: FormationSource;
  components: LemmaComponentRecord[];
}

export interface MatchedLemmaRecord {
  language: string;
  lemma_id: number;
  lemma_key: string;
  primary_pos: string | null;
  base_strongs: string | null;
  lemma_script: string;
  homograph_tag: string | null;
  primary_gloss: string | null;
  lemma_stripped: string;
  transliteration: string | null;
  source_record_id: string | null;
  primary_lexeme_id: number | null;
}

// === @section:types:records ===
export interface DocumentedRootRecord {
  lemma_id: number;
  lemma_key: string;
  root_id: number;
  root_key: string;
  root_script: string;
  root_transliteration: string | null;
  root_kind: string | null;
  relation_type: string;
  implies_synonymy: boolean;
  evidence_note: string | null;
  origin_mode: string;
  derivation_method: string | null;
  source_record_id: string | null;
  source_release_key: string | null;
}

export interface RootRelativeRecord {
  root_key: string;
  relative_lemma_id: number;
  relative_lemma_key: string;
  base_strongs: string | null;
  lemma_script: string;
  transliteration: string | null;
  primary_gloss: string | null;
  relation_type: string;
  source_record_id: string | null;
}

export interface LexicalConnectionRecord {
  connection_id: number;
  source_lemma_id: number;
  target_lemma_id: number;
  source_lemma_key: string;
  target_lemma_key: string;
  source_strongs: string | null;
  target_strongs: string | null;
  relation_type: ConnectionRelationType;
  evidence_status: ConnectionEvidenceStatus;
  evidence_note: string;
  passage_reference: string | null;
  source_title: string | null;
  source_url: string | null;
  derivation_method: string;
}

export interface WordFormComponentCandidate {
  component_order: number;
  morpheme_role: string;
  surface: string;
  gloss: string | null;
  grammar_code: string | null;
  lemma_id: number;
  lexeme_id: number | null;
  observed_token_count: number | null;
  is_context_ambiguous: boolean;
  source_record_id: string | null;
}

export interface FormationCoverage {
  selected_lemma_count: number;
  complete: boolean;
  roots_attested_for_every_lemma: boolean;
  token_morphology_scope: string;
  missing_data_not_evidence_of_absence: boolean;
  root_is_not_a_meaning: boolean;
  shared_root_implies_synonymy: boolean;
  orthographic_similarity_proves_derivation: boolean;
}

// === @section:types:formation ===
export interface WordFormationResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'word_id_not_found' | 'invalid_request';
  message?: string;
  query?: string;
  requested_word_id?: number | null;
  identity_scope?: string;
  needs_disambiguation?: boolean;
  matched_lemmas?: MatchedLemmaRecord[];
  lexical_formations?: LexicalFormationRecord[];
  documented_roots?: DocumentedRootRecord[];
  root_relatives?: RootRelativeRecord[];
  other_connections?: LexicalConnectionRecord[];
  word_form_component_candidates?: WordFormComponentCandidate[];
  coverage?: FormationCoverage;
}

// === @section:types:orthographic ===
export type OverlapKind = 'candidate_inside_query' | 'query_inside_candidate';
export type OverlapPosition = 'start' | 'end' | 'query_at_start' | 'query_at_end' | 'internal';

export interface OrthographicCandidateRecord {
  candidate_id: number;
  candidate_lemma_key: string;
  candidate_strongs: string | null;
  candidate_script: string;
  candidate_transliteration: string | null;
  candidate_gloss: string | null;
  source_lemma_key: string;
  source_strongs: string | null;
  overlap_kind: OverlapKind;
  overlap_position: OverlapPosition;
  overlap_chars: number;
  heuristic_rank: number;
  evidence_status: 'unverified_candidate';
  relation_type: 'consonantal_substring';
  etymological_inference: false;
}

export interface OrthographicCandidatesResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  query?: string;
  method?: string;
  language_scope?: string;
  returned_count?: number;
  limit?: number;
  candidate_connections?: OrthographicCandidateRecord[];
  limitations?: string;
}

// === @section:types:hydrated-v2 ===
export interface TokenMorphemeRecord {
  order: number;
  role: string;
  surface: string;
  gloss: string | null;
  grammar_code: string | null;
  lemma_key: string;
  is_context_ambiguous: boolean;
}

export interface HydratedLemmaFormation {
  lemma_id: number;
  lemma_key: string;
  language: string;
  lemma_script: string;
  transliteration: string | null;
  base_strongs: string | null;
  primary_pos: string | null;
  homograph_tag: string | null;
  primary_gloss: string | null;
  formations: LexicalFormationRecord[];
  documented_roots: DocumentedRootRecord[];
  root_relatives: RootRelativeRecord[];
  literary_connections: LexicalConnectionRecord[];
}

export interface HydratedResearchWordV2 {
  word_position: number;
  word_id: number;
  original_word: string;
  transliteration: string;
  strongs_nr: string;
  lexical_entry_key: string;
  disambiguated_lemmas: string[];
  morphology: TokenMorphemeRecord[];
  grammar: Record<string, unknown>;
  translations: Record<string, unknown>;
  definitions: Record<string, unknown>;
  lexeme_candidates: Record<string, unknown>[];
}

export interface HydratedVerseV2 {
  verse_id: number;
  verse_ref: string;
  passage: { book: number; chapter: number; verse: number; is_heading: boolean };
  words: HydratedResearchWordV2[];
  coverage: Record<string, unknown>;
}

export interface VerseResearchV2Response {
  schema_version: 2;
  status: 'ok' | 'invalid_request' | 'passage_not_found' | 'packet_limit_exceeded';
  message?: string;
  verses?: HydratedVerseV2[];
  chronology?: Record<string, Record<string, unknown>>;
  geography?: Record<string, Record<string, unknown>>;
  semantic_evidence?: Record<string, Record<string, unknown>[]>;
  lexical_entries?: Record<string, Record<string, unknown>>;
  lexical_formations?: Record<string, HydratedLemmaFormation>;
  sources?: Record<string, unknown>[];
  coverage?: Record<string, unknown>;
}
