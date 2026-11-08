// @file: src/ui/components/VerseReader.ts
// @feature: verse-reader
// @tables: verses | words | verse_translation_sources | word_translation_choices | reader_rendering_groups | reader_english_verses
// @candidates: none
// @toc: imports | types | ui:tokens | ui:notes-badge | ui:main | logic:context

// === @section:imports ===
import type { ActivePassage, DataResult, VerseTranslationToken, ReaderOverview, ReaderPassage } from '../../api/types';
import { formatVerseRef } from '../utils';
import { createTranslationChoice } from './TranslationChoice';
import type { ContextPreview } from './ContextPreview';
import { createWordRenderingRange } from './WordRenderingRange';
import { action, el } from '../study-dom';

// === @section:types ===
export interface VerseReaderActions {
  context: HTMLElement;
  preview: ContextPreview;
  onWord: (id: number, position: number, english: string, rendering?: string) => void;
  onPlace: (key: string) => void;
  onTokenNotes?: (position: number) => void;
}

// === @section:ui:tokens ===
export function renderVerseTokens(container: HTMLElement, tokens: VerseTranslationToken[],
  onWordClick: (id: number, position: number, english: string) => void, p: ActivePassage, canSave: boolean) {
  container.replaceChildren();
  tokens.forEach(token => {
    const word = document.createElement('div'); word.className = 'word-token';
    word.dataset.position = String(token.word_position);
    word.dataset.strongs = token.strongs_nr;
    const button = document.createElement('button'); button.className = 'word-inspect';
    button.type = 'button';
    button.setAttribute('aria-label', `Inspect ${token.original_word} (${token.transliteration})`);
    const original = document.createElement('span'); original.className = 'original';
    original.textContent = token.original_word; button.append(original);
    const transliteration = document.createElement('span'); transliteration.className = 'transliteration';
    transliteration.textContent = token.transliteration; transliteration.dir = 'ltr'; transliteration.lang = 'en';
    button.addEventListener('click', () => onWordClick(token.word_id, token.word_position, token.selected_english ?? token.source_english ?? ''));
    const here = el('span', 'range-label', 'Here'); here.dir = 'ltr';
    word.append(button, transliteration, here, createTranslationChoice({ ...p }, token, canSave && !!token.source_ref),
      el('div', 'token-range-mount'), el('div', 'token-place-mount'), el('div', 'token-notes-mount'));
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
  element.innerHTML = `<div class="reader-heading"><div><p class="eyebrow language-label"></p><h2></h2></div>
    <span class="source-badge"></span></div><div class="english-reading"><p class="eyebrow">ENGLISH · WORLD ENGLISH BIBLE</p><p class="english-verse" role="status">Loading English verse…</p></div>
    <div class="interlinear-caption"><span>THE ORIGINAL WORDS</span><span>Here: this occurrence · Elsewhere: observed English renderings</span></div><div class="word-grid"></div>
    <p class="reader-empty" role="status"></p><p class="translation-notice" role="status" hidden></p>
    <div class="reader-footer"><span class="reading-direction"></span>
    <span>Original text <span class="legend-dot">·</span> Transliteration</span></div>`;
  const grid = element.querySelector<HTMLElement>('.word-grid')!;
  element.querySelector('.interlinear-caption')!.before(actions.context);
  let tokens: VerseTranslationToken[] = [], overview: ReaderOverview | null = null, selected: number | null = null;
  const handle = {
    element,
    render(p: ActivePassage, data: DataResult<VerseTranslationToken[]>, loading = false) {
      tokens = data.data;
      const hebrew = p.book <= 39;
      element.querySelector('h2')!.textContent = formatVerseRef(p);
      element.querySelector('.language-label')!.textContent = hebrew ? 'HEBREW / OLD TESTAMENT' : 'GREEK / NEW TESTAMENT';
      grid.dir = hebrew ? 'rtl' : 'ltr'; grid.lang = hebrew ? 'he' : 'el';
      grid.className = `word-grid ${hebrew ? 'rtl' : 'ltr'}`;
      element.querySelector('.source-badge')!.textContent = data.source === 'sample' ? 'Built-in sample' : loading ? 'Loading' : data.data.length ? 'Live database' : 'No passage';
      element.querySelector('.reading-direction')!.textContent = hebrew ? '← Read right to left' : 'Read left to right →';
      const empty = element.querySelector<HTMLElement>('.reader-empty')!;
      empty.hidden = data.data.length > 0;
      empty.textContent = loading ? 'Opening passage…' : data.error ? `${data.error} Try a built-in sample below.` : 'This passage has not been imported yet. Try Genesis 1:1 or John 1:1 below.';
      element.setAttribute('aria-busy', String(loading));
      const notice = element.querySelector<HTMLElement>('.translation-notice')!;
      notice.textContent = data.data.length ? data.error ?? '' : '';
      notice.hidden = !notice.textContent;
      element.querySelector('.reader-footer > span:last-child')!.textContent = 'Original · English · Transliteration';
      renderVerseTokens(grid, data.data, actions.onWord, p, data.source === 'live' && !data.error && !loading);
      applyContext();
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
      mount.replaceChildren(overview ? createWordRenderingRange(overview.ranges[token.strongs_nr] ?? [], actions.preview,
        label => actions.onWord(token.word_id, token.word_position, token.selected_english ?? token.source_english ?? '', label)) : el('span', 'study-muted', 'Loading rendering range…'));
      const places = node.querySelector('.token-place-mount')!; places.replaceChildren();
      for (const place of overview?.place_anchors.filter(a => a.word_position === token.word_position) ?? []) {
        places.append(action(`Map: ${place.name} ↗`, () => actions.onPlace(place.place_key), 'place-name-link'));
      }
    }
    applySelection();
  }
  return handle;
}
