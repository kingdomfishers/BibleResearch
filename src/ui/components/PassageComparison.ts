// @file: src/ui/components/PassageComparison.ts
// @feature: verse-reader
// @tables: reader_english_verses | words | verses
// @candidates: none
// @toc: imports | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage } from '../../api/types';
import { action, el, heading } from '../study-dom';
import { formatVerseRef } from '../utils';

// === @section:ui:main ===
export function createPassageComparison(navigate: (p: ActivePassage) => void) {
  const element = el('section', 'passage-comparison'); element.hidden = true;
  element.setAttribute('aria-label', 'Compare passages'); let generation = 0;
  let opener: HTMLElement | null = null;
  async function open(source: ActivePassage, target: ActivePassage) {
    const request = ++generation;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const close = action('Close comparison', () => { generation++; element.hidden = true; opener?.focus(); });
    const columns = el('div', 'comparison-columns');
    element.replaceChildren(heading('READ TOGETHER', 'Compare passages'), close, columns); element.hidden = false;
    for (const p of [source, target]) {
      const column = el('article', 'comparison-passage'), text = el('p', 'comparison-english', 'Loading verse…');
      const original = el('p', 'comparison-original'); original.dir = p.book <= 39 ? 'rtl' : 'ltr';
      original.lang = p.book <= 39 ? 'he' : 'el';
      column.append(el('h3', '', formatVerseRef(p)), text, original, el('p', 'study-muted', 'World English Bible · original text: STEP Bible'), action('Open passage →', () => navigate(p)));
      columns.append(column);
      void Promise.all([BibleRPC.getReaderPassage(p), BibleRPC.getVerseWords(p.book, p.chapter, p.verse)]).then(([english, words]) => {
        if (request !== generation) return;
        text.textContent = english.data?.text ?? english.error ?? 'English text unavailable in this edition.';
        original.textContent = words.data.map(w => w.original_word).join(' ');
      });
    }
    element.scrollIntoView({ block: 'nearest' }); close.focus();
  }
  return { element, open, close: () => { generation++; element.hidden = true; } };
}
