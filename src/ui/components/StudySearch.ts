// @file: src/ui/components/StudySearch.ts
// @feature: nav-selector
// @tables: words | verses
// @candidates: none
// @toc: imports | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage } from '../../api/types';
import { BIBLE_BOOKS, formatVerseRef } from '../utils';
import { action, el, status } from '../study-dom';

// === @section:ui:main ===
const STARTER_PASSAGES: readonly ActivePassage[] = [
  { book: 1, chapter: 1, verse: 2 },
  { book: 26, chapter: 37, verse: 9 },
  { book: 19, chapter: 3, verse: 1 },
  { book: 43, chapter: 1, verse: 1 },
];

function parsePassageQuery(query: string): ActivePassage | null {
  const match = /^(.+?)\s+(\d+):(\d+)$/.exec(query);
  if (!match) return null;
  const targetBook = match[1]!.toLowerCase();
  const book = BIBLE_BOOKS.findIndex(
    b => b.toLowerCase() === targetBook || b.toLowerCase().replace('psalms', 'psalm') === targetBook,
  );
  if (book < 0) return null;
  return { book: book + 1, chapter: Number(match[2]), verse: Number(match[3]) };
}

export function createStudySearch(navigate: (p: ActivePassage) => void, inspect: (id: number) => void) {
  const element = el('div', 'study-search');
  const form = el('form');
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'Passage, word, or Strong’s number';
  input.setAttribute('aria-label', 'Find a passage or word');
  const submit = el('button', 'study-button', 'Find');
  submit.type = 'submit';
  form.append(input, submit);

  const results = el('div', 'study-search-results');
  results.hidden = true;
  results.setAttribute('aria-live', 'polite');
  element.append(form, results);

  let generation = 0;
  let debounceTimer: number | null = null;

  const clearDebounce = () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const dismiss = () => {
    clearDebounce();
    generation++;
    results.hidden = true;
  };

  const renderQuickExamples = () => {
    const examples = el('div', 'study-examples');
    const label = el('span', 'study-examples-label study-muted', 'Quick examples');
    label.style.margin = '0';
    label.style.alignSelf = 'center';
    examples.append(label);
    for (const p of STARTER_PASSAGES) {
      const ref = formatVerseRef(p);
      examples.append(action(ref, () => { void search(ref, true); }, 'text-action'));
    }
    return examples;
  };

  const showQuickExamples = () => {
    clearDebounce();
    generation++;
    results.hidden = false;
    results.replaceChildren(renderQuickExamples(), action('Close results', dismiss, 'text-action'));
  };

  async function search(rawTerm: string, allowDirectNavigate = true) {
    const query = rawTerm.trim();
    if (query.length < 2) {
      showQuickExamples();
      return;
    }
    const passage = parsePassageQuery(query);
    if (passage && allowDirectNavigate) {
      dismiss();
      navigate(passage);
      return;
    }
    const request = ++generation;
    results.hidden = false;
    results.replaceChildren(status('Finding lexical groups…'));
    const response = await BibleRPC.searchReaderWords(query.toLowerCase() === 'ruach' ? 'H7307' : query);
    if (request !== generation) return;
    results.replaceChildren(action('Close results', dismiss, 'text-action'));
    if (passage) {
      const ref = formatVerseRef(passage);
      results.append(action(`Open ${ref}`, () => { dismiss(); navigate(passage); }, 'search-result'));
    }
    for (const result of response.data ?? []) {
      results.append(
        action(
          `${result.original_word} · ${result.transliteration} · ${result.strongs_nr} · ${result.biblical_def ?? ''}`,
          () => { dismiss(); inspect(result.id); },
          'search-result',
        ),
      );
    }
    if (!passage && !response.data?.length) {
      results.append(
        status(response.error ?? 'No lexical match. Try a full passage reference or a Strong’s number; concepts can also be explored in advanced research.'),
      );
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    clearDebounce();
    void search(input.value, true);
  });

  input.addEventListener('focus', () => {
    const query = input.value.trim();
    if (query.length < 2) {
      showQuickExamples();
    } else if (results.hidden) {
      void search(query, false);
    }
  });

  input.addEventListener('input', () => {
    clearDebounce();
    const query = input.value.trim();
    if (query.length < 2) {
      showQuickExamples();
      return;
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      void search(input.value, false);
    }, 150);
  });

  element.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !results.hidden) {
      dismiss();
      if (results.contains(document.activeElement)) input.focus();
    }
  });

  document.addEventListener('pointerdown', e => {
    if (!results.hidden && e.target instanceof Node && !element.contains(e.target)) {
      dismiss();
    }
  });

  return { element };
}
