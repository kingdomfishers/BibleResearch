// @file: src/ui/components/PassageComparison.ts
// @feature: verse-reader
// @tables: reader_english_verses | words | verses
// @candidates: none
// @toc: imports | types | logic:helpers | logic:styles | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import {
  comparePatternsRpc,
  discoverBiblicalConnectionsRpc,
  triTextualDiffV3Rpc,
  wordplayScanV3Rpc,
  type TriTextualDiffV3Result,
  type WordplayScanV3Result,
} from '../../api/r10-rpc';
import type { ActivePassage, ReaderPassage, VerseWordToken } from '../../api/types';
import type { DiscoverConnectionsResult, R10ConnectionSummary } from '../../relationships/r10-types';
import { explorationState } from '../exploration-state';
import { appState } from '../state';
import { action, el, heading, status } from '../study-dom';
import { BIBLE_BOOKS, BOOK_CHAPTERS, formatVerseRef, parseAnchorPassage } from '../utils';
import type { ContextPreview } from './ContextPreview';

// === @section:types ===
export interface PassageComparisonOptions {
  preview?: ContextPreview;
  onAddNote?: (a: ActivePassage, b: ActivePassage) => void;
  onOpenPatternBoard?: (passages: ActivePassage[]) => void;
}

type PaneSlot = 'a' | 'b' | 'c';
type PaneScope = 'verse' | 'context' | 'chapter';

interface PaneState {
  slot: PaneSlot;
  passage: ActivePassage;
  scope: PaneScope;
  loading: boolean;
  english: string;
  words: VerseWordToken[];
  contextLoading: boolean;
  contextBefore: ReaderPassage[];
  contextAfter: ReaderPassage[];
  chapterItems: ReaderPassage[];
}

interface BridgeState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  query: string;
  result: DiscoverConnectionsResult | null;
  patternCompare?: Record<string, unknown> | null;
  error: string | null;
}

interface TriDiffState {
  open: boolean;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  result: TriTextualDiffV3Result | null;
  error: string | null;
}

interface WordplayScanState {
  open: boolean;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  items: Array<{ ref: string; data: WordplayScanV3Result }>;
  error: string | null;
}

interface LemmaMeta {
  strongs: string;
  original: string;
  transliteration: string;
  gloss: string;
}

// === @section:logic:helpers ===
const FUNCTION_WORD_STRONGS = new Set(['H853', 'G3588', 'G2532', 'G1161', 'G1722']);
const STRONGS_RE = /^[HG]\d+[A-Z]?$/i;
const STYLE_ID = 'passage-comparison-styles';

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

function parseQuickPassage(raw: string): ActivePassage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const anchored = parseAnchorPassage(trimmed);
  if (anchored && isValidPassage(anchored)) return anchored;

  const numeric = /^(\d{1,2})\s*[/:\s]\s*(\d{1,3})\s*[/:\s]\s*(\d{1,3})$/.exec(trimmed);
  if (numeric) {
    const p = { book: Number(numeric[1]), chapter: Number(numeric[2]), verse: Number(numeric[3]) };
    return isValidPassage(p) ? p : null;
  }

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

function normalizeStrongs(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s || !STRONGS_RE.test(s)) return null;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function isFunctionWordStrongs(strongs: string): boolean {
  if (FUNCTION_WORD_STRONGS.has(strongs)) return true;
  const canonical = strongs.replace(/^([HG])0+(\d)/, '$1$2');
  return FUNCTION_WORD_STRONGS.has(canonical);
}

function scopeLabel(scope: PaneScope): string {
  if (scope === 'context') return '±2';
  if (scope === 'chapter') return 'Chapter';
  return 'Verse';
}

function createPaneState(slot: PaneSlot, passage: ActivePassage): PaneState {
  return {
    slot,
    passage: { ...passage },
    scope: 'verse',
    loading: true,
    english: 'Loading verse…',
    words: [],
    contextLoading: false,
    contextBefore: [],
    contextAfter: [],
    chapterItems: [],
  };
}

