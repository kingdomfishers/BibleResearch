// @file: src/api/notes-types.ts
// @feature: notes
// @tables: notes | note_anchors | note_connections | note_blocks | note_authors
// @candidates: none
// @toc: types:authors-kinds | types:anchors-base | types:anchors-entities | types:connections | types:blocks | types:notes | types:re-export

// === @section:types:authors-kinds ===
export type AuthorKind = 'human' | 'ai';

export interface NoteAuthor {
  id: string;
  kind: AuthorKind;
  display_name: string;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_client?: string | null;
}

export type NoteKind =
  | 'observation'
  | 'linguistic'
  | 'interpretation'
  | 'question'
  | 'cross_reference'
  | 'research_lead'
  | 'citation';

export interface NoteKindRecord {
  note_kind: NoteKind;
  label: string;
  description: string;
}

export type NoteStatus = 'draft' | 'published' | 'archived' | 'removed';
export type NoteVisibility = 'private' | 'unlisted' | 'public';
export type NoteReviewStatus = 'unreviewed' | 'confirmed' | 'disputed';
export type NoteCreatedVia = 'ui' | 'mcp' | 'import';

// === @section:types:anchors-base ===
export type AnchorKind =
  | 'verse'
  | 'verse_range'
  | 'word_occurrence'
  | 'word_form'
  | 'lemma'
  | 'concept'
  | 'place'
  | 'event'
  | 'note'
  | 'external';

export type AnchorRole = 'subject' | 'object' | 'mention' | 'evidence';

interface BaseAnchor {
  id: string;
  role: AnchorRole;
  label: string | null;
  ordinal: number;
  block_id?: string | null;
  element_ref?: string | null;
}

export interface VerseAnchor extends BaseAnchor {
  kind: 'verse';
  verse_id: number;
}

export interface VerseRangeAnchor extends BaseAnchor {
  kind: 'verse_range';
  verse_id: number;
  end_verse_id: number;
}

export interface WordOccurrenceAnchor extends BaseAnchor {
  kind: 'word_occurrence';
  verse_id: number;
  word_position: number;
  word_id: number;
}

export interface WordFormAnchor extends BaseAnchor {
  kind: 'word_form';
  word_id: number;
}

export interface LemmaAnchor extends BaseAnchor {
  kind: 'lemma';
  lemma_id: number;
}

// === @section:types:anchors-entities ===
export interface ConceptAnchor extends BaseAnchor {
  kind: 'concept';
  concept_id: number;
}

export interface PlaceAnchor extends BaseAnchor {
  kind: 'place';
  place_id: number;
}

export interface EventAnchor extends BaseAnchor {
  kind: 'event';
  event_id: number;
}

export interface TargetNoteAnchor extends BaseAnchor {
  kind: 'note';
  target_note_id: string;
}

export interface ExternalAnchor extends BaseAnchor {
  kind: 'external';
  external_uri: string;
  label: string;
}

export type NoteAnchor =
  | VerseAnchor
  | VerseRangeAnchor
  | WordOccurrenceAnchor
  | WordFormAnchor
  | LemmaAnchor
  | ConceptAnchor
  | PlaceAnchor
  | EventAnchor
  | TargetNoteAnchor
  | ExternalAnchor;

// === @section:types:connections ===
export type ConnectionDirection = 'directed' | 'bidirectional' | 'undirected';

export interface NoteConnection {
  id: string;
  from_anchor_id: string;
  to_anchor_id: string;
  connection_type?: string | null;
  type_label?: string | null;
  inverse_label?: string | null;
  category?: string | null;
  custom_label?: string | null;
  direction: ConnectionDirection;
  explanation?: string | null;
}

export interface NoteConnectionType {
  type_key: string;
  label: string;
  inverse_label: string;
  category: string;
  default_direction: ConnectionDirection;
  is_symmetric: boolean;
  description: string;
  is_system: boolean;
}

// === @section:types:blocks ===
export interface MarkdownBlockContent {
  markdown: string;
}

export interface LinkBlockContent {
  url: string;
  title: string;
}

export interface ImageBlockContent {
  url: string;
  alt: string;
}

interface BaseBlock {
  id: string;
  ordinal: number;
  schema_version?: number;
  text_alternative: string;
}

export interface MarkdownNoteBlock extends BaseBlock {
  block_type: 'markdown';
  content: MarkdownBlockContent;
}

export interface LinkNoteBlock extends BaseBlock {
  block_type: 'link';
  content: LinkBlockContent;
}

export interface ImageNoteBlock extends BaseBlock {
  block_type: 'image';
  content: ImageBlockContent;
}

export interface GenericNoteBlock extends BaseBlock {
  block_type: string;
  content: Record<string, unknown>;
}

export type NoteBlock = MarkdownNoteBlock | LinkNoteBlock | ImageNoteBlock | GenericNoteBlock;

export interface NoteBlockType {
  block_type: string;
  label: string;
  renderer_status: 'available' | 'planned';
  is_enabled: boolean;
  required_keys: string[];
  url_keys: string[];
  max_bytes: number;
  description: string;
}

// === @section:types:notes ===
export interface Note {
  id: string;
  title: string | null;
  body_md: string;
  note_kind: NoteKind;
  language: string | null;
  epistemic_layer: 'user_note';
  author: NoteAuthor;
  created_via: NoteCreatedVia;
  review_status: NoteReviewStatus;
  reviewed_at?: string | null;
  confidence: number | null;
  status: NoteStatus;
  visibility: NoteVisibility;
  version: number;
  created_at: string;
  updated_at: string;
  source_context?: Record<string, unknown>;
  supersedes_note_id?: string | null;
  anchors: NoteAnchor[];
  connections: NoteConnection[];
  blocks: NoteBlock[];
}

export interface TokenPositionMatch {
  verse_id: number;
  word_position: number;
  word_id?: number;
}

export interface NoteMatch extends Note {
  reasons?: string[];
  positions?: TokenPositionMatch[];
  scopes?: string[];
}

export interface NoteRevisionSummary {
  version: number;
  action: 'create' | 'update' | 'delete' | 'review';
  editor_kind: AuthorKind;
  created_at: string;
}

export interface NoteBacklink {
  id: string;
  title: string | null;
  note_kind: NoteKind;
  author: NoteAuthor;
  created_at: string;
}

export interface NoteDetailResponse extends Note {
  backlinks: NoteBacklink[];
  revisions: NoteRevisionSummary[];
}

// === @section:types:re-export ===
export type * from './notes-api-types';
