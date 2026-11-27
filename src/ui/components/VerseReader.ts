// @file: src/ui/components/VerseReader.ts
// @feature: verse-reader
// @tables: verses | words | verse_translation_sources | word_translation_choices | reader_rendering_groups | reader_english_verses
// @candidates: none
// @toc: imports | types | ui:tokens | ui:notes-badge | ui:main | logic:context

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage, DataResult, VerseTranslationToken, ReaderOverview, ReaderPassage } from '../../api/types';
import { formatVerseRef } from '../utils';
import { createTranslationChoice } from './TranslationChoice';
import type { ContextPreview } from './ContextPreview';
import type { WordHoverPreview } from './WordHoverPreview';
import { createWordRenderingRange } from './WordRenderingRange';
import { action, el, status } from '../study-dom';
import { explorationState, type DensityMode, type ReaderMode } from '../exploration-state';
import type { DragAnchorPayload } from '../drag-controller';
import { applyTokenHighlights, createHighlightLegend, type HighlightMode } from '../highlights';
import { createLiteraryStructurePanel, type LiteraryHighlightMap } from './LiteraryStructurePanel';

// === @section:types ===
export interface VerseReaderActions {
  context: HTMLElement;
  preview: ContextPreview;
  wordPreview: WordHoverPreview;
  onWord: (id: number, position: number, english: string, rendering?: string) => void;
  onPlace: (key: string) => void;
  onTokenNotes?: (position: number) => void;
  onNavigate?: (p: ActivePassage) => void;
  onPinCompare?: (p: ActivePassage) => void;
  onRegisterDrag?: (target: HTMLElement, getPayload: () => DragAnchorPayload) => () => void;
}

type ReadingDir = 'rtl' | 'ltr';

const DIRECTION_STORAGE_OT = 'br-reading-dir-ot';
const DIRECTION_STORAGE_NT = 'br-reading-dir-nt';

function getDirectionStorageKey(book: number): string {
  return book <= 39 ? DIRECTION_STORAGE_OT : DIRECTION_STORAGE_NT;
}

function readDirectionPreference(book: number): ReadingDir {
  const fallback: ReadingDir = book <= 39 ? 'rtl' : 'ltr';
  try {
    const saved = localStorage.getItem(getDirectionStorageKey(book));
    if (saved === 'rtl' || saved === 'ltr') return saved;
  } catch {
    /* Storage is optional. */
  }
  return fallback;
}

function saveDirectionPreference(book: number, dir: ReadingDir): void {
  try {
    localStorage.setItem(getDirectionStorageKey(book), dir);
  } catch {
    /* Storage is optional. */
  }
}

// === @section:ui:tokens ===
export function renderVerseTokens(
  container: HTMLElement,
  tokens: VerseTranslationToken[],
  onWordClick: (id: number, position: number, english: string) => void,
  p: ActivePassage,
  canSave: boolean,
  attachWordPreview?: (target: HTMLElement, token: VerseTranslationToken) => void
) {
  container.replaceChildren();
  tokens.forEach(token => {
    const word = document.createElement('div'); word.className = 'word-token';
    word.dataset.position = String(token.word_position);
    word.dataset.strongs = token.strongs_nr;
    const button = document.createElement('button'); button.className = 'word-inspect';
    button.type = 'button';
    button.setAttribute('aria-label', `Inspect ${token.original_word} (${token.transliteration})`);
    const original = document.createElement('span'); original.className = 'original';
    original.dir = p.book <= 39 ? 'rtl' : 'ltr';
    original.lang = p.book <= 39 ? 'he' : 'el';
    original.textContent = token.original_word; button.append(original);
    const transliteration = document.createElement('span'); transliteration.className = 'transliteration';
    transliteration.textContent = token.transliteration; transliteration.dir = 'ltr'; transliteration.lang = 'en';
    const inspectToken = () =>
      onWordClick(token.word_id, token.word_position, token.selected_english ?? token.source_english ?? '');
    button.addEventListener('click', inspectToken);
    word.addEventListener('click', event => {
      const origin = event.target instanceof Element ? event.target : null;
      if (origin?.closest('button, select, option, a, input, .token-range-mount, .token-place-mount, .token-notes-mount, .translation-actions')) {
        return;
      }
      inspectToken();
    });
    word.append(button, transliteration, createTranslationChoice({ ...p }, token, canSave && !!token.source_ref),
      el('div', 'token-range-mount'), el('div', 'token-place-mount'), el('div', 'token-notes-mount'));
    attachWordPreview?.(button, token);
    container.append(word);
  });
}

