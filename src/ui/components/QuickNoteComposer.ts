// @file: src/ui/components/QuickNoteComposer.ts
// @feature: notes
// @tables: notes | note_anchors | note_connections
// @candidates: none
// @toc: imports | types | logic:helpers | logic:styles | ui:main

// === @section:imports ===
import type {
  AnchorPayload,
  ConnectionPayload,
  NoteSavePayload,
  NoteWriteError,
  TargetCandidate,
  TargetCandidateAnchor,
} from '../../api/notes-api-types';
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage } from '../../api/types';
import { explorationState, type Anchor } from '../exploration-state';
import { action, el } from '../study-dom';
import { BIBLE_BOOKS, BOOK_CHAPTERS, formatVerseRef, parseAnchorPassage } from '../utils';
import { generateClientKey, generateRequestId } from './NoteEditorModel';

// === @section:types ===
export type QuickNoteScope = 'occurrence' | 'verse' | 'word_form';

export interface QuickNoteTarget {
  passage: ActivePassage;
  verseId?: number | null;
  word?: {
    id: number;
    position?: number;
    original?: string;
    transliteration?: string;
    strongs?: string;
    english?: string;
  } | null;
  connectTo?: Anchor | null;
  initialText?: string;
}

export interface QuickNoteComposerCallbacks {
  onSaved?: () => void;
  onOpenFullEditor?: (target: QuickNoteTarget) => void;
  onOpenClaimComposer?: (target: QuickNoteTarget) => void;
}

export interface QuickNoteComposerHandle {
  element: HTMLElement;
  open: (target: QuickNoteTarget) => void;
  close: () => void;
}

interface ConnectPreset {
  chipLabel: string;
  anchor: Anchor;
}

// === @section:logic:helpers ===
const STYLE_ID = 'quick-note-composer-styles';
const HYPOTHESIS_NOTICE = 'User hypothesis — kept separate from indexed corpus evidence';

const BOOK_ALIASES: Record<string, number> = {
  gen: 1, ge: 1, gn: 1, exod: 2, exo: 2, ex: 2, lev: 3, le: 3, lv: 3,
  num: 4, nu: 4, nm: 4, nb: 4, deut: 5, deu: 5, dt: 5, josh: 6, jos: 6, jsh: 6,
  judg: 7, jdg: 7, jg: 7, jdgs: 7, ruth: 8, rth: 8, ru: 8,
  '1sam': 9, '1sa': 9, '1s': 9, '2sam': 10, '2sa': 10, '2s': 10,
  '1kgs': 11, '1ki': 11, '1k': 11, '2kgs': 12, '2ki': 12, '2k': 12,
  '1chr': 13, '1ch': 13, '2chr': 14, '2ch': 14, ezra: 15, ezr: 15, neh: 16, ne: 16,
  esth: 17, est: 17, es: 17, job: 18, jb: 18, ps: 19, psa: 19, psm: 19, pss: 19,
  prov: 20, pro: 20, prv: 20, pr: 20, eccl: 21, ecc: 21, ec: 21, qoh: 21,
  song: 22, sos: 22, sg: 22, isa: 23, is: 23, jer: 24, je: 24, jr: 24,
  lam: 25, la: 25, ezek: 26, eze: 26, ezk: 26, dan: 27, da: 27, dn: 27,
  hos: 28, ho: 28, joel: 29, joe: 29, jl: 29, amos: 30, amo: 30, am: 30,
  obad: 31, ob: 31, jonah: 32, jon: 32, jnh: 32, mic: 33, mi: 33,
  nah: 34, na: 34, hab: 35, hb: 35, zeph: 36, zep: 36, zp: 36,
  hag: 37, hg: 37, zech: 38, zec: 38, zc: 38, mal: 39, ml: 39,
  matt: 40, mat: 40, mt: 40, mark: 41, mrk: 41, mk: 41, luke: 42, luk: 42, lk: 42,
  john: 43, jhn: 43, jn: 43, acts: 44, act: 44, ac: 44, rom: 45, ro: 45, rm: 45,
  '1cor': 46, '1co': 46, '2cor': 47, '2co': 47, gal: 48, ga: 48, eph: 49, ep: 49,
  phil: 50, php: 50, pp: 50, col: 51, co: 51,
  '1thess': 52, '1thes': 52, '1th': 52, '2thess': 53, '2thes': 53, '2th': 53,
  '1tim': 54, '1ti': 54, '2tim': 55, '2ti': 55, titus: 56, tit: 56, ti: 56,
  phlm: 57, phm: 57, pm: 57, heb: 58, he: 58, jas: 59, jam: 59, jm: 59,
  '1pet': 60, '1pe': 60, '1pt': 60, '2pet': 61, '2pe': 61, '2pt': 61,
  '1john': 62, '1jn': 62, '1jo': 62, '2john': 63, '2jn': 63, '2jo': 63,
  '3john': 64, '3jn': 64, '3jo': 64, jude: 65, jud: 65, rev: 66, re: 66, rv: 66,
};

