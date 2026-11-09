// @file: src/api/relationship-notes-adapter.ts
// @feature: notes
// @tables: notes | note_anchors | note_connections
// @candidates: logic:xref-prefill | logic:lexical-prefill | logic:match-notes
// @toc: imports | types | logic:helpers | logic:note-link | logic:xref-prefill | logic:lexical-prefill | logic:match-notes

// === @section:imports ===
import type { ConnectionPayload, TargetCandidateAnchor } from './notes-api-types';
import type { ConnectionDirection, Note, NoteKind } from './notes-types';
import type {
  CanonicalPassageEndpoint,
  CrossReferenceEdge,
  LexicalEndpointRef,
  LexicalRelationshipCategory,
  LexicalRelationshipEdge,
  RelationshipEpistemicTier,
  ResearcherRelationshipStance,
} from './relationship-types';
import { formatLexicalEndpointLabel } from './relationship-model';

// === @section:types ===
export interface RelationshipEvaluationRef {
  schema_version: 1;
  relationship_id: string;
  domain: 'cross_reference' | 'lexical';
  relation_type: string;
  epistemic_tier: RelationshipEpistemicTier;
  source_key: string;
  pinned_commit: string;
  locator: string;
  stance: ResearcherRelationshipStance;
  subject_label: string;
  target_label: string;
}

export interface LinkedNoteTarget {
  id: string;
  title?: string | null;
  connection_type?: string;
}

export interface RelationshipNotePrefillOptions {
  stance?: ResearcherRelationshipStance;
  bookNamesById?: ReadonlyMap<number, string>;
  connectToNote?: LinkedNoteTarget | null;
  initialBodyMd?: string;
}

export interface RelationshipNotePrefill {
  title: string;
  body_md: string;
  note_kind: NoteKind;
  anchors: Array<TargetCandidateAnchor & { client_key: string }>;
  connections: ConnectionPayload[];
  source_context: Record<string, unknown>;
}

// === @section:logic:helpers ===
let seqCounter = 0;
function nextPrefillKey(prefix: string): string {
  seqCounter = (seqCounter + 1) % 100000;
  return `${prefix}_rel_${seqCounter}`;
}

export function formatEndpointRef(
  ep: CanonicalPassageEndpoint,
  bookNamesById?: ReadonlyMap<number, string>
): string {
  const bookName = bookNamesById?.get(ep.book) ?? `Book ${ep.book}`;
  if (ep.versification_status === 'edition_only_non_canonical' && ep.edition_only_ref) {
    const r = ep.edition_only_ref;
    return `${bookName} ${r.chapter}:${r.verse} (${r.edition} edition-only)`;
  }
  const range = ep.verse_start === ep.verse_end
    ? `${ep.chapter}:${ep.verse_start}`
    : `${ep.chapter}:${ep.verse_start}-${ep.verse_end}`;
  return ep.is_psalm_heading ? `${bookName} ${range} (Heading)` : `${bookName} ${range}`;
}

function passageEndpointToAnchor(
  ep: CanonicalPassageEndpoint,
  label: string
): (TargetCandidateAnchor & { client_key: string }) | null {
  if (ep.start_verse_id == null || ep.start_verse_id <= 0) return null;
  if (ep.end_verse_id != null && ep.end_verse_id > ep.start_verse_id) {
    return {
      client_key: nextPrefillKey('anc'),
      kind: 'verse_range',
      verse_id: ep.start_verse_id,
      end_verse_id: ep.end_verse_id,
      label,
    };
  }
  return { client_key: nextPrefillKey('anc'), kind: 'verse', verse_id: ep.start_verse_id, label };
}

function stanceHeading(stance: ResearcherRelationshipStance): string {
  if (stance === 'disagree') return 'Disagreement';
  if (stance === 'alternative_interpretation') return 'Alternative Interpretation';
  return 'Evaluation';
}

// === @section:logic:note-link ===
function appendConnectedNote(
  anchors: Array<TargetCandidateAnchor & { client_key: string }>,
  connections: ConnectionPayload[],
  connectToNote?: LinkedNoteTarget | null
): void {
  if (!connectToNote?.id) return;
  const noteAnc = {
    client_key: nextPrefillKey('anc_note'),
    kind: 'note' as const,
    target_note_id: connectToNote.id,
    label: connectToNote.title
      ? `Note: ${connectToNote.title}`
      : `Note ${connectToNote.id.slice(0, 8)}`,
  };
  anchors.push(noteAnc);
  if (anchors[0] && anchors[0].client_key !== noteAnc.client_key) {
    connections.push({
      from: anchors[0].client_key,
      to: noteAnc.client_key,
      connection_type: connectToNote.connection_type ?? 'related',
      direction: 'directed',
      explanation: 'Connected research note',
    });
  }
}

