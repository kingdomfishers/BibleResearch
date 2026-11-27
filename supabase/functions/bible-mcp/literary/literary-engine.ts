// @file: src/relationships/literary-engine.ts
// Multi-edition Literary Structure Discovery Engine.
// Pure TypeScript compatible with Browser, Cloudflare Workers, Deno, and Node strip-types.
// Zero hardcoded passage rules; preserves distinct evidence channels and epistemic classes.

import {
  detectNoveltyBoundaries,
  detectPeltChangepoints,
  discoverChiasms,
  induceTemplate,
  repeatedPhrases,
  type LiteraryEvent,
} from './literary-structure.mjs';
import {
  compareOriginalForms,
  detectOnomasticValenceWordplays,
  detectSyntacticTalionAndPolyptoton,
  detectWordplayContextCues,
  normalizeOriginalForm,
  scoreGlossValence,
} from './wordplay-engine.ts';
import type {
  AcrosticFinding,
  CommandFulfillmentLink,
  CrossUnitCorrespondence,
  KeyWordDistribution,
  LiteraryAnalysisOptions,
  LiteraryAnalysisResult,
  LiteraryClauseFrame,
  LiteraryDeviationItem,
  LiteraryEdition,
  LiteraryPatternFamily,
  LiteraryPatternSpan,
  LiterarySection,
  LiterarySubunit,
  LiteraryToken,
  LiteraryUnit,
  LxxEditionComparison,
  ReconstructedTemplateSlot,
  SegmentationCandidate,
  SlotAtom,
  SpeakerSegment,
  SymmetryPattern,
  ThematicCluster,
  WordplayFinding,
} from './literary-types.ts';

export type * from './literary-types.ts';

const BOOK_NAMES: Readonly<Record<number, string>> = {
  1: 'Genesis', 2: 'Exodus', 3: 'Leviticus', 4: 'Numbers', 5: 'Deuteronomy',
  6: 'Joshua', 7: 'Judges', 8: 'Ruth', 9: '1 Samuel', 10: '2 Samuel',
  11: '1 Kings', 12: '2 Kings', 13: '1 Chronicles', 14: '2 Chronicles',
  15: 'Ezra', 16: 'Nehemiah', 17: 'Esther', 18: 'Job', 19: 'Psalms',
  20: 'Proverbs', 21: 'Ecclesiastes', 22: 'Song of Solomon', 23: 'Isaiah',
  24: 'Jeremiah', 25: 'Lamentations', 26: 'Ezekiel', 27: 'Daniel', 28: 'Hosea',
  29: 'Joel', 30: 'Amos', 31: 'Obadiah', 32: 'Jonah', 33: 'Micah',
  34: 'Nahum', 35: 'Habakkuk', 36: 'Zephaniah', 37: 'Haggai', 38: 'Zechariah',
  39: 'Malachi', 40: 'Matthew', 41: 'Mark', 42: 'Luke', 43: 'John',
  44: 'Acts', 45: 'Romans', 46: '1 Corinthians', 47: '2 Corinthians',
  48: 'Galatians', 49: 'Ephesians', 50: 'Philippians', 51: 'Colossians',
  52: '1 Thessalonians', 53: '2 Thessalonians', 54: '1 Timothy', 55: '2 Timothy',
  56: 'Titus', 57: 'Philemon', 58: 'Hebrews', 59: 'James', 60: '1 Peter',
  61: '2 Peter', 62: '1 John', 63: '2 John', 64: '3 John', 65: 'Jude',
  66: 'Revelation',
};

const HEBREW_ALPHABET = [
  'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'כ',
  'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ', 'ק', 'ר', 'ש', 'ת',
] as const;

const HEBREW_FINAL_MAP: Readonly<Record<string, string>> = {
  ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ',
};

const FUNCTION_STRONGS = new Set([
  'H853', 'H0853', 'H854', 'H0854', 'H4480', 'H413', 'H0413', 'H5921', 'H518', 'H0518',
  'H3588', 'H834', 'H0834', 'H1931', 'H859', 'H0859', 'H589', 'H0589', 'H2088', 'H2063',
  'H428', 'H0428', 'H3605', 'H3808', 'H3541', 'H3651', 'H408', 'H0408', 'H9001', 'H9002',
  'H9003', 'H9004', 'H9005', 'H9006', 'H9007', 'H9008', 'H9009', 'H9010', 'H9011',
  'G3588', 'G2532', 'G1161', 'G846', 'G0846', 'G1722', 'G1519', 'G3754', 'G1473', 'G4771',
  'G3778', 'G3739', 'G5100', 'G1510', 'G1063', 'G3361', 'G3756', 'G3761', 'G235', 'G0235',
  'G1537', 'G575', 'G0575', 'G2596', 'G3326', 'G4012', 'G4314', 'G5228', 'G5613', 'G3767',
]);

const NEGATION_STRONGS = new Set(['H3808', 'H0408', 'H408', 'H369', 'H0369', 'G3756', 'G3361', 'G3761', 'G3762']);
const NOTABLE_COUNTS = new Set([3, 4, 7, 10, 12, 14, 22, 40]);

export interface CompactLxxVerseInput {
  book_no: number;
  chapter: number;
  verse_nr: number;
  text: string;
  norm: string;
  word_count: number;
  tail_text?: string;
}

export interface CompactClauseFrameInput {
  id: string;
  verseId: number;
  ref: string;
  startPos: number;
  endPos: number;
  predicateLemma: string;
  predicateStrongs: string;
  predicateScript: string;
  predicateWordId: string | null;
  predicatePerson: string | null;
  predicateMood: string | null;
  subjectLemmas: string[];
  objectLemmas: string[];
  modifierPairs: LiteraryClauseFrame['modifierPairs'];
  clauseType: LiteraryClauseFrame['clauseType'];
  isDirectSpeech: boolean;
  sourceNodeId?: string;
}

export interface ShardVerseInput {
  verse_id: number;
  book: number;
  chapter: number;
  verse_nr: number;
  tokens?: Record<string, unknown>[];
  morphhb_tokens?: Record<string, unknown>[];
  macula_hebrew_morphemes?: Record<string, unknown>[];
  macula_greek_tokens?: Record<string, unknown>[];
  syntax_nodes?: Record<string, unknown>[];
  syntax_edges?: Record<string, unknown>[];
  literary_clauses?: CompactClauseFrameInput[] | null;
  hebrew_lxx_verse_map?: Record<string, unknown>[];
  lxx_verses?: CompactLxxVerseInput[];
  lxx_target_tokens?: Record<string, { ordinal?: number; word_text?: string; normalized_word?: string }[]>;
  english_editions?: Record<string, string>;
}

export interface LxxWordInput {
  book_no: number;
  chapter: number;
  verse_nr: number;
  ordinal: number;
  word_text: string;
  normalized_word: string;
  source_record_id?: string;
}

export interface R13CorpusContext {
  motifsByBs?: Record<string, string[]>;
  motifsById?: Record<string, { motif_id: string; nodes: string[]; node_meta?: { strongs?: string; script?: string; gloss?: string }[] }>;
  conceptAliases?: Record<string, { strongs?: string[]; motifs?: string[]; note?: string }>;
}

export interface LiteraryEngineInput {
  passage: string;
  verses: ShardVerseInput[];
  lxxWords?: LxxWordInput[];
  r13?: R13CorpusContext;
  truncated?: boolean;
}

function normStrongs(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return '';
  const m = /^([HG])0*(\d+)([A-Z]?)$/.exec(s);
  return m ? `${m[1]}${m[2]}${m[3]}` : s;
}

function stripHebrew(raw: string): string {
  const nfd = String(raw ?? '').normalize('NFD');
  let out = '';
  for (let i = 0; i < nfd.length; i++) {
    const code = nfd.charCodeAt(i);
    if (code >= 0x0591 && code <= 0x05c7) continue;
    const ch = nfd[i];
    if (ch >= 'א' && ch <= 'ת') out += HEBREW_FINAL_MAP[ch] ?? ch;
  }
  return out;
}

function stripGreek(raw: string): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^α-ω]/g, '');
}

function formatVerseRef(book: number, chapter: number, verse: number): string {
  return `${BOOK_NAMES[book] ?? `Book ${book}`} ${chapter}:${verse}`;
}

function isFunctionToken(strongs: string, posClass: string, grammarCode: string): boolean {
  if (FUNCTION_STRONGS.has(strongs)) return true;
  if (/^H90\d{2}$/.test(strongs)) return true;
  const cls = posClass.toLowerCase();
  if (['conjunction', 'preposition', 'article', 'particle', 'pronoun'].includes(cls)) return true;
  if (/^(?:CONJ|PREP|T-|P-|R-|C-|I-|X-)/.test(grammarCode)) return true;
  return false;
}

function isProperNounToken(t: Pick<LiteraryToken, 'grammarCode' | 'posClass'>): boolean {
  return /(?:^|\/)H?Np|N-PRI/.test(t.grammarCode) || t.posClass.toLowerCase() === 'proper noun';
}

function isNumeralToken(t: Pick<LiteraryToken, 'grammarCode' | 'posClass'>): boolean {
  return /(?:^|\/)H?A[co]|A-NUI/.test(t.grammarCode) || t.posClass.toLowerCase() === 'number';
}

function isVariableSlotToken(t: Pick<LiteraryToken, 'grammarCode' | 'posClass'>): boolean {
  return isProperNounToken(t) || isNumeralToken(t);
}

function extractHebPerson(grammar: string): string | null {
  const m = /(?:^|[\/A-Z])V[a-zA-Z]{2}([123][mfc][sp])/.exec(grammar);
  if (m) return m[1];
  const m2 = /(?:^|\/)V[a-zA-Z]([123][mfc][sp])/.exec(grammar);
  return m2 ? m2[1] : null;
}

function extractHebMood(grammar: string): string | null {
  if (/(?:^|[\/HA])V[a-zA-Z]v/.test(grammar)) return 'imperative';
  if (/(?:^|[\/HA])V[a-zA-Z][ju]/.test(grammar)) return 'jussive';
  if (/(?:^|[\/HA])V[a-zA-Z]h/.test(grammar)) return 'cohortative';
  if (/(?:^|[\/HA])V[a-zA-Z]w/.test(grammar)) return 'wayyiqtol';
  if (/(?:^|[\/HA])V[a-zA-Z][qi]/.test(grammar)) return 'yiqtol';
  if (/(?:^|[\/HA])V[a-zA-Z]p/.test(grammar)) return 'qatal';
  return null;
}

function extractGreekPerson(grammar: string, decoded: Record<string, unknown> | undefined): string | null {
  const rawP = decoded?.person ? String(decoded.person).toLowerCase() : '';
  const pMap: Record<string, string> = { first: '1', second: '2', third: '3', '1': '1', '2': '2', '3': '3' };
  const p = pMap[rawP] ?? '';
  const num = decoded?.number ? String(decoded.number).toLowerCase()[0] : '';
  if (p && num) return `${p}${num}`;
  const m = /^V-[A-Z0-9]{2,4}-([123][SP])/.exec(grammar);
  return m ? m[1].toLowerCase() : null;
}

function extractParagraphMarker(surface: string, edition: LiteraryEdition): 'P' | 'S' | null {
  if (edition === 'hbo') {
    if (/׃\s*פ\s*$/.test(surface) || /\s+פ\s*$/.test(surface)) return 'P';
    if (/׃\s*ס\s*$/.test(surface) || /\s+ס\s*$/.test(surface)) return 'S';
    return null;
  }
  return /¶/.test(surface) ? 'P' : null;
}

export function tokenizeShardVerses(verses: ShardVerseInput[]): {
  edition: LiteraryEdition;
  tokens: LiteraryToken[];
  verseList: ShardVerseInput[];
} {
  const sorted = [...verses].sort(
    (a, b) => a.book - b.book || a.chapter - b.chapter || a.verse_nr - b.verse_nr
  );
  const firstBook = sorted[0]?.book ?? 1;
  const edition: LiteraryEdition = firstBook <= 39 ? 'hbo' : 'grc_nt';
  const tokens: LiteraryToken[] = [];

  for (const v of sorted) {
    const rawTokens = Array.isArray(v.tokens) ? v.tokens : [];
    const morphhbByPos = new Map<number, Record<string, unknown>>();
    for (const m of v.morphhb_tokens ?? []) {
      const wn = Number(m.word_num);
      if (Number.isInteger(wn)) morphhbByPos.set(wn, m);
    }

    const sortedToks = [...rawTokens].sort((a, b) => Number(a.word_position) - Number(b.word_position));
    for (let ti = 0; ti < sortedToks.length; ti++) {
      const t = sortedToks[ti];
      const pos = Number(t.word_position);
      const wordId = Number(t.word_id ?? 0);
      const surfaceForm = String(t.surface_form ?? '');
      const strongs = normStrongs(t.base_strongs);
      const grammarCode = String(t.grammar_code ?? t.word_grammar_code ?? '');
      const decoded = (t.decoded_morphology && typeof t.decoded_morphology === 'object'
        ? t.decoded_morphology
        : {}) as Record<string, unknown>;
      const morphemes = Array.isArray(t.morphemes) ? (t.morphemes as Record<string, unknown>[]) : [];
      const stemMorpheme =
        morphemes.find(m => m.morpheme_role === 'stem') ??
        morphemes[morphemes.length - 1] ??
        null;
      const rawLemmaKey = stemMorpheme?.lemma_key
        ? String(stemMorpheme.lemma_key)
        : t.lemma_key
          ? String(t.lemma_key)
          : '';
      const lemmaScript = stemMorpheme?.lemma_script
        ? String(stemMorpheme.lemma_script)
        : t.lemma_script
          ? String(t.lemma_script)
          : t.lemma
            ? String(t.lemma)
            : surfaceForm;
      const lemmaKey = rawLemmaKey || (strongs ? `strongs:${strongs}` : `surface:${surfaceForm}`);
      const lemmaSource = rawLemmaKey ? 'occurrence' : 'strongs_fallback';
      const posClass = String(decoded.pos ?? t.pos_class ?? '');
      const cant = morphhbByPos.get(pos)?.cantillation ?? t.cantillation;
      const consonantal =
        edition === 'hbo'
          ? stripHebrew(lemmaScript || surfaceForm)
          : stripGreek(lemmaScript || surfaceForm);

      const person =
        edition === 'hbo'
          ? extractHebPerson(grammarCode)
          : extractGreekPerson(grammarCode, decoded);
      const mood =
        edition === 'hbo'
          ? extractHebMood(grammarCode)
          : decoded.mood
            ? String(decoded.mood).toLowerCase()
            : null;

      tokens.push({
        id: `${edition}:${v.verse_id}:${pos}`,
        edition,
        wordId,
        verseId: v.verse_id,
        book: v.book,
        chapter: v.chapter,
        verse: v.verse_nr,
        ref: formatVerseRef(v.book, v.chapter, v.verse_nr),
        pos,
        index: tokens.length,
        surfaceForm,
        transliteration: String(t.transliteration ?? ''),
        gloss: String(
          t.attested_english_gloss ??
            t.gloss ??
            (Array.isArray(t.english_translations) ? t.english_translations[0] : '') ??
            ''
        ),
        strongs,
        lemmaKey,
        lemmaSource,
        lemmaScript,
        consonantal,
        grammarCode,
        posClass,
        person: person ?? (t.person != null ? String(t.person) : null),
        number: decoded.number ? String(decoded.number) : t.number ? String(t.number) : null,
        gender: decoded.gender ? String(decoded.gender) : t.gender ? String(t.gender) : null,
        stem: decoded.stem ? String(decoded.stem) : t.stem ? String(t.stem) : null,
        mood: mood ?? (t.mood != null ? String(t.mood) : null),
        cantillation: cant != null ? String(cant) : null,
        masoreticBreak: extractParagraphMarker(surfaceForm, edition),
        isFunctionWord: isFunctionToken(strongs, posClass, grammarCode),
        isEndOfVerse: ti === sortedToks.length - 1,
      });
    }
  }

  return { edition, tokens, verseList: sorted };
}

function classifyClauseType(
  predStrong: string,
  predMood: string | null,
  isLastInVerse: boolean,
  clauseText: string,
  inDirectSpeech: boolean,
  clauseStrongs: string[] = [],
  prevVerseStrongs: string[] = []
): LiteraryClauseFrame['clauseType'] {
  if (predStrong === 'H559' || predStrong === 'H1696' || predStrong === 'G3004' || predStrong === 'G2036') {
    return 'speech_opener';
  }
  if (
    predStrong === 'H7200' ||
    ((predStrong === 'H2896' || predStrong === 'H2895') &&
      (clauseStrongs.includes('H7200') || prevVerseStrongs.includes('H7200')))
  ) {
    return 'evaluation';
  }
  if (predStrong === 'H7121') return 'naming';
  if (predStrong === 'H1288' || predStrong === 'G3107') return 'blessing';
  if (
    inDirectSpeech &&
    (predMood === 'jussive' || predMood === 'imperative' || predMood === 'cohortative' || predMood === 'yiqtol')
  ) {
    return 'command';
  }
  if (
    /ויהי\s*כנ|ויעש\s*כנ|ἐγένετο οὕτως/.test(clauseText) ||
    (clauseStrongs.includes('H1961') && clauseStrongs.includes('H3651')) ||
    (clauseStrongs.includes('H6213') && clauseStrongs.includes('H3651'))
  ) {
    return 'fulfillment';
  }
  if (
    clauseStrongs.includes('H6153') ||
    clauseStrongs.includes('H1242') ||
    (isLastInVerse && (predStrong === 'H6153' || predStrong === 'H1242'))
  ) {
    return 'closing';
  }
  return inDirectSpeech ? 'declaration' : 'narrative';
}

export function extractClauseFrames(
  verses: ShardVerseInput[],
  tokens: LiteraryToken[],
  edition: LiteraryEdition
): { frames: LiteraryClauseFrame[]; syntaxVerses: number } {
  const tokenByVidPos = new Map<string, LiteraryToken>();
  for (const t of tokens) tokenByVidPos.set(`${t.verseId}:${t.pos}`, t);

  const frames: LiteraryClauseFrame[] = [];
  let syntaxVerses = 0;

  for (const v of verses) {
    const vTokens = tokens.filter(t => t.verseId === v.verse_id);
    if (!vTokens.length) continue;

    if (Array.isArray(v.literary_clauses)) {
      syntaxVerses++;
      for (const c of v.literary_clauses) {
        const spanTokens = vTokens.filter(t => t.pos >= c.startPos && t.pos <= c.endPos);
        if (!spanTokens.length) continue;
        frames.push({
          ...c,
          startIndex: spanTokens[0].index,
          endIndex: spanTokens[spanTokens.length - 1].index,
          wordIds: [...new Set(spanTokens.map(t => t.id))],
        });
      }
      continue;
    }

    const nodes = Array.isArray(v.syntax_nodes) ? v.syntax_nodes : [];
    const edges = Array.isArray(v.syntax_edges) ? v.syntax_edges : [];
    const preferredEdition = edition === 'hbo' ? 'macula-hebrew-wlc' : 'macula-greek-nestle1904';
    const treePrefix = edition === 'hbo' ? 'macula_tree:macula-hebrew-wlc' : 'macula_tree:macula-greek-nestle1904';

    const treeNodes = nodes.filter(
      n => String(n.edition_key ?? '') === preferredEdition && String(n.node_key ?? '').startsWith(treePrefix)
    );
    const hasSyntax = treeNodes.length > 0;
    if (hasSyntax) syntaxVerses++;

    // Build parent-child lookup for MACULA modifier detection (e.g. Adj + Adv like טוב + מאד)
    const nodeById = new Map<number, Record<string, unknown>>();
    for (const n of treeNodes) nodeById.set(Number(n.id), n);
    const childrenByParent = new Map<number, Record<string, unknown>[]>();
    for (const e of edges) {
      if (String(e.edition_key ?? '') !== preferredEdition) continue;
      const parentId = Number(e.target_node_id);
      const child = nodeById.get(Number(e.source_node_id));
      if (!child) continue;
      const arr = childrenByParent.get(parentId) ?? [];
      arr.push(child);
      childrenByParent.set(parentId, arr);
    }

    // Extract leaf clause spans from MACULA tree or fallback to verse-level / verb-split spans
    const rawClauses = treeNodes
      .filter(n => n.node_type === 'clause')
      .map(n => ({
        id: String(n.id),
        nodeKey: String(n.node_key),
        startPos: Number(n.start_word_position),
        endPos: Number(n.end_word_position),
        nodeId: Number(n.id),
      }))
      .filter(c => Number.isInteger(c.startPos) && Number.isInteger(c.endPos) && c.endPos >= c.startPos);

    // Keep minimal non-enclosing clauses or top-level partition clauses so we don't duplicate nested clauses
    const sortedClauses = [...rawClauses].sort(
      (a, b) => a.startPos - b.startPos || (a.endPos - a.startPos) - (b.endPos - b.startPos)
    );
    const leafClauses: typeof sortedClauses = [];
    const seenSpanKey = new Set<string>();
    for (const c of sortedClauses) {
      const sk = `${c.startPos}-${c.endPos}`;
      if (seenSpanKey.has(sk)) continue;
      const enclosesChild = sortedClauses.some(
        other =>
          other.id !== c.id &&
          other.startPos >= c.startPos &&
          other.endPos <= c.endPos &&
          (other.startPos > c.startPos || other.endPos < c.endPos)
      );
      if (!enclosesChild) {
        seenSpanKey.add(sk);
        leafClauses.push(c);
      }
    }

    const fallbackSpans =
      leafClauses.length > 0
        ? leafClauses
        : [{ id: `v${v.verse_id}`, nodeKey: '', startPos: 1, endPos: vTokens[vTokens.length - 1].pos, nodeId: -1 }];

    let inDirectSpeech = false;
    for (let ci = 0; ci < fallbackSpans.length; ci++) {
      const span = fallbackSpans[ci];
      const spanTokens = vTokens.filter(t => t.pos >= span.startPos && t.pos <= span.endPos);
      if (!spanTokens.length) continue;

      // Determine predicate: prefer MACULA terminal with syntactic_role === 'v' or 'p', else first verb/predicate token
      const roleNodes = treeNodes.filter(
        n => Number(n.start_word_position) >= span.startPos && Number(n.end_word_position) <= span.endPos && n.syntactic_role
      );
      const verbRole = roleNodes.find(n => n.syntactic_role === 'v');
      const predRoleNode = verbRole ?? roleNodes.find(n => n.syntactic_role === 'p');
      const predTok =
        (predRoleNode ? tokenByVidPos.get(`${v.verse_id}:${predRoleNode.start_word_position}`) : null) ??
        spanTokens.find(t => t.posClass === 'verb' || /^(?:H?V|A?V|V-)/.test(t.grammarCode)) ??
        spanTokens.find(t => !t.isFunctionWord) ??
        spanTokens[0];

      const subjectLemmas: string[] = [];
      const objectLemmas: string[] = [];
      for (const rn of roleNodes) {
        const r = String(rn.syntactic_role);
        if (r !== 's' && r !== 'o') continue;
        const rToks = spanTokens.filter(
          t => t.pos >= Number(rn.start_word_position) && t.pos <= Number(rn.end_word_position) && !t.isFunctionWord
        );
        for (const rt of rToks) {
          if (r === 's') subjectLemmas.push(rt.lemmaKey);
          else objectLemmas.push(rt.lemmaKey);
        }
      }

      // Detect syntax modifier pairs (e.g. predicate/adj phrase containing adj/verb head + adv modifier like טוב מאד)
      const modifierPairs: LiteraryClauseFrame['modifierPairs'] = [];
      for (const rn of treeNodes) {
        if (
          Number(rn.start_word_position) < span.startPos ||
          Number(rn.end_word_position) > span.endPos
        ) {
          continue;
        }
        if (rn.node_type !== 'phrase') continue;
        const kids = childrenByParent.get(Number(rn.id)) ?? [];
        if (kids.length < 2) continue;
        const phraseToks = spanTokens.filter(
          t => t.pos >= Number(rn.start_word_position) && t.pos <= Number(rn.end_word_position)
        );
        const headTok = phraseToks.find(t => t.posClass === 'adjective' || t.posClass === 'verb' || /\/?A[a-z]|\/?V/.test(t.grammarCode));
        const modTok = phraseToks.find(
          t =>
            t !== headTok &&
            !t.isFunctionWord &&
            t.posClass !== 'pronoun' &&
            t.strongs !== 'G3592' &&
            t.strongs !== 'H2088' &&
            (t.posClass === 'adverb' ||
              /(?:^|\/)H?D$|^(?:ADV)$/.test(t.grammarCode) ||
              (rn.syntactic_role === 'p' && phraseToks.length === 2 && (t.posClass === 'adjective' || t.strongs === 'H3966')))
        );
        if (headTok && modTok) {
          modifierPairs.push({
            headWordId: headTok.id,
            modifierWordId: modTok.id,
            headStrongs: headTok.strongs,
            modifierStrongs: modTok.strongs,
            modifierForm: modTok.surfaceForm,
            modifierLemma: modTok.lemmaScript,
            sourceNode: String(rn.node_key),
          });
        }
      }

      const clauseText = spanTokens.map(t => stripHebrew(t.surfaceForm)).join(' ');
      const clauseStrongs = spanTokens.map(t => t.strongs).filter(Boolean);
      const prevVerseStrongs = vTokens
        .filter(t => t.pos < span.startPos && t.pos >= span.startPos - 5)
        .map(t => t.strongs)
        .filter(Boolean);
      // If a clause introduces direct speech via infinitive לֵאמֹר (H559) after a main verb (e.g. וַיְבָרֶךְ ... לֵאמֹר),
      // prefer the finite main verb (`H1288` etc.) over `לֵאמֹר` so blessing/command verbs are preserved.
      const mainVerbTok =
        predTok.strongs === 'H559' && /לֵאמֹר|לאמר/.test(stripHebrew(predTok.surfaceForm))
          ? spanTokens.find(t => t !== predTok && (t.posClass === 'verb' || /^(?:H?V|A?V)/.test(t.grammarCode))) ?? predTok
          : predTok;
      const clauseType = classifyClauseType(
        mainVerbTok.strongs,
        mainVerbTok.mood,
        span.endPos >= vTokens[vTokens.length - 1].pos,
        clauseText,
        inDirectSpeech,
        clauseStrongs,
        prevVerseStrongs
      );

      if (clauseType === 'speech_opener' || clauseStrongs.includes('H559')) {
        inDirectSpeech = true;
      } else if (clauseType === 'fulfillment' || clauseType === 'closing' || mainVerbTok.mood === 'wayyiqtol') {
        inDirectSpeech = false;
      }

      frames.push({
        id: `cl:${v.verse_id}:${span.startPos}-${span.endPos}`,
        verseId: v.verse_id,
        ref: formatVerseRef(v.book, v.chapter, v.verse_nr),
        startPos: span.startPos,
        endPos: span.endPos,
        startIndex: spanTokens[0].index,
        endIndex: spanTokens[spanTokens.length - 1].index,
        predicateLemma: mainVerbTok.lemmaKey,
        predicateStrongs: mainVerbTok.strongs,
        predicateScript: mainVerbTok.lemmaScript,
        predicateWordId: mainVerbTok.id,
        predicatePerson: mainVerbTok.person,
        predicateMood: mainVerbTok.mood,
        subjectLemmas: [...new Set(subjectLemmas)],
        objectLemmas: [...new Set(objectLemmas)],
        modifierPairs,
        clauseType,
        isDirectSpeech: inDirectSpeech && clauseType !== 'speech_opener',
        wordIds: spanTokens.map(t => t.id),
        sourceNodeId: span.nodeKey || undefined,
      });
    }
  }

  return { frames, syntaxVerses };
}

