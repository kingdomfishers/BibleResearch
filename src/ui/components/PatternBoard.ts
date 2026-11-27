// @file: src/ui/components/PatternBoard.ts
// @feature: pattern-board
// @tables: reader_english_verses | words | verses
// @candidates: none
// @toc: imports | types | logic:constants | logic:parsers | logic:analysis | logic:styles | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import {
  clauseRoleQueryV3Rpc,
  comparePatternsRpc,
  discoverBiblicalConnectionsRpc,
  sequenceParallelsV3Rpc,
  type ClauseRoleQueryV3Result,
  type ComparePatternsV1Result,
  type SequenceParallelBlockV3,
  type SequenceParallelsV3Result,
} from '../../api/r10-rpc';
import type { ActivePassage, VerseWordToken } from '../../api/types';
import type {
  DiscoverConnectionsResult,
  R10ConnectionSummary,
  R10ControlOrWarning,
  R10PassageRef,
} from '../../relationships/r10-types';
import { explorationState, type Anchor, type UserHypothesis } from '../exploration-state';
import { action, el, heading, status } from '../study-dom';
import { BIBLE_BOOKS, BOOK_CHAPTERS, formatVerseRef, parseAnchorPassage } from '../utils';
import type { ContextPreview } from './ContextPreview';

// === @section:types ===
export interface PatternBoardCallbacks {
  preview: ContextPreview;
  navigate: (p: ActivePassage) => void;
  onSaveHypothesis: (from: Anchor, to: Anchor, summary: string) => void;
  onOpenFullDiscovery: (query: string, mode?: 'discover' | 'challenge') => void;
}

export interface PatternBoardHandle {
  element: HTMLElement;
  open: (passages?: ActivePassage[]) => void;
  toggle: () => void;
  isOpen: () => boolean;
  close: () => void;
}

interface BoardCardState {
  passage: ActivePassage;
  loading: boolean;
  english: string;
  englishAvailable: boolean;
  words: VerseWordToken[];
  wordsError: string | null;
}

interface LookupState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  mode: 'discover' | 'challenge' | 'compare_patterns' | 'sequence_parallels' | 'clause_roles' | null;
  query: string;
  result: DiscoverConnectionsResult | null;
  compareResult?: ComparePatternsV1Result | null;
  sequenceResults?: Array<{ pairLabel: string; data: SequenceParallelsV3Result }> | null;
  clauseRoleResults?: Array<{ ref: string; data: ClauseRoleQueryV3Result }> | null;
  error: string | null;
}

interface SharedLemmaInfo {
  strongs: string;
  original: string;
  transliteration: string;
  gloss: string;
  passages: ActivePassage[];
}

interface UniqueLemmaInfo {
  strongs: string;
  original: string;
  transliteration: string;
  gloss: string;
}

interface DetectedFeatureItem {
  label: string;
  detail: string;
}

// === @section:logic:constants ===
const MAX_BOARD_PASSAGES = 3;
const STYLE_ID = 'pattern-board-styles';
const STOPWORD_STRONGS = new Set(['H853', 'G3588', 'G2532', 'G1161', 'G1722']);
const STRONGS_RE = /^[HG]\d+[A-Z]?$/i;

const CROSS_LANGUAGE_NOTICE =
  'Cross-language pair — shared English wording does not prove lexical identity without an attested LXX/bridge link.';

const STARTER_EXAMPLES: Array<{ label: string; passages: ActivePassage[] }> = [
  {
    label: 'Gen 2:7 ↔ Gen 3:19 ↔ 1 Cor 15:45',
    passages: [
      { book: 1, chapter: 2, verse: 7 },
      { book: 1, chapter: 3, verse: 19 },
      { book: 46, chapter: 15, verse: 45 },
    ],
  },
  {
    label: 'Gen 6:14 ↔ Exod 2:3',
    passages: [
      { book: 1, chapter: 6, verse: 14 },
      { book: 2, chapter: 2, verse: 3 },
    ],
  },
  {
    label: 'Zech 4:2 ↔ Rev 11:4',
    passages: [
      { book: 38, chapter: 4, verse: 2 },
      { book: 66, chapter: 11, verse: 4 },
    ],
  },
];

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

const QUANTITY_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'twenty', 'thirty', 'forty', 'fifty', 'seventy', 'hundred',
  'thousand', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'double', 'half', 'pair', 'cubit', 'cubits', 'measure', 'measures', 'length',
  'width', 'height', 'rooms', 'stories', 'month', 'months', 'days', 'years',
]);

const IMAGERY_TERMS = new Set([
  'dust', 'ground', 'earth', 'clay', 'soil', 'breath', 'breathed', 'spirit', 'wind',
  'living', 'soul', 'life', 'tree', 'trees', 'seed', 'fruit', 'ark', 'chest',
  'basket', 'pitch', 'bitumen', 'tar', 'slime', 'reed', 'reeds', 'bulrushes',
  'papyrus', 'gopher', 'wood', 'water', 'waters', 'flood', 'river', 'sea', 'fire',
  'flame', 'lamp', 'lamps', 'lampstand', 'candlestick', 'light', 'oil', 'olive',
  'olives', 'branch', 'branches', 'bowl', 'gold', 'golden', 'eyes', 'eye',
  'witness', 'witnesses', 'blood', 'lamb', 'door', 'linen', 'garment', 'robe',
  'crown', 'stone', 'rock', 'shepherd', 'vine', 'bread', 'wine', 'salt',
  'mountain', 'cloud', 'smoke', 'temple', 'altar', 'vessel', 'horn', 'horns',
  'wing', 'wings', 'dove', 'serpent', 'dragon', 'lion', 'heart', 'hand', 'face',
  'nostrils', 'form', 'formed', 'adam', 'man', 'return', 'sweat', 'thorns',
]);

// === @section:logic:parsers ===
function samePassage(a?: ActivePassage | null, b?: ActivePassage | null): boolean {
  return !!a && !!b && a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;
}

function passageKey(p: ActivePassage): string {
  return `verse:${p.book}-${p.chapter}-${p.verse}`;
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
  return s.toUpperCase().replace(/^([HG])0+(\d)/, '$1$2');
}

function isStopwordStrongs(strongs: string): boolean {
  return STOPWORD_STRONGS.has(strongs);
}

function createCardState(passage: ActivePassage): BoardCardState {
  return {
    passage: { ...passage },
    loading: true,
    english: 'Loading verse…',
    englishAvailable: false,
    words: [],
    wordsError: null,
  };
}

function makeVerseAnchor(p: ActivePassage): Anchor {
  return {
    kind: 'verse',
    canonicalKey: passageKey(p),
    label: formatVerseRef(p),
    passage: { ...p },
  };
}

