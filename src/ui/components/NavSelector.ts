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
  element.className = 'passage-nav study-nav-form nav-row';
  element.setAttribute('aria-label', 'Passage navigation');

  const bookLabel = document.createElement('label');
  bookLabel.className = 'book-field';
  bookLabel.textContent = 'Book';
  const book = document.createElement('select');
  book.name = 'book';
  book.setAttribute('aria-label', 'Book');
  BIBLE_BOOKS.forEach((name, index) => book.add(new Option(name, String(index + 1))));
  bookLabel.append(book);

  const chapterLabel = document.createElement('label');
  chapterLabel.className = 'nav-num-field';
  chapterLabel.textContent = 'Ch';
  const chapter = document.createElement('input');
  chapter.name = 'chapter';
  chapter.type = 'number';
  chapter.min = '1';
  chapter.max = '50';
  chapter.value = '1';
  chapter.required = true;
  chapter.setAttribute('aria-label', 'Chapter');
  chapterLabel.append(chapter);

  const verseLabel = document.createElement('label');
  verseLabel.className = 'nav-num-field';
  verseLabel.textContent = 'Vs';
  const verse = document.createElement('input');
  verse.name = 'verse';
  verse.type = 'number';
  verse.min = '0';
  verse.max = '176';
  verse.value = '1';
  verse.required = true;
  verse.setAttribute('aria-label', 'Verse');
  verseLabel.append(verse);

  const submitButton = document.createElement('button');
  submitButton.className = 'primary-button';
  submitButton.type = 'submit';
  submitButton.setAttribute('aria-label', 'Go to passage');
  submitButton.textContent = 'Go';

  const millenniumWrap = document.createElement('span');
  millenniumWrap.className = 'millennium';
  millenniumWrap.hidden = true;
  const badge = document.createElement('strong');
  millenniumWrap.append(badge);

  element.append(bookLabel, chapterLabel, verseLabel, submitButton, millenniumWrap);

  function submit() {
    if (element.reportValidity()) onChange({ book: Number(book.value), chapter: Number(chapter.value), verse: Number(verse.value) });
  }
  element.addEventListener('submit', event => { event.preventDefault(); submit(); });
  book.addEventListener('change', () => {
    chapter.max = String(BOOK_CHAPTERS[Number(book.value) - 1] ?? 50);
    chapter.value = '1'; verse.value = '1'; submit();
  });
  chapter.addEventListener('change', submit);
  verse.addEventListener('change', submit);
  return {
    element,
    update(p: ActivePassage) {
      book.value = String(p.book); chapter.value = String(p.chapter); verse.value = String(p.verse);
      chapter.max = String(BOOK_CHAPTERS[p.book - 1] ?? 50);
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