const LIGHT_POLYSEMOUS_VERBS = new Set([
  'H5375', 'H5414', 'H6213', 'H7760', 'H7200', 'H4672', 'H3772', 'H3045',
  'H1980', 'H935', 'H3318', 'H5927', 'H7971', 'H3947',
  'G4160', 'G1325', 'G2192', 'G2983', 'G1096', 'G305', 'G906',
]);

function dirichletMultinomialSurprisalBits(
  countSameInPeers: number,
  peerCount: number,
  vocabSize: number,
  alpha = 0.25
): number {
  const k = Math.max(2, vocabSize);
  return -Math.log2((countSameInPeers + alpha) / (Math.max(1, peerCount) + alpha * k));
}

function extractSlotAtom(frame: LiteraryClauseFrame, tokens: LiteraryToken[]): SlotAtom {
  const toks = tokens.slice(frame.startIndex, frame.endIndex + 1);
  const predTok = toks.find(t => t.id === frame.predicateWordId) ?? toks.find(t => t.strongs === frame.predicateStrongs);
  const verbStem = predTok?.stem || frame.predicateMood || 'base';

  const objTok =
    toks.find(t => frame.objectLemmas.includes(t.lemmaKey) && !t.isFunctionWord && t.strongs) ??
    toks.find(
      t =>
        t !== predTok &&
        !t.isFunctionWord &&
        Boolean(t.strongs) &&
        (predTok ? t.index > predTok.index : true) &&
        (t.posClass === 'noun' || /^H?Nc|^N-/.test(t.grammarCode))
    );
  const govObj = objTok?.strongs || '';
  const predKey = frame.predicateStrongs || frame.predicateLemma;
  const isIdiom = Boolean(govObj && LIGHT_POLYSEMOUS_VERBS.has(frame.predicateStrongs));
  const idiomKey = isIdiom ? `idiom:${frame.predicateStrongs}+${govObj}` : undefined;
  const senseId = idiomKey ?? predKey;
  const clauseGloss = toks.filter(t => !t.isFunctionWord).map(t => t.gloss).join(' ');
  const valence = scoreGlossValence(clauseGloss);

  return {
    senseId,
    verbStem,
    govObjectOrVerbClass: govObj || frame.clauseType,
    ...(idiomKey ? { idiomKey } : {}),
    isIdiom,
    ...(valence !== 0 ? { valence } : {}),
  };
}

function buildVerseRegimeLabels(verses: ShardVerseInput[], tokens: LiteraryToken[]): string[] {
  const byVid = new Map<number, LiteraryToken[]>();
  for (const t of tokens) {
    const arr = byVid.get(t.verseId) ?? [];
    arr.push(t);
    byVid.set(t.verseId, arr);
  }
  return verses.map(v => {
    const vt = byVid.get(v.verse_id) ?? [];
    if (vt.some(t => t.strongs === 'H3541') && vt.some(t => t.strongs === 'H559')) return 'oracle_open';
    if (vt.some(t => t.strongs === 'H7971') && vt.some(t => t.strongs === 'H784')) return 'fire_judgment';
    if (vt.some(t => t.strongs === 'H5002')) return 'oracle_close';
    if (vt.some(t => t.strongs === 'H1945' || t.strongs === 'G3759')) return 'woe';
    if (vt.some(t => t.strongs === 'H835' || t.strongs === 'G3107')) return 'blessing';
    if (vt.some(t => t.strongs === 'H7200') && vt.some(t => t.strongs === 'H2896' || t.strongs === 'H2895')) return 'eval_good';
    const has2p = vt.some(t => t.person?.startsWith('2') || /\/Sp2[mfc][sp]/.test(t.grammarCode));
    if (has2p) return '2p';
    const has3p = vt.some(t => t.person?.startsWith('3'));
    if (has3p) return '3p';
    const has1p = vt.some(t => t.person?.startsWith('1') || /\/Sp1[mfc][sp]/.test(t.grammarCode));
    if (has1p) return '1p';
    return 'narr';
  });
}

interface RecurringSlotInfo {
  recurringPredicates: Set<string>;
  recurringIdioms: Set<string>;
  signatureMotifs: Set<string>;
  strongsUnitSupport: Map<string, number>;
}

function computeRecurringSlotInfo(
  unitTokensList: LiteraryToken[][],
  unitFramesList: LiteraryClauseFrame[][],
  allTokens: LiteraryToken[]
): RecurringSlotInfo {
  const k = unitFramesList.length;
  const predUnitCount = new Map<string, number>();
  const idiomUnitCount = new Map<string, number>();
  for (const uFrames of unitFramesList) {
    const seen = new Set<string>();
    const seenIdioms = new Set<string>();
    for (const f of uFrames) {
      if (f.predicateStrongs) seen.add(f.predicateStrongs);
      const atom = extractSlotAtom(f, allTokens);
      if (atom.isIdiom && atom.idiomKey) seenIdioms.add(atom.idiomKey);
    }
    for (const s of seen) predUnitCount.set(s, (predUnitCount.get(s) ?? 0) + 1);
    for (const id of seenIdioms) idiomUnitCount.set(id, (idiomUnitCount.get(id) ?? 0) + 1);
  }
  const minPredUnits = Math.max(2, Math.ceil(k * 0.28));
  const recurringPredicates = new Set<string>();
  for (const [s, cnt] of predUnitCount) {
    if (cnt >= minPredUnits) recurringPredicates.add(s);
  }
  const recurringIdioms = new Set<string>();
  for (const [id, cnt] of idiomUnitCount) {
    if (cnt >= minPredUnits) recurringIdioms.add(id);
  }

  const strongsUnitCount = new Map<string, number>();
  const strongsTotalCount = new Map<string, number>();
  const variableOnlyStrongs = new Set<string>();
  const nonVariableSeen = new Set<string>();
  for (const uToks of unitTokensList) {
    const seen = new Set<string>();
    for (const t of uToks) {
      if (t.isFunctionWord || !t.strongs) continue;
      if (isVariableSlotToken(t)) {
        if (!nonVariableSeen.has(t.strongs)) variableOnlyStrongs.add(t.strongs);
      } else {
        nonVariableSeen.add(t.strongs);
        variableOnlyStrongs.delete(t.strongs);
      }
      strongsTotalCount.set(t.strongs, (strongsTotalCount.get(t.strongs) ?? 0) + 1);
      seen.add(t.strongs);
    }
    for (const s of seen) strongsUnitCount.set(s, (strongsUnitCount.get(s) ?? 0) + 1);
  }

  const minMotifUnits = Math.max(3, Math.ceil(k * 0.5));
  const signatureMotifs = new Set<string>();
  for (const [s, uCnt] of strongsUnitCount) {
    if (uCnt < minMotifUnits || variableOnlyStrongs.has(s)) continue;
    const total = strongsTotalCount.get(s) ?? uCnt;
    // Signature structural motif: appears regularly across units, ~1-2x per unit (e.g. G3775 ear, G3528 overcome, G6063 know)
    if (total / uCnt <= 1.85) {
      signatureMotifs.add(s);
    }
  }

  return { recurringPredicates, recurringIdioms, signatureMotifs, strongsUnitSupport: strongsUnitCount };
}

function compactEventsForTemplate(
  unitEvents: LiteraryEvent[][],
  maxTotal = 220
): LiteraryEvent[][] {
  const total = unitEvents.reduce((s, u) => s + u.length, 0);
  if (total <= maxTotal) return unitEvents;

  const trimmed = unitEvents.map(u => {
    const kept = u.filter(e => e.key !== 'slot:narrative_action');
    if (kept.length > 0) return kept;
    return u.slice(0, 2);
  });
  const total2 = trimmed.reduce((s, u) => s + u.length, 0);
  if (total2 <= maxTotal) return trimmed;

  const perUnitCap = Math.max(4, Math.floor(maxTotal / trimmed.length));
  return trimmed.map(u => u.slice(0, perUnitCap));
}

function clauseToEvent(
  frame: LiteraryClauseFrame,
  tokens: LiteraryToken[],
  slotInfo?: RecurringSlotInfo
): LiteraryEvent {
  const toks = tokens.slice(frame.startIndex, frame.endIndex + 1);
  const slotAtom = extractSlotAtom(frame, tokens);
  const features = [
    `type:${frame.clauseType}`,
    `lemma:${frame.predicateLemma}`,
    `atom:${slotAtom.senseId}`,
    `stem:${slotAtom.verbStem}`,
    `gov:${slotAtom.govObjectOrVerbClass}`,
    ...frame.subjectLemmas.slice(0, 2).map(s => `role:subj=${s}`),
    ...frame.objectLemmas.slice(0, 2).map(o => `role:obj=${o}`),
  ];
  if (frame.predicatePerson) features.push(`person:${frame.predicatePerson}`);
  if (frame.predicateMood) features.push(`mood:${frame.predicateMood}`);
  for (const mod of frame.modifierPairs) {
    features.push(`modifier:${mod.modifierStrongs}`);
  }
  const hasEvalAdj = toks.some(t => t.strongs === 'H2896' || t.strongs === 'H2895' || t.strongs === 'G2570');
  if (hasEvalAdj && (frame.predicateStrongs === 'H7200' || frame.predicateStrongs === 'H2896' || frame.predicateStrongs === 'H2895')) {
    features.push('slot:evaluation_good');
  }

  let bestMotif: { strongs: string; support: number } | null = null;
  if (slotInfo) {
    for (const t of toks) {
      if (!slotInfo.signatureMotifs.has(t.strongs)) continue;
      const sup = slotInfo.strongsUnitSupport.get(t.strongs) ?? 0;
      if (!bestMotif || sup > bestMotif.support) {
        bestMotif = { strongs: t.strongs, support: sup };
      }
    }
  }
  const predSupport = slotInfo?.strongsUnitSupport.get(frame.predicateStrongs) ?? 0;

  let key: string;
  const predTok = toks.find(t => t.id === frame.predicateWordId) ?? toks.find(t => t.strongs === frame.predicateStrongs);
  if (frame.clauseType === 'evaluation' && (hasEvalAdj || frame.predicateStrongs === 'H2896' || frame.predicateStrongs === 'H2895')) {
    key = 'slot:evaluation_good';
  } else if (frame.clauseType === 'evaluation') {
    key = 'slot:evaluation_see';
  } else if (frame.clauseType === 'closing') {
    key = 'slot:closing_formula';
  } else if (frame.clauseType === 'speech_opener') {
    key = `slot:speech:${frame.predicateStrongs}`;
  } else if (slotAtom.isIdiom && slotAtom.idiomKey && slotInfo?.recurringIdioms.has(slotAtom.idiomKey)) {
    key = slotAtom.idiomKey;
  } else if (bestMotif && (bestMotif.support > predSupport || !slotInfo?.recurringPredicates.has(frame.predicateStrongs))) {
    key = bestMotif.strongs;
  } else if (frame.predicateStrongs && slotInfo?.recurringPredicates.has(frame.predicateStrongs)) {
    key = frame.predicateStrongs;
  } else if (predTok && isProperNounToken(predTok)) {
    key = 'slot:var:proper_noun';
  } else if (predTok && isNumeralToken(predTok)) {
    key = 'slot:var:number';
  } else if (frame.clauseType === 'narrative' && frame.predicateStrongs !== 'H1288' && frame.predicateStrongs !== 'H7121') {
    key = 'slot:narrative_action';
  } else {
    key = frame.predicateStrongs || frame.predicateLemma;
  }

  return {
    id: frame.id,
    key,
    wordIds: frame.wordIds.slice(0, 16),
    features: features.slice(0, 24),
  };
}

function buildSubunitsForUnit(
  unitTokens: LiteraryToken[],
  unitFrames: LiteraryClauseFrame[],
  unitIdx: number
): LiterarySubunit[] {
  if (!unitFrames.length) return [];
  const subunits: LiterarySubunit[] = [];
  let bucket: LiteraryClauseFrame[] = [];
  let currentKind = '';

  const groupKind = (f: LiteraryClauseFrame): string => {
    if (f.clauseType === 'speech_opener' || f.clauseType === 'command') return 'command';
    if (f.clauseType === 'fulfillment') return 'fulfillment';
    if (f.clauseType === 'evaluation') return 'evaluation';
    if (f.clauseType === 'blessing') return 'blessing';
    if (f.clauseType === 'closing') return 'closing';
    if (f.clauseType === 'naming') return 'naming';
    return 'execution';
  };

  const flush = () => {
    if (!bucket.length) return;
    const firstTok = unitTokens.find(t => t.index === bucket[0].startIndex) ?? unitTokens[0];
    const lastTok = unitTokens.find(t => t.index === bucket[bucket.length - 1].endIndex) ?? unitTokens[unitTokens.length - 1];
    const wordIds = [...new Set(bucket.flatMap(b => b.wordIds))];
    const labelMap: Record<string, string> = {
      command: 'Divine/Speaker Command',
      fulfillment: 'Fulfillment',
      execution: 'Action / Execution',
      naming: 'Naming / Identification',
      evaluation: 'Evaluation',
      blessing: 'Blessing',
      closing: 'Closing Formula',
    };
    subunits.push({
      id: `sub:${unitIdx}:${subunits.length}`,
      kind: currentKind,
      label: labelMap[currentKind] ?? currentKind,
      fromRef: firstTok.ref,
      toRef: lastTok.ref,
      wordIds,
      clauseIds: bucket.map(b => b.id),
      summary: bucket.map(b => b.predicateScript).filter(Boolean).slice(0, 4).join(' · '),
    });
    bucket = [];
  };

  for (const f of unitFrames) {
    const gk = groupKind(f);
    if (bucket.length && gk !== currentKind) flush();
    currentKind = gk;
    bucket.push(f);
  }
  flush();
  return subunits;
}

