// @file: src/ui/components/WordHoverPreview.ts
// @feature: verse-reader
// @tables: none
// @candidates: none
// @toc: imports | types | ui:main | logic:attach

// === @section:imports ===
import type { ReaderOverview, VerseTranslationToken } from '../../api/types';
import { el } from '../study-dom';
import { translationLabel } from './TranslationChoice';

// === @section:types ===
export interface WordHoverPreview {
  element: HTMLElement;
  attach: (
    target: HTMLElement,
    getContext: () => { token: VerseTranslationToken; overview: ReaderOverview | null }
  ) => void;
  dismiss: () => void;
}

// === @section:ui:main ===
export function createWordHoverPreview(): WordHoverPreview {
  const element = el('div', 'word-hover-preview');
  element.id = 'study-word-preview';
  element.setAttribute('role', 'tooltip');
  element.style.pointerEvents = 'none';
  element.hidden = true;

  let dwellTimer = 0;
  let closeTimer = 0;
  let activeTarget: HTMLElement | null = null;

  const cancelClose = () => {
    clearTimeout(closeTimer);
  };
  const dismiss = () => {
    clearTimeout(dwellTimer);
    clearTimeout(closeTimer);
    activeTarget = null;
    element.hidden = true;
  };

  element.addEventListener('pointerenter', cancelClose);
  element.addEventListener('pointerleave', () => {
    closeTimer = window.setTimeout(dismiss, 160);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') dismiss();
  });

  function positionNear(target: HTMLElement) {
    const bounds = target.getBoundingClientRect();
    const maxLeft = Math.max(12, window.innerWidth - 332);
    const left = Math.max(12, Math.min(bounds.left, maxLeft));
    const top = bounds.bottom + 8;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function show(target: HTMLElement, token: VerseTranslationToken, overview: ReaderOverview | null) {
    activeTarget = target;
    const hereText = translationLabel(
      token.selected_english ?? token.source_english ?? token.primary_english ?? '',
      token.grammar_code
    );

    const header = el('div', 'word-hover-preview__head');
    const title = el('strong', 'word-hover-preview__english', hereText);
    const translit = el('span', 'word-hover-preview__translit', token.transliteration);
    const original = el('span', 'word-hover-preview__script', token.original_word);
    original.dir = token.strongs_nr.startsWith('H') ? 'rtl' : 'ltr';
    original.lang = token.strongs_nr.startsWith('H') ? 'he' : 'el';
    header.append(title, translit, original);

    const hereLine = el('p', 'word-hover-preview__here', `Here: ${hereText}`);

    const ranges = overview?.ranges?.[token.strongs_nr] ?? [];
    const seen = new Set<string>([hereText.toLowerCase()]);
    const alsoItems: string[] = [];
    for (const r of ranges) {
      const clean = r.label.trim();
      const norm = clean.toLowerCase();
      if (!clean || seen.has(norm)) continue;
      seen.add(norm);
      alsoItems.push(`${clean} (${r.verse_total})`);
      if (alsoItems.length >= 3) break;
    }

    const nodes: HTMLElement[] = [header, hereLine];
    if (alsoItems.length) {
      nodes.push(el('p', 'word-hover-preview__also', `Also: ${alsoItems.join(' · ')}`));
    }

    const grammarMap = overview?.grammar?.[token.word_position];
    if (grammarMap) {
      const parts = Object.entries(grammarMap)
        .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
        .map(([, value]) => String(value).trim())
        .slice(0, 4);
      if (parts.length) {
        nodes.push(el('p', 'word-hover-preview__grammar', parts.join(' · ')));
      }
    }

    nodes.push(el('p', 'word-hover-preview__hint', 'Click word to inspect roots & connections'));
    element.replaceChildren(...nodes);
    element.hidden = false;
    positionNear(target);

    const rect = element.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 12) {
      const bounds = target.getBoundingClientRect();
      element.style.top = `${Math.max(12, bounds.top - rect.height - 8)}px`;
    }
  }

  // === @section:logic:attach ===
  function attach(
    target: HTMLElement,
    getContext: () => { token: VerseTranslationToken; overview: ReaderOverview | null }
  ) {
    target.setAttribute('aria-describedby', element.id);
    target.addEventListener('pointerdown', dismiss);
    target.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      clearTimeout(dwellTimer);
      cancelClose();
      dwellTimer = window.setTimeout(() => {
        const ctx = getContext();
        show(target, ctx.token, ctx.overview);
      }, 200);
    });
    target.addEventListener('focusin', () => {
      if (!target.matches(':focus-visible')) return;
      cancelClose();
      const ctx = getContext();
      show(target, ctx.token, ctx.overview);
    });
    target.addEventListener('pointerleave', () => {
      clearTimeout(dwellTimer);
      if (activeTarget === target) closeTimer = window.setTimeout(dismiss, 160);
    });
    target.addEventListener('focusout', () => {
      if (activeTarget === target) closeTimer = window.setTimeout(dismiss, 140);
    });
  }

  return { element, attach, dismiss };
}
