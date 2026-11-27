// @file: src/ui/exploration-state.ts
// @feature: exploration-state
// @tables: none
// @candidates: none
// @toc: imports | types | logic:helpers | logic:storage | logic:store

// === @section:imports ===
import type { ActivePassage } from '../api/types';
import { appState } from './state';
import { formatVerseRef } from './utils';

// === @section:types ===
export type AnchorKind = 'verse' | 'passage' | 'occurrence' | 'lemma' | 'concept' | 'edge';
export type ReaderMode = 'verse' | 'context' | 'chapter';
export type DensityMode = 'rich' | 'compact' | 'english';

export interface Anchor {
  kind: AnchorKind;
  canonicalKey: string;
  label: string;
  passage?: ActivePassage;
  wordId?: number;
  position?: number;
  strongs?: string;
  original?: string;
  transliteration?: string;
  english?: string;
}

export interface ConnectionEdge {
  id: string;
  fromKey: string;
  toKey: string;
  relation: string;
  epistemicClass: string;
  why: string;
  sourceRelease?: string;
}

export interface PinnedPassage {
  passage: ActivePassage;
  label: string;
  wordPosition?: number;
}

export interface WordSelectionSnapshot {
  id: number;
  position?: number;
  original?: string;
  transliteration?: string;
  english?: string;
  strongs?: string;
}

export interface ExplorationStep {
  id: string;
  parentStepId: string | null;
  childStepIds: string[];
  anchor: Anchor;
  traversedEdge: ConnectionEdge | null;
  readerMode: ReaderMode;
  selectedWord: WordSelectionSnapshot | null;
  createdAt: number;
}

export interface UserHypothesis {
  id: string;
  from: Anchor;
  to: Anchor;
  note: string;
  status: 'user_hypothesis';
  linkedRefs: string[];
  savedNoteId?: string | null;
  createdAt: number;
}

export interface ExplorationSnapshot {
  rootStepId: string;
  currentStepId: string;
  steps: Record<string, ExplorationStep>;
  pins: { a: PinnedPassage | null; b: PinnedPassage | null };
  hypotheses: UserHypothesis[];
  readerMode: ReaderMode;
  densityMode: DensityMode;
  stepOrder: string[];
}

export type RestoreStepInfo = { passageChanged: boolean };
export type RestoreStepListener = (step: ExplorationStep, info: RestoreStepInfo) => void;

// === @section:logic:helpers ===
const TREE_STORAGE_KEY = 'br-exploration-tree-v1';
const DENSITY_STORAGE_KEY = 'br-reader-density';
const MAX_STEPS = 150;

const samePassage = (a?: ActivePassage | null, b?: ActivePassage | null) =>
  !!a && !!b && a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;

const makePassageKey = (p: ActivePassage) => `verse:${p.book}-${p.chapter}-${p.verse}`;

let stepSeq = 0;
function nextStepId() {
  stepSeq += 1;
  return `step-${Date.now().toString(36)}-${stepSeq}`;
}

function readDensity(): DensityMode {
  try {
    const saved = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (saved === 'rich' || saved === 'compact' || saved === 'english') return saved;
  } catch { /* Storage optional. */ }
  return 'rich';
}

function writeDensity(mode: DensityMode) {
  try { localStorage.setItem(DENSITY_STORAGE_KEY, mode); } catch { /* Storage optional. */ }
}

function createInitialState(initialPassage: ActivePassage): ExplorationSnapshot {
  const rootId = 'step-root';
  const root: ExplorationStep = {
    id: rootId,
    parentStepId: null,
    childStepIds: [],
    anchor: {
      kind: 'verse',
      canonicalKey: makePassageKey(initialPassage),
      label: formatVerseRef(initialPassage),
      passage: { ...initialPassage },
    },
    traversedEdge: null,
    readerMode: 'verse',
    selectedWord: null,
    createdAt: Date.now(),
  };
  return {
    rootStepId: rootId,
    currentStepId: rootId,
    steps: { [rootId]: root },
    pins: { a: null, b: null },
    hypotheses: [],
    readerMode: 'verse',
    densityMode: readDensity(),
    stepOrder: [rootId],
  };
}

// === @section:logic:storage ===
function loadSnapshot(initialPassage: ActivePassage): ExplorationSnapshot {
  try {
    const raw = localStorage.getItem(TREE_STORAGE_KEY);
    if (!raw) return createInitialState(initialPassage);
    const parsed = JSON.parse(raw) as ExplorationSnapshot;
    if (!parsed || !parsed.rootStepId || !parsed.currentStepId || !parsed.steps?.[parsed.currentStepId]) {
      return createInitialState(initialPassage);
    }
    parsed.densityMode = readDensity();
    parsed.hypotheses = Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [];
    const cur = parsed.steps[parsed.currentStepId];
    if (cur?.anchor.passage && !samePassage(cur.anchor.passage, initialPassage)) {
      const fresh = createInitialState(initialPassage);
      fresh.pins = parsed.pins ?? { a: null, b: null };
      fresh.hypotheses = parsed.hypotheses;
      return fresh;
    }
    return parsed;
  } catch {
    return createInitialState(initialPassage);
  }
}

