// @file: src/ui/components/VerseReader.ts
// @feature: verse-reader
// @tables: verses | words | verse_translation_sources | word_translation_choices
// @candidates: none
// @toc: imports | ui:tokens | ui:main

// === @section:imports ===
import type { ActivePassage, DataResult, VerseTranslationToken } from '../../api/types';
import { formatVerseRef } from '../utils';
import { createTranslationChoice } from './TranslationChoice';

// === @section:ui:tokens ===
export function renderVerseTokens(container: HTMLElement, tokens: VerseTranslationToken[],
  onWordClick: (id: number) => void, p: ActivePassage, canSave: boolean) {
  container.replaceChildren();
  tokens.forEach(token => {
    const word = document.createElement('div'); word.className = 'word-token';
    word.dataset.position = String(token.word_position);
    const button = document.createElement('button'); button.className = 'word-inspect';
    button.type = 'button';
    button.setAttribute('aria-label', `Inspect ${token.original_word} (${token.transliteration})`);
    const original = document.createElement('span'); original.className = 'original';
    original.textContent = token.original_word; button.append(original);
    const transliteration = document.createElement('span'); transliteration.className = 'transliteration';
    transliteration.textContent = token.transliteration; transliteration.dir = 'ltr'; transliteration.lang = 'en';
    button.addEventListener('click', () => onWordClick(token.word_id));
    word.append(button, createTranslationChoice({ ...p }, token, canSave && !!token.source_ref), transliteration);
    container.append(word);
  });
}

// === @section:ui:main ===
export function createVerseReader(onWordClick: (id: number) => void) {
  const element = document.createElement('section');
  element.className = 'reader-card';
  element.setAttribute('aria-label', 'Interlinear verse reader');
  element.innerHTML = `<div class="reader-heading"><div><p class="eyebrow language-label"></p><h2></h2></div>
    <span class="source-badge"></span></div><div class="word-grid"></div>
    <p class="reader-empty" role="status"></p><p class="translation-notice" role="status" hidden></p>
    <div class="reader-footer"><span class="reading-direction"></span>
    <span>Original text <span class="legend-dot">·</span> Transliteration</span></div>`;
  const grid = element.querySelector<HTMLElement>('.word-grid')!;
  return {
    element,
    render(p: ActivePassage, data: DataResult<VerseTranslationToken[]>, loading = false) {
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
      renderVerseTokens(grid, data.data, onWordClick, p, data.source === 'live' && !data.error && !loading);
    },
  };
}
