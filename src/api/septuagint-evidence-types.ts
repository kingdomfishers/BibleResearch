// @file: src/api/septuagint-evidence-types.ts
// @feature: api
// @tables: lxx_swete_words | lxx_swete_books | hebrew_lxx_verse_map | source_releases | source_editions
// @candidates: none
// @toc: types:tokens | types:metadata | types:response

// === @section:types:tokens ===
export interface SeptuagintToken {
  book_no: number;
  chapter: number;
  chapter_suffix: string;
  verse_nr: number;
  verse_suffix: string;
  ordinal: number;
  word_text: string;
  normalized_word: string | null;
  source_record_id: string;
  source_release_key: string | null;
  source_edition_key: string | null;
}

// === @section:types:metadata ===
export interface SeptuagintBookMetadata {
  book_no: number;
  latin_name: string;
  canonical_book_id: number | null;
  canonical_book_name: string | null;
  is_deuterocanonical_or_apocrypha: boolean;
}

export interface SeptuagintVersificationMapping {
  mapping_kind: string;
  rule_citation: string;
  origin_mode: string;
  derivation_method: string;
}

export interface SeptuagintPassageSummary {
  total_tokens: number;
  has_hebrew_counterpart: boolean;
  hebrew_canonical_verse_id: number | null;
  hebrew_reference: {
    book: number;
    chapter: number;
    verse_nr: number;
  } | null;
  versification_mapping: SeptuagintVersificationMapping | null;
  linguistic_annotation_status: string;
  epistemic_disclaimer: string;
}

// === @section:types:response ===
export interface SeptuagintPassageResponse {
  found: boolean;
  reason?: string;
  message?: string;
  book?: SeptuagintBookMetadata;
  reference?: {
    chapter: number;
    chapter_suffix: string;
    verse_nr: number | null;
    verse_suffix: string;
  };
  summary?: SeptuagintPassageSummary;
  tokens?: SeptuagintToken[];
}
