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
  onSelect: (label: string) => void, hereLabel?: string | null) {
  const element = el('div', 'word-rendering-range'); element.dir = 'ltr'; element.lang = 'en';
  const hereNorm = (hereLabel ?? '').replaceAll('/', ' ').trim().toLowerCase();
  const seen = new Set<string>(hereNorm ? [hereNorm] : []);
  const distinct: ReaderRendering[] = [];
  for (const range of ranges) {
    const clean = range.label.trim();
    const norm = clean.toLowerCase();
    if (!clean || seen.has(norm)) continue;
    seen.add(norm);
    distinct.push(range);
  }
  if (!distinct.length) return element;
  element.append(el('span', 'range-label', 'Also:'));
  distinct.slice(0, 3).forEach((range, index) => {
    if (index > 0) {
      const sep = el('span', 'range-dot', '·');
      sep.setAttribute('aria-hidden', 'true');
      element.append(sep);
    }
    const button = action(range.label, () => onSelect(range.label), 'rendering-link');
    button.setAttribute('aria-label', `${range.label}: explore ${range.verse_total} verses in this rendering group`);
    preview.attach(button, range, `Observed STEP rendering: ${range.label}. ${range.token_total} tokens in ${range.verse_total} verses across the base Strong’s group; contextual senses are not assigned.`);
    element.append(button);
  });
  if (distinct.length > 3) {
    const more = action(`+${distinct.length - 3}`, () => onSelect(distinct[3]!.label), 'rendering-link rendering-link--more');
    more.title = 'Inspect all observed renderings';
    element.append(more);
  }
  return element;
}