function saveSnapshot(snap: ExplorationSnapshot) {
  try {
    localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(snap));
  } catch { /* Quota or disabled storage does not block exploration. */ }
}

// === @section:logic:store ===
let state: ExplorationSnapshot = loadSnapshot(appState.getPassage());
let suppressNextPassageRecord = false;
const listeners = new Set<(snapshot: ExplorationSnapshot) => void>();
const restoreListeners = new Set<RestoreStepListener>();

function notify() {
  saveSnapshot(state);
  for (const listener of listeners) listener(state);
}

function pruneIfNeeded() {
  while (state.stepOrder.length > MAX_STEPS) {
    const candidateId = state.stepOrder.find(id =>
      id !== state.rootStepId &&
      id !== state.currentStepId &&
      (state.steps[id]?.childStepIds.length ?? 0) === 0
    );
    if (!candidateId) break;
    const victim = state.steps[candidateId];
    if (victim?.parentStepId && state.steps[victim.parentStepId]) {
      const parent = state.steps[victim.parentStepId]!;
      parent.childStepIds = parent.childStepIds.filter(cid => cid !== candidateId);
    }
    delete state.steps[candidateId];
    state.stepOrder = state.stepOrder.filter(id => id !== candidateId);
  }
}

function appendOrFocusStep(anchor: Anchor, edge: ConnectionEdge | null = null): ExplorationStep {
  const current = state.steps[state.currentStepId]!;
  if (current.anchor.canonicalKey === anchor.canonicalKey && !edge) {
    current.anchor = { ...current.anchor, ...anchor };
    notify();
    return current;
  }
  const existingChildId = current.childStepIds.find(cid => {
    const child = state.steps[cid];
    return child && child.anchor.canonicalKey === anchor.canonicalKey &&
      (child.traversedEdge?.id ?? null) === (edge?.id ?? null);
  });
  if (existingChildId) {
    state.currentStepId = existingChildId;
    notify();
    return state.steps[existingChildId]!;
  }
  const id = nextStepId();
  const nextStep: ExplorationStep = {
    id,
    parentStepId: current.id,
    childStepIds: [],
    anchor,
    traversedEdge: edge,
    readerMode: state.readerMode,
    selectedWord: anchor.wordId
      ? {
          id: anchor.wordId,
          position: anchor.position,
          original: anchor.original,
          transliteration: anchor.transliteration,
          english: anchor.english,
          strongs: anchor.strongs,
        }
      : null,
    createdAt: Date.now(),
  };
  current.childStepIds = [...current.childStepIds, id];
  state.steps[id] = nextStep;
  state.stepOrder.push(id);
  state.currentStepId = id;
  pruneIfNeeded();
  notify();
  return nextStep;
}