// === @section:logic:analysis ===
function computeLexicalLanes(cards: BoardCardState[]) {
  const hasOT = cards.some(c => c.passage.book <= 39);
  const hasNT = cards.some(c => c.passage.book > 39);
  const hasCrossLanguagePair = hasOT && hasNT;

  const byStrongs = new Map<
    string,
    { meta: Omit<SharedLemmaInfo, 'passages'>; passages: ActivePassage[] }
  >();

  for (const card of cards) {
    const seenInCard = new Set<string>();
    for (const w of card.words) {
      const strongs = normalizeStrongs(w.strongs_nr);
      if (!strongs || isStopwordStrongs(strongs) || seenInCard.has(strongs)) continue;
      seenInCard.add(strongs);

      let entry = byStrongs.get(strongs);
      if (!entry) {
        entry = {
          meta: {
            strongs,
            original: w.original_word,
            transliteration: w.transliteration,
            gloss: w.primary_english?.trim() || '—',
          },
          passages: [],
        };
        byStrongs.set(strongs, entry);
      }
      entry.passages.push(card.passage);
    }
  }

  const shared: SharedLemmaInfo[] = [];
  const sharedSet = new Set<string>();
  for (const [strongs, entry] of byStrongs.entries()) {
    if (entry.passages.length >= 2) {
      sharedSet.add(strongs);
      shared.push({ ...entry.meta, passages: entry.passages });
    }
  }

  const paletteMap = new Map<string, number>();
  shared.forEach((item, idx) => paletteMap.set(item.strongs, idx % 8));

  const uniqueByPassage = cards.map(card => {
    const seen = new Set<string>();
    const unique: UniqueLemmaInfo[] = [];
    for (const w of card.words) {
      const strongs = normalizeStrongs(w.strongs_nr);
      if (!strongs || isStopwordStrongs(strongs) || sharedSet.has(strongs) || seen.has(strongs)) continue;
      seen.add(strongs);
      unique.push({
        strongs,
        original: w.original_word,
        transliteration: w.transliteration,
        gloss: w.primary_english?.trim() || '—',
      });
    }
    return { passage: card.passage, unique };
  });

  return { hasCrossLanguagePair, shared, sharedSet, paletteMap, uniqueByPassage };
}

function tokenizeWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function isQuantityMorph(grammarCode: string | null | undefined): boolean {
  if (!grammarCode) return false;
  return /(?:^|\/)(?:H)?A[co]/i.test(grammarCode);
}

function detectQuantitiesAndImagery(cards: BoardCardState[]) {
  const quantities: DetectedFeatureItem[] = [];
  const imagery: DetectedFeatureItem[] = [];
  const queryTerms: string[] = [];
  const seenQty = new Set<string>();
  const seenImg = new Set<string>();
  const seenTerms = new Set<string>();

  for (const card of cards) {
    const ref = formatVerseRef(card.passage);
    for (const w of card.words) {
      const gloss = w.primary_english?.trim() ?? '';
      const glossWords = tokenizeWords(gloss);
      const qtyHit = isQuantityMorph(w.grammar_code) || glossWords.some(tok => QUANTITY_WORDS.has(tok) || /^\d+$/.test(tok));
      if (qtyHit) {
        const key = `${ref}:${w.strongs_nr || w.original_word}:${gloss}`;
        if (!seenQty.has(key)) {
          seenQty.add(key);
          quantities.push({
            label: `${w.original_word} (${gloss || w.transliteration})`,
            detail: `${ref}${w.strongs_nr ? ` · ${w.strongs_nr}` : ''}`,
          });
        }
      }

      for (const tok of glossWords) {
        if (IMAGERY_TERMS.has(tok)) {
          const imgKey = `${ref}:${w.strongs_nr || w.original_word}:${tok}`;
          if (!seenImg.has(imgKey)) {
            seenImg.add(imgKey);
            imagery.push({
              label: `${tok} — ${w.original_word} (${w.transliteration})`,
              detail: `${ref}${w.strongs_nr ? ` · ${w.strongs_nr}` : ''}`,
            });
          }
          if (!seenTerms.has(tok)) {
            seenTerms.add(tok);
            queryTerms.push(tok);
          }
        }
      }
    }

    if (card.englishAvailable) {
      for (const tok of tokenizeWords(card.english)) {
        if (QUANTITY_WORDS.has(tok) || /^\d+$/.test(tok)) {
          const key = `${ref}:en:${tok}`;
          const alreadyFromToken = [...seenQty].some(k => k.startsWith(`${ref}:`) && k.toLowerCase().includes(tok));
          if (!alreadyFromToken && !seenQty.has(key)) {
            seenQty.add(key);
            quantities.push({ label: `"${tok}" (WEB English)`, detail: ref });
          }
        }
        if (IMAGERY_TERMS.has(tok) && !seenTerms.has(tok)) {
          seenTerms.add(tok);
          queryTerms.push(tok);
        }
      }
    }
  }

  return { quantities, imagery, queryTerms };
}

function hypothesisTouchesPassages(h: UserHypothesis, passages: ActivePassage[]): boolean {
  const keys = new Set(passages.map(passageKey));
  const refs = new Set(passages.map(formatVerseRef));
  if (h.from.passage && passages.some(p => samePassage(p, h.from.passage))) return true;
  if (h.to.passage && passages.some(p => samePassage(p, h.to.passage))) return true;
  if (keys.has(h.from.canonicalKey) || keys.has(h.to.canonicalKey)) return true;
  return Array.isArray(h.linkedRefs) && h.linkedRefs.some(r => refs.has(r));
}