function buildSegmentationCandidates(
  tokens: LiteraryToken[],
  verses: ShardVerseInput[],
  frames: LiteraryClauseFrame[]
): SegmentationCandidate[] {
  if (tokens.length < 12 || verses.length < 3) return [];

  // Build verse token spans & content feature vectors for SSM novelty detection
  const verseSpans: { verseId: number; ref: string; from: number; to: number; masoreticBreak: 'P' | 'S' | null }[] = [];
  const verseVectors: Map<string, number>[] = [];
  const verseIdxById = new Map<number, number>();
  let cursor = 0;
  for (const v of verses) {
    const vToks = tokens.filter(t => t.verseId === v.verse_id);
    if (!vToks.length) continue;
    const from = cursor;
    const to = cursor + vToks.length;
    cursor = to;
    const mBreak = vToks[vToks.length - 1].masoreticBreak;
    verseIdxById.set(v.verse_id, verseSpans.length);
    verseSpans.push({
      verseId: v.verse_id,
      ref: formatVerseRef(v.book, v.chapter, v.verse_nr),
      from,
      to,
      masoreticBreak: mBreak,
    });
    const vec = new Map<string, number>();
    for (const t of vToks) {
      const k = t.strongs || t.lemmaKey;
      if (!k) continue;
      vec.set(k, (vec.get(k) ?? 0) + (t.isFunctionWord ? 0.25 : 1.0));
    }
    verseVectors.push(vec);
  }

  const noveltyPeaks = detectNoveltyBoundaries(verseVectors, { halfKernel: 2 });
  const noveltyVerseSet = new Set(noveltyPeaks.map(p => p.index));

  const isPureConnectiveToken = (t: LiteraryToken | undefined): boolean => {
    if (!t) return true;
    const cls = t.posClass.toLowerCase();
    if (['conjunction', 'preposition', 'article', 'pronoun'].includes(cls)) return true;
    if (/^(?:CONJ|PREP|T-|P-|R-|C-)/.test(t.grammarCode)) return true;
    if (/^H90\d{2}$/.test(t.strongs)) return true;
    return new Set([
      'H853', 'H0853', 'H854', 'H0854', 'H4480', 'H413', 'H0413', 'H5921', 'H834', 'H0834', 'H3588', 'H03588', 'H518', 'H0518',
      'G3588', 'G2532', 'G1161', 'G846', 'G0846', 'G1722', 'G1519', 'G3739', 'G1537', 'G575', 'G2596', 'G3326', 'G4012', 'G4314', 'G5228', 'G3754', 'G1063',
    ]).has(t.strongs);
  };

  // Mine repeated contiguous token phrases (require >= 1 non-function content token)
  const events: LiteraryEvent[] = tokens.map(t => ({
    id: t.id,
    key: t.strongs || t.lemmaKey,
    wordIds: [t.id],
    features: [],
  }));
  const phraseLimit = verses.length >= 20 ? 14 : 40;
  const phrases = repeatedPhrases(events, { maxLen: 6, limit: phraseLimit, maxEvents: 2200 })
    .filter(p => p.starts.length >= 3)
    .filter(p =>
      tokens.slice(p.starts[0], p.starts[0] + p.keys.length).some(t => !t.isFunctionWord)
    );

  const endOffsets = new Int32Array(tokens.length);
  let nextEnd = tokens.length - 1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].isEndOfVerse) nextEnd = i;
    endOffsets[i] = nextEnd - i;
  }

  const medianNum = (nums: number[]): number => {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  // Resolve final boundary of start-anchored units without slicing off multi-verse closing bodies
  const resolveStartCuts = (distinctVerseIdxs: number[]): { introSplit: number; cuts: number[] } | null => {
    if (distinctVerseIdxs.length < 3) return null;
    const introIdx = distinctVerseIdxs[0];
    const introSplit = introIdx > 0 ? verseSpans[introIdx].from : 0;
    const interiorCuts = distinctVerseIdxs.slice(1).map(vi => verseSpans[vi].from);

    const prevLens = distinctVerseIdxs.slice(0, -1).map((vi, k) => distinctVerseIdxs[k + 1] - vi);
    const medPrev = medianNum(prevLens);
    const singleRatio = prevLens.filter(l => l === 1).length / Math.max(1, prevLens.length);
    const lastIdx = distinctVerseIdxs[distinctVerseIdxs.length - 1];
    const remainingVerses = verseSpans.length - lastIdx;

    // Only close after a 1-verse final unit when preceding units are overwhelmingly 1 verse and multiple verses follow as conclusion
    const lastCut =
      medPrev === 1 && singleRatio >= 0.8 && remainingVerses >= 2
        ? verseSpans[lastIdx].to
        : tokens.length;

    return { introSplit, cuts: [...interiorCuts, lastCut] };
  };

  const candidates: SegmentationCandidate[] = [];
  const seenCuts = new Set<string>();

  const scoreAndBuild = (
    cuts: number[],
    anchorKeys: string[],
    anchorText: string,
    anchorSide: 'start' | 'end' | 'multi',
    signals: string[],
    introEndTokIdx: number
  ) => {
    const cleanCuts = [...new Set(cuts)].filter(c => c > introEndTokIdx && c <= tokens.length).sort((a, b) => a - b);
    if (cleanCuts.length < 3) return;
    const sigKey = `${introEndTokIdx}|${cleanCuts.join(',')}`;
    if (seenCuts.has(sigKey)) return;
    seenCuts.add(sigKey);

    const units: LiteraryUnit[] = [];
    let from = introEndTokIdx;
    for (const end of cleanCuts) {
      if (end <= from) continue;
      const uToks = tokens.slice(from, end);
      const vIds = [...new Set(uToks.map(t => t.verseId))];
      const uFrames = frames.filter(f => f.startIndex >= from && f.endIndex < end);
      units.push({
        index: units.length,
        label: `Unit ${units.length + 1}`,
        fromRef: uToks[0].ref,
        toRef: uToks[uToks.length - 1].ref,
        fromTokenIndex: from,
        toTokenIndex: end,
        verseIds: vIds,
        subunits: buildSubunitsForUnit(uToks, uFrames, units.length),
      });
      from = end;
    }
    if (units.length < 3) return;

    const coveredTokens = units.reduce((s, u) => s + (u.toTokenIndex - u.fromTokenIndex), 0);
    const coverage = coveredTokens / tokens.length;
    if (coverage < 0.25) return;

    const unitTokensList = units.map(u => tokens.slice(u.fromTokenIndex, u.toTokenIndex));
    const unitFramesList = units.map(u => frames.filter(f => f.startIndex >= u.fromTokenIndex && f.endIndex < u.toTokenIndex));
    const slotInfo = computeRecurringSlotInfo(unitTokensList, unitFramesList, tokens);

    const rawUnitEvents = unitFramesList.map((uf, ui) => {
      if (uf.length > 0) return uf.map(f => clauseToEvent(f, tokens, slotInfo));
      return unitTokensList[ui]
        .filter(t => !t.isFunctionWord)
        .slice(0, 24)
        .map(t => ({ id: t.id, key: t.strongs || t.lemmaKey, wordIds: [t.id], features: [`lemma:${t.lemmaKey}`] }));
    });
    const unitFrameEvents = compactEventsForTemplate(rawUnitEvents, 220);
    if (unitFrameEvents.some(u => u.length === 0)) return;

    const tpl = induceTemplate(unitFrameEvents);
    const mdlSavingsBits = tpl.mdlSavingsBits ?? Math.max(0, tpl.compressionProxy * 3);

    // Check introduction
    const introTokens = introEndTokIdx > 0 ? tokens.slice(0, introEndTokIdx) : [];
    const introVerseCount = new Set(introTokens.map(t => t.verseId)).size;
    const introduction = introTokens.length
      ? {
          fromRef: introTokens[0].ref,
          toRef: introTokens[introTokens.length - 1].ref,
          verseIds: [...new Set(introTokens.map(t => t.verseId))],
          rationale: `Leading ${introVerseCount} verse(s) precede the first recurring structural opening/cycle.`,
        }
      : null;

    // Check conclusion / tail
    const tailStart = cleanCuts[cleanCuts.length - 1];
    const tailTokens = tailStart < tokens.length ? tokens.slice(tailStart) : [];
    let conclusion: SegmentationCandidate['conclusion'] = null;
    if (tailTokens.length > 0) {
      const tailFrames = frames.filter(f => f.startIndex >= tailStart);
      const tailEvents = tailFrames.length
        ? tailFrames.map(f => clauseToEvent(f, tokens, slotInfo))
        : tailTokens.filter(t => !t.isFunctionWord).slice(0, 24).map(t => ({
            id: t.id,
            key: t.strongs || t.lemmaKey,
            wordIds: [t.id],
            features: [],
          }));
      const coreCols = tpl.columns.filter(c => c.support >= 0.65);
      const tailKeySet = new Set(tailEvents.map(e => e.key));
      const droppedTemplateSlots = coreCols.filter(c => !tailKeySet.has(c.key)).map(c => c.key);

      const unitContentKeys = new Set(
        units.flatMap(u =>
          tokens
            .slice(u.fromTokenIndex, u.toTokenIndex)
            .filter(t => !t.isFunctionWord)
            .map(t => t.strongs || t.lemmaKey)
        )
      );
      const tailContentToks = tailTokens.filter(t => !t.isFunctionWord);
      const retainedMotifs = [...new Set(tailContentToks.filter(t => unitContentKeys.has(t.strongs)).map(t => `${t.lemmaScript} (${t.strongs})`))].slice(0, 8);
      const newPredicates = [
        ...new Set(
          tailContentToks
            .filter(t => !unitContentKeys.has(t.strongs) && (t.posClass === 'verb' || /V/.test(t.grammarCode) || t.posClass === 'adjective'))
            .map(t => `${t.lemmaScript} (${t.strongs})`)
        ),
      ].slice(0, 8);

      conclusion = {
        fromRef: tailTokens[0].ref,
        toRef: tailTokens[tailTokens.length - 1].ref,
        verseIds: [...new Set(tailTokens.map(t => t.verseId))],
        droppedTemplateSlots,
        retainedMotifs,
        newPredicates,
        transformationSummary:
          droppedTemplateSlots.length > 0
            ? `Unmatched concluding section drops ${droppedTemplateSlots.length} recurring unit slot(s) while introducing ${newPredicates.length} distinct predicate/attribute(s).`
            : `Concluding section follows the closing boundary with ${newPredicates.length} distinct predicate(s).`,
      };
    }

    const sections: LiterarySection[] = [];
    if (introduction) {
      sections.push({
        role: 'introduction',
        label: 'Introduction / Prologue',
        fromRef: introduction.fromRef,
        toRef: introduction.toRef,
        verseIds: introduction.verseIds,
        rationale: introduction.rationale,
      });
    }
    sections.push({
      role: 'unit_sequence',
      label: `${units.length} Recurring Parallel Units`,
      fromRef: units[0].fromRef,
      toRef: units[units.length - 1].toRef,
      verseIds: units.flatMap(u => u.verseIds),
      rationale: `Aligned via ${signals.join(' + ')} (${Math.round(coverage * 100)}% token coverage).`,
    });
    if (conclusion) {
      sections.push({
        role: 'conclusion',
        label: 'Concluding Section / Tail',
        fromRef: conclusion.fromRef,
        toRef: conclusion.toRef,
        verseIds: conclusion.verseIds,
        rationale: conclusion.transformationSummary,
      });
    }

    // Multi-signal coherence scoring without passage-specific rules
    const openerBonus =
      signals.some(s => s.startsWith('opening_formula_alignment') || s.startsWith('opening_paragraph_agreement') || s.startsWith('phase_shifted_cycle'))
        ? 1.55
        : 1.0;
    const agreeBonus = signals.includes('opening_closing_agreement') ? 1.75 : 1.0;
    const paraAtCuts = units.reduce((s, u) => s + (tokens[u.toTokenIndex - 1]?.masoreticBreak ? 1 : 0), 0);
    const totalParaInPassage = verseSpans.filter(v => v.masoreticBreak !== null).length;
    const paraStrict = totalParaInPassage >= 3;
    const paraAligned = signals.includes('masoretic_paragraph_markers') || signals.includes('paragraph_markers');
    const interiorCutCrossesPara =
      paraStrict &&
      !paraAligned &&
      units.some(u => {
        const uVerses = u.verseIds;
        if (uVerses.length < 2) return false;
        const interiorPara = uVerses.slice(0, -1).some(vid => {
          const vi = verseIdxById.get(vid);
          return vi !== undefined && verseSpans[vi].masoreticBreak !== null;
        });
        const endBreak = tokens[u.toTokenIndex - 1]?.masoreticBreak !== null;
        return interiorPara && !endBreak;
      });

    const masoreticBonus = paraAligned
      ? 1.55
      : interiorCutCrossesPara
        ? 0.55
        : paraStrict && paraAtCuts < Math.ceil(units.length * 0.4)
          ? 0.72
          : 1.0;

    const unitVerseLens = units.map(u => u.verseIds.length);
    const medUnitVerses = medianNum(unitVerseLens);
    const stubPenalty = unitVerseLens[unitVerseLens.length - 1] === 1 && medUnitVerses >= 4 ? 0.55 : 1.0;
    const heavyIntroPenalty = introVerseCount >= 4 && introVerseCount >= medUnitVerses ? 0.65 : 1.0;

    const contentAnchorCount = anchorKeys.filter(k => !FUNCTION_STRONGS.has(k) && !/^H90\d{2}$/.test(k)).length;
    const anchorLenBonus = 1 + Math.min(0.28, Math.max(0, contentAnchorCount - 1) * 0.08);
    const ssmBonus = signals.includes('ssm_novelty_changepoint') ? 1.15 : 1.0;
    const effectiveCoverage = (coveredTokens + introTokens.length) / tokens.length;
    if (coverage < 0.35 && mdlSavingsBits + Math.max(0, tpl.compressionProxy) < 3) return;
    const unitCountFactor = Math.pow(Math.max(1, units.length / 4), 0.25);
    const baseGain = Math.max(2.0, mdlSavingsBits * 1.4 + Math.max(0, tpl.compressionProxy) * 3.5 + units.length * 1.6);
    const unanchoredPenalty = anchorKeys.length === 0 ? (mdlSavingsBits <= 0 ? 0.45 : 0.8) : 1.0;
    const score =
      baseGain *
      unitCountFactor *
      effectiveCoverage *
      openerBonus *
      agreeBonus *
      masoreticBonus *
      anchorLenBonus *
      ssmBonus *
      stubPenalty *
      heavyIntroPenalty *
      unanchoredPenalty;
    const confidence = Math.min(
      0.98,
      Math.round((0.45 + 0.28 * coverage + 0.17 * Math.min(1, mdlSavingsBits / 40) + (signals.length > 1 ? 0.08 : 0)) * 1000) / 1000
    );

    candidates.push({
      id: `seg:${anchorSide}:${cleanCuts.join('-')}`,
      anchorKeys,
      anchorText,
      anchorSide,
      signals,
      sections,
      units,
      introduction,
      conclusion,
      coverage: Math.round(coverage * 1000) / 1000,
      mdlSavingsBits: Math.round(mdlSavingsBits * 100) / 100,
      score: Math.round(score * 100) / 100,
      confidence,
      epistemicClass: 'candidate_literary_pattern',
    });
  };

  interface BoundaryProposal {
    cuts: number[];
    anchorKeys: string[];
    anchorText: string;
    anchorSide: 'start' | 'end' | 'multi';
    signals: string[];
    introSplit: number;
    preScore: number;
  }
  const proposalQueue: BoundaryProposal[] = [];

  const attachParaSignal = (cuts: number[], signals: string[], editionFlag: LiteraryEdition): string[] => {
    const out = [...signals];
    const matches = cuts.filter(c => tokens[c - 1]?.masoreticBreak !== null).length;
    if (matches >= Math.ceil(cuts.length * 0.6)) {
      const sigName = editionFlag === 'hbo' ? 'masoretic_paragraph_markers' : 'paragraph_markers';
      if (!out.includes(sigName)) out.push(sigName);
    }
    return out;
  };
  const passageEdition: LiteraryEdition = tokens[0]?.edition ?? 'hbo';

  // Strategy 1: Terminal-formula segmentation + automatic opening-prologue alignment
  for (const p of phrases) {
    const byOffset = new Map<number, number[]>();
    for (const start of p.starts) {
      const last = start + p.keys.length - 1;
      const offset = endOffsets[last];
      if (offset > 2) continue;
      const arr = byOffset.get(offset) ?? [];
      arr.push(last + offset + 1);
      byOffset.set(offset, arr);
    }
    for (const [, cuts] of byOffset) {
      const distinctCuts = [...new Set(cuts)].sort((a, b) => a - b);
      if (distinctCuts.length < 3) continue;
      const anchorText = tokens.slice(p.starts[0], p.starts[0] + p.keys.length).map(t => t.surfaceForm).join(' ');
      const signals = attachParaSignal(distinctCuts, [`terminal_formula(${p.keys.join('+')})`], passageEdition);

      let introSplit = 0;
      const unitStarts = [0, ...distinctCuts.slice(0, -1)];
      const unitOpenKeys = unitStarts.slice(1).map(s => {
        const t0 = tokens[s];
        const t1 = tokens[s + 1];
        return t0 && t1 ? `${t0.strongs}|${t1.strongs}` : '';
      });
      const openerFreq = new Map<string, number>();
      for (const ok of unitOpenKeys) if (ok) openerFreq.set(ok, (openerFreq.get(ok) ?? 0) + 1);
      const topOpener = [...openerFreq.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topOpener && topOpener[1] >= Math.max(2, Math.floor((distinctCuts.length - 1) * 0.7))) {
        const [opA, opB] = topOpener[0].split('|');
        const firstUnitLimit = distinctCuts[0];
        for (let i = 1; i < firstUnitLimit - 2; i++) {
          if (tokens[i].strongs === opA && tokens[i + 1].strongs === opB && tokens[i].pos === 1) {
            introSplit = i;
            break;
          }
        }
      }

      const cov = distinctCuts[distinctCuts.length - 1] / tokens.length;
      const hasPara = signals.some(s => s.endsWith('paragraph_markers'));
      const basePre = p.keys.length * distinctCuts.length * cov * (hasPara ? 1.8 : 1);
      proposalQueue.push({ cuts: distinctCuts, anchorKeys: p.keys, anchorText, anchorSide: 'end', signals, introSplit: 0, preScore: basePre });
      if (introSplit > 0) {
        const introVerseIdx = verseSpans.findIndex(vs => vs.from === introSplit);
        const multiSignals = [...signals, 'opening_formula_alignment'];
        if (introVerseIdx >= 0 && noveltyVerseSet.has(introVerseIdx)) {
          multiSignals.push('ssm_novelty_changepoint');
        }
        proposalQueue.push({
          cuts: distinctCuts,
          anchorKeys: p.keys,
          anchorText,
          anchorSide: 'multi',
          signals: multiSignals,
          introSplit,
          preScore: basePre * 1.5,
        });
      }
    }
  }

  const openingSeries: { keys: string[]; anchorText: string; hitVerseIdxs: number[] }[] = [];

  // Strategy 2: Opening-zone formula OR verse-closing refrain segmentation (`pos <= 7`)
  for (const p of phrases) {
    const openerHits = p.starts.filter(s => tokens[s].pos <= 7);
    if (openerHits.length < 3) continue;
    const hitVerseIdxs = [...new Set(openerHits.map(s => verseIdxById.get(tokens[s].verseId)).filter((x): x is number => x !== undefined))].sort((a, b) => a - b);
    if (hitVerseIdxs.length < 3) continue;
    // Ignore high-frequency noise (e.g. a formula hitting > 80% of multi-verse units' internal clauses)
    if (hitVerseIdxs.length < Math.ceil(openerHits.length * 0.7)) continue;

    const anchorText = tokens.slice(openerHits[0], openerHits[0] + p.keys.length).map(t => t.surfaceForm).join(' ');
    const leadVerses = hitVerseIdxs[0];
    const tailVerses = (verseSpans.length - 1) - hitVerseIdxs[hitVerseIdxs.length - 1];
    const gaps = hitVerseIdxs.slice(1).map((vi, i) => vi - hitVerseIdxs[i]);
    const medGap = medianNum(gaps);

    const isTerminalRefrainPattern = leadVerses >= Math.max(2, Math.floor(medGap * 0.45));
    if (p.keys.length >= 2 && hitVerseIdxs.length <= 16) {
      openingSeries.push({ keys: p.keys, anchorText, hitVerseIdxs });
    }

    if (tailVerses === 0 && isTerminalRefrainPattern) {
      // Verse-closing refrain (e.g. Rev 2-3 `ὁ ἔχων οὖς...`, Ps 42-43 `מה תשתוחחי נפשי`)
      const endCuts = hitVerseIdxs.map(vi => verseSpans[vi].to);
      const sigs = attachParaSignal(endCuts, [`terminal_formula(${p.keys.join('+')})`], passageEdition);
      const hasPara = sigs.some(s => s.endsWith('paragraph_markers'));
      proposalQueue.push({
        cuts: endCuts,
        anchorKeys: p.keys,
        anchorText,
        anchorSide: 'end',
        signals: sigs,
        introSplit: 0,
        preScore: p.keys.length * endCuts.length * 1.35 * (hasPara ? 1.6 : 1),
      });
    } else {
      const startResolved = resolveStartCuts(hitVerseIdxs);
      if (startResolved) {
        const sigs = attachParaSignal(startResolved.cuts, [`opening_formula(${p.keys.join('+')})`], passageEdition);
        const cov = (startResolved.cuts[startResolved.cuts.length - 1] - startResolved.introSplit) / tokens.length;
        proposalQueue.push({
          cuts: startResolved.cuts,
          anchorKeys: p.keys,
          anchorText,
          anchorSide: 'start',
          signals: sigs,
          introSplit: startResolved.introSplit,
          preScore: p.keys.length * startResolved.cuts.length * (0.6 + cov),
        });

        // Strategy 2c: Refine units where an interior paragraph break (`¶`/`פ`/`ס`) immediately precedes a partial opening formula
        const coreKeys = p.keys.filter(k => !FUNCTION_STRONGS.has(k) && !/^H90\d{2}$/.test(k));
        if (coreKeys.length >= 1 && hitVerseIdxs.length >= 3) {
          const extraHits: number[] = [];
          const hitSet = new Set(hitVerseIdxs);
          for (let k = 0; k < hitVerseIdxs.length; k++) {
            const startVi = hitVerseIdxs[k];
            const endVi = k + 1 < hitVerseIdxs.length ? hitVerseIdxs[k + 1] - 1 : verseSpans.length - 1;
            for (let vi = startVi + 1; vi <= endVi; vi++) {
              if (hitSet.has(vi) || verseSpans[vi - 1].masoreticBreak === null) continue;
              const headToks = tokens.slice(verseSpans[vi].from, Math.min(verseSpans[vi].to, verseSpans[vi].from + 4));
              if (headToks.some(t => coreKeys.includes(t.strongs))) {
                extraHits.push(vi);
              }
            }
          }
          if (extraHits.length > 0 && extraHits.length <= 3) {
            const refinedResolved = resolveStartCuts([...hitVerseIdxs, ...extraHits].sort((a, b) => a - b));
            if (refinedResolved) {
              const rSigs = attachParaSignal(refinedResolved.cuts, [`opening_formula(${p.keys.join('+')})`, 'partial_opening_refinement'], passageEdition);
              const rCov = (refinedResolved.cuts[refinedResolved.cuts.length - 1] - refinedResolved.introSplit) / tokens.length;
              proposalQueue.push({
                cuts: refinedResolved.cuts,
                anchorKeys: p.keys,
                anchorText,
                anchorSide: 'start',
                signals: rSigs,
                introSplit: refinedResolved.introSplit,
                preScore: p.keys.length * refinedResolved.cuts.length * (0.6 + rCov) * 1.35,
              });
            }
          }
        }
      }
      if (isTerminalRefrainPattern) {
        const endCuts = hitVerseIdxs.map(vi => verseSpans[vi].to);
        const sigs = attachParaSignal(endCuts, [`terminal_formula(${p.keys.join('+')})`], passageEdition);
        proposalQueue.push({
          cuts: endCuts,
          anchorKeys: p.keys,
          anchorText,
          anchorSide: 'end',
          signals: sigs,
          introSplit: 0,
          preScore: p.keys.length * endCuts.length * 1.15,
        });
      }
    }
  }

  // Strategy 2b: Alternating K-fold internal motifs (resolves phase shifts when distress/preamble precedes first formula, e.g., Ps 107:4-32)
  for (let a = 0; a < openingSeries.length; a++) {
    const f1 = openingSeries[a];
    if (f1.hitVerseIdxs[0] < 1) continue;
    for (let b = 0; b < openingSeries.length; b++) {
      if (a === b) continue;
      const f2 = openingSeries[b];
      if (f1.hitVerseIdxs.length !== f2.hitVerseIdxs.length) continue;
      const kCount = f1.hitVerseIdxs.length;
      if (kCount < 3 || f2.hitVerseIdxs[kCount - 1] >= verseSpans.length - 1) continue;
      if (f1.hitVerseIdxs.some(v => f2.hitVerseIdxs.includes(v))) continue;
      const keyOverlap = f1.keys.filter(k => f2.keys.includes(k)).length;
      if (keyOverlap >= Math.min(f1.keys.length, f2.keys.length)) continue;

      let strictAlt = true;
      let hasInterveningGap = true;
      for (let i = 0; i < kCount; i++) {
        if (f1.hitVerseIdxs[i] >= f2.hitVerseIdxs[i]) {
          strictAlt = false;
          break;
        }
        if (i + 1 < kCount) {
          const gapAfterF2 = f1.hitVerseIdxs[i + 1] - f2.hitVerseIdxs[i];
          if (gapAfterF2 < 2) {
            hasInterveningGap = false;
            if (gapAfterF2 <= 0) strictAlt = false;
          }
        }
      }
      if (!strictAlt || !hasInterveningGap) continue;

      const phaseCuts: number[] = [];
      for (let i = 0; i < kCount - 1; i++) {
        const vEnd = f2.hitVerseIdxs[i];
        const nextV = vEnd + 1;
        const f2Mood = tokens.slice(verseSpans[vEnd].from, Math.min(verseSpans[vEnd].to, verseSpans[vEnd].from + 4)).find(t => t.mood)?.mood ?? null;
        const nextToks = tokens.slice(verseSpans[nextV].from, Math.min(verseSpans[nextV].to, verseSpans[nextV].from + 3));
        const nextCont =
          nextV < f1.hitVerseIdxs[i + 1] - 1 &&
          (nextToks.some(t => t.strongs === 'H3588' || t.strongs === 'G1063' || t.strongs === 'G3754') ||
            (f2Mood !== null &&
              ['jussive', 'cohortative', 'imperative', 'yiqtol'].includes(f2Mood) &&
              nextToks.some(t => t.mood !== null && ['jussive', 'cohortative', 'imperative'].includes(t.mood))));
        const cutVi = nextCont ? nextV : vEnd;
        phaseCuts.push(verseSpans[cutVi].to);
      }
      phaseCuts.push(tokens.length);
      const pSigs = attachParaSignal(
        phaseCuts,
        [`phase_shifted_cycle(${f1.keys.slice(0, 2).join('+')}..${f2.keys.slice(0, 2).join('+')})`, 'opening_closing_agreement'],
        passageEdition
      );
      proposalQueue.push({
        cuts: phaseCuts,
        anchorKeys: [...new Set([...f1.keys, ...f2.keys])].slice(0, 6),
        anchorText: `${f1.anchorText} / ${f2.anchorText}`,
        anchorSide: 'multi',
        signals: pSigs,
        introSplit: 0,
        preScore: kCount * 7.5 + 28,
      });
    }
  }

  // Strategy 3: Verse-initial anaphora (allows rhetorical markers like `הוֹי` H1945 & conjunction-prefixed `καὶ διαιρέσεις`)
  const anaphoraGroups = new Map<string, { verseIdxs: number[]; surface: string }>();
  for (let vi = 0; vi < verseSpans.length; vi++) {
    const vs = verseSpans[vi];
    const t0 = tokens[vs.from];
    const t1 = tokens[vs.from + 1];
    const anchorTok = isPureConnectiveToken(t0) && t1 && vs.from + 1 < vs.to && !isPureConnectiveToken(t1) ? t1 : t0;
    if (!anchorTok || isPureConnectiveToken(anchorTok) || !anchorTok.strongs) continue;
    const prev = anaphoraGroups.get(anchorTok.strongs);
    if (!prev) {
      anaphoraGroups.set(anchorTok.strongs, { verseIdxs: [vi], surface: anchorTok.surfaceForm });
    } else {
      prev.verseIdxs.push(vi);
    }
  }
  for (const [strongs, grp] of anaphoraGroups) {
    if (grp.verseIdxs.length < 3 || grp.verseIdxs.length > 30) continue;
    const resolved = resolveStartCuts(grp.verseIdxs);
    if (!resolved) continue;
    const sigs = attachParaSignal(resolved.cuts, [`verse_initial_anaphora(${strongs})`], passageEdition);
    const hasPara = sigs.some(s => s.endsWith('paragraph_markers'));
    proposalQueue.push({
      cuts: resolved.cuts,
      anchorKeys: [strongs],
      anchorText: grp.surface,
      anchorSide: 'start',
      signals: sigs,
      introSplit: resolved.introSplit,
      preScore: grp.verseIdxs.length * (hasPara ? 1.5 : 1.0),
    });
  }

  // Strategy 4: Explicit paragraph markers (Masoretic `פ`/`ס` or Greek `¶`)
  const paraVerseIdxs: number[] = [];
  for (let vi = 0; vi < verseSpans.length; vi++) {
    if (verseSpans[vi].masoreticBreak !== null && verseSpans[vi].to - verseSpans[vi].from >= 2) {
      paraVerseIdxs.push(vi);
    }
  }
  if (paraVerseIdxs.length >= 3 && paraVerseIdxs.length <= 24) {
    const paraCuts = paraVerseIdxs.map(vi => verseSpans[vi].to);
    const sigName = passageEdition === 'hbo' ? 'masoretic_paragraph_markers' : 'paragraph_markers';
    const sampleLast = tokens[paraCuts[0] - 1]?.surfaceForm ?? sigName;
    proposalQueue.push({
      cuts: paraCuts,
      anchorKeys: [],
      anchorText: sampleLast,
      anchorSide: 'end',
      signals: [sigName],
      introSplit: 0,
      preScore: paraCuts.length * 1.65,
    });

    // Strategy 4b: Paragraph markers corroborated by recurring opening verb/noun (separates prologue/conclusion paragraphs cleanly, e.g. Gen 5)
    const paraChunks: { startVi: number; endVi: number; openStrongs: string | null; openSurface: string }[] = [];
    let cStart = 0;
    for (const endVi of paraVerseIdxs) {
      if (endVi >= cStart) {
        const vs0 = verseSpans[cStart];
        const t0 = tokens[vs0.from];
        const t1 = tokens[vs0.from + 1];
        const openTok = isPureConnectiveToken(t0) && t1 && vs0.from + 1 < vs0.to && !isPureConnectiveToken(t1) ? t1 : t0;
        paraChunks.push({
          startVi: cStart,
          endVi,
          openStrongs: openTok && !isPureConnectiveToken(openTok) ? openTok.strongs : null,
          openSurface: openTok?.surfaceForm ?? '',
        });
      }
      cStart = endVi + 1;
    }
    if (cStart < verseSpans.length) {
      const vs0 = verseSpans[cStart];
      const t0 = tokens[vs0.from];
      const t1 = tokens[vs0.from + 1];
      const openTok = isPureConnectiveToken(t0) && t1 && vs0.from + 1 < vs0.to && !isPureConnectiveToken(t1) ? t1 : t0;
      paraChunks.push({
        startVi: cStart,
        endVi: verseSpans.length - 1,
        openStrongs: openTok && !isPureConnectiveToken(openTok) ? openTok.strongs : null,
        openSurface: openTok?.surfaceForm ?? '',
      });
    }
    if (paraChunks.length >= 4) {
      const openCounts = new Map<string, { count: number; surface: string }>();
      for (const ch of paraChunks) {
        if (!ch.openStrongs) continue;
        const prev = openCounts.get(ch.openStrongs);
        openCounts.set(ch.openStrongs, { count: (prev?.count ?? 0) + 1, surface: prev?.surface || ch.openSurface });
      }
      const bestOpen = [...openCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
      if (bestOpen && bestOpen[1].count >= Math.max(3, Math.ceil(paraChunks.length * 0.55))) {
        const [domKey, { surface }] = bestOpen;
        const matchIndices = paraChunks.map((ch, idx) => (ch.openStrongs === domKey ? idx : -1)).filter(idx => idx >= 0);
        let firstM = matchIndices[0];
        const lastM = matchIndices[matchIndices.length - 1];
        // If chunk immediately before firstM (e.g. Num 7:12-17) contains domKey near its opening (`pos <= 7`), include it as Unit 1
        while (firstM > 0) {
          const prevCh = paraChunks[firstM - 1];
          const prevVs = verseSpans[prevCh.startVi];
          const headToks = tokens.slice(prevVs.from, Math.min(prevVs.to, prevVs.from + 7));
          if (headToks.some(t => t.strongs === domKey)) {
            firstM--;
          } else {
            break;
          }
        }
        const introSplit = firstM > 0 ? verseSpans[paraChunks[firstM].startVi].from : 0;
        const agreedCuts = paraChunks.slice(firstM, lastM + 1).map(ch => verseSpans[ch.endVi].to);
        if (agreedCuts.length >= 3) {
          proposalQueue.push({
            cuts: agreedCuts,
            anchorKeys: [domKey],
            anchorText: surface,
            anchorSide: 'multi',
            signals: [sigName, `opening_paragraph_agreement(${domKey})`, 'opening_closing_agreement'],
            introSplit,
            preScore: agreedCuts.length * 6.5 + 24,
          });
        }
      }
    }
  }

  // Strategy 5: PELT changepoint segmentation over speaker/formula regime labels
  const verseRegimeLabels = buildVerseRegimeLabels(verses, tokens);
  const peltRes = detectPeltChangepoints(verseRegimeLabels, {
    penaltyScale: verses.length <= 10 ? 0.4 : 0.55,
    minSegmentLength: 1,
  });
  if (peltRes.changepoints.length >= 2 && peltRes.changepoints.length <= 24) {
    const peltCuts = [...peltRes.changepoints.map(vi => verseSpans[vi]?.from).filter((x): x is number => typeof x === 'number' && x > 0), tokens.length];
    if (peltCuts.length >= 3) {
      proposalQueue.push({
        cuts: peltCuts,
        anchorKeys: [],
        anchorText: peltRes.segments.map(s => s.dominantLabel).slice(0, 4).join(' → '),
        anchorSide: 'multi',
        signals: ['pelt_changepoint'],
        introSplit: 0,
        preScore: peltCuts.length * 1.4,
      });
    }
    if (peltRes.changepoints.length >= 3 && peltRes.changepoints[0] <= 3) {
      const introSplit = verseSpans[peltRes.changepoints[0]]?.from ?? 0;
      const bodyCuts = [...peltRes.changepoints.slice(1).map(vi => verseSpans[vi]?.from).filter((x): x is number => typeof x === 'number' && x > introSplit), tokens.length];
      if (introSplit > 0 && bodyCuts.length >= 3) {
        proposalQueue.push({
          cuts: bodyCuts,
          anchorKeys: [],
          anchorText: peltRes.segments.slice(1, 5).map(s => s.dominantLabel).join(' → '),
          anchorSide: 'multi',
          signals: ['pelt_changepoint'],
          introSplit,
          preScore: bodyCuts.length * 1.45,
        });
      }
    }
  }

  // Merge proposals with identical `(introSplit, cuts)` so opening + closing + paragraph signals reinforce one another
  const mergedBySig = new Map<string, BoundaryProposal>();
  for (const prop of proposalQueue) {
    const clean = [...new Set(prop.cuts)].filter(c => c > prop.introSplit && c <= tokens.length).sort((a, b) => a - b);
    if (clean.length < 3) continue;
    const key = `${prop.introSplit}|${clean.join(',')}`;
    const existing = mergedBySig.get(key);
    if (!existing) {
      mergedBySig.set(key, { ...prop, cuts: clean });
    } else {
      const mergedSignals = [...new Set([...existing.signals, ...prop.signals])];
      const hasStart = existing.anchorSide === 'start' || prop.anchorSide === 'start' || existing.anchorSide === 'multi';
      const hasEnd = existing.anchorSide === 'end' || prop.anchorSide === 'end' || existing.anchorSide === 'multi';
      if (hasStart && hasEnd && !mergedSignals.includes('opening_closing_agreement')) {
        mergedSignals.push('opening_closing_agreement');
      }
      const nextSide: 'start' | 'end' | 'multi' = hasStart && hasEnd ? 'multi' : existing.anchorSide;
      const keepNewAnchor = prop.anchorKeys.length > existing.anchorKeys.length;
      mergedBySig.set(key, {
        cuts: clean,
        anchorKeys: keepNewAnchor ? prop.anchorKeys : existing.anchorKeys,
        anchorText: keepNewAnchor ? prop.anchorText : existing.anchorText,
        anchorSide: nextSide,
        signals: mergedSignals,
        introSplit: prop.introSplit,
        preScore: Math.max(existing.preScore, prop.preScore) + Math.min(existing.preScore, prop.preScore) * 0.5 + (hasStart && hasEnd ? 12 : 0),
      });
    }
  }

  // Evaluate top distinct deduplicated proposals through full template induction (bounded for heavy litanies like Ps 136)
  const maxEvalProposals = verses.length >= 20 ? 10 : 18;
  const uniqueProposals = [...mergedBySig.values()].sort((a, b) => b.preScore - a.preScore).slice(0, maxEvalProposals);
  for (const prop of uniqueProposals) {
    scoreAndBuild(prop.cuts, prop.anchorKeys, prop.anchorText, prop.anchorSide, prop.signals, prop.introSplit);
  }

  candidates.sort((a, b) => b.score - a.score || b.mdlSavingsBits - a.mdlSavingsBits || b.coverage - a.coverage);
  return candidates.slice(0, 6);
}

function buildTemplateAndDeviations(
  seg: SegmentationCandidate,
  tokens: LiteraryToken[],
  frames: LiteraryClauseFrame[]
): {
  template: LiteraryAnalysisResult['template'];
  deviations: LiteraryDeviationItem[];
} {
  const unitTokensList = seg.units.map(u => tokens.slice(u.fromTokenIndex, u.toTokenIndex));
  const unitFrames = seg.units.map(u => frames.filter(f => f.startIndex >= u.fromTokenIndex && f.endIndex < u.toTokenIndex));
  const slotInfo = computeRecurringSlotInfo(unitTokensList, unitFrames, tokens);
  const useFrames = unitFrames.every(uf => uf.length > 0);
  const rawUnitEvents: LiteraryEvent[][] = useFrames
    ? unitFrames.map(uf => uf.map(f => clauseToEvent(f, tokens, slotInfo)))
    : unitTokensList.map(uToks =>
        uToks
          .filter(t => !t.isFunctionWord)
          .slice(0, 24)
          .map(t => ({ id: t.id, key: t.strongs || t.lemmaKey, wordIds: [t.id], features: [`lemma:${t.lemmaKey}`] }))
      );

  const unitEvents = compactEventsForTemplate(rawUnitEvents, 220);
  if (unitEvents.some(u => u.length === 0)) {
    return { template: null, deviations: [] };
  }

  // Human-readable labels for Strong's / motif / idiom keys
  const strongsLabelMap = new Map<string, string>();
  for (const t of tokens) {
    if (!t.strongs || strongsLabelMap.has(t.strongs)) continue;
    const glossPart = t.gloss ? `${t.gloss.split(/[;,]/)[0].trim()}, ` : '';
    strongsLabelMap.set(t.strongs, `${t.lemmaScript || t.surfaceForm} (${glossPart}${t.strongs})`);
  }
  const formatSlotKey = (k: string): string => {
    if (k === 'slot:evaluation_good') return 'Evaluation ("saw that it was good")';
    if (k === 'slot:evaluation_see') return 'Evaluation ("saw")';
    if (k === 'slot:closing_formula') return 'Closing Formula';
    if (k === 'slot:narrative_action') return 'Narrative / Specific Action';
    if (k === 'slot:var:proper_noun') return 'Variable: Proper Name';
    if (k === 'slot:var:number') return 'Variable: Numeral';
    if (k.startsWith('idiom:')) {
      const [predS, objS] = k.slice(6).split('+');
      return `Idiom: ${strongsLabelMap.get(predS) ?? predS} + ${strongsLabelMap.get(objS) ?? objS}`;
    }
    if (k.startsWith('slot:speech:')) {
      const s = k.replace('slot:speech:', '');
      return `Speech Opener (${strongsLabelMap.get(s) ?? s})`;
    }
    if (k.startsWith('motif:')) {
      const s = k.replace('motif:', '');
      return `Motif: ${strongsLabelMap.get(s) ?? s}`;
    }
    return strongsLabelMap.get(k) ?? k;
  };

  const induced = induceTemplate(unitEvents);
  const eventById = new Map<string, LiteraryEvent>();
  for (const u of unitEvents) for (const e of u) eventById.set(e.id, e);
  const frameById = new Map<string, LiteraryClauseFrame>(frames.map(f => [f.id, f]));
  const tokById = new Map<string, LiteraryToken>(tokens.map(t => [t.id, t]));

  const devLookup = new Set(induced.deviations.map(d => `${d.unit}:${d.column}:${d.kind}`));
  const slots: ReconstructedTemplateSlot[] = induced.columns.map(col => {
    const cells = col.eventIds.map((eid, ui) => {
      if (!eid) {
        const hasOmit = devLookup.has(`${ui}:${col.index}:omission`);
        return {
          unitIndex: ui,
          present: false,
          key: null,
          wordIds: [],
          ref: null,
          text: '',
          isDeviant: hasOmit,
          deviationKind: hasOmit ? 'omission' : undefined,
        };
      }
      const ev = eventById.get(eid)!;
      const fr = frameById.get(eid);
      const firstTok = tokById.get(ev.wordIds[0]);
      const cellText = fr
        ? tokens.slice(fr.startIndex, fr.endIndex + 1).map(t => t.surfaceForm).join(' ')
        : ev.wordIds.map(id => tokById.get(id)?.surfaceForm ?? '').join(' ');
      const devForCell = induced.deviations.find(d => d.unit === ui && d.column === col.index);
      return {
        unitIndex: ui,
        present: true,
        key: ev.key,
        wordIds: ev.wordIds,
        ref: fr?.ref ?? firstTok?.ref ?? null,
        text: cellText,
        isDeviant: Boolean(devForCell),
        deviationKind: devForCell?.kind,
      };
    });

    const sampleCell = cells.find(c => c.present);
    const sampleEvent = col.eventIds.find(Boolean);
    const sampleFrame = sampleEvent ? frameById.get(sampleEvent) : undefined;
    const slotAtom = sampleFrame
      ? extractSlotAtom(sampleFrame, tokens)
      : {
          senseId: col.key,
          verbStem: 'base',
          govObjectOrVerbClass: col.role ?? 'variable',
          isIdiom: col.key.startsWith('idiom:'),
        };
    const colStates = cells.map(c => (c.present && c.key ? c.key : '__OMIT__'));
    const colVocab = Math.max(2, new Set(colStates).size);
    const colDevs = induced.deviations.filter(d => d.column === col.index);
    const columnSurprisalBits = colDevs.length
      ? Math.round(Math.max(...colDevs.map(d => d.surprisalBits)) * 100) / 100
      : Math.round(
          dirichletMultinomialSurprisalBits(
            colStates.filter(s => s === (col.key || '__OMIT__')).length - 1,
            Math.max(1, cells.length - 1),
            colVocab
          ) * 100
        ) / 100;

    const label =
      col.key.startsWith('slot:') || col.key.startsWith('motif:') || col.key.startsWith('idiom:') || /^[HG]\d/.test(col.key)
        ? formatSlotKey(col.key)
        : sampleCell?.text.split(' ').slice(0, 3).join(' ') || col.key;

    return {
      columnIndex: col.index,
      label,
      canonicalKey: col.key,
      slotAtom,
      columnSurprisalBits,
      role: col.role ?? 'variable',
      support: Math.round(col.support * 1000) / 1000,
      cells,
    };
  });

  const unitTokenStrongs = unitTokensList.map(uToks => {
    const m = new Map<string, LiteraryToken>();
    for (const t of uToks) {
      if (!t.isFunctionWord && t.strongs && !m.has(t.strongs)) m.set(t.strongs, t);
    }
    return m;
  });

  const deviations: LiteraryDeviationItem[] = [];
  for (const d of induced.deviations) {
    if (d.observed === 'slot:narrative_action' || d.expected === 'slot:narrative_action') continue;
    if (d.expected?.startsWith('slot:var:') || d.observed?.startsWith('slot:var:')) continue;
    if (d.kind === 'reordering' && d.observed && d.observed === d.expected) continue;
    if (/^H90\d{2}$/.test(String(d.observed || '')) || /^H90\d{2}$/.test(String(d.expected || ''))) {
      continue;
    }
    if (d.kind === 'omission' && d.expected) {
      const bareStrongs = d.expected.startsWith('slot:speech:') ? d.expected.slice(12) : d.expected;
      if (/^[HG]\d/.test(bareStrongs) && unitTokenStrongs[d.unit]?.has(bareStrongs)) {
        continue;
      }
    }
    const unit = seg.units[d.unit];
    const eid = induced.columns[d.column]?.eventIds[d.unit];
    const ev = eid ? eventById.get(eid) : null;
    const fr = eid ? frameById.get(eid) : null;
    const beforeEv = d.beforeId ? eventById.get(d.beforeId) : null;
    const afterEv = d.afterId ? eventById.get(d.afterId) : null;
    const mappedKind: LiteraryDeviationItem['kind'] =
      d.kind === 'feature_addition' ? 'intensification' : d.kind;
    const expLabel = d.expected ? formatSlotKey(d.expected) : null;
    const obsLabel = d.observed ? formatSlotKey(d.observed) : null;

    deviations.push({
      id: `dev:${d.unit}:${d.column}:${mappedKind}`,
      kind: mappedKind,
      unitIndex: d.unit,
      unitLabel: unit.label,
      ref: fr?.ref ?? (beforeEv ? tokById.get(beforeEv.wordIds[0])?.ref : undefined) ?? unit.fromRef,
      expected: d.expected,
      observed: d.observed,
      description:
        mappedKind === 'omission'
          ? `${unit.label} omits expected slot "${expLabel}" (attested in ${d.peerCount}/${seg.units.length - 1} peers).`
          : mappedKind === 'addition'
            ? `${unit.label} adds extra "${obsLabel}" occurrence.`
            : mappedKind === 'reordering'
              ? `${unit.label} places "${obsLabel}" in a shifted position compared to peers.`
              : mappedKind === 'emerging_motif'
                ? `"${obsLabel}" emerges at ${unit.label} and continues in subsequent units.`
                : mappedKind === 'intensification'
                  ? `${unit.label} carries unique modifier ${obsLabel} on "${expLabel}".`
                  : `${unit.label} substitutes "${obsLabel}" for peer "${expLabel}".`,
      surprisalBits: Math.round(d.surprisalBits * 100) / 100,
      confidence: Math.min(0.98, Math.round((0.55 + d.peerSupport * 0.4) * 1000) / 1000),
      evidenceChannel: useFrames ? 'grammatical' : 'broad_strongs',
      epistemicClass: 'grammatical_observation',
      witnessWordIds: ev?.wordIds ?? d.witnessIds,
      anchorBeforeWordId: beforeEv?.wordIds.at(-1) ?? null,
      anchorAfterWordId: afterEv?.wordIds[0] ?? null,
    });
  }

  // Detect MACULA syntax modifier intensifications (e.g. Gen 1:31 טוב מאד) & person shifts (e.g. Gen 1:26 נעשה, Mt 5:11 2nd person)
  const tokByIdFull = new Map<string, LiteraryToken>(tokens.map(t => [t.id, t]));
  for (let ui = 0; ui < seg.units.length; ui++) {
    const u = seg.units[ui];
    const uf = frames.filter(f => f.startIndex >= u.fromTokenIndex && f.endIndex < u.toTokenIndex);
    for (const f of uf) {
      for (const mp of f.modifierPairs) {
        const headCons = tokByIdFull.get(mp.headWordId)?.consonantal ?? '';
        // Check if peer units also have this headword (same Strong's or same consonantal root across POS variants like H2895/H2896) without this modifier
        const peerWithHead = seg.units.filter((pu, pj) => {
          if (pj === ui) return false;
          return frames
            .filter(pf => pf.startIndex >= pu.fromTokenIndex && pf.endIndex < pu.toTokenIndex)
            .some(pf =>
              tokens
                .slice(pf.startIndex, pf.endIndex + 1)
                .some(t => t.strongs === mp.headStrongs || (headCons.length >= 3 && t.consonantal === headCons)) &&
              pf.modifierPairs.every(pm => pm.modifierStrongs !== mp.modifierStrongs)
            );
        });
        if (peerWithHead.length >= 2) {
          deviations.push({
            id: `dev:mod:${ui}:${mp.modifierWordId}`,
            kind: 'intensification',
            unitIndex: ui,
            unitLabel: u.label,
            ref: f.ref,
            expected: mp.headStrongs,
            observed: `${mp.modifierLemma} (${mp.modifierStrongs})`,
            description: `${u.label} (${f.ref}) attaches syntax modifier "${mp.modifierForm}" (${mp.modifierStrongs}) to ${mp.headStrongs}, absent in ${peerWithHead.length} peers.`,
            surprisalBits: Math.round(Math.log2(peerWithHead.length + 2) * 100) / 100,
            confidence: 0.92,
            evidenceChannel: 'grammatical',
            epistemicClass: 'grammatical_observation',
            witnessWordIds: [mp.headWordId, mp.modifierWordId],
          });
        }
      }
    }
  }

  // Detect grammatical person shifts immediately following repeated speech/unit openers (across all openers in all units)
  const personAfterOpener: { ui: number; openerKey: string; person: string; tok: LiteraryToken }[] = [];
  for (let ui = 0; ui < seg.units.length; ui++) {
    const u = seg.units[ui];
    const uToks = tokens.slice(u.fromTokenIndex, u.toTokenIndex);
    for (let ti = 0; ti < uToks.length; ti++) {
      if (uToks[ti].strongs === 'H559' || uToks[ti].strongs === 'G3004') {
        const nextVerb = uToks.slice(ti + 1, ti + 5).find(t => t.person !== null);
        if (nextVerb?.person) {
          personAfterOpener.push({ ui, openerKey: uToks[ti].strongs, person: nextVerb.person, tok: nextVerb });
        }
      }
    }
  }
  if (personAfterOpener.length >= 4) {
    const counts = new Map<string, number>();
    for (const p of personAfterOpener) counts.set(p.person, (counts.get(p.person) ?? 0) + 1);
    for (const p of personAfterOpener) {
      const pCount = counts.get(p.person) ?? 0;
      if (pCount === 1 && personAfterOpener.length - pCount >= 3) {
        const u = seg.units[p.ui];
        deviations.push({
          id: `dev:person:${p.ui}:${p.tok.id}`,
          kind: 'person_shift',
          unitIndex: p.ui,
          unitLabel: u.label,
          ref: p.tok.ref,
          expected: [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0],
          observed: p.person,
          description: `${u.label} (${p.tok.ref}) shifts grammatical person to ${p.person} on "${p.tok.surfaceForm}" (${p.tok.strongs}) after the speech opener, unlike peer units.`,
          surprisalBits: Math.round(Math.log2(personAfterOpener.length + 1) * 100) / 100,
          confidence: 0.9,
          evidenceChannel: 'grammatical',
          epistemicClass: 'grammatical_observation',
          witnessWordIds: [p.tok.id],
        });
      }
    }
  }

  // Conclusion transformation deviation
  if (seg.conclusion && seg.conclusion.droppedTemplateSlots.length > 0) {
    deviations.push({
      id: `dev:conclusion:transform`,
      kind: 'conclusion_transformation',
      unitIndex: seg.units.length,
      unitLabel: 'Conclusion',
      ref: `${seg.conclusion.fromRef}–${seg.conclusion.toRef}`,
      expected: seg.conclusion.droppedTemplateSlots.join(', '),
      observed: seg.conclusion.newPredicates.slice(0, 4).join(', ') || 'structural closure',
      description: seg.conclusion.transformationSummary,
      surprisalBits: Math.round((seg.conclusion.droppedTemplateSlots.length * 1.6) * 100) / 100,
      confidence: 0.88,
      evidenceChannel: 'grammatical',
      epistemicClass: 'candidate_literary_pattern',
      witnessWordIds: tokens
        .filter(t => seg.conclusion!.verseIds.includes(t.verseId) && !t.isFunctionWord)
        .slice(0, 12)
        .map(t => t.id),
    });
  }

    // Reconcile unit-level slot frequency across units for key structural slots (catches omissions even if position shifted by emerging slots)
  const slotCountsByUnit = new Map<string, number[]>();
  for (let ui = 0; ui < unitEvents.length; ui++) {
    for (const ev of unitEvents[ui]) {
      if (ev.key === 'slot:narrative_action' || ev.key.startsWith('slot:var:')) continue;
      let arr = slotCountsByUnit.get(ev.key);
      if (!arr) {
        arr = Array(unitEvents.length).fill(0);
        slotCountsByUnit.set(ev.key, arr);
      }
      arr[ui]++;
    }
  }
  for (const [slotKey, counts] of slotCountsByUnit) {
    const presentUnits = counts.filter(c => c > 0).length;
    // Emerging motif check across units (medoid-invariant): absent in prefix >= 2, present in suffix >= 2
    const firstPresent = counts.findIndex(c => c > 0);
    if (
      counts.length >= 4 &&
      firstPresent >= 2 &&
      counts.slice(0, firstPresent).every(c => c === 0) &&
      counts.slice(firstPresent).every(c => c > 0) &&
      !deviations.some(d => d.kind === 'emerging_motif' && d.observed === slotKey)
    ) {
      deviations.push({
        kind: 'emerging_motif',
        id: `dev:slot-emerge:${firstPresent}:${slotKey}`,
        unitIndex: firstPresent,
        unitLabel: seg.units[firstPresent].label,
        ref: seg.units[firstPresent].fromRef,
        expected: null,
        observed: slotKey,
        description: `"${slotKey}" emerges at ${seg.units[firstPresent].label} and continues through all remaining units.`,
        surprisalBits: Math.round(Math.log2(firstPresent + 2) * 100) / 100,
        confidence: 0.9,
        evidenceChannel: useFrames ? 'grammatical' : 'broad_strongs',
        epistemicClass: 'grammatical_observation',
        witnessWordIds: seg.units
          .flatMap((_, pj) => (counts[pj] > 0 ? unitEvents[pj].filter(e => e.key === slotKey).flatMap(e => e.wordIds) : []))
          .slice(0, 10),
      });
    }
    if (presentUnits < Math.max(3, Math.ceil((unitEvents.length - 1) * 0.7))) continue;
    const bareSlot = slotKey.startsWith('slot:speech:') ? slotKey.slice(12) : slotKey;
    for (let ui = 0; ui < counts.length; ui++) {
      if (counts[ui] === 0 && !(/^[HG]\d/.test(bareSlot) && unitTokenStrongs[ui]?.has(bareSlot)) && !deviations.some(d => d.kind === 'omission' && d.unitIndex === ui && d.expected === slotKey)) {
        const peerSupport = presentUnits / (unitEvents.length - 1);
        const expLabel = formatSlotKey(slotKey);
        deviations.push({
          kind: 'omission',
          id: `dev:slot-omit:${ui}:${slotKey}`,
          unitIndex: ui,
          unitLabel: seg.units[ui].label,
          ref: seg.units[ui].fromRef,
          expected: slotKey,
          observed: null,
          description: `${seg.units[ui].label} omits expected "${expLabel}" slot (present in ${presentUnits}/${unitEvents.length - 1} peer units).`,
          surprisalBits: Math.round(
            dirichletMultinomialSurprisalBits(0, unitEvents.length - 1, 2) * 100
          ) / 100,
          confidence: Math.min(0.96, Math.round((0.55 + peerSupport * 0.4) * 1000) / 1000),
          evidenceChannel: useFrames ? 'grammatical' : 'broad_strongs',
          epistemicClass: 'grammatical_observation',
          witnessWordIds: seg.units
            .flatMap((_, pj) => (counts[pj] > 0 ? unitEvents[pj].filter(e => e.key === slotKey).flatMap(e => e.wordIds) : []))
            .slice(0, 10),
        });
      }
    }
  }

  // Reconcile signature structural motifs directly against token presence (catches multi-verb clause motifs like Rev 3:3 & Smyrna/Philadelphia G3340 omission)
  for (const motifStr of slotInfo.signatureMotifs) {
    const presentMask = unitTokenStrongs.map(m => m.has(motifStr));
    const presentCnt = presentMask.filter(Boolean).length;
    if (presentCnt < Math.max(4, Math.ceil((unitEvents.length - 1) * 0.7))) continue;
    for (let ui = 0; ui < unitEvents.length; ui++) {
      if (!presentMask[ui] && !deviations.some(d => d.kind === 'omission' && d.unitIndex === ui && (d.expected === motifStr || d.expected === `slot:speech:${motifStr}`))) {
        const peerSupport = presentCnt / (unitEvents.length - 1);
        const label = formatSlotKey(motifStr);
        deviations.push({
          kind: 'omission',
          id: `dev:motif-omit:${ui}:${motifStr}`,
          unitIndex: ui,
          unitLabel: seg.units[ui].label,
          ref: seg.units[ui].fromRef,
          expected: motifStr,
          observed: null,
          description: `${seg.units[ui].label} omits recurring motif "${label}" (present in ${presentCnt}/${unitEvents.length - 1} peer units).`,
          surprisalBits: Math.round(
            dirichletMultinomialSurprisalBits(unitEvents.length - 1 - presentCnt, unitEvents.length - 1, 2) * 100
          ) / 100,
          confidence: Math.min(0.95, Math.round((0.55 + peerSupport * 0.38) * 1000) / 1000),
          evidenceChannel: 'resolved_lemma',
          epistemicClass: 'grammatical_observation',
          witnessWordIds: unitTokenStrongs
            .map(m => m.get(motifStr)?.id)
            .filter((x): x is string => Boolean(x))
            .slice(0, 10),
        });
      }
    }
  }

  // Medoid-invariant pairwise order-inversion detector (catches regime swaps like Hearing Formula <-> Overcomer Promise in Rev 2-3)
  const keyUnitFreq = new Map<string, number>();
  for (const [k, cnts] of slotCountsByUnit) {
    if (k === 'slot:narrative_action') continue;
    const f = cnts.filter(c => c > 0).length;
    if (f >= Math.max(4, Math.ceil(unitEvents.length * 0.75))) keyUnitFreq.set(k, f);
  }
  for (const motifStr of slotInfo.signatureMotifs) {
    const f = unitTokenStrongs.filter(m => m.has(motifStr)).length;
    if (f >= Math.max(4, Math.ceil(unitEvents.length * 0.75))) {
      keyUnitFreq.set(motifStr, Math.max(keyUnitFreq.get(motifStr) ?? 0, f));
    }
  }
  const coreKeysForOrder = [...keyUnitFreq.entries()]
    .sort((a, b) => {
      const sigDiff = (slotInfo.signatureMotifs.has(b[0]) ? 1 : 0) - (slotInfo.signatureMotifs.has(a[0]) ? 1 : 0);
      if (sigDiff !== 0) return sigDiff;
      return b[1] - a[1];
    })
    .slice(0, 18)
    .map(([k]) => k);

  if (coreKeysForOrder.length >= 2) {
    const firstTokPosByUnitKey = unitEvents.map((uEvs, ui) => {
      const m = new Map<string, { idx: number; ev: LiteraryEvent }>();
      for (const e of uEvs) {
        if (m.has(e.key)) continue;
        const t = tokById.get(e.wordIds[0]);
        if (t) m.set(e.key, { idx: t.index, ev: e });
      }
      for (const motifStr of slotInfo.signatureMotifs) {
        const tok = unitTokenStrongs[ui]?.get(motifStr);
        if (tok && !m.has(motifStr)) {
          m.set(motifStr, { idx: tok.index, ev: { id: tok.id, key: motifStr, wordIds: [tok.id], features: [] } });
        }
      }
      return { ui, m };
    });

    const collectedReorderings: { isContiguousRegime: boolean; dev: LiteraryDeviationItem }[] = [];
    for (let a = 0; a < coreKeysForOrder.length; a++) {
      for (let b = a + 1; b < coreKeysForOrder.length; b++) {
        const kA = coreKeysForOrder[a];
        const kB = coreKeysForOrder[b];
        const aBeforeB: { ui: number; evA: LiteraryEvent; evB: LiteraryEvent }[] = [];
        const bBeforeA: { ui: number; evA: LiteraryEvent; evB: LiteraryEvent }[] = [];
        for (const { ui, m } of firstTokPosByUnitKey) {
          const pA = m.get(kA);
          const pB = m.get(kB);
          if (!pA || !pB) continue;
          if (pA.idx < pB.idx) aBeforeB.push({ ui, evA: pA.ev, evB: pB.ev });
          else if (pB.idx < pA.idx) bBeforeA.push({ ui, evA: pA.ev, evB: pB.ev });
        }
        const total = aBeforeB.length + bBeforeA.length;
        if (total < Math.max(4, Math.ceil(unitEvents.length * 0.75)) || aBeforeB.length === 0 || bBeforeA.length === 0) continue;

        const major = aBeforeB.length >= bBeforeA.length ? aBeforeB : bBeforeA;
        const minor = aBeforeB.length >= bBeforeA.length ? bBeforeA : aBeforeB;
        const minorIdxs = minor.map(x => x.ui).sort((x, y) => x - y);
        const isContiguousRegime =
          minorIdxs.length >= 2 && minorIdxs.every((idx, k) => k === 0 || idx === minorIdxs[k - 1] + 1);
        const firstMinor = minor[0];
        const u = seg.units[firstMinor.ui];
        const labelA = formatSlotKey(kA);
        const labelB = formatSlotKey(kB);
        const majorOrd = aBeforeB.length >= bBeforeA.length ? `${labelA} → ${labelB}` : `${labelB} → ${labelA}`;
        const minorOrd = aBeforeB.length >= bBeforeA.length ? `${labelB} → ${labelA}` : `${labelA} → ${labelB}`;
        const minorUnitList = minor.map(x => `Unit ${x.ui + 1}`).join(', ');
        const firstTok = tokById.get(firstMinor.evB.wordIds[0]) ?? tokById.get(firstMinor.evA.wordIds[0]);
        const surprisal = Math.round((Math.log2((total + 1) / minor.length) + 1.1 + (isContiguousRegime ? 1.5 : 0)) * 100) / 100;

        collectedReorderings.push({
          isContiguousRegime,
          dev: {
            id: `dev:order:${kA}:${kB}:${minor[0].ui}`,
            kind: 'reordering',
            unitIndex: firstMinor.ui,
            unitLabel: minorUnitList,
            ref: firstTok?.ref ?? u.fromRef,
            expected: majorOrd,
            observed: minorOrd,
            description: `Structural order shifts from "${majorOrd}" (${major.length}/${total} units) to "${minorOrd}" in ${minorUnitList}.`,
            surprisalBits: surprisal,
            confidence: isContiguousRegime ? 0.96 : 0.93,
            evidenceChannel: 'grammatical',
            epistemicClass: 'grammatical_observation',
            witnessWordIds: [...minor.flatMap(m => [...m.evA.wordIds.slice(0, 2), ...m.evB.wordIds.slice(0, 2)])].slice(0, 12),
          },
        });
      }
    }
    collectedReorderings
      .sort((a, b) => (b.isContiguousRegime ? 1 : 0) - (a.isContiguousRegime ? 1 : 0) || b.dev.surprisalBits - a.dev.surprisalBits)
      .slice(0, 8)
      .forEach(item => deviations.push(item.dev));
  }

  // Deduplicate closely overlapping intensifications at same unit+word, suppress noisy deviations on loose lists
  const isLooseList =
    (induced.mdlSavingsBits ?? 0) < 12 &&
    (seg.anchorKeys.length <= 1 || seg.signals.some(s => s.startsWith('verse_initial_anaphora')));
  const kindPriority: Record<LiteraryDeviationItem['kind'], number> = {
    conclusion_transformation: 7,
    person_shift: 6,
    reordering: 5,
    intensification: 5,
    omission: 4,
    emerging_motif: 2,
    substitution: 2,
    role_shift: 2,
    addition: 0,
  };
  const deduped: LiteraryDeviationItem[] = [];
  for (const dev of deviations.sort((a, b) => (kindPriority[b.kind] - kindPriority[a.kind]) || (b.surprisalBits - a.surprisalBits) || (a.unitIndex - b.unitIndex))) {
    if (isLooseList && (dev.kind === 'addition' || dev.kind === 'omission') && dev.surprisalBits < 2.6) {
      continue;
    }
    if (dev.kind === 'reordering') {
      if (deduped.some(x => x.kind === 'reordering' && x.expected === dev.expected && x.observed === dev.observed)) {
        continue;
      }
    } else if (
      deduped.some(
        x =>
          x.unitIndex === dev.unitIndex &&
          x.kind === dev.kind &&
          dev.witnessWordIds.some(w => x.witnessWordIds.includes(w))
      )
    ) {
      continue;
    }
    deduped.push(dev);
  }

  return {
    template: {
      slots,
      mdlSavingsBits: induced.mdlSavingsBits ?? 0,
      compressionProxy: Math.round(induced.compressionProxy * 100) / 100,
    },
    deviations: deduped,
  };
}

function discoverCommandFulfillments(
  frames: LiteraryClauseFrame[],
  tokens: LiteraryToken[],
  seg: SegmentationCandidate | null
): CommandFulfillmentLink[] {
  const unitOfIdx = (idx: number): number | null => {
    if (!seg) return null;
    const u = seg.units.find(x => idx >= x.fromTokenIndex && idx < x.toTokenIndex);
    return u ? u.index : null;
  };
  const links: CommandFulfillmentLink[] = [];

  for (let i = 0; i < frames.length; i++) {
    const cmd = frames[i];
    if (cmd.clauseType !== 'command') continue;
    const cmdToks = tokens.slice(cmd.startIndex, cmd.endIndex + 1).filter(t => !t.isFunctionWord);
    const cmdStrongs = new Set(cmdToks.map(t => t.strongs).filter(Boolean));
    const cmdUnit = unitOfIdx(cmd.startIndex);

    for (let j = i + 1; j < Math.min(frames.length, i + 10); j++) {
      const ful = frames[j];
      if (unitOfIdx(ful.startIndex) !== cmdUnit && cmdUnit !== null) break;
      if (ful.clauseType === 'speech_opener' || ful.clauseType === 'command') continue;

      const fulToks = tokens.slice(ful.startIndex, ful.endIndex + 1).filter(t => !t.isFunctionWord);
      const shared = [...new Set(fulToks.filter(t => cmdStrongs.has(t.strongs)).map(t => `${t.lemmaScript} (${t.strongs})`))];

      if (ful.clauseType === 'fulfillment') {
        links.push({
          unitIndex: cmdUnit,
          commandRef: cmd.ref,
          fulfillmentRef: ful.ref,
          commandWordIds: cmd.wordIds.slice(0, 8),
          fulfillmentWordIds: ful.wordIds.slice(0, 8),
          sharedLemmas: shared,
          explicitFormula: true,
          kind: 'explicit_fulfillment_formula',
        });
        break;
      }
      if (shared.length >= 1 && (ful.predicateStrongs === cmd.predicateStrongs || shared.length >= 2)) {
        links.push({
          unitIndex: cmdUnit,
          commandRef: cmd.ref,
          fulfillmentRef: ful.ref,
          commandWordIds: cmd.wordIds.slice(0, 8),
          fulfillmentWordIds: ful.wordIds.slice(0, 8),
          sharedLemmas: shared,
          explicitFormula: false,
          kind: ful.predicateStrongs === cmd.predicateStrongs ? 'predicate_echo' : 'object_echo',
        });
        break;
      }
    }
  }
  return links.slice(0, 24);
}

function discoverCrossUnitCorrespondences(
  seg: SegmentationCandidate | null,
  tokens: LiteraryToken[],
  r13?: R13CorpusContext,
  template?: LiteraryAnalysisResult['template']
): CrossUnitCorrespondence[] {
  if (!seg || seg.units.length < 3) return [];
  const n = seg.units.length;

  // Exclude high-frequency template boilerplate tokens (anchor keys + core/repeated formula predicates)
  const boilerplate = new Set<string>(seg.anchorKeys);
  if (template) {
    for (const slot of template.slots) {
      if (slot.support >= 0.65 || slot.canonicalKey.startsWith('slot:')) {
        for (const c of slot.cells) {
          for (const wid of c.wordIds) {
            const tok = tokens.find(t => t.id === wid);
            if (tok && (tok.posClass === 'verb' || tok.strongs === 'H430' || tok.strongs === 'H2895' || tok.strongs === 'H2896')) {
              boilerplate.add(tok.strongs);
            }
          }
        }
      }
    }
  }

  // Compute unit TF-IDF of residual content Strongs
  const unitTermSets = seg.units.map(u => {
    const map = new Map<string, { strongs: string; lemma: string; gloss: string; count: number; wordIds: string[] }>();
    for (const t of tokens.slice(u.fromTokenIndex, u.toTokenIndex)) {
      if (t.isFunctionWord || !t.strongs || boilerplate.has(t.strongs)) continue;
      const entry = map.get(t.strongs) ?? {
        strongs: t.strongs,
        lemma: t.lemmaScript,
        gloss: t.gloss,
        count: 0,
        wordIds: [],
      };
      entry.count++;
      entry.wordIds.push(t.id);
      map.set(t.strongs, entry);
    }
    return map;
  });

  const df = new Map<string, number>();
  for (const m of unitTermSets) {
    for (const k of m.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  }
  const maxAllowedDf = n >= 5 ? Math.min(n - 2, Math.max(3, Math.floor(n * 0.6))) : Math.max(2, n - 1);

  // Map strongs -> R13 concept aliases for thematic pairing
  const conceptsByStrongs = new Map<string, string[]>();
  if (r13?.conceptAliases) {
    for (const [alias, info] of Object.entries(r13.conceptAliases)) {
      for (const bs of info.strongs ?? []) {
        const norm = normStrongs(bs);
        const arr = conceptsByStrongs.get(norm) ?? [];
        arr.push(alias);
        conceptsByStrongs.set(norm, arr);
      }
    }
  }

  const pairs: CrossUnitCorrespondence[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const mA = unitTermSets[i];
      const mB = unitTermSets[j];
      const sharedLexemes: CrossUnitCorrespondence['sharedLexemes'] = [];
      let dot = 0;
      let normSqA = 0;
      let normSqB = 0;
      const conceptsA = new Set<string>();
      const conceptsB = new Set<string>();

      for (const [k, infoA] of mA) {
        const docFreq = df.get(k) ?? 1;
        if (docFreq > maxAllowedDf) continue;
        const idf = Math.log(1 + n / docFreq);
        const wA = (1 + Math.log(infoA.count)) * idf;
        normSqA += wA * wA;
        for (const c of conceptsByStrongs.get(k) ?? []) conceptsA.add(c);
        const infoB = mB.get(k);
        if (infoB) {
          const wB = (1 + Math.log(infoB.count)) * idf;
          dot += wA * wB;
          sharedLexemes.push({
            strongs: k,
            lemma: infoA.lemma,
            gloss: infoA.gloss,
            wordIdsA: infoA.wordIds.slice(0, 6),
            wordIdsB: infoB.wordIds.slice(0, 6),
          });
        }
      }
      for (const [k, infoB] of mB) {
        const docFreq = df.get(k) ?? 1;
        if (docFreq > maxAllowedDf) continue;
        const idf = Math.log(1 + n / docFreq);
        const wB = (1 + Math.log(infoB.count)) * idf;
        normSqB += wB * wB;
        for (const c of conceptsByStrongs.get(k) ?? []) conceptsB.add(c);
      }
      const sharedConcepts = [...conceptsA].filter(c => conceptsB.has(c)).slice(0, 6);
      const denom = Math.sqrt(normSqA) * Math.sqrt(normSqB);
      const cosine = denom > 0 ? dot / denom : 0;
      const score = Math.round((cosine + sharedConcepts.length * 0.04) * 1000) / 1000;
      if (sharedLexemes.length >= 2 && score >= 0.115) {
        pairs.push({
          unitA: i,
          unitB: j,
          labelA: seg.units[i].label,
          labelB: seg.units[j].label,
          score,
          sharedLexemes: sharedLexemes.slice(0, 8),
          sharedConcepts,
          evidenceChannel: 'resolved_lemma',
        });
      }
    }
  }

  return pairs.sort((a, b) => b.score - a.score || a.unitA - b.unitA).slice(0, 10);
}

function discoverSymmetries(
  tokens: LiteraryToken[],
  verses: ShardVerseInput[],
  frames: LiteraryClauseFrame[],
  speakerSegments: SpeakerSegment[] = []
): SymmetryPattern[] {
  const out: SymmetryPattern[] = [];
  const tokById = new Map<string, LiteraryToken>(tokens.map(t => [t.id, t]));

  // IDF map over passage tokens so common function words never drive fake chiasms
  const df = new Map<string, number>();
  for (const t of tokens) {
    const k = t.strongs || t.lemmaKey;
    df.set(k, (df.get(k) ?? 0) + 1);
  }
  const idfMap = new Map<string, number>();
  for (const [k, c] of df) {
    idfMap.set(k, FUNCTION_STRONGS.has(k) || /^H90\d{2}$/.test(k) ? 0.25 : Math.min(2.4, Math.log(1 + tokens.length / (c + 1))));
  }

  // 1. Intra-verse & short-window token-level chiasms (supports gapped & contiguous)
  for (const v of verses) {
    const vToks = tokens.filter(t => t.verseId === v.verse_id);
    if (vToks.length < 5 || vToks.length > 160) continue;
    const streamVariants: { toks: LiteraryToken[]; useStemKey: boolean; useNounStemKey?: boolean }[] = [];
    if (vToks.length <= 24) streamVariants.push({ toks: vToks, useStemKey: false });
    const contentOnly = vToks.filter(t => !t.isFunctionWord);
    if (contentOnly.length >= 5 && contentOnly.length <= 160 && contentOnly.length < vToks.length) {
      streamVariants.push({ toks: contentOnly, useStemKey: false });
      const speechIdx = contentOnly.slice(0, 2).findIndex(t => ['G3004', 'G2036', 'H559', 'H1696'].includes(t.strongs));
      if (speechIdx >= 0 && contentOnly.length - (speechIdx + 1) >= 5) {
        streamVariants.push({ toks: contentOnly.slice(speechIdx + 1), useStemKey: false });
      }
      const nounStemCounts = new Map<string, Set<string>>();
      for (const t of contentOnly) {
        if (t.posClass === 'noun' && t.consonantal.length >= 2 && t.strongs) {
          const st = t.consonantal.slice(0, 2);
          const sSet = nounStemCounts.get(st) ?? new Set<string>();
          sSet.add(t.strongs);
          nounStemCounts.set(st, sSet);
        }
      }
      if ([...nounStemCounts.values()].some(s => s.size >= 2)) {
        streamVariants.push({ toks: contentOnly, useStemKey: false, useNounStemKey: true });
      }
    }
    const nominalOnly = contentOnly.filter(t => t.posClass !== 'verb');
    if (nominalOnly.length >= 5 && nominalOnly.length <= 40) {
      streamVariants.push({ toks: nominalOnly, useStemKey: true });
    }

    for (const { toks: streamToks, useStemKey, useNounStemKey } of streamVariants) {
      const keyFreq = new Map<string, number>();
      const events: LiteraryEvent[] = streamToks.map(t => {
        const stem2 = t.consonantal.length >= 2 ? t.consonantal.slice(0, 2) : '';
        const k =
          useStemKey && stem2
            ? `stem:${stem2}`
            : useNounStemKey && t.posClass === 'noun' && stem2
              ? `stem:${stem2}`
              : t.strongs || t.lemmaKey;
        keyFreq.set(k, (keyFreq.get(k) ?? 0) + 1);
        return {
          id: t.id,
          key: k,
          wordIds: [t.id],
          features: [`lemma:${t.lemmaKey}`],
        };
      });
      // O(L) guard: a chiasm requires at least 2 distinct keys occurring >= 2 times
      let repeatedDistinct = 0;
      for (const cnt of keyFreq.values()) if (cnt >= 2) repeatedDistinct++;
      if (repeatedDistinct < 2) continue;

      const ch = discoverChiasms(events, {
        allowGapped: true,
        maxWindow: Math.min(streamToks.length, 24),
        gapPenalty: 0.08,
        idfMap: useStemKey || useNounStemKey ? undefined : idfMap,
        limit: 3,
      });
      for (const c of ch) {
        const leftFirst = tokById.get(c.pairs[0].leftId)!;
        const rightLast = tokById.get(c.pairs[0].rightId)!;
        // Reject compound proper-name / adjacent-duplicate artifact (same Strong's on different surface scripts at adj tokens)
        if (
          c.pairs.length === 2 &&
          c.pairs.some(p => {
            const lt = tokById.get(p.leftId)!;
            const rt = tokById.get(p.rightId)!;
            return (
              Math.abs(lt.index - rt.index) <= 1 &&
              lt.strongs === rt.strongs &&
              stripHebrew(lt.surfaceForm) !== stripHebrew(rt.surfaceForm)
            );
          })
        ) {
          continue;
        }
        const dup = out.some(
          x =>
            x.level === 'token' &&
            x.fromRef === leftFirst.ref &&
            x.pairs.length >= c.pairs.length &&
            c.pairs.every(p => x.pairs.some(xp => xp.leftWordIds.includes(p.leftId) && xp.rightWordIds.includes(p.rightId)))
        );
        if (dup) continue;
        out.push({
          id: `sym:tok:${leftFirst.id}:${rightLast.id}`,
          kind: c.centerIds.length > 0 && c.pairs.length >= 3 ? 'concentric' : 'chiasm',
          level: 'token',
          gapped: Boolean(c.gapped),
          fromRef: leftFirst.ref,
          toRef: rightLast.ref,
          pairs: c.pairs.map((p, idx) => {
            const lt = tokById.get(p.leftId)!;
            const rt = tokById.get(p.rightId)!;
            return {
              label: String.fromCharCode(65 + idx),
              leftRef: lt.ref,
              rightRef: rt.ref,
              leftText: lt.surfaceForm,
              rightText: rt.surfaceForm,
              leftWordIds: [lt.id],
              rightWordIds: [rt.id],
              similarity: Math.round(p.similarity * 1000) / 1000,
              evidenceChannel: lt.lemmaSource === 'occurrence' ? 'resolved_lemma' : 'broad_strongs',
            };
          }),
          center: c.centerIds.length
            ? {
                ref: tokById.get(c.centerIds[0])?.ref ?? leftFirst.ref,
                text: c.centerIds.map(id => tokById.get(id)?.surfaceForm ?? '').join(' '),
                wordIds: c.centerIds,
              }
            : null,
          reverseMean: Math.round(c.reverseMean * 1000) / 1000,
          forwardMean: Math.round(c.forwardMean * 1000) / 1000,
          score: Math.round(c.score * 100) / 100,
          confidence: Math.min(0.95, Math.round((0.55 + Math.min(0.35, c.score * 0.1)) * 1000) / 1000),
          pValue: c.pValue ?? null,
          mdlGainBits: c.mdlGainBits ?? null,
          alternativeExplanation: c.forwardMean > 0.35 ? `Partial forward parallelism (mean=${c.forwardMean.toFixed(2)})` : null,
          epistemicClass: 'candidate_literary_pattern',
        });
      }
    }
  }

  // 2. Pericope-level verse/clause chiasm & inclusio (e.g. Gen 11:1-9, Ps 1, 1 Cor 13)
  if (verses.length >= 4 && verses.length <= 45) {
    // Verse-level document frequency so high-frequency recurring formulas don't cause fake pericope chiasms
    const verseDf = new Map<string, number>();
    for (const v of verses) {
      const keys = new Set(
        tokens
          .filter(t => t.verseId === v.verse_id && !t.isFunctionWord && !isVariableSlotToken(t))
          .map(t => t.strongs)
          .filter(Boolean)
      );
      for (const k of keys) verseDf.set(k, (verseDf.get(k) ?? 0) + 1);
    }
    const maxPericopeDf = Math.max(2, Math.floor(verses.length * 0.45));
    const verseNodes = verses.map((v, vi) => {
      const vToks = tokens.filter(t => t.verseId === v.verse_id && !t.isFunctionWord && !isVariableSlotToken(t));
      const rareToks = vToks.filter(t => (verseDf.get(t.strongs) ?? 99) <= maxPericopeDf);
      const feats = [...new Set(rareToks.map(t => `lemma:${t.strongs || t.lemmaKey}`))].slice(0, 30);
      return {
        vi,
        v,
        ref: formatVerseRef(v.book, v.chapter, v.verse_nr),
        toks: vToks,
        rareToks,
        event: {
          id: `v:${v.verse_id}`,
          key: `v:${v.verse_id}`,
          wordIds: vToks.length ? vToks.map(t => t.id) : [`v:${v.verse_id}`],
          features: feats,
        } as LiteraryEvent,
      };
    }).filter(x => x.toks.length > 0);

    // Inclusio check: first vs last verse sharing >= 2 distinct content lemmas, OR a 1-lemma exclusive frame (verseDf===2, including divine/proper names) corroborated by symmetric speaker segments (e.g. Ps 23)
    if (verseNodes.length >= 4) {
      const firstSet = new Map<string, LiteraryToken>();
      const lastSet = new Map<string, LiteraryToken>();
      for (const t of verseNodes[0].toks) firstSet.set(t.strongs, t);
      for (const t of verseNodes[verseNodes.length - 1].toks) lastSet.set(t.strongs, t);
      const sharedIncl = [...firstSet.keys()].filter(
        k => lastSet.has(k) && (verseDf.get(k) ?? 99) <= Math.max(4, Math.ceil(verses.length * 0.6))
      );
      const firstAll = new Map<string, LiteraryToken>();
      const lastAll = new Map<string, LiteraryToken>();
      for (const t of tokens) {
        if (t.isFunctionWord || !t.strongs) continue;
        if (t.verseId === verseNodes[0].v.verse_id) firstAll.set(t.strongs, t);
        if (t.verseId === verseNodes[verseNodes.length - 1].v.verse_id) lastAll.set(t.strongs, t);
      }
      const exclusiveAll = [...firstAll.keys()].filter(k => {
        if (!lastAll.has(k)) return false;
        let occVerses = 0;
        for (const v of verses) {
          if (tokens.some(t => t.verseId === v.verse_id && t.strongs === k)) occVerses++;
        }
        return occVerses === 2;
      });
      const hasSymmetricSpeakerFrame =
        verses.length >= 5 &&
        verses.length <= 12 &&
        speakerSegments.length >= 3 &&
        (speakerSegments[0].dominantLabel === speakerSegments[speakerSegments.length - 1].dominantLabel ||
          (speakerSegments[0].dominantLabel !== '2p' &&
            speakerSegments[speakerSegments.length - 1].dominantLabel !== '2p' &&
            speakerSegments.slice(1, -1).some(s => s.dominantLabel === '2p'))) &&
        speakerSegments.slice(1, -1).some(s => s.dominantLabel !== speakerSegments[0].dominantLabel);
      const useExclusiveKeys = sharedIncl.length < 2 && exclusiveAll.length >= 1 && hasSymmetricSpeakerFrame;
      const inclKeys = useExclusiveKeys ? exclusiveAll : sharedIncl;
      if (sharedIncl.length >= 2 || useExclusiveKeys) {
        const srcFirst = useExclusiveKeys ? firstAll : firstSet;
        const srcLast = useExclusiveKeys ? lastAll : lastSet;
        const lt0 = srcFirst.get(inclKeys[0])!;
        const rt0 = srcLast.get(inclKeys[0])!;
        out.push({
          id: `sym:inclusio:${verseNodes[0].v.verse_id}:${verseNodes[verseNodes.length - 1].v.verse_id}`,
          kind: 'inclusio',
          level: 'unit',
          gapped: true,
          fromRef: verseNodes[0].ref,
          toRef: verseNodes[verseNodes.length - 1].ref,
          pairs: inclKeys.slice(0, 4).map(k => ({
            label: `Frame (${k})`,
            leftRef: verseNodes[0].ref,
            rightRef: verseNodes[verseNodes.length - 1].ref,
            leftText: srcFirst.get(k)!.surfaceForm,
            rightText: srcLast.get(k)!.surfaceForm,
            leftWordIds: [srcFirst.get(k)!.id],
            rightWordIds: [srcLast.get(k)!.id],
            similarity: 1,
            evidenceChannel: 'resolved_lemma',
          })),
          center: null,
          reverseMean: 1,
          forwardMean: 0,
          score: Math.round((inclKeys.length * 1.4) * 100) / 100,
          confidence: Math.min(0.92, 0.55 + inclKeys.length * 0.1),
          alternativeExplanation: `Shared framing vocabulary (${lt0.lemmaScript}, ${rt0.lemmaScript}) could reflect general topic continuity.`,
          epistemicClass: 'candidate_literary_pattern',
        });
      }
    }

    // Verse-level DP chiasm (requires distinct paired verses >= 3 with minSimilarity >= 0.18)
    if (verseNodes.length >= 5) {
      const vCh = discoverChiasms(
        verseNodes.map(x => x.event),
        {
          allowGapped: true,
          minSimilarity: 0.18,
          maxWindow: verseNodes.length,
          gapPenalty: 0.05,
          limit: 2,
        }
      );
      for (const c of vCh) {
        if (c.reverseMean <= c.forwardMean + 0.12) continue;
        const nById = new Map(verseNodes.map(x => [x.event.id, x]));
        const firstN = nById.get(c.pairs[0].leftId)!;
        const lastN = nById.get(c.pairs[0].rightId)!;
        const builtPairs = c.pairs.map((p, idx) => {
          const ln = nById.get(p.leftId)!;
          const rn = nById.get(p.rightId)!;
          const lnRareSet = new Set(ln.rareToks.map(t => t.strongs));
          const sharedRare = rn.rareToks.filter(t => lnRareSet.has(t.strongs));
          const sharedRareS = new Set(sharedRare.map(t => t.strongs));
          return {
            label: String.fromCharCode(65 + idx),
            leftRef: ln.ref,
            rightRef: rn.ref,
            leftText: ln.rareToks.filter(t => sharedRareS.has(t.strongs)).map(t => t.surfaceForm).slice(0, 4).join(' '),
            rightText: sharedRare.map(t => t.surfaceForm).slice(0, 4).join(' '),
            leftWordIds: ln.rareToks.filter(t => sharedRareS.has(t.strongs)).map(t => t.id),
            rightWordIds: sharedRare.map(t => t.id),
            similarity: Math.round(p.similarity * 1000) / 1000,
            evidenceChannel: 'broad_strongs' as const,
            sharedStrongs: [...sharedRareS],
          };
        });
        // Reject adjacent-verse itinerary handoffs (`rn.vi - ln.vi <= 1`) and periodic template repetition
        const nonEmptyPairs = builtPairs.filter(p => p.sharedStrongs.length > 0);
        const nonAdjacentPairs = c.pairs.filter((p, idx) => {
          if (!builtPairs[idx]?.sharedStrongs.length) return false;
          const ln = nById.get(p.leftId)!;
          const rn = nById.get(p.rightId)!;
          return rn.vi - ln.vi >= 2;
        });
        if (nonEmptyPairs.length < 3 || nonAdjacentPairs.length < 3) continue;
        const distinctSharedKeys = new Set(nonEmptyPairs.flatMap(p => p.sharedStrongs));
        if (distinctSharedKeys.size < nonEmptyPairs.length) continue;

        out.push({
          id: `sym:verse:${firstN.v.verse_id}:${lastN.v.verse_id}`,
          kind: c.centerIds.length > 0 ? 'concentric' : 'chiasm',
          level: 'unit',
          gapped: true,
          fromRef: firstN.ref,
          toRef: lastN.ref,
          pairs: builtPairs.map(({ sharedStrongs: _ss, ...rest }) => rest),
          center: c.centerIds.length
            ? {
                ref: nById.get(c.centerIds[0])?.ref ?? firstN.ref,
                text: c.centerIds.map(id => nById.get(id)?.ref ?? '').join(' – '),
                wordIds: c.centerIds.flatMap(id => nById.get(id)?.toks.slice(0, 5).map(t => t.id) ?? []),
              }
            : null,
          reverseMean: Math.round(c.reverseMean * 1000) / 1000,
          forwardMean: Math.round(c.forwardMean * 1000) / 1000,
          score: Math.round((c.score * 1.5) * 100) / 100,
          confidence: Math.min(0.9, Math.round((0.5 + c.reverseMean * 0.4) * 1000) / 1000),
          pValue: c.pValue ?? null,
          mdlGainBits: c.mdlGainBits ?? null,
          alternativeExplanation: 'Verse-level lexical symmetry; compare against discourse outline.',
          epistemicClass: 'candidate_literary_pattern',
        });
      }
    }
  }

  // 3. Adjacent-clause parallelism (multi-link progressive/staircase chains & cross-verse antithetical parallelism)
  let progChain: { a: LiteraryClauseFrame; b: LiteraryClauseFrame; hitStrongs: string; tailA: LiteraryToken[]; headB: LiteraryToken[] }[] = [];
  const flushProgChain = () => {
    if (progChain.length >= 2 && out.length < 20) {
      const first = progChain[0];
      const last = progChain[progChain.length - 1];
      out.push({
        id: `sym:prog:${first.a.id}:${last.b.id}`,
        kind: 'progressive_parallelism',
        level: 'clause',
        gapped: false,
        fromRef: first.a.ref,
        toRef: last.b.ref,
        pairs: progChain.slice(0, 6).map((step, idx) => ({
          label: `Step ${idx + 1}`,
          leftRef: step.a.ref,
          rightRef: step.b.ref,
          leftText: step.tailA.map(t => t.surfaceForm).join(' '),
          rightText: step.headB.map(t => t.surfaceForm).join(' '),
          leftWordIds: step.tailA.filter(t => t.strongs === step.hitStrongs).map(t => t.id),
          rightWordIds: step.headB.filter(t => t.strongs === step.hitStrongs).map(t => t.id),
          similarity: 1,
          evidenceChannel: 'resolved_lemma',
        })),
        center: null,
        reverseMean: 0,
        forwardMean: 1,
        score: Math.round((1.5 + progChain.length * 0.85) * 100) / 100,
        confidence: Math.min(0.92, 0.72 + progChain.length * 0.05),
        alternativeExplanation: null,
        epistemicClass: 'candidate_literary_pattern',
      });
    }
    progChain = [];
  };

  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const aToks = tokens.slice(a.startIndex, a.endIndex + 1).filter(t => !t.isFunctionWord);
    const bToks = tokens.slice(b.startIndex, b.endIndex + 1).filter(t => !t.isFunctionWord);
    if (aToks.length < 2 || bToks.length < 2) {
      flushProgChain();
      continue;
    }
    const aNeg = tokens.slice(a.startIndex, a.endIndex + 1).some(t => NEGATION_STRONGS.has(t.strongs));
    const bNeg = tokens.slice(b.startIndex, b.endIndex + 1).some(t => NEGATION_STRONGS.has(t.strongs));
    const aSet = new Set(aToks.map(t => t.strongs));
    const bSet = new Set(bToks.map(t => t.strongs));
    const shared = [...aSet].filter(k => bSet.has(k));

    // Progressive / staircase parallelism: end of clause A echoed at start of clause B across >= 2 consecutive links (e.g. John 1:1-5)
    const tailA = aToks.slice(-2);
    const headB = bToks.slice(0, 2);
    const staircaseHit = tailA.find(ta => headB.some(hb => hb.strongs === ta.strongs));
    if (staircaseHit) {
      progChain.push({ a, b, hitStrongs: staircaseHit.strongs, tailA, headB });
    } else {
      flushProgChain();
      const isFormulaTag = (toks: LiteraryToken[]) =>
        toks.length <= 2 && toks.some(t => t.strongs === 'H5002' || t.strongs === 'H559' || t.strongs === 'G3004');
      const hasComparableClauseContent =
        shared.length >= 1 ||
        (a.predicatePerson !== null && a.predicatePerson === b.predicatePerson);
      if (aNeg !== bNeg && !isFormulaTag(aToks) && !isFormulaTag(bToks) && hasComparableClauseContent && a.verseId === b.verseId && out.length < 20) {
        out.push({
          id: `sym:anti:${a.id}:${b.id}`,
          kind: 'antithetical_parallelism',
          level: 'clause',
          gapped: false,
          fromRef: a.ref,
          toRef: b.ref,
          pairs: [{
            label: 'Polarity contrast',
            leftRef: a.ref,
            rightRef: b.ref,
            leftText: aToks.map(t => t.surfaceForm).slice(0, 4).join(' '),
            rightText: bToks.map(t => t.surfaceForm).slice(0, 4).join(' '),
            leftWordIds: aToks.slice(0, 3).map(t => t.id),
            rightWordIds: bToks.slice(0, 3).map(t => t.id),
            similarity: 0.75,
            evidenceChannel: 'grammatical',
          }],
          center: null,
          reverseMean: 0,
          forwardMean: 0.75,
          score: 1.65,
          confidence: 0.74,
          alternativeExplanation: 'Negation contrast between adjacent clauses.',
          epistemicClass: 'candidate_literary_pattern',
        });
      }
    }
  }
  flushProgChain();

  return out.sort((a, b) => b.score - a.score).slice(0, 16);
}

