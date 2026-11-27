// @file: src/ui/components/WordInspector.ts
// @feature: word-modal
// @tables: words | reader_rendering_groups | verse_translation_sources | assertions | lexical_formations | lemma_components | lexical_connections
// @candidates: none
// @toc: imports | types | logic:grammar | logic:occurrences | ui:main | ui:summary | ui:origin | ui:occurrences | ui:disclosures | logic:inspect | logic:page

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import {
  lxxConcordanceV3Rpc,
  wordplayScanV3Rpc,
  type LxxConcordanceV3Result,
  type WordplayScanV3Result,
} from '../../api/r10-rpc';
import type {
  R9BLxxCandidateLemma,
  R9BLxxLayerResult,
  R9BLxxTranslationItem,
} from '../../api/relationships-rpc';
import type {
  ActivePassage,
  MatchedLemmaRecord,
  OrthographicCandidateRecord,
  ReaderOccurrence,
  ReaderOverview,
  ReaderWord,
  ResearchLexemeCandidate,
  VerseGeographyPacket,
  VerseTranslationToken,
  WordFormationResponse,
  WordRecord,
} from '../../api/types';
import type { RelationshipNotePrefill } from '../../api/relationship-notes-adapter';
import { explorationState, type Anchor, type ConnectionEdge } from '../exploration-state';
import { appState } from '../state';
import { action, el, status } from '../study-dom';
import { calculateGematria, formatVerseRef } from '../utils';
import { detectContextTools, type ContextToolChip, type ContextToolKind } from '../context-tools/ContextToolDialog';
import {
  type CuratedMediaAsset,
  loadBiblePlacesIndex,
  renderMediaFigure,
  resolvePlaceForWord,
} from '../context-tools/curated-media-manifest';
import {
  type BiblicalPerson,
  buildBoundedFamilyNeighborhood,
  loadFullPeopleGraph,
  loadVersePersonIndex,
  resolvePersonForWordInVerse,
} from '../context-tools/people-data';
import {
  type BiblicalTribeEntry,
  detectTribeForWord,
} from '../context-tools/table-of-nations';
import {
  type ArchitectureDetection,
  type ArchitecturePlanId,
  detectArchitectureForWord,
  renderArchitectureSvg,
} from '../context-tools/sacred-architecture';
import type { ContextPreview } from './ContextPreview';
import type { ClaimComposerPrefill } from './ClaimComposerDialog';
import { createDiscoveryGraph } from './DiscoveryGraph';
import { createLexicalRelationshipsSection } from './LexicalRelationshipsSection';
import { createMiniPlaceMap, type MiniPlaceMapHandle } from './MiniPlaceMap';
import { createWordNotes } from './WordNotes';

// === @section:types ===
export interface WordDiscoveryOrigin {
  word_id: number;
  book: number;
  chapter: number;
  verse: number;
  position?: number;
  lemma_id?: string;
  strongs_nr: string;
  original_word: string;
  transliteration: string;
  english?: string;
}

export interface WordInspectorGraphOptions {
  onFollowPassage?: (p: ActivePassage, edge: ConnectionEdge) => void;
  onCreateHypothesis?: (from: Anchor, to?: Anchor) => void;
  onExpandFullGraph?: (query: string, passage: ActivePassage, label?: string) => void;
  onOpenContextTool?: (kind: ContextToolKind, id: string, planId?: ArchitecturePlanId) => void;
  onOpenClaimComposer?: (prefill: ClaimComposerPrefill) => void;
  onClose?: () => void;
}

interface Selection {
  id: number;
  position?: number;
  english?: string;
  rendering?: string;
  suggested?: boolean;
  lemmaId?: string;
}

type OccurrenceOrderMode = 'revealing' | 'canonical';

interface RankedOccurrence {
  item: ReaderOccurrence;
  whyTag: string;
}

const INITIAL_OCCURRENCE_COUNT = 4;
const MAX_LXX_CACHE = 80;

const lxxSummaryCache = new Map<string, R9BLxxLayerResult | null>();
const lxxV3Cache = new Map<string, LxxConcordanceV3Result | null>();
const wordplayV3Cache = new Map<string, WordplayScanV3Result | null>();

function readBoundedCache<V>(cache: Map<string, V>, key: string): V | undefined {
  if (!cache.has(key)) return undefined;
  const val = cache.get(key)!;
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function writeBoundedCache<V>(cache: Map<string, V>, key: string, value: V): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_LXX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

function normStrongs4Local(raw: string | null | undefined): string {
  const m = /^([HG])0*(\d+)(?:[A-Z].*)?$/i.exec(String(raw || '').trim());
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : '';
}

function normalizeLxxCacheKey(strongs: string, lemmaId?: string | null, extendedStrongs?: string | null): string {
  const base = strongs.trim().toUpperCase();
  if (lemmaId && lemmaId.trim()) return `${base}|${lemmaId.trim().toLowerCase()}`;
  if (extendedStrongs && extendedStrongs.trim()) return extendedStrongs.trim().toUpperCase();
  return base;
}

function getCachedLxxLayer(key: string): R9BLxxLayerResult | null | undefined {
  if (!lxxSummaryCache.has(key)) return undefined;
  const cached = lxxSummaryCache.get(key);
  lxxSummaryCache.delete(key);
  lxxSummaryCache.set(key, cached ?? null);
  return cached ?? null;
}

function setCachedLxxLayer(key: string, value: R9BLxxLayerResult | null): void {
  if (lxxSummaryCache.has(key)) {
    lxxSummaryCache.delete(key);
  } else if (lxxSummaryCache.size >= MAX_LXX_CACHE) {
    const oldest = lxxSummaryCache.keys().next().value;
    if (oldest !== undefined) lxxSummaryCache.delete(oldest);
  }
  lxxSummaryCache.set(key, value);
}

function formatLxxShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  const pct = share * 100;
  return pct < 1 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

function buildLxxResolveQueries(
  cand: R9BLxxCandidateLemma | undefined,
  fallbackStrong: string | null | undefined,
  fallbackLemmaKey: string | undefined,
): string[] {
  const rawCode = fallbackStrong || cand?.extended_strongs || cand?.lemma_key || fallbackLemmaKey || '';
  const cleaned = rawCode.replace(/^lemma:/i, '').trim();
  const baseMatch = /^([HG]0*\d+)[A-Za-z]?$/i.exec(cleaned);
  return [
    baseMatch?.[1] ?? cleaned,
    cand?.original_script?.trim() ?? '',
    cand?.transliteration?.trim() ?? '',
  ].filter((q, idx, arr) => q.length > 0 && arr.indexOf(q) === idx);
}

// === @section:logic:grammar ===
function cleanGloss(raw?: string | null): string {
  return raw ? raw.replaceAll('/', ' ').replace(/\s+/g, ' ').trim() : '';
}

function getPrimaryGloss(word: WordRecord, selected: Selection): string {
  return (
    cleanGloss(selected.english)
    || cleanGloss(word.english_translations?.[0])
    || word.transliteration
    || word.original_word
  );
}

function decodeGreekCode(raw: string): string | null {
  const invariables: Record<string, string> = {
    PREP: 'preposition',
    CONJ: 'conjunction',
    ADV: 'adverb',
    PRT: 'particle',
    INJ: 'interjection',
    HEB: 'Hebrew transliteration',
    ARAM: 'Aramaic transliteration',
  };
  if (invariables[raw]) return invariables[raw];
  if (!raw.includes('-')) return null;
  const [form, morph] = raw.split('-');
  const posMap: Record<string, string> = {
    V: 'verb',
    N: 'noun',
    A: 'adjective',
    T: 'article',
    P: 'pronoun',
    R: 'relative pronoun',
    C: 'reciprocal pronoun',
    D: 'demonstrative pronoun',
    I: 'interrogative pronoun',
    X: 'indefinite pronoun',
    F: 'reflexive pronoun',
    S: 'possessive pronoun',
    Q: 'correlative pronoun',
  };
  const parts: string[] = [];
  if (form && posMap[form]) parts.push(posMap[form]);
  if (!morph) return parts.length ? parts.join(' · ') : null;
  if (form === 'V') {
    const tense: Record<string, string> = { P: 'present', I: 'imperfect', F: 'future', A: 'aorist', X: 'perfect', Y: 'pluperfect' };
    const voice: Record<string, string> = { A: 'active', M: 'middle', P: 'passive', E: 'middle/passive' };
    const mood: Record<string, string> = { I: 'indicative', S: 'subjunctive', O: 'optative', M: 'imperative', N: 'infinitive', P: 'participle' };
    if (morph[0] && tense[morph[0]]) parts.push(tense[morph[0]]);
    if (morph[1] && voice[morph[1]]) parts.push(voice[morph[1]]);
    if (morph[2] && mood[morph[2]]) parts.push(mood[morph[2]]);
  } else {
    const kase: Record<string, string> = { N: 'nominative', G: 'genitive', D: 'dative', A: 'accusative', V: 'vocative' };
    const num: Record<string, string> = { S: 'singular', P: 'plural' };
    const gen: Record<string, string> = { M: 'masculine', F: 'feminine', N: 'neuter' };
    if (morph[0] && kase[morph[0]]) parts.push(kase[morph[0]]);
    if (morph[1] && num[morph[1]]) parts.push(num[morph[1]]);
    if (morph[2] && gen[morph[2]]) parts.push(gen[morph[2]]);
  }
  return parts.length ? parts.join(' · ') : null;
}

function decodeHebrewCode(raw: string): string | null {
  const segs = raw.split('/').filter(Boolean);
  if (!segs.length) return null;
  const parts: string[] = [];
  const genderMap: Record<string, string> = { m: 'masculine', f: 'feminine', b: 'both genders', c: 'common' };
  const numMap: Record<string, string> = { s: 'singular', p: 'plural', d: 'dual' };
  const stateMap: Record<string, string> = { a: 'absolute', c: 'construct', d: 'determined' };
  for (let idx = 0; idx < segs.length; idx += 1) {
    let seg = segs[idx]!;
    if (idx === 0 && (seg.startsWith('H') || seg.startsWith('A'))) seg = seg.slice(1);
    if (!seg) continue;
    if (idx < segs.length - 1) {
      if (seg === 'R') parts.push('preposition');
      else if (seg === 'C') parts.push('conjunction');
      else if (seg === 'Td') parts.push('definite article');
      else if (seg === 'To') parts.push('object marker');
      else if (seg === 'Ti') parts.push('interrogative');
      continue;
    }
    if (seg === 'To') { parts.push('direct object marker'); continue; }
    const pos = seg[0];
    if (pos === 'N') {
      parts.push(seg[1] === 'p' ? 'proper noun' : 'noun');
      if (seg[2] && genderMap[seg[2]]) parts.push(genderMap[seg[2]]);
      if (seg[3] && numMap[seg[3]]) parts.push(numMap[seg[3]]);
      if (seg[4] && stateMap[seg[4]]) parts.push(stateMap[seg[4]]);
    } else if (pos === 'V') {
      const stem: Record<string, string> = { q: 'qal', N: 'niphal', p: 'piel', P: 'pual', h: 'hiphil', H: 'hophal', t: 'hithpael' };
      const aspect: Record<string, string> = { p: 'perfect', i: 'imperfect', w: 'wayyiqtol', v: 'imperative', a: 'infinitive absolute', c: 'infinitive construct', r: 'active participle', s: 'passive participle' };
      parts.push('verb');
      if (seg[1] && stem[seg[1]]) parts.push(stem[seg[1]]);
      if (seg[2] && aspect[seg[2]]) parts.push(aspect[seg[2]]);
      if (seg[3] && /[123]/.test(seg[3])) parts.push(`${seg[3] === '1' ? '1st' : seg[3] === '2' ? '2nd' : '3rd'} person`);
      if (seg[4] && genderMap[seg[4]]) parts.push(genderMap[seg[4]]);
      if (seg[5] && numMap[seg[5]]) parts.push(numMap[seg[5]]);
    } else if (pos === 'A') {
      parts.push('adjective');
      if (seg[2] && genderMap[seg[2]]) parts.push(genderMap[seg[2]]);
      if (seg[3] && numMap[seg[3]]) parts.push(numMap[seg[3]]);
    } else if (pos === 'P') parts.push('pronoun');
    else if (pos === 'R') parts.push('preposition');
    else if (pos === 'C') parts.push('conjunction');
    else if (pos === 'D') parts.push('adverb');
    else if (pos === 'T') parts.push('particle');
  }
  return parts.length ? parts.join(' · ') : null;
}

function decodePlainGrammar(
  grammarMap: Record<string, unknown> | null | undefined,
  grammarCode: string | null,
): string | null {
  if (grammarMap) {
    const parts: string[] = [];
    for (const value of Object.values(grammarMap)) {
      if (typeof value === 'string' && value.trim()) {
        parts.push(value.trim());
      } else if (Array.isArray(value)) {
        const joined = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).join(' + ');
        if (joined) parts.push(joined);
      }
    }
    if (parts.length) return parts.join(' · ');
  }
  if (!grammarCode) return null;
  const trimmed = grammarCode.trim();
  if (!trimmed) return null;
  return decodeGreekCode(trimmed) ?? decodeHebrewCode(trimmed);
}

