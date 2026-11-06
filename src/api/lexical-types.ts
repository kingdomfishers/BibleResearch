// @file: src/api/lexical-types.ts
// @feature: api
// @tables: source_editions | edition_passages | versification_mappings | lemmas | lexeme_identifiers | word_form_lemmas | lexical_roots | lemma_root_links | lexical_senses | token_morphemes | syntax_nodes | syntax_edges | semantic_annotations | concept_properties | concept_external_links | relation_types | canonical_entities | entity_relationships
// @candidates: none
// @toc: types:common | types:word-senses | types:occurrences | types:roots | types:glosses | types:passage | types:concepts | types:relationships

// === @section:types:common ===
export type BiblicalLanguage = 'hbo' | 'arc' | 'grc';
export type OriginMode = 'directly_imported' | 'algorithmically_calculated';
export type EpistemicLayer =
  | 'primary_biblical'
  | 'lexical_reference'
  | 'external_factual'
  | 'reviewed_research'
  | 'reviewed_interpretation';

export interface CanonicalLemmaSummary {
  lemma_id?: number;
  lemma_key: string;
  language: BiblicalLanguage;
  lemma_script: string;
  transliteration: string | null;
  primary_pos: string | null;
  homograph_tag?: string | null;
  base_strongs: string | null;
  source_record_id?: string;
}

export interface LexicalSenseRecord {
  sense_key: string;
  sense_code: string;
  sense_order?: number;
  short_gloss: string;
  definition_text?: string;
  usage_note?: string | null;
  scripture_refs?: string[];
  source_attribution: string;
  source_edition_key: string;
  source_record_id: string;
}

// === @section:types:word-senses ===
export interface WordMorphemeLemmaLink {
  component_order: number;
  morpheme_role: string;
  morpheme_surface: string | null;
  dstrongs_tag: string;
  observed_token_count: number;
  is_context_ambiguous: boolean;
  origin_mode: OriginMode;
  derivation_method: string;
  source_record_id: string;
  lemma: CanonicalLemmaSummary;
  available_senses: LexicalSenseRecord[];
}

export interface WordFormSenseEntry {
  word_id: number;
  surface_form: string;
  transliteration: string;
  base_strongs: string | null;
  grammar_code: string | null;
  decoded_grammar: Record<string, unknown> | null;
  gematria: number | null;
  morpheme_lemma_links: WordMorphemeLemmaLink[];
}

export interface WordToLemmaSensesResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  modeling_invariants?: {
    word_form_is_not_lemma: true;
    sense_assignment_policy: 'catalog_only_no_ai_inference';
  };
  word_forms?: WordFormSenseEntry[];
}

// === @section:types:occurrences ===
export interface LemmaOccurrenceItem {
  verse_id: number;
  book: number;
  book_name: string;
  usfm: string;
  chapter: number;
  verse: number;
  word_position: number;
  word_id: number;
  inflected_form: string;
  inflected_transliteration: string;
  grammar_code: string | null;
  dstrongs_tag: string;
  attested_english_rendering: string;
  source_ref: string;
  is_surface_form_homograph_ambiguous: boolean;
}

export interface LemmaOccurrencesResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  lemma?: CanonicalLemmaSummary;
  homograph_or_query_candidates?: CanonicalLemmaSummary[];
  totals?: {
    distinct_inflected_forms: number;
    total_tokens: number;
    total_verses: number;
    ambiguous_form_tokens: number;
  };
  pagination?: {
    after_verse_id: number;
    limit: number;
    returned_count: number;
    next_after_verse_id: number | null;
  };
  occurrences?: LemmaOccurrenceItem[];
}

// === @section:types:roots ===
export interface DocumentedLexicalRoot {
  root_key: string;
  language: BiblicalLanguage;
  root_script: string;
  transliteration: string | null;
  root_kind: 'documented_lexical_base' | 'greek_etymological_stem' | 'semitic_cross_dialect_base';
  lemma_to_root_relation: string;
  evidence_note: string | null;
  origin_mode: OriginMode;
  derivation_method: string;
  source_record_id: string;
}

export interface LemmaRootRelative {
  root_key: string;
  relative_lemma_key: string;
  language: BiblicalLanguage;
  lemma_script: string;
  transliteration: string | null;
  primary_pos: string | null;
  base_strongs: string | null;
  primary_lexeme_gloss: string | null;
  etymology_type: string;
  implies_synonymy: false;
  evidence_note: string | null;
  origin_mode: OriginMode;
  derivation_method: string;
  source_edition_key: string | null;
  source_record_id: string;
}

export interface LemmaRootRelativesResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  modeling_invariants?: {
    lemma_is_not_necessarily_root: true;
    root_is_not_a_meaning: true;
    shared_root_implies_synonymy: false;
  };
  lemma?: CanonicalLemmaSummary;
  documented_roots?: DocumentedLexicalRoot[];
  root_relatives?: LemmaRootRelative[];
}

