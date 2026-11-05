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
export function createStudySearch(navigate: (p: ActivePassage) => void, inspect: (id: number) => void) {
  const element = el('div', 'study-search');
  const form = el('form'), input = el('input'); input.type = 'search';
  input.placeholder = 'Passage, word, or Strong’s number'; input.setAttribute('aria-label', 'Find a passage or word');
  const submit = el('button', 'study-button', 'Find'); submit.type = 'submit'; form.append(input, submit);
  const results = el('div', 'study-search-results'); results.hidden = true; results.setAttribute('aria-live', 'polite');
  const dismiss = () => { results.hidden = true; };
  element.append(form, results); let generation = 0;
  form.addEventListener('submit', async event => {
    event.preventDefault(); const request = ++generation, query = input.value.trim();
    if (!query) return;
    const match = /^(.+?)\s+(\d+):(\d+)$/.exec(query);
    if (match) {
      const book = BIBLE_BOOKS.findIndex(b => b.toLowerCase() === match[1]!.toLowerCase() ||
        b.toLowerCase().replace('psalms', 'psalm') === match[1]!.toLowerCase());
      if (book >= 0) { dismiss(); navigate({ book: book + 1, chapter: Number(match[2]), verse: Number(match[3]) }); return; }
    }
    results.hidden = false; results.replaceChildren(status('Finding lexical groups…'));
    const response = await BibleRPC.searchReaderWords(query === 'ruach' ? 'H7307' : query);
    if (request !== generation) return;
    results.replaceChildren(action('Close results', dismiss, 'text-action'));
    for (const result of response.data ?? []) results.append(action(
      `${result.original_word} · ${result.transliteration} · ${result.strongs_nr} · ${result.biblical_def ?? ''}`,
      () => { dismiss(); inspect(result.id); }, 'search-result'));
    if (!response.data?.length) results.append(status(response.error ?? 'No lexical match. Try a full passage reference or a Strong’s number; concepts can also be explored in advanced research.'));
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') dismiss(); });
  const examples = el('div', 'study-examples');
  for (const p of [{ book: 1, chapter: 1, verse: 2 }, { book: 26, chapter: 37, verse: 9 }, { book: 19, chapter: 3, verse: 1 }, { book: 43, chapter: 1, verse: 1 }]) {
    examples.append(action(formatVerseRef(p), () => navigate(p), 'text-action'));
  }
  element.append(examples); return { element };
}
