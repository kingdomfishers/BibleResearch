// @file: src/api/lexical-semantics-types.ts
// @feature: api
// @tables: lemmas | lexemes | lexical_senses | lexical_roots
// @candidates: none
// @toc: types:query | types:lemma | types:senses | types:response

// === @section:types:query ===
export interface LexicalSemanticsQueryAnalysis {
  raw_query: string;
  detected_script:
    | 'hebrew'
    | 'hebrew_or_aramaic'
    | 'greek'
    | 'strongs_hebrew'
    | 'strongs_greek'
    | 'transliteration_or_latin';
  has_vowels_or_accents: boolean;
  cantillation_stripped: string | null;
  accent_harmonized: string | null;
  consonants_or_base_letters: string | null;
}

export interface LexicalSemanticsInvariants {
  surface_form_is_not_lemma: string;
  lemma_is_not_root: string;
  shared_root_implies_synonymy: boolean;
  strongs_identifies_contextual_sense: boolean;
  sense_is_not_translation_gloss: string;
}

// === @section:types:lemma ===
export interface LexicalSemanticsRegisteredId {
  namespace: string;
  value: string;
  is_primary: boolean;
}

export interface LexicalSemanticsLexeme {
  lexeme_id: number;
  lexeme_key: string;
  extended_strongs: string;
  disambiguated_strongs: string | null;
  unified_strongs: string | null;
  primary_gloss: string;
  homograph_note: string | null;
  source_record_id: string;
  registered_identifiers: LexicalSemanticsRegisteredId[];
}

export interface LexicalSemanticsRoot {
  root_key: string;
  language: 'hbo' | 'arc' | 'grc';
  root_script: string;
  transliteration: string | null;
  root_kind: string;
  etymology_type: string;
  implies_synonymy: boolean;
  evidence_note: string | null;
  origin_mode: string;
  derivation_method: string;
  source_record_id: string;
}

export interface LexicalSemanticsLemma {
  lemma_id: number;
  lemma_key: string;
  language: 'hbo' | 'arc' | 'grc';
  lemma_script: string;
  lemma_stripped: string;
  transliteration: string;
  primary_pos: string | null;
  homograph_tag: string | null;
  base_strongs: string | null;
  source_edition_key: string | null;
  source_record_id: string;
  lexemes: LexicalSemanticsLexeme[];
  documented_roots: LexicalSemanticsRoot[];
  documented_senses: LexicalSemanticsSense[];
  attested_translation_glosses: LexicalSemanticsAttestedGloss[];
  surface_forms_summary: LexicalSemanticsSurfaceFormsSummary;
}

// === @section:types:senses ===
export interface LexicalSemanticsSense {
  sense_key: string;
  sense_code: string;
  sense_order: number;
  short_gloss: string;
  definition_text: string;
  usage_note: string | null;
  scripture_refs: string[];
  source_attribution: string;
  source_edition_key: string;
  source_record_id: string;
}

export interface LexicalSemanticsSamplePassage {
  verse_id: number;
  source_ref: string;
  book: number;
  book_name: string;
  chapter: number;
  verse: number;
}

export interface LexicalSemanticsAttestedGloss {
  attested_gloss: string;
  token_count: number;
  verse_count: number;
  sample_passage: LexicalSemanticsSamplePassage;
  source_attribution: string;
  caveat: string;
}

export interface LexicalSemanticsSampleSurfaceForm {
  word_id: number;
  surface_form: string;
  transliteration: string;
  grammar_code: string;
  observed_count: number;
}

export interface LexicalSemanticsSurfaceFormsSummary {
  distinct_forms_count: number;
  sample_surface_forms: LexicalSemanticsSampleSurfaceForm[];
}

// === @section:types:response ===
export interface LexicalSemanticsResponse {
  schema_version: number;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  query_analysis?: LexicalSemanticsQueryAnalysis;
  epistemic_invariants?: LexicalSemanticsInvariants;
  total_matching_lemmas?: number;
  lemmas?: LexicalSemanticsLemma[];
}
