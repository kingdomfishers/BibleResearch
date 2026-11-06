// @file: src/api/hebrew-evidence-types.ts
// @feature: api
// @tables: morphhb_tokens | macula_hebrew_morphemes | syntax_nodes | syntax_edges | cross_token_mappings | verses | words
// @candidates: none
// @toc: types:tokens | types:evidence-response

// === @section:types:tokens ===
export interface HebrewVerseToken {
  word_id: number;
  position: number;
  original_word: string;
  transliteration: string;
  strongs_nr: string;
  grammar_code: string | null;
  gematria: number | null;
}

export interface MorphhbTokenRecord {
  id: number;
  morphhb_id: string;
  word_num: number;
  word_text: string;
  lemma: string;
  morph_code: string;
  cantillation: string | null;
  is_ketiv: boolean;
  is_qere: boolean;
  qere_target_id: string | null;
  is_aramaic: boolean;
  step_word_id: number | null;
  link_status: string;
  source_record_id: string;
}

export interface MaculaHebrewMorphemeRecord {
  id: number;
  macula_id: string;
  ref_mt: string;
  word_no: number;
  morph_no: number;
  class: string | null;
  text_form: string;
  after_text: string | null;
  lemma: string;
  strong_x: string | null;
  morph_code: string;
  lang: string;
  stem: string | null;
  morph_type: string | null;
  gloss: string | null;
  english: string | null;
  sense_number: string | null;
  subjref: string | null;
  participantref: string | null;
  word_id: number | null;
  link_status: string;
}

// === @section:types:evidence-response ===
export interface HebrewSyntaxNodeRecord {
  id: number;
  node_key: string;
  node_type: string;
  start_word_position: number;
  end_word_position: number;
  head_word_position: number | null;
  syntactic_role: string | null;
  grammar_summary: string | null;
}

export interface HebrewSyntaxEdgeRecord {
  id: number;
  source_node_id: number | null;
  target_node_id: number | null;
  relation_type: string;
  raw_relation_tag: string | null;
  dependent_word_position: number | null;
  head_word_position: number | null;
}

export interface CrossTokenMappingRecord {
  id: number;
  step_word_id: number | null;
  morphhb_token_id: number | null;
  macula_morpheme_id: number | null;
  mapping_status: string;
  notes: string | null;
  derivation_method: string;
}

export interface HebrewVerseEvidenceSummary {
  total_step_tokens: number;
  total_morphhb_tokens: number;
  total_macula_morphemes: number;
  ketiv_count: number;
  qere_count: number;
  is_aramaic: boolean;
  has_syntax_hierarchy: boolean;
  syntax_edges_count: number;
  cross_mappings_count: number;
}

export interface HebrewVerseEvidenceResponse {
  found: boolean;
  error?: string;
  verse?: {
    id: number;
    book: number;
    book_name: string;
    book_usfm: string;
    chapter: number;
    verse_nr: number;
    word_ids: number[];
  };
  step_tokens?: HebrewVerseToken[];
  morphhb_tokens?: MorphhbTokenRecord[];
  macula_morphemes?: MaculaHebrewMorphemeRecord[];
  syntax_nodes?: HebrewSyntaxNodeRecord[];
  syntax_edges?: HebrewSyntaxEdgeRecord[];
  cross_token_mappings?: CrossTokenMappingRecord[];
  summary?: HebrewVerseEvidenceSummary;
}