/**
 * Map matched consonantal substring onto original UTF-16 character indices of pointed surface_form
 * so the UI can highlight exact corresponding Hebrew/Greek letters!
 */
function findMatchedCharIndices(surfaceForm: string, sharedConsonants: string, edition: LiteraryEdition): number[] {
  if (!surfaceForm || !sharedConsonants) return [];
  const entries: { idx: number; base: string }[] = [];
  for (let i = 0; i < surfaceForm.length; i++) {
    const ch = surfaceForm[i];
    if (edition === 'hbo') {
      const code = ch.charCodeAt(0);
      if (code >= 0x05d0 && code <= 0x05ea) {
        entries.push({ idx: i, base: HEBREW_FINAL_MAP[ch] ?? ch });
      }
    } else {
      const norm = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ');
      if (/^[α-ω]$/.test(norm)) {
        entries.push({ idx: i, base: norm });
      }
    }
  }
  const seq = entries.map(e => e.base).join('');
  const hit = seq.indexOf(sharedConsonants);
  if (hit >= 0) {
    return entries.slice(hit, hit + sharedConsonants.length).map(e => e.idx);
  }
  // Subsequence fallback if sharedConsonants is a skeleton without matres
  const matched: number[] = [];
  let ptr = 0;
  for (const ch of sharedConsonants) {
    while (ptr < entries.length && entries[ptr].base !== ch) ptr++;
    if (ptr < entries.length) {
      matched.push(entries[ptr].idx);
      ptr++;
    }
  }
  return matched;
}