function passageKey(p: ActivePassage): string {
  return `verse:${p.book}-${p.chapter}-${p.verse}`;
}

function samePassage(a?: ActivePassage | null, b?: ActivePassage | null): boolean {
  return !!a && !!b && a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;
}

function isValidPassage(p: ActivePassage): boolean {
  if (!Number.isInteger(p.book) || p.book < 1 || p.book > 66) return false;
  const maxCh = BOOK_CHAPTERS[p.book - 1] ?? 150;
  if (!Number.isInteger(p.chapter) || p.chapter < 1 || p.chapter > maxCh) return false;
  const minV = p.book === 19 ? 0 : 1;
  return Number.isInteger(p.verse) && p.verse >= minV && p.verse <= 176;
}

function parseQuickVerseRef(raw: string): ActivePassage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const anchored = parseAnchorPassage(trimmed);
  if (anchored && isValidPassage(anchored)) return anchored;

  const ref = /^([1-3]?\s*[a-zA-Z.]+(?:\s+(?:of\s+)?[a-zA-Z.]+)*)\s+(\d{1,3})[:.\s]+(\d{1,3})$/.exec(trimmed);
  if (!ref) return null;

  const rawBook = ref[1]!.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const compactBook = rawBook.replace(/\s+/g, '');
  let bookNum = BOOK_ALIASES[compactBook] ?? 0;

  if (!bookNum) {
    const idx = BIBLE_BOOKS.findIndex(b => {
      const lower = b.toLowerCase();
      return lower === rawBook || lower.replace(/\s+/g, '') === compactBook ||
        (rawBook.length >= 2 && lower.startsWith(rawBook)) ||
        (compactBook.length >= 2 && lower.replace(/\s+/g, '').startsWith(compactBook));
    });
    if (idx >= 0) bookNum = idx + 1;
  }

  if (!bookNum) return null;
  const parsed = { book: bookNum, chapter: Number(ref[2]), verse: Number(ref[3]) };
  return isValidPassage(parsed) ? parsed : null;
}

function passageToAnchor(p: ActivePassage, label?: string): Anchor {
  return {
    kind: 'verse',
    canonicalKey: passageKey(p),
    label: label || formatVerseRef(p),
    passage: { ...p },
  };
}

function formatWordSummary(word: NonNullable<QuickNoteTarget['word']>): string {
  const parts = [word.original, word.transliteration, word.strongs, word.english?.replaceAll('/', ' ')]
    .filter((v): v is string => !!v && v.trim().length > 0);
  return parts.join(' · ');
}

function targetToSessionAnchor(target: QuickNoteTarget, scope: QuickNoteScope): Anchor {
  const verseLabel = formatVerseRef(target.passage);
  if (scope === 'occurrence' && target.word) {
    const wordLbl = target.word.english?.replaceAll('/', ' ').trim() ||
      target.word.transliteration || target.word.original || 'word';
    return {
      kind: 'occurrence',
      canonicalKey: `occ:${target.passage.book}-${target.passage.chapter}-${target.passage.verse}:${target.word.position ?? target.word.id}:${target.word.strongs ?? target.word.id}`,
      label: `${wordLbl} (${verseLabel})`,
      passage: { ...target.passage },
      wordId: target.word.id,
      position: target.word.position,
      strongs: target.word.strongs,
      original: target.word.original,
      transliteration: target.word.transliteration,
      english: target.word.english,
    };
  }
  if (scope === 'word_form' && target.word) {
    return {
      kind: 'lemma',
      canonicalKey: `form:${target.word.strongs ?? target.word.id}`,
      label: formatWordSummary(target.word) || verseLabel,
      passage: { ...target.passage },
      wordId: target.word.id,
      strongs: target.word.strongs,
      original: target.word.original,
      transliteration: target.word.transliteration,
      english: target.word.english,
    };
  }
  return passageToAnchor(target.passage, verseLabel);
}

