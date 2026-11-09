// @file: src/ui/components/WordNotes.ts
// @feature: word-modal
// @tables: none
// @candidates: none
// @toc: imports | logic:match | ui:groups | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type {
  Note,
  NoteAnchor,
  WordNotesLemma,
} from '../../api/types';
import { createNoteCard, NoteCardHandlers } from './NoteCard';

export interface WordNotesOptions {
  onOpenNote?: (id: string) => void;
  onAnchor?: (anchor: NoteAnchor) => void;
  onInspectWord?: (wordId: number) => void;
  onAddNote?: () => void;
}

export interface WordNotesComponent {
  element: HTMLElement;
  setWord: (
    wordId: number | null,
    verseId?: number | null,
    position?: number | null
  ) => void;
  clear: () => void;
}

// === @section:logic:match ===
function anchorMatchesWord(
  anchor: NoteAnchor,
  wordId: number,
  verseId?: number | null,
  position?: number | null,
  lemmaIds: number[] = []
): boolean {
  if (anchor.kind === 'word_occurrence') {
    if (anchor.word_id !== wordId) return false;
    if (verseId != null && anchor.verse_id != null && anchor.verse_id !== verseId) return false;
    if (position != null && anchor.word_position != null && anchor.word_position !== position) return false;
    return true;
  }
  if (anchor.kind === 'word_form') return anchor.word_id === wordId;
  if (anchor.kind === 'lemma') return lemmaIds.includes(anchor.lemma_id);
  return false;
}

function enhanceCardConnections(
  card: HTMLElement,
  note: Note,
  wordId: number,
  verseId: number | null,
  position: number | null,
  lemmaIds: number[],
  onInspectWord?: (wordId: number) => void
): void {
  if (!note.connections?.length || !note.anchors?.length) return;
  const anchorMap = new Map<string, NoteAnchor>();
  for (const a of note.anchors) if (a.id) anchorMap.set(a.id, a);
  const chips = card.querySelectorAll<HTMLElement>('.note-connection-chip');
  note.connections.forEach((conn, idx) => {
    const chip = chips[idx];
    if (!chip) return;
    const fromAnchor = anchorMap.get(conn.from_anchor_id);
    const toAnchor = anchorMap.get(conn.to_anchor_id);
    const [fromBtn, toBtn] = chip.querySelectorAll<HTMLButtonElement>('.note-connection-chip__endpoint');
    if (!fromBtn || !toBtn) return;
    const fromMatches = fromAnchor ? anchorMatchesWord(fromAnchor, wordId, verseId, position, lemmaIds) : false;
    const toMatches = toAnchor ? anchorMatchesWord(toAnchor, wordId, verseId, position, lemmaIds) : false;
    if (fromMatches) {
      fromBtn.classList.add('is-inspected');
      fromBtn.title = 'Currently inspected word';
      fromBtn.setAttribute('aria-current', 'true');
      if (toAnchor && 'word_id' in toAnchor && toAnchor.word_id && onInspectWord) {
        const targetId = toAnchor.word_id;
        toBtn.onclick = (e) => { e.stopPropagation(); onInspectWord(targetId); };
        toBtn.title = `Inspect connected word (${toAnchor.label || 'target'})`;
      }
    } else if (toMatches) {
      toBtn.classList.add('is-inspected');
      toBtn.title = 'Currently inspected word';
      toBtn.setAttribute('aria-current', 'true');
      if (fromAnchor && 'word_id' in fromAnchor && fromAnchor.word_id && onInspectWord) {
        const sourceId = fromAnchor.word_id;
        fromBtn.onclick = (e) => { e.stopPropagation(); onInspectWord(sourceId); };
        fromBtn.title = `Inspect connected word (${fromAnchor.label || 'source'})`;
      }
    }
  });
}