// === @section:logic:styles ===
function ensurePatternBoardStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.pattern-board { margin-top:22px; padding:22px 24px; background:var(--panel); border:1px solid var(--border); border-radius:8px; display:flex; flex-direction:column; gap:18px; }
.pattern-board[hidden] { display:none; }
.pattern-board__head { display:flex; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:12px 18px; }
.pattern-board__controls { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px 14px; padding-bottom:12px; border-bottom:1px solid var(--border); }
.pattern-board__starters { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.pattern-board__add-form { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.pattern-board__input { width:215px; min-height:36px; padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--background); color:var(--text); font-size:13px; }
.pattern-board__status { margin:0; font-size:12px; color:var(--gold); }
.pattern-board__cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; }
.pattern-board__card { display:flex; flex-direction:column; gap:10px; padding:15px 16px; border:1px solid var(--border); border-radius:8px; background:var(--background); min-width:0; }
.pattern-board__card-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
.pattern-board__card-title { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.pattern-board__card-title h3 { margin:0; font:normal 20px/1.25 Georgia,serif; }
.pattern-board__card-actions { display:flex; flex-wrap:wrap; gap:6px; }
.pattern-board__badge { font-size:10px; text-transform:uppercase; letter-spacing:.08em; padding:2px 7px; border-radius:4px; background:var(--soft); color:var(--gold); }
.pattern-board__badge--concordant { color:var(--green); border:1px solid var(--green); }
.pattern-board__badge--inversion { color:var(--gold); border:1px solid var(--gold); }
.pattern-board__badge--neg { color:#d97757; border:1px solid rgba(217,119,87,.5); }
.pattern-board__english { font:17px/1.65 Georgia,serif; margin:0; }
.pattern-board__tokens { display:flex; flex-wrap:wrap; gap:7px; padding:10px; border:1px solid var(--border); border-radius:6px; background:var(--panel); }
.pattern-board__token { display:inline-flex; flex-direction:column; align-items:center; text-align:center; gap:2px; padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--background); min-width:60px; }
.pattern-board__token-orig { font:20px/1.35 'Times New Roman',serif; }
.pattern-board__token-tr { font:11px/1.3 Georgia,serif; color:var(--gold); direction:ltr; }
.pattern-board__token-gl { font-size:11px; line-height:1.25; color:var(--muted); direction:ltr; overflow-wrap:anywhere; }
.pattern-board__token-str { font-size:10px; color:var(--muted); direction:ltr; }
.pattern-board__lanes { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
.pattern-board__lane { display:flex; flex-direction:column; gap:10px; padding:14px 16px; border:1px solid var(--border); border-radius:8px; background:var(--background); min-width:0; }
.pattern-board__lane-title { margin:0; font-size:12px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--gold); }
.pattern-board__notice { padding:9px 12px; border-left:3px solid var(--gold); background:var(--soft); border-radius:0 6px 6px 0; font-size:13px; margin:0; }
.pattern-board__pills { display:flex; flex-wrap:wrap; gap:6px; }
.pattern-board__pill { display:inline-flex; flex-wrap:wrap; align-items:center; gap:5px; border:1px solid var(--border); border-radius:999px; padding:4px 10px; font-size:12px; background:var(--panel); color:var(--text); }
.pattern-board__diff-group { display:flex; flex-direction:column; gap:5px; padding-top:6px; border-top:1px solid var(--border); }
.pattern-board__diff-group:first-of-type { border-top:0; padding-top:0; }
.pattern-board__lookup-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.pattern-board__lookup-results { display:flex; flex-direction:column; gap:8px; margin-top:4px; }
.pattern-board__result-card { padding:10px 12px; border:1px solid var(--border); border-radius:6px; background:var(--panel); font-size:13px; display:flex; flex-direction:column; gap:5px; }
.pattern-board__result-card--warning { border-left:3px solid var(--gold); }
.pattern-board__ref-list { display:flex; flex-wrap:wrap; gap:6px; }
.pattern-board__hyp-form { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.pattern-board__hyp-input { flex:1; min-width:180px; min-height:36px; padding:6px 10px; border:1px solid var(--border); border-radius:6px; background:var(--panel); color:var(--text); font-size:13px; }
.pb-match-0 { background:rgba(131,99,44,.16); border-color:rgba(131,99,44,.65); }
.pb-match-1 { background:rgba(51,109,88,.18); border-color:rgba(51,109,88,.68); }
.pb-match-2 { background:rgba(66,114,168,.16); border-color:rgba(66,114,168,.65); }
.pb-match-3 { background:rgba(148,82,130,.16); border-color:rgba(148,82,130,.65); }
.pb-match-4 { background:rgba(168,104,50,.16); border-color:rgba(168,104,50,.65); }
.pb-match-5 { background:rgba(58,136,136,.16); border-color:rgba(58,136,136,.65); }
.pb-match-6 { background:rgba(116,132,54,.16); border-color:rgba(116,132,54,.65); }
.pb-match-7 { background:rgba(156,74,84,.16); border-color:rgba(156,74,84,.65); }
@media(max-width:860px) { .pattern-board__lanes { grid-template-columns:1fr; } }
`;
  document.head.append(style);
}

// === @section:ui:main ===
export function createPatternBoard(callbacks: PatternBoardCallbacks): PatternBoardHandle {
  ensurePatternBoardStyles();

  const element = el('section', 'pattern-board');
  element.setAttribute('aria-label', 'Pattern Board');
  element.hidden = true;

  let generation = 0;
  let lookupGeneration = 0;
  let cards: BoardCardState[] = [];
  let lookupState: LookupState = { status: 'idle', mode: null, query: '', result: null, error: null };
  let hypDraftNote = '';

  const statusLine = el('p', 'pattern-board__status');
  statusLine.setAttribute('role', 'status');
  statusLine.hidden = true;

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'pattern-board__input';
  addInput.placeholder = 'Add passage (e.g. Gen 6:14)';
  addInput.setAttribute('aria-label', 'Add passage reference');

  const addForm = document.createElement('form');
  addForm.className = 'pattern-board__add-form';
  const addSubmit = document.createElement('button');
  addSubmit.type = 'submit';
  addSubmit.className = 'study-button';
  addSubmit.textContent = 'Add';
  addForm.append(addInput, addSubmit);

  const cardsMount = el('div', 'pattern-board__cards');
  const lanesMount = el('div', 'pattern-board__lanes');
  const emptyMount = el('div', 'pattern-board__empty');

  const header = el('div', 'pattern-board__head');
  header.append(
    heading('PATTERN BOARD', 'Compare observable features side by side'),
    action('Close', () => close(), 'study-button')
  );

  const startersRow = el('div', 'pattern-board__starters');
  startersRow.append(el('span', 'study-muted', 'Examples:'));
  for (const starter of STARTER_EXAMPLES) {
    startersRow.append(
      action(starter.label, () => {
        setBoardPassages(starter.passages);
      }, 'study-button')
    );
  }

  const controls = el('div', 'pattern-board__controls');
  controls.append(startersRow, addForm);

  element.append(header, controls, statusLine, emptyMount, cardsMount, lanesMount);

  function setStatusMessage(msg: string | null) {
    if (!msg) {
      statusLine.textContent = '';
      statusLine.hidden = true;
      return;
    }
    statusLine.textContent = msg;
    statusLine.hidden = false;
  }

  function resetLookup() {
    lookupGeneration += 1;
    lookupState = {
      status: 'idle',
      mode: null,
      query: '',
      result: null,
      compareResult: null,
      sequenceResults: null,
      clauseRoleResults: null,
      error: null,
    };
  }

  function setBoardPassages(passages: ActivePassage[]) {
    const deduped: ActivePassage[] = [];
    for (const p of passages) {
      if (!isValidPassage(p)) continue;
      if (deduped.some(existing => samePassage(existing, p))) continue;
      deduped.push({ ...p });
      if (deduped.length >= MAX_BOARD_PASSAGES) break;
    }
    setStatusMessage(null);
    resetLookup();
    cards = deduped.map(createCardState);
    renderAll();
    void loadAllCards();
  }

  async function loadAllCards() {
    const reqGen = ++generation;
    if (cards.length === 0) return;

    await Promise.all(
      cards.map(async card => {
        const [englishRes, wordsRes] = await Promise.all([
          BibleRPC.getReaderPassage(card.passage),
          BibleRPC.getVerseWords(card.passage.book, card.passage.chapter, card.passage.verse),
        ]);
        if (reqGen !== generation || element.hidden) return;
        card.loading = false;
        card.englishAvailable = !!englishRes.data?.text;
        card.english = englishRes.data?.text ?? englishRes.error ?? 'English text unavailable in this edition.';
        card.words = wordsRes.data ?? [];
        card.wordsError = wordsRes.data.length === 0 && wordsRes.error ? wordsRes.error : null;
        renderAll();
      })
    );
  }

  addForm.addEventListener('submit', event => {
    event.preventDefault();
    if (cards.length >= MAX_BOARD_PASSAGES) {
      setStatusMessage(`Max ${MAX_BOARD_PASSAGES} passages on the board. Remove one before adding another.`);
      return;
    }
    const parsed = parseQuickPassage(addInput.value);
    if (!parsed) {
      setStatusMessage('Enter a valid reference like Gen 6:14, Exod 2:3, 1 Cor 15:45, or Rev 11:4.');
      return;
    }
    if (cards.some(c => samePassage(c.passage, parsed))) {
      setStatusMessage(`${formatVerseRef(parsed)} is already on the board.`);
      return;
    }
    addInput.value = '';
    setStatusMessage(null);
    resetLookup();
    cards = [...cards, createCardState(parsed)];
    renderAll();
    void loadAllCards();
  });

  function buildLookupQuery(imageryTerms: string[]): string {
    const refs = cards.map(c => formatVerseRef(c.passage));
    const extras = imageryTerms.slice(0, 4);
    return [...refs, ...extras].join(' ').trim();
  }

  async function runOnDemandLookup(
    mode: 'discover' | 'challenge' | 'compare_patterns' | 'sequence_parallels' | 'clause_roles',
    imageryTerms: string[]
  ) {
    const reqGen = generation;
    const reqLookup = ++lookupGeneration;
    const query = buildLookupQuery(imageryTerms);
    lookupState = {
      status: 'loading',
      mode,
      query,
      result: null,
      compareResult: null,
      sequenceResults: null,
      clauseRoleResults: null,
      error: null,
    };
    renderLanes();

    if (mode === 'sequence_parallels') {
      const pairs: Array<{ a: ActivePassage; b: ActivePassage }> = [];
      for (let i = 1; i < cards.length; i++) {
        pairs.push({ a: cards[0]!.passage, b: cards[i]!.passage });
      }
      const seqResponses = await Promise.all(
        pairs.map(async pair => {
          const srcRef = formatVerseRef(pair.a);
          const tgtRef = formatVerseRef(pair.b);
          const res = await sequenceParallelsV3Rpc({ source: srcRef, target: tgtRef, permutations: 64 });
          return { pairLabel: `${srcRef} ↔ ${tgtRef}`, res };
        })
      );
      if (reqGen !== generation || reqLookup !== lookupGeneration || element.hidden) return;
      const loaded = seqResponses
        .filter((item): item is { pairLabel: string; res: { data: SequenceParallelsV3Result; error: null; source: 'live' } } => Boolean(item.res.data))
        .map(item => ({ pairLabel: item.pairLabel, data: item.res.data }));
      if (loaded.length === 0) {
        const firstErr = seqResponses.find(i => i.res.error)?.res.error;
        lookupState = {
          status: 'error',
          mode,
          query,
          result: null,
          sequenceResults: null,
          error: firstErr || 'Sequence parallel alignment failed.',
        };
      } else {
        lookupState = {
          status: 'loaded',
          mode,
          query,
          result: null,
          sequenceResults: loaded,
          error: null,
        };
      }
      renderLanes();
      return;
    }

    if (mode === 'clause_roles') {
      const clauseResponses = await Promise.all(
        cards.map(async c => {
          const ref = formatVerseRef(c.passage);
          const res = await clauseRoleQueryV3Rpc({
            book: c.passage.book,
            chapter: c.passage.chapter,
            verse: c.passage.verse,
          });
          return { ref, res };
        })
      );
      if (reqGen !== generation || reqLookup !== lookupGeneration || element.hidden) return;
      const loaded = clauseResponses
        .filter((item): item is { ref: string; res: { data: ClauseRoleQueryV3Result; error: null; source: 'live' } } => Boolean(item.res.data))
        .map(item => ({ ref: item.ref, data: item.res.data }));
      if (loaded.length === 0) {
        const firstErr = clauseResponses.find(i => i.res.error)?.res.error;
        lookupState = {
          status: 'error',
          mode,
          query,
          result: null,
          clauseRoleResults: null,
          error: firstErr || 'Clause role query failed.',
        };
      } else {
        lookupState = {
          status: 'loaded',
          mode,
          query,
          result: null,
          clauseRoleResults: loaded,
          error: null,
        };
      }
      renderLanes();
      return;
    }

    if (mode === 'compare_patterns') {
      const targets = cards.map(c => formatVerseRef(c.passage));
      const cmpRes = await comparePatternsRpc({ targets, limit: 8 });
      if (reqGen !== generation || reqLookup !== lookupGeneration || element.hidden) return;
      if (cmpRes.error || !cmpRes.data) {
        lookupState = {
          status: 'error',
          mode,
          query,
          result: null,
          compareResult: null,
          error: cmpRes.error || 'Pattern comparison failed.',
        };
      } else {
        lookupState = {
          status: 'loaded',
          mode,
          query,
          result: null,
          compareResult: cmpRes.data,
          error: null,
        };
      }
      renderLanes();
      return;
    }

    const res = await discoverBiblicalConnectionsRpc({ query, mode, limit: 8 });
    if (reqGen !== generation || reqLookup !== lookupGeneration || element.hidden) return;

    if (res.error || !res.data) {
      lookupState = {
        status: 'error',
        mode,
        query,
        result: null,
        compareResult: null,
        error: res.error || 'Discovery lookup failed.',
      };
    } else {
      lookupState = {
        status: 'loaded',
        mode,
        query,
        result: res.data,
        compareResult: null,
        error: null,
      };
    }
    renderLanes();
  }

  function makePassageButton(ref: R10PassageRef, reason: string): HTMLButtonElement {
    const target: ActivePassage = { book: ref.book, chapter: ref.chapter, verse: ref.verse };
    const label = ref.ref || formatVerseRef(target);
    const btn = action(label, () => callbacks.navigate(target), 'study-button');
    callbacks.preview.attach(btn, target, reason, ref.end_verse);
    return btn;
  }

  function renderCards(paletteMap: Map<string, number>) {
    cardsMount.replaceChildren();
    for (const card of cards) {
      const cardEl = el('article', 'pattern-board__card');
      const head = el('div', 'pattern-board__card-head');
      const titleWrap = el('div', 'pattern-board__card-title');
      const refText = formatVerseRef(card.passage);
      titleWrap.append(
        el('h3', '', refText),
        el('span', 'pattern-board__badge', card.passage.book <= 39 ? 'OT · Hebrew/Aramaic' : 'NT · Greek')
      );

      const cardActions = el('div', 'pattern-board__card-actions');
      cardActions.append(
        action('Open →', () => callbacks.navigate(card.passage), 'study-button'),
        action('Remove', () => {
          cards = cards.filter(c => !samePassage(c.passage, card.passage));
          resetLookup();
          setStatusMessage(null);
          renderAll();
        }, 'study-button')
      );
      head.append(titleWrap, cardActions);
      cardEl.append(head);

      cardEl.append(
        el('p', 'study-muted', 'World English Bible'),
        el('p', 'pattern-board__english', card.loading ? 'Loading English verse…' : card.english)
      );

      if (card.loading) {
        cardEl.append(status('Loading original-language tokens…'));
      } else if (card.words.length === 0) {
        cardEl.append(status(card.wordsError ?? 'Original-language tokens unavailable for this verse.'));
      } else {
        const tokensBox = el('div', 'pattern-board__tokens');
        tokensBox.dir = card.passage.book <= 39 ? 'rtl' : 'ltr';
        for (const w of card.words) {
          const norm = normalizeStrongs(w.strongs_nr);
          const colorIdx = norm ? paletteMap.get(norm) : undefined;
          const tokenEl = el(
            'div',
            `pattern-board__token${colorIdx !== undefined ? ` pb-match-${colorIdx}` : ''}`
          );
          tokenEl.append(
            el('span', 'pattern-board__token-orig', w.original_word),
            el('span', 'pattern-board__token-tr', w.transliteration || '—'),
            el('span', 'pattern-board__token-gl', w.primary_english || '—'),
            el('span', 'pattern-board__token-str', norm || w.strongs_nr || '—')
          );
          tokensBox.append(tokenEl);
        }
        cardEl.append(tokensBox);
      }

      cardsMount.append(cardEl);
    }
  }

  function renderSequenceBlocksSummary(blocks: SequenceParallelBlockV3[]): HTMLElement {
    const pills = el('div', 'pattern-board__pills');
    for (const blk of blocks) {
      let bundle12 = 0;
      let bundle21 = 0;
      let bundle11 = 0;
      for (const pr of blk.pairs || []) {
        if (pr.bIndices.length > pr.aIndices.length) bundle12++;
        else if (pr.aIndices.length > pr.bIndices.length) bundle21++;
        else bundle11++;
      }
      const bundleSummary = [
        bundle11 ? `${bundle11}× 1:1` : '',
        bundle12 ? `${bundle12}× 1:2` : '',
        bundle21 ? `${bundle21}× 2:1` : '',
      ].filter(Boolean).join(', ');
      const badgeCls = blk.mode === 'INVERSION' ? 'pattern-board__badge pattern-board__badge--inversion' : 'pattern-board__badge pattern-board__badge--concordant';
      const blkBadge = el('span', badgeCls, `${blk.mode} · ${blk.orientation} · score ${blk.score.toFixed(2)}${bundleSummary ? ` (${bundleSummary})` : ''}`);
      pills.append(blkBadge);
    }
    return pills;
  }

  function renderLookupResults(container: HTMLElement) {
    if (lookupState.status === 'idle') return;
    if (lookupState.status === 'loading') {
      const msg =
        lookupState.mode === 'challenge'
          ? 'Checking negative controls and counter-evidence…'
          : lookupState.mode === 'sequence_parallels'
            ? 'Running SW^piece_pol piecewise sequence alignment & 64-perm null test…'
            : lookupState.mode === 'clause_roles'
              ? 'Loading lossless v3 clause roles, polarity & SlotAtom verbs…'
              : 'Searching supporting verses across corpus…';
      container.append(status(msg));
      return;
    }
    if (lookupState.status === 'error') {
      container.append(status(lookupState.error ?? 'Lookup unavailable.'));
      return;
    }

    if (lookupState.mode === 'sequence_parallels' && lookupState.sequenceResults) {
      const resultsBox = el('div', 'pattern-board__lookup-results');
      for (const item of lookupState.sequenceResults) {
        const d = item.data;
        const alignList = d.alignments?.length ? d.alignments : (d.best_alignment ? [d.best_alignment] : []);
        if (alignList.length === 0) {
          const emptyCard = el('div', 'pattern-board__result-card');
          emptyCard.append(
            el('strong', '', item.pairLabel),
            el('p', 'study-muted', `No piecewise clause alignment >= threshold (${d.source_clause_count ?? 0} source clauses).`)
          );
          resultsBox.append(emptyCard);
          continue;
        }
        for (const al of alignList.slice(0, 3)) {
          const card = el('div', 'pattern-board__result-card');
          const badges = el('div', 'pattern-board__pills');
          const hasInv = al.has_inversion || al.blocks.some(b => b.mode === 'INVERSION');
          badges.append(
            el('span', `pattern-board__badge ${hasInv ? 'pattern-board__badge--inversion' : 'pattern-board__badge--concordant'}`, hasInv ? 'INVERSION' : 'CONCORDANT'),
            el('span', 'pattern-board__badge', `${al.arc_kind.replaceAll('_', ' ')}`),
            el('span', 'pattern-board__badge', `p = ${al.p_null.toFixed(4)} (perm)`),
            el('span', 'pattern-board__badge', `${al.evidence_bits.toFixed(2)} bits · raw ${al.raw_score.toFixed(2)}`)
          );
          if (al.has_reversed_order) {
            badges.append(el('span', 'pattern-board__badge pattern-board__badge--inversion', 'REVERSED ORDER'));
          }
          card.append(badges, el('strong', '', `${item.pairLabel} (${al.target_label})`));
          if (al.blocks.length > 0) {
            card.append(renderSequenceBlocksSummary(al.blocks));
          }
          resultsBox.append(card);
        }
        if (d.structural_breaks?.length) {
          const brCard = el('div', 'pattern-board__result-card pattern-board__result-card--warning');
          brCard.append(
            el('span', 'pattern-board__badge', 'SlotAtom / Polarity Breaks'),
            el('p', 'study-muted', d.structural_breaks.map(b => `${b.prev_ref} → ${b.at_ref} (${b.reason.replaceAll('_', ' ')}, J=${b.concept_jaccard})`).join(' · '))
          );
          resultsBox.append(brCard);
        }
      }
      container.append(resultsBox);
      return;
    }

    if (lookupState.mode === 'clause_roles' && lookupState.clauseRoleResults) {
      const resultsBox = el('div', 'pattern-board__lookup-results');
      for (const item of lookupState.clauseRoleResults) {
        const verses = item.data.verses || [];
        const card = el('div', 'pattern-board__result-card');
        card.append(el('strong', '', `${item.ref} — ${item.data.total_clauses ?? 0} lossless clause(s)`));
        if (verses.length === 0) {
          card.append(el('p', 'study-muted', 'No clause-role annotations indexed for this verse.'));
        } else {
          for (const v of verses) {
            for (const cl of v.clauses) {
              const row = el('div', 'pattern-board__pills');
              const isNeg = cl.polarity === 'negative' || (cl.neg_markers?.length ?? 0) > 0;
              row.append(
                el('span', `pattern-board__badge ${isNeg ? 'pattern-board__badge--neg' : 'pattern-board__badge--concordant'}`, isNeg ? 'NEG' : 'POS')
              );
              if (cl.predicate) {
                row.append(el('span', 'pattern-board__pill', `Pred: ${cl.predicate.lm || cl.predicate.s || ''} "${cl.predicate.g || ''}"${cl.slot_atom?.verb_stem ? ` (${cl.slot_atom.verb_stem})` : ''}`));
              }
              if (cl.subjects?.length) {
                row.append(el('span', 'pattern-board__pill', `Subj: ${cl.subjects.join(', ')}`));
              }
              if (cl.objects?.length) {
                row.append(el('span', 'pattern-board__pill', `Obj: ${cl.objects.join(', ')}`));
              }
              if (cl.slot_atom?.is_idiom) {
                row.append(el('span', 'pattern-board__badge', 'IDIOM'));
              }
              if (cl.concept_ids?.length) {
                row.append(el('span', 'study-muted', `Concepts: ${cl.concept_ids.slice(0, 4).join(', ')}`));
              }
              card.append(row);
            }
          }
        }
        resultsBox.append(card);
      }
      container.append(resultsBox);
      return;
    }

    if (lookupState.mode === 'compare_patterns' && lookupState.compareResult) {
      const cmp = lookupState.compareResult;
      const resultsBox = el('div', 'pattern-board__lookup-results');
      if (cmp.sequence_alignment && Array.isArray(cmp.sequence_alignment.blocks) && cmp.sequence_alignment.blocks.length > 0) {
        const seq = cmp.sequence_alignment;
        const hasInv = seq.blocks.some(b => b.mode === 'INVERSION');
        const seqCard = el('div', 'pattern-board__result-card');
        const badges = el('div', 'pattern-board__pills');
        badges.append(
          el('span', `pattern-board__badge ${hasInv ? 'pattern-board__badge--inversion' : 'pattern-board__badge--concordant'}`, hasInv ? 'SW^piece_pol · INVERSION' : 'SW^piece_pol · CONCORDANT'),
          el('span', 'pattern-board__badge', `${seq.arc_kind.replaceAll('_', ' ')}`),
          el('span', 'pattern-board__badge', `p = ${Number(seq.p_null ?? 1).toFixed(4)}`),
          el('span', 'pattern-board__badge', `${Number(seq.evidence_bits ?? 0).toFixed(2)} bits`)
        );
        seqCard.append(badges, renderSequenceBlocksSummary(seq.blocks));
        resultsBox.append(seqCard);
      }
      const tessList = Array.isArray(cmp.tesserae_parallels) ? (cmp.tesserae_parallels as Array<Record<string, unknown>>) : [];
      for (const tp of tessList) {
        const card = el('div', 'pattern-board__result-card');
        card.append(
          el('span', 'pattern-board__badge', `Tesserae V6 Parallel · Score ${String(tp.score ?? 0)} (norm ${String(tp.normalized_score ?? 0)})`),
          el('strong', '', `${String(tp.from_passage || '')} ↔ ${String(tp.to_passage || '')} — ${String(tp.rare_match_count ?? 0)} rare match(es)`),
          el('p', 'study-muted', `Matched features: ${(Array.isArray(tp.matched_features) ? tp.matched_features : []).map((f: any) => `${String(f.feature_key || '')} (${String(f.channel || '')}, df=${String(f.df ?? '?')})`).join(', ')}`)
        );
        resultsBox.append(card);
      }
      const cta = cmp.cross_testament_alignment as Record<string, unknown> | null | undefined;
      if (cta && typeof cta === 'object' && Array.isArray(cta.matched_pairs) && cta.matched_pairs.length > 0) {
        const card = el('div', 'pattern-board__result-card');
        card.append(
          el('span', 'pattern-board__badge', `LXX Bipartite Alignment · Tier ${String(cta.tier ?? '')}`),
          el('strong', '', `${String(cta.source_ref || '')} ↔ ${String(cta.target_ref || '')}`),
          el('p', '', (cta.matched_pairs as Array<Record<string, unknown>>).map(mp => `${String(mp.ot_lemma || mp.ot_bs || '')} → ${String(mp.nt_lemma || mp.nt_bs || '')}`).join(', '))
        );
        resultsBox.append(card);
      }
      const conns = Array.isArray(cmp.combined_connections) ? (cmp.combined_connections as R10ConnectionSummary[]).slice(0, 4) : [];
      for (const conn of conns) {
        const card = el('div', 'pattern-board__result-card');
        card.append(
          el('span', 'pattern-board__badge', `Tier ${conn.evidence_tier} · ${conn.epistemic_class.replaceAll('_', ' ')}`),
          el('strong', '', conn.title),
          el('p', '', conn.explanation)
        );
        if (conn.passages?.length) {
          const refs = el('div', 'pattern-board__ref-list');
          for (const p of conn.passages.slice(0, 5)) {
            refs.append(makePassageButton(p, `Pattern comparison witness: ${conn.title}`));
          }
          card.append(refs);
        }
        resultsBox.append(card);
      }
      if (resultsBox.childElementCount === 0) {
        resultsBox.append(status('No cross-passage Tesserae, LXX, or structural alignments surfaced for these targets.'));
      }
      container.append(resultsBox);
      return;
    }

    const res = lookupState.result;
    if (!res) return;

    const resultsBox = el('div', 'pattern-board__lookup-results');
    if (res.iterative_analysis?.explanation) {
      resultsBox.append(el('p', 'study-muted', res.iterative_analysis.explanation));
    }

    const warnings: R10ControlOrWarning[] =
      lookupState.mode === 'challenge'
        ? [...(res.iterative_analysis?.challenges ?? []), ...(res.controls_and_alternatives ?? [])]
        : (res.controls_and_alternatives ?? []).slice(0, 2);

    const seenControlIds = new Set<string>();
    for (const ctrl of warnings) {
      if (seenControlIds.has(ctrl.control_id)) continue;
      seenControlIds.add(ctrl.control_id);
      const card = el('div', 'pattern-board__result-card pattern-board__result-card--warning');
      card.append(
        el('span', 'pattern-board__badge', ctrl.kind.replaceAll('_', ' ')),
        el('strong', '', ctrl.title),
        el('p', '', ctrl.explanation)
      );
      if (ctrl.passages?.length) {
        const refs = el('div', 'pattern-board__ref-list');
        for (const p of ctrl.passages.slice(0, 6)) {
          refs.append(makePassageButton(p, `Control witness: ${ctrl.title}`));
        }
        card.append(refs);
      }
      resultsBox.append(card);
    }

    const connections: R10ConnectionSummary[] = (res.strongest_connections ?? []).slice(0, 5);
    for (const conn of connections) {
      const card = el('div', 'pattern-board__result-card');
      card.append(
        el('span', 'pattern-board__badge', `Tier ${conn.evidence_tier} · ${conn.epistemic_class.replaceAll('_', ' ')}`),
        el('strong', '', conn.title),
        el('p', '', conn.explanation)
      );
      if (conn.passages?.length) {
        const refs = el('div', 'pattern-board__ref-list');
        for (const p of conn.passages.slice(0, 6)) {
          refs.append(makePassageButton(p, `Discovery witness: ${conn.title}`));
        }
        card.append(refs);
      }
      resultsBox.append(card);
    }

    const xrefs = (res.related_discoveries?.cross_references ?? []).slice(0, 4);
    if (connections.length === 0 && xrefs.length > 0) {
      for (const xr of xrefs) {
        const card = el('div', 'pattern-board__result-card');
        card.append(el('strong', '', `${xr.from_ref} ↔ ${xr.to_ref}`));
        if (xr.anchor_phrase) card.append(el('p', 'study-muted', xr.anchor_phrase));
        const refs = el('div', 'pattern-board__ref-list');
        refs.append(
          makePassageButton(xr.from_passage, `Cross-reference ${xr.from_ref}`),
          makePassageButton(xr.to_passage, `Cross-reference ${xr.to_ref}`)
        );
        card.append(refs);
        resultsBox.append(card);
      }
    }

    if (resultsBox.childElementCount === 0) {
      resultsBox.append(status(`No additional records returned for "${lookupState.query}".`));
    }
    container.append(resultsBox);
  }

  function renderHypothesisLane(
    lane4: HTMLElement,
    passages: ActivePassage[],
    shared: SharedLemmaInfo[],
    imagery: DetectedFeatureItem[]
  ) {
    lane4.replaceChildren(el('h3', 'pattern-board__lane-title', '4. User hypotheses'));
    const matching = explorationState
      .getHypotheses()
      .filter(h => hypothesisTouchesPassages(h, passages));

    if (matching.length === 0) {
      lane4.append(el('p', 'study-muted', 'No saved user hypotheses touch these passages yet.'));
    } else {
      for (const hyp of matching) {
        const card = el('div', 'pattern-board__result-card');
        card.append(
          el('span', 'pattern-board__badge', hyp.status),
          el('strong', '', `${hyp.from.label} ↔ ${hyp.to.label}`),
          el('p', '', hyp.note)
        );
        if (hyp.linkedRefs?.length) {
          const refs = el('div', 'pattern-board__ref-list');
          for (const refStr of hyp.linkedRefs) {
            const parsed = parseQuickPassage(refStr);
            if (parsed) {
              const btn = action(refStr, () => callbacks.navigate(parsed), 'study-button');
              callbacks.preview.attach(btn, parsed, `Hypothesis reference: ${refStr}`);
              refs.append(btn);
            } else {
              refs.append(el('span', 'pattern-board__badge', refStr));
            }
          }
          card.append(refs);
        }
        lane4.append(card);
      }
    }

    const hypForm = el('div', 'pattern-board__hyp-form');
    const hypInput = document.createElement('input');
    hypInput.type = 'text';
    hypInput.className = 'pattern-board__hyp-input';
    hypInput.value = hypDraftNote;
    hypInput.placeholder = 'Optional hypothesis summary…';
    hypInput.setAttribute('aria-label', 'Hypothesis summary');
    hypInput.addEventListener('input', () => {
      hypDraftNote = hypInput.value;
    });

    const saveBtn = action('+ Tag as my hypothesis', () => {
      if (passages.length < 2) return;
      const fromAnchor = makeVerseAnchor(passages[0]!);
      const toAnchor = makeVerseAnchor(passages[passages.length - 1]!);
      const refsText = passages.map(formatVerseRef).join(' ↔ ');
      const autoSummaryParts = [`Comparison: ${refsText}`];
      if (shared.length > 0) {
        autoSummaryParts.push(
          `shared verified lemmas (${shared.map(s => `${s.transliteration} ${s.strongs}`).slice(0, 4).join(', ')})`
        );
      }
      if (imagery.length > 0) {
        autoSummaryParts.push(`imagery (${imagery.map(i => i.label).slice(0, 3).join(', ')})`);
      }
      const summary = hypDraftNote.trim() || autoSummaryParts.join(' · ');
      hypDraftNote = '';
      callbacks.onSaveHypothesis(fromAnchor, toAnchor, summary);
      renderLanes();
    }, 'study-button primary');

    hypForm.append(hypInput, saveBtn);
    lane4.append(hypForm);
  }

  function renderLanes() {
    lanesMount.replaceChildren();
    if (cards.length < 2) return;

    const anyLoading = cards.some(c => c.loading);
    const { hasCrossLanguagePair, shared, paletteMap, uniqueByPassage } = computeLexicalLanes(cards);
    const { quantities, imagery, queryTerms } = detectQuantitiesAndImagery(cards);

    // Lane 1: Shared verified words (same-language Strong's)
    const lane1 = el('section', 'pattern-board__lane');
    lane1.append(el('h3', 'pattern-board__lane-title', '1. Shared verified words (same-language Strong’s)'));
    if (hasCrossLanguagePair) {
      const notice = el('p', 'pattern-board__notice', CROSS_LANGUAGE_NOTICE);
      notice.setAttribute('role', 'note');
      lane1.append(notice);
    }
    if (anyLoading) {
      lane1.append(status('Loading original-language tokens…'));
    } else if (shared.length === 0) {
      lane1.append(
        el('p', 'study-muted', 'No shared same-language Strong’s content lemmas across these passages (common stopwords excluded).')
      );
    } else {
      const pills = el('div', 'pattern-board__pills');
      for (const item of shared) {
        const idx = paletteMap.get(item.strongs) ?? 0;
        const sharedRefs = item.passages.map(formatVerseRef).join(' · ');
        const pill = el('span', `pattern-board__pill pb-match-${idx}`);
        pill.append(
          el('strong', '', item.original),
          document.createTextNode(` ${item.transliteration} · "${item.gloss}" (${item.strongs}) — ${sharedRefs}`)
        );
        pills.append(pill);
      }
      lane1.append(pills);
    }

    // Lane 2: Differences ("Why this may not be the same pattern")
    const lane2 = el('section', 'pattern-board__lane');
    lane2.append(el('h3', 'pattern-board__lane-title', '2. Differences ("Why this may not be the same pattern")'));
    if (hasCrossLanguagePair) {
      lane2.append(
        el('p', 'study-muted', 'Testament corpora differ (OT Hebrew/Aramaic vs NT Greek); distinct vocabularies cannot be equated without a documented bridge.')
      );
    }
    if (anyLoading) {
      lane2.append(status('Calculating distinct content lemmas…'));
    } else {
      for (const entry of uniqueByPassage) {
        const group = el('div', 'pattern-board__diff-group');
        const ref = formatVerseRef(entry.passage);
        group.append(el('strong', '', `${ref} (${entry.unique.length} unique content lemmas)`));
        if (entry.unique.length === 0) {
          group.append(el('p', 'study-muted', 'No unique content lemmas outside shared words.'));
        } else {
          const pills = el('div', 'pattern-board__pills');
          for (const u of entry.unique) {
            pills.append(
              el('span', 'pattern-board__pill', `${u.original} · ${u.transliteration} · "${u.gloss}" (${u.strongs})`)
            );
          }
          group.append(pills);
        }
        lane2.append(group);
      }
    }

    // Lane 3: Quantities, imagery & explicit lookup
    const lane3 = el('section', 'pattern-board__lane');
    lane3.append(el('h3', 'pattern-board__lane-title', '3. Quantities, imagery & explicit lookup'));
    if (anyLoading) {
      lane3.append(status('Scanning token glosses for quantities and imagery…'));
    } else {
      if (quantities.length > 0) {
        const qPills = el('div', 'pattern-board__pills');
        lane3.append(el('strong', '', 'Counted / quantity tokens'));
        for (const q of quantities) {
          qPills.append(el('span', 'pattern-board__pill', `${q.label} — ${q.detail}`));
        }
        lane3.append(qPills);
      }
      if (imagery.length > 0) {
        const iPills = el('div', 'pattern-board__pills');
        lane3.append(el('strong', '', 'Observable imagery glosses'));
        for (const img of imagery) {
          iPills.append(el('span', 'pattern-board__pill', `${img.label} — ${img.detail}`));
        }
        lane3.append(iPills);
      }
      if (quantities.length === 0 && imagery.length === 0) {
        lane3.append(
          el('p', 'study-muted', 'No explicit quantity tokens or concrete imagery glosses flagged in these verses.')
        );
      }

      const lookupActions = el('div', 'pattern-board__lookup-actions');
      const findBtn = action(
        lookupState.status === 'loading' && lookupState.mode === 'discover'
          ? 'Finding supporting verses…'
          : 'Find supporting verses',
        () => { void runOnDemandLookup('discover', queryTerms); },
        'study-button'
      );
      findBtn.disabled = lookupState.status === 'loading';

      const challengeBtn = action(
        lookupState.status === 'loading' && lookupState.mode === 'challenge'
          ? 'Challenging pattern…'
          : 'Challenge pattern',
        () => { void runOnDemandLookup('challenge', queryTerms); },
        'study-button'
      );
      challengeBtn.disabled = lookupState.status === 'loading';

      const cmpPatternsBtn = action(
        lookupState.status === 'loading' && lookupState.mode === 'compare_patterns'
          ? 'Comparing patterns…'
          : 'Compare patterns (LXX + Tesserae)',
        () => { void runOnDemandLookup('compare_patterns', queryTerms); },
        'study-button'
      );
      cmpPatternsBtn.disabled = lookupState.status === 'loading' || cards.length < 2;

      const seqParallelsBtn = action(
        lookupState.status === 'loading' && lookupState.mode === 'sequence_parallels'
          ? 'Aligning sequences…'
          : 'Sequence parallels (SW^piece_pol)',
        () => { void runOnDemandLookup('sequence_parallels', queryTerms); },
        'study-button'
      );
      seqParallelsBtn.disabled = lookupState.status === 'loading' || cards.length < 2;

      const clauseRolesBtn = action(
        lookupState.status === 'loading' && lookupState.mode === 'clause_roles'
          ? 'Loading clause roles…'
          : 'Clause roles & polarity',
        () => { void runOnDemandLookup('clause_roles', queryTerms); },
        'study-button'
      );
      clauseRolesBtn.disabled = lookupState.status === 'loading' || cards.length < 1;

      const fullQuery = lookupState.query || buildLookupQuery(queryTerms);
      const openFullBtn = action('Open in Discover →', () => {
        callbacks.onOpenFullDiscovery(fullQuery, lookupState.mode === 'challenge' ? 'challenge' : 'discover');
      }, 'text-action');

      lookupActions.append(findBtn, challengeBtn, cmpPatternsBtn, seqParallelsBtn, clauseRolesBtn, openFullBtn);
      lane3.append(lookupActions);
      renderLookupResults(lane3);
    }

    // Lane 4: User hypotheses
    const lane4 = el('section', 'pattern-board__lane');
    renderHypothesisLane(lane4, cards.map(c => c.passage), shared, imagery);

    lanesMount.append(lane1, lane2, lane3, lane4);
  }

  function renderAll() {
    emptyMount.replaceChildren();
    if (cards.length === 0) {
      emptyMount.append(
        el('p', 'study-muted', 'Select a starter comparison above or add 2–3 verses to compare observable features side by side.')
      );
      cardsMount.replaceChildren();
      lanesMount.replaceChildren();
      return;
    }

    const { paletteMap } = computeLexicalLanes(cards);
    renderCards(paletteMap);

    if (cards.length < 2) {
      emptyMount.append(
        el('p', 'study-muted', 'Add at least one more passage (2–3 total) to compute shared words, differences, imagery, and hypotheses.')
      );
      lanesMount.replaceChildren();
      return;
    }

    renderLanes();
  }

  explorationState.subscribe(() => {
    if (!element.hidden && cards.length >= 2) {
      const lane4 = lanesMount.children[3] as HTMLElement | undefined;
      if (lane4) {
        const { shared } = computeLexicalLanes(cards);
        const { imagery } = detectQuantitiesAndImagery(cards);
        renderHypothesisLane(lane4, cards.map(c => c.passage), shared, imagery);
      }
    }
  });

  function open(passages?: ActivePassage[]) {
    element.hidden = false;
    if (passages && passages.length > 0) {
      setBoardPassages(passages);
      return;
    }
    if (cards.length > 0) {
      renderAll();
      if (cards.some(c => c.loading)) void loadAllCards();
      return;
    }
    renderAll();
  }

  function close() {
    generation += 1;
    lookupGeneration += 1;
    element.hidden = true;
  }

  function toggle() {
    if (element.hidden) open();
    else close();
  }

  return {
    element,
    open,
    toggle,
    isOpen: () => !element.hidden,
    close,
  };
}