// === @section:logic:occurrences ===
const occVerseKey = (o: ReaderOccurrence) => `${o.book}-${o.chapter}-${o.verse}`;

function rerankOccurrences(
  items: ReaderOccurrence[],
  mode: OccurrenceOrderMode,
  seenBooks: Set<number>,
  seenRenderings: Set<string>,
  seenVerses: Set<string>,
): RankedOccurrence[] {
  if (mode === 'canonical') {
    const out: RankedOccurrence[] = [];
    for (const item of items) {
      const vKey = occVerseKey(item);
      if (seenVerses.has(vKey)) continue;
      seenVerses.add(vKey);
      out.push({ item, whyTag: 'Canonical order' });
    }
    return out;
  }

  const pool = items.filter(item => !seenVerses.has(occVerseKey(item)));
  const ranked: RankedOccurrence[] = [];

  while (pool.length > 0) {
    const hasBooks = seenBooks.size > 0;
    const hasRenderings = seenRenderings.size > 0;
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < pool.length; i += 1) {
      const cand = pool[i]!;
      if (seenVerses.has(occVerseKey(cand))) continue;
      const isNewBook = !seenBooks.has(cand.book);
      const normRend = cleanGloss(cand.source_english).toLowerCase();
      const isNewRendering = normRend.length > 0 && !seenRenderings.has(normRend);
      const score = (isNewBook ? 3 : 0) + (isNewRendering ? 2 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;
    const [chosen] = pool.splice(bestIdx, 1);
    if (!chosen) break;
    const chosenKey = occVerseKey(chosen);
    if (seenVerses.has(chosenKey)) continue;

    const isDiffBook = hasBooks && !seenBooks.has(chosen.book);
    const chosenNorm = cleanGloss(chosen.source_english).toLowerCase();
    const isDiffRendering = hasRenderings && chosenNorm.length > 0 && !seenRenderings.has(chosenNorm);

    let whyTag = 'Canonical order';
    if (isDiffBook && isDiffRendering) whyTag = 'Different book · contrasting rendering';
    else if (isDiffRendering) whyTag = 'Contrasting rendering';
    else if (isDiffBook) whyTag = 'New book context';

    seenBooks.add(chosen.book);
    if (chosenNorm) seenRenderings.add(chosenNorm);
    seenVerses.add(chosenKey);
    ranked.push({ item: chosen, whyTag });
  }

  return ranked;
}

// === @section:ui:main ===
export function createWordInspector(
  preview: ContextPreview,
  navigate: (p: ActivePassage) => void,
  onAddNote?: (data: { word: WordRecord; position?: number }) => void,
  onEvaluateRelationship?: (prefill: RelationshipNotePrefill) => void,
  onDiscoverConnectionsForWord?: (term: string, origin?: WordDiscoveryOrigin) => void,
  onComparePassage?: (p: ActivePassage) => void,
  graphOpts?: WordInspectorGraphOptions,
) {
  const element = el('aside', 'word-inspector');
  element.setAttribute('aria-label', 'Word focus and connections');

  let generation = 0;
  let selection: Selection | null = null;
  let overview: ReaderOverview | null = null;
  let verseTokens: VerseTranslationToken[] = [];
  let currentGeographyPacket: VerseGeographyPacket | null = null;
  let miniMap: MiniPlaceMapHandle | null = null;
  let activeSpotlightHost: HTMLElement | null = null;
  let currentData: ReaderWord | null = null;
  let currentPassageForInspect: ActivePassage | null = null;
  let occurrenceMode: OccurrenceOrderMode = 'revealing';
  let loadedOccurrences: ReaderOccurrence[] = [];
  let latestOccurrenceMeta: Pick<ReaderWord, 'token_total' | 'verse_total' | 'next_cursor'> | null = null;
  let visibleOccurrenceLimit = INITIAL_OCCURRENCE_COUNT;
  let deepLayersLoadedRequest = -1;
  let companionsLoadedRequest = -1;
  let rgDossierLoadedRequest = -1;

  const shownBooks = new Set<number>();
  const shownRenderings = new Set<string>();
  const shownVerses = new Set<string>();
  const history: Selection[] = [];

  let opener: HTMLElement | null = null;
  const close = () => {
    element.dataset.open = 'false';
    graphOpts?.onClose?.();
    if (opener?.isConnected) opener.focus();
  };

  const closeButton = action('✕', close, 'inspector-close');
  closeButton.setAttribute('aria-label', 'Close word inspector');
  closeButton.title = 'Close inspector (Esc)';

  const back = action('← Previous word', () => {
    const previous = history.pop();
    if (previous) void inspect(previous, false);
  }, 'text-action');
  back.hidden = true;

  const returnPassage = action('', () => {
    navigate(appState.getPassage());
  }, 'text-action return-passage-btn');
  returnPassage.hidden = true;

  const paneBar = el('div', 'inspector-pane-bar');
  const paneBarLeft = el('div', 'inspector-pane-bar__left');
  paneBarLeft.append(
    el('span', 'eyebrow inspector-pane-eyebrow', 'WORD FOCUS'),
    back,
    returnPassage,
  );
  paneBar.append(paneBarLeft, closeButton);

  // Section 1: Identity & Meaning
  const summary = el('section', 'inspector-summary inspector-section');
  summary.append(
    el('h2', 'inspector-empty-title', 'Select a word'),
    status('Choose any word in the verse to inspect its lemma, LXX parallels, and connections.'),
  );

  // Section 2: Embedded Compact Word Graph
  const wordGraph = createDiscoveryGraph(
    {
      preview,
      onFollowPassage: (p, edge) => {
        if (graphOpts?.onFollowPassage) {
          graphOpts.onFollowPassage(p, edge);
        } else {
          explorationState.recordPassage(p, formatVerseRef(p), edge);
          navigate(p);
        }
      },
      onComparePassage: (target) => {
        if (onComparePassage) onComparePassage(target);
        else preview.pin(target, 'Compare passage');
      },
      onCreateHypothesis: (from, to) => {
        if (graphOpts?.onCreateHypothesis) {
          graphOpts.onCreateHypothesis(from, to);
        } else if (onAddNote && currentData?.word) {
          onAddNote({ word: currentData.word, position: selection?.position });
        }
      },
    },
    {
      variant: 'compact',
      defaultOpen: true,
      onExpandFull: graphOpts?.onExpandFullGraph,
    },
  );
  const graphSection = el('section', 'inspector-section inspector-graph-section');
  graphSection.append(wordGraph.element);

  // Section 3: Compact Origin & Word Family
  const originSection = el('section', 'inspector-section inspector-origin-section');

  // Section 4: Most Revealing Occurrences
  const occurrences = el('section', 'inspector-section inspector-occurrences');

  // Section 5: Collapsed Disclosures
  const lexicalGraph = createLexicalRelationshipsSection({
    onInspectTarget: (targetWordId: number, lemmaId?: string) => {
      void inspect({ id: targetWordId, lemmaId }, true, true);
    },
    onEvaluateRelationship,
    preview,
    navigate,
  });

  const wordNotes = createWordNotes({
    onInspectWord: (targetWordId: number) => {
      void inspect({ id: targetWordId }, true, true);
    },
    onAddNote: onAddNote ? () => {
      if (currentData?.word) {
        onAddNote({ word: currentData.word, position: selection?.position });
      }
    } : undefined,
  });

  const deepLayersDetails = el('details', 'inspector-disclosure js-deep-layers');
  deepLayersDetails.append(el('summary', '', 'Grammatical, lexical & LXX layers'), lexicalGraph.element);

  const companionsDetails = el('details', 'inspector-disclosure js-companions');
  const companionsBody = el('div', 'inspector-disclosure-body');
  companionsDetails.append(el('summary', '', 'Often appears with'), companionsBody);

  const notesDetails = el('details', 'inspector-disclosure js-notes-disclosure');
  notesDetails.append(el('summary', '', 'Notes on this word'), wordNotes.element);

  const rgDossierDetails = el('details', 'inspector-disclosure js-rg-dossier');
  const rgDossierBody = el('div', 'inspector-disclosure-body');
  rgDossierDetails.append(el('summary', '', 'Research knowledge dossier'), rgDossierBody);

  const technicalDetails = el('details', 'inspector-disclosure js-technical-details');
  const technicalBody = el('div', 'inspector-disclosure-body');
  technicalDetails.append(el('summary', '', 'Technical details & sources'), technicalBody);

  const disclosuresSection = el('section', 'inspector-section inspector-disclosures');
  disclosuresSection.append(deepLayersDetails, companionsDetails, notesDetails, rgDossierDetails, technicalDetails);
  disclosuresSection.hidden = true;

  element.append(
    paneBar,
    summary,
    graphSection,
    originSection,
    occurrences,
    disclosuresSection,
  );
  element.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close();
  });

  deepLayersDetails.addEventListener('toggle', () => {
    if (!deepLayersDetails.open || !currentData?.word || !selection) return;
    if (deepLayersLoadedRequest === generation) return;
    deepLayersLoadedRequest = generation;
    const p = currentPassageForInspect ?? appState.getPassage();
    const singleExtendedStrongs =
      currentData.lexemes?.length === 1 ? currentData.lexemes[0].extended_strongs ?? undefined : undefined;
    void lexicalGraph.loadForWord(selection.id, currentData.word.strongs_nr, [], {
      book: p.book,
      chapter: p.chapter,
      verse: p.verse,
      position: selection.position,
      extendedStrongs: singleExtendedStrongs,
      preferredLemmaId: selection.lemmaId,
    });
  });

  companionsDetails.addEventListener('toggle', () => {
    if (!companionsDetails.open || !currentData?.word || !selection) return;
    if (companionsLoadedRequest === generation) return;
    companionsLoadedRequest = generation;
    void renderCompanionsDisclosure(selection.id, currentData.word.strongs_nr, generation);
  });

  rgDossierDetails.addEventListener('toggle', () => {
    if (!rgDossierDetails.open || !currentData?.word || !selection) return;
    if (rgDossierLoadedRequest === generation) return;
    rgDossierLoadedRequest = generation;
    void renderRgDossierDisclosure(currentData.word, generation);
  });

  // === @section:ui:summary ===
  function renderLemmaFactContent(
    lemmaRow: HTMLElement,
    word: WordRecord,
    lexemes: ResearchLexemeCandidate[],
    selected: Selection,
    matchedFallback?: MatchedLemmaRecord,
  ) {
    const label = el('span', 'inspector-fact-label', 'Lemma');
    const body = el('div', 'inspector-fact-body');

    const pickPrimaryLexeme = (): { top: ResearchLexemeCandidate | null; others: ResearchLexemeCandidate[] } => {
      if (!lexemes.length) return { top: null, others: [] };
      let topIdx = 0;
      if (selected.lemmaId) {
        const matchIdx = lexemes.findIndex(
          l => l.lexeme_key === selected.lemmaId || `lemma:${l.extended_strongs}` === selected.lemmaId,
        );
        if (matchIdx >= 0) topIdx = matchIdx;
      }
      return {
        top: lexemes[topIdx]!,
        others: lexemes.filter((_, idx) => idx !== topIdx),
      };
    };

    const { top, others } = pickPrimaryLexeme();
    const primaryLine = el('div', 'inspector-lemma-primary');

    const scriptText = top?.original_lemma || matchedFallback?.lemma_script || word.original_word;
    const isGreekLemma = top
      ? top.language === 'grc' || top.base_strongs.startsWith('G')
      : matchedFallback
        ? matchedFallback.language === 'grc' || matchedFallback.language === 'greek' || (matchedFallback.base_strongs?.startsWith('G') ?? false)
        : word.strongs_nr.startsWith('G');
    const langCode = top?.language === 'arc' ? 'arc' : isGreekLemma ? 'el' : 'he';

    const scriptEl = el('span', 'inspector-lemma-script', scriptText);
    scriptEl.dir = isGreekLemma ? 'ltr' : 'rtl';
    scriptEl.lang = langCode;
    primaryLine.append(scriptEl);

    const translitText = (top?.transliteration || matchedFallback?.transliteration || word.transliteration || '').trim();
    if (translitText) {
      primaryLine.append(el('span', 'inspector-fact-sep', ' · '), el('span', 'inspector-lemma-translit', translitText));
    }

    const glossText = cleanGloss(top?.primary_gloss ?? matchedFallback?.primary_gloss) || getPrimaryGloss(word, selected);
    if (glossText) {
      primaryLine.append(el('span', 'inspector-fact-sep', ' · '), el('span', 'inspector-lemma-gloss', glossText));
    }

    body.append(primaryLine);

    if (top?.homograph_note || lexemes.length > 1) {
      const senseBadgeRow = el('div', 'inspector-v3-pills');
      if (lexemes.length > 1) {
        senseBadgeRow.append(
          el('span', 'inspector-v3-badge', `${lexemes.length} STEP senses · polysemy preserved`),
        );
      }
      if (top?.homograph_note) {
        senseBadgeRow.append(el('span', 'inspector-v3-badge', top.homograph_note));
      }
      body.append(senseBadgeRow);
    }

    if (others.length > 0) {
      const chipsWrap = el('div', 'inspector-homograph-chips');
      for (const hom of others) {
        const homIsGreek = hom.language === 'grc' || hom.base_strongs.startsWith('G');
        const chip = action('', () => {
          void inspect({ ...selected, lemmaId: hom.lexeme_key }, false, true);
        }, 'inspector-homograph-chip');
        chip.title = hom.homograph_note ? `${hom.extended_strongs} — ${hom.homograph_note}` : hom.extended_strongs;

        const homScript = el('span', 'inspector-homograph-script', hom.original_lemma);
        homScript.dir = homIsGreek ? 'ltr' : 'rtl';
        homScript.lang = hom.language === 'arc' ? 'arc' : homIsGreek ? 'el' : 'he';
        chip.append(homScript);

        const homMeta = [hom.transliteration?.trim(), cleanGloss(hom.primary_gloss)].filter(Boolean).join(' · ');
        if (homMeta) {
          chip.append(el('span', 'inspector-homograph-meta', homMeta));
        }
        chipsWrap.append(chip);
      }
      body.append(chipsWrap);
    }

    lemmaRow.replaceChildren(label, body);
  }

  function buildLxxCandidateButton(
    item: R9BLxxTranslationItem,
    isGreekToHebrew: boolean,
    isSecondary: boolean,
  ): HTMLButtonElement | null {
    const candidates = isGreekToHebrew ? item.hebrew_candidates : item.greek_candidates;
    const fallbackKeys = isGreekToHebrew ? item.hebrew_lemma_keys : item.greek_lemma_keys;
    const fallbackStrong = isGreekToHebrew ? item.hebrew_strong : item.greek_strong;
    const cand = candidates?.[0];

    const scriptText =
      cand?.original_script?.trim()
      || fallbackStrong?.trim()
      || cand?.extended_strongs?.trim()
      || cand?.lemma_key?.replace(/^lemma:/i, '').trim()
      || fallbackKeys?.[0]?.replace(/^lemma:/i, '').trim()
      || '';
    if (!scriptText) return null;

    const targetIsHebrew = cand?.language ? cand.language !== 'grc' : isGreekToHebrew;
    const targetLemmaId = cand?.lemma_key ?? fallbackKeys?.[0] ?? undefined;
    const targetGloss = cleanGloss(cand?.primary_gloss);
    const translitText = cand?.transliteration?.trim() ?? '';
    const countShare = `${item.published_count}× · ${formatLxxShare(item.translation_share)}`;

    const btn = el(
      'button',
      isSecondary ? 'inspector-lxx-link inspector-lxx-alt' : 'inspector-lxx-link',
    );
    btn.type = 'button';

    const scriptEl = el('span', 'inspector-lxx-script', scriptText);
    scriptEl.dir = targetIsHebrew ? 'rtl' : 'ltr';
    scriptEl.lang = cand?.language === 'arc' ? 'arc' : targetIsHebrew ? 'he' : 'el';
    btn.append(scriptEl);

    const detailParts = isSecondary
      ? [targetGloss || translitText, countShare]
      : [translitText, targetGloss, countShare];
    const detailText = detailParts.filter(Boolean).join(' · ');
    if (detailText) {
      btn.append(el('span', 'inspector-lxx-meta', detailText));
    }

    btn.addEventListener('click', () => {
      const directWordId = cand?.word_id;
      if (typeof directWordId === 'number' && directWordId > 0) {
        void inspect({ id: directWordId, lemmaId: targetLemmaId, english: targetGloss || undefined }, true, true);
        return;
      }
      const queries = buildLxxResolveQueries(cand, fallbackStrong, targetLemmaId);
      if (!queries.length) return;
      const clickGeneration = generation;
      btn.disabled = true;
      void (async () => {
        try {
          let resolvedId: number | null = null;
          for (const q of queries) {
            resolvedId = await BibleRPC.resolveWordId(q);
            if (resolvedId) break;
            if (clickGeneration !== generation) return;
          }
          if (clickGeneration !== generation) return;
          if (resolvedId) {
            void inspect({ id: resolvedId, lemmaId: targetLemmaId, english: targetGloss || undefined }, true, true);
          }
        } finally {
          if (btn.isConnected) btn.disabled = false;
        }
      })();
    });

    return btn;
  }

  function renderLxxFactRow(lxxRow: HTMLElement, layer: R9BLxxLayerResult | null, strongs: string): void {
    if (!layer || !layer.available || !layer.items?.length) {
      lxxRow.remove();
      return;
    }

    const sortedItems = [...layer.items].sort(
      (a, b) => (b.published_count - a.published_count) || (b.translation_share - a.translation_share),
    );
    const isGreekToHebrew =
      layer.direction === 'greek_to_hebrew'
      || (layer.direction !== 'hebrew_to_greek' && strongs.startsWith('G'));

    const buttons: HTMLButtonElement[] = [];
    for (let idx = 0; idx < sortedItems.length && buttons.length < 3; idx += 1) {
      const btn = buildLxxCandidateButton(sortedItems[idx]!, isGreekToHebrew, buttons.length > 0);
      if (btn) buttons.push(btn);
    }

    if (!buttons.length) {
      lxxRow.remove();
      return;
    }

    lxxRow.classList.remove('is-loading');
    const body = el('div', 'inspector-fact-body inspector-lxx-links');
    body.append(...buttons);
    lxxRow.replaceChildren(el('span', 'inspector-fact-label', 'LXX'), body);
  }

  async function loadLxxSummary(
    request: number,
    cacheKey: string,
    word: WordRecord,
    data: ReaderWord,
    selected: Selection,
    passage: ActivePassage,
    lxxRow: HTMLElement,
  ): Promise<void> {
    const singleExtendedStrongs =
      data.lexemes?.length === 1 ? data.lexemes[0].extended_strongs ?? undefined : undefined;
    const res = await BibleRPC.relationships.lookupLxxTranslations({
      query: selected.lemmaId ? undefined : word.strongs_nr,
      lemma_id: selected.lemmaId,
      extended_strongs: selected.lemmaId ? undefined : singleExtendedStrongs,
      word_id: !selected.lemmaId && word.id > 0 ? word.id : undefined,
      book: !selected.lemmaId && selected.position != null ? passage.book : undefined,
      chapter: !selected.lemmaId && selected.position != null ? passage.chapter : undefined,
      verse: !selected.lemmaId && selected.position != null ? passage.verse : undefined,
      position: !selected.lemmaId ? selected.position : undefined,
      lxx_limit: 3,
    });
    if (request !== generation) return;

    if (res.source === 'unavailable' || res.data?.status === 'unavailable') {
      lxxRow.remove();
      return;
    }

    const layer = res.data?.layers?.lxx_translation ?? res.data?.lxx_translation ?? null;
    if (!layer || !layer.available || !layer.items?.length) {
      setCachedLxxLayer(cacheKey, null);
      lxxRow.remove();
      return;
    }

    setCachedLxxLayer(cacheKey, layer);
    renderLxxFactRow(lxxRow, layer, word.strongs_nr);
  }

  function renderLxxV3Content(
    body: HTMLElement,
    res: LxxConcordanceV3Result | null,
    passage: ActivePassage,
    word: WordRecord,
    request: number,
  ): void {
    body.replaceChildren();
    if (!res || res.status !== 'ok') {
      body.append(el('p', 'study-muted', res?.error || 'No Rahlfs 1935 LXX concordance entry indexed for this lemma.'));
      return;
    }

    if (res.profile) {
      const headRow = el('div', 'inspector-v3-pills');
      headRow.append(
        el('span', 'inspector-v3-badge', `STEP v3 headword: ${res.profile.sc} (${res.profile.bs})`),
      );
      if (res.profile.gl) {
        headRow.append(el('span', 'study-muted', `"${res.profile.gl}"`));
      }
      body.append(headRow);

      if (res.profile.lxx_equivalents?.length) {
        const eqWrap = el('div', 'inspector-lxx-links');
        for (const eq of res.profile.lxx_equivalents.slice(0, 6)) {
          const btn = action(
            `${eq.g_lemma} (${eq.count}×${eq.mean_stability != null ? ` · stab ${eq.mean_stability}` : ''})`,
            () => { void resolveAndInspect(eq.g_lemma); },
            'inspector-lxx-link inspector-lxx-alt',
          );
          eqWrap.append(btn);
        }
        body.append(el('p', 'eyebrow inspector-origin-heading', 'RAHLFS LXX EQUIVALENTS'), eqWrap);
      }

      if (res.profile.lxx_shifts?.length) {
        const shList = el('div', 'inspector-v3-pills');
        for (const sh of res.profile.lxx_shifts.slice(0, 6)) {
          const detail = sh.text ? `: "${String(sh.text).slice(0, 42)}"` : '';
          shList.append(
            el('span', 'inspector-v3-badge is-shift', `${sh.ref ? `${sh.ref} · ` : ''}${sh.type.replaceAll('_', ' ')}${detail}`),
          );
        }
        body.append(el('p', 'eyebrow inspector-origin-heading', 'LXX TRANSLATION SHIFTS'), shList);
      }
    }

    if (res.lemma && res.verses?.length) {
      const statsText = `Rahlfs lemma ${res.lemma}: ${res.total_occ ?? 0} occ across ${res.df ?? res.verses.length} verses${res.idf != null ? ` (idf ${res.idf.toFixed(2)})` : ''}`;
      body.append(el('p', 'study-muted', statsText));
      const vRow = el('div', 'inspector-v3-pills');
      for (const v of res.verses.slice(0, 8)) {
        const lbl = `${v.ref || `${v.b || ''} ${v.r || ''}`.trim()}${v.c ? ` (${v.c}×)` : ''}`;
        vRow.append(el('span', 'inspector-v3-badge', lbl));
      }
      body.append(vRow);
    }

    if (passage.book <= 39) {
      const verseShiftHost = el('div', 'inspector-v3-verse-shifts');
      const checkBtn = action(
        `Check MT↔LXX shifts in ${formatVerseRef(passage)}`,
        () => {
          checkBtn.disabled = true;
          checkBtn.textContent = 'Checking verse MT↔LXX…';
          void (async () => {
            const pRes = await lxxConcordanceV3Rpc({
              book: passage.book,
              chapter: passage.chapter,
              verse: passage.verse,
            });
            if (request !== generation) return;
            verseShiftHost.replaceChildren();
            const alns = pRes.data?.alignments || [];
            const shifts = alns.flatMap(a => a.shifts || []);
            if (shifts.length === 0) {
              verseShiftHost.append(el('p', 'study-muted', `No LxxTranslationShift flagged in ${formatVerseRef(passage)} (${alns.length} alignment(s)).`));
            } else {
              const pills = el('div', 'inspector-v3-pills');
              for (const sh of shifts.slice(0, 6)) {
                const detail = sh.text ? `: "${String(sh.text).slice(0, 44)}"` : sh.strongs?.length ? ` (${sh.strongs.join(', ')})` : '';
                pills.append(el('span', 'inspector-v3-badge is-shift', `${sh.type.replaceAll('_', ' ')}${detail}`));
              }
              verseShiftHost.append(pills);
            }
          })();
        },
        'text-action',
      );
      verseShiftHost.append(checkBtn);
      body.append(verseShiftHost);
    }

    if (res.license) {
      body.append(el('p', 'study-muted', `${res.license}${res.swete_included === false ? ' · Swete excluded' : ''}`));
    }
    void word;
  }

  function buildLxxV3Disclosure(
    request: number,
    word: WordRecord,
    data: ReaderWord,
    selected: Selection,
    passage: ActivePassage,
  ): HTMLElement {
    const isGreek = word.strongs_nr.startsWith('G');
    const topLex = data.lexemes?.find(l => l.lexeme_key === selected.lemmaId) ?? data.lexemes?.[0];
    const greekLemma = isGreek ? (topLex?.original_lemma || word.original_word) : undefined;
    const cacheKey = `${normStrongs4Local(word.strongs_nr) || word.strongs_nr}|${greekLemma || ''}`;

    const details = el('details', 'inspector-disclosure inspector-lxx-v3');
    details.append(el('summary', '', 'Rahlfs 1935 LXX concordance & translation shifts (v3)'));
    const body = el('div', 'inspector-disclosure-body');
    details.append(body);

    const cached = readBoundedCache(lxxV3Cache, cacheKey);
    if (cached !== undefined) {
      renderLxxV3Content(body, cached, passage, word, request);
    } else {
      body.append(status('Expand to load Rahlfs 1935 LXX equivalents & shifts…'));
      let loaded = false;
      details.addEventListener('toggle', () => {
        if (!details.open || loaded || request !== generation) return;
        loaded = true;
        body.replaceChildren(status('Loading Rahlfs 1935 LXX concordance & shifts…'));
        void (async () => {
          const res = await lxxConcordanceV3Rpc({
            strongs: word.strongs_nr,
            ...(greekLemma ? { lemma: greekLemma } : {}),
            limit: 8,
          });
          if (request !== generation) return;
          const val = res.data ?? null;
          if (val) writeBoundedCache(lxxV3Cache, cacheKey, val);
          renderLxxV3Content(body, val, passage, word, request);
        })();
      });
    }
    return details;
  }

  function renderSummary(
    word: WordRecord,
    data: ReaderWord,
    selected: Selection,
    passage: ActivePassage,
    request: number,
  ): HTMLElement {
    const topRow = el('div', 'inspector-top-row');
    topRow.append(el('p', 'eyebrow', selected.suggested ? 'SUGGESTED WORD' : 'SELECTED WORD'));
    if (selected.position != null) {
      topRow.append(el('span', 'inspector-position-indicator study-muted', `Word #${selected.position} · ${formatVerseRef(passage)}`));
    }

    const primaryGloss = getPrimaryGloss(word, selected);
    const englishTitle = el('h2', 'inspector-english-title', primaryGloss);

    const identityRow = el('div', 'inspector-identity-row');
    const isHebrew = word.strongs_nr.startsWith('H');
    const original = el('span', 'modal-original inspector-original-script', word.original_word);
    original.dir = isHebrew ? 'rtl' : 'ltr';
    original.lang = isHebrew ? 'he' : 'el';

    const translit = el('span', 'inspector-transliteration', word.transliteration);
    identityRow.append(original, translit);

    const grammarMap = selected.position ? overview?.grammar[selected.position] : null;
    const plainGrammar = decodePlainGrammar(grammarMap, word.grammar_code);
    if (plainGrammar) {
      identityRow.append(el('span', 'inspector-grammar-pill', plainGrammar));
    }

    const keyFacts = el('div', 'inspector-key-facts');
    const lemmaRow = el('div', 'inspector-fact-row inspector-lemma-row');
    renderLemmaFactContent(lemmaRow, word, data.lexemes, selected);
    keyFacts.append(lemmaRow);

    const singleExtended = data.lexemes?.length === 1 ? data.lexemes[0].extended_strongs : undefined;
    const lxxCacheKey = normalizeLxxCacheKey(word.strongs_nr, selected.lemmaId, singleExtended);
    const cachedLxx = getCachedLxxLayer(lxxCacheKey);
    const lxxRow = el('div', 'inspector-fact-row inspector-lxx-row');
    if (cachedLxx !== undefined) {
      if (cachedLxx && cachedLxx.available && cachedLxx.items?.length) {
        keyFacts.append(lxxRow);
        renderLxxFactRow(lxxRow, cachedLxx, word.strongs_nr);
      }
    } else {
      lxxRow.classList.add('is-loading');
      lxxRow.append(
        el('span', 'inspector-fact-label', 'LXX'),
        el('span', 'inspector-lxx-loading study-muted', 'LXX · loading…'),
      );
      keyFacts.append(lxxRow);
      void loadLxxSummary(request, lxxCacheKey, word, data, selected, passage, lxxRow);
    }

    const definition = el('p', 'inspector-definition', word.biblical_def || 'A sourced definition is not available for this word.');

    const spotlightHost = el('div', 'inspector-spotlight-mount');
    activeSpotlightHost = spotlightHost;
    renderVisualSpotlight(spotlightHost, word, selected, passage);

    const nodes: HTMLElement[] = [
      topRow,
      englishTitle,
      identityRow,
      keyFacts,
      buildLxxV3Disclosure(request, word, data, selected, passage),
      spotlightHost,
    ];

    if (graphOpts?.onOpenContextTool) {
      const entityChips: ContextToolChip[] = detectContextTools({
        passage,
        strongsList: [word.strongs_nr],
        verseTokens,
        geographyPacket: null,
      });
      if (selected.position != null) {
        for (const anchor of overview?.place_anchors.filter(a => a.word_position === selected.position) ?? []) {
          if (!entityChips.some(c => c.kind === 'place' && c.id === anchor.place_key)) {
            entityChips.unshift({
              kind: 'place',
              id: anchor.place_key,
              label: anchor.name,
              badge: 'Place & Map',
              strongs: word.strongs_nr,
            });
          }
        }
      }
      if (entityChips.length > 0) {
        const chipsRow = el('div', 'inspector-context-chips');
        chipsRow.append(el('span', 'inspector-fact-label', 'Context'));
        const chipList = el('div', 'inspector-context-chips__list');
        for (const chip of entityChips.slice(0, 4)) {
          const btn = action(chip.badge ? `${chip.label} (${chip.badge})` : chip.label, () => {
            graphOpts.onOpenContextTool?.(chip.kind, chip.id, chip.planId);
          }, `context-chip-btn context-chip-btn--${chip.kind}`);
          chipList.append(btn);
        }
        chipsRow.append(chipList);
        nodes.push(chipsRow);
      }
    }

    nodes.push(definition);

    if (data.lexemes.length > 1) {
      const meanings = el('div', 'lexeme-possibilities');
      meanings.append(
        el('strong', '', 'Unified Word · Meanings in Different Verses'),
        status('These lexical identities share a word form. Their meanings remain distinct and are never merged; passage context does not assign an unattested sense.'),
      );
      for (const lexeme of data.lexemes) {
        const row = el('div', 'homograph-meaning-row');
        row.append(el('p', '', `${lexeme.extended_strongs} — ${lexeme.primary_gloss}`));
        if (lexeme.homograph_note) {
          row.append(el('p', 'study-muted', `📖 Meaning in verses: ${lexeme.homograph_note}`));
        }
        meanings.append(row);
      }
      nodes.push(meanings);
    } else if (data.lexemes.length === 1 && data.lexemes[0].homograph_note) {
      const single = el('div', 'lexeme-possibilities');
      single.append(
        el('strong', '', 'Meaning in Verses'),
        el('p', 'study-muted', `📖 ${data.lexemes[0].homograph_note}`),
      );
      nodes.push(single);
    }

    const quickActions = el('div', 'inspector-quick-actions');
    if (onComparePassage) {
      quickActions.append(action('Compare verse', () => {
        onComparePassage(passage);
      }, 'study-button inspector-action-btn'));
    }
    if (onAddNote) {
      quickActions.append(action('+ Note', () => {
        onAddNote({ word, position: selected.position });
      }, 'study-button inspector-action-btn'));
    }
    if (onDiscoverConnectionsForWord) {
      quickActions.append(action('Deep explore →', () => {
        const singleLexeme = data.lexemes?.length === 1 ? data.lexemes[0].extended_strongs : undefined;
        const origin: WordDiscoveryOrigin = {
          word_id: selected.id,
          book: passage.book,
          chapter: passage.chapter,
          verse: passage.verse,
          position: selected.position,
          lemma_id: selected.lemmaId ?? (singleLexeme ? `lemma:${singleLexeme}` : undefined),
          strongs_nr: word.strongs_nr,
          original_word: word.original_word,
          transliteration: word.transliteration,
          english: selected.english,
        };
        element.dataset.open = 'false';
        onDiscoverConnectionsForWord(word.strongs_nr, origin);
      }, 'study-button inspector-action-btn'));
    }
    if (quickActions.childElementCount > 0) {
      nodes.push(quickActions);
    }

    summary.replaceChildren(...nodes);
    return lemmaRow;
  }

  function openSpotlightLightbox(asset: CuratedMediaAsset) {
    const dlg = document.createElement('dialog');
    dlg.className = 'media-lightbox-dialog';
    dlg.setAttribute('closedby', 'any');
    dlg.setAttribute('aria-label', asset.title);
    const header = el('div', 'context-tool-header');
    const bar = el('div', 'context-tool-header-top');
    const titleWrap = el('div', '');
    titleWrap.append(
      el('p', 'eyebrow', `${asset.depictionType.toUpperCase()} · ${asset.depictsPeriod}`),
      el('h2', 'context-tool-title', asset.title),
    );
    const closeBtn = action('✕', () => dlg.close(), 'context-tool-close-btn');
    closeBtn.setAttribute('aria-label', 'Close image viewer');
    bar.append(titleWrap, closeBtn);
    header.append(bar);

    const body = el('div', 'media-lightbox-body');
    const fig = renderMediaFigure(asset, { compact: false });
    body.append(fig);
    if (asset.historicalNote) body.append(el('p', 'media-lightbox-note', asset.historicalNote));
    dlg.append(header, body);

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let downOutside = false;
      dlg.addEventListener('pointerdown', ev => {
        const r = dlg.getBoundingClientRect();
        downOutside = ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
      });
      dlg.addEventListener('pointerup', ev => {
        const r = dlg.getBoundingClientRect();
        const upOutside = ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
        if (downOutside && upOutside) dlg.close();
      });
    }
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  function renderVisualSpotlight(
    host: HTMLElement,
    word: WordRecord,
    selected: Selection,
    passage: ActivePassage,
  ): void {
    const englishText = selected.english || word.english_translations?.[0] || '';
    const placeMatch = resolvePlaceForWord({
      strongs: word.strongs_nr,
      english: englishText,
      original: word.original_word,
      placeAnchors: overview?.place_anchors,
      position: selected.position,
      geographyPacket: currentGeographyPacket,
    });
    const archMatch: ArchitectureDetection | null = detectArchitectureForWord({
      strongs: word.strongs_nr,
      english: englishText,
      original: word.original_word,
      passage,
      verseTokens,
      position: selected.position,
    });
    const tribeMatch: BiblicalTribeEntry | null = detectTribeForWord({
      strongs: word.strongs_nr,
      english: englishText,
      original: word.original_word,
    });
    const personMatch = resolvePersonForWordInVerse({
      passage,
      strongs: word.strongs_nr,
      english: englishText,
      original: word.original_word,
    });

    if (!placeMatch && !archMatch && !tribeMatch && !personMatch) {
      host.replaceChildren();
      host.hidden = true;
      return;
    }

    host.hidden = false;
    const card = el('section', 'inspector-visual-spotlight');
    card.setAttribute('aria-label', 'Biblical place, nation, genealogy, and blueprint context');

    const header = el('div', 'inspector-spotlight-header');
    const titleWrap = el('div', 'inspector-spotlight-title');
    const actionsWrap = el('div', 'inspector-spotlight-actions');

    const isJerusalemWithBoth = Boolean(placeMatch?.isJerusalem && archMatch);
    type SpotlightTab = 'place' | 'blueprint' | 'tribe' | 'person';
    const availableTabs: { id: SpotlightTab; label: string }[] = [];
    if (archMatch && !placeMatch?.isJerusalem) availableTabs.push({ id: 'blueprint', label: '2D Blueprint' });
    if (personMatch?.matchedByVerse && !placeMatch?.isIsrael && !placeMatch?.isJerusalem) {
      availableTabs.push({ id: 'person', label: 'Genealogy' });
    }
    if (placeMatch) {
      availableTabs.push({
        id: 'place',
        label: placeMatch.isIsrael ? 'Map of Israel' : 'Map & Photo',
      });
    }
    if (isJerusalemWithBoth) availableTabs.push({ id: 'blueprint', label: 'Jerusalem & Gates' });
    if (tribeMatch) availableTabs.push({ id: 'tribe', label: 'Tribe Origin' });
    if (personMatch && (!personMatch.matchedByVerse || placeMatch?.isIsrael || placeMatch?.isJerusalem)) {
      availableTabs.push({
        id: 'person',
        label: placeMatch?.isIsrael ? 'Jacob / Israel Line' : 'Genealogy',
      });
    }

    let activeTab: SpotlightTab = availableTabs[0]?.id ?? 'place';

    const titleEl = el('strong', '', '');
    const subtitleEl = el('span', 'study-muted inspector-spotlight-sub', '');
    titleWrap.append(titleEl, subtitleEl);

    const tabGroup = el('div', 'inspector-spotlight-tabs');
    const body = el('div', 'inspector-spotlight-body');

    const appendPersonGroup = (
      groupsWrap: HTMLElement,
      label: string,
      entries: Array<{ person: BiblicalPerson; badge?: string }>,
    ) => {
      if (!entries.length) return;
      const group = el('div', 'inspector-rel-group');
      group.append(el('span', 'inspector-rel-group__label', label));
      const list = el('div', 'inspector-rel-group__chips');
      for (const entry of entries.slice(0, 8)) {
        const display = entry.person.disambiguator
          ? `${entry.person.name} (${entry.person.disambiguator})`
          : entry.person.name;
        const text = entry.badge ? `${display} · ${entry.badge}` : display;
        list.append(action(text, () => {
          graphOpts?.onOpenContextTool?.('person', entry.person.id);
        }, 'inspector-rel-chip'));
      }
      if (entries.length > 8) {
        list.append(el('span', 'study-muted', `+${entries.length - 8} more`));
      }
      group.append(list);
      groupsWrap.append(group);
    };

    const renderBody = () => {
      header.querySelector('.inspector-spotlight-expand-btn')?.remove();

      if (activeTab === 'blueprint' && archMatch) {
        titleEl.textContent = `${archMatch.element.name} · 2D Plan`;
        subtitleEl.textContent = archMatch.element.dimensions
          ? `${archMatch.element.zone} · ${archMatch.element.dimensions}`
          : archMatch.element.zone;
        actionsWrap.append(action('Full Plan ⤢', () => {
          graphOpts?.onOpenContextTool?.('architecture', archMatch.element.id, archMatch.planId);
        }, 'inspector-spotlight-expand-btn'));

        const wrap = el('div', 'arch-svg-wrap arch-svg-wrap--compact');
        const svg = renderArchitectureSvg(archMatch.planId, archMatch.element.id, {
          compact: true,
          showTerrain: true,
          onSelectElement: clicked => {
            graphOpts?.onOpenContextTool?.('architecture', clicked.id, clicked.planId);
          },
        });
        wrap.append(svg);
        const note = el('p', 'inspector-spotlight-caption', archMatch.element.summary);
        if (archMatch.element.historicalNote) {
          body.replaceChildren(wrap, note, el('p', 'inspector-spotlight-note study-muted', archMatch.element.historicalNote));
        } else {
          body.replaceChildren(wrap, note);
        }
        return;
      }

      if (activeTab === 'tribe' && tribeMatch) {
        titleEl.textContent = `${tribeMatch.name} · Table of Nations`;
        subtitleEl.textContent = `${tribeMatch.branch} branch · ${tribeMatch.biblicalRegion}`;
        actionsWrap.append(action('Global Nations Map ⤢', () => {
          graphOpts?.onOpenContextTool?.('nations', tribeMatch.id);
        }, 'inspector-spotlight-expand-btn'));

        const wrap = el('div', 'inspector-tribe-spotlight');
        const chain = el('div', 'inspector-lineage-chain');
        tribeMatch.ancestralChain.forEach((ancestor, idx) => {
          if (idx > 0) chain.append(el('span', 'nations-chain-arrow', '→'));
          chain.append(el('span', `nations-chain-node${idx === tribeMatch.ancestralChain.length - 1 ? ' is-current' : ''}`, ancestor));
        });
        wrap.append(chain);

        miniMap ??= createMiniPlaceMap();
        wrap.append(miniMap.element);
        void miniMap.setLocation({
          name: `${tribeMatch.name} (${tribeMatch.biblicalRegion})`,
          lat: tribeMatch.settlementCoords[1],
          lon: tribeMatch.settlementCoords[0],
          uncertain: tribeMatch.confidence !== 'established',
        }).then(() => {
          requestAnimationFrame(() => miniMap?.resize());
        });

        wrap.append(
          el('p', 'inspector-spotlight-caption', tribeMatch.summary),
          el('p', 'inspector-spotlight-note study-muted', `Modern correspondence: ${tribeMatch.modernAreaNote}`),
        );
        if (tribeMatch.lineagePersonId) {
          wrap.append(action('Inspect ancestor in Genealogy ↗', () => {
            graphOpts?.onOpenContextTool?.('person', tribeMatch.lineagePersonId!);
          }, 'text-action'));
        }
        body.replaceChildren(wrap);
        return;
      }

      if (activeTab === 'person' && personMatch) {
        const p = personMatch.person;
        titleEl.textContent = p.disambiguator ? `${p.name} · ${p.disambiguator}` : p.name;
        subtitleEl.textContent = [
          p.era,
          personMatch.matchedByVerse ? `Attested in ${formatVerseRef(passage)}` : null,
        ].filter(Boolean).join(' · ') || 'Biblical person';
        actionsWrap.append(action('Zoomable Tree ⤢', () => {
          graphOpts?.onOpenContextTool?.('person', p.id);
        }, 'inspector-spotlight-expand-btn'));

        const wrap = el('div', 'inspector-person-spotlight');
        if (personMatch.matchedByVerse && personMatch.homonyms.length > 0) {
          wrap.append(el(
            'p',
            'inspector-disambig-note',
            `Verse-disambiguated for ${formatVerseRef(passage)} (${personMatch.homonyms.length + 1} biblical figures share the name "${p.name}").`,
          ));
        } else if (personMatch.homonyms.length > 0) {
          wrap.append(el(
            'p',
            'inspector-disambig-note',
            `${personMatch.homonyms.length + 1} figures share the name "${p.name}". Open Zoomable Tree to switch.`,
          ));
        }

        const hood = buildBoundedFamilyNeighborhood(p.id, 1);
        if (hood) {
          const groups = el('div', 'inspector-rel-groups');
          appendPersonGroup(groups, 'Parents', hood.parents.map(x => ({ person: x.person, badge: x.edge.type })));
          appendPersonGroup(groups, 'Spouse(s)', hood.spouses.map(x => ({ person: x.person })));
          appendPersonGroup(groups, 'Siblings', hood.siblings.map(x => ({ person: x.person })));
          appendPersonGroup(groups, 'Children', hood.children.map(x => ({ person: x.person })));
          appendPersonGroup(groups, 'Other Links', hood.socialLinks.map(x => ({ person: x.person, badge: x.roleText })));
          if (groups.childElementCount > 0) {
            wrap.append(groups);
          } else {
            wrap.append(el('p', 'study-muted', p.summary));
          }
        } else {
          wrap.append(el('p', 'study-muted', p.summary));
        }

        if (p.competingGenealogyNote) {
          wrap.append(el('p', 'inspector-spotlight-note study-muted', p.competingGenealogyNote));
        }
        body.replaceChildren(wrap);
        return;
      }

      if (placeMatch) {
        const displayName = placeMatch.ancientName && placeMatch.ancientName !== placeMatch.name
          ? (placeMatch.ancientName.toLowerCase().includes(placeMatch.name.toLowerCase())
            ? placeMatch.ancientName
            : `${placeMatch.ancientName} (${placeMatch.name})`)
          : placeMatch.name;
        titleEl.textContent = displayName;
        const coordLine = placeMatch.lat != null && placeMatch.lon != null
          ? `${placeMatch.lat.toFixed(3)}°N, ${placeMatch.lon.toFixed(3)}°E`
          : placeMatch.featureType ?? 'Biblical region';
        subtitleEl.textContent = [placeMatch.modernName, coordLine, placeMatch.confidence].filter(Boolean).join(' · ');

        actionsWrap.append(action('Full Map ⤢', () => {
          graphOpts?.onOpenContextTool?.('place', placeMatch.placeKey);
        }, 'inspector-spotlight-expand-btn'));

        const hasCoords = placeMatch.lat != null && placeMatch.lon != null;
        const primaryPhoto = placeMatch.media[0];
        const grid = el('div', hasCoords && primaryPhoto ? 'inspector-spotlight-grid' : 'inspector-spotlight-single');

        if (hasCoords) {
          miniMap ??= createMiniPlaceMap();
          grid.append(miniMap.element);
          void miniMap.setLocation({
            name: placeMatch.name,
            lat: placeMatch.lat!,
            lon: placeMatch.lon!,
            uncertain: /disputed|regional|approximate/i.test(placeMatch.confidence),
          }).then(() => {
            requestAnimationFrame(() => miniMap?.resize());
          });
        }
        if (primaryPhoto) {
          grid.append(renderMediaFigure(primaryPhoto, { compact: true, onOpenLightbox: openSpotlightLightbox }));
        }
        const metaLine = placeMatch.aliases.length
          ? el('p', 'inspector-spotlight-caption study-muted', `Also named: ${placeMatch.aliases.slice(0, 4).join(', ')}`)
          : null;
        body.replaceChildren(grid);
        if (metaLine) body.append(metaLine);
      }
    };

    if (availableTabs.length > 1) {
      for (const tabCfg of availableTabs) {
        const tabBtn = action(tabCfg.label, () => {
          activeTab = tabCfg.id;
          tabGroup.querySelectorAll('.inspector-spotlight-tab').forEach(btn => {
            btn.classList.toggle('is-active', btn === tabBtn);
          });
          renderBody();
        }, `inspector-spotlight-tab${tabCfg.id === activeTab ? ' is-active' : ''}`);
        tabGroup.append(tabBtn);
      }
    }

    header.append(titleWrap, actionsWrap);
    card.append(header);
    if (tabGroup.childElementCount > 0) card.append(tabGroup);
    card.append(body);
    host.replaceChildren(card);
    renderBody();
  }

  // === @section:ui:origin ===
  async function resolveAndInspect(query: string, english?: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    const resolved = await BibleRPC.resolveWordId(trimmed);
    if (resolved) {
      void inspect({ id: resolved, english: english || undefined }, true, true);
    }
  }

  function makeOriginPill(
    script: string,
    translit: string | null | undefined,
    gloss: string | null | undefined,
    meta: string | null | undefined,
    isGreek: boolean,
    onClick: () => void,
  ): HTMLElement {
    const pill = action('', onClick, 'inspector-origin-pill');
    const scriptEl = el('span', 'inspector-origin-script', script);
    scriptEl.dir = isGreek ? 'ltr' : 'rtl';
    scriptEl.lang = isGreek ? 'el' : 'he';
    pill.append(scriptEl);

    const cleanTranslit = translit ? translit.replaceAll('.', '').trim() : '';
    const details = [cleanTranslit, gloss?.trim(), meta?.trim()].filter(Boolean).join(' · ');
    if (details) {
      pill.append(el('span', 'inspector-origin-pill-meta', details));
    }
    return pill;
  }

  function renderOriginSection(
    formationData: WordFormationResponse | null,
    candidates: OrthographicCandidateRecord[],
    strongs: string,
  ) {
    const defaultIsGreek = strongs.startsWith('G');
    const nodes: HTMLElement[] = [el('h3', 'inspector-section-title', 'Origin & word family')];

    const formations = formationData?.status === 'ok' ? (formationData.lexical_formations ?? []) : [];
    const roots = formationData?.status === 'ok' ? (formationData.documented_roots ?? []) : [];
    const relatives = formationData?.status === 'ok' ? (formationData.root_relatives ?? []) : [];
    const wordplay = formationData?.status === 'ok'
      ? (formationData.other_connections ?? []).filter(c => c.relation_type === 'literary_wordplay')
      : [];

    if (formations.length > 0) {
      const group = el('div', 'inspector-origin-group');
      group.append(el('p', 'eyebrow inspector-origin-heading', 'FORMATION'));
      const pills = el('div', 'inspector-origin-pills');
      for (const f of formations) {
        for (const comp of f.components) {
          const spelling = comp.original_lemma || comp.surface_text;
          const gloss = comp.semantic_contribution || comp.primary_gloss || comp.senses[0]?.short_gloss || '';
          const role = comp.role.replaceAll('_', ' ');
          const compIsGreek = comp.base_strongs ? comp.base_strongs.startsWith('G') : defaultIsGreek;
          const q = comp.base_strongs || comp.original_lemma || comp.surface_text;
          pills.append(makeOriginPill(spelling, comp.transliteration, gloss, role, compIsGreek, () => {
            void resolveAndInspect(q, gloss);
          }));
        }
      }
      if (pills.childElementCount > 0) group.append(pills);
      for (const f of formations) {
        if (f.whole_word_gloss) {
          const src = f.source?.title ? ` · ${f.source.title}` : '';
          group.append(el('p', 'study-muted', `Whole-word meaning: ${f.whole_word_gloss} (${f.evidence_status}${src})`));
        }
      }
      nodes.push(group);
    }

    if (roots.length > 0 || relatives.length > 0) {
      const group = el('div', 'inspector-origin-group');
      group.append(el('p', 'eyebrow inspector-origin-heading', 'ROOT FAMILY'));
      for (const r of roots) {
        const rootRow = el('div', 'inspector-root-header');
        const rootScript = el('span', 'root-script', r.root_script);
        rootScript.dir = defaultIsGreek ? 'ltr' : 'rtl';
        rootScript.lang = defaultIsGreek ? 'el' : 'he';
        rootRow.append(rootScript);
        if (r.root_transliteration) {
          rootRow.append(el('span', 'root-translit', r.root_transliteration));
        }
        rootRow.append(el('span', 'study-muted', `(${r.relation_type.replaceAll('_', ' ')})`));
        group.append(rootRow);
      }
      if (relatives.length > 0) {
        const pills = el('div', 'inspector-origin-pills');
        for (const rel of relatives.slice(0, 5)) {
          const gloss = rel.primary_gloss ?? '';
          const relIsGreek = rel.base_strongs ? rel.base_strongs.startsWith('G') : defaultIsGreek;
          const q = rel.base_strongs || rel.relative_lemma_key;
          pills.append(makeOriginPill(rel.lemma_script, rel.transliteration, gloss, null, relIsGreek, () => {
            void resolveAndInspect(q, gloss);
          }));
        }
        group.append(pills);
      }
      nodes.push(group);
    }

    if (wordplay.length > 0) {
      const group = el('div', 'inspector-origin-group');
      group.append(el('p', 'eyebrow inspector-origin-heading', 'LITERARY WORDPLAY'));
      for (const wp of wordplay) {
        const item = el('div', 'inspector-wordplay-item');
        if (wp.passage_reference) {
          item.append(el('p', 'wordplay-ref', wp.passage_reference));
        }
        item.append(el('p', 'wordplay-note', wp.evidence_note));
        const targetQuery = wp.target_strongs || wp.target_lemma_key;
        item.append(action(`Inspect ${targetQuery} →`, () => {
          void resolveAndInspect(targetQuery);
        }, 'text-action'));
        group.append(item);
      }
      nodes.push(group);
    }

    if (formations.length === 0 && roots.length === 0 && relatives.length === 0 && wordplay.length === 0) {
      nodes.push(el('p', 'study-muted', 'No documented root or compound derivation indexed for this word.'));
    }

    if (candidates.length > 0) {
      const candDisclosure = el('details', 'inspector-disclosure');
      candDisclosure.append(el('summary', '', `Similar spelling candidates (${candidates.length}) · unverified`));
      const candBody = el('div', 'inspector-disclosure-body');
      candBody.append(el('p', 'candidate-warning-note',
        'Unverified candidates: consonantal or spelling similarity does not establish etymology, shared root, or shared meaning.'));
      const pills = el('div', 'inspector-origin-pills');
      for (const cand of candidates) {
        const candIsGreek = cand.candidate_strongs ? cand.candidate_strongs.startsWith('G') : defaultIsGreek;
        const q = cand.candidate_strongs || cand.candidate_lemma_key;
        const meta = `${cand.overlap_chars}-char overlap`;
        pills.append(makeOriginPill(
          cand.candidate_script,
          cand.candidate_transliteration,
          cand.candidate_gloss,
          meta,
          candIsGreek,
          () => { void resolveAndInspect(q, cand.candidate_gloss ?? undefined); },
        ));
      }
      candBody.append(pills);
      candDisclosure.append(candBody);
      nodes.push(candDisclosure);
    }

    const activeP = currentPassageForInspect ?? appState.getPassage();
    const wpCacheKey = `${activeP.book}:${activeP.chapter}:${activeP.verse}`;
    const wpDisclosure = el('details', 'inspector-disclosure inspector-wordplay-v3');
    wpDisclosure.append(el('summary', '', `Verse wordplay & talion scan · ${formatVerseRef(activeP)} (v3)`));
    const wpBody = el('div', 'inspector-disclosure-body');
    wpDisclosure.append(wpBody);

    const renderWpData = (d: WordplayScanV3Result | null) => {
      wpBody.replaceChildren();
      if (!d || d.status !== 'ok') {
        wpBody.append(el('p', 'study-muted', d?.error || 'Wordplay & talion scan unavailable for this verse.'));
        return;
      }
      const targetNorm = normStrongs4Local(strongs);
      const talion = d.syntactic_talion || [];
      const onom = d.onomastic_valence || [];
      const cons = d.consonantal_candidates || [];
      if (talion.length === 0 && onom.length === 0 && cons.length === 0) {
        wpBody.append(el('p', 'study-muted', 'No syntactic talion, onomastic valence, or consonantal wordplay hits detected in this verse.'));
      } else {
        for (const t of talion.slice(0, 5)) {
          const touches = normStrongs4Local(t.strongsA) === targetNorm || normStrongs4Local(t.strongsB) === targetNorm;
          wpBody.append(
            el('p', touches ? 'wordplay-note' : 'study-muted',
              `${touches ? '★ ' : ''}[Talion · ${t.kind}] ${t.formA} (${t.strongsA}) ↔ ${t.formB} (${t.strongsB})${t.shift ? ` — ${t.shift}` : ''} (${t.score.toFixed(2)})`)
          );
        }
        for (const o of onom.slice(0, 5)) {
          const touches = normStrongs4Local(o.proper_strongs) === targetNorm || normStrongs4Local(o.target_strongs) === targetNorm;
          wpBody.append(
            el('p', touches ? 'wordplay-note' : 'study-muted',
              `${touches ? '★ ' : ''}[Onomastic · ${o.channel}] ${o.proper_form} (${o.proper_strongs}) ↔ ${o.target_form} (${o.target_strongs}) (${o.score.toFixed(2)})`)
          );
        }
        for (const c of cons.slice(0, 6)) {
          const touches = normStrongs4Local(c.strongsA) === targetNorm || normStrongs4Local(c.strongsB) === targetNorm;
          wpBody.append(
            el('p', touches ? 'wordplay-note' : 'study-muted',
              `${touches ? '★ ' : ''}[${c.overlap_kind.replaceAll('_', ' ')}] ${c.formA} (${c.strongsA}) ↔ ${c.formB} (${c.strongsB}) · [${c.shared_consonants}] (${c.formal_score.toFixed(2)})`)
          );
        }
      }
      if (d.disclaimer) wpBody.append(el('p', 'candidate-warning-note', d.disclaimer));
    };

    const cachedWp = readBoundedCache(wordplayV3Cache, wpCacheKey);
    if (cachedWp !== undefined) {
      renderWpData(cachedWp);
    } else {
      wpBody.append(status('Expand to scan syntactic talion, onomastic valence & consonantal wordplay…'));
      const reqSnapshot = generation;
      let wpLoaded = false;
      wpDisclosure.addEventListener('toggle', () => {
        if (!wpDisclosure.open || wpLoaded || reqSnapshot !== generation) return;
        wpLoaded = true;
        wpBody.replaceChildren(status('Scanning verse wordplay & talion…'));
        void (async () => {
          const res = await wordplayScanV3Rpc({
            book: activeP.book,
            chapter: activeP.chapter,
            verse: activeP.verse,
          });
          if (reqSnapshot !== generation) return;
          const val = res.data ?? null;
          if (val) writeBoundedCache(wordplayV3Cache, wpCacheKey, val);
          renderWpData(val);
        })();
      });
    }
    nodes.push(wpDisclosure);

    originSection.replaceChildren(...nodes);
  }

  // === @section:ui:occurrences ===
  function buildOccurrenceRow(ranked: RankedOccurrence): HTMLElement {
    const { item, whyTag } = ranked;
    const row = el('div', 'evidence-row');
    const gloss = cleanGloss(item.source_english);
    const reason = `Same base Strong’s group. STEP rendering in this passage: ${gloss}. ${item.occurrence_count} matching token(s).`;
    const reference = action(formatVerseRef(item), () => preview.pin(item, reason), 'reference-link');
    preview.attach(reference, item, reason);

    const rowActions = el('span', 'occ-row-actions');
    rowActions.append(
      action('Compare', () => {
        if (onComparePassage) onComparePassage(item);
        else preview.pin(item, reason);
      }, 'text-action occ-compare-btn'),
      action('Read →', () => navigate(item), 'text-action'),
    );

    const glossEl = el('span', 'evidence-gloss', gloss);
    const whyEl = el('span', 'occ-why-tag study-muted', whyTag);

    row.append(reference, rowActions, glossEl, whyEl);
    return row;
  }

  function renderOccurrencesView() {
    if (!latestOccurrenceMeta) return;
    const meta = latestOccurrenceMeta;

    shownBooks.clear();
    shownRenderings.clear();
    shownVerses.clear();
    if (occurrenceMode === 'revealing' && selection?.position != null) {
      const p = currentPassageForInspect ?? appState.getPassage();
      shownBooks.add(p.book);
      const selGloss = cleanGloss(selection.english).toLowerCase();
      if (selGloss) shownRenderings.add(selGloss);
    }

    const header = el('div', 'inspector-occ-header');
    const titleText = selection?.rendering ? `Rendered “${selection.rendering}”` : 'Most revealing occurrences';
    header.append(el('h3', 'inspector-section-title', titleText));
    header.append(el(
      'p',
      'inspector-occ-count study-muted',
      `${meta.token_total.toLocaleString()} tokens · ${meta.verse_total.toLocaleString()} verses`,
    ));

    const modeBar = el('div', 'occ-mode-bar segmented-control');
    modeBar.setAttribute('role', 'group');
    modeBar.setAttribute('aria-label', 'Occurrence ordering');

    const revealingBtn = action('Revealing', () => {
      if (occurrenceMode === 'revealing') return;
      occurrenceMode = 'revealing';
      visibleOccurrenceLimit = INITIAL_OCCURRENCE_COUNT;
      renderOccurrencesView();
    }, occurrenceMode === 'revealing' ? 'seg-btn is-active' : 'seg-btn');
    revealingBtn.setAttribute('aria-pressed', String(occurrenceMode === 'revealing'));

    const canonicalBtn = action('Canonical', () => {
      if (occurrenceMode === 'canonical') return;
      occurrenceMode = 'canonical';
      visibleOccurrenceLimit = INITIAL_OCCURRENCE_COUNT;
      renderOccurrencesView();
    }, occurrenceMode === 'canonical' ? 'seg-btn is-active' : 'seg-btn');
    canonicalBtn.setAttribute('aria-pressed', String(occurrenceMode === 'canonical'));

    modeBar.append(revealingBtn, canonicalBtn);

    const nodes: HTMLElement[] = [header];
    if (selection?.rendering) {
      nodes.push(action('Show all renderings', () => {
        if (selection) void inspect({ ...selection, rendering: undefined }, false);
      }, 'text-action'));
    }
    nodes.push(modeBar);

    const ranked = rerankOccurrences(loadedOccurrences, occurrenceMode, shownBooks, shownRenderings, shownVerses);
    const visibleRanked = ranked.slice(0, visibleOccurrenceLimit);
    const remaining = Math.max(0, ranked.length - visibleRanked.length);

    if (visibleRanked.length > 0) {
      const list = el('div', 'occurrence-evidence');
      for (const entry of visibleRanked) {
        list.append(buildOccurrenceRow(entry));
      }
      nodes.push(list);
    } else {
      nodes.push(status('No occurrence evidence was returned for this rendering.'));
    }

    if (remaining > 0) {
      nodes.push(action(`Show more (${remaining})`, () => {
        visibleOccurrenceLimit = ranked.length;
        renderOccurrencesView();
      }, 'study-button inspector-occ-show-more'));
    }

    if (meta.next_cursor !== null) {
      nodes.push(action('Load more occurrences', () => { void loadMore(); }, 'study-button load-more'));
    }

    occurrences.replaceChildren(...nodes);
    void BibleRPC.preloadReaderPassages(visibleRanked.slice(0, 5).map(r => r.item));
  }

  function renderOccurrences(data: ReaderWord, append = false) {
    if (!append) {
      loadedOccurrences = [...data.occurrences];
      visibleOccurrenceLimit = INITIAL_OCCURRENCE_COUNT;
    } else {
      loadedOccurrences = [...loadedOccurrences, ...data.occurrences];
      visibleOccurrenceLimit = loadedOccurrences.length;
    }
    latestOccurrenceMeta = {
      token_total: data.token_total,
      verse_total: data.verse_total,
      next_cursor: data.next_cursor,
    };
    renderOccurrencesView();
  }

  // === @section:ui:disclosures ===
  async function renderCompanionsDisclosure(id: number, strongs: string, request: number) {
    companionsBody.replaceChildren(status('Loading word companions & concepts…'));
    const [coRes, relRes] = await Promise.all([
      BibleRPC.getWordCoOccurrences(id),
      BibleRPC.researchRelationships(strongs),
    ]);
    if (request !== generation) return;

    const nodes: HTMLElement[] = [
      el('p', 'study-muted', 'Shared context is an association; it does not establish the same meaning.'),
    ];

    const makeCompanionButton = (word: (typeof coRes.data)[number]) =>
      action(`${word.original_word} · ${word.primary_english ?? word.transliteration}`, () => {
        void inspect({ id: word.word_id }, true, true);
      }, 'connected-word');

    if (coRes.data.length > 0) {
      for (const word of coRes.data.slice(0, 4)) {
        nodes.push(makeCompanionButton(word));
      }
      const remaining = coRes.data.slice(4);
      if (remaining.length > 0) {
        const more = el('details', 'inspector-disclosure');
        more.append(el('summary', '', `More companions (${remaining.length})`));
        const moreBody = el('div', 'inspector-disclosure-body');
        for (const word of remaining) {
          moreBody.append(makeCompanionButton(word));
        }
        more.append(moreBody);
        nodes.push(more);
      }
    } else {
      nodes.push(status(coRes.error ?? 'No cached word connections available.'));
    }

    const paths = relRes.data?.evidence_paths ?? [];
    if (paths.length > 0) {
      const conceptBlock = el('div', 'inspector-origin-group');
      conceptBlock.append(el('p', 'eyebrow inspector-origin-heading', 'RELATED CONCEPTS & TEXTUAL EVIDENCE'));
      for (const path of paths) {
        conceptBlock.append(el('p', 'evidence-category', path.epistemic_category), el('p', '', path.summary));
        for (const span of path.evidence_spans) {
          const p = { book: span.book, chapter: span.start_chapter, verse: span.start_verse };
          const reference = action(span.reference, () => preview.pin(p, span.explanation), 'reference-link');
          preview.attach(reference, p, span.explanation);
          conceptBlock.append(reference);
        }
        conceptBlock.append(el('p', 'study-muted', path.limitations_note));
      }
      nodes.push(conceptBlock);
    } else {
      nodes.push(el('p', 'study-muted', relRes.error ?? 'No reviewed concept annotation available for this query.'));
    }

    companionsBody.replaceChildren(...nodes);
  }

  async function renderRgDossierDisclosure(word: WordRecord, request: number) {
    rgDossierBody.replaceChildren(status('Loading Research Knowledge Graph dossier…'));
    let res = await BibleRPC.graph.getDossier(word.strongs_nr, true, 12);
    if (request !== generation) return;
    if ((!res.data || res.data.status === 'not_found') && word.original_word) {
      const resolved = await BibleRPC.graph.resolveEntity(word.original_word, null, 3);
      if (request !== generation) return;
      const firstKey = resolved.data?.rg_nodes?.[0]?.node_key ?? resolved.data?.canonical_candidates?.[0]?.suggested_node_key;
      if (firstKey) res = await BibleRPC.graph.getDossier(firstKey, true, 12);
      if (request !== generation) return;
    }

    const nodes: HTMLElement[] = [];
    if (graphOpts?.onOpenClaimComposer) {
      nodes.push(
        action('+ Add RG Claim / Connect', () => {
          const curP = currentPassageForInspect ?? appState.getPassage();
          graphOpts.onOpenClaimComposer?.({
            mode: 'create',
            subjectQuery: word.strongs_nr || word.original_word,
            subjectRef: res.data?.node?.node_key,
            subjectLabel: `${word.original_word} (${word.strongs_nr})`,
            subjectWordId: word.id,
            subjectVerseId: undefined,
            title: `${word.original_word} (${word.strongs_nr}) in ${formatVerseRef(curP)}`,
          });
        }, 'study-button'),
      );
    }

    const claims = res.data?.claims ?? [];
    if (claims.length === 0) {
      nodes.push(el('p', 'study-muted', 'No persisted research claims linked to this entity yet.'));
      rgDossierBody.replaceChildren(...nodes);
      return;
    }

    const list = el('div', 'rg-dossier-list');
    for (const c of claims.slice(0, 8)) {
      const card = el('div', 'rg-dossier-item');
      const badgesRow = el('div', 'rg-badges');
      badgesRow.append(
        el('span', `rg-badge ${c.author.kind === 'ai' ? 'rg-badge--ai' : 'rg-badge--human'}`, c.author.kind === 'ai' ? `AI · ${c.author.ai_model || c.author.display_name}` : 'Human'),
        el('span', 'rg-badge', c.evidence_class),
        el('span', 'rg-badge', c.review_status),
        ...(c.is_potentially_stale ? [el('span', 'rg-badge rg-badge--stale', 'Stale')] : []),
      );
      card.append(
        el('strong', '', c.title),
        el('div', 'study-muted', `${c.predicate_label}: ${c.assertion_text}`),
        badgesRow,
      );
      list.append(card);
    }
    nodes.push(list);
    rgDossierBody.replaceChildren(...nodes);
  }

  function renderTechnicalDetails(word: WordRecord, data: ReaderWord) {
    const gematria = word.gematria ?? calculateGematria(word.original_word);
    technicalBody.replaceChildren(
      el('p', 'strongs', `Strong’s ${word.strongs_nr}`),
      el('p', 'gematria-badge', `Gematria: ${gematria}`),
      el('p', 'raw-grammar-code', `Grammar code: ${word.grammar_code ?? 'Grammar unavailable'}`),
      el(
        'p',
        'study-muted',
        `Scope: ${data.scope || 'base Strong’s group'}. STEP Bible (CC BY 4.0) — occurrence renderings across the base Strong’s group are observed translations, not assigned semantic senses.`,
      ),
    );
  }

  // === @section:logic:inspect ===
  async function inspect(next: Selection, remember = true, recordTrail = false) {
    const request = ++generation;
    if (selection && remember && selection.id !== next.id) history.push(selection);
    selection = next;
    currentData = null;
    back.hidden = !history.length;

    loadedOccurrences = [];
    latestOccurrenceMeta = null;
    visibleOccurrenceLimit = INITIAL_OCCURRENCE_COUNT;
    deepLayersLoadedRequest = -1;
    companionsLoadedRequest = -1;
    rgDossierLoadedRequest = -1;
    shownBooks.clear();
    shownRenderings.clear();
    shownVerses.clear();

    const currentPassage = appState.getPassage();
    currentPassageForInspect = currentPassage;
    returnPassage.textContent = `↩ Return to reading (${formatVerseRef(currentPassage)})`;
    returnPassage.hidden = !history.length;

    if (!next.suggested) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.dataset.open = 'true';
    }

    summary.replaceChildren(el('h2', 'inspector-empty-title', 'Opening word…'));
    wordGraph.close();
    originSection.replaceChildren(status('Loading word origin…'));
    occurrences.replaceChildren();
    disclosuresSection.hidden = true;
    deepLayersDetails.open = false;
    companionsDetails.open = false;
    rgDossierDetails.open = false;
    notesDetails.open = false;
    technicalDetails.open = false;
    companionsBody.replaceChildren();
    technicalBody.replaceChildren();
    lexicalGraph.clear();
    wordNotes.clear();

    element.setAttribute('aria-busy', 'true');
    const result = await BibleRPC.getReaderWord(next.id, 0, next.rendering ?? null);
    if (request !== generation) return;
    element.setAttribute('aria-busy', 'false');

    if (!result.data?.word) {
      summary.replaceChildren(
        el('h2', 'inspector-empty-title', 'Word unavailable'),
        status(result.error ?? 'No live word evidence is available.'),
        action('Retry', () => { void inspect(next, false, recordTrail); }),
      );
      wordGraph.close();
      originSection.replaceChildren();
      occurrences.replaceChildren();
      disclosuresSection.hidden = true;
      lexicalGraph.clear();
      wordNotes.clear();
      return;
    }

    currentData = result.data;
    disclosuresSection.hidden = false;
    const lemmaRow = renderSummary(result.data.word, result.data, next, currentPassage, request);
    renderTechnicalDetails(result.data.word, result.data);
    renderOccurrences(result.data);

    if (recordTrail) {
      explorationState.recordWordFocus(
        appState.getPassage(),
        {
          id: result.data.word.id,
          ...(next.position !== undefined ? { position: next.position } : {}),
          original: result.data.word.original_word,
          transliteration: result.data.word.transliteration,
          english: getPrimaryGloss(result.data.word, next),
          strongs: result.data.word.strongs_nr,
        },
        true,
      );
    }

    const strongs = result.data.word.strongs_nr;
    const primaryGloss = getPrimaryGloss(result.data.word, next);
    wordGraph.openForAnchor(strongs, currentPassage, primaryGloss);

    const curOcc = result.data.occurrences?.find(
      o => o.book === currentPassage.book && o.chapter === currentPassage.chapter && o.verse === currentPassage.verse,
    );
    void wordNotes.setWord(next.id, curOcc?.verse_id ?? null, next.position ?? null);

    const [formationRes, candsRes] = await Promise.all([
      BibleRPC.lookupWordFormation(strongs, next.id),
      BibleRPC.suggestOrthographicCandidates(strongs, 8, 2),
    ]);
    if (request !== generation) return;
    if (result.data.lexemes.length === 0 && formationRes.data?.matched_lemmas?.[0]) {
      renderLemmaFactContent(lemmaRow, result.data.word, result.data.lexemes, next, formationRes.data.matched_lemmas[0]);
    }
    renderOriginSection(formationRes.data, candsRes.data?.candidate_connections ?? [], strongs);
  }

  // === @section:logic:page ===
  async function loadMore() {
    if (!selection || currentData?.next_cursor == null) return;
    const request = generation;
    const button = occurrences.querySelector<HTMLButtonElement>('.load-more');
    if (button) button.disabled = true;
    const result = await BibleRPC.getReaderWord(selection.id, currentData.next_cursor, selection.rendering ?? null);
    if (request !== generation) return;
    if (!result.data) {
      if (button) {
        button.disabled = false;
        button.textContent = 'Could not load more · Retry';
      }
      return;
    }
    currentData = result.data;
    renderOccurrences(result.data, true);
  }

  void Promise.all([loadBiblePlacesIndex(), loadFullPeopleGraph(), loadVersePersonIndex()]).then(() => {
    if (activeSpotlightHost && currentData?.word && selection && currentPassageForInspect) {
      renderVisualSpotlight(activeSpotlightHost, currentData.word, selection, currentPassageForInspect);
    }
  });

  return {
    element,
    inspect: (id: number, options: Omit<Selection, 'id'> = {}) => inspect({ id, ...options }),
    setOverview: (value: ReaderOverview | null) => { overview = value; },
    setVerseContext: (tokens: VerseTranslationToken[], geographyPacket: VerseGeographyPacket | null) => {
      verseTokens = tokens;
      currentGeographyPacket = geographyPacket;
      if (activeSpotlightHost && currentData?.word && selection && currentPassageForInspect) {
        renderVisualSpotlight(activeSpotlightHost, currentData.word, selection, currentPassageForInspect);
      }
    },
    reset: () => {
      generation++;
      selection = null;
      currentData = null;
      currentPassageForInspect = null;
      activeSpotlightHost = null;
      history.length = 0;
      element.dataset.open = 'false';
      back.hidden = true;
      returnPassage.hidden = true;
      loadedOccurrences = [];
      latestOccurrenceMeta = null;
      visibleOccurrenceLimit = INITIAL_OCCURRENCE_COUNT;
      deepLayersLoadedRequest = -1;
      companionsLoadedRequest = -1;
      shownBooks.clear();
      shownRenderings.clear();
      shownVerses.clear();
      summary.replaceChildren(
        el('h2', 'inspector-empty-title', 'Select a word'),
        status('Choose any word in the verse to inspect its lemma, LXX parallels, and connections.'),
      );
      wordGraph.close();
      originSection.replaceChildren();
      occurrences.replaceChildren();
      disclosuresSection.hidden = true;
      deepLayersDetails.open = false;
      companionsDetails.open = false;
      rgDossierDetails.open = false;
    notesDetails.open = false;
      technicalDetails.open = false;
      companionsBody.replaceChildren();
      rgDossierBody.replaceChildren();
      technicalBody.replaceChildren();
      lexicalGraph.clear();
      wordNotes.clear();
    },
    close,
  };
}
