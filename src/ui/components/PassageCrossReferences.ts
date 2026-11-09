// @file: src/ui/components/PassageCrossReferences.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: imports | types | ui:edge-row | ui:render | logic:load | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { RelationshipNotePrefill } from '../../api/relationship-notes-adapter';
import type {
  ActivePassage,
  CrossReferenceEdge,
  CrossReferenceLookupResponse,
  Note,
  ResearcherRelationshipStance,
} from '../../api/types';
import { notesState } from '../notes-state';
import { action, el, status } from '../study-dom';
import { BOOK_NAMES } from '../utils';

// === @section:types ===
export interface PassageCrossReferencesProps {
  onNavigate: (passage: ActivePassage) => void;
  onEvaluateRelationship: (prefill: RelationshipNotePrefill) => void;
}

export interface PassageCrossReferencesHandle {
  element: HTMLElement;
  setPassage: (passage: ActivePassage) => void;
  setPassageNotes: (notes: Note[]) => void;
}

const BOOK_NAME_MAP: ReadonlyMap<number, string> = new Map(
  BOOK_NAMES.map((name: string, idx: number) => [idx + 1, name])
);

// === @section:ui:edge-row ===
function createCrossReferenceRow(
  edge: CrossReferenceEdge,
  matchedNotes: Note[],
  props: PassageCrossReferencesProps
): HTMLElement {
  const row = el('article', 'rel-card');
  const top = el('div', 'rel-card__head');
  const isOutgoing = edge.direction === 'outgoing';
  const navSpan = isOutgoing ? edge.target_spans[0] : edge.source_passage;
  const labelText = isOutgoing
    ? edge.target_label
    : `${BOOK_NAME_MAP.get(edge.source_passage.book) ?? `Book ${edge.source_passage.book}`} ${edge.source_passage.chapter}:${edge.source_passage.verse_start}`;

  if (navSpan && navSpan.versification_status !== 'edition_only_non_canonical') {
    const navBtn = action(
      `${isOutgoing ? '→ ' : '← '}${labelText}`,
      () => props.onNavigate({ book: navSpan.book, chapter: navSpan.chapter, verse: navSpan.verse_start }),
      'reference-link rel-card__ref'
    );
    top.append(navBtn);
  } else {
    top.append(el('strong', 'rel-card__ref', `${isOutgoing ? '→ ' : '← '}${labelText}`));
  }

  const tierBadge = el(
    'span',
    'rel-badge rel-badge--tier',
    isOutgoing ? 'Attested association' : 'Reverse lookup'
  );
  top.append(tierBadge);
  row.append(top);

  const phrase = edge.anchor.phrase_bsb || edge.anchor.phrase_kjv;
  const why = el('p', 'rel-card__why');
  why.textContent = phrase
    ? `Source phrase (${edge.anchor.phrase_bsb ? 'BSB' : 'KJV'}): “${phrase}” · English phrase only (no guessed original-language token alignment).`
    : 'Whole-verse association in source dataset.';
  row.append(why);

  const prov = el('p', 'study-muted rel-card__prov');
  prov.textContent = `Source: ${edge.provenance.source_title} (${edge.provenance.license}) · ${edge.provenance.locator}`;
  row.append(prov);

  if (matchedNotes.length > 0) {
    const noteInfo = el('p', 'rel-card__notes-count');
    const stances = matchedNotes
      .map(n => BibleRPC.relationships.extractRelationshipEvaluation(n)?.stance ?? 'noted')
      .join(', ');
    noteInfo.textContent = `Researcher notes (${matchedNotes.length}): ${stances.replace(/_/g, ' ')}`;
    row.append(noteInfo);
  }

  const actions = el('div', 'rel-card__actions');
  const stances: Array<[ResearcherRelationshipStance, string]> = [
    ['agree', 'Note: Agree'],
    ['disagree', 'Disagree'],
    ['alternative_interpretation', 'Alternative'],
  ];
  for (const [stance, btnText] of stances) {
    actions.append(
      action(btnText, () => {
        const selectedNoteId = notesState.getSelectedNoteId();
        const prefill = BibleRPC.relationships.buildNotePrefillFromCrossReference(edge, {
          stance,
          bookNamesById: BOOK_NAME_MAP,
          connectToNote: selectedNoteId ? { id: selectedNoteId } : null,
        });
        props.onEvaluateRelationship(prefill);
      }, 'editor-btn editor-btn--sm')
    );
  }
  row.append(actions);
  return row;
}