function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// === @section:logic:styles ===
function ensureComparisonStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.comparison-header { display:flex; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:12px 18px; }
.comparison-header-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.comparison-c-form { display:inline-flex; flex-wrap:wrap; align-items:center; gap:6px; }
.comparison-c-input { width:155px; min-height:34px; padding:5px 9px; border:1px solid var(--border); border-radius:6px; background:var(--background); color:var(--text); font-size:13px; }
.comparison-c-status { margin:4px 0 0; font-size:12px; color:var(--gold); }
.comparison-summary { margin-top:16px; padding:14px 16px; border:1px solid var(--border); border-radius:8px; background:var(--background); display:flex; flex-direction:column; gap:10px; }
.comparison-summary__row { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; font-size:13px; }
.comparison-summary__label { font-size:10px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--gold); min-width:96px; }
.comparison-toggle { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); margin-left:auto; cursor:pointer; }
.comparison-pills { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.comparison-pill { border:1px solid var(--border); border-radius:999px; padding:4px 10px; font-size:12px; background:var(--panel); color:var(--text); line-height:1.35; }
.comparison-notice { padding:9px 12px; border-left:3px solid var(--gold); background:var(--soft); border-radius:0 6px 6px 0; font-size:13px; }
.comparison-bridge-results { display:flex; flex-direction:column; gap:8px; margin-top:4px; }
.comparison-bridge-item { padding:10px 12px; border:1px solid var(--border); border-radius:6px; background:var(--panel); font-size:13px; }
.comparison-bridge-meta { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:4px; font-size:11px; color:var(--muted); }
.comparison-bridge-badge { font-size:10px; text-transform:uppercase; padding:2px 6px; border-radius:4px; background:var(--soft); color:var(--gold); }
.comparison-bridge-refs { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.comparison-columns--three { grid-template-columns:repeat(3,minmax(0,1fr)); }
.comparison-passage { display:flex; flex-direction:column; gap:10px; padding:16px; border:1px solid var(--border); border-radius:8px; background:var(--background); min-width:0; }
.comparison-pane-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
.comparison-pane-title { display:flex; align-items:center; gap:8px; min-width:0; }
.comparison-pane-title h3 { margin:0; font:normal 20px/1.25 Georgia,serif; }
.comparison-slot-badge { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:50%; background:var(--accent); border:1px solid var(--green); color:var(--text); font-size:12px; font-weight:700; flex-shrink:0; }
.comparison-pane-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
.comparison-context-list { display:flex; flex-direction:column; gap:4px; padding:8px; border:1px solid var(--border); border-radius:6px; background:var(--panel); max-height:240px; overflow:auto; }
.comparison-interlinear { display:flex; flex-wrap:wrap; gap:8px; padding:10px; border:1px solid var(--border); border-radius:6px; background:var(--panel); }
.comparison-token { display:inline-flex; flex-direction:column; align-items:center; text-align:center; gap:3px; padding:7px 9px; border:1px solid var(--border); border-radius:6px; background:var(--background); color:var(--text); min-width:68px; }
.comparison-token:hover { border-color:var(--gold); }
.comparison-token__original { font:22px/1.4 'Times New Roman',serif; }
.comparison-token__translit { font:11px/1.3 Georgia,serif; color:var(--gold); direction:ltr; }
.comparison-token__gloss { font-size:11px; line-height:1.3; color:var(--muted); direction:ltr; overflow-wrap:anywhere; }
.comparison-correspondence { min-height:18px; margin:2px 0 0; }
.cmp-match-0 { background:rgba(131,99,44,.16); border-color:rgba(131,99,44,.65); }
.cmp-match-1 { background:rgba(51,109,88,.18); border-color:rgba(51,109,88,.68); }
.cmp-match-2 { background:rgba(66,114,168,.16); border-color:rgba(66,114,168,.65); }
.cmp-match-3 { background:rgba(148,82,130,.16); border-color:rgba(148,82,130,.65); }
.cmp-match-4 { background:rgba(168,104,50,.16); border-color:rgba(168,104,50,.65); }
.cmp-match-5 { background:rgba(58,136,136,.16); border-color:rgba(58,136,136,.65); }
.cmp-match-6 { background:rgba(116,132,54,.16); border-color:rgba(116,132,54,.65); }
.cmp-match-7 { background:rgba(156,74,84,.16); border-color:rgba(156,74,84,.65); }
.comparison-token.is-focused, .comparison-pill.is-focused { outline:2px solid var(--gold); outline-offset:1px; box-shadow:0 0 0 3px rgba(213,184,124,.22); border-color:var(--gold); }
.comparison-v3-bar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding-top:6px; border-top:1px solid var(--border); }
.comparison-v3-panel { margin-top:6px; padding:12px 14px; border:1px solid var(--border); border-radius:6px; background:var(--panel); display:flex; flex-direction:column; gap:8px; font-size:13px; }
.comparison-v3-panel-head { display:flex; flex-wrap:wrap; align-items:center; gap:8px; justify-content:space-between; }
.comparison-tri-tokens { display:flex; flex-wrap:wrap; gap:6px; padding:8px; border:1px solid var(--border); border-radius:6px; background:var(--background); }
.comparison-tri-token { display:inline-flex; flex-direction:column; gap:2px; padding:5px 8px; border:1px solid var(--border); border-radius:5px; font-size:12px; background:var(--panel); }
.comparison-tri-token.is-agrees_both { border-color:rgba(51,109,88,.7); background:rgba(51,109,88,.12); }
.comparison-tri-token.is-agrees_lxx_against_mt { border-color:rgba(66,114,168,.75); background:rgba(66,114,168,.14); }
.comparison-tri-token.is-agrees_mt_against_lxx { border-color:rgba(168,104,50,.75); background:rgba(168,104,50,.14); }
.comparison-tri-token.is-composite_splice { border-color:rgba(148,82,130,.75); background:rgba(148,82,130,.14); }
.comparison-tri-token__surf { font:16px/1.3 'Times New Roman',serif; }
.comparison-tri-token__tag { font-size:10px; color:var(--muted); text-transform:uppercase; }
.comparison-v3-list { display:flex; flex-direction:column; gap:6px; }
@media(max-width:1100px) { .comparison-columns--three { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:800px) { .comparison-columns--three { grid-template-columns:1fr; } .comparison-toggle { margin-left:0; } }
`;
  document.head.append(style);
}

// === @section:ui:main ===
export function createPassageComparison(
  navigate: (p: ActivePassage) => void,
  opts?: PassageComparisonOptions
) {
  ensureComparisonStyles();

  const element = el('section', 'passage-comparison');
  element.hidden = true;
  element.setAttribute('aria-label', 'Compare passages');

  let generation = 0;
  let bridgeGeneration = 0;
  let triGeneration = 0;
  let wordplayGeneration = 0;
  const paneGenerations: Record<PaneSlot, number> = { a: 0, b: 0, c: 0 };
  const scopeGenerations: Record<PaneSlot, number> = { a: 0, b: 0, c: 0 };

  let opener: HTMLElement | null = null;
  let panes: { a: PaneState; b: PaneState; c: PaneState | null } = {
    a: createPaneState('a', { book: 1, chapter: 1, verse: 1 }),
    b: createPaneState('b', { book: 43, chapter: 1, verse: 1 }),
    c: null,
  };
  let hiddenC: ActivePassage | null = null;
  let cInputError = '';
  let showFunctionWords = false;
  let focusedStrongs: string | null = null;
  let focusedTranslit = '';
  let focusedUnverifiedSlot: PaneSlot | null = null;
  let bridgeState: BridgeState = { status: 'idle', query: '', result: null, error: null };
  let triDiffState: TriDiffState = { open: false, status: 'idle', result: null, error: null };
  let wordplayState: WordplayScanState = { open: false, status: 'idle', items: [], error: null };
  let copyResetTimer = 0;

  function resetV3Panels() {
    triGeneration++;
    wordplayGeneration++;
    triDiffState = { open: false, status: 'idle', result: null, error: null };
    wordplayState = { open: false, status: 'idle', items: [], error: null };
  }

  const summaryMount = el('div', 'comparison-summary-mount');
  const columnsMount = el('div', 'comparison-columns');
  const cStatusLine = el('p', 'comparison-c-status');
  cStatusLine.setAttribute('role', 'status');
  cStatusLine.hidden = true;

  let tokenRefs: Array<{ slot: PaneSlot; strongs: string | null; btn: HTMLButtonElement }> = [];
  let pillRefs: Array<{ strongs: string; btn: HTMLButtonElement }> = [];
  let correspondenceRefs: Partial<Record<PaneSlot, HTMLElement>> = {};

  function getActivePanes(): PaneState[] {
    return panes.c ? [panes.a, panes.b, panes.c] : [panes.a, panes.b];
  }

  function isCrossLanguage(active = getActivePanes()): boolean {
    const hasOT = active.some(p => p.passage.book <= 39);
    const hasNT = active.some(p => p.passage.book > 39);
    return hasOT && hasNT;
  }

  function computeLexicalAnalysis(active = getActivePanes()) {
    const crossLang = isCrossLanguage(active);
    const lemmaPanes = new Map<string, Set<PaneSlot>>();
    const lemmaMeta = new Map<string, LemmaMeta>();

    for (const pane of active) {
      for (const word of pane.words) {
        const strongs = normalizeStrongs(word.strongs_nr);
        if (!strongs) continue;
        if (!showFunctionWords && isFunctionWordStrongs(strongs)) continue;
        if (!lemmaPanes.has(strongs)) lemmaPanes.set(strongs, new Set());
        lemmaPanes.get(strongs)!.add(pane.slot);
        if (!lemmaMeta.has(strongs)) {
          lemmaMeta.set(strongs, {
            strongs,
            original: word.original_word,
            transliteration: word.transliteration,
            gloss: word.primary_english || '—',
          });
        }
      }
    }

    const sharedOrder: string[] = [];
    const seenShared = new Set<string>();
    if (!crossLang) {
      for (const pane of active) {
        for (const word of pane.words) {
          const strongs = normalizeStrongs(word.strongs_nr);
          if (!strongs || seenShared.has(strongs)) continue;
          if ((lemmaPanes.get(strongs)?.size ?? 0) >= 2) {
            seenShared.add(strongs);
            sharedOrder.push(strongs);
          }
        }
      }
    }

    const paletteMap = new Map<string, number>();
    sharedOrder.forEach((strongs, idx) => paletteMap.set(strongs, idx % 8));

    const uniqueContentCounts: Record<PaneSlot, number> = { a: 0, b: 0, c: 0 };
    for (const pane of active) {
      const distinct = new Set<string>();
      for (const word of pane.words) {
        const strongs = normalizeStrongs(word.strongs_nr);
        if (!strongs || isFunctionWordStrongs(strongs) || seenShared.has(strongs)) continue;
        distinct.add(strongs);
      }
      uniqueContentCounts[pane.slot] = distinct.size;
    }

    return { crossLang, sharedOrder, lemmaMeta, paletteMap, uniqueContentCounts };
  }

  function paneHasStrongs(pane: PaneState, strongs: string): boolean {
    return pane.words.some(w => normalizeStrongs(w.strongs_nr) === strongs);
  }

  function findTranslit(strongs: string): string {
    for (const pane of getActivePanes()) {
      const match = pane.words.find(w => normalizeStrongs(w.strongs_nr) === strongs);
      if (match?.transliteration) return match.transliteration;
    }
    return strongs;
  }

  function formatCorrespondenceMessage(pane: PaneState, active: PaneState[], crossLang: boolean): string {
    if (focusedUnverifiedSlot === pane.slot && !focusedStrongs) {
      return 'This token has no verified Strong’s number for lexical comparison.';
    }
    const targetStrongs = focusedStrongs;
    if (!targetStrongs) {
      return 'Click or focus a word token to check verified Strong’s correspondence.';
    }

    const inThisPane = paneHasStrongs(pane, targetStrongs);
    const translit = focusedTranslit || findTranslit(targetStrongs);
    const others = active.filter(p => p.slot !== pane.slot);
    const matchingOthers = others.filter(p => paneHasStrongs(p, targetStrongs));

    if (!inThisPane) {
      if (crossLang) {
        return `Focused ${targetStrongs} (${translit}) is in a different original-language corpus.`;
      }
      return `Focused ${targetStrongs} (${translit}) does not appear in pane ${pane.slot.toUpperCase()}.`;
    }

    if (active.length === 2) {
      if (matchingOthers.length === 1) {
        return `Verified Strong's group ${targetStrongs} (${translit}) appears in both panes`;
      }
      return crossLang
        ? 'No verified lexical correspondence in the other pane (cross-language OT ↔ NT)'
        : 'No verified lexical correspondence in the other pane';
    }

    if (matchingOthers.length === others.length) {
      return `Verified Strong's group ${targetStrongs} (${translit}) appears in all ${active.length} panes`;
    }
    if (matchingOthers.length >= 1) {
      const slots = [pane.slot, ...matchingOthers.map(p => p.slot)].map(s => s.toUpperCase()).sort();
      return `Verified Strong's group ${targetStrongs} (${translit}) appears in panes ${slots.join(' & ')}`;
    }
    return 'No verified lexical correspondence in the other panes';
  }

  function syncFocusInPlace() {
    const active = getActivePanes();
    const crossLang = isCrossLanguage(active);

    for (const ref of tokenRefs) {
      const match = !!focusedStrongs && ref.strongs === focusedStrongs;
      ref.btn.classList.toggle('is-focused', match);
      ref.btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    }

    for (const ref of pillRefs) {
      const match = !!focusedStrongs && ref.strongs === focusedStrongs;
      ref.btn.classList.toggle('is-focused', match);
      ref.btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    }

    for (const pane of active) {
      const line = correspondenceRefs[pane.slot];
      if (line) line.textContent = formatCorrespondenceMessage(pane, active, crossLang);
    }
  }

  function focusToken(slot: PaneSlot, strongs: string | null, transliteration: string) {
    if (!strongs) {
      focusedStrongs = null;
      focusedTranslit = '';
      focusedUnverifiedSlot = slot;
    } else {
      focusedStrongs = strongs;
      focusedTranslit = transliteration;
      focusedUnverifiedSlot = null;
    }
    syncFocusInPlace();
  }

  function togglePillFocus(strongs: string, transliteration: string) {
    focusedUnverifiedSlot = null;
    if (focusedStrongs === strongs) {
      focusedStrongs = null;
      focusedTranslit = '';
    } else {
      focusedStrongs = strongs;
      focusedTranslit = transliteration;
    }
    syncFocusInPlace();
  }

  async function loadPaneData(pane: PaneState) {
    const reqGen = generation;
    const paneReq = ++paneGenerations[pane.slot];
    pane.loading = true;
    pane.english = 'Loading verse…';
    pane.words = [];
    renderBody();

    const [english, words] = await Promise.all([
      BibleRPC.getReaderPassage(pane.passage),
      BibleRPC.getVerseWords(pane.passage.book, pane.passage.chapter, pane.passage.verse),
    ]);

    if (reqGen !== generation || paneReq !== paneGenerations[pane.slot] || element.hidden) return;
    pane.loading = false;
    pane.english = english.data?.text ?? english.error ?? 'English text unavailable in this edition.';
    pane.words = words.data ?? [];
    renderBody();
  }

  async function loadPaneScope(pane: PaneState) {
    const reqGen = generation;
    const scopeReq = ++scopeGenerations[pane.slot];
    const p = pane.passage;

    if (pane.scope === 'verse') {
      pane.contextLoading = false;
      renderBody();
      return;
    }

    pane.contextLoading = true;
    pane.contextBefore = [];
    pane.contextAfter = [];
    pane.chapterItems = [];
    renderBody();

    const minV = p.book === 19 ? 0 : 1;

    if (pane.scope === 'context') {
      const beforeRefs: ActivePassage[] = [];
      for (let v = Math.max(minV, p.verse - 2); v < p.verse; v += 1) {
        beforeRefs.push({ book: p.book, chapter: p.chapter, verse: v });
      }
      const afterRefs: ActivePassage[] = [
        { book: p.book, chapter: p.chapter, verse: p.verse + 1 },
        { book: p.book, chapter: p.chapter, verse: p.verse + 2 },
      ];
      const [beforeItems, afterItems] = await Promise.all([
        beforeRefs.length ? BibleRPC.preloadReaderPassages(beforeRefs) : Promise.resolve([]),
        BibleRPC.preloadReaderPassages(afterRefs),
      ]);
      if (reqGen !== generation || scopeReq !== scopeGenerations[pane.slot] || element.hidden) return;
      pane.contextLoading = false;
      pane.contextBefore = beforeItems.filter(it => !!it.text);
      pane.contextAfter = afterItems.filter(it => !!it.text);
      renderBody();
      return;
    }

    const startV = Math.max(minV, p.verse - 5);
    const endV = startV + 11;
    const refs: ActivePassage[] = [];
    for (let v = startV; v <= endV; v += 1) {
      refs.push({ book: p.book, chapter: p.chapter, verse: v });
    }
    const items = await BibleRPC.preloadReaderPassages(refs.slice(0, 12));
    if (reqGen !== generation || scopeReq !== scopeGenerations[pane.slot] || element.hidden) return;
    pane.contextLoading = false;
    pane.chapterItems = items.filter(it => !!it.text);
    renderBody();
  }

  async function runBridgeCheck() {
    const reqGen = generation;
    const reqBridge = ++bridgeGeneration;
    const refA = formatVerseRef(panes.a.passage);
    const refB = formatVerseRef(panes.b.passage);
    const targets = panes.c ? [refA, refB, formatVerseRef(panes.c.passage)] : [refA, refB];
    const query = targets.join(' ');

    bridgeState = { status: 'loading', query, result: null, patternCompare: null, error: null };
    renderSummary();

    const [res, cmpRes] = await Promise.all([
      discoverBiblicalConnectionsRpc({ query, mode: 'bridge', limit: 6 }),
      comparePatternsRpc({ targets, limit: 6 }),
    ]);
    if (reqGen !== generation || reqBridge !== bridgeGeneration || element.hidden) return;

    if (res.error || !res.data) {
      bridgeState = {
        status: 'error',
        query,
        result: null,
        patternCompare: cmpRes.data ?? null,
        error: res.error || 'Unable to load LXX & textual bridge records.',
      };
    } else {
      bridgeState = {
        status: 'loaded',
        query,
        result: res.data,
        patternCompare: cmpRes.data ?? null,
        error: null,
      };
    }
    renderSummary();
  }

  function renderBridgeResults(container: HTMLElement) {
    if (bridgeState.status === 'idle') return;
    if (bridgeState.status === 'loading') {
      container.append(status('Checking Septuagint alignments and textual bridges…'));
      return;
    }
    if (bridgeState.status === 'error') {
      container.append(status(bridgeState.error ?? 'Bridge check failed.'));
      return;
    }

    const res = bridgeState.result;
    if (!res) return;

    const resultsBox = el('div', 'comparison-bridge-results');
    const bridges = [...(res.bridges ?? []), ...(res.iterative_analysis?.bridges ?? [])];
    const connections = (res.strongest_connections ?? []).slice(0, 6);
    const xrefs = (res.related_discoveries?.cross_references ?? []).slice(0, 6);

    if (res.iterative_analysis?.explanation) {
      resultsBox.append(el('p', 'study-muted', res.iterative_analysis.explanation));
    }

    const tessList = Array.isArray(bridgeState.patternCompare?.tesserae_parallels)
      ? (bridgeState.patternCompare!.tesserae_parallels as Array<Record<string, unknown>>)
      : [];
    for (const tp of tessList) {
      const card = el('div', 'comparison-bridge-item');
      const feats = (Array.isArray(tp.matched_features) ? tp.matched_features : [])
        .map((f: any) => `${String(f.feature_key || '')} (${String(f.channel || '')})`)
        .join(', ');
      card.append(
        el('strong', '', `Tesserae V6 Parallel Score: ${String(tp.score ?? 0)} (norm ${String(tp.normalized_score ?? 0)}, ${String(tp.rare_match_count ?? 0)} rare matches)`),
        el('p', 'study-muted', feats || 'Lexical/root/LXX parallel features matched.')
      );
      resultsBox.append(card);
    }

    for (const b of bridges.slice(0, 4)) {
      const card = el('div', 'comparison-bridge-item');
      const label = b.bridging_node?.label ? `Bridge (${b.bridging_node.label})` : 'Conceptual bridge';
      card.append(el('strong', '', label), el('p', '', b.explanation || b.summary || ''));
      resultsBox.append(card);
    }

    for (const conn of connections) {
      resultsBox.append(renderBridgeConnectionCard(conn));
    }

    if (bridges.length === 0 && connections.length === 0 && xrefs.length > 0) {
      for (const xr of xrefs) {
        const card = el('div', 'comparison-bridge-item');
        card.append(el('strong', '', `${xr.from_ref} ↔ ${xr.to_ref}`));
        if (xr.anchor_phrase) card.append(el('p', 'study-muted', xr.anchor_phrase));
        const refs = el('div', 'comparison-bridge-refs');
        for (const wp of [xr.from_passage, xr.to_passage]) {
          const target: ActivePassage = { book: wp.book, chapter: wp.chapter, verse: wp.verse };
          const btn = action(wp.ref, () => navigate(target), 'study-button');
          opts?.preview?.attach(btn, target, `Witness ${wp.ref}`);
          refs.append(btn);
        }
        card.append(refs);
        resultsBox.append(card);
      }
    }

    if (resultsBox.childElementCount === 0) {
      resultsBox.append(status(`No source-attested LXX or textual bridge records found for ${bridgeState.query}.`));
    }

    container.append(resultsBox);
  }

  function renderBridgeConnectionCard(conn: R10ConnectionSummary): HTMLElement {
    const card = el('div', 'comparison-bridge-item');
    const meta = el('div', 'comparison-bridge-meta');
    meta.append(
      el('span', 'comparison-bridge-badge', conn.epistemic_class.replaceAll('_', ' ')),
      el('span', '', `Tier ${conn.evidence_tier}`),
      el('span', '', `${conn.witness_count} witness${conn.witness_count === 1 ? '' : 'es'}`)
    );
    card.append(meta, el('strong', '', conn.title), el('p', '', conn.explanation));

    if (conn.original_words?.length) {
      const terms = conn.original_words
        .slice(0, 4)
        .map(w => `${w.lemma_script} (${w.transliteration} · ${w.gloss})`)
        .join(' · ');
      card.append(el('p', 'study-muted', terms));
    }

    if (conn.passages?.length) {
      const refs = el('div', 'comparison-bridge-refs');
      for (const wp of conn.passages.slice(0, 6)) {
        const target: ActivePassage = { book: wp.book, chapter: wp.chapter, verse: wp.verse };
        const btn = action(wp.ref || formatVerseRef(target), () => navigate(target), 'study-button');
        opts?.preview?.attach(btn, target, `Bridge witness: ${conn.title}`);
        refs.append(btn);
      }
      card.append(refs);
    }
    return card;
  }

  async function toggleTriDiff() {
    if (triDiffState.open) {
      triDiffState = { ...triDiffState, open: false };
      renderSummary();
      return;
    }
    const active = getActivePanes();
    const ntPane = active.find(p => p.passage.book > 39);
    const otPanes = active.filter(p => p.passage.book <= 39);
    if (!ntPane) {
      triDiffState = {
        open: true,
        status: 'error',
        result: null,
        error: 'Tri-Textual MT ↔ Rahlfs LXX ↔ NT Diff aligns an NT passage (Matt–Rev) against OT MT/LXX sources. Set at least one pane to an NT passage.',
      };
      renderSummary();
      return;
    }

    const reqTri = ++triGeneration;
    triDiffState = { open: true, status: 'loading', result: null, error: null };
    renderSummary();

    const res = await triTextualDiffV3Rpc({
      target: formatVerseRef(ntPane.passage),
      ...(otPanes.length > 0 ? { sources: otPanes.map(p => formatVerseRef(p.passage)) } : {}),
    });
    if (reqTri !== triGeneration || element.hidden) return;
    if (res.error || !res.data || res.data.status === 'invalid_request' || res.data.status === 'not_found') {
      triDiffState = {
        open: true,
        status: 'error',
        result: null,
        error: res.data?.error || res.error || 'Tri-textual alignment unavailable.',
      };
    } else {
      triDiffState = { open: true, status: 'loaded', result: res.data, error: null };
    }
    renderSummary();
  }

  async function toggleWordplayScan() {
    if (wordplayState.open) {
      wordplayState = { ...wordplayState, open: false };
      renderSummary();
      return;
    }
    const reqWp = ++wordplayGeneration;
    const active = getActivePanes();
    wordplayState = { open: true, status: 'loading', items: [], error: null };
    renderSummary();

    const results = await Promise.all(
      active.map(async p => {
        const ref = formatVerseRef(p.passage);
        const res = await wordplayScanV3Rpc({
          book: p.passage.book,
          chapter: p.passage.chapter,
          verse: p.passage.verse,
        });
        return { ref, res };
      })
    );
    if (reqWp !== wordplayGeneration || element.hidden) return;
    const items = results
      .filter((r): r is { ref: string; res: { data: WordplayScanV3Result; error: null; source: 'live' } } => Boolean(r.res.data))
      .map(r => ({ ref: r.ref, data: r.res.data }));
    if (items.length === 0) {
      const firstErr = results.find(r => r.res.error)?.res.error;
      wordplayState = {
        open: true,
        status: 'error',
        items: [],
        error: firstErr || 'Wordplay & talion scan unavailable.',
      };
    } else {
      wordplayState = { open: true, status: 'loaded', items, error: null };
    }
    renderSummary();
  }

  function renderTriDiffPanel(container: HTMLElement) {
    if (!triDiffState.open) return;
    const panel = el('div', 'comparison-v3-panel');
    const head = el('div', 'comparison-v3-panel-head');
    head.append(
      el('strong', '', 'Tri-Textual MT ↔ Rahlfs LXX ↔ NT Diff (Halo-SW)'),
      action('Close', () => {
        triDiffState = { ...triDiffState, open: false };
        renderSummary();
      }, 'study-button')
    );
    panel.append(head);

    if (triDiffState.status === 'loading') {
      panel.append(status('Running MT ↔ Rahlfs 1935 LXX ↔ NT Halo Smith-Waterman alignment…'));
      container.append(panel);
      return;
    }
    if (triDiffState.status === 'error' || !triDiffState.result) {
      panel.append(status(triDiffState.error ?? 'No tri-textual alignment returned.'));
      container.append(panel);
      return;
    }

    const d = triDiffState.result;
    if (d.status === 'no_alignment' || !d.sources?.length) {
      panel.append(
        status(`No significant MT/LXX ↔ NT alignment detected for ${d.target_ref || 'target'} across checked OT candidates.`)
      );
      container.append(panel);
      return;
    }

    const metaRow = el('div', 'comparison-pills');
    metaRow.append(
      el('span', 'comparison-pill', `Target: ${d.target_ref || ''}`),
      el('span', 'comparison-pill', `Sources: ${d.sources.join(', ')}`),
      el('span', 'comparison-pill', `Evidence: ${Number(d.evidence_bits || 0).toFixed(2)} bits`)
    );
    if (d.summary) {
      metaRow.append(
        el('span', 'comparison-pill', `Both: ${d.summary.agrees_both}`),
        el('span', 'comparison-pill', `LXX≠MT: ${d.summary.agrees_lxx_against_mt}`),
        el('span', 'comparison-pill', `MT≠LXX: ${d.summary.agrees_mt_against_lxx}`),
        el('span', 'comparison-pill', `Splices: ${d.summary.composite_splice}`),
        el('span', 'comparison-pill', `NT adapt: ${d.summary.nt_adaptation}`)
      );
    }
    panel.append(metaRow);

    if (d.splices?.length > 0) {
      const splBox = el('div', 'comparison-v3-list');
      splBox.append(el('strong', '', 'Composite Splices:'));
      for (const sp of d.splices) {
        splBox.append(
          el(
            'div',
            'comparison-bridge-item',
            `${sp.sourceRef} · NT tokens [${sp.ntStartIdx}..${sp.ntEndIdx}] · SW score ${sp.score.toFixed(2)} (${sp.contentMatches} content matches)`
          )
        );
      }
      panel.append(splBox);
    }

    if (d.tokens?.length > 0) {
      const tokWrap = el('div', 'comparison-tri-tokens');
      for (const tk of d.tokens) {
        const chip = el('div', `comparison-tri-token is-${tk.witness}`);
        const witnessShort: Record<string, string> = {
          agrees_both: 'LXX=MT',
          agrees_lxx_against_mt: 'LXX≠MT',
          agrees_mt_against_lxx: 'MT≠LXX',
          composite_splice: 'SPLICE',
          nt_adaptation: 'NT adapt',
        };
        chip.title = `${tk.nt_lemma}${tk.source_ref ? ` · ${tk.source_ref}` : ''}${tk.divergence_ref ? ` · ${tk.divergence_ref}` : ''}`;
        chip.append(
          el('span', 'comparison-tri-token__surf', tk.nt_surface),
          el('span', 'comparison-tri-token__tag', `${witnessShort[tk.witness] || tk.witness}${tk.source_ref ? ` · ${tk.source_ref}` : ''}`)
        );
        tokWrap.append(chip);
      }
      panel.append(tokWrap);
    }

    const shiftEntries = Object.entries(d.lxx_shifts_in_sources || {}).filter(([, arr]) => Array.isArray(arr) && arr.length > 0);
    if (shiftEntries.length > 0) {
      const shBox = el('div', 'comparison-v3-list');
      shBox.append(el('strong', '', 'LxxTranslationShift in OT Source(s):'));
      for (const [srcRef, shifts] of shiftEntries) {
        const pills = el('div', 'comparison-pills');
        pills.append(el('span', 'comparison-bridge-badge', srcRef));
        for (const sh of shifts.slice(0, 6)) {
          const detail = sh.text ? `: "${String(sh.text).slice(0, 48)}"` : sh.strongs?.length ? ` (${sh.strongs.join(', ')})` : '';
          pills.append(el('span', 'comparison-pill', `${sh.type.replaceAll('_', ' ')}${detail}`));
        }
        shBox.append(pills);
      }
      panel.append(shBox);
    }

    if (d.license) panel.append(el('p', 'study-muted', d.license));
    container.append(panel);
  }

  function renderWordplayPanel(container: HTMLElement) {
    if (!wordplayState.open) return;
    const panel = el('div', 'comparison-v3-panel');
    const head = el('div', 'comparison-v3-panel-head');
    head.append(
      el('strong', '', 'Wordplay, Syntactic Talion & Onomastic Scan (v3)'),
      action('Close', () => {
        wordplayState = { ...wordplayState, open: false };
        renderSummary();
      }, 'study-button')
    );
    panel.append(head);

    if (wordplayState.status === 'loading') {
      panel.append(status('Scanning syntactic talion, onomastic valence & consonantal candidates…'));
      container.append(panel);
      return;
    }
    if (wordplayState.status === 'error') {
      panel.append(status(wordplayState.error ?? 'Wordplay scan failed.'));
      container.append(panel);
      return;
    }

    let totalHits = 0;
    for (const item of wordplayState.items) {
      const d = item.data;
      const talion = d.syntactic_talion || [];
      const onom = d.onomastic_valence || [];
      const cons = d.consonantal_candidates || [];
      totalHits += talion.length + onom.length + cons.length;
      if (talion.length === 0 && onom.length === 0 && cons.length === 0) continue;

      const sec = el('div', 'comparison-v3-list');
      sec.append(el('strong', '', item.ref));
      for (const t of talion.slice(0, 5)) {
        sec.append(
          el(
            'div',
            'comparison-bridge-item',
            `[Talion · ${t.kind}] ${t.formA} (${t.strongsA}) ↔ ${t.formB} (${t.strongsB})${t.shift ? ` — ${t.shift}` : ''} (score ${t.score.toFixed(2)})`
          )
        );
      }
      for (const o of onom.slice(0, 5)) {
        sec.append(
          el(
            'div',
            'comparison-bridge-item',
            `[Onomastic · ${o.channel}] ${o.proper_form} (${o.proper_strongs}, ${o.proper_ref}) ↔ ${o.target_form} (${o.target_strongs}, ${o.target_ref}) (score ${o.score.toFixed(2)})`
          )
        );
      }
      for (const c of cons.slice(0, 6)) {
        sec.append(
          el(
            'div',
            'comparison-bridge-item',
            `[Consonantal · ${c.overlap_kind.replaceAll('_', ' ')}] ${c.formA} (${c.strongsA}) ↔ ${c.formB} (${c.strongsB}) · shared [${c.shared_consonants}] · formal ${c.formal_score.toFixed(2)}`
          )
        );
      }
      panel.append(sec);
    }

    if (totalHits === 0) {
      panel.append(el('p', 'study-muted', 'No syntactic talion, onomastic valence, or strong consonantal wordplay candidates detected in the active verses.'));
    }
    const disclaimer = wordplayState.items.find(i => i.data.disclaimer)?.data.disclaimer;
    if (disclaimer) {
      panel.append(el('p', 'study-muted', disclaimer));
    }
    container.append(panel);
  }

  function renderV3ToolsBar(container: HTMLElement) {
    const bar = el('div', 'comparison-v3-bar');
    bar.append(el('span', 'comparison-summary__label', 'v3 Verifiers'));
    const triBtn = action(
      triDiffState.status === 'loading'
        ? 'Running Tri-Textual Diff…'
        : triDiffState.open
          ? 'Hide Tri-Textual MT↔LXX↔NT Diff'
          : 'Tri-Textual MT↔LXX↔NT Diff',
      () => { void toggleTriDiff(); },
      `study-button${triDiffState.open ? ' is-active' : ''}`
    );
    triBtn.disabled = triDiffState.status === 'loading';

    const wpBtn = action(
      wordplayState.status === 'loading'
        ? 'Scanning Wordplay…'
        : wordplayState.open
          ? 'Hide Wordplay / Talion Scan'
          : 'Wordplay / Talion Scan',
      () => { void toggleWordplayScan(); },
      `study-button${wordplayState.open ? ' is-active' : ''}`
    );
    wpBtn.disabled = wordplayState.status === 'loading';

    bar.append(triBtn, wpBtn);
    container.append(bar);
    renderTriDiffPanel(container);
    renderWordplayPanel(container);
  }

  function renderSummary() {
    const active = getActivePanes();
    const { crossLang, sharedOrder, lemmaMeta, paletteMap, uniqueContentCounts } = computeLexicalAnalysis(active);
    const box = el('div', 'comparison-summary');
    pillRefs = [];

    // Scope row
    const scopeRow = el('div', 'comparison-summary__row');
    const scopeText = `${active.map(p => `${p.slot.toUpperCase()}: ${formatVerseRef(p.passage)} (${scopeLabel(p.scope)})`).join(' · ')} — ${
      crossLang ? 'Cross-language (OT ↔ NT)' : active[0]!.passage.book <= 39 ? 'Same testament (OT Hebrew/Aramaic)' : 'Same testament (NT Greek)'
    }`;
    scopeRow.append(el('span', 'comparison-summary__label', 'Scope'), el('span', '', scopeText));

    if (!crossLang) {
      const toggleLabel = el('label', 'comparison-toggle');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = showFunctionWords;
      checkbox.addEventListener('change', () => {
        showFunctionWords = checkbox.checked;
        renderBody();
      });
      toggleLabel.append(checkbox, document.createTextNode('Show function words'));
      scopeRow.append(toggleLabel);
    }
    box.append(scopeRow);

    if (crossLang) {
      const notice = el('div', 'comparison-notice', 'Hebrew ↔ Greek comparison: English similarity does not establish lexical identity.');
      notice.setAttribute('role', 'note');
      box.append(notice);

      const repeatsRow = el('div', 'comparison-summary__row');
      const bridgeBtn = action(
        bridgeState.status === 'loading' ? 'Checking LXX & textual bridge…' : 'Check LXX & textual bridge',
        () => { void runBridgeCheck(); },
        'study-button'
      );
      bridgeBtn.disabled = bridgeState.status === 'loading';
      repeatsRow.append(
        el('span', 'comparison-summary__label', 'What repeats'),
        el('span', 'study-muted', 'Direct Strong’s overlap is disabled across Hebrew and Greek corpora.'),
        bridgeBtn
      );
      box.append(repeatsRow);

      const differsRow = el('div', 'comparison-summary__row');
      differsRow.append(
        el('span', 'comparison-summary__label', 'What differs'),
        el('span', '', 'Distinct original-language corpora (OT Hebrew/Aramaic vs NT Greek); verify shared claims via LXX or cross-reference bridges.')
      );
      box.append(differsRow);

      renderBridgeResults(box);
      renderV3ToolsBar(box);
      summaryMount.replaceChildren(box);
      return;
    }

    const anyLoading = active.some(p => p.loading);

    // What repeats row
    const repeatsRow = el('div', 'comparison-summary__row');
    repeatsRow.append(el('span', 'comparison-summary__label', 'What repeats'));
    if (anyLoading) {
      repeatsRow.append(el('span', 'study-muted', 'Loading verified original-language lemmas…'));
    } else if (sharedOrder.length === 0) {
      repeatsRow.append(
        el('span', 'study-muted', `No shared verified Strong’s lemmas across panes${showFunctionWords ? '' : ' (common function words hidden)'}.`)
      );
    } else {
      const pills = el('div', 'comparison-pills');
      for (const strongs of sharedOrder) {
        const meta = lemmaMeta.get(strongs)!;
        const idx = paletteMap.get(strongs) ?? 0;
        const label = `${meta.original} · ${meta.transliteration} · ${meta.gloss}`;
        const pill = action(label, () => togglePillFocus(strongs, meta.transliteration), `comparison-pill cmp-match-${idx}`);
        pill.title = `${strongs} — Focus matching tokens across panes`;
        pill.setAttribute('aria-pressed', focusedStrongs === strongs ? 'true' : 'false');
        if (focusedStrongs === strongs) pill.classList.add('is-focused');
        pillRefs.push({ strongs, btn: pill });
        pills.append(pill);
      }
      repeatsRow.append(pills);
    }
    box.append(repeatsRow);

    // What differs row
    const differsRow = el('div', 'comparison-summary__row');
    differsRow.append(el('span', 'comparison-summary__label', 'What differs'));
    const differsText = anyLoading
      ? 'Calculating unique content lemmas…'
      : `Unique content lemmas — ${active.map(p => `${p.slot.toUpperCase()}: ${uniqueContentCounts[p.slot]}`).join(' · ')}`;
    differsRow.append(el('span', '', differsText));
    box.append(differsRow);

    renderV3ToolsBar(box);
    summaryMount.replaceChildren(box);
  }

  function buildContextRow(item: ReaderPassage, isCurrent: boolean): HTMLElement {
    const row = el('div', `reader-context-row${isCurrent ? ' is-current' : ''}`);
    if (isCurrent) row.setAttribute('aria-current', 'location');
    const numBtn = action(`${item.passage.verse}`, () => navigate(item.passage), 'reader-context-row__num');
    numBtn.title = `Open ${formatVerseRef(item.passage)}`;
    opts?.preview?.attach(numBtn, item.passage, `Preview ${formatVerseRef(item.passage)}`);
    const textSpan = el('span', 'reader-context-row__text', item.text ?? 'English text unavailable.');
    row.append(numBtn, textSpan);
    if (!isCurrent) {
      row.addEventListener('click', event => {
        if ((event.target as HTMLElement).closest('button')) return;
        navigate(item.passage);
      });
    }
    return row;
  }

  function renderPane(pane: PaneState, paletteMap: Map<string, number>, crossLang: boolean, active: PaneState[]): HTMLElement {
    const column = el('article', 'comparison-passage');
    column.setAttribute('aria-label', `Pane ${pane.slot.toUpperCase()}: ${formatVerseRef(pane.passage)}`);

    // Pane Header
    const head = el('div', 'comparison-pane-head');
    const titleWrap = el('div', 'comparison-pane-title');
    titleWrap.append(
      el('span', 'comparison-slot-badge', pane.slot.toUpperCase()),
      el('h3', '', formatVerseRef(pane.passage))
    );

    const paneActions = el('div', 'comparison-pane-actions');
    const scopeGroup = el('div', 'segmented-control');
    scopeGroup.setAttribute('role', 'group');
    scopeGroup.setAttribute('aria-label', `Scope for pane ${pane.slot.toUpperCase()}`);
    for (const [scopeKey, label] of [['verse', 'Verse'], ['context', '±2'], ['chapter', 'Chapter']] as const) {
      const seg = action(label, () => {
        if (pane.scope === scopeKey) return;
        pane.scope = scopeKey;
        void loadPaneScope(pane);
        renderSummary();
      }, `seg-btn${pane.scope === scopeKey ? ' is-active' : ''}`);
      seg.setAttribute('aria-pressed', pane.scope === scopeKey ? 'true' : 'false');
      scopeGroup.append(seg);
    }

    paneActions.append(
      scopeGroup,
      action('Open passage →', () => navigate(pane.passage), 'study-button')
    );
    if (pane.slot === 'c') {
      paneActions.append(action('Remove', () => removePaneC(), 'study-button'));
    }

    head.append(titleWrap, paneActions);
    column.append(head);

    // Context before (for ±2)
    if (pane.scope === 'context') {
      if (pane.contextLoading) {
        column.append(status('Loading ±2 context…'));
      } else if (pane.contextBefore.length) {
        const beforeList = el('div', 'comparison-context-list');
        beforeList.append(...pane.contextBefore.map(it => buildContextRow(it, false)));
        column.append(beforeList);
      }
    }

    // Complete WEB English verse
    const englishP = el('p', 'comparison-english', pane.english);
    column.append(englishP);

    // Context after (for ±2) or Chapter list (up to 12 verses)
    if (pane.scope === 'context' && !pane.contextLoading && pane.contextAfter.length) {
      const afterList = el('div', 'comparison-context-list');
      afterList.append(...pane.contextAfter.map(it => buildContextRow(it, false)));
      column.append(afterList);
    } else if (pane.scope === 'chapter') {
      if (pane.contextLoading) {
        column.append(status('Loading chapter context…'));
      } else if (pane.chapterItems.length) {
        const chapterList = el('div', 'comparison-context-list');
        chapterList.append(
          ...pane.chapterItems.slice(0, 12).map(it => buildContextRow(it, it.passage.verse === pane.passage.verse))
        );
        column.append(chapterList);
      }
    }

    // Interactive original-language interlinear strip
    const interlinear = el('div', 'comparison-interlinear');
    interlinear.dir = pane.passage.book <= 39 ? 'rtl' : 'ltr';
    interlinear.lang = pane.passage.book <= 39 ? 'he' : 'el';
    interlinear.setAttribute('aria-label', `Original-language tokens for ${formatVerseRef(pane.passage)}`);

    if (pane.loading) {
      interlinear.append(status('Loading original-language tokens…'));
    } else if (pane.words.length === 0) {
      interlinear.append(status('Original-language tokens unavailable for this verse.'));
    } else {
      for (const token of pane.words) {
        const strongs = normalizeStrongs(token.strongs_nr);
        const matchIdx = !crossLang && strongs ? paletteMap.get(strongs) : undefined;
        const cls = `comparison-token${matchIdx !== undefined ? ` cmp-match-${matchIdx}` : ''}${
          focusedStrongs && strongs === focusedStrongs ? ' is-focused' : ''
        }`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls;
        btn.setAttribute('aria-pressed', focusedStrongs && strongs === focusedStrongs ? 'true' : 'false');
        if (strongs) btn.dataset.strongs = strongs;

        btn.append(
          el('span', 'comparison-token__original original', token.original_word),
          el('span', 'comparison-token__translit transliteration', token.transliteration),
          el('span', 'comparison-token__gloss', token.primary_english || '—')
        );

        btn.addEventListener('focus', () => focusToken(pane.slot, strongs, token.transliteration));
        btn.addEventListener('click', () => focusToken(pane.slot, strongs, token.transliteration));
        tokenRefs.push({ slot: pane.slot, strongs, btn });
        interlinear.append(btn);
      }
    }

    column.append(interlinear);

    const correspondence = el('p', 'comparison-correspondence study-muted', formatCorrespondenceMessage(pane, active, crossLang));
    correspondence.setAttribute('role', 'status');
    correspondenceRefs[pane.slot] = correspondence;
    column.append(correspondence);

    column.append(el('p', 'study-muted', 'World English Bible · original text: STEP Bible'));
    return column;
  }

  function renderBody() {
    const active = getActivePanes();
    const { crossLang, paletteMap } = computeLexicalAnalysis(active);
    tokenRefs = [];
    correspondenceRefs = {};

    columnsMount.className = `comparison-columns${panes.c ? ' comparison-columns--three' : ''}`;
    columnsMount.replaceChildren(
      ...active.map(pane => renderPane(pane, paletteMap, crossLang, active))
    );

    renderSummary();
  }

  function swapAB() {
    explorationState.swapPins();
    const prevA = panes.a;
    const prevB = panes.b;
    const wasLoadingA = prevA.loading;
    const wasLoadingB = prevB.loading;
    const wasScopeLoadingA = prevA.contextLoading;
    const wasScopeLoadingB = prevB.contextLoading;

    paneGenerations.a++;
    paneGenerations.b++;
    scopeGenerations.a++;
    scopeGenerations.b++;

    panes.a = { ...prevB, slot: 'a' };
    panes.b = { ...prevA, slot: 'b' };
    if (focusedUnverifiedSlot === 'a') focusedUnverifiedSlot = 'b';
    else if (focusedUnverifiedSlot === 'b') focusedUnverifiedSlot = 'a';

    bridgeGeneration++;
    bridgeState = { status: 'idle', query: '', result: null, error: null };
    resetV3Panels();

    renderBody();
    if (wasLoadingA || wasLoadingB) {
      if (panes.a.loading) void loadPaneData(panes.a);
      if (panes.b.loading) void loadPaneData(panes.b);
    }
    if (wasScopeLoadingA || wasScopeLoadingB) {
      if (panes.a.contextLoading) void loadPaneScope(panes.a);
      if (panes.b.contextLoading) void loadPaneScope(panes.b);
    }
  }

  function setPaneC(passage: ActivePassage) {
    cInputError = '';
    hiddenC = null;
    panes.c = createPaneState('c', passage);
    bridgeGeneration++;
    bridgeState = { status: 'idle', query: '', result: null, error: null };
    resetV3Panels();
    renderChrome();
    renderBody();
    void loadPaneData(panes.c);
  }

  function hidePaneC() {
    if (!panes.c) return;
    hiddenC = { ...panes.c.passage };
    paneGenerations.c++;
    scopeGenerations.c++;
    panes.c = null;
    if (focusedUnverifiedSlot === 'c') focusedUnverifiedSlot = null;
    bridgeGeneration++;
    bridgeState = { status: 'idle', query: '', result: null, error: null };
    resetV3Panels();
    renderChrome();
    renderBody();
  }

  function removePaneC() {
    hiddenC = null;
    cInputError = '';
    paneGenerations.c++;
    scopeGenerations.c++;
    panes.c = null;
    if (focusedUnverifiedSlot === 'c') focusedUnverifiedSlot = null;
    bridgeGeneration++;
    bridgeState = { status: 'idle', query: '', result: null, error: null };
    resetV3Panels();
    renderChrome();
    renderBody();
  }

  function renderChrome() {
    const header = el('div', 'comparison-header');
    const actionsRow = el('div', 'comparison-header-actions');

    const swapBtn = action('Swap A ↔ B', swapAB, 'study-button');

    const cForm = document.createElement('form');
    cForm.className = 'comparison-c-form';
    const cInput = document.createElement('input');
    cInput.type = 'text';
    cInput.className = 'comparison-c-input';
    cInput.placeholder = 'e.g. Rev 11:4';
    cInput.setAttribute('aria-label', 'Third comparison passage');
    if (panes.c) cInput.value = formatVerseRef(panes.c.passage);
    else if (hiddenC) cInput.value = formatVerseRef(hiddenC);

    const addOrUpdateBtn = document.createElement('button');
    addOrUpdateBtn.type = 'submit';
    addOrUpdateBtn.className = 'study-button';
    addOrUpdateBtn.textContent = panes.c ? 'Set C' : '+ Add C';

    cForm.addEventListener('submit', event => {
      event.preventDefault();
      const raw = cInput.value.trim();
      if (!raw) {
        if (!panes.c && hiddenC) {
          setPaneC(hiddenC);
          return;
        }
        cInputError = 'Enter a passage such as "Rev 11:4" or "66/11/4".';
        cStatusLine.textContent = cInputError;
        cStatusLine.hidden = false;
        cInput.focus();
        return;
      }
      const parsed = parseQuickPassage(raw);
      if (!parsed) {
        cInputError = `Could not parse "${raw}". Try e.g. "Rev 11:4" or "1/1/1".`;
        cStatusLine.textContent = cInputError;
        cStatusLine.hidden = false;
        cInput.focus();
        return;
      }
      cStatusLine.hidden = true;
      setPaneC(parsed);
    });

    cForm.append(cInput, addOrUpdateBtn);
    if (panes.c) {
      cForm.append(action('Hide C', hidePaneC, 'study-button'));
    }

    const copyBtn = action('Copy citation', async () => {
      const citation = getActivePanes().map(p => formatVerseRef(p.passage)).join(' ↔ ');
      const ok = await copyText(citation);
      if (!ok) return;
      clearTimeout(copyResetTimer);
      copyBtn.textContent = 'Copied';
      copyResetTimer = window.setTimeout(() => {
        copyBtn.textContent = 'Copy citation';
      }, 1800);
    }, 'study-button');

    actionsRow.append(swapBtn, cForm, copyBtn);

    if (opts?.onOpenPatternBoard) {
      const onPattern = opts.onOpenPatternBoard;
      actionsRow.append(action('Pattern Board', () => onPattern(getActivePanes().map(p => p.passage)), 'study-button'));
    }

    if (opts?.onAddNote) {
      const onAddNote = opts.onAddNote;
      actionsRow.append(action('Save note', () => onAddNote(panes.a.passage, panes.b.passage), 'study-button'));
    }

    const closeBtn = action('Close comparison', () => {
      close();
      opener?.focus();
    }, 'study-button');
    actionsRow.append(closeBtn);

    header.append(heading('READ TOGETHER', 'Compare passages'), actionsRow);
    cStatusLine.textContent = cInputError;
    cStatusLine.hidden = !cInputError;

    element.replaceChildren(header, cStatusLine, summaryMount, columnsMount);
  }

  async function open(source: ActivePassage, target: ActivePassage) {
    const reqGen = ++generation;
    bridgeGeneration++;
    paneGenerations.a++;
    paneGenerations.b++;
    paneGenerations.c++;
    scopeGenerations.a++;
    scopeGenerations.b++;
    scopeGenerations.c++;

    const activeEl = document.activeElement;
    if (element.hidden || !(activeEl instanceof HTMLElement && element.contains(activeEl))) {
      opener = activeEl instanceof HTMLElement ? activeEl : null;
    }

    panes = {
      a: createPaneState('a', source),
      b: createPaneState('b', target),
      c: panes.c ? createPaneState('c', panes.c.passage) : null,
    };
    cInputError = '';
    focusedStrongs = null;
    focusedTranslit = '';
    focusedUnverifiedSlot = null;
    bridgeState = { status: 'idle', query: '', result: null, error: null };
    resetV3Panels();

    renderChrome();
    element.hidden = false;
    renderBody();

    const closeBtn = element.querySelector<HTMLButtonElement>('.comparison-header-actions > button:last-child');
    element.scrollIntoView({ block: 'nearest' });
    closeBtn?.focus();

    const active = getActivePanes();
    await Promise.all(active.map(pane => (reqGen === generation ? loadPaneData(pane) : Promise.resolve())));
  }

  function openWithPins() {
    const { pins } = explorationState.getSnapshot();
    const cur = appState.getPassage();
    const source = pins.a?.passage ? { ...pins.a.passage } : cur;
    const target = pins.b?.passage
      ? { ...pins.b.passage }
      : (samePassage(source, cur)
          ? (samePassage(source, { book: 1, chapter: 1, verse: 1 })
              ? { book: 43, chapter: 1, verse: 1 }
              : { book: 1, chapter: 1, verse: 1 })
          : cur);
    void open(source, target);
  }

  function close() {
    generation++;
    bridgeGeneration++;
    resetV3Panels();
    paneGenerations.a++;
    paneGenerations.b++;
    paneGenerations.c++;
    scopeGenerations.a++;
    scopeGenerations.b++;
    scopeGenerations.c++;
    element.hidden = true;
  }

  return { element, open, openWithPins, close };
}
