// @file: src/ui/components/NavSelector.ts
// @feature: nav-selector
// @tables: none
// @candidates: none
// @toc: imports | ui:main

// === @section:imports ===
import type { ActivePassage, ChronologySummary } from '../../api/types';
import { BIBLE_BOOKS, BOOK_CHAPTERS } from '../utils';

// === @section:ui:main ===
export function createNavSelector(onChange: (passage: ActivePassage) => void) {
  const element = document.createElement('form');
  element.className = 'passage-nav';
  element.setAttribute('aria-label', 'Passage navigation');
  element.innerHTML = `<label class="book-field">Book<select name="book" aria-label="Book"></select></label>
    <label>Chapter<input name="chapter" aria-label="Chapter" type="number" min="1" max="50" value="1" required></label>
    <label>Verse<input name="verse" aria-label="Verse" type="number" min="0" max="176" value="1" required></label>
    <button class="primary-button" type="submit">Read passage <span aria-hidden="true">→</span></button>
    <div class="millennium"><span>CHRONOLOGY</span><strong></strong></div>`;
  const book = element.querySelector('select')!;
  const chapter = element.querySelector<HTMLInputElement>('[name="chapter"]')!;
  const verse = element.querySelector<HTMLInputElement>('[name="verse"]')!;
  const badge = element.querySelector<HTMLElement>('.millennium strong')!;
  BIBLE_BOOKS.forEach((name, index) => book.add(new Option(name, String(index + 1))));
  function submit() {
    if (element.reportValidity()) onChange({ book: Number(book.value), chapter: Number(chapter.value), verse: Number(verse.value) });
  }
  element.addEventListener('submit', event => { event.preventDefault(); submit(); });
  book.addEventListener('change', () => {
    chapter.max = String(BOOK_CHAPTERS[Number(book.value) - 1]);
    chapter.value = '1'; verse.value = '1'; submit();
  });
  chapter.addEventListener('change', submit);
  verse.addEventListener('change', submit);
  return {
    element,
    update(p: ActivePassage) {
      book.value = String(p.book); chapter.value = String(p.chapter); verse.value = String(p.verse);
      chapter.max = String(BOOK_CHAPTERS[p.book - 1]);
    },
    updateMillenniumBadge(millennium: number | null) {
      badge.textContent = millennium && millennium >= 1 && millennium <= 7 ? `Millennium ${millennium}` : 'Not mapped';
    },
    updateChronology(summary: ChronologySummary | null) {
      badge.textContent = summary?.earliest_year != null ? summary.label : 'Not mapped';
      const first = summary?.millennium_first;
      const last = summary?.millennium_last;
      badge.title = first != null && last != null
        ? first === last ? `Millennium ${first} in this model` : `Millennia ${first} to ${last} in this model`
        : 'Select a chronology model and inspect its evidence below the passage.';
    },
  };
}