function lexicalEndpointToAnchor(
  ep: LexicalEndpointRef
): (TargetCandidateAnchor & { client_key: string }) | null {
  const label = formatLexicalEndpointLabel(ep);
  if (ep.lemma_id != null && ep.lemma_id > 0) {
    return { client_key: nextPrefillKey('anc_lem'), kind: 'lemma', lemma_id: ep.lemma_id, label };
  }
  if (ep.word_id != null && ep.word_id > 0) {
    return { client_key: nextPrefillKey('anc_wf'), kind: 'word_form', word_id: ep.word_id, label };
  }
  return null;
}

function mapLexicalCategoryToNoteConnection(
  cat: LexicalRelationshipCategory,
  stance: ResearcherRelationshipStance
): { type: string; direction: ConnectionDirection } {
  if (stance === 'disagree') return { type: 'contrasts_with', direction: 'bidirectional' };
  if (cat === 'same_documented_root' || cat === 'derivation' || cat === 'cognate') {
    return { type: 'same_root', direction: cat === 'derivation' ? 'directed' : 'bidirectional' };
  }
  if (cat === 'loan_transliteration') return { type: 'related', direction: 'directed' };
  if (cat === 'literary_wordplay') return { type: 'wordplay', direction: 'bidirectional' };
  if (cat === 'orthographic_overlap') return { type: 'contained_in', direction: 'directed' };
  if (cat === 'antonymy') return { type: 'contrasts_with', direction: 'bidirectional' };
  return { type: 'related', direction: 'bidirectional' };
}

// === @section:logic:xref-prefill ===
export function buildNotePrefillFromCrossReference(
  edge: CrossReferenceEdge,
  opts: RelationshipNotePrefillOptions = {}
): RelationshipNotePrefill {
  const stance: ResearcherRelationshipStance = opts.stance ?? 'agree';
  const srcLabel = formatEndpointRef(edge.source_passage, opts.bookNamesById);
  const tgtLabel = edge.target_label || edge.target_spans.map(s => formatEndpointRef(s, opts.bookNamesById)).join('; ');
  const anchors: Array<TargetCandidateAnchor & { client_key: string }> = [];
  const connections: ConnectionPayload[] = [];

  const srcAnchor = passageEndpointToAnchor(edge.source_passage, srcLabel);
  if (srcAnchor) anchors.push(srcAnchor);
  const targetAnchors: Array<TargetCandidateAnchor & { client_key: string }> = [];
  for (const span of edge.target_spans) {
    const anc = passageEndpointToAnchor(span, formatEndpointRef(span, opts.bookNamesById));
    if (anc) { anchors.push(anc); targetAnchors.push(anc); }
  }
  if (srcAnchor && targetAnchors[0]) {
    connections.push({
      from: srcAnchor.client_key,
      to: targetAnchors[0].client_key,
      connection_type: stance === 'disagree' ? 'contrasts_with' : 'related',
      direction: 'directed',
      explanation: `Evaluated ${edge.provenance.source_title} association (${stance})`,
    });
  }
  appendConnectedNote(anchors, connections, opts.connectToNote);
  const phrase = edge.anchor.phrase_bsb || edge.anchor.phrase_kjv;
  const evalRef: RelationshipEvaluationRef = {
    schema_version: 1, relationship_id: edge.relationship_id, domain: 'cross_reference',
    relation_type: edge.relation_type, epistemic_tier: edge.epistemic_tier,
    source_key: edge.provenance.source_key, pinned_commit: edge.provenance.pinned_commit,
    locator: edge.provenance.locator, stance, subject_label: srcLabel, target_label: tgtLabel,
  };
  const defaultBody = [
    `**Stance:** ${stance.replace(/_/g, ' ')}`,
    `**Source Association:** ${srcLabel}${phrase ? ` ("${phrase}")` : ''} → ${tgtLabel}`,
    `**Source Provenance:** ${edge.provenance.source_title} (${edge.provenance.license})`,
    '', opts.initialBodyMd ?? '',
  ].join('\n').trim();
  return {
    title: `${stanceHeading(stance)}: ${srcLabel} → ${tgtLabel}`.slice(0, 200),
    body_md: defaultBody,
    note_kind: stance === 'alternative_interpretation' ? 'interpretation' : 'cross_reference',
    anchors, connections, source_context: { relationship_ref: evalRef },
  };
}

