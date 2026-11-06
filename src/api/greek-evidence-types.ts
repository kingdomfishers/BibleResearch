// @file: src/api/greek-evidence-types.ts
// @feature: api
// @tables: tagnt_tokens | macula_greek_tokens | verses | words
// @candidates: none
// @toc: types:tagnt | types:macula | types:evidence-response

// === @section:types:tagnt ===
export interface GreekVerseToken {
  word_id: number;
  position: number;
  original_word: string;
  transliteration: string;
  strongs_nr: string;
  grammar_code: string | null;
  gematria: number | null;
}

export interface TagntTokenRecord {
  id: number;
  tagnt_id: string;
  word_type: string;
  surface_greek: string;
  transliteration: string;
  english_translation: string | null;
  dstrongs: string;
  grammar_code: string;
  lemma: string;
  step_gloss: string | null;
  editions: string;
  meaning_variants: string | null;
  spelling_variants: string | null;
  sub_meaning: string | null;
  conjoin_word: string | null;
  sstrong_instance: string | null;
  alt_strongs: string | null;
  word_position: number;
  step_word_id: number | null;
  link_status: string;
}

// === @section:types:macula ===
export interface MaculaGreekTokenRecord {
  id: number;
  xml_id: string;
  ref_nt: string;
  word_no: number;
  role: string | null;
  part_of_speech: string | null;
  word_type: string | null;
  text_form: string;
  after_text: string | null;
  lemma: string;
  normalized: string | null;
  strongs: string | null;
  morph_code: string;
  person: string | null;
  number: string | null;
  gender: string | null;
  case_value: string | null;
  tense: string | null;
  voice: string | null;
  mood: string | null;
  degree: string | null;
  gloss: string | null;
  english: string | null;
  mandarin: string | null;
  frame: string | null;
  subjref: string | null;
  referent: string | null;
  step_word_id: number | null;
  link_status: string;
}

export interface GreekEditionDifferenceRecord {
  word_no: number;
  nestle_text: string;
  sblgnt_text: string;
  nestle_morph: string;
  sblgnt_morph: string;
  nestle_lemma: string;
  sblgnt_lemma: string;
}

// === @section:types:evidence-response ===
export interface GreekVerseEvidenceSummary {
  total_step_tokens: number;
  total_tagnt_tokens: number;
  total_nestle_tokens: number;
  total_sblgnt_tokens: number;
  traditional_only_count: number;
  critical_only_count: number;
  meaning_variants_count: number;
  spelling_variants_count: number;
  edition_differences_count: number;
  has_textual_variants: boolean;
}

export interface GreekVerseEvidenceResponse {
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
  step_tokens?: GreekVerseToken[];
  tagnt_tokens?: TagntTokenRecord[];
  macula_nestle1904_tokens?: MaculaGreekTokenRecord[];
  macula_sblgnt_tokens?: MaculaGreekTokenRecord[];
  edition_differences?: GreekEditionDifferenceRecord[];
  summary?: GreekVerseEvidenceSummary;
}
