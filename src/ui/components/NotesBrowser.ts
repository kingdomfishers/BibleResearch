// @file: src/ui/components/NotesBrowser.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: imports | types | logic:load | logic:fetch | ui:author-filters | ui:type-filters | ui:list | ui:return-bar | ui:main

// === @section:imports ===
import type { ActivePassage, AuthorKind, Note, NoteAnchor, NoteKind, NoteReviewStatus } from '../../api/types';
import type { KeysetCursor, NoteListResponse } from '../../api/notes-api-types';
import { BibleRPC } from '../../api/rpc';
import { notesState } from '../notes-state';
import { createNoteCard } from './NoteCard';
import { parseAnchorPassage } from '../utils';

// === @section:types ===
export interface NotesBrowserProps {
  onNavigatePassage?: (p: ActivePassage) => void;
  onInspectWord?: (wordId: number) => void;
  onEditNote?: (note: Note) => void;
  onDeleteNote?: (noteId: string) => Promise<void>;
  onReviewNote?: (noteId: string, status: NoteReviewStatus) => Promise<void>;
  onClose?: () => void;
}

export interface NotesBrowserFilterState {
  authorKind: AuthorKind | 'all';
  noteKind: NoteKind | null;
  connectionType: string | null;
  query: string;
}

export interface NotesBrowserHandle {
  element: HTMLElement;
  returnBar: HTMLElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  refresh: () => Promise<void>;
  openDeepLink: (noteId: string) => Promise<boolean>;
  getManager: () => NotesListManager;
  getFilters: () => NotesBrowserFilterState;
}

// === @section:logic:load ===
export { parseAnchorPassage };

export class NotesListManager {
  notes: Note[] = [];
  seenIds = new Set<string>();
  cursor: KeysetCursor | null = null;
  hasMore = false;
  total = 0;
  isLoading = false;
  error: string | null = null;

  reset(): void {
    this.notes = [];
    this.seenIds.clear();
    this.cursor = null;
    this.hasMore = false;
    this.total = 0;
    this.error = null;
  }

  append(res: NoteListResponse): void {
    this.total = res.total;
    this.hasMore = res.page.has_more;
    this.cursor = res.page.next_cursor;
    for (const n of res.notes) {
      if (!this.seenIds.has(n.id)) {
        this.seenIds.add(n.id);
        this.notes.push(n);
      }
    }
  }
}

// === @section:logic:fetch ===
export async function executeNotesFetch(
  mgr: NotesListManager,
  filters: NotesBrowserFilterState,
  onRender: () => void,
  reset = false
): Promise<void> {
  if (reset) mgr.reset();
  mgr.isLoading = true;
  onRender();
  const res = await BibleRPC.notes.list(
    {
      authorKind: filters.authorKind,
      noteKind: filters.noteKind,
      connectionType: filters.connectionType,
      query: filters.query || null,
    },
    mgr.cursor,
    { limit: 20 }
  );
  mgr.isLoading = false;
  if (res.error) mgr.error = res.error;
  else if (res.data) mgr.append(res.data);
  onRender();
}

// === @section:ui:author-filters ===
export function createAuthorPills(
  initialKind: AuthorKind | 'all',
  onSelect: (kind: AuthorKind | 'all') => void
): { container: HTMLElement; setSelected: (kind: AuthorKind | 'all') => void } {
  const container = document.createElement('div');
  container.className = 'notes-browser__authors';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Filter by author');

  const btns: Record<string, HTMLButtonElement> = {};
  for (const kind of ['all', 'human', 'ai'] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `filter-pill${initialKind === kind ? ' is-active' : ''}`;
    btn.textContent = kind === 'all' ? 'All' : kind === 'human' ? 'Human' : 'AI';
    btn.addEventListener('click', () => {
      setSelected(kind);
      onSelect(kind);
    });
    btns[kind] = btn;
    container.append(btn);
  }

  function setSelected(k: AuthorKind | 'all') {
    for (const [key, b] of Object.entries(btns)) {
      b.classList.toggle('is-active', key === k);
    }
  }

  return { container, setSelected };
}