// === @section:logic:lexical-prefill ===
export function buildNotePrefillFromLexicalEdge(
  edge: LexicalRelationshipEdge,
  opts: RelationshipNotePrefillOptions = {}
): RelationshipNotePrefill {
  const stance: ResearcherRelationshipStance = opts.stance ?? 'agree';
  const subjLabel = formatLexicalEndpointLabel(edge.subject);
  const tgtLabel = formatLexicalEndpointLabel(edge.target);
  const anchors: Array<TargetCandidateAnchor & { client_key: string }> = [];
  const connections: ConnectionPayload[] = [];

  const subjAnc = lexicalEndpointToAnchor(edge.subject);
  const tgtAnc = lexicalEndpointToAnchor(edge.target);
  if (subjAnc) anchors.push(subjAnc);
  if (tgtAnc) anchors.push(tgtAnc);
  for (const ev of edge.evidence_verses.slice(0, 2)) {
    const vAnc = passageEndpointToAnchor(ev, formatEndpointRef(ev, opts.bookNamesById));
    if (vAnc) anchors.push(vAnc);
  }
  if (subjAnc && tgtAnc) {
    const mapped = mapLexicalCategoryToNoteConnection(edge.category, stance);
    connections.push({
      from: subjAnc.client_key, to: tgtAnc.client_key,
      connection_type: mapped.type, direction: mapped.direction,
      explanation: `${edge.category} (${stance})`,
    });
  }
  appendConnectedNote(anchors, connections, opts.connectToNote);
  const evalRef: RelationshipEvaluationRef = {
    schema_version: 1, relationship_id: edge.relationship_id, domain: 'lexical',
    relation_type: edge.category, epistemic_tier: edge.epistemic_tier,
    source_key: edge.provenance.source_key, pinned_commit: edge.provenance.pinned_commit,
    locator: edge.provenance.locator, stance, subject_label: subjLabel, target_label: tgtLabel,
  };
  const defaultBody = [
    `**Stance:** ${stance.replace(/_/g, ' ')}`,
    `**Lexical Relationship (${edge.category.replace(/_/g, ' ')}):** ${subjLabel} ↔ ${tgtLabel}`,
    `**Epistemic Tier:** ${edge.epistemic_tier.replace(/_/g, ' ')} · **Source:** ${edge.provenance.source_title}`,
    `**Evidence:** ${edge.explanation}`,
    '', opts.initialBodyMd ?? '',
  ].join('\n').trim();
  return {
    title: `${stanceHeading(stance)}: ${edge.subject.lemma_text} ↔ ${edge.target.lemma_text}`.slice(0, 200),
    body_md: defaultBody,
    note_kind: stance === 'alternative_interpretation' ? 'interpretation' : 'linguistic',
    anchors, connections, source_context: { relationship_ref: evalRef },
  };
}

// === @section:logic:match-notes ===
export function extractRelationshipEvaluation(note: Note): RelationshipEvaluationRef | null {
  const ctx = note.source_context;
  if (!ctx || typeof ctx !== 'object') return null;
  const raw = (ctx as Record<string, unknown>).relationship_ref;
  if (!raw || typeof raw !== 'object') return null;
  const ref = raw as Partial<RelationshipEvaluationRef>;
  if (typeof ref.relationship_id !== 'string' || !ref.relationship_id.startsWith('rel:v1:')) {
    return null;
  }
  return ref as RelationshipEvaluationRef;
}

export function indexNotesByRelationshipId(notes: Note[]): Map<string, Note[]> {
  const map = new Map<string, Note[]>();
  for (const note of notes) {
    const evalRef = extractRelationshipEvaluation(note);
    if (!evalRef) continue;
    const list = map.get(evalRef.relationship_id) ?? [];
    list.push(note);
    map.set(evalRef.relationship_id, list);
  }
  return map;
}
