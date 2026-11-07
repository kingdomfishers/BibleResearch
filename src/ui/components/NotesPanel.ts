// @file: src/ui/components/NotesPanel.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: imports | logic:load | logic:filter | ui:filters | ui:tiers | ui:header | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type {
  ActivePassage,
  ConnectionTypesResponse,
  Note,
  NoteAnchor,
  NoteKind,
  NoteReviewStatus,
  PassageNotesResponse,
  TokenNoteCount,
} from '../../api/types';
import { createNoteCard } from './NoteCard';
import { notesState } from '../notes-state';

export interface NotesPanelDeps {
  onAdd?: () => void;
  onEdit?: (note: Note) => void;
  onDelete?: (noteId: string) => void;
  onAnchor?: (anchor: NoteAnchor) => void;
  onReview?: (noteId: string, status: NoteReviewStatus) => void;
  onTokenCounts?: (counts: TokenNoteCount[]) => void;
}

export interface NotesPanelHandle {
  element: HTMLElement;
  setPassage: (p: ActivePassage) => void;
  refresh: () => void;
}

// === @section:logic:load ===
export class NotesDataLoader {
  private currentRequestId = 0;
  private abortController: AbortController | null = null;
  private cachedConnectionTypes: ConnectionTypesResponse | null = null;

  async loadConnectionTypes(): Promise<ConnectionTypesResponse | null> {
    if (this.cachedConnectionTypes) return this.cachedConnectionTypes;
    const res = await BibleRPC.notes.connectionTypes();
    if (res.data) this.cachedConnectionTypes = res.data;
    return this.cachedConnectionTypes;
  }

  async loadPassageNotes(
    p: ActivePassage,
    onSuccess: (data: PassageNotesResponse, reqId: number) => void,
    onError: (msg: string, reqId: number) => void
  ): Promise<number> {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const reqId = ++this.currentRequestId;

    try {
      const res = await BibleRPC.notes.getForPassage(p, {
        signal: this.abortController.signal,
      });
      if (reqId !== this.currentRequestId) return reqId;

      if (res.source === 'unavailable' || !res.data) {
        onError(res.error || 'Notes service unavailable', reqId);
      } else {
        onSuccess(res.data, reqId);
      }
    } catch (err) {
      if (reqId !== this.currentRequestId) return reqId;
      const msg = err instanceof Error ? err.message : 'Failed to load notes';
      onError(msg, reqId);
    }
    return reqId;
  }

  isCurrent(reqId: number): boolean {
    return reqId === this.currentRequestId;
  }
}

// === @section:logic:filter ===
export function filterNotes(notes: Note[]): { list: Note[]; hiddenAi: number } {
  const filters = notesState.getFilters();
  let hiddenAi = 0;

  const filtered = notes.filter((note) => {
    const isAi = note.author?.kind === 'ai';
    if (filters.author === 'human' && isAi) {
      hiddenAi++;
      return false;
    }
    if (filters.author === 'ai' && !isAi) return false;
    if (filters.kind && note.note_kind !== filters.kind) return false;
    if (filters.connectionType) {
      const hasConn = note.connections?.some((c) => c.connection_type === filters.connectionType);
      if (!hasConn) return false;
    }
    return true;
  });

  return { list: filtered, hiddenAi };
}

// === @section:ui:filters ===
export function createFilterBar(
  typesData: ConnectionTypesResponse | null,
  onFilterChange: () => void
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'notes-panel__filter-bar';

  const authorGroup = document.createElement('div');
  authorGroup.className = 'notes-panel__author-toggle';
  const authors: { label: string; value: 'all' | 'human' | 'ai' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Human', value: 'human' },
    { label: 'AI', value: 'ai' },
  ];

  const currentFilters = notesState.getFilters();

  for (const a of authors) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `notes-panel__author-btn ${currentFilters.author === a.value ? 'is-active' : ''}`;
    btn.textContent = a.label;
    btn.addEventListener('click', () => {
      notesState.setFilters({ author: a.value });
      authorGroup.querySelectorAll('.notes-panel__author-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      onFilterChange();
    });
    authorGroup.appendChild(btn);
  }
  bar.appendChild(authorGroup);

  const kindSelect = document.createElement('select');
  kindSelect.className = 'notes-panel__select';
  const defaultKind = document.createElement('option');
  defaultKind.value = '';
  defaultKind.textContent = 'All Kinds';
  kindSelect.appendChild(defaultKind);

  for (const k of typesData?.note_kinds || []) {
    const opt = document.createElement('option');
    opt.value = k.note_kind;
    opt.textContent = k.label || k.note_kind;
    if (currentFilters.kind === k.note_kind) opt.selected = true;
    kindSelect.appendChild(opt);
  }
  kindSelect.addEventListener('change', () => {
    notesState.setFilters({ kind: (kindSelect.value as NoteKind) || null });
    onFilterChange();
  });
  bar.appendChild(kindSelect);

  const connSelect = document.createElement('select');
  connSelect.className = 'notes-panel__select';
  const defaultConn = document.createElement('option');
  defaultConn.value = '';
  defaultConn.textContent = 'All Connections';
  connSelect.appendChild(defaultConn);

  for (const ct of typesData?.connection_types || []) {
    const opt = document.createElement('option');
    opt.value = ct.type_key;
    opt.textContent = ct.label || ct.type_key;
    if (currentFilters.connectionType === ct.type_key) opt.selected = true;
    connSelect.appendChild(opt);
  }
  connSelect.addEventListener('change', () => {
    notesState.setFilters({ connectionType: connSelect.value || null });
    onFilterChange();
  });
  bar.appendChild(connSelect);

  return bar;
}