// === @section:ui:notes-badge ===
export function applyNoteCounts(grid: HTMLElement, counts: { word_position: number; human: number; ai: number }[],
  onTokenNotes?: (pos: number) => void) {
  const map = new Map(counts.map(c => [c.word_position, c]));
  grid.querySelectorAll<HTMLElement>('.word-token').forEach(node => {
    const mount = node.querySelector<HTMLElement>('.token-notes-mount');
    if (!mount) return;
    mount.replaceChildren();
    const pos = Number(node.dataset.position);
    const count = map.get(pos);
    if (!count || (count.human === 0 && count.ai === 0)) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'token-notes-badge';
    const parts: string[] = [];
    if (count.human > 0) parts.push(`${count.human} human note${count.human > 1 ? 's' : ''}`);
    if (count.ai > 0) parts.push(`${count.ai} AI note${count.ai > 1 ? 's' : ''}`);
    btn.setAttribute('aria-label', parts.join(', '));
    btn.addEventListener('click', (e) => { e.stopPropagation(); onTokenNotes?.(pos); });
    if (count.human > 0) {
      const h = document.createElement('span'); h.className = 'token-notes-count token-notes-count--human';
      h.textContent = String(count.human); btn.appendChild(h);
    }
    if (count.ai > 0) {
      const a = document.createElement('span'); a.className = 'token-notes-count token-notes-count--ai';
      a.textContent = String(count.ai); btn.appendChild(a);
    }
    mount.appendChild(btn);
  });
}