function candidateToAnchor(cand: TargetCandidate): Anchor {
  const parsed = parseQuickVerseRef(cand.label);
  const kind = cand.kind === 'word_occurrence' ? 'occurrence'
    : cand.kind === 'lemma' ? 'lemma'
      : cand.kind === 'concept' ? 'concept'
        : 'verse';
  return {
    kind,
    canonicalKey: `${kind}:${String(cand.id)}`,
    label: cand.label,
    ...(parsed ? { passage: parsed } : {}),
    ...(cand.anchor.word_id ? { wordId: cand.anchor.word_id } : {}),
    ...(cand.anchor.word_position ? { position: cand.anchor.word_position } : {}),
  };
}

function buildConnectPresets(currentPassage: ActivePassage): ConnectPreset[] {
  const snap = explorationState.getSnapshot();
  const presets: ConnectPreset[] = [];
  const seenKeys = new Set<string>([passageKey(currentPassage)]);

  const addPreset = (chipLabel: string, anchor: Anchor) => {
    if (!anchor.canonicalKey || seenKeys.has(anchor.canonicalKey)) return;
    if (anchor.passage && samePassage(anchor.passage, currentPassage) && anchor.kind === 'verse') return;
    seenKeys.add(anchor.canonicalKey);
    presets.push({ chipLabel, anchor });
  };

  if (snap.pins.a) {
    addPreset(`Pin A: ${snap.pins.a.label}`, passageToAnchor(snap.pins.a.passage, snap.pins.a.label));
  }
  if (snap.pins.b) {
    addPreset(`Pin B: ${snap.pins.b.label}`, passageToAnchor(snap.pins.b.passage, snap.pins.b.label));
  }

  const trailSteps = [...explorationState.getBreadcrumbs()].reverse();
  for (const step of trailSteps) {
    if (presets.length >= 6) break;
    addPreset(step.anchor.label, step.anchor);
  }
  return presets;
}

async function resolveVerseIdByRef(refQuery: string): Promise<{ verseId: number | null; error: string | null }> {
  const res = await BibleRPC.notes.searchTargets(refQuery, ['verse']);
  if (res.error) return { verseId: null, error: res.error };
  const candidates = res.data?.groups.flatMap(g => g.candidates) ?? [];
  const verseCand = candidates.find(c => c.anchor.kind === 'verse' && typeof c.anchor.verse_id === 'number' && c.anchor.verse_id > 0);
  if (verseCand?.anchor.verse_id) return { verseId: verseCand.anchor.verse_id, error: null };
  return { verseId: null, error: `Could not resolve passage "${refQuery}" to a database verse ID.` };
}

function candidateAnchorToPayload(
  cand: TargetCandidateAnchor,
  clientKey: string,
  role: 'subject' | 'object'
): AnchorPayload | null {
  if (cand.kind === 'verse' && cand.verse_id) {
    return { client_key: clientKey, kind: 'verse', verse_id: cand.verse_id, role, label: cand.label ?? null };
  }
  if (cand.kind === 'word_occurrence' && cand.verse_id && cand.word_position && cand.word_id) {
    return {
      client_key: clientKey, kind: 'word_occurrence',
      verse_id: cand.verse_id, word_position: cand.word_position, word_id: cand.word_id,
      role, label: cand.label ?? null,
    };
  }
  if (cand.kind === 'word_form' && cand.word_id) {
    return { client_key: clientKey, kind: 'word_form', word_id: cand.word_id, role, label: cand.label ?? null };
  }
  if (cand.kind === 'lemma' && cand.lemma_id) {
    return { client_key: clientKey, kind: 'lemma', lemma_id: cand.lemma_id, role, label: cand.label ?? null };
  }
  if (cand.kind === 'concept' && cand.concept_id) {
    return { client_key: clientKey, kind: 'concept', concept_id: cand.concept_id, role, label: cand.label ?? null };
  }
  if (cand.kind === 'place' && cand.place_id) {
    return { client_key: clientKey, kind: 'place', place_id: cand.place_id, role, label: cand.label ?? null };
  }
  if (cand.kind === 'event' && cand.event_id) {
    return { client_key: clientKey, kind: 'event', event_id: cand.event_id, role, label: cand.label ?? null };
  }
  if (cand.kind === 'note' && cand.target_note_id) {
    return { client_key: clientKey, kind: 'note', target_note_id: cand.target_note_id, role, label: cand.label ?? null };
  }
  return null;
}