// === @section:ui:tiers ===
export function renderTiers(
  data: PassageNotesResponse,
  deps: NotesPanelDeps,
  container: HTMLElement
): void {
  container.textContent = '';

  const { list: primaryList, hiddenAi: hiddenPrimaryAi } = filterNotes(data.primary || []);
  const { list: secondaryList, hiddenAi: hiddenSecondaryAi } = filterNotes((data.secondary || []) as Note[]);
  const totalHiddenAi = hiddenPrimaryAi + hiddenSecondaryAi;

  if (totalHiddenAi > 0) {
    const hint = document.createElement('div');
    hint.className = 'notes-panel__hidden-ai-notice';
    hint.textContent = `${totalHiddenAi} AI note${totalHiddenAi > 1 ? 's' : ''} hidden`;
    container.appendChild(hint);
  }

  if (data.truncated?.primary || data.truncated?.secondary) {
    const trunc = document.createElement('div');
    trunc.className = 'notes-panel__truncated-hint';
    trunc.textContent = 'Note limit reached for this passage; showing the most recent notes.';
    container.appendChild(trunc);
  }

  const primaryWrap = document.createElement('div');
  primaryWrap.className = 'notes-panel__primary-list';
  for (const note of primaryList) {
    primaryWrap.appendChild(createNoteCard(note, deps));
  }
  container.appendChild(primaryWrap);

  if (secondaryList.length > 0) {
    const details = document.createElement('details');
    details.className = 'notes-panel__secondary-details';

    const summary = document.createElement('summary');
    summary.textContent = `Also tagged on words in this verse (${secondaryList.length})`;
    details.appendChild(summary);

    const secondaryWrap = document.createElement('div');
    secondaryWrap.className = 'notes-panel__secondary-list';
    for (const note of secondaryList) {
      secondaryWrap.appendChild(createNoteCard(note, deps));
    }
    details.appendChild(secondaryWrap);
    container.appendChild(details);
  }

  if (primaryList.length === 0 && secondaryList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notes-panel__empty';
    const msg = document.createElement('p');
    msg.textContent = 'No notes for this passage yet.';
    empty.appendChild(msg);

    if (deps.onAdd) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'study-button primary';
      addBtn.textContent = 'Add note';
      addBtn.addEventListener('click', deps.onAdd);
      empty.appendChild(addBtn);
    }
    container.appendChild(empty);
  }
}

// === @section:ui:header ===
export function createNotesPanelHeader(onAdd?: () => void): {
  header: HTMLElement;
  updateCounts: (totals?: { total: number; human: number; ai: number }) => void;
} {
  const header = document.createElement('div');
  header.className = 'notes-panel__header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'notes-panel__title-wrap';

  const title = document.createElement('h2');
  title.className = 'notes-panel__title';
  title.textContent = 'Notes';

  const counts = document.createElement('span');
  counts.className = 'notes-panel__counts';
  counts.id = 'notes-counts';

  titleWrap.appendChild(title);
  titleWrap.appendChild(counts);
  header.appendChild(titleWrap);

  if (onAdd) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'study-button';
    addBtn.textContent = '+ Add note';
    addBtn.addEventListener('click', onAdd);
    header.appendChild(addBtn);
  }

  function updateCounts(totals?: { total: number; human: number; ai: number }) {
    if (!totals) {
      counts.textContent = '';
      return;
    }
    counts.textContent = `(${totals.total} · ${totals.human} You · ${totals.ai} AI)`;
  }

  return { header, updateCounts };
}

// === @section:ui:main ===
export function createNotesPanel(deps: NotesPanelDeps = {}): NotesPanelHandle {
  const element = document.createElement('section');
  element.className = 'notes-panel';
  element.setAttribute('aria-label', 'Notes and Connections');

  const loader = new NotesDataLoader();
  let currentPassage: ActivePassage = { book: 1, chapter: 1, verse: 1 };
  let typesData: ConnectionTypesResponse | null = null;
  let lastData: PassageNotesResponse | null = null;

  const { header, updateCounts } = createNotesPanelHeader(deps.onAdd);
  element.appendChild(header);

  const filterContainer = document.createElement('div');
  element.appendChild(filterContainer);

  const contentArea = document.createElement('div');
  contentArea.className = 'notes-panel__content';
  element.appendChild(contentArea);

  function renderCurrentData() {
    if (!lastData) return;
    updateCounts(lastData.totals);
    renderTiers(lastData, deps, contentArea);
  }

  function fetchNotes() {
    const loading = document.createElement('div');
    loading.className = 'notes-panel__loading';
    loading.textContent = 'Loading notes...';
    contentArea.replaceChildren(loading);

    loader.loadPassageNotes(
      currentPassage,
      (data) => {
        lastData = data;
        renderCurrentData();
        if (deps.onTokenCounts && data.token_note_counts) {
          deps.onTokenCounts(data.token_note_counts);
        }
      },
      (msg) => {
        const errWrap = document.createElement('div');
        errWrap.className = 'notes-panel__error';
        const errP = document.createElement('p');
        errP.textContent = msg;
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'study-button';
        retryBtn.id = 'notes-retry-btn';
        retryBtn.textContent = 'Retry';
        retryBtn.addEventListener('click', fetchNotes);
        errWrap.appendChild(errP);
        errWrap.appendChild(retryBtn);
        contentArea.replaceChildren(errWrap);
      }
    );
  }

  loader.loadConnectionTypes().then((types) => {
    typesData = types;
    filterContainer.replaceChildren(createFilterBar(typesData, renderCurrentData));
  });

  return {
    element,
    setPassage: (p: ActivePassage) => {
      currentPassage = { ...p };
      fetchNotes();
    },
    refresh: () => {
      fetchNotes();
    },
  };
}