// === @section:ui:main ===
export function createVerseReader(actions: VerseReaderActions) {
  const element = document.createElement('section');
  element.className = 'reader-card';
  element.setAttribute('aria-label', 'Interlinear verse reader');
  element.innerHTML = `<div class="reader-heading">
      <div><p class="eyebrow language-label"></p><h2></h2></div>
      <div class="reader-heading-right">
        <div class="reader-controls-bar">
          <div class="segmented-control js-mode-group" role="group" aria-label="Reading view mode">
            <button type="button" class="seg-btn" data-mode="verse">Verse</button>
            <button type="button" class="seg-btn" data-mode="context">Context ±2</button>
            <button type="button" class="seg-btn" data-mode="chapter">Chapter</button>
          </div>
          <button type="button" class="trail-btn js-pin-compare">Pin &amp; Compare</button>
          <button type="button" class="lit-toggle-btn js-literary-toggle" aria-pressed="false" title="Toggle Literary Structure Discovery Mode">Literary</button>
        </div>
        <span class="source-badge"></span>
      </div>
    </div>
    <div class="reader-context-before" hidden></div>
    <div class="english-reading">
      <p class="eyebrow">ENGLISH · WORLD ENGLISH BIBLE</p>
      <p class="english-verse" role="status">Loading English verse…</p>
    </div>
    <div class="interlinear-toolbar">
      <div class="interlinear-caption">
        <span class="interlinear-caption__label">ORIGINAL WORDS</span>
      </div>
      <div class="interlinear-toolbar__controls">
        <div class="segmented-control js-density-group" role="group" aria-label="Word meaning density">
          <button type="button" class="seg-btn" data-density="rich">Rich</button>
          <button type="button" class="seg-btn" data-density="compact">Compact</button>
          <button type="button" class="seg-btn" data-density="english">English</button>
        </div>
        <div class="segmented-control js-direction-group" role="group" aria-label="Reading flow direction">
          <button type="button" class="seg-btn" data-dir="rtl" aria-pressed="false" title="Read right to left">← RTL</button>
          <button type="button" class="seg-btn" data-dir="ltr" aria-pressed="false" title="Read left to right">LTR →</button>
        </div>
        <div class="segmented-control js-highlight-group" role="group" aria-label="Structural and repetition highlights">
          <button type="button" class="seg-btn is-active" data-hl="off" aria-pressed="true">HL: Off</button>
          <button type="button" class="seg-btn" data-hl="repetitions" aria-pressed="false">Repeat</button>
          <button type="button" class="seg-btn" data-hl="grammar" aria-pressed="false">Grammar</button>
          <button type="button" class="seg-btn" data-hl="both" aria-pressed="false">Both</button>
        </div>
      </div>
    </div>
    <div class="highlight-legend-mount" hidden></div>
    <div class="word-grid"></div>
    <p class="density-english-hint study-muted" hidden>English-only mode active. Switch to Rich or Compact above to inspect Hebrew/Greek words and inline meanings.</p>
    <div class="reader-context-after" hidden></div>
    <div class="reader-chapter-stream" hidden></div>
    <p class="reader-empty" role="status"></p>
    <p class="translation-notice" role="status" hidden></p>
    <div class="reader-footer"><span class="reading-direction"></span>
    <span>Original text <span class="legend-dot">·</span> Transliteration</span></div>`;

  const grid = element.querySelector<HTMLElement>('.word-grid')!;
  const legendMount = element.querySelector<HTMLElement>('.highlight-legend-mount')!;
  const readerHeading = element.querySelector<HTMLElement>('.reader-heading')!;
  const beforeStream = element.querySelector<HTMLElement>('.reader-context-before')!;
  const afterStream = element.querySelector<HTMLElement>('.reader-context-after')!;
  const chapterStream = element.querySelector<HTMLElement>('.reader-chapter-stream')!;
  const englishHint = element.querySelector<HTMLElement>('.density-english-hint')!;
  const modeButtons = element.querySelectorAll<HTMLButtonElement>('.js-mode-group .seg-btn');
  const densityButtons = element.querySelectorAll<HTMLButtonElement>('.js-density-group .seg-btn');
  const directionButtons = element.querySelectorAll<HTMLButtonElement>('.js-direction-group .seg-btn');
  const highlightButtons = element.querySelectorAll<HTMLButtonElement>('.js-highlight-group .seg-btn');
  const readingDirectionEl = element.querySelector<HTMLElement>('.reading-direction')!;
  const pinCompareBtn = element.querySelector<HTMLButtonElement>('.js-pin-compare')!;
  const literaryToggleBtn = element.querySelector<HTMLButtonElement>('.js-literary-toggle')!;

  element.querySelector('.interlinear-toolbar')!.before(actions.context);

  let activePassage: ActivePassage = { book: 1, chapter: 1, verse: 1 };
  let tokens: VerseTranslationToken[] = [];
  let overview: ReaderOverview | null = null;
  let selected: number | null = null;
  let modeGeneration = 0;
  let chapterMaxLoaded = 0;
  let currentReaderMode: ReaderMode = explorationState.getSnapshot().readerMode;
  let highlightMode: HighlightMode = 'off';
  let tokenDragCleanups: Array<() => void> = [];
  let latestLiteraryMap: LiteraryHighlightMap | null = null;
  let lastPaintedAnalysisRef: LiteraryHighlightMap['analysis'] | null = null;
  let lastPaintedIsolatedKey = '';

  function syncLiteraryHoverDimming(activeFamilyId: string | null) {
    const toggleNode = (node: HTMLElement) => {
      const fam = node.dataset.litFamily;
      if (!fam) {
        node.classList.remove('lit-tok-dim');
        return;
      }
      node.classList.toggle('lit-tok-dim', Boolean(activeFamilyId && fam !== activeFamilyId));
    };
    grid.querySelectorAll<HTMLElement>('.word-token.lit-hl').forEach(toggleNode);
    chapterStream.querySelectorAll<HTMLElement>('.lit-chap-token.lit-hl').forEach(toggleNode);
  }

  const literaryPanel = createLiteraryStructurePanel({
    onHighlightUpdate: map => {
      const structKey = `${map.active}|${map.intensity}|${map.showNested}|${[...map.visibleFamilies.map(f => f.id)].join(',')}|${[...map.focusedWordIds].join(',')}`;
      const hoverOnly =
        latestLiteraryMap?.active === map.active &&
        lastPaintedAnalysisRef === map.analysis &&
        lastPaintedIsolatedKey === structKey;
      latestLiteraryMap = map;
      element.dataset.litIntensity = map.intensity;
      if (hoverOnly) {
        syncLiteraryHoverDimming(map.activeFamilyId);
        return;
      }
      lastPaintedAnalysisRef = map.analysis;
      lastPaintedIsolatedKey = structKey;
      applyHighlights();
      decorateChapterRows();
    },
    onNavigate: p => actions.onNavigate?.(p),
    onInspectWord: (wordId, pos, eng) => actions.onWord(wordId, pos, eng),
  });
  element.querySelector('.reader-footer')!.before(literaryPanel.element);

  literaryToggleBtn.addEventListener('click', () => {
    const next = !literaryPanel.isActive();
    literaryPanel.setActive(next);
    literaryToggleBtn.classList.toggle('is-active', next);
    literaryToggleBtn.setAttribute('aria-pressed', String(next));
    if (next) literaryPanel.setPassage(activePassage);
  });

  if (actions.onRegisterDrag) {
    readerHeading.setAttribute('data-drag-handle', 'true');
    readerHeading.title = 'Drag verse toward right edge to compare, left edge to pin A, or bottom for quick note';
    actions.onRegisterDrag(readerHeading, () => ({
      kind: 'verse',
      passage: { ...activePassage },
      label: formatVerseRef(activePassage),
    }));
  }

  function renderOriginalWithChars(targetEl: HTMLElement, text: string, indices?: number[]) {
    if (!indices?.length) {
      targetEl.textContent = text;
      return;
    }
    targetEl.replaceChildren();
    const set = new Set(indices);
    let buf = '';
    let inMark = false;
    const flush = () => {
      if (!buf) return;
      if (inMark) {
        const m = document.createElement('mark');
        m.className = 'lit-wp-char';
        m.textContent = buf;
        targetEl.append(m);
      } else {
        targetEl.append(document.createTextNode(buf));
      }
      buf = '';
    };
    for (let i = 0; i < text.length; i++) {
      const hit = set.has(i);
      if (hit !== inMark) {
        flush();
        inMark = hit;
      }
      buf += text[i];
    }
    flush();
  }

  function applyHighlights() {
    const summary = applyTokenHighlights(grid, tokens, overview, highlightMode);
    if (highlightMode === 'off') {
      legendMount.replaceChildren();
      legendMount.hidden = true;
    } else {
      legendMount.replaceChildren(createHighlightLegend(highlightMode, summary));
      legendMount.hidden = false;
    }

    // Layer Literary Structure continuous phrase highlights onto Verse .word-grid
    grid.querySelectorAll('.lit-dev-glyph').forEach(n => n.remove());
    grid.querySelectorAll<HTMLElement>('.word-token').forEach((node, idx) => {
      node.classList.remove(
        'lit-hl', 'lit-tok-dev', 'lit-tok-focus', 'lit-tok-dim', 'lit-nested-1',
        'lit-span--single', 'lit-span--start', 'lit-span--mid', 'lit-span--end'
      );
      delete node.dataset.litFamily;
      node.style.removeProperty('--lit-color');
      const origEl = node.querySelector<HTMLElement>('.original');
      const tok = tokens[idx];
      if (origEl && tok) origEl.textContent = tok.original_word;
    });

    if (latestLiteraryMap?.active && latestLiteraryMap.analysis) {
      const analysis = latestLiteraryMap.analysis;
      const verseTokensInAnalysis = analysis.tokens.filter(
        t => t.book === activePassage.book && t.chapter === activePassage.chapter && t.verse === activePassage.verse
      );
      const byPos = new Map(verseTokensInAnalysis.map(t => [t.pos, t]));

      grid.querySelectorAll<HTMLElement>('.word-token').forEach(node => {
        const pos = Number(node.dataset.position);
        const litTok = byPos.get(pos);
        if (!litTok) return;
        const st = latestLiteraryMap!.tokenStyles.get(litTok.id);
        if (st) {
          node.classList.add('lit-hl', `lit-span--${st.spanPos}`);
          node.dataset.litFamily = st.familyId;
          node.style.setProperty('--lit-color', `var(--lit-c${st.colorIdx})`);
          node.title = `${st.familyLabel}${st.isDeviation ? ` (Deviation: ${st.deviationKind})` : ''} · Click to inspect`;
          if (st.isDeviation) {
            node.classList.add('lit-tok-dev');
            if (st.spanPos === 'start' || st.spanPos === 'single') {
              const glyph = st.deviationKind === 'omission' ? '∅' : st.deviationKind === 'reordering' ? '⇄' : '✦';
              const badge = el('span', 'lit-dev-glyph', glyph);
              badge.setAttribute('aria-hidden', 'true');
              node.querySelector<HTMLElement>('.original')?.after(badge);
            }
          }
          if ((st.nestedDepth ?? 0) > 0) node.classList.add('lit-nested-1');
          if (st.dimmed) node.classList.add('lit-tok-dim');
          node.onmouseenter = () => literaryPanel.hoverFamily(st.familyId);
          node.onmouseleave = () => literaryPanel.hoverFamily(null);
          node.onclick = () => literaryPanel.focusFromToken(litTok.id);
          const origEl = node.querySelector<HTMLElement>('.original');
          if (origEl && st.wpCharIndices?.length) {
            renderOriginalWithChars(origEl, litTok.surfaceForm, st.wpCharIndices);
          }
        } else {
          node.onmouseenter = null;
          node.onmouseleave = null;
          node.onclick = null;
        }
        if (latestLiteraryMap!.focusedWordIds.has(litTok.id)) {
          node.classList.add('lit-tok-focus');
        }
      });
    }
  }

  function decorateChapterRows() {
    chapterStream.querySelectorAll('.lit-chap-unit-banner, .lit-chap-tokens, .lit-chap-gap-pill').forEach(n => n.remove());
    if (currentReaderMode !== 'chapter' || !latestLiteraryMap?.active || !latestLiteraryMap.analysis) return;

    const analysis = latestLiteraryMap.analysis;
    const rows = Array.from(chapterStream.querySelectorAll<HTMLElement>('.reader-chapter-row'));
    if (!rows.length) return;

    const unitStartRef = new Map<string, { kind: string; title: string; meta: string }>();
    const seg = analysis.segmentation;
    if (seg?.introduction) {
      unitStartRef.set(seg.introduction.fromRef, {
        kind: 'intro',
        title: `Introduction · ${seg.introduction.fromRef}–${seg.introduction.toRef}`,
        meta: seg.introduction.rationale,
      });
    }
    if (seg) {
      for (const u of seg.units) {
        unitStartRef.set(u.fromRef, {
          kind: 'unit',
          title: `${u.label} · ${u.fromRef}–${u.toRef}`,
          meta: latestLiteraryMap.showNested && u.subunits.length ? `${u.subunits.length} nested subunits` : '',
        });
      }
      if (seg.conclusion) {
        unitStartRef.set(seg.conclusion.fromRef, {
          kind: 'conclusion',
          title: `Conclusion · ${seg.conclusion.fromRef}–${seg.conclusion.toRef}`,
          meta: seg.conclusion.transformationSummary,
        });
      }
    }

    const seenBanners = new Set<string>();
    for (const row of rows) {
      const b = Number(row.dataset.book);
      const c = Number(row.dataset.chapter);
      const v = Number(row.dataset.verse);
      const vToks = analysis.tokens.filter(t => t.book === b && t.chapter === c && t.verse === v);
      const vRef = vToks[0]?.ref;

      if (vRef && unitStartRef.has(vRef) && !seenBanners.has(vRef)) {
        seenBanners.add(vRef);
        const info = unitStartRef.get(vRef)!;
        const banner = el('div', `lit-chap-unit-banner lit-chap-unit-banner--${info.kind}`);
        banner.append(el('span', 'lit-chap-unit-banner__title', info.title));
        if (info.meta) banner.append(el('span', 'lit-chap-unit-banner__meta', info.meta));
        row.before(banner);
      }

      if (vToks.length) {
        const tokStrip = el('div', 'lit-chap-tokens');
        tokStrip.dir = b <= 39 ? 'rtl' : 'ltr';
        for (const lt of vToks) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'lit-chap-token';
          const st = latestLiteraryMap.tokenStyles.get(lt.id);
          btn.title = st
            ? `${st.familyLabel}${st.isDeviation ? ` (✦ ${st.deviationKind})` : ''} · "${lt.gloss}" (${lt.strongs})`
            : `${lt.transliteration} ("${lt.gloss}") · ${lt.strongs}`;
          if (st) {
            btn.classList.add('lit-hl', `lit-span--${st.spanPos}`);
            btn.dataset.litFamily = st.familyId;
            btn.style.setProperty('--lit-color', `var(--lit-c${st.colorIdx})`);
            if (st.isDeviation) btn.classList.add('lit-tok-dev');
            if ((st.nestedDepth ?? 0) > 0) btn.classList.add('lit-nested-1');
            if (st.dimmed) btn.classList.add('lit-tok-dim');
            btn.addEventListener('mouseenter', () => literaryPanel.hoverFamily(st.familyId));
            btn.addEventListener('mouseleave', () => literaryPanel.hoverFamily(null));
          }
          if (latestLiteraryMap.focusedWordIds.has(lt.id)) btn.classList.add('lit-tok-focus');
          renderOriginalWithChars(btn, lt.surfaceForm, st?.wpCharIndices);
          if (st?.isDeviation && (st.spanPos === 'start' || st.spanPos === 'single')) {
            const g = el('span', 'lit-dev-glyph', st.deviationKind === 'omission' ? '∅' : st.deviationKind === 'reordering' ? '⇄' : '✦');
            g.setAttribute('aria-hidden', 'true');
            btn.append(g);
          }
          btn.addEventListener('click', e => {
            e.stopPropagation();
            literaryPanel.focusFromToken(lt.id);
          });
          tokStrip.append(btn);
        }
        row.append(tokStrip);
      }

      if (vRef) {
        const verseDevs = analysis.deviations
          .filter(d => d.ref === vRef && d.kind !== 'addition' && d.surprisalBits >= 1.5)
          .slice(0, 1);
        for (const dev of verseDevs) {
          const glyph = dev.kind === 'omission' ? '∅' : dev.kind === 'reordering' ? '⇄' : '✦';
          const rawTarget = (dev.observed ?? dev.expected ?? '').replace(/\s+/g, ' ').trim();
          const shortTarget = rawTarget.length > 26 ? `${rawTarget.slice(0, 24)}…` : rawTarget;
          const pill = action(
            `${glyph} ${dev.kind.replaceAll('_', ' ')}${shortTarget ? `: ${shortTarget}` : ''}`,
            () => {
              literaryPanel.focusFromToken(dev.witnessWordIds[0] ?? vToks[0]?.id ?? '');
            },
            'lit-chap-gap-pill'
          );
          pill.title = dev.description;
          row.append(pill);
        }
      }
    }
  }

  highlightButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.hl as HighlightMode | undefined;
      if (!m || m === highlightMode) return;
      highlightMode = m;
      highlightButtons.forEach(b => {
        const active = b.dataset.hl === highlightMode;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      applyHighlights();
    });
  });

  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode as ReaderMode | undefined;
      if (m) explorationState.setReaderMode(m);
    });
  });

  densityButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.density as DensityMode | undefined;
      if (d) explorationState.setDensityMode(d);
    });
  });

  /** Apply the active testament's reading flow direction without altering script BiDi isolation. */
  function applyDirection() {
    const hebrew = activePassage.book <= 39;
    const activeDir = readDirectionPreference(activePassage.book);
    grid.dir = activeDir;
    grid.lang = hebrew ? 'he' : 'el';
    grid.dataset.script = hebrew ? 'he' : 'el';
    grid.className = `word-grid dir-${activeDir} script-${hebrew ? 'he' : 'el'}`;
    grid.classList.toggle('rtl', activeDir === 'rtl');
    grid.classList.toggle('ltr', activeDir === 'ltr');
    directionButtons.forEach(btn => {
      const active = btn.dataset.dir === activeDir;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    readingDirectionEl.textContent = activeDir === 'rtl'
      ? (hebrew ? '← Read right to left' : '← Flipped right to left')
      : (hebrew ? 'Flipped left to right →' : 'Read left to right →');
  }

  directionButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.dir as ReadingDir | undefined;
      if (dir !== 'rtl' && dir !== 'ltr') return;
      saveDirectionPreference(activePassage.book, dir);
      applyDirection();
    });
  });

  applyDirection();

  pinCompareBtn.addEventListener('click', () => {
    actions.onPinCompare?.(activePassage);
  });

  function buildContextVerseRow(item: ReaderPassage, isCurrent: boolean): HTMLElement {
    const row = el('div', `reader-context-row${isCurrent ? ' is-current' : ''}`);
    row.dataset.book = String(item.passage.book);
    row.dataset.chapter = String(item.passage.chapter);
    row.dataset.verse = String(item.passage.verse);
    const refBtn = action(`${item.passage.verse}`, () => {
      actions.onNavigate?.(item.passage);
    }, 'reader-context-row__num');
    refBtn.title = `Focus ${formatVerseRef(item.passage)}`;
    actions.preview.attach(refBtn, item.passage, `Read ${formatVerseRef(item.passage)}`);
    const textSpan = el('span', 'reader-context-row__text', item.text ?? 'English text unavailable.');
    row.append(refBtn, textSpan);
    if (!isCurrent) {
      row.addEventListener('click', event => {
        if ((event.target as HTMLElement).closest('button')) return;
        actions.onNavigate?.(item.passage);
      });
    }
    return row;
  }

  async function renderContextAndChapter() {
    const req = ++modeGeneration;
    beforeStream.replaceChildren();
    afterStream.replaceChildren();
    chapterStream.replaceChildren();
    beforeStream.hidden = currentReaderMode !== 'context';
    afterStream.hidden = currentReaderMode !== 'context';
    chapterStream.hidden = currentReaderMode !== 'chapter';

    if (currentReaderMode === 'verse') return;

    if (currentReaderMode === 'context') {
      const minV = activePassage.book === 19 ? 0 : 1;
      const beforeRefs: ActivePassage[] = [];
      for (let v = Math.max(minV, activePassage.verse - 2); v < activePassage.verse; v += 1) {
        beforeRefs.push({ book: activePassage.book, chapter: activePassage.chapter, verse: v });
      }
      const afterRefs: ActivePassage[] = [
        { book: activePassage.book, chapter: activePassage.chapter, verse: activePassage.verse + 1 },
        { book: activePassage.book, chapter: activePassage.chapter, verse: activePassage.verse + 2 },
      ];
      if (beforeRefs.length) beforeStream.append(status('Loading earlier verses…'));
      afterStream.append(status('Loading following verses…'));
      const [beforeItems, afterItems] = await Promise.all([
        beforeRefs.length ? BibleRPC.preloadReaderPassages(beforeRefs) : Promise.resolve([]),
        BibleRPC.preloadReaderPassages(afterRefs),
      ]);
      if (req !== modeGeneration || currentReaderMode !== 'context') return;
      beforeStream.replaceChildren(...beforeItems.filter(it => it.text).map(it => buildContextVerseRow(it, false)));
      beforeStream.hidden = beforeStream.childElementCount === 0;
      afterStream.replaceChildren(...afterItems.filter(it => it.text).map(it => buildContextVerseRow(it, false)));
      afterStream.hidden = afterStream.childElementCount === 0;
      return;
    }

    if (currentReaderMode === 'chapter') {
      const minV = activePassage.book === 19 ? 0 : 1;
      const startV = Math.max(minV, activePassage.verse - 5);
      const endV = Math.max(startV + 11, activePassage.verse + 6);
      chapterMaxLoaded = endV;
      chapterStream.append(status(`Loading ${formatVerseRef(activePassage)} chapter stream…`));
      const refs: ActivePassage[] = [];
      for (let v = startV; v <= endV; v += 1) {
        refs.push({ book: activePassage.book, chapter: activePassage.chapter, verse: v });
      }
      const items = await BibleRPC.preloadReaderPassages(refs.slice(0, 12));
      if (req !== modeGeneration || currentReaderMode !== 'chapter') return;

      const list = el('div', 'reader-chapter-list');
      const appendBatch = (batch: ReaderPassage[]) => {
        for (const item of batch) {
          if (!item.text) continue;
          const isCurrent = item.passage.verse === activePassage.verse;
          const row = buildContextVerseRow(item, isCurrent);
          row.classList.add('reader-chapter-row');
          if (isCurrent) row.setAttribute('aria-current', 'location');
          list.append(row);
        }
      };
      appendBatch(items);

      chapterStream.replaceChildren(
        el('p', 'eyebrow chapter-stream-title', `CHAPTER CONTEXT · ${formatVerseRef({ ...activePassage, verse: startV }).replace(/:\d+$/, '')}`),
        list
      );
      decorateChapterRows();
      if (items.length >= 10) {
        const loadMoreBtn = action('Load next 12 verses', async () => {
          loadMoreBtn.disabled = true;
          loadMoreBtn.textContent = 'Loading…';
          const nextRefs: ActivePassage[] = [];
          for (let v = chapterMaxLoaded + 1; v <= chapterMaxLoaded + 12; v += 1) {
            nextRefs.push({ book: activePassage.book, chapter: activePassage.chapter, verse: v });
          }
          const more = await BibleRPC.preloadReaderPassages(nextRefs);
          if (req !== modeGeneration) return;
          chapterMaxLoaded += 12;
          appendBatch(more);
          decorateChapterRows();
          if (more.filter(m => m.text).length < 12) loadMoreBtn.remove();
          else {
            loadMoreBtn.disabled = false;
            loadMoreBtn.textContent = 'Load next 12 verses';
          }
        }, 'study-button load-more');
        chapterStream.append(loadMoreBtn);
      }
    }
  }

  function syncModeAndDensity(mode: ReaderMode, density: DensityMode) {
    const modeChanged = mode !== currentReaderMode;
    currentReaderMode = mode;
    element.dataset.mode = mode;
    element.dataset.density = density;
    englishHint.hidden = density !== 'english';
    modeButtons.forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    densityButtons.forEach(btn => {
      const active = btn.dataset.density === density;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (modeChanged) void renderContextAndChapter();
  }

  explorationState.subscribe(snapshot => {
    syncModeAndDensity(snapshot.readerMode, snapshot.densityMode);
  });

  const handle = {
    element,
    render(p: ActivePassage, data: DataResult<VerseTranslationToken[]>, loading = false) {
      const passageChanged = activePassage.book !== p.book || activePassage.chapter !== p.chapter || activePassage.verse !== p.verse;
      activePassage = { ...p };
      tokens = data.data;
      const hebrew = p.book <= 39;
      element.querySelector('h2')!.textContent = formatVerseRef(p);
      element.querySelector('.language-label')!.textContent = hebrew ? 'HEBREW / OLD TESTAMENT' : 'GREEK / NEW TESTAMENT';
      applyDirection();
      element.querySelector('.source-badge')!.textContent = data.source === 'sample' ? 'Built-in sample' : loading ? 'Loading' : data.data.length ? 'Live database' : 'No passage';
      const empty = element.querySelector<HTMLElement>('.reader-empty')!;
      empty.hidden = data.data.length > 0;
      empty.textContent = loading ? 'Opening passage…' : data.error ? `${data.error} Try a built-in sample below.` : 'This passage has not been imported yet. Try Genesis 1:1 or John 1:1 below.';
      element.setAttribute('aria-busy', String(loading));
      const notice = element.querySelector<HTMLElement>('.translation-notice')!;
      notice.textContent = data.data.length ? data.error ?? '' : '';
      notice.hidden = !notice.textContent;
      element.querySelector('.reader-footer > span:last-child')!.textContent = 'Original · English · Transliteration';
      renderVerseTokens(
        grid,
        data.data,
        actions.onWord,
        p,
        data.source === 'live' && !data.error && !loading,
        (target, token) => actions.wordPreview.attach(target, () => ({ token, overview }))
      );
      for (const cleanup of tokenDragCleanups) cleanup();
      tokenDragCleanups = [];
      if (actions.onRegisterDrag) {
        for (const token of data.data) {
          const node = grid.querySelector<HTMLElement>(`.word-token[data-position="${token.word_position}"]`);
          if (!node) continue;
          const cleanup = actions.onRegisterDrag(node, () => ({
            kind: 'occurrence',
            passage: { ...p },
            label: `${(token.selected_english ?? token.source_english ?? token.transliteration).replaceAll('/', ' ').trim()} (${formatVerseRef(p)})`,
            wordPosition: token.word_position,
            strongs: token.strongs_nr,
            original: token.original_word,
          }));
          tokenDragCleanups.push(cleanup);
        }
      }
      applyContext();
      literaryPanel.setPassage(p);
      if (passageChanged && currentReaderMode !== 'verse') {
        void renderContextAndChapter();
      }
    },
    setEnglish(data: ReaderPassage | null, error?: string | null) {
      element.querySelector('.english-verse')!.textContent = data?.text ?? error ?? 'English text is unavailable for this reference in this edition.';
    },
    setOverview(data: ReaderOverview | null) { overview = data; applyContext(); },
    selectPosition(position: number | null) { selected = position; applySelection(); },
    setNoteCounts(counts: { word_position: number; human: number; ai: number }[]) {
      applyNoteCounts(grid, counts, actions.onTokenNotes);
    },
  };

  // === @section:logic:context ===
  function applySelection() {
    grid.querySelectorAll<HTMLElement>('.word-token').forEach(node => {
      const active = Number(node.dataset.position) === selected;
      node.classList.toggle('is-selected', active);
      node.querySelector('.word-inspect')?.setAttribute('aria-pressed', String(active));
    });
  }
  function applyContext() {
    for (const token of tokens) {
      const node = grid.querySelector<HTMLElement>(`[data-position="${token.word_position}"]`); if (!node) continue;
      const mount = node.querySelector('.token-range-mount')!;
      const hereText = token.selected_english ?? token.source_english ?? token.primary_english ?? '';
      mount.replaceChildren(overview ? createWordRenderingRange(overview.ranges[token.strongs_nr] ?? [], actions.preview,
        label => actions.onWord(token.word_id, token.word_position, hereText, label), hereText) : el('span', 'study-muted', 'Loading rendering range…'));
      const places = node.querySelector('.token-place-mount')!; places.replaceChildren();
      for (const place of overview?.place_anchors.filter(a => a.word_position === token.word_position) ?? []) {
        places.append(action(`Map: ${place.name} ↗`, () => actions.onPlace(place.place_key), 'place-name-link'));
      }
    }
    applySelection();
    applyHighlights();
  }
  return handle;
}