function discoverWordplays(
  tokens: LiteraryToken[],
  verses: ShardVerseInput[],
  symmetries: SymmetryPattern[],
  frames: LiteraryClauseFrame[] = []
): WordplayFinding[] {
  const cuesByVid = new Map<number, string[]>();
  for (const v of verses) {
    const vToks = tokens.filter(t => t.verseId === v.verse_id);
    const cues = detectWordplayContextCues(
      [{ strongsList: vToks.map(t => t.strongs), englishText: v.english_editions?.['0'] ?? '' }],
      tokens[0]?.edition === 'grc_nt' ? 'grc' : 'hbo'
    );
    if (cues.length) cuesByVid.set(v.verse_id, cues);
  }

  const symWordIds = new Set<string>();
  for (const s of symmetries) {
    for (const p of s.pairs) {
      for (const id of p.leftWordIds) symWordIds.add(id);
      for (const id of p.rightWordIds) symWordIds.add(id);
    }
  }

  const consonantMask = (s: string): number => {
    let m = 0;
    for (let k = 0; k < s.length; k++) {
      const code = s.charCodeAt(k);
      m |= 1 << (code & 31);
    }
    return m;
  };
  const popcount = (x: number): number => {
    let c = 0;
    let v = x;
    while (v) { v &= v - 1; c++; }
    return c;
  };
  const normCache = new Map<string, { norm: ReturnType<typeof normalizeOriginalForm>; mask: number }>();
  const getNorm = (t: LiteraryToken) => {
    const k = `${t.edition}|${t.lemmaScript || t.surfaceForm}|${t.strongs}`;
    let n = normCache.get(k);
    if (!n) {
      const norm = normalizeOriginalForm(t.lemmaScript || t.surfaceForm, t.strongs);
      n = { norm, mask: consonantMask(norm.consonantal) };
      normCache.set(k, n);
    }
    return n;
  };

  const out: WordplayFinding[] = [];
  const seenPairs = new Set<string>();
  const seenTokenPairs = new Set<string>();

  // 1. Syntactic talion & clause polyptoton (e.g., Mark 2:27, Gen 9:6, 1 Cor 3:17, Matt 21:41)
  const talionMatches = detectSyntacticTalionAndPolyptoton(tokens, frames);
  for (const m of talionMatches) {
    const a = m.tokenA as LiteraryToken;
    const b = m.tokenB as LiteraryToken;
    const tokPairKey = `${a.id}|${b.id}`;
    if (seenTokenPairs.has(tokPairKey)) continue;
    seenTokenPairs.add(tokPairKey);

    const matchedA = findMatchedCharIndices(a.surfaceForm, m.sharedStem, a.edition);
    const matchedB = findMatchedCharIndices(b.surfaceForm, m.sharedStem, b.edition);
    const isAttested = m.kind === 'syntactic_talion' || m.cues.includes('case_pos_polyptoton');

    out.push({
      id: `wp:talion:${a.id}:${b.id}`,
      epistemicClass: isAttested ? 'attested_textual_wordplay' : 'documented_lexical_relationship',
      overlapKind: m.kind,
      sharedConsonants: m.sharedStem,
      wordA: {
        id: a.id,
        ref: a.ref,
        form: a.surfaceForm,
        transliteration: a.transliteration ?? '',
        gloss: a.gloss ?? '',
        strongs: a.strongs,
        lemma: a.lemmaScript ?? a.surfaceForm,
        matchedCharIndices: matchedA,
      },
      wordB: {
        id: b.id,
        ref: b.ref,
        form: b.surfaceForm,
        transliteration: b.transliteration ?? '',
        gloss: b.gloss ?? '',
        strongs: b.strongs,
        lemma: b.lemmaScript ?? b.surfaceForm,
        matchedCharIndices: matchedB,
      },
      distanceTokens: Math.abs(b.index - a.index),
      inLiteraryContext: true,
      contextCues: m.shiftSummary ? [...m.cues, m.shiftSummary] : m.cues,
      shiftSummary: m.shiftSummary,
      score: m.score,
      confidence: Math.min(0.96, Math.round(m.score * 0.94 * 1000) / 1000),
      etymologyDisclaimer:
        'Morpho-syntactic talion or polyptoton across proximate clauses; reflects shared stem/lemma inflectional inversion.',
    });
  }

  // 2. Onomastic & evaluative valence plays in +-10 verse window (e.g., Philemon 10-11, Micah 1:10-15, 1 Sam 25)
  const onomMatches = detectOnomasticValenceWordplays(tokens);
  const onomByStrongsPair = new Map<string, typeof onomMatches[number]>();
  for (const om of onomMatches) {
    const a = om.properToken as LiteraryToken;
    const b = om.targetToken as LiteraryToken;
    const pairKey = [a.strongs || a.lemmaKey, b.strongs || b.lemmaKey].sort().join('|');
    onomByStrongsPair.set(pairKey, om);
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const matchedA = findMatchedCharIndices(a.surfaceForm, om.sharedConsonants, a.edition);
    const matchedB = findMatchedCharIndices(b.surfaceForm, om.sharedConsonants, b.edition);
    const targetValence = scoreGlossValence(b.gloss ?? '');
    const isAttestedOnomastic =
      om.matchChannel === 'etymological_root' ||
      om.matchChannel === 'etymological_synonym_antonym' ||
      om.score >= 0.85;

    out.push({
      id: `wp:onom:${a.id}:${b.id}`,
      epistemicClass: isAttestedOnomastic ? 'attested_textual_wordplay' : 'documented_lexical_relationship',
      overlapKind: 'onomastic_valence_play',
      sharedConsonants: om.sharedConsonants,
      wordA: {
        id: a.id,
        ref: a.ref,
        form: a.surfaceForm,
        transliteration: a.transliteration ?? '',
        gloss: a.gloss ?? '',
        strongs: a.strongs,
        lemma: a.lemmaScript ?? a.surfaceForm,
        matchedCharIndices: matchedA,
      },
      wordB: {
        id: b.id,
        ref: b.ref,
        form: b.surfaceForm,
        transliteration: b.transliteration ?? '',
        gloss: b.gloss ?? '',
        strongs: b.strongs,
        lemma: b.lemmaScript ?? b.surfaceForm,
        matchedCharIndices: matchedB,
      },
      distanceTokens: Math.abs(b.index - a.index),
      inLiteraryContext: true,
      contextCues: [...om.cues, om.matchChannel, ...om.etymology.etyGlosses.slice(0, 2)],
      matchChannel: om.matchChannel,
      ...(om.etymology.valence !== 0
        ? { valenceContrast: { properValence: om.etymology.valence, targetValence } }
        : {}),
      score: om.score,
      confidence: Math.min(0.96, Math.round(om.score * 0.94 * 1000) / 1000),
      etymologyDisclaimer: `Onomastic etymology (${om.etymology.source}) and contextual semantic/valence correspondence; distinguishes lexical attestation from formal sound similarity.`,
    });
  }

  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i];
    if (a.isFunctionWord || !a.consonantal || a.consonantal.length < 2) continue;
    const { norm: normA, mask: maskA } = getNorm(a);
    if (normA.consonantal.length < 2) continue;

    for (let j = i + 1; j < Math.min(tokens.length, i + 26); j++) {
      const b = tokens[j];
      if (b.isFunctionWord || !b.consonantal || b.consonantal.length < 2) continue;
      if (a.strongs && b.strongs && a.strongs === b.strongs) continue;
      if (a.lemmaKey === b.lemmaKey) continue;

      const pairKey = [a.strongs || a.lemmaKey, b.strongs || b.lemmaKey].sort().join('|');
      if (seenPairs.has(pairKey)) continue;
      // Filter same-Tetragrammaton / orthographically identical vowel-pointing doublets (`H3068`/`H3069`)
      if (
        (a.strongs === 'H3068' && b.strongs === 'H3069') ||
        (a.strongs === 'H3069' && b.strongs === 'H3068')
      ) {
        continue;
      }

      const { norm: normB, mask: maskB } = getNorm(b);
      if (
        normA.consonantal === normB.consonantal &&
        a.gloss &&
        b.gloss &&
        a.gloss.split(/[;,]/)[0].trim().toLowerCase() === b.gloss.split(/[;,]/)[0].trim().toLowerCase()
      ) {
        continue;
      }
      if (
        popcount(maskA & maskB) < 2 &&
        Math.abs(normA.phoneticClass.length - normB.phoneticClass.length) > 1
      ) {
        continue;
      }
      const metrics = compareOriginalForms(normA, normB);
      if (!metrics.comparable) continue;
      if (metrics.shared_consonants.length < 2) continue;
      // Reject weak matches on long Hebrew/Greek words or coincidental short-stem overlap
      const maxLen = Math.max(normA.consonantal.length, normB.consonantal.length);
      const minNoMat = Math.max(1, Math.min((normA.skeletonNoMatres || normA.consonantal).length, (normB.skeletonNoMatres || normB.consonantal).length));
      const maxNoMat = Math.max(1, Math.max((normA.skeletonNoMatres || normA.consonantal).length, (normB.skeletonNoMatres || normB.consonantal).length));
      const preliminaryRatio = metrics.shared_consonants.length / maxNoMat;
      if (a.edition === 'grc_nt') {
        if (metrics.shared_consonants.length < 3 || maxLen < 4 || metrics.overlap_kind === 'phonetic_similarity') {
          continue;
        }
        if (preliminaryRatio < 0.42 && minNoMat >= 4) {
          continue;
        }
      } else if (metrics.shared_consonants.length === 2 && maxLen >= 4 && preliminaryRatio < 0.66) {
        continue;
      }

      const matchedA = findMatchedCharIndices(a.surfaceForm, metrics.shared_consonants, a.edition);
      const matchedB = findMatchedCharIndices(b.surfaceForm, metrics.shared_consonants, b.edition);
      if (matchedA.length === 0 || matchedB.length === 0) continue;

      const minVid = Math.min(a.verseId, b.verseId);
      const maxVid = Math.max(a.verseId, b.verseId);
      const spanTokens = tokens.filter(t => t.verseId >= minVid && t.verseId <= maxVid);
      const spanEn = verses
        .filter(v => v.verse_id >= minVid && v.verse_id <= maxVid)
        .map(v => v.english_editions?.['0'] ?? '')
        .join(' ');
      const localCues = Math.abs(a.verseId - b.verseId) <= 1
        ? detectWordplayContextCues(
            [{ strongsList: spanTokens.map(t => t.strongs), englishText: spanEn }],
            tokens[0]?.edition === 'grc_nt' ? 'grc' : 'hbo'
          )
        : [];
      const cues = [...new Set(localCues)];
      const noMatA = normA.skeletonNoMatres || normA.consonantal;
      const noMatB = normB.skeletonNoMatres || normB.consonantal;
      const minNoMatresLen = Math.max(1, Math.min(noMatA.length, noMatB.length));
      const maxNoMatresLen = Math.max(1, Math.max(noMatA.length, noMatB.length));
      const overlapRatio = metrics.shared_consonants.length / maxNoMatresLen;
      const exactNoMatresMatch = noMatA.length >= 2 && noMatA === noMatB;
      const hasStrongRootOverlap =
        metrics.shared_consonants.length >= 3 ||
        (metrics.shared_consonants.length >= 2 && (exactNoMatresMatch || (overlapRatio >= 0.72 && minNoMatresLen <= 3 && maxNoMatresLen <= 3)));
      const hasProperName = isProperNounToken(a) || isProperNounToken(b);
      const hasAttestedCue =
        cues.includes('naming_etiological_formula') ||
        cues.includes('creation_formation_cue') ||
        cues.includes('greek_interpretation_formula') ||
        cues.includes('naming_formula') ||
        (cues.includes('prophetic_vision_qa') &&
          !hasProperName &&
          (metrics.shared_consonants.length >= 3 || exactNoMatresMatch));
      const isGenericDiscourseToken = (t: LiteraryToken) =>
        ['H7200', 'H559', 'H0559', 'H6030', 'H7725', 'H1961', 'H7751', 'H5869', 'H5771', 'H7651', 'H3117', 'H5769'].includes(t.strongs);
      const inSym = symWordIds.has(a.id) || symWordIds.has(b.id);
      const qualifiesAttested =
        hasStrongRootOverlap &&
        metrics.formal_score >= 0.65 &&
        !isGenericDiscourseToken(a) &&
        !isGenericDiscourseToken(b) &&
        (hasAttestedCue || (a.edition === 'hbo' && hasProperName && j - i <= 8 && metrics.shared_consonants.length >= 3));
      if (qualifiesAttested && hasProperName && !cues.includes('proper_name_paronomasia')) {
        cues.push('proper_name_paronomasia');
      }
      const proximityBonus = a.verseId === b.verseId ? 0.14 : Math.max(0, 0.08 - (j - i) * 0.003);
      const literaryBonus = (qualifiesAttested ? 0.16 : 0) + (inSym ? 0.1 : 0);
      const score = Math.round((metrics.formal_score + proximityBonus + literaryBonus) * 1000) / 1000;
      if (score < 0.62) continue;

      seenPairs.add(pairKey);
      const isGreekCognatePair =
        a.edition === 'grc_nt' &&
        (metrics.overlap_kind === 'prefix_suffix_overlap' ||
          (metrics.shared_consonants.length >= 4 && overlapRatio >= 0.55));
      const epistemicClass: WordplayFinding['epistemicClass'] =
        qualifiesAttested
          ? 'attested_textual_wordplay'
          : (metrics.overlap_kind === 'prefix_suffix_overlap' || isGreekCognatePair)
            ? 'documented_lexical_relationship'
            : 'orthographic_similarity_only';

      out.push({
        id: `wp:${a.id}:${b.id}`,
        epistemicClass,
        overlapKind: metrics.overlap_kind,
        sharedConsonants: metrics.shared_consonants,
        wordA: {
          id: a.id,
          ref: a.ref,
          form: a.surfaceForm,
          transliteration: a.transliteration,
          gloss: a.gloss,
          strongs: a.strongs,
          lemma: a.lemmaScript,
          matchedCharIndices: matchedA,
        },
        wordB: {
          id: b.id,
          ref: b.ref,
          form: b.surfaceForm,
          transliteration: b.transliteration,
          gloss: b.gloss,
          strongs: b.strongs,
          lemma: b.lemmaScript,
          matchedCharIndices: matchedB,
        },
        distanceTokens: j - i,
        inLiteraryContext: qualifiesAttested || inSym,
        contextCues: qualifiesAttested ? cues : [],
        score,
        confidence: Math.min(0.95, Math.round((score * 0.9) * 1000) / 1000),
        etymologyDisclaimer:
          'Formal consonantal/phonetic similarity in proximate text only; does not establish shared historical etymology.',
      });
    }
  }

  return out
    .sort((a, b) => {
      const attDiff =
        (b.epistemicClass === 'attested_textual_wordplay' ? 1 : 0) -
        (a.epistemicClass === 'attested_textual_wordplay' ? 1 : 0);
      return attDiff !== 0 ? attDiff : b.score - a.score;
    })
    .slice(0, 24);
}