// === @section:ui:type-filters ===
export function createTypeFilters(
  current: NotesBrowserFilterState,
  onChange: (f: NotesBrowserFilterState) => void
): { container: HTMLElement; setFilters: (f: Partial<NotesBrowserFilterState>) => void } {
  const container = document.createElement('div');
  container.className = 'notes-browser__type-filters';

  const kindSelect = document.createElement('select');
  kindSelect.className = 'filter-select';
  kindSelect.setAttribute('aria-label', 'Filter by note kind');
  const defaultKind = document.createElement('option');
  defaultKind.value = ''; defaultKind.textContent = 'All kinds';
  kindSelect.append(defaultKind);
  kindSelect.addEventListener('change', () => {
    current.noteKind = (kindSelect.value as NoteKind) || null;
    onChange(current);
  });

  const connSelect = document.createElement('select');
  connSelect.className = 'filter-select';
  connSelect.setAttribute('aria-label', 'Filter by connection type');
  const defaultConn = document.createElement('option');
  defaultConn.value = ''; defaultConn.textContent = 'All connections';
  connSelect.append(defaultConn);
  connSelect.addEventListener('change', () => {
    current.connectionType = connSelect.value || null;
    onChange(current);
  });

  void BibleRPC.notes.connectionTypes().then(res => {
    if (res.data) {
      for (const k of res.data.note_kinds || []) {
        const opt = document.createElement('option');
        opt.value = k.note_kind; opt.textContent = k.label;
        kindSelect.append(opt);
      }
      for (const c of res.data.connection_types || []) {
        const opt = document.createElement('option');
        opt.value = c.type_key; opt.textContent = c.label;
        connSelect.append(opt);
      }
    }
  });

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'filter-input';
  searchInput.placeholder = 'Search note text...';
  searchInput.value = current.query;
  let timer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      current.query = searchInput.value.trim();
      onChange(current);
    }, 300);
  });

  container.append(kindSelect, connSelect, searchInput);
  return {
    container,
    setFilters: (f: Partial<NotesBrowserFilterState>) => {
      if (f.noteKind !== undefined) kindSelect.value = f.noteKind || '';
      if (f.connectionType !== undefined) connSelect.value = f.connectionType || '';
      if (f.query !== undefined) searchInput.value = f.query;
    },
  };
}

// === @section:ui:list ===
export function createNotesList(
  mgr: NotesListManager,
  handlers: {
    onAnchorClick: (anchor: NoteAnchor) => void;
    onEditNote?: (note: Note) => void;
    onDeleteNote?: (id: string) => Promise<void>;
    onReviewNote?: (id: string, status: NoteReviewStatus) => Promise<void>;
    onLoadMore: () => Promise<void>;
  }
): { container: HTMLElement; render: () => void } {
  const container = document.createElement('div');
  container.className = 'notes-browser__list-wrap';
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'notes-browser__cards';
  const statusEl = document.createElement('div');
  statusEl.className = 'notes-browser__status';
  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.type = 'button';
  loadMoreBtn.className = 'study-button notes-browser__load-more';
  loadMoreBtn.textContent = 'Load more';
  loadMoreBtn.hidden = true;
  loadMoreBtn.addEventListener('click', async () => {
    loadMoreBtn.disabled = true; loadMoreBtn.textContent = 'Loading...';
    try { await handlers.onLoadMore(); } finally {
      loadMoreBtn.disabled = false; loadMoreBtn.textContent = 'Load more';
    }
  });

  function render() {
    cardsContainer.replaceChildren();
    if (mgr.isLoading && mgr.notes.length === 0) {
      statusEl.textContent = 'Loading notes...';
      statusEl.hidden = false; loadMoreBtn.hidden = true; return;
    }
    if (mgr.error) {
      statusEl.textContent = `Error loading notes: ${mgr.error}`;
      statusEl.hidden = false; loadMoreBtn.hidden = true; return;
    }
    if (mgr.notes.length === 0) {
      statusEl.textContent = 'No notes match your filter.';
      statusEl.hidden = false; loadMoreBtn.hidden = true; return;
    }
    statusEl.hidden = true;
    for (const note of mgr.notes) {
      const card = createNoteCard(note, {
        onAnchor: handlers.onAnchorClick,
        onEdit: handlers.onEditNote,
        onDelete: handlers.onDeleteNote,
        onReview: handlers.onReviewNote,
      });
      card.classList.add('note-card--compact');
      cardsContainer.append(card);
    }
    loadMoreBtn.hidden = !mgr.hasMore;
  }
  container.append(statusEl, cardsContainer, loadMoreBtn);
  return { container, render };
}

