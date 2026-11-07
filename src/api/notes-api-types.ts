// @file: src/api/notes-api-types.ts
// @feature: notes
// @tables: notes | note_anchors | note_connections | note_blocks | note_authors
// @candidates: none
// @toc: types:passage-responses | types:word-responses | types:list-responses | types:search-responses | types:payloads | types:results

import type {
  AnchorKind,
  AnchorRole,
  ConnectionDirection,
  Note,
  NoteBlockType,
  NoteConnectionType,
  NoteKind,
  NoteKindRecord,
  NoteMatch,
  NoteVisibility,
} from './notes-types';

// === @section:types:passage-responses ===
export interface TokenNoteCount {
  verse_id: number;
  word_position: number;
  human: number;
  ai: number;
}

export interface PassageNotesTotals {
  primary: number;
  secondary: number;
  total: number;
  human: number;
  ai: number;
}

export interface PassageNotesResponse {
  status: 'ok';
  epistemic_layer: 'user_note';
  passage: {
    book: number;
    chapter: number;
    verse_start: number;
    verse_end: number;
    verse_ids: number[];
  };
  primary: Note[];
  secondary: NoteMatch[];
  totals: PassageNotesTotals;
  truncated: {
    primary: boolean;
    secondary: boolean;
  };
  token_note_counts: TokenNoteCount[];
}

// === @section:types:word-responses ===
export interface WordNotesLemma {
  lemma_id: number;
  lemma_key: string;
}

export interface WordNotesGroups {
  occurrence: NoteMatch[];
  form: NoteMatch[];
  lemma: NoteMatch[];
}

export interface WordNotesTotals {
  occurrence: number;
  form: number;
  lemma: number;
  total: number;
  human: number;
  ai: number;
}

export interface WordNotesResponse {
  status: 'ok';
  epistemic_layer: 'user_note';
  word_id: number;
  verse_id?: number | null;
  word_position?: number | null;
  lemmas: WordNotesLemma[];
  groups: WordNotesGroups;
  totals: WordNotesTotals;
}

// === @section:types:list-responses ===
export interface KeysetCursor {
  created_at: string;
  id: string;
}

export interface NoteListPage {
  limit: number;
  next_cursor: KeysetCursor | null;
  has_more: boolean;
}

export interface NoteListResponse {
  notes: Note[];
  page: NoteListPage;
  total: number;
}

export interface NoteSettingsCaps {
  single_user_mode: boolean;
  human_writes_enabled: boolean;
  ai_writes_enabled: boolean;
  default_visibility: NoteVisibility;
  max_title_chars: number;
  max_body_chars: number;
  max_anchors: number;
  max_connections: number;
  max_blocks: number;
  human_writes_per_hour: number;
  ai_writes_per_hour: number;
}

export interface ConnectionTypesResponse {
  connection_types: NoteConnectionType[];
  note_kinds: NoteKindRecord[];
  block_types: NoteBlockType[];
  settings: NoteSettingsCaps;
}

// === @section:types:search-responses ===
export interface TargetCandidateAnchor {
  client_key?: string;
  kind: AnchorKind;
  label?: string | null;
  verse_id?: number;
  end_verse_id?: number;
  word_position?: number;
  word_id?: number;
  lemma_id?: number;
  concept_id?: number;
  place_id?: number;
  event_id?: number;
  target_note_id?: string;
  external_uri?: string;
}

export interface TargetCandidate {
  kind: AnchorKind;
  id: number | string;
  label: string;
  sublabel?: string | null;
  language?: string | null;
  match_type: 'exact' | 'prefix' | 'normalized' | 'fuzzy';
  anchor: TargetCandidateAnchor;
}

export interface TargetCandidateGroup {
  kind: string;
  label: string;
  candidates: TargetCandidate[];
}

export interface TargetSearchResponse {
  status: 'ok';
  query: string;
  interpretation: {
    type: 'reference' | 'identifier' | 'hebrew' | 'greek' | 'text';
    parsed_ref?: Record<string, unknown>;
  };
  groups: TargetCandidateGroup[];
  truncated: boolean;
}

// === @section:types:payloads ===
export type AnchorPayload =
  | { client_key: string; kind: 'verse'; verse_id: number; role?: AnchorRole; label?: string | null }
  | { client_key: string; kind: 'verse_range'; verse_id: number; end_verse_id: number; role?: AnchorRole; label?: string | null }
  | { client_key: string; kind: 'word_occurrence'; verse_id: number; word_position: number; word_id: number; role?: AnchorRole; label?: string | null }
  | { client_key: string; kind: 'word_form'; word_id: number; role?: AnchorRole; label?: string | null }
  | { client_key: string; kind: 'lemma'; lemma_id: number; role?: AnchorRole; label?: string | null }
  | { client_key: string; kind: 'concept'; concept_id: number; role?: AnchorRole; label?: string | null }
  | { client_key: string; kind: 'place'; place_id: number; role?: AnchorRole; label?: string | null }
  | { client_key: string; kind: 'event'; event_id: number; role?: AnchorRole; label?: string | null }
  | { client_key: string; kind: 'note'; target_note_id: string; role?: AnchorRole; label?: string | null }
  | { client_key: string; kind: 'external'; external_uri: string; label: string; role?: AnchorRole };

export interface ConnectionPayload {
  from: string;
  to: string;
  connection_type?: string | null;
  custom_label?: string | null;
  direction?: ConnectionDirection;
  explanation?: string | null;
}

export interface BlockPayload {
  client_key?: string;
  block_type: string;
  content: Record<string, unknown>;
  text_alternative: string;
}

export interface NoteSavePayload {
  id?: string;
  expected_version?: number;
  client_request_id?: string;
  title?: string | null;
  body_md: string;
  note_kind: NoteKind;
  language?: string | null;
  confidence?: number | null;
  source_context?: Record<string, unknown>;
  anchors?: AnchorPayload[];
  connections?: ConnectionPayload[];
  blocks?: BlockPayload[];
}

// === @section:types:results ===
export type NoteErrorCode =
  | 'writes_disabled'
  | 'not_available_in_single_user_mode'
  | 'auth_required'
  | 'forbidden'
  | 'rate_limited'
  | 'not_found'
  | 'version_conflict'
  | 'payload_too_large'
  | 'validation_failed'
  | 'block_type_not_enabled'
  | 'anchor_invalid'
  | 'network_error'
  | 'timeout';

export interface NoteWriteError {
  code: NoteErrorCode;
  message: string;
  field?: string;
  current_version?: number;
}

export type NoteWriteResult =
  | { ok: true; created?: boolean; duplicate?: boolean; note: Note }
  | { ok: false; error: NoteWriteError };