function discoverAcrostics(tokens: LiteraryToken[], verses: ShardVerseInput[]): AcrosticFinding[] {
  if (!tokens.length || tokens[0].edition !== 'hbo' || verses.length < 8) return [];
  const findings: AcrosticFinding[] = [];

  const firstConsonant = (tok: LiteraryToken | undefined): string => {
    if (!tok) return '';
    const c = stripHebrew(tok.surfaceForm);
    return c[0] ?? '';
  };

  // Mode 1: Verse-initial (including grouped stanzas like Psalm 119 where every 8 verses share a letter)
  const verseInitials = verses
    .filter(v => v.verse_nr >= 1)
    .map(v => {
      const t0 = tokens.find(t => t.verseId === v.verse_id);
      return {
        verseId: v.verse_id,
        ref: formatVerseRef(v.book, v.chapter, v.verse_nr),
        tok: t0,
        letter: firstConsonant(t0),
      };
    })
    .filter(x => x.tok && x.letter);

  for (const stanzaSize of [1, 2, 8]) {
    const minGroups = stanzaSize === 8 ? 3 : 6;
    if (verseInitials.length < stanzaSize * minGroups) continue;
    const entries: AcrosticFinding['entries'] = [];
    let matched = 0;
    const groups = Math.min(22, Math.floor(verseInitials.length / stanzaSize));
    for (let g = 0; g < groups; g++) {
      const expected = HEBREW_ALPHABET[g];
      const slice = verseInitials.slice(g * stanzaSize, (g + 1) * stanzaSize);
      const hits = slice.filter(s => s.letter === expected).length;
      const isMatch = hits >= Math.ceil(stanzaSize * 0.75);
      if (isMatch) matched++;
      entries.push({
        letter: slice[0].letter,
        expectedLetter: expected,
        ref: slice[0].ref,
        wordId: slice[0].tok!.id,
        form: slice[0].tok!.surfaceForm,
        matched: isMatch,
      });
    }
    const coverageRatio = matched / 22;
    const stepRatio = groups > 0 ? matched / groups : 0;
    if (matched >= minGroups && stepRatio >= 0.75) {
      const missingLetters = HEBREW_ALPHABET.slice(0, groups).filter((_, idx) => !entries[idx]?.matched);
      findings.push({
        id: `acr:stanza${stanzaSize}`,
        mode: stanzaSize === 1 ? 'verse_initial' : 'multi_verse_stanza',
        stanzaSize,
        lettersCovered: matched,
        totalLetters: 22,
        coverageRatio: Math.round(coverageRatio * 1000) / 1000,
        entries,
        missingLetters,
        confidence: Math.min(0.99, Math.round(stepRatio * 1000) / 1000),
        epistemicClass: 'direct_textual_evidence',
      });
    }
  }

  // Mode 2: Half-verse / colon acrostic using poetic cantillation dividers (1, 1.0, 1.1)
  const colonInitials: { ref: string; tok: LiteraryToken; letter: string }[] = [];
  for (const v of verses) {
    if (v.verse_nr < 1) continue;
    const vToks = tokens.filter(t => t.verseId === v.verse_id);
    if (!vToks.length) continue;
    const ref = formatVerseRef(v.book, v.chapter, v.verse_nr);
    // Detect optional 2-word liturgical opening (`הללו יה` before colon starting with א)
    let startIdx = 0;
    if (
      v.verse_nr === 1 &&
      vToks.length >= 4 &&
      firstConsonant(vToks[0]) !== 'א' &&
      firstConsonant(vToks[2]) === 'א'
    ) {
      startIdx = 2;
    }
    colonInitials.push({ ref: `${ref}a`, tok: vToks[startIdx], letter: firstConsonant(vToks[startIdx]) });
    const atnachIdx = vToks.findIndex((t, i) => i > startIdx && t.cantillation === '1');
    if (vToks.length >= 9 && atnachIdx > startIdx + 2) {
      // Tricolon verse: include primary pre-atnach poetic divider (`1.0` or `1.1`) if present inside [startIdx+1 .. atnachIdx-2]
      const preDiv = vToks.findIndex(
        (t, i) => i > startIdx + 1 && i < atnachIdx - 1 && (t.cantillation === '1.0' || t.cantillation === '1.1')
      );
      if (preDiv >= 0) {
        const tPre = vToks[preDiv + 1];
        colonInitials.push({ ref: `${ref}b`, tok: tPre, letter: firstConsonant(tPre) });
      }
    }
    if (atnachIdx > startIdx && atnachIdx + 1 < vToks.length) {
      const bTok = vToks[atnachIdx + 1];
      colonInitials.push({
        ref: `${ref}${vToks.length >= 9 && atnachIdx > startIdx + 2 ? 'c' : 'b'}`,
        tok: bTok,
        letter: firstConsonant(bTok),
      });
    }
  }
  if (colonInitials.length >= 16) {
    let matched = 0;
    const entries: AcrosticFinding['entries'] = [];
    const lim = Math.min(22, colonInitials.length);
    for (let i = 0; i < lim; i++) {
      const expected = HEBREW_ALPHABET[i];
      const item = colonInitials[i];
      const ok = item.letter === expected;
      if (ok) matched++;
      entries.push({
        letter: item.letter,
        expectedLetter: expected,
        ref: item.ref,
        wordId: item.tok.id,
        form: item.tok.surfaceForm,
        matched: ok,
      });
    }
    if (matched >= 14 && matched / lim >= 0.78) {
      findings.push({
        id: 'acr:half_verse',
        mode: 'half_verse_atnach',
        stanzaSize: 1,
        lettersCovered: matched,
        totalLetters: 22,
        coverageRatio: Math.round((matched / 22) * 1000) / 1000,
        entries,
        missingLetters: HEBREW_ALPHABET.filter((_, idx) => !entries[idx]?.matched),
        confidence: Math.min(0.99, Math.round((matched / lim) * 1000) / 1000),
        epistemicClass: 'direct_textual_evidence',
      });
    }
  }

  return findings.sort((a, b) => b.lettersCovered - a.lettersCovered);
}