function formatWriteError(err?: NoteWriteError | null): string {
  if (!err) return 'Could not save note. Your draft is preserved.';
  if (err.code === 'auth_required' || err.code === 'forbidden') {
    return `${err.message} You can still save this as a local hypothesis without signing in.`;
  }
  if (err.code === 'writes_disabled' || err.code === 'not_available_in_single_user_mode') {
    return `${err.message} Use "Save local hypothesis" to keep it in your session trail.`;
  }
  return err.message || 'Could not save note. Your draft is preserved.';
}

// === @section:logic:styles ===
function ensureQuickNoteStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.quick-note-composer { position:fixed; right:20px; bottom:20px; z-index:95; width:min(440px, calc(100vw - 24px)); max-height:calc(100vh - 40px); overflow-y:auto; background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:10px; box-shadow:0 16px 48px rgba(0,0,0,.24); padding:16px 18px; display:flex; flex-direction:column; gap:12px; }
.quick-note-composer[hidden] { display:none; }
.qnc-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; border-bottom:1px solid var(--border); padding-bottom:10px; }
.qnc-head-title { display:flex; flex-direction:column; gap:2px; min-width:0; }
.qnc-eyebrow { margin:0; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--gold); }
.qnc-verse-ref { margin:0; font:600 17px/1.3 Georgia,serif; }
.qnc-word-summary { margin:2px 0 0; font-size:12px; color:var(--muted); overflow-wrap:anywhere; }
.qnc-close-btn { border:1px solid var(--border); background:var(--background); color:var(--text); border-radius:6px; width:28px; height:28px; line-height:1; flex-shrink:0; }
.qnc-scope-group { display:flex; flex-wrap:wrap; gap:6px; }
.qnc-scope-btn { border:1px solid var(--border); background:var(--background); color:var(--text); border-radius:999px; padding:4px 10px; font-size:12px; }
.qnc-scope-btn.is-active { background:var(--accent); border-color:var(--green); font-weight:600; }
.qnc-connect-section { display:flex; flex-direction:column; gap:8px; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--background); }
.qnc-connect-row { display:flex; gap:6px; align-items:center; }
.qnc-connect-input { flex:1; min-width:0; padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--panel); color:var(--text); font-size:13px; }
.qnc-presets { display:flex; flex-wrap:wrap; gap:6px; }
.qnc-preset-chip { border:1px solid var(--border); background:var(--panel); color:var(--text); border-radius:999px; padding:3px 9px; font-size:11px; }
.qnc-preset-chip:hover { border-color:var(--gold); background:var(--soft); }
.qnc-hypothesis-box { display:flex; flex-direction:column; gap:5px; padding:8px 10px; border-left:3px solid var(--gold); background:var(--soft); border-radius:0 6px 6px 0; }
.qnc-hypothesis-box[hidden] { display:none; }
.qnc-hypothesis-row { display:flex; flex-wrap:wrap; align-items:center; gap:6px; justify-content:space-between; }
.qnc-hypothesis-badge { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; padding:2px 7px; border-radius:4px; background:var(--panel); border:1px solid var(--gold); color:var(--gold); }
.qnc-hypothesis-target { font-size:12px; font-weight:600; }
.qnc-hypothesis-note { margin:0; font-size:11px; color:var(--muted); }
.qnc-title-input { width:100%; box-sizing:border-box; padding:7px 10px; border:1px solid var(--border); border-radius:6px; background:var(--background); color:var(--text); font-size:13px; }
.qnc-body-input { width:100%; box-sizing:border-box; padding:9px 10px; border:1px solid var(--border); border-radius:6px; background:var(--background); color:var(--text); font:inherit; font-size:14px; line-height:1.5; resize:vertical; min-height:92px; }
.qnc-error { padding:8px 10px; border-radius:6px; border:1px solid var(--gold); background:var(--soft); color:var(--text); font-size:12px; }
.qnc-error[hidden] { display:none; }
.qnc-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
.qnc-actions-left, .qnc-actions-right { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.qnc-btn-sm { padding:6px 10px; font-size:12px; }
`;
  document.head.append(style);
}

// === @section:ui:main ===
export function createQuickNoteComposer(callbacks?: QuickNoteComposerCallbacks): QuickNoteComposerHandle {
  ensureQuickNoteStyles();

  const element = document.createElement('aside');
  element.className = 'quick-note-composer';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', 'Quick note and hypothesis');
  element.hidden = true;

  let currentTarget: QuickNoteTarget | null = null;
  let selectedScope: QuickNoteScope = 'verse';
  let connectedAnchor: Anchor | null = null;
  let resolvedConnectPayload: TargetCandidateAnchor | null = null;
  let initialBodyText = '';
  let isSaving = false;

  // Header
  const head = el('div', 'qnc-head');
  const headTitle = el('div', 'qnc-head-title');
  const eyebrow = el('p', 'qnc-eyebrow', 'Quick Note');
  const verseRefEl = el('h3', 'qnc-verse-ref');
  const wordSummaryEl = el('p', 'qnc-word-summary');
  wordSummaryEl.hidden = true;
  headTitle.append(eyebrow, verseRefEl, wordSummaryEl);

  const closeIconBtn = action('×', () => handleCancel(), 'qnc-close-btn');
  closeIconBtn.setAttribute('aria-label', 'Close quick note');
  head.append(headTitle, closeIconBtn);

  // Scope selector (word targets only)
  const scopeGroup = el('div', 'qnc-scope-group');
  scopeGroup.setAttribute('role', 'radiogroup');
  scopeGroup.setAttribute('aria-label', 'Note target scope');
  scopeGroup.hidden = true;

  // Connect-to section
  const connectSection = el('div', 'qnc-connect-section');
  const connectLabel = el('span', 'qnc-eyebrow', 'Connect to… (optional hypothesis)');
  const connectRow = el('div', 'qnc-connect-row');
  const connectInput = document.createElement('input');
  connectInput.type = 'text';
  connectInput.className = 'qnc-connect-input';
  connectInput.placeholder = 'Verse ref (e.g. Gen 3:19)';
  connectInput.setAttribute('aria-label', 'Connect to verse reference');
  const linkBtn = action('Link', () => void handleLinkInput(), 'study-button qnc-btn-sm');
  connectRow.append(connectInput, linkBtn);

  const presetsRow = el('div', 'qnc-presets');
  const hypothesisBox = el('div', 'qnc-hypothesis-box');
  hypothesisBox.hidden = true;
  const hypRow = el('div', 'qnc-hypothesis-row');
  const hypLeft = el('div', 'qnc-actions-left');
  const hypBadge = el('span', 'qnc-hypothesis-badge', 'my hypothesis');
  const hypTargetLabel = el('span', 'qnc-hypothesis-target');
  hypLeft.append(hypBadge, hypTargetLabel);
  const clearConnectBtn = action('Clear', () => {
    connectedAnchor = null;
    resolvedConnectPayload = null;
    connectInput.value = '';
    renderHypothesisBox();
    updateActionStates();
  }, 'text-action');
  hypRow.append(hypLeft, clearConnectBtn);
  const hypNotice = el('p', 'qnc-hypothesis-note', HYPOTHESIS_NOTICE);
  hypothesisBox.append(hypRow, hypNotice);

  connectSection.append(connectLabel, connectRow, presetsRow, hypothesisBox);

  // Prose-first fields
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'qnc-title-input';
  titleInput.placeholder = 'Optional title…';
  titleInput.maxLength = 200;
  titleInput.setAttribute('aria-label', 'Optional note title');

  const bodyInput = document.createElement('textarea');
  bodyInput.className = 'qnc-body-input';
  bodyInput.rows = 4;
  bodyInput.maxLength = 20000;
  bodyInput.placeholder = 'Write a quick note or hypothesis… (Ctrl+Enter to save)';
  bodyInput.setAttribute('aria-label', 'Quick note text');

  const errorBanner = el('div', 'qnc-error');
  errorBanner.setAttribute('role', 'alert');
  errorBanner.hidden = true;

  // Footer actions
  const actionsBar = el('div', 'qnc-actions');
  const actionsLeft = el('div', 'qnc-actions-left');
  const actionsRight = el('div', 'qnc-actions-right');

  const fullEditorBtn = action('Full editor…', () => {
    if (!currentTarget) return;
    const effectiveConnect = getEffectiveConnectAnchor();
    const handoff: QuickNoteTarget = {
      ...currentTarget,
      connectTo: effectiveConnect,
      initialText: bodyInput.value,
    };
    forceClose();
    callbacks?.onOpenFullEditor?.(handoff);
  }, 'text-action');

  const rgClaimBtn = action('Knowledge graph claim…', () => {
    if (!currentTarget) return;
    const effectiveConnect = getEffectiveConnectAnchor();
    const handoff: QuickNoteTarget = {
      ...currentTarget,
      connectTo: effectiveConnect,
      initialText: bodyInput.value,
    };
    forceClose();
    callbacks?.onOpenClaimComposer?.(handoff);
  }, 'text-action');

  const saveLocalBtn = action('Save local hypothesis', () => handleSaveLocalHypothesis(), 'study-button qnc-btn-sm');
  const cancelBtn = action('Cancel', () => handleCancel(), 'study-button qnc-btn-sm');
  const saveNoteBtn = action('Save note', () => void handleSaveNote(), 'study-button primary qnc-btn-sm');

  actionsLeft.append(fullEditorBtn, ...(callbacks?.onOpenClaimComposer ? [rgClaimBtn] : []), saveLocalBtn);
  actionsRight.append(cancelBtn, saveNoteBtn);
  actionsBar.append(actionsLeft, actionsRight);

  element.append(head, scopeGroup, connectSection, titleInput, bodyInput, errorBanner, actionsBar);

  function showError(msg: string | null): void {
    if (!msg) {
      errorBanner.hidden = true;
      errorBanner.textContent = '';
      return;
    }
    errorBanner.textContent = msg;
    errorBanner.hidden = false;
  }

  function getParsedInputAnchor(): Anchor | null {
    const parsed = parseQuickVerseRef(connectInput.value);
    if (!parsed) return null;
    return passageToAnchor(parsed);
  }

  function getEffectiveConnectAnchor(): Anchor | null {
    return connectedAnchor ?? getParsedInputAnchor();
  }

  function renderScopeSelector(): void {
    scopeGroup.replaceChildren();
    const word = currentTarget?.word;
    if (!word) {
      scopeGroup.hidden = true;
      return;
    }
    scopeGroup.hidden = false;
    const occLabel = word.position != null
      ? `This occurrence (Word #${word.position})`
      : 'This occurrence';

    const options: Array<[QuickNoteScope, string]> = [
      ['occurrence', occLabel],
      ['verse', 'Whole verse'],
      ['word_form', 'Word form'],
    ];
    for (const [scopeVal, label] of options) {
      const btn = el('button', `qnc-scope-btn${selectedScope === scopeVal ? ' is-active' : ''}`, label);
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(selectedScope === scopeVal));
      btn.addEventListener('click', () => {
        selectedScope = scopeVal;
        renderScopeSelector();
      });
      scopeGroup.append(btn);
    }
  }

  function renderConnectPresets(): void {
    presetsRow.replaceChildren();
    if (!currentTarget) return;
    const presets = buildConnectPresets(currentTarget.passage);
    for (const preset of presets) {
      const chip = action(preset.chipLabel, () => {
        connectedAnchor = preset.anchor;
        resolvedConnectPayload = null;
        connectInput.value = '';
        showError(null);
        renderHypothesisBox();
        updateActionStates();
      }, 'qnc-preset-chip');
      presetsRow.append(chip);
    }
  }

  function renderHypothesisBox(): void {
    const active = getEffectiveConnectAnchor();
    if (!active) {
      hypothesisBox.hidden = true;
      hypTargetLabel.textContent = '';
      clearConnectBtn.hidden = true;
      return;
    }
    hypothesisBox.hidden = false;
    hypTargetLabel.textContent = `→ ${active.label}`;
    clearConnectBtn.hidden = !connectedAnchor && !connectInput.value.trim();
  }

  function updateActionStates(): void {
    const hasConnect = !!getEffectiveConnectAnchor();
    const hasText = bodyInput.value.trim().length > 0;
    saveLocalBtn.disabled = isSaving || !(hasConnect || hasText);
    saveNoteBtn.disabled = isSaving;
    saveNoteBtn.textContent = isSaving ? 'Saving…' : 'Save note';
  }

  async function handleLinkInput(): Promise<void> {
    const raw = connectInput.value.trim();
    if (!raw) return;
    showError(null);

    const parsed = parseQuickVerseRef(raw);
    if (parsed) {
      connectedAnchor = passageToAnchor(parsed);
      resolvedConnectPayload = null;
      connectInput.value = '';
      renderHypothesisBox();
      updateActionStates();
      return;
    }

    linkBtn.disabled = true;
    try {
      const res = await BibleRPC.notes.searchTargets(raw, null);
      const firstCand = res.data?.groups.flatMap(g => g.candidates)[0];
      if (!firstCand) {
        showError(res.error || `No matching target found for "${raw}".`);
        return;
      }
      connectedAnchor = candidateToAnchor(firstCand);
      resolvedConnectPayload = firstCand.anchor;
      connectInput.value = '';
      renderHypothesisBox();
      updateActionStates();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not look up target.');
    } finally {
      linkBtn.disabled = false;
    }
  }

  async function resolvePrimaryAnchor(target: QuickNoteTarget): Promise<{ anchor: AnchorPayload | null; error: string | null }> {
    const key = generateClientKey('anc');
    const verseLabel = formatVerseRef(target.passage);
    const word = target.word;
    const wordLabel = word ? `${word.original || word.transliteration || 'word'}` : verseLabel;

    if (selectedScope === 'word_form' && word) {
      return {
        anchor: { client_key: key, kind: 'word_form', word_id: word.id, role: 'subject', label: wordLabel },
        error: null,
      };
    }

    let verseId = typeof target.verseId === 'number' && target.verseId > 0 ? target.verseId : null;
    if (!verseId) {
      const resolved = await resolveVerseIdByRef(verseLabel);
      if (!resolved.verseId) return { anchor: null, error: resolved.error };
      verseId = resolved.verseId;
    }

    if (selectedScope === 'occurrence' && word && word.position != null && word.position >= 1) {
      return {
        anchor: {
          client_key: key,
          kind: 'word_occurrence',
          verse_id: verseId,
          word_position: word.position,
          word_id: word.id,
          role: 'subject',
          label: wordLabel,
        },
        error: null,
      };
    }

    return {
      anchor: { client_key: key, kind: 'verse', verse_id: verseId, role: 'subject', label: verseLabel },
      error: null,
    };
  }

  async function resolveSecondaryAnchor(
    anchor: Anchor,
    preResolved: TargetCandidateAnchor | null
  ): Promise<{ anchor: AnchorPayload | null; error: string | null }> {
    const key = generateClientKey('anc');
    if (preResolved) {
      const mapped = candidateAnchorToPayload(preResolved, key, 'object');
      if (mapped) return { anchor: mapped, error: null };
    }

    if (anchor.passage) {
      const resolved = await resolveVerseIdByRef(formatVerseRef(anchor.passage));
      if (!resolved.verseId) return { anchor: null, error: resolved.error };
      if (anchor.kind === 'occurrence' && anchor.wordId && anchor.position && anchor.position >= 1) {
        return {
          anchor: {
            client_key: key,
            kind: 'word_occurrence',
            verse_id: resolved.verseId,
            word_position: anchor.position,
            word_id: anchor.wordId,
            role: 'object',
            label: anchor.label,
          },
          error: null,
        };
      }
      return {
        anchor: { client_key: key, kind: 'verse', verse_id: resolved.verseId, role: 'object', label: anchor.label },
        error: null,
      };
    }

    const res = await BibleRPC.notes.searchTargets(anchor.strongs || anchor.label, null);
    const cand = res.data?.groups.flatMap(g => g.candidates)[0];
    if (cand) {
      const mapped = candidateAnchorToPayload(cand.anchor, key, 'object');
      if (mapped) return { anchor: mapped, error: null };
    }
    return { anchor: null, error: res.error || `Could not resolve connection target "${anchor.label}".` };
  }

  async function handleSaveNote(): Promise<void> {
    if (isSaving || !currentTarget) return;
    const body = bodyInput.value;
    if (!body.trim()) {
      showError('Please enter note text before saving.');
      bodyInput.focus();
      return;
    }

    showError(null);
    isSaving = true;
    updateActionStates();

    try {
      const primaryRes = await resolvePrimaryAnchor(currentTarget);
      if (!primaryRes.anchor) {
        showError(primaryRes.error || 'Could not resolve verse anchor.');
        return;
      }

      const anchors: AnchorPayload[] = [primaryRes.anchor];
      const connections: ConnectionPayload[] = [];
      const effectiveConnect = getEffectiveConnectAnchor();

      if (effectiveConnect) {
        const secRes = await resolveSecondaryAnchor(effectiveConnect, connectedAnchor ? resolvedConnectPayload : null);
        if (!secRes.anchor) {
          showError(secRes.error || 'Could not resolve connected target.');
          return;
        }
        anchors.push(secRes.anchor);
        connections.push({
          from: primaryRes.anchor.client_key,
          to: secRes.anchor.client_key,
          connection_type: 'related',
          custom_label: 'my hypothesis',
          direction: 'directed',
          explanation: HYPOTHESIS_NOTICE,
        });
      }

      const payload: NoteSavePayload = {
        client_request_id: generateRequestId(),
        title: titleInput.value.trim() || null,
        body_md: body,
        note_kind: effectiveConnect ? 'cross_reference' : 'observation',
        language: 'en',
        confidence: 1.0,
        source_context: effectiveConnect
          ? { quick_composer: true, epistemic_status: 'user_hypothesis', connect_to: effectiveConnect.canonicalKey }
          : { quick_composer: true },
        anchors,
        connections,
      };

      const res = await BibleRPC.notes.save(payload);
      if (!res.ok) {
        showError(formatWriteError(res.error));
        return;
      }

      if (effectiveConnect && res.note) {
        const fromAnchor = targetToSessionAnchor(currentTarget, selectedScope);
        const hyp = explorationState.addHypothesis({
          from: fromAnchor,
          to: effectiveConnect,
          note: body.trim(),
          linkedRefs: [formatVerseRef(currentTarget.passage), effectiveConnect.label],
        });
        explorationState.markHypothesisSaved(hyp.id, res.note.id);
      }

      forceClose();
      callbacks?.onSaved?.();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Network error saving note. Your draft is preserved.');
    } finally {
      isSaving = false;
      updateActionStates();
    }
  }

  function handleSaveLocalHypothesis(): void {
    if (!currentTarget) return;
    const effectiveConnect = getEffectiveConnectAnchor();
    const trimmedBody = bodyInput.value.trim();
    const trimmedTitle = titleInput.value.trim();
    if (!effectiveConnect && !trimmedBody) return;

    const fromAnchor = targetToSessionAnchor(currentTarget, selectedScope);
    const toAnchor = effectiveConnect ?? passageToAnchor(currentTarget.passage);
    const linkedRefs = Array.from(new Set([
      formatVerseRef(currentTarget.passage),
      ...(effectiveConnect ? [effectiveConnect.label] : []),
    ]));

    explorationState.addHypothesis({
      from: fromAnchor,
      to: toAnchor,
      note: trimmedBody || trimmedTitle || `Hypothesis: ${fromAnchor.label} → ${toAnchor.label}`,
      linkedRefs,
    });

    forceClose();
  }

  function hasUnsavedBodyEdits(): boolean {
    return bodyInput.value.trim().length > 0 && bodyInput.value !== initialBodyText;
  }

  function forceClose(): void {
    element.hidden = true;
    showError(null);
    isSaving = false;
  }

  function handleCancel(): void {
    if (hasUnsavedBodyEdits() && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('Discard unsaved note text?')) return;
    }
    forceClose();
  }

  // Event wiring
  connectInput.addEventListener('input', () => {
    if (connectedAnchor && connectInput.value.trim()) {
      connectedAnchor = null;
      resolvedConnectPayload = null;
    }
    renderHypothesisBox();
    updateActionStates();
  });

  connectInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleLinkInput();
    }
  });

  bodyInput.addEventListener('input', () => {
    showError(null);
    updateActionStates();
  });

  bodyInput.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSaveNote();
    }
  });

  element.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  });

  function open(target: QuickNoteTarget): void {
    currentTarget = target;
    selectedScope = target.word ? 'occurrence' : 'verse';
    connectedAnchor = target.connectTo ?? null;
    resolvedConnectPayload = null;

    titleInput.value = '';
    bodyInput.value = target.initialText ?? '';
    initialBodyText = bodyInput.value;
    connectInput.value = '';
    isSaving = false;
    showError(null);

    verseRefEl.textContent = formatVerseRef(target.passage);
    if (target.word) {
      const summary = formatWordSummary(target.word);
      wordSummaryEl.textContent = summary;
      wordSummaryEl.hidden = !summary;
    } else {
      wordSummaryEl.textContent = '';
      wordSummaryEl.hidden = true;
    }

    renderScopeSelector();
    renderConnectPresets();
    renderHypothesisBox();
    updateActionStates();

    element.hidden = false;
    bodyInput.focus();
  }

  return { element, open, close: handleCancel };
}
