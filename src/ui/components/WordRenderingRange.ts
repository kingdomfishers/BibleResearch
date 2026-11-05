// @file: src/ui/components/WordRenderingRange.ts
// @feature: verse-reader
// @tables: reader_rendering_groups
// @candidates: none
// @toc: imports | ui:range

// === @section:imports ===
import type { ReaderRendering } from '../../api/types';
import { action, el } from '../study-dom';
import type { ContextPreview } from './ContextPreview';

// === @section:ui:range ===
export function createWordRenderingRange(ranges: ReaderRendering[], preview: ContextPreview,
  onSelect: (label: string) => void) {
  const element = el('div', 'word-rendering-range'); element.dir = 'ltr'; element.lang = 'en';
  element.append(el('span', 'range-label', 'Elsewhere'));
  if (!ranges.length) { element.append(el('span', 'study-muted', 'No rendering range available')); return element; }
  for (const range of ranges) {
    const button = action(range.label, () => onSelect(range.label), 'rendering-link');
    button.setAttribute('aria-label', `${range.label}: explore ${range.verse_total} verses in this rendering group`);
    preview.attach(button, range, `Observed STEP rendering: ${range.label}. ${range.token_total} tokens in ${range.verse_total} verses across the base Strong’s group; contextual senses are not assigned.`);
    element.append(button);
  }
  return element;
}
