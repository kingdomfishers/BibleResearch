// @file: src/api/septuagint-types.ts
// @feature: api
// @tables: lxx_swete_words | lxx_swete_books | hebrew_lxx_verse_map | macula_hebrew_morphemes | macula_gated_field_values | field_license_registry | entity_relationships
// @candidates: none
// @toc: types:hebrew-to-greek | types:greek-to-hebrew | types:parallel | types:cross-testament

// === @section:types:hebrew-to-greek ===
export interface GreekAlignmentRecord {
  greek_lemma_key: string;
  greek_display_label: string;
  greek_script: string;
  greek_transliteration: string | null;
  greek_strong: string;
  relation_type: string;
  derivation_method: string;
  evidence_summary: string;
  occurrence_count: number;
  sample_verses: string[];
}

export interface HebrewToGreekAlignmentsResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request' | 'gated_license_restricted';
  message?: string;
  query?: string;
  hebrew_lemma?: {
    entity_key: string;
    display_label: string;
    language: string;
    lemma_script: string;
    transliteration: string | null;
    base_strongs: string | null;
  };
  license_status?: string;
  total_alignments?: number;
  alignments?: GreekAlignmentRecord[];
  provenance?: {
    dataset: string;
    release: string;
    license: string;
    attribution: string;
  };
}

// === @section:types:greek-to-hebrew ===
export interface HebrewAlignmentRecord {
  hebrew_lemma_key: string;
  hebrew_display_label: string;
  hebrew_script: string;
  hebrew_transliteration: string | null;
  hebrew_strong: string | null;
  relation_type: string;
  derivation_method: string;
  evidence_summary: string;
  occurrence_count: number;
  sample_verses: string[];
}

export interface GreekToHebrewAlignmentsResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request' | 'gated_license_restricted';
  message?: string;
  query?: string;
  greek_lemma?: {
    entity_key: string;
    display_label: string;
    language: string;
    lemma_script: string;
    transliteration: string | null;
    base_strongs: string | null;
  };
  license_status?: string;
  total_alignments?: number;
  alignments?: HebrewAlignmentRecord[];
  provenance?: {
    dataset: string;
    release: string;
    license: string;
    attribution: string;
  };
}

// === @section:types:parallel ===
export interface MasoreticWordToken {
  id: number;
  ordinal: number;
  original_word: string;
  transliteration: string;
  strongs_nr: string;
  gloss: string | null;
}

export interface SeptuagintWordToken {
  id: number;
  ordinal: number;
  word_text: string;
  source_record_id: string;
}

export interface ParallelWordAlignment {
  word_no: number;
  morph_no: number;
  text_form: string | null;
  strong_x: string | null;
  lemma: string | null;
  gloss: string | null;
  greek_strong: string | null;
  greek_word: string | null;
  greek_display_label: string | null;
  relation_type: string;
}

export interface HebrewSeptuagintParallelResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  canonical_verse?: {
    id: number;
    book: number;
    chapter: number;
    verse_nr: number;
  };
  masoretic?: {
    book: number;
    chapter: number;
    verse_nr: number;
    word_count: number;
    words: MasoreticWordToken[];
  };
  septuagint?: {
    lxx_book_no: number | null;
    latin_name: string | null;
    chapter: number;
    verse_nr: number;
    verse_suffix: string;
    mapping_kind: string;
    rule_citation: string | null;
    word_count: number;
    words: SeptuagintWordToken[];
  };
  word_alignments?: ParallelWordAlignment[];
  license_info?: {
    lxx_source: string;
    macula_hebrew: string;
    macula_alignments_status: string;
    catss_policy: string;
  };
}

// === @section:types:cross-testament ===
export interface NtGreekOccurrence {
  word_id: number;
  book: number;
  chapter: number;
  verse_nr: number;
  ref: string;
  original_word: string;
  transliteration: string;
  gloss: string | null;
}

export interface LxxGreekOccurrence {
  word_id: number;
  book_no: number;
  book_name: string;
  chapter: number;
  verse_nr: number;
  ref_swete: string;
  word_text: string;
  source_record_id: string;
}

export interface HebrewRenderingSummary {
  hebrew_lemma_key: string;
  hebrew_display_label: string;
  hebrew_script: string;
  hebrew_strong: string | null;
  occurrence_count: number;
}

export interface CrossTestamentGreekResponse {
  schema_version: 1;
  status: 'ok' | 'not_found' | 'invalid_request';
  message?: string;
  query?: string;
  greek_lemma?: {
    entity_key: string;
    display_label: string;
    language: string;
    lemma_script: string;
    transliteration: string | null;
    base_strongs: string | null;
  };
  nt_occurrences?: {
    total_count: number;
    samples: NtGreekOccurrence[];
  };
  lxx_occurrences?: {
    total_count: number;
    samples: LxxGreekOccurrence[];
  };
  hebrew_source_renderings?: HebrewRenderingSummary[];
}