// === @section:ui:groups ===
function renderGroup(
  container: HTMLElement,
  title: string,
  notes: Note[],
  emptyText: string,
  wordId: number,
  verseId: number | null,
  pos: number | null,
  lemmaIds: number[],
  options: WordNotesOptions
): void {
  const details = document.createElement('details');
  details.className = 'word-notes__group';
  if (notes.length > 0) details.open = true;

  const summary = document.createElement('summary');
  summary.className = 'word-notes__group-summary';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'word-notes__group-title';
  titleSpan.textContent = title;
  const badge = document.createElement('span');
  badge.className = 'word-notes__badge';
  badge.textContent = String(notes.length);
  summary.append(titleSpan, badge);
  details.appendChild(summary);

  const content = document.createElement('div');
  content.className = 'word-notes__group-content';
  if (notes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'word-notes__empty';
    empty.textContent = emptyText;
    content.appendChild(empty);
  } else {
    const handlers: NoteCardHandlers = {
      onOpen: options.onOpenNote,
      onAnchor: options.onAnchor,
    };
    for (const note of notes) {
      const card = createNoteCard(note, handlers);
      enhanceCardConnections(card, note, wordId, verseId, pos, lemmaIds, options.onInspectWord);
      content.appendChild(card);
    }
  }
  details.appendChild(content);
  container.appendChild(details);
}

// === @section:ui:main ===
export function createWordNotes(options: WordNotesOptions = {}): WordNotesComponent {
  const element = document.createElement('section');
  element.className = 'word-notes';
  element.setAttribute('aria-label', 'Notes on this word');

  const heading = document.createElement('h3');
  heading.className = 'word-notes__title';
  heading.textContent = 'Word Notes';
  if (options.onAddNote) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'word-notes__add-btn';
    addBtn.textContent = '+ Add note';
    addBtn.addEventListener('click', () => options.onAddNote?.());
    heading.append(' ', addBtn);
  }
  const statusEl = document.createElement('p');
  statusEl.className = 'word-notes__status';
  statusEl.textContent = 'Select a word to view notes.';
  const groupsContainer = document.createElement('div');
  groupsContainer.className = 'word-notes__groups';
  element.append(heading, statusEl, groupsContainer);

  let currentRequestId = 0;
  let abortController: AbortController | null = null;

  function clear(): void {
    abortController?.abort();
    abortController = null;
    currentRequestId++;
    statusEl.hidden = false;
    statusEl.textContent = 'Select a word to view notes.';
    groupsContainer.replaceChildren();
  }

  async function setWord(wordId: number | null, verseId: number | null = null, position: number | null = null): Promise<void> {
    abortController?.abort();
    abortController = null;
    const reqId = ++currentRequestId;
    if (wordId === null) { clear(); return; }

    abortController = new AbortController();
    statusEl.hidden = false;
    statusEl.textContent = 'Loading notes for this word…';
    groupsContainer.replaceChildren();

    try {
      const res = await BibleRPC.notes.getForWord(wordId, verseId, position, { signal: abortController.signal });
      if (reqId !== currentRequestId) return;
      if (res.source === 'unavailable' || !res.data) {
        statusEl.textContent = res.error || 'Notes unavailable for this word.';
        return;
      }
      const data = res.data;
      const total = data.totals?.total ?? 0;
      statusEl.textContent = total === 0 ? 'No notes found for this word.' : '';
      statusEl.hidden = total > 0;
      const lemmaIds = data.lemmas?.map((l: WordNotesLemma) => l.lemma_id) || [];
      groupsContainer.replaceChildren();
      for (const [title, list, empty] of [
        ['On this occurrence', data.groups?.occurrence || [], 'No notes on this specific occurrence.'],
        ['On this word form', data.groups?.form || [], 'No notes on this word form.'],
        ['On this lemma', data.groups?.lemma || [], 'No notes on this lemma.'],
      ] as const) {
        renderGroup(groupsContainer, title, list, empty, wordId, verseId, position, lemmaIds, options);
      }
    } catch (err: unknown) {
      if (reqId !== currentRequestId) return;
      if ((err as Error)?.name === 'AbortError') return;
      statusEl.hidden = false;
      statusEl.textContent = 'Failed to load notes. Please retry.';
    }
  }

  return { element, setWord, clear };
}
