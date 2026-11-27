// @file: src/ui/components/ContextPreview.ts
// @feature: verse-reader
// @tables: reader_english_verses
// @candidates: none
// @toc: imports | types | ui:main | logic:preview | logic:attach | logic:detail

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage } from '../../api/types';
import { explorationState } from '../exploration-state';
import { formatVerseRef } from '../utils';
import { action, el, status } from '../study-dom';

// === @section:types ===
export interface ContextPreviewOptions {
  onPinA?: (p: ActivePassage) => void;
  onQuickNote?: (p: ActivePassage) => void;
}

export interface ContextPreview {
  element: HTMLElement;
  attach: (target: HTMLElement, passage: ActivePassage, reason: string, endVerse?: number) => void;
  pin: (passage: ActivePassage, reason?: string, endVerse?: number) => void;
  dismiss: () => void;
}

function formatRangeHeader(passage: ActivePassage, endVerse?: number): string {
  const base = formatVerseRef(passage);
  return endVerse && endVerse > passage.verse ? `${base}–${endVerse}` : base;
}

// === @section:ui:main ===
export function createContextPreview(
  navigate: (p: ActivePassage) => void,
  compare: (p: ActivePassage) => void,
  opts?: ContextPreviewOptions,
): ContextPreview {
  const element = el('div', 'context-preview-root');
  const tooltip = el('div', 'context-preview'); tooltip.id = 'study-verse-preview';
  tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true;
  const detail = el('dialog', 'study-preview-sheet'); detail.setAttribute('aria-label', 'Passage preview');
  element.append(tooltip, detail);
  let timer = 0, closer = 0, generation = 0;
  let opener: HTMLElement | null = null;
  const cancelClose = () => { clearTimeout(closer); };
  const hide = () => { clearTimeout(timer); cancelClose(); generation++; tooltip.hidden = true; };
  tooltip.addEventListener('pointerenter', cancelClose);
  tooltip.addEventListener('pointerleave', () => { closer = window.setTimeout(hide, 180); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  detail.addEventListener('close', () => opener?.focus());

  // === @section:logic:preview ===
  async function show(target: HTMLElement, passage: ActivePassage, reason: string, endVerse?: number) {
    const current = ++generation;
    const headerText = formatRangeHeader(passage, endVerse);
    const hasRange = Boolean(endVerse && endVerse > passage.verse);
    tooltip.replaceChildren(el('strong', '', headerText), status('Loading English verse…'));
    tooltip.hidden = false;
    const bounds = target.getBoundingClientRect();
    tooltip.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - 390))}px`;
    tooltip.style.top = `${Math.min(bounds.bottom + 9, Math.max(12, window.innerHeight - 310))}px`;
    const result = await BibleRPC.getReaderPassage(passage);
    if (generation !== current || tooltip.hidden) return;
    const nodes: HTMLElement[] = [
      el('strong', '', headerText),
      el('p', 'preview-verse', result.data?.text ?? result.error ?? 'English text unavailable in this edition.'),
    ];
    if (hasRange) {
      nodes.push(el('p', 'study-muted preview-range-note', 'Showing first verse of range · click to expand full range'));
    }
    nodes.push(
      el('p', 'study-muted', 'World English Bible · separate English edition'),
      el('p', 'preview-reason', reason),
    );
    tooltip.replaceChildren(...nodes);
    const rect = tooltip.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 12) tooltip.style.top = `${Math.max(12, window.innerHeight - rect.height - 12)}px`;
  }

  // === @section:logic:attach ===
  function attach(target: HTMLElement, passage: ActivePassage, reason: string, endVerse?: number) {
    target.setAttribute('aria-describedby', tooltip.id);
    target.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      clearTimeout(timer); cancelClose();
      timer = window.setTimeout(() => { void show(target, passage, reason, endVerse); }, 240);
    });
    target.addEventListener('focus', () => { cancelClose(); void show(target, passage, reason, endVerse); });
    target.addEventListener('pointerleave', () => { clearTimeout(timer); closer = window.setTimeout(hide, 180); });
    target.addEventListener('blur', () => { closer = window.setTimeout(hide, 180); });
  }

  // === @section:logic:detail ===
  async function pin(passage: ActivePassage, reason = 'Read this passage without leaving your place.', endVerse?: number) {
    hide(); const current = generation;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const close = action('Close preview', () => detail.close(), 'study-button sheet-close');
    const headerText = formatRangeHeader(passage, endVerse);
    const hasRange = Boolean(endVerse && endVerse > passage.verse);
    const verse = el('p', 'preview-verse', 'Loading English verse…');
    const rangeMount = el('div', 'preview-range-mount');
    const buttons = el('div', 'study-actions');

    if (hasRange && endVerse) {
      const expandBtn = action('Expand full range', async () => {
        expandBtn.disabled = true;
        expandBtn.textContent = 'Loading range…';
        const cappedEnd = Math.min(endVerse, passage.verse + 11);
        const refs: ActivePassage[] = [];
        for (let v = passage.verse; v <= cappedEnd; v += 1) {
          refs.push({ book: passage.book, chapter: passage.chapter, verse: v });
        }
        const loaded = await BibleRPC.preloadReaderPassages(refs);
        if (generation !== current || !detail.open) return;
        const byVerse = new Map(loaded.map(item => [item.passage.verse, item]));
        const rangeList = el('div', 'preview-range-list');
        for (const ref of refs) {
          const item = byVerse.get(ref.verse);
          const row = el('p', 'preview-range-item');
          row.style.margin = '8px 0';
          row.style.lineHeight = '1.6';
          const num = el('strong', 'preview-range-num', `${ref.verse} `);
          const txt = el('span', 'preview-range-text', item?.text ?? 'English text unavailable in this edition.');
          row.append(num, txt);
          rangeList.append(row);
        }
        if (endVerse > cappedEnd) {
          rangeList.append(el('p', 'study-muted', `Showing verses ${passage.verse}–${cappedEnd} of ${endVerse}. Open passage to read further.`));
        }
        verse.hidden = true;
        rangeMount.replaceChildren(rangeList);
        expandBtn.remove();
      }, 'study-button preview-expand-btn');
      buttons.append(expandBtn);
    }

    const pinABtn = action('Pin as A', () => {
      if (opts?.onPinA) {
        opts.onPinA(passage);
      } else {
        explorationState.pinPassage('a', passage);
      }
      pinABtn.textContent = 'Pinned as A ✓';
      pinABtn.disabled = true;
    }, 'study-button');

    buttons.append(
      pinABtn,
      action('Pin B & Compare', () => { detail.close(); compare(passage); }, 'study-button'),
      action('Open passage →', () => { detail.close(); navigate(passage); }, 'study-button primary'),
    );

    if (opts?.onQuickNote) {
      const onQuickNote = opts.onQuickNote;
      buttons.append(action('+ Note', () => { detail.close(); onQuickNote(passage); }, 'study-button'));
    }

    detail.replaceChildren(
      close,
      el('p', 'eyebrow', 'PASSAGE PREVIEW'),
      el('h2', '', headerText),
      verse,
      rangeMount,
      el('p', 'study-muted', 'World English Bible'),
      el('p', 'preview-reason', reason),
      buttons,
    );
    if (!detail.open) detail.show();
    close.focus();
    const result = await BibleRPC.getReaderPassage(passage);
    if (generation === current && detail.open) {
      verse.textContent = result.data?.text ?? result.error ?? 'English text unavailable in this edition.';
    }
  }

  return {
    element,
    attach,
    pin: (p, reason, endVerse) => { void pin(p, reason, endVerse); },
    dismiss: () => { hide(); if (detail.open) detail.close(); },
  };
}