// === @section:ui:return-bar ===
export function createBrowserChrome(onClose: () => void, onReturn: () => void): {
  header: HTMLElement;
  banner: HTMLElement;
  returnBar: HTMLElement;
} {
  const header = document.createElement('div');
  header.className = 'notes-browser__header';
  const title = document.createElement('h2');
  title.className = 'notes-browser__title';
  title.textContent = 'All Notes & Connections';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'notes-browser__close-btn';
  closeBtn.setAttribute('aria-label', 'Close notes browser');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', onClose);
  header.append(title, closeBtn);

  const banner = document.createElement('div');
  banner.className = 'notes-browser__banner';
  banner.hidden = true;

  const returnBar = document.createElement('div');
  returnBar.className = 'notes-browser-return';
  returnBar.hidden = true;
  const returnBtn = document.createElement('button');
  returnBtn.type = 'button';
  returnBtn.className = 'study-button notes-browser-return__btn';
  returnBtn.textContent = '← Back to notes';
  returnBtn.addEventListener('click', onReturn);
  returnBar.append(returnBtn);

  return { header, banner, returnBar };
}

// === @section:ui:main ===
export function createNotesBrowser(props: NotesBrowserProps = {}): NotesBrowserHandle {
  const mgr = new NotesListManager();
  const root = document.createElement('div');
  root.className = 'notes-browser';
  root.hidden = true;

  const { header, banner, returnBar } = createBrowserChrome(
    () => close(),
    () => { returnBar.hidden = true; open(); }
  );

  const filters: NotesBrowserFilterState = {
    authorKind: notesState.getFilters().author,
    noteKind: null, connectionType: null, query: '',
  };

  const filterWrap = document.createElement('div');
  filterWrap.className = 'notes-browser__filters';
  const authorPills = createAuthorPills(filters.authorKind, k => {
    filters.authorKind = k;
    notesState.setFilters({ author: k });
    void executeNotesFetch(mgr, filters, () => listView.render(), true);
  });
  const typeFilters = createTypeFilters(filters, () => {
    void executeNotesFetch(mgr, filters, () => listView.render(), true);
  });
  filterWrap.append(authorPills.container, typeFilters.container);

  const listView = createNotesList(mgr, {
    onAnchorClick: anchor => {
      const p = parseAnchorPassage(anchor.label);
      if (p && props.onNavigatePassage) {
        close(); returnBar.hidden = false; props.onNavigatePassage(p);
      } else if (anchor.kind === 'word_occurrence' && props.onNavigatePassage && (anchor as any).verse_id) {
        close(); returnBar.hidden = false;
      } else if ((anchor.kind === 'word_form' || anchor.kind === 'lemma') && props.onInspectWord) {
        const wid = (anchor as any).word_id || (anchor as any).lemma_id;
        if (wid) props.onInspectWord(wid);
      }
    },
    onEditNote: props.onEditNote,
    onDeleteNote: async id => {
      if (props.onDeleteNote) await props.onDeleteNote(id);
      await executeNotesFetch(mgr, filters, () => listView.render(), true);
    },
    onReviewNote: async (id, status) => {
      if (props.onReviewNote) await props.onReviewNote(id, status);
      await executeNotesFetch(mgr, filters, () => listView.render(), true);
    },
    onLoadMore: () => executeNotesFetch(mgr, filters, () => listView.render(), false),
  });

  root.append(header, banner, filterWrap, listView.container);
  function open() {
    root.hidden = false; returnBar.hidden = true;
    if (mgr.notes.length === 0) void executeNotesFetch(mgr, filters, () => listView.render(), true);
  }
  function close() { root.hidden = true; props.onClose?.(); }

  async function openDeepLink(noteId: string): Promise<boolean> {
    banner.hidden = true;
    const res = await BibleRPC.notes.getNote(noteId);
    if (res.data) { open(); if (props.onEditNote) props.onEditNote(res.data); return true; }
    banner.textContent = 'Note not found or has been removed.';
    banner.hidden = false; open(); return false;
  }

  return {
    element: root, returnBar, open, close,
    isOpen: () => !root.hidden,
    refresh: () => executeNotesFetch(mgr, filters, () => listView.render(), true),
    openDeepLink, getManager: () => mgr,
    getFilters: () => ({ ...filters }),
  };
}