// === @section:types:glosses ===
export interface AttestedEnglishGloss {
  attested_gloss: string;
  usage_group: string;
  token_count: number;
  verse_count: number;
  inflected_form_count: number;
  sample_passage: { book: number; book_name: string; chapter: number; verse: number; source_ref: string };
  source_dataset: string;
  source_commit: string;
}

export interface LemmaEnglishGlossesResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  modeling_invariants?: {
    lexical_sense_is_not_english_translation: true;
    translation_is_not_word_for_word_alignment: true;
  };
  lemma?: CanonicalLemmaSummary;
  lexicon_sense_glosses?: LexicalSenseRecord[];
  corpus_rendering_summary?: {
    total_attested_tokens: number;
    distinct_attested_english_strings: number;
    untranslated_grammatical_tokens: number;
  };
  attested_english_glosses?: AttestedEnglishGloss[];
}

// === @section:types:passage ===
export interface PassageTokenSyntaxItem {
  word_position: number;
  word_id: number;
  surface_form: string;
  transliteration: string;
  base_strongs: string | null;
  grammar_code: string | null;
  decoded_morphology: Record<string, unknown> | null;
  attested_english_gloss: string;
  source_name: string;
  source_ref: string;
  source_commit: string;
  morphemes: Array<{
    component_order: number;
    morpheme_role: string;
    surface_form: string | null;
    transliteration?: string | null;
    grammar_code: string | null;
    morpheme_gloss?: string | null;
    dstrongs_tag: string;
    lemma_key: string | null;
    lemma_script: string | null;
    is_context_ambiguous?: boolean;
    source_record_id: string;
  }>;
}

export interface PassageTokensSyntaxResponse {
  schema_version: 1;
  status: 'ok' | 'passage_not_found';
  passage: {
    verse_id?: number;
    book: number;
    book_name?: string;
    usfm?: string;
    chapter: number;
    verse: number;
    testament?: 'OT' | 'NT';
    primary_language?: string;
  };
  edition_passages?: Array<Record<string, unknown>>;
  versification_mappings?: Array<Record<string, unknown>>;
  english_editions?: Array<{ edition_id: string; text: string; alignment_note: string }>;
  tokens?: PassageTokenSyntaxItem[];
  syntax_nodes?: Array<Record<string, unknown>>;
  syntax_edges?: Array<Record<string, unknown>>;
  semantic_annotations?: Array<Record<string, unknown>>;
}

// === @section:types:concepts ===
export interface ConceptPropertyItem {
  property_key: string;
  property_value: string;
  value_type: string;
  unit: string | null;
  epistemic_layer: EpistemicLayer;
  external_citation: string | null;
  source_release_key: string;
  source_edition_key: string | null;
  source_record_id: string;
}

export interface ConceptExternalLinkItem {
  provider: string;
  external_id: string;
  external_url: string;
  link_relation: string;
  license: string;
  source_record_id: string;
}

export interface ConceptPropertiesItem {
  concept_key: string;
  title: string;
  concept_kind: string;
  external_entity_type: string | null;
  epistemic_layer: EpistemicLayer;
  summary: string;
  distinct_from_note: string | null;
  primary_strongs: string[];
  source_release_key: string | null;
  source_edition_key: string | null;
  source_record_id: string | null;
  aliases: string[];
  properties: ConceptPropertyItem[];
  external_links: ConceptExternalLinkItem[];
}

export interface ConceptPropertiesResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  modeling_invariants?: { external_observation_is_not_biblical_interpretation: true };
  concepts?: ConceptPropertiesItem[];
}

// === @section:types:relationships ===
export interface DocumentedEntityRelationship {
  id: number;
  relationship_key: string;
  direction: 'outgoing' | 'incoming';
  subject_key: string;
  subject_kind: string;
  subject_label: string;
  relation_type: string;
  relation_category: string;
  implies_synonymy: boolean;
  object_key: string;
  object_kind: string;
  object_label: string;
  epistemic_layer: EpistemicLayer;
  origin_mode: OriginMode;
  derivation_method: string;
  algorithm_version: string | null;
  score: number | null;
  supporting_span_ref: string | null;
  external_citation: string | null;
  evidence_summary: string;
  source_release_key: string;
  source_dataset: string;
  source_commit_sha: string;
  source_license: string;
  source_edition_key: string | null;
  source_record_id: string;
}

export interface EntityRelationshipsResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  entity?: {
    entity_key: string;
    entity_kind: string;
    display_label: string;
    language: string | null;
    source_record_id: string;
  };
  returned_count?: number;
  relationships?: DocumentedEntityRelationship[];
}