function discoverKeyWordsAndThemes(
  tokens: LiteraryToken[],
  seg: SegmentationCandidate | null,
  r13?: R13CorpusContext
): {
  keyWords: KeyWordDistribution[];
  thematicClusters: ThematicCluster[];
  speakerShifts: LiteraryAnalysisResult['speakerShifts'];
} {
  const byStrongs = new Map<string, LiteraryToken[]>();
  for (const t of tokens) {
    if (t.isFunctionWord || !t.strongs) continue;
    const arr = byStrongs.get(t.strongs) ?? [];
    arr.push(t);
    byStrongs.set(t.strongs, arr);
  }

  const minFreq = tokens.length <= 45 ? 2 : 3;
  const keyWords: KeyWordDistribution[] = [];
  for (const [strongs, list] of byStrongs) {
    if (list.length < minFreq) continue;
    const unitCounts = seg
      ? seg.units.map(u => list.filter(t => t.index >= u.fromTokenIndex && t.index < u.toTokenIndex).length)
      : [];
    const verseRefs = [...new Set(list.map(t => t.ref))];
    const sample = list[0];
    const idfSalience = Math.round(list.length * Math.log(1 + tokens.length / list.length) * 100) / 100;
    const isNotableCount = NOTABLE_COUNTS.has(list.length);
    keyWords.push({
      strongs,
      lemmaKey: sample.lemmaKey,
      script: sample.lemmaScript,
      transliteration: sample.transliteration,
      gloss: sample.gloss,
      count: list.length,
      unitCounts,
      verseRefs: verseRefs.slice(0, 20),
      wordIds: list.map(t => t.id),
      idfSalience,
      isNotableCount,
      notableCountLabel: isNotableCount ? `Observed textual count: ${list.length}` : undefined,
    });
  }
  keyWords.sort((a, b) => b.count - a.count || b.idfSalience - a.idfSalience);

  // Thematic clusters via R13 concept aliases & motifs
  const thematicClusters: ThematicCluster[] = [];
  if (r13?.conceptAliases) {
    for (const [alias, info] of Object.entries(r13.conceptAliases)) {
      const strongsSet = new Set((info.strongs ?? []).map(normStrongs));
      const hits = tokens.filter(t => !t.isFunctionWord && strongsSet.has(t.strongs));
      if (hits.length < 3) continue;
      const distinctLemmas = new Map<string, { strongs: string; script: string; gloss: string; count: number }>();
      for (const h of hits) {
        const entry = distinctLemmas.get(h.strongs) ?? {
          strongs: h.strongs,
          script: h.lemmaScript,
          gloss: h.gloss,
          count: 0,
        };
        entry.count++;
        distinctLemmas.set(h.strongs, entry);
      }
      if (distinctLemmas.size < 2) continue;
      const unitIndices = seg
        ? [...new Set(seg.units.filter(u => hits.some(h => h.index >= u.fromTokenIndex && h.index < u.toTokenIndex)).map(u => u.index))]
        : [];
      thematicClusters.push({
        id: `theme:concept:${alias}`,
        themeLabel: alias,
        source: 'r13_concept',
        lemmas: [...distinctLemmas.values()].sort((a, b) => b.count - a.count),
        wordIds: hits.map(h => h.id).slice(0, 40),
        refs: [...new Set(hits.map(h => h.ref))].slice(0, 15),
        unitIndices,
        score: Math.round((hits.length * (1 + distinctLemmas.size * 0.25)) * 100) / 100,
        evidenceChannel: 'semantic',
      });
    }
  }
  // Zero-dependency original-language relational & analogical extractors
  const seenClusterIds = new Set(thematicClusters.map(c => c.id));
  const tokByIdTheme = new Map<string, LiteraryToken>(tokens.map(t => [t.id, t]));
  const unitOfTokIdx = (idx: number): number | null => {
    if (!seg) return null;
    const u = seg.units.find(x => idx >= x.fromTokenIndex && idx < x.toTokenIndex);
    return u ? u.index : null;
  };

  // 1) Analogical correspondence markers (`כַּאֲשֶׁר ... כֵּן`, `כְּ ... כֵּן`, `ὥσπερ ... οὕτως`)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const isAnalogyOpen = t.strongs === 'H834' || t.strongs === 'H3541' || t.strongs === 'G5618';
    const isCompareOpen = isAnalogyOpen || (t.edition === 'hbo' && t.surfaceForm.startsWith('כְּ') && i > 0 && tokens[i - 1]?.verseId !== t.verseId);
    if (!isCompareOpen) continue;
    const closeIdx = tokens.findIndex(
      (x, k) => k > i + 2 && k <= i + 45 && (x.strongs === 'H3651' || x.strongs === 'G3779')
    );
    if (closeIdx < 0) continue;
    const spanToks = tokens.slice(i, Math.min(tokens.length, closeIdx + 18)).filter(x => !x.isFunctionWord && x.strongs);
    if (spanToks.length < 4) continue;
    const uniqLemmas = new Map<string, { strongs: string; script: string; gloss: string; count: number }>();
    for (const st of spanToks) {
      const prev = uniqLemmas.get(st.strongs) ?? { strongs: st.strongs, script: st.lemmaScript, gloss: st.gloss, count: 0 };
      prev.count++;
      uniqLemmas.set(st.strongs, prev);
    }
    const id = `theme:analogy:${tokens[i].verseId}:${tokens[closeIdx].verseId}`;
    if (seenClusterIds.has(id) || uniqLemmas.size < 3) continue;
    seenClusterIds.add(id);
    const preview = [...uniqLemmas.values()].slice(0, 3).map(l => l.script).join(' · ');
    thematicClusters.push({
      id,
      themeLabel: `Analogical comparison (${preview})`,
      source: 'predicate_role_frame',
      lemmas: [...uniqLemmas.values()].slice(0, 10),
      wordIds: spanToks.map(x => x.id).slice(0, 32),
      refs: [...new Set(spanToks.map(x => x.ref))].slice(0, 8),
      unitIndices: [...new Set(spanToks.map(x => unitOfTokIdx(x.index)).filter((x): x is number => x !== null))],
      score: Math.round((spanToks.length * 1.45) * 100) / 100,
      evidenceChannel: 'grammatical',
    });
  }

  // 2) Paired opposing-frame construction (`X + A ... conj + X + B`, e.g., Ecclesiastes 3:2-8 `עֵת ל... וְעֵת ל...`)
  const headOppositions = new Map<string, { pairs: { a: LiteraryToken; b: LiteraryToken; head: LiteraryToken }[] }>();
  for (let i = 0; i + 3 < tokens.length; i++) {
    const h1 = tokens[i];
    if (h1.isFunctionWord || !h1.strongs) continue;
    const p1 = tokens[i + 1];
    const h2 = tokens[i + 2];
    const p2 = tokens[i + 3];
    if (!p1 || !h2 || !p2 || h2.strongs !== h1.strongs) continue;
    if (p1.strongs && p2.strongs && p1.strongs !== p2.strongs && !p1.isFunctionWord && !p2.isFunctionWord) {
      const grp = headOppositions.get(h1.strongs) ?? { pairs: [] };
      grp.pairs.push({ a: p1, b: p2, head: h1 });
      headOppositions.set(h1.strongs, grp);
    }
  }
  for (const [hKey, grp] of headOppositions) {
    if (grp.pairs.length < 3) continue;
    const id = `theme:paired:${hKey}`;
    if (seenClusterIds.has(id)) continue;
    seenClusterIds.add(id);
    const allToksUniq: LiteraryToken[] = [];
    const seenTokIds = new Set<string>();
    for (const p of grp.pairs) {
      for (const lt of [p.head, p.a, p.b]) {
        if (!seenTokIds.has(lt.id)) {
          seenTokIds.add(lt.id);
          allToksUniq.push(lt);
        }
      }
    }
    const lemmaMap = new Map<string, { strongs: string; script: string; gloss: string; count: number }>();
    for (const lt of allToksUniq) {
      const prev = lemmaMap.get(lt.strongs) ?? { strongs: lt.strongs, script: lt.lemmaScript, gloss: lt.gloss, count: 0 };
      prev.count++;
      lemmaMap.set(lt.strongs, prev);
    }
    thematicClusters.push({
      id,
      themeLabel: `Paired opposing series (${grp.pairs[0].head.lemmaScript} · ${grp.pairs.length} pairs)`,
      source: 'predicate_role_frame',
      lemmas: [...lemmaMap.values()].sort((a, b) => b.count - a.count).slice(0, 12),
      wordIds: allToksUniq.map(t => t.id).slice(0, 40),
      refs: [...new Set(allToksUniq.map(t => t.ref))].slice(0, 10),
      unitIndices: [...new Set(allToksUniq.map(t => unitOfTokIdx(t.index)).filter((x): x is number => x !== null))],
      score: Math.round((grp.pairs.length * 2.5) * 100) / 100,
      evidenceChannel: 'grammatical',
    });
  }

  // 3) Distributional predicate-role clusters (distinct original lemmas occupying shared grammatical frame slots, e.g., Torah nouns in Ps 119)
  const verbToRoleLemmas = new Map<string, Map<string, LiteraryToken[]>>();
  for (const t of tokens) {
    if (t.isFunctionWord || !t.strongs || isVariableSlotToken(t)) continue;
    if (t.posClass === 'noun' || /^H?Nc/.test(t.grammarCode) || /^N-/.test(t.grammarCode)) {
      const winStart = Math.max(0, t.index - 4);
      const winEnd = Math.min(tokens.length, t.index + 5);
      for (let k = winStart; k < winEnd; k++) {
        const ctxTok = tokens[k];
        if (k === t.index || ctxTok.verseId !== t.verseId || ctxTok.isFunctionWord) continue;
        if (ctxTok.posClass === 'verb' || /^(?:H?V|A?V|V-)/.test(ctxTok.grammarCode)) {
          const m = verbToRoleLemmas.get(ctxTok.strongs) ?? new Map<string, LiteraryToken[]>();
          const arr = m.get(t.strongs) ?? [];
          if (!arr.some(existing => existing.id === t.id)) arr.push(t);
          m.set(t.strongs, arr);
          verbToRoleLemmas.set(ctxTok.strongs, m);
        }
      }
    }
  }
  for (const [vKey, argMap] of verbToRoleLemmas) {
    const sharedArgs = [...argMap.entries()].filter(([, list]) => list.length >= 1);
    if (sharedArgs.length < 3) continue;
    const totalOcc = sharedArgs.reduce((s, [, list]) => s + list.length, 0);
    if (totalOcc < 4) continue;
    const vTok = tokens.find(t => t.strongs === vKey);
    const id = `theme:role:${vKey}`;
    if (!vTok || seenClusterIds.has(id)) continue;
    seenClusterIds.add(id);
    const allArgToks: LiteraryToken[] = [];
    const seenArgIds = new Set<string>();
    for (const [, list] of sharedArgs) {
      for (const lt of list) {
        if (!seenArgIds.has(lt.id)) {
          seenArgIds.add(lt.id);
          allArgToks.push(lt);
        }
      }
    }
    thematicClusters.push({
      id,
      themeLabel: `Shared role with ${vTok.lemmaScript} (${sharedArgs.length} terms)`,
      source: 'predicate_role_frame',
      lemmas: sharedArgs
        .map(([s, list]) => ({ strongs: s, script: list[0].lemmaScript, gloss: list[0].gloss, count: list.length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      wordIds: allArgToks.map(t => t.id).slice(0, 36),
      refs: [...new Set(allArgToks.map(t => t.ref))].slice(0, 10),
      unitIndices: [...new Set(allArgToks.map(t => unitOfTokIdx(t.index)).filter((x): x is number => x !== null))],
      score: Math.round((sharedArgs.length * 1.4 + totalOcc * 0.4) * 100) / 100,
      evidenceChannel: 'grammatical',
    });
  }

  // 4) Morphological 3-consonant root families linking distinct lemmas in the passage
  const rootGroups = new Map<string, Map<string, LiteraryToken[]>>();
  for (const t of tokens) {
    if (t.isFunctionWord || !t.strongs || t.consonantal.length < 3) continue;
    const skel = t.consonantal.slice(0, 3);
    const grp = rootGroups.get(skel) ?? new Map<string, LiteraryToken[]>();
    const arr = grp.get(t.strongs) ?? [];
    arr.push(t);
    grp.set(t.strongs, arr);
    rootGroups.set(skel, grp);
  }
  for (const [skel, lemMap] of rootGroups) {
    if (lemMap.size < 2 || lemMap.size > 6) continue;
    const allToks = [...lemMap.values()].flat();
    if (allToks.length < 4) continue;
    const id = `theme:root:${skel}`;
    if (seenClusterIds.has(id)) continue;
    seenClusterIds.add(id);
    thematicClusters.push({
      id,
      themeLabel: `Root family ${skel} (${lemMap.size} lemmas)`,
      source: 'r13_motif',
      lemmas: [...lemMap.entries()].map(([s, list]) => ({
        strongs: s,
        script: list[0].lemmaScript,
        gloss: list[0].gloss,
        count: list.length,
      })),
      wordIds: allToks.map(t => t.id).slice(0, 32),
      refs: [...new Set(allToks.map(t => t.ref))].slice(0, 10),
      unitIndices: [...new Set(allToks.map(t => unitOfTokIdx(t.index)).filter((x): x is number => x !== null))],
      score: Math.round((lemMap.size * 1.5 + allToks.length * 0.3) * 100) / 100,
      evidenceChannel: 'resolved_lemma',
    });
  }
  void tokByIdTheme;
  thematicClusters.sort((a, b) => b.score - a.score);

  // Speaker / grammatical perspective transitions across verses (verbs + Hebrew pronominal suffixes like Ps 23:4)
  const speakerShifts: LiteraryAnalysisResult['speakerShifts'] = [];
  let prevDomPerson: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const sufMatch = /\/Sp([123][mfc][sp])/.exec(t.grammarCode);
    const effPerson = t.person ?? (sufMatch ? sufMatch[1] : null);
    if (!effPerson || (t.isFunctionWord && t.strongs !== 'G1510' && t.strongs !== 'H1961')) continue;
    const pNum = effPerson[0];
    if (prevDomPerson && prevDomPerson !== pNum) {
      speakerShifts.push({
        ref: t.ref,
        prevPerson: prevDomPerson,
        nextPerson: effPerson,
        wordId: t.id,
        form: t.surfaceForm,
        kind: `${prevDomPerson}p_to_${pNum}p`,
      });
    }
    prevDomPerson = pNum;
  }

  return {
    keyWords: keyWords.slice(0, 20),
    thematicClusters: thematicClusters.slice(0, 8),
    speakerShifts: speakerShifts.slice(0, 12),
  };
}

function compareMtAndLxx(
  verses: ShardVerseInput[],
  mtTokens: LiteraryToken[],
  lxxWords?: LxxWordInput[]
): LxxEditionComparison | null {
  if (!verses.length) return null;

  interface LxxVerseEntry {
    book_no: number;
    word_count: number;
    norm: string;
    tail_text: string;
  }
  const lxxByCoord = new Map<string, LxxVerseEntry>();
  let fallbackBookNo = 0;

  if (lxxWords?.length) {
    fallbackBookNo = Number(lxxWords[0].book_no);
    const grouped = new Map<string, LxxWordInput[]>();
    for (const w of lxxWords) {
      const key = `${w.chapter}:${w.verse_nr}`;
      const arr = grouped.get(key) ?? [];
      arr.push(w);
      grouped.set(key, arr);
    }
    for (const [k, ws] of grouped) {
      lxxByCoord.set(k, {
        book_no: Number(ws[0].book_no),
        word_count: ws.length,
        norm: ws.map(w => w.normalized_word).join(' '),
        tail_text: ws.slice(-8).map(w => w.word_text).join(' '),
      });
    }
  } else {
    for (const v of verses) {
      if (Array.isArray(v.lxx_verses) && v.lxx_verses.length > 0) {
        for (const lv of v.lxx_verses) {
          if (!fallbackBookNo && lv.book_no) fallbackBookNo = Number(lv.book_no);
          lxxByCoord.set(`${lv.chapter}:${lv.verse_nr}`, {
            book_no: Number(lv.book_no),
            word_count: Number(lv.word_count),
            norm: String(lv.norm ?? ''),
            tail_text: String(lv.tail_text ?? lv.text ?? ''),
          });
        }
      } else if (v.lxx_target_tokens && typeof v.lxx_target_tokens === 'object') {
        for (const [k, list] of Object.entries(v.lxx_target_tokens)) {
          if (!Array.isArray(list) || !list.length) continue;
          const sortedList = [...list].sort((a, b) => Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0));
          const parts = k.split(':');
          const bNo = Number(parts[0]) || Number(v.hebrew_lxx_verse_map?.[0]?.lxx_book_no ?? v.book);
          const ch = Number(parts[1]) || Number(v.hebrew_lxx_verse_map?.[0]?.lxx_chapter ?? v.chapter);
          const vr = Number(parts[3]) || Number(v.hebrew_lxx_verse_map?.[0]?.lxx_verse_nr ?? v.verse_nr);
          if (!fallbackBookNo) fallbackBookNo = bNo;
          lxxByCoord.set(`${ch}:${vr}`, {
            book_no: bNo,
            word_count: sortedList.length,
            norm: sortedList.map(w => String(w.normalized_word ?? '')).join(' '),
            tail_text: sortedList.slice(-8).map(w => String(w.word_text ?? '')).join(' '),
          });
        }
      }
    }
  }

  if (!lxxByCoord.size) return null;
  const lxxBookNo = fallbackBookNo || verses[0].book;

  const versificationNotes: LxxEditionComparison['versificationNotes'] = [];
  const divergences: LxxEditionComparison['divergences'] = [];
  let lxxTokenCount = 0;
  let mappedVerses = 0;

  // Known LXX formula check (e.g. `ειδεν ο θεος οτι καλον` / Swete `ιδεν`)
  const hasLxxEvalGood = (norm: string): boolean =>
    /(?:ε)?ιδεν\s+ο\s+θεος\s+οτι\s+καλ/.test(norm);
  const hasMtEvalGood = (vToks: LiteraryToken[]): boolean => {
    const joined = vToks.map(t => stripHebrew(t.surfaceForm)).join(' ');
    return /ירא\s+אלהימ\s+כי\s+טוב/.test(joined);
  };
  const NOTABLE_LXX_SHIFTS: Array<{
    strongs: string;
    mtLabel: string;
    lxxRe: RegExp;
    lxxLabel: string;
    note: string;
  }> = [
    {
      strongs: 'H7160',
      mtLabel: 'קָרַן (qaran — shine / emit horns-rays)',
      lxxRe: /(?:δεδοξασ|δοξαζ)/,
      lxxLabel: 'δοξάζω (be glorified)',
      note: 'Swete LXX translates Hebrew H7160 ("shone/horned") with Greek δοξάζω ("was glorified", cf. 2 Cor 3:7).',
    },
    {
      strongs: 'H6780',
      mtLabel: 'צֶמַח (tsemach — Branch / Sprout)',
      lxxRe: /ανατολ/,
      lxxLabel: 'Ἀνατολή (Rising / Dawn / Branch)',
      note: 'Swete LXX renders Hebrew H6780 ("Branch") with Ἀνατολή ("Dawn / Rising One", cf. Luke 1:78).',
    },
    {
      strongs: 'H1350',
      mtLabel: 'גָּאַל (gaʾal — redeem as kinsman)',
      lxxRe: /λυτρο|αγχιστ/,
      lxxLabel: 'λυτρόω / ἀγχιστεύς',
      note: 'Swete LXX differentiates ransom/redemption (λυτρόω) and next-of-kin terminology.',
    },
  ];

  for (const v of verses) {
    const mapEntry = (v.hebrew_lxx_verse_map ?? [])[0];
    const lxxCh = mapEntry ? Number(mapEntry.lxx_chapter) : v.chapter;
    const lxxV = mapEntry ? Number(mapEntry.lxx_verse_nr) : v.verse_nr;
    const mtRef = formatVerseRef(v.book, v.chapter, v.verse_nr);
    const lxxRef = `LXX ${BOOK_NAMES[v.book] ?? v.book} ${lxxCh}:${lxxV}`;
    if (mapEntry && String(mapEntry.mapping_kind ?? '') !== 'same_reference') {
      versificationNotes.push({ mtRef, lxxRef, mappingKind: String(mapEntry.mapping_kind) });
    }
    const lxxEntry = lxxByCoord.get(`${lxxCh}:${lxxV}`);
    if (!lxxEntry) continue;
    mappedVerses++;
    lxxTokenCount += lxxEntry.word_count;

    const mtToks = mtTokens.filter(t => t.verseId === v.verse_id);
    const mtEval = hasMtEvalGood(mtToks);
    const lxxEval = hasLxxEvalGood(lxxEntry.norm);
    const mtExcerpt = mtToks.slice(0, 6).map(t => t.surfaceForm).join(' ');
    const matchedLexShift = NOTABLE_LXX_SHIFTS.find(
      rule => mtToks.some(t => t.strongs === rule.strongs) && rule.lxxRe.test(lxxEntry.norm),
    );
    if (!mtEval && lxxEval) {
      divergences.push({
        kind: 'lxx_formula_addition',
        mtRef,
        lxxRef,
        description: `Swete LXX includes the evaluation formula ("καὶ εἶδεν ὁ θεὸς ὅτι καλόν") in ${lxxRef}, which is absent in MT ${mtRef}.`,
        mtExcerpt: mtToks.slice(-4).map(t => t.surfaceForm).join(' '),
        lxxExcerpt: lxxEntry.tail_text,
      });
    } else if (mtEval && !lxxEval) {
      divergences.push({
        kind: 'lxx_formula_omission',
        mtRef,
        lxxRef,
        description: `Swete LXX lacks the evaluation formula present in MT ${mtRef}.`,
        mtExcerpt,
        lxxExcerpt: lxxEntry.tail_text,
      });
    } else if (matchedLexShift) {
      divergences.push({
        kind: 'lexical_theological_shift',
        mtRef,
        lxxRef,
        description: `${matchedLexShift.note} (${matchedLexShift.mtLabel} → ${matchedLexShift.lxxLabel}).`,
        mtExcerpt,
        lxxExcerpt: lxxEntry.tail_text,
      });
    } else if (
      mtToks.length >= 4 &&
      (Math.abs(lxxEntry.word_count - mtToks.length * 1.35) >= 6 ||
        lxxEntry.word_count / Math.max(1, mtToks.length) >= 2.0 ||
        lxxEntry.word_count / Math.max(1, mtToks.length) <= 0.68)
    ) {
      divergences.push({
        kind: 'length_divergence',
        mtRef,
        lxxRef,
        description: `Notable token-count divergence between MT (${mtToks.length} tokens) and Swete LXX (${lxxEntry.word_count} words).`,
        mtExcerpt,
        lxxExcerpt: lxxEntry.tail_text,
      });
    }
  }

  return {
    lxxBookNo,
    mappedVerses,
    versificationNotes: versificationNotes.slice(0, 12),
    divergences: divergences.slice(0, 15),
    lxxTokenCount,
  };
}