// === @section:ui:render ===
function renderPacket(
  body: HTMLElement,
  summaryEl: HTMLElement,
  packet: CrossReferenceLookupResponse,
  notesByRelId: Map<string, Note[]>,
  props: PassageCrossReferencesProps,
  onLoadMore: (() => void) | null
): void {
  body.replaceChildren();
  const disclaimer = el(
    'p',
    'study-muted rel-disclaimer',
    'Cross-references record that a published source associates two passages; they do not automatically establish quotation, prophecy, typology, or theological equivalence.'
  );
  body.append(disclaimer);

  if (packet.status === 'not_in_slice') {
    summaryEl.textContent = 'Cross-references (outside vertical slice)';
    body.append(status(packet.error_message ?? 'Passage not yet populated in the vertical slice.'));
    return;
  }
  if (packet.status !== 'ok' && packet.status !== 'edition_only_passage') {
    summaryEl.textContent = 'Cross-references';
    body.append(status(packet.error_message ?? 'Cross-references unavailable for this passage.'));
    return;
  }

  const total = packet.page.total_available;
  summaryEl.textContent = `Cross-references (${total})`;
  if (packet.query_passage?.versification_note) {
    body.append(el('p', 'study-muted', packet.query_passage.versification_note));
  }

  if (packet.outgoing.length > 0) {
    body.append(el('h4', 'rel-subheading', `Outgoing associations (${packet.outgoing.length})`));
    const list = el('div', 'rel-list');
    for (const edge of packet.outgoing) {
      list.append(createCrossReferenceRow(edge, notesByRelId.get(edge.relationship_id) ?? [], props));
    }
    body.append(list);
  }
  if (packet.incoming.length > 0) {
    body.append(el('h4', 'rel-subheading', `Referenced by (${packet.incoming.length})`));
    const list = el('div', 'rel-list');
    for (const edge of packet.incoming) {
      list.append(createCrossReferenceRow(edge, notesByRelId.get(edge.relationship_id) ?? [], props));
    }
    body.append(list);
  }
  if (!packet.outgoing.length && !packet.incoming.length) {
    body.append(status('No published cross-references recorded for this verse.'));
  }
  if (packet.page.has_more && onLoadMore) {
    body.append(action('Load more cross-references', onLoadMore, 'study-button rel-load-more'));
  }
}

// === @section:logic:load ===
interface LoaderState {
  reqId: number;
  passage: ActivePassage | null;
  packet: CrossReferenceLookupResponse | null;
  notes: Note[];
}

// === @section:ui:main ===
export function createPassageCrossReferences(
  props: PassageCrossReferencesProps
): PassageCrossReferencesHandle {
  const details = el('details', 'study-disclosure passage-xrefs');
  const summaryEl = el('summary', '', 'Cross-references');
  const body = el('div', 'passage-xrefs__body');
  details.append(summaryEl, body);

  const state: LoaderState = { reqId: 0, passage: null, packet: null, notes: [] };

  function rerender(): void {
    if (!state.packet) return;
    const notesMap = BibleRPC.relationships.indexNotesByRelationshipId(state.notes);
    const cursor = state.packet.page.next_cursor;
    renderPacket(
      body,
      summaryEl,
      state.packet,
      notesMap,
      props,
      cursor ? () => void fetchPage(cursor, true) : null
    );
  }

  async function fetchPage(cursor: string | null, append: boolean): Promise<void> {
    if (!state.passage) return;
    const currentReq = ++state.reqId;
    if (!append) body.replaceChildren(status('Loading cross-references…'));
    const res = await BibleRPC.relationships.lookupCrossReferences({
      book: state.passage.book,
      chapter: state.passage.chapter,
      verse: state.passage.verse,
      direction: 'both',
      limit: 15,
      cursor,
    });
    if (currentReq !== state.reqId) return;
    if (append && state.packet && res.data.status === 'ok') {
      state.packet = {
        ...res.data,
        outgoing: [...state.packet.outgoing, ...res.data.outgoing],
        incoming: [...state.packet.incoming, ...res.data.incoming],
      };
    } else {
      state.packet = res.data;
    }
    rerender();
  }

  return {
    element: details,
    setPassage(passage: ActivePassage): void {
      state.passage = passage;
      state.packet = null;
      summaryEl.textContent = 'Cross-references';
      void fetchPage(null, false);
    },
    setPassageNotes(notes: Note[]): void {
      state.notes = notes;
      if (state.packet) rerender();
    },
  };
}
