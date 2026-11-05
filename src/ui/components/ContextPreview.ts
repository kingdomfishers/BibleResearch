// @file: src/ui/components/ContextPreview.ts
// @feature: verse-reader
// @tables: reader_english_verses
// @candidates: none
// @toc: imports | types | ui:main | logic:preview | logic:attach | logic:detail

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage } from '../../api/types';
import { formatVerseRef } from '../utils';
import { action, el, status } from '../study-dom';

// === @section:types ===
export interface ContextPreview {
  element: HTMLElement;
  attach: (target: HTMLElement, passage: ActivePassage, reason: string) => void;
  pin: (passage: ActivePassage, reason?: string) => void;
  dismiss: () => void;
}

// === @section:ui:main ===
export function createContextPreview(navigate: (p: ActivePassage) => void, compare: (p: ActivePassage) => void): ContextPreview {
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
  async function show(target: HTMLElement, passage: ActivePassage, reason: string) {
    const current = ++generation;
    tooltip.replaceChildren(el('strong', '', formatVerseRef(passage)), status('Loading English verse…'));
    tooltip.hidden = false;
    const bounds = target.getBoundingClientRect();
    tooltip.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - 390))}px`;
    tooltip.style.top = `${Math.min(bounds.bottom + 9, Math.max(12, window.innerHeight - 310))}px`;
    const result = await BibleRPC.getReaderPassage(passage);
    if (generation !== current || tooltip.hidden) return;
    tooltip.replaceChildren(el('strong', '', formatVerseRef(passage)),
      el('p', 'preview-verse', result.data?.text ?? result.error ?? 'English text unavailable in this edition.'),
      el('p', 'study-muted', 'World English Bible · separate English edition'), el('p', 'preview-reason', reason));
    const rect = tooltip.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 12) tooltip.style.top = `${Math.max(12, window.innerHeight - rect.height - 12)}px`;
  }

  // === @section:logic:attach ===
  function attach(target: HTMLElement, passage: ActivePassage, reason: string) {
    target.setAttribute('aria-describedby', tooltip.id);
    target.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      clearTimeout(timer); cancelClose(); timer = window.setTimeout(() => { void show(target, passage, reason); }, 240);
    });
    target.addEventListener('focus', () => { cancelClose(); void show(target, passage, reason); });
    target.addEventListener('pointerleave', () => { clearTimeout(timer); closer = window.setTimeout(hide, 180); });
    target.addEventListener('blur', () => { closer = window.setTimeout(hide, 180); });
  }

  // === @section:logic:detail ===
  async function pin(passage: ActivePassage, reason = 'Read this passage without leaving your place.') {
    hide(); const current = generation;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const close = action('Close preview', () => detail.close(), 'study-button sheet-close');
    const verse = el('p', 'preview-verse', 'Loading English verse…');
    const buttons = el('div', 'study-actions');
    buttons.append(action('Compare passages', () => { detail.close(); compare(passage); }),
      action('Open passage →', () => { detail.close(); navigate(passage); }, 'study-button primary'));
    detail.replaceChildren(close, el('p', 'eyebrow', 'PASSAGE PREVIEW'), el('h2', '', formatVerseRef(passage)),
      verse, el('p', 'study-muted', 'World English Bible'), el('p', 'preview-reason', reason), buttons);
    if (!detail.open) detail.show(); close.focus();
    const result = await BibleRPC.getReaderPassage(passage);
    if (generation === current && detail.open) verse.textContent = result.data?.text ?? result.error ?? 'English text unavailable in this edition.';
  }
  return { element, attach, pin: (p, reason) => { void pin(p, reason); }, dismiss: () => { hide(); if (detail.open) detail.close(); } };
}