function buildPatternFamilies(args: {
  tokens: LiteraryToken[];
  frames: LiteraryClauseFrame[];
  segmentation: SegmentationCandidate | null;
  template: LiteraryAnalysisResult['template'];
  deviations: LiteraryDeviationItem[];
  symmetries: SymmetryPattern[];
  wordplays: WordplayFinding[];
  acrostics: AcrosticFinding[];
  thematicClusters: ThematicCluster[];
  keyWords: KeyWordDistribution[];
}): LiteraryPatternFamily[] {
  const {
    tokens,
    frames,
    segmentation,
    template,
    deviations,
    symmetries,
    wordplays,
    acrostics,
    thematicClusters,
    keyWords,
  } = args;

  const families: LiteraryPatternFamily[] = [];
  const tokById = new Map<string, LiteraryToken>(tokens.map(t => [t.id, t]));
  const frameByWordId = new Map<string, LiteraryClauseFrame>();
  for (const f of frames) {
    for (const wid of f.wordIds) {
      if (!frameByWordId.has(wid)) frameByWordId.set(wid, f);
    }
  }
  const unitOfIdx = (idx: number): number | null => {
    if (!segmentation) return null;
    const u = segmentation.units.find(x => idx >= x.fromTokenIndex && idx < x.toTokenIndex);
    return u ? u.index : null;
  };
  const devsByWordId = new Map<string, LiteraryDeviationItem[]>();
  for (const d of deviations) {
    for (const wid of d.witnessWordIds) {
      const arr = devsByWordId.get(wid) ?? [];
      arr.push(d);
      devsByWordId.set(wid, arr);
    }
  }

  let nextColorSlot = 0;
  const makeSpanFromWordIds = (
    spanId: string,
    wids: string[],
    fallbackRef: string,
    unitIndex: number | null,
    role?: string,
    nestedDepth = 0
  ): LiteraryPatternSpan | null => {
    const uniqWids = [...new Set(wids)];
    const resolved = uniqWids.map(id => tokById.get(id)).filter((t): t is LiteraryToken => Boolean(t)).sort((a, b) => a.index - b.index);
    if (!resolved.length) return null;
    const first = resolved[0];
    const last = resolved[resolved.length - 1];
    const matchedDevs = [...new Set(resolved.flatMap(t => devsByWordId.get(t.id) ?? []))];
    const topDev = matchedDevs[0];
    return {
      spanId,
      ref: first.ref || fallbackRef,
      fromTokenIndex: first.index,
      toTokenIndex: last.index,
      wordIds: resolved.map(t => t.id),
      text: resolved.map(t => t.surfaceForm).join(' '),
      gloss: resolved.map(t => t.gloss).filter(Boolean).slice(0, 5).join(' '),
      unitIndex,
      role,
      hasDeviation: matchedDevs.length > 0,
      deviationKind: topDev?.kind,
      deviationNote: topDev?.description,
      deviationIds: matchedDevs.map(d => d.id),
      nestedDepth,
    };
  };

  // 1. Primary phrase/clause functional families derived from template slots & grammatical clause functions
  if (template && segmentation) {
    const meaningfulSlots = template.slots.filter(
      s =>
        s.canonicalKey !== 'slot:narrative_action' &&
        !s.canonicalKey.startsWith('slot:var:') &&
        (s.support >= 0.4 || s.role === 'emerging')
    );
    // Merge multiple occurrences of the same literary function (e.g., Speech Opener or Evaluation) into one family
    const groupedByFunction = new Map<
      string,
      { label: string; canonicalKey: string; slots: ReconstructedTemplateSlot[] }
    >();
    for (const slot of meaningfulSlots) {
      const normKey =
        slot.canonicalKey === 'slot:evaluation_good' || slot.canonicalKey === 'slot:evaluation_see'
          ? 'func:evaluation'
          : slot.canonicalKey.startsWith('slot:speech:')
            ? 'func:speech_opener'
            : slot.canonicalKey === 'slot:closing_formula'
              ? 'func:closing_formula'
              : `slot:${slot.canonicalKey}`;
      const existing = groupedByFunction.get(normKey);
      if (!existing) {
        groupedByFunction.set(normKey, { label: slot.label, canonicalKey: slot.canonicalKey, slots: [slot] });
      } else {
        existing.slots.push(slot);
      }
    }

    const sortedGroups = [...groupedByFunction.entries()]
      .sort((a, b) => {
        const supA = Math.max(...a[1].slots.map(s => s.support));
        const supB = Math.max(...b[1].slots.map(s => s.support));
        return supB - supA || b[1].slots.length - a[1].slots.length;
      })
      .slice(0, 7);

    for (const [gKey, grp] of sortedGroups) {
      const spans: LiteraryPatternSpan[] = [];
      const seenSpanKeys = new Set<string>();
      for (const slot of grp.slots) {
        for (const cell of slot.cells) {
          if (!cell.present || !cell.wordIds.length) continue;
          const fr = frameByWordId.get(cell.wordIds[0]);
          const expandIds = fr ? fr.wordIds : cell.wordIds;
          const key = `${expandIds[0]}..${expandIds[expandIds.length - 1]}`;
          if (seenSpanKeys.has(key)) continue;
          seenSpanKeys.add(key);
          const span = makeSpanFromWordIds(
            `span:${gKey}:${cell.unitIndex}:${spans.length}`,
            expandIds,
            cell.ref ?? segmentation.units[cell.unitIndex]?.fromRef ?? '',
            cell.unitIndex,
            slot.role,
            segmentation.units[cell.unitIndex]?.subunits.length ? 1 : 0
          );
          if (span) spans.push(span);
        }
      }
      if (spans.length < 2) continue;
      spans.sort((a, b) => a.fromTokenIndex - b.fromTokenIndex);
      const maxSupport = Math.max(...grp.slots.map(s => s.support));
      const colorSlot = nextColorSlot++ % 8;
      families.push({
        id: `fam:${gKey}`,
        category: 'template_function',
        label: grp.label,
        description: `Recurring literary function across ${new Set(spans.map(s => s.unitIndex)).size}/${segmentation.units.length} units.`,
        colorSlot,
        priority: families.length < 6 ? 'primary' : 'secondary',
        defaultVisible: maxSupport >= 0.45 && families.length < 6,
        evidenceChannel: 'grammatical',
        epistemicClass: 'grammatical_observation',
        spans,
      });
    }
  }

  // 2. Symmetries (chiasms, inclusio, progressive staircase, antithetical)
  symmetries.slice(0, 4).forEach((sym, sIdx) => {
    const spans: LiteraryPatternSpan[] = [];
    sym.pairs.forEach((p, pIdx) => {
      const lSpan = makeSpanFromWordIds(
        `span:sym:${sIdx}:L${pIdx}`,
        p.leftWordIds,
        p.leftRef,
        null,
        `${p.label}`,
        sym.pairs.length - pIdx - 1
      );
      const rSpan = makeSpanFromWordIds(
        `span:sym:${sIdx}:R${pIdx}`,
        p.rightWordIds,
        p.rightRef,
        null,
        `${p.label}'`,
        sym.pairs.length - pIdx - 1
      );
      if (lSpan) spans.push(lSpan);
      if (rSpan) spans.push(rSpan);
    });
    if (sym.center?.wordIds.length) {
      const cSpan = makeSpanFromWordIds(`span:sym:${sIdx}:C`, sym.center.wordIds, sym.center.ref, null, 'Center', sym.pairs.length);
      if (cSpan) spans.push(cSpan);
    }
    if (!spans.length) return;
    families.push({
      id: `fam:${sym.id}`,
      category: 'symmetry',
      label: `${sym.kind.replaceAll('_', ' ')} (${sym.fromRef}–${sym.toRef})`,
      description: `${sym.pairs.length} paired mirror/parallel element(s) at ${sym.level} level (score ${sym.score}).`,
      colorSlot: (nextColorSlot++) % 8,
      priority: sIdx < 2 ? 'primary' : 'secondary',
      defaultVisible: sym.confidence >= 0.72 && sIdx < 2,
      evidenceChannel: sym.pairs[0]?.evidenceChannel ?? 'resolved_lemma',
      epistemicClass: sym.epistemicClass,
      spans,
    });
  });

  // 3. Thematic & Relational clusters (analogy, opposing pairs, shared role frames)
  thematicClusters.slice(0, 3).forEach((tc, tIdx) => {
    const byVerse = new Map<string, string[]>();
    for (const wid of tc.wordIds) {
      const tok = tokById.get(wid);
      if (!tok) continue;
      const arr = byVerse.get(tok.ref) ?? [];
      arr.push(wid);
      byVerse.set(tok.ref, arr);
    }
    const spans: LiteraryPatternSpan[] = [];
    for (const [ref, wids] of byVerse) {
      const firstTok = tokById.get(wids[0]);
      const sp = makeSpanFromWordIds(`span:theme:${tIdx}:${spans.length}`, wids, ref, firstTok ? unitOfIdx(firstTok.index) : null, tc.source);
      if (sp) spans.push(sp);
    }
    if (!spans.length) return;
    families.push({
      id: `fam:${tc.id}`,
      category: 'thematic',
      label: tc.themeLabel,
      description: `Relational/conceptual correspondence uniting ${tc.lemmas.length} original-language terms across ${tc.refs.length} verse(s).`,
      colorSlot: (nextColorSlot++) % 8,
      priority: tIdx === 0 ? 'primary' : 'secondary',
      defaultVisible: tIdx === 0 && tc.source === 'predicate_role_frame',
      evidenceChannel: tc.evidenceChannel,
      epistemicClass: 'candidate_literary_pattern',
      spans,
    });
  });

  // 4. Wordplay families (primary for attested contextual wordplay; exploratory for purely orthographic overlap)
  wordplays.slice(0, 4).forEach((wp, wIdx) => {
    const spanA = makeSpanFromWordIds(`span:wp:${wIdx}:A`, [wp.wordA.id], wp.wordA.ref, null, 'Wordplay A');
    const spanB = makeSpanFromWordIds(`span:wp:${wIdx}:B`, [wp.wordB.id], wp.wordB.ref, null, 'Wordplay B');
    const spans = [spanA, spanB].filter((s): s is LiteraryPatternSpan => Boolean(s));
    if (spans.length < 2) return;
    const isAttested = wp.epistemicClass === 'attested_textual_wordplay';
    families.push({
      id: `fam:${wp.id}`,
      category: 'wordplay',
      label: `${wp.wordA.form} ↔ ${wp.wordB.form}`,
      description: `${wp.overlapKind.replaceAll('_', ' ')} (${wp.sharedConsonants}). ${wp.etymologyDisclaimer}`,
      colorSlot: (nextColorSlot++) % 8,
      priority: isAttested ? 'primary' : 'exploratory',
      defaultVisible: isAttested && wIdx < 2,
      evidenceChannel: 'orthographic',
      epistemicClass: wp.epistemicClass,
      spans,
    });
  });

  // 5. Acrostic landmarks
  acrostics.forEach((ac, aIdx) => {
    const spans = ac.entries
      .map((e, eIdx) => makeSpanFromWordIds(`span:acr:${aIdx}:${eIdx}`, [e.wordId], e.ref, null, e.expectedLetter))
      .filter((s): s is LiteraryPatternSpan => Boolean(s));
    if (!spans.length) return;
    families.push({
      id: `fam:${ac.id}`,
      category: 'acrostic',
      label: `Acrostic (${ac.mode.replaceAll('_', ' ')}, ${ac.lettersCovered}/22)`,
      description: `Alphabetic acrostic sequence with stanza size ${ac.stanzaSize}.`,
      colorSlot: (nextColorSlot++) % 8,
      priority: 'primary',
      defaultVisible: true,
      evidenceChannel: 'exact_form',
      epistemicClass: ac.epistemicClass,
      spans,
    });
  });

  // 6. Optional Keywords (Leitwörter) — disabled by default so primary view highlights meaningful phrase/clause functions!
  keyWords.slice(0, 5).forEach((kw, kIdx) => {
    const spans = kw.wordIds
      .map((wid, wIdx) => {
        const t = tokById.get(wid);
        return makeSpanFromWordIds(`span:kw:${kIdx}:${wIdx}`, [wid], t?.ref ?? '', t ? unitOfIdx(t.index) : null, `×${kw.count}`);
      })
      .filter((s): s is LiteraryPatternSpan => Boolean(s));
    if (!spans.length) return;
    families.push({
      id: `fam:kw:${kw.strongs}`,
      category: 'keyword',
      label: `${kw.script} (${kw.gloss || kw.strongs}) ×${kw.count}`,
      description: `Repeated keyword distribution (${kw.transliteration}, IDF salience ${kw.idfSalience}).`,
      colorSlot: (kIdx + 2) % 8,
      priority: 'secondary',
      defaultVisible: false,
      evidenceChannel: 'resolved_lemma',
      epistemicClass: kw.isNotableCount ? 'observed_textual_count' : 'direct_textual_evidence',
      spans,
    });
  });

  return families;
}

export function analyzeLiteraryPassage(
  input: LiteraryEngineInput,
  options: LiteraryAnalysisOptions = {}
): LiteraryAnalysisResult {
  const { edition, tokens, verseList } = tokenizeShardVerses(input.verses);
  const { frames, syntaxVerses } = extractClauseFrames(verseList, tokens, edition);

  const segmentations = buildSegmentationCandidates(tokens, verseList, frames);
  const primarySeg = segmentations[0] ?? null;
  const alternativeSegmentations = options.includeAlternatives ? segmentations.slice(1, 4) : [];

  const { template, deviations } = primarySeg
    ? buildTemplateAndDeviations(primarySeg, tokens, frames)
    : { template: null, deviations: [] };

  const verseRegimeLabels = buildVerseRegimeLabels(verseList, tokens);
  const peltRes = detectPeltChangepoints(verseRegimeLabels, {
    penaltyScale: verseList.length <= 10 ? 0.4 : 0.55,
    minSegmentLength: 1,
  });
  const speakerSegments: SpeakerSegment[] = peltRes.segments
    .filter(s => s.start < verseList.length && s.end > s.start)
    .map(s => {
      const vStart = verseList[s.start];
      const vEnd = verseList[Math.min(verseList.length - 1, s.end - 1)];
      return {
        startVerseIndex: s.start,
        endVerseIndex: s.end,
        fromRef: formatVerseRef(vStart.book, vStart.chapter, vStart.verse_nr),
        toRef: formatVerseRef(vEnd.book, vEnd.chapter, vEnd.verse_nr),
        dominantLabel: s.dominantLabel,
      };
    });

  const commandFulfillments = discoverCommandFulfillments(frames, tokens, primarySeg);
  const correspondences = discoverCrossUnitCorrespondences(primarySeg, tokens, input.r13, template);
  const symmetries = discoverSymmetries(tokens, verseList, frames, speakerSegments);
  const wordplays = discoverWordplays(tokens, verseList, symmetries, frames);
  const acrostics = discoverAcrostics(tokens, verseList);
  const { keyWords, thematicClusters, speakerShifts } = discoverKeyWordsAndThemes(tokens, primarySeg, input.r13);

  const hasInlineLxx = verseList.some(
    v => (v.lxx_verses?.length ?? 0) > 0 || (v.lxx_target_tokens && Object.keys(v.lxx_target_tokens).length > 0)
  );
  const lxxComparison =
    options.compareLxx && edition === 'hbo' && (input.lxxWords?.length || hasInlineLxx)
      ? compareMtAndLxx(verseList, tokens, input.lxxWords)
      : null;

  const minStrength = options.minStrength ?? 0;
  const filteredDeviations = minStrength > 0 ? deviations.filter(d => d.confidence >= minStrength) : deviations;
  const filteredSymmetries = minStrength > 0 ? symmetries.filter(s => s.confidence >= minStrength) : symmetries;
  const filteredWordplays = minStrength > 0 ? wordplays.filter(w => w.confidence >= minStrength) : wordplays;

  const limitations: string[] = [];
  if (syntaxVerses < verseList.length) {
    limitations.push(`MACULA syntax covers ${syntaxVerses}/${verseList.length} verses; unannotated verses fall back to morphological clause estimation.`);
  }
  if (tokens.some(t => t.lemmaSource === 'strongs_fallback')) {
    limitations.push('Some tokens lack disambiguated STEP lemma keys and use broad Strong’s identifiers; homographs are not collapsed.');
  }
  if (input.truncated) {
    limitations.push('Requested range exceeded per-call verse cap and was bounded explicitly.');
  }
  limitations.push('Detected structures, wordplays, and deviations are corpus-grounded literary candidates, not claims of historical etymology or theological necessity.');

  const isCompact = options.detail === 'compact';
  const patternFamilies = buildPatternFamilies({
    tokens,
    frames,
    segmentation: primarySeg,
    template,
    deviations: filteredDeviations,
    symmetries: filteredSymmetries,
    wordplays: filteredWordplays,
    acrostics,
    thematicClusters,
    keyWords,
  });

  return {
    schemaVersion: 1,
    passage: input.passage,
    edition,
    tokenCount: tokens.length,
    verseCount: verseList.length,
    tokens: isCompact ? [] : tokens,
    segmentation: primarySeg,
    alternativeSegmentations,
    template,
    patternFamilies,
    deviations: filteredDeviations,
    correspondences,
    commandFulfillments,
    symmetries: filteredSymmetries,
    wordplays: filteredWordplays,
    keyWords,
    acrostics,
    thematicClusters,
    speakerShifts,
    speakerSegments,
    peltChangepoints: peltRes.changepoints,
    lxxComparison,
    coverage: {
      syntaxVerses,
      totalVerses: verseList.length,
      syntaxComplete: syntaxVerses === verseList.length && verseList.length > 0,
      truncated: Boolean(input.truncated),
    },
    limitations,
  };
}