export const explorationState = {
  getSnapshot: (): ExplorationSnapshot => state,
  getCurrentStep: (): ExplorationStep => state.steps[state.currentStepId]!,
  getBreadcrumbs(): ExplorationStep[] {
    const chain: ExplorationStep[] = [];
    let cursor: ExplorationStep | undefined = state.steps[state.currentStepId];
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      chain.push(cursor);
      cursor = cursor.parentStepId ? state.steps[cursor.parentStepId] : undefined;
    }
    return chain.reverse();
  },
  getForkChildren(stepId = state.currentStepId): ExplorationStep[] {
    const step = state.steps[stepId];
    if (!step) return [];
    return step.childStepIds.map(cid => state.steps[cid]).filter((s): s is ExplorationStep => !!s);
  },
  findNearestForkAncestor(): ExplorationStep | null {
    let cursor = state.steps[state.currentStepId];
    if (cursor && cursor.childStepIds.length >= 2) return cursor;
    let parentId = cursor?.parentStepId ?? null;
    const guard = new Set<string>();
    while (parentId && !guard.has(parentId)) {
      guard.add(parentId);
      const step = state.steps[parentId];
      if (!step) break;
      if (step.childStepIds.length >= 2) return step;
      parentId = step.parentStepId;
    }
    return null;
  },
  recordPassage(passage: ActivePassage, label?: string, edge?: ConnectionEdge | null) {
    if (suppressNextPassageRecord) {
      suppressNextPassageRecord = false;
      return;
    }
    const current = state.steps[state.currentStepId];
    if (current && samePassage(current.anchor.passage, passage) && !edge) {
      return;
    }
    appendOrFocusStep(
      {
        kind: 'verse',
        canonicalKey: makePassageKey(passage),
        label: label || formatVerseRef(passage),
        passage: { ...passage },
      },
      edge ?? null
    );
  },
  recordWordFocus(
    passage: ActivePassage,
    word: WordSelectionSnapshot,
    explicit = true,
    edge: ConnectionEdge | null = null
  ) {
    const current = state.steps[state.currentStepId]!;
    if (!explicit) {
      if (samePassage(current.anchor.passage, passage) && !current.selectedWord) {
        current.selectedWord = { ...word };
        notify();
      }
      return;
    }
    const wordLabel = word.english?.replaceAll('/', ' ').trim() || word.transliteration || word.original || 'word';
    const canonicalKey = `occ:${passage.book}-${passage.chapter}-${passage.verse}:${word.position ?? word.id}:${word.strongs ?? word.id}`;
    if (
      samePassage(current.anchor.passage, passage) &&
      current.anchor.kind === 'verse' &&
      !current.selectedWord
    ) {
      current.selectedWord = { ...word };
      notify();
      return;
    }
    appendOrFocusStep(
      {
        kind: 'occurrence',
        canonicalKey,
        label: `${wordLabel} (${formatVerseRef(passage)})`,
        passage: { ...passage },
        wordId: word.id,
        position: word.position,
        strongs: word.strongs,
        original: word.original,
        transliteration: word.transliteration,
        english: word.english,
      },
      edge
    );
  },
  returnToStep(stepId: string) {
    const target = state.steps[stepId];
    if (!target) return;
    const passageChanged = !!(target.anchor.passage && !samePassage(appState.getPassage(), target.anchor.passage));
    state.currentStepId = target.id;
    state.readerMode = target.readerMode;
    notify();
    if (passageChanged && target.anchor.passage) {
      suppressNextPassageRecord = true;
      appState.setPassage(target.anchor.passage);
    }
    for (const listener of restoreListeners) listener(target, { passageChanged });
  },
  back() {
    const current = state.steps[state.currentStepId];
    if (current?.parentStepId) this.returnToStep(current.parentStepId);
  },
  forward(childStepId?: string) {
    const current = state.steps[state.currentStepId];
    const targetId = childStepId ?? current?.childStepIds[current.childStepIds.length - 1];
    if (targetId) this.returnToStep(targetId);
  },
  returnToFork() {
    const fork = this.findNearestForkAncestor();
    if (fork) this.returnToStep(fork.id);
    else this.returnToOrigin();
  },
  returnToOrigin() {
    this.returnToStep(state.rootStepId);
  },
  setReaderMode(mode: ReaderMode) {
    if (state.readerMode === mode) return;
    state.readerMode = mode;
    const current = state.steps[state.currentStepId];
    if (current) current.readerMode = mode;
    notify();
  },
  setDensityMode(mode: DensityMode) {
    if (state.densityMode === mode) return;
    state.densityMode = mode;
    writeDensity(mode);
    notify();
  },
  pinPassage(slot: 'a' | 'b', passage: ActivePassage, label?: string, wordPosition?: number) {
    state.pins = {
      ...state.pins,
      [slot]: { passage: { ...passage }, label: label || formatVerseRef(passage), wordPosition },
    };
    notify();
  },
  unpinPassage(slot: 'a' | 'b') {
    state.pins = { ...state.pins, [slot]: null };
    notify();
  },
  swapPins() {
    state.pins = { a: state.pins.b, b: state.pins.a };
    notify();
  },
  addHypothesis(h: Omit<UserHypothesis, 'id' | 'status' | 'createdAt'>): UserHypothesis {
    const created: UserHypothesis = {
      ...h,
      id: `hyp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'user_hypothesis',
      createdAt: Date.now(),
    };
    state.hypotheses = [created, ...state.hypotheses].slice(0, 60);
    notify();
    return created;
  },
  removeHypothesis(id: string) {
    const next = state.hypotheses.filter(h => h.id !== id);
    if (next.length === state.hypotheses.length) return;
    state.hypotheses = next;
    notify();
  },
  markHypothesisSaved(id: string, noteId: string) {
    state.hypotheses = state.hypotheses.map(h => (h.id === id ? { ...h, savedNoteId: noteId } : h));
    notify();
  },
  getHypotheses(): UserHypothesis[] {
    return state.hypotheses;
  },
  subscribe(listener: (snapshot: ExplorationSnapshot) => void) {
    listeners.add(listener);
    listener(state);
    return () => { listeners.delete(listener); };
  },
  onRestoreStep(listener: RestoreStepListener): () => void {
    restoreListeners.add(listener);
    return () => { restoreListeners.delete(listener); };
  },
};
