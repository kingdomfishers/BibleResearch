// @file: src/api/hebrew-septuagint-comparison-types.ts
// @feature: api
// @tables: hebrew_lxx_word_alignments | hebrew_lxx_verse_map | lxx_swete_words | words | verses
// @candidates: none
// @toc: types:alignment | types:passages | types:comparison | types:lookup

// === @section:types:alignment ===
export interface HebrewLxxAlignment {
  id: number;
  alignment_key: string;
  canonical_verse_id: number | null;
  lxx_book_no: number | null;
  lxx_book_name: string;
  lxx_chapter: number | null;
  lxx_chapter_suffix: string;
  lxx_verse_nr: number | null;
  lxx_verse_suffix: string;
  hebrew_text: string;
  hebrew_token_ordinals: number[];
  hebrew_strongs: string[];
  lxx_text: string;
  lxx_token_ordinals: number[];
  lxx_strongs: string[];
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
  alignment_tier: 'documented_textual' | 'computationally_inferred_candidate' | 'scholarly_interpretation';
  verification_status: 'verified_source_attestation' | 'unverified_candidate' | 'scholarly_hypothesis';
  confidence_score: number | null;
  algorithm_or_source: string;
  translation_technique: string | null;
  evidence_summary: string;
}

// === @section:types:passages ===
export interface HebrewComparisonWord {
  word_id: number;
  ordinal: number;
  original_word: string;
  transliteration: string;
  gloss: string;
  strongs_nr: string;
  alignment_status: 'documented_aligned' | 'candidate_aligned' | 'unmatched';
  aligned_lxx_ordinals: number[];
}

export interface SeptuagintComparisonWord {
  lxx_word_id: number;
  ordinal: number;
  word_text: string;
  normalized_word: string;
  alignment_status: 'documented_aligned' | 'candidate_aligned' | 'unmatched';
  aligned_hebrew_ordinals: number[];
}

export interface HebrewComparisonPassage {
  canonical_verse_id: number;
  book: number;
  chapter: number;
  verse_nr: number;
  word_count: number;
  words: HebrewComparisonWord[];
}

export interface SeptuagintComparisonPassage {
  book_no: number;
  latin_name: string;
  chapter: number;
  chapter_suffix: string;
  verse_nr: number;
  verse_suffix: string;
  is_deuterocanonical: boolean;
  word_count: number;
  words: SeptuagintComparisonWord[];
}

// === @section:types:comparison ===
export interface HebrewSeptuagintVerseMapping {
  id: number;
  canonical_verse_id: number | null;
  hebrew_book: number;
  hebrew_chapter: number;
  hebrew_verse: number;
  hebrew_reference: string;
  mapping_kind: string;
  rule_citation: string;
  origin_mode: string;
  derivation_method: string;
}

export interface HebrewSeptuagintCompareArgs {
  [key: string]: unknown;
  p_hebrew_book?: number | null;
  p_hebrew_chapter?: number | null;
  p_hebrew_verse?: number | null;
  p_canonical_verse_id?: number | null;
  p_lxx_book_no?: number | null;
  p_lxx_chapter?: number | null;
  p_lxx_verse_nr?: number | null;
  p_lxx_chapter_suffix?: string;
  p_lxx_verse_suffix?: string;
}

export interface HebrewSeptuagintComparisonResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  query_mode?: 'hebrew' | 'septuagint';
  correspondence_status?: 'matched' | 'reordered' | 'unmatched_hebrew_minus_in_lxx' | 'unmatched_lxx_plus_in_greek';
  has_hebrew_passage?: boolean;
  has_septuagint_passage?: boolean;
  hebrew_passage?: HebrewComparisonPassage | null;
  septuagint_passage?: SeptuagintComparisonPassage | null;
  versification_mappings?: HebrewSeptuagintVerseMapping[];
  documented_alignments?: HebrewLxxAlignment[];
  candidate_alignments?: HebrewLxxAlignment[];
  scholarly_interpretations?: HebrewLxxAlignment[];
  epistemic_disclaimer?: string;
}

// === @section:types:lookup ===
export interface HebrewSeptuagintAlignmentsResponse {
  schema_version: 1;
  status: 'ok' | 'invalid_request';
  query: string;
  tier_filter: string | null;
  total_returned: number;
  epistemic_disclaimer: string;
  alignments: HebrewLxxAlignment[];
}
