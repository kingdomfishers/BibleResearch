// @file: src/ui/notes-state.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: types | logic:filters | logic:hash | logic:store | logic:api

// === @section:types ===
export type AuthorFilter = 'all' | 'human' | 'ai';

export interface NotesFilterState {
  author: AuthorFilter;
  kind: string | null;
  connectionType: string | null;
}

export interface NotesStoreState {
  filters: NotesFilterState;
  selectedNoteId: string | null;
  selectedTokenPosition: number | null;
}

export type NotesStateListener = (state: NotesStoreState) => void;

// === @section:logic:filters ===
const FILTERS_KEY = 'notes.filters.v1';

export const DEFAULT_FILTERS: NotesFilterState = {
  author: 'all',
  kind: null,
  connectionType: null,
};

export function loadFilters(): NotesFilterState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_FILTERS };
  }
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (!raw) return { ...DEFAULT_FILTERS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_FILTERS };

    const author: AuthorFilter =
      parsed.author === 'human' || parsed.author === 'ai' ? parsed.author : 'all';
    const kind = typeof parsed.kind === 'string' && parsed.kind.trim() ? parsed.kind.trim() : null;
    const connectionType =
      typeof parsed.connectionType === 'string' && parsed.connectionType.trim()
        ? parsed.connectionType.trim()
        : null;

    return { author, kind, connectionType };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function saveFilters(filters: NotesFilterState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Ignore quota or private-mode storage errors
  }
}

// === @section:logic:hash ===
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseNoteHash(hashStr: string): string | null {
  if (!hashStr) return null;
  const clean = hashStr.startsWith('#') ? hashStr.slice(1) : hashStr;
  const match = /^note=([0-9a-fA-F-]+)$/.exec(clean);
  if (!match) return null;
  const candidate = match[1].toLowerCase();
  return UUID_REGEX.test(candidate) ? candidate : null;
}

export function buildNoteHash(id: string): string {
  return `#note=${id.toLowerCase()}`;
}

export function noteIdFromHash(hash?: string): string | null {
  const target = hash !== undefined ? hash : (typeof window !== 'undefined' ? window.location.hash : '');
  return parseNoteHash(target);
}

// === @section:logic:store ===
let currentFilters = loadFilters();
let currentSelectedNoteId =
  typeof window !== 'undefined' ? parseNoteHash(window.location.hash) : null;
let currentSelectedTokenPosition: number | null = null;
const listeners = new Set<NotesStateListener>();

function emit(): void {
  const snapshot: NotesStoreState = {
    filters: { ...currentFilters },
    selectedNoteId: currentSelectedNoteId,
    selectedTokenPosition: currentSelectedTokenPosition,
  };
  listeners.forEach((fn) => fn(snapshot));
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const nextId = parseNoteHash(window.location.hash);
    if (nextId !== currentSelectedNoteId) {
      currentSelectedNoteId = nextId;
      emit();
    }
  });
}

// === @section:logic:api ===
export const notesState = {
  getFilters: (): NotesFilterState => ({ ...currentFilters }),
  setFilters(partial: Partial<NotesFilterState>) {
    currentFilters = { ...currentFilters, ...partial };
    if (
      currentFilters.author !== 'all' &&
      currentFilters.author !== 'human' &&
      currentFilters.author !== 'ai'
    ) {
      currentFilters.author = 'all';
    }
    saveFilters(currentFilters);
    emit();
  },
  resetFilters() {
    currentFilters = { ...DEFAULT_FILTERS };
    saveFilters(currentFilters);
    emit();
  },
  getSelectedNoteId: (): string | null => currentSelectedNoteId,
  setSelectedNoteId(id: string | null) {
    if (id === currentSelectedNoteId) return;
    currentSelectedNoteId = id;
    if (typeof window !== 'undefined' && id) {
      const newHash = buildNoteHash(id);
      if (window.location.hash !== newHash) {
        window.history.pushState(null, '', newHash);
      }
    }
    emit();
  },
  clearSelectedNoteId() {
    if (currentSelectedNoteId === null) return;
    currentSelectedNoteId = null;
    emit();
  },
  getSelectedTokenPosition: (): number | null => currentSelectedTokenPosition,
  setSelectedTokenPosition(pos: number | null) {
    if (pos === currentSelectedTokenPosition) return;
    currentSelectedTokenPosition = pos;
    emit();
  },
  clearSelectedTokenPosition() {
    if (currentSelectedTokenPosition === null) return;
    currentSelectedTokenPosition = null;
    emit();
  },
  getState: (): NotesStoreState => ({
    filters: { ...currentFilters },
    selectedNoteId: currentSelectedNoteId,
    selectedTokenPosition: currentSelectedTokenPosition,
  }),
  subscribe(listener: NotesStateListener): () => void {
    listeners.add(listener);
    listener({
      filters: { ...currentFilters },
      selectedNoteId: currentSelectedNoteId,
      selectedTokenPosition: currentSelectedTokenPosition,
    });
    return () => {
      listeners.delete(listener);
    };
  },
};
