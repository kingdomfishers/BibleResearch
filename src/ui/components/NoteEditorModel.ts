// @file: src/ui/components/NoteEditorModel.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: imports | types | logic:state | logic:prefill | logic:validate | logic:save

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type {
  AnchorPayload,
  BlockPayload,
  ConnectionPayload,
  NoteSavePayload,
  NoteWriteResult,
  NoteDeleteResult,
  TargetCandidateAnchor,
} from '../../api/notes-api-types';
import type { NoteKind } from '../../api/notes-types';
import type { RelationshipNotePrefill } from '../../api/relationship-notes-adapter';
import type { ResearcherRelationshipStance } from '../../api/relationship-types';
import type { ActivePassage, Note, WordRecord } from '../../api/types';
import { formatVerseRef } from '../utils';

// === @section:types ===
export interface EditorAnchor extends TargetCandidateAnchor {
  client_key: string;
}

export interface EditorBlock {
  client_key: string;
  block_type: 'link' | 'image' | 'markdown' | string;
  content: Record<string, unknown>;
  text_alternative: string;
}

export interface EditorDraft {
  id?: string;
  expected_version?: number;
  client_request_id: string;
  title: string;
  body_md: string;
  note_kind: NoteKind;
  language: string;
  confidence?: number | null;
  source_context?: Record<string, unknown>;
  anchors: EditorAnchor[];
  connections: ConnectionPayload[];
  blocks: EditorBlock[];
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

// === @section:logic:state ===
export function generateClientKey(prefix = 'k'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyDraft(passage?: ActivePassage | null, verseId?: number | null): EditorDraft {
  const anchors: EditorAnchor[] = [];
  if (passage) {
    anchors.push({
      client_key: generateClientKey('anc'),
      kind: 'verse',
      verse_id: verseId ?? 0,
      label: formatVerseRef(passage),
    });
  }
  return {
    client_request_id: generateRequestId(),
    title: '',
    body_md: '',
    note_kind: 'observation',
    language: 'en',
    confidence: 1.0,
    anchors,
    connections: [],
    blocks: [],
  };
}

export function noteToDraft(note: Note): EditorDraft {
  const anchors: EditorAnchor[] = (note.anchors || []).map((a, idx) => ({
    client_key: (a as any).client_key || a.id || generateClientKey(`anc_${idx}`),
    kind: a.kind,
    label: a.label,
    verse_id: 'verse_id' in a ? a.verse_id : undefined,
    word_position: 'word_position' in a ? a.word_position : undefined,
    word_id: 'word_id' in a ? a.word_id : undefined,
    lemma_id: 'lemma_id' in a ? a.lemma_id : undefined,
  }));
  const connections: ConnectionPayload[] = (note.connections || []).map(c => ({
    from: c.from_anchor_id,
    to: c.to_anchor_id,
    connection_type: c.connection_type || null,
    direction: c.direction,
    explanation: null,
  }));
  const blocks: EditorBlock[] = (note.blocks || []).map((b, idx) => ({
    client_key: generateClientKey(`blk_${idx}`),
    block_type: b.block_type as 'link' | 'image',
    content: (b.content as Record<string, unknown>) || {},
    text_alternative: b.text_alternative || '',
  }));
  const hasCtx = note.source_context && Object.keys(note.source_context).length > 0;
  return {
    id: note.id, expected_version: note.version, client_request_id: generateRequestId(),
    title: note.title || '', body_md: note.body_md || '', note_kind: note.note_kind,
    language: note.language || 'en', confidence: note.confidence ?? null,
    ...(hasCtx ? { source_context: { ...(note.source_context as Record<string, unknown>) } } : {}),
    anchors, connections, blocks,
  };
}

// === @section:logic:prefill ===
export interface NewDraftContext {
  passage?: ActivePassage | null;
  verseId?: number | null;
  selectedWord?: WordRecord | null;
  selectedPosition?: number | null;
  prefill?: RelationshipNotePrefill | null;
}

export function buildNewDraftFromContext(ctx?: NewDraftContext): EditorDraft {
  if (ctx?.prefill) {
    return {
      client_request_id: generateRequestId(),
      title: ctx.prefill.title,
      body_md: ctx.prefill.body_md,
      note_kind: ctx.prefill.note_kind,
      language: 'en',
      confidence: 1.0,
      source_context: { ...ctx.prefill.source_context },
      anchors: ctx.prefill.anchors.map(a => ({ ...a })),
      connections: ctx.prefill.connections.map(c => ({ ...c })),
      blocks: [],
    };
  }
  const draft = createEmptyDraft(ctx?.passage, ctx?.verseId);
  if (ctx?.selectedWord) {
    const w = ctx.selectedWord;
    const lbl = `${w.original_word} (${w.transliteration})`;
    if (ctx.selectedPosition) {
      draft.anchors.push({
        client_key: generateClientKey('anc'), kind: 'word_occurrence',
        verse_id: ctx.verseId ?? 0, word_position: ctx.selectedPosition, word_id: w.id, label: lbl,
      });
    }
    draft.anchors.push({ client_key: generateClientKey('anc'), kind: 'word_form', word_id: w.id, label: lbl });
  }
  return draft;
}

export function setDraftRelationshipStance(draft: EditorDraft, stance: ResearcherRelationshipStance): void {
  const ref = draft.source_context?.relationship_ref as Record<string, unknown> | undefined;
  if (!ref) return;
  draft.source_context = {
    ...draft.source_context,
    relationship_ref: { ...ref, stance },
  };
  if (stance === 'alternative_interpretation') {
    draft.note_kind = 'interpretation';
  } else if (ref.domain === 'cross_reference') {
    draft.note_kind = 'cross_reference';
  } else if (ref.domain === 'lexical') {
    draft.note_kind = 'linguistic';
  }
}

// === @section:logic:validate ===
export function isValidHttps(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateDraft(draft: EditorDraft): ValidationResult {
  const errors: Record<string, string> = {};

  if (draft.title && draft.title.length > 200) {
    errors.title = 'Title must be 200 characters or less.';
  }
  if (!draft.body_md || !draft.body_md.trim()) {
    errors.body_md = 'Note body cannot be empty.';
  } else if (draft.body_md.length > 20000) {
    errors.body_md = 'Note body must be 20,000 characters or less.';
  }
  if (!draft.note_kind) {
    errors.note_kind = 'Please select a note kind.';
  }

  draft.blocks.forEach((b, idx) => {
    if (b.block_type === 'link' || b.block_type === 'image') {
      const url = String(b.content.url || '');
      if (!isValidHttps(url)) {
        errors[`block_${idx}_url`] = 'Block URL must be a valid https:// address.';
      }
      if (b.block_type === 'image') {
        const alt = String(b.content.alt_text || '').trim();
        if (!alt) errors[`block_${idx}_alt`] = 'Image alt text is required.';
      }
    } else if (b.block_type === 'markdown') {
      const md = String(b.content.markdown || '').trim();
      if (!md) errors[`block_${idx}_md`] = 'Markdown block content cannot be empty.';
    }
    if (!b.text_alternative || !b.text_alternative.trim()) {
      errors[`block_${idx}_text_alt`] = 'Text alternative is required for blocks.';
    }
  });

  return { valid: Object.keys(errors).length === 0, errors };
}

// === @section:logic:save ===
export function draftToPayload(draft: EditorDraft): NoteSavePayload {
  const anchors: AnchorPayload[] = draft.anchors.map(a => ({
    client_key: a.client_key,
    kind: a.kind as any,
    label: a.label ?? null,
    verse_id: a.verse_id ?? (undefined as any),
    end_verse_id: a.end_verse_id,
    word_position: a.word_position,
    word_id: a.word_id,
    lemma_id: a.lemma_id,
    concept_id: a.concept_id,
    place_id: a.place_id,
    event_id: a.event_id,
    target_note_id: a.target_note_id,
    external_uri: a.external_uri as any,
  }));

  const blocks: BlockPayload[] = draft.blocks.map(b => ({
    client_key: b.client_key,
    block_type: b.block_type,
    content: b.content,
    text_alternative: b.text_alternative,
  }));

  return {
    id: draft.id,
    expected_version: draft.expected_version,
    client_request_id: draft.client_request_id,
    title: draft.title.trim() || null,
    body_md: draft.body_md,
    note_kind: draft.note_kind,
    language: draft.language || 'en',
    confidence: draft.confidence ?? null,
    ...(draft.source_context ? { source_context: draft.source_context } : {}),
    anchors,
    connections: draft.connections,
    blocks,
  };
}

export async function saveNoteDraft(draft: EditorDraft): Promise<NoteWriteResult> {
  const payload = draftToPayload(draft);
  return BibleRPC.notes.save(payload);
}

export async function deleteNote(id: string, expectedVersion?: number): Promise<NoteDeleteResult> {
  return BibleRPC.notes.remove(id, expectedVersion);
}
