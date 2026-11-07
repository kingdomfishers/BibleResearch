// @file: src/ui/components/NoteBlocks.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: imports | ui:helpers | ui:renderers | ui:main

// === @section:imports ===
import type { NoteBlock } from '../../api/types';
import { parseMarkdown, renderMarkdown } from '../note-markdown';

export interface NoteBlocksOptions {
  onElementActivate?: (blockId: string, elementRef: string) => void;
}

type BlockRenderer = (
  content: unknown,
  textAlt: string,
  block: NoteBlock,
  options?: NoteBlocksOptions
) => HTMLElement;

// === @section:ui:helpers ===
export function isSafeHttps(url: unknown): boolean {
  return typeof url === 'string' && /^https:\/\/[^\s<>'"]+$/i.test(url.trim());
}

export function renderPlaceholder(type: string, textAlt: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'note-block note-block--placeholder';

  const title = document.createElement('div');
  title.className = 'note-block__placeholder-title';
  title.textContent = `‹${type}› content can't be displayed yet`;
  container.appendChild(title);

  if (textAlt && textAlt.trim()) {
    const alt = document.createElement('div');
    alt.className = 'note-block__text-alt';
    alt.textContent = textAlt.trim();
    container.appendChild(alt);
  }
  return container;
}

export function renderMarkdownBlock(content: unknown, textAlt: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'note-block note-block--markdown';
  const text =
    content &&
    typeof content === 'object' &&
    'markdown' in content &&
    typeof (content as { markdown: unknown }).markdown === 'string'
      ? (content as { markdown: string }).markdown
      : textAlt;
  container.appendChild(renderMarkdown(parseMarkdown(text || '')));
  return container;
}

// === @section:ui:renderers ===
export function renderLinkBlock(content: unknown, textAlt: string): HTMLElement {
  if (!content || typeof content !== 'object') {
    return renderPlaceholder('link', textAlt);
  }
  const c = content as { url?: unknown; title?: unknown };
  if (!isSafeHttps(c.url)) {
    return renderPlaceholder('link', textAlt);
  }
  const safeUrl = (c.url as string).trim();
  let host = '';
  try {
    host = new URL(safeUrl).hostname;
  } catch {
    return renderPlaceholder('link', textAlt);
  }

  const container = document.createElement('div');
  container.className = 'note-block note-block--link';

  const a = document.createElement('a');
  a.href = safeUrl;
  a.target = '_blank';
  a.rel = 'noopener noreferrer nofollow';
  a.className = 'note-block__link';

  const titleEl = document.createElement('span');
  titleEl.className = 'note-block__link-title';
  titleEl.textContent = typeof c.title === 'string' && c.title.trim() ? c.title.trim() : safeUrl;
  a.appendChild(titleEl);

  const hostEl = document.createElement('span');
  hostEl.className = 'note-block__link-host';
  hostEl.textContent = host;
  a.appendChild(hostEl);

  container.appendChild(a);
  return container;
}

export function renderImageBlock(content: unknown, textAlt: string): HTMLElement {
  if (!content || typeof content !== 'object') {
    return renderPlaceholder('image', textAlt);
  }
  const c = content as { url?: unknown; alt?: unknown };
  if (!isSafeHttps(c.url)) {
    return renderPlaceholder('image', textAlt);
  }
  const safeUrl = (c.url as string).trim();
  const altText = typeof c.alt === 'string' ? c.alt : textAlt || '';

  const container = document.createElement('div');
  container.className = 'note-block note-block--image';

  const img = document.createElement('img');
  img.src = safeUrl;
  img.alt = altText;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.className = 'note-block__img';

  img.addEventListener('error', () => {
    container.replaceChildren(renderPlaceholder('image', textAlt || altText));
  });

  container.appendChild(img);
  return container;
}

const renderers: Record<string, BlockRenderer> = {
  markdown: (c, t) => renderMarkdownBlock(c, t),
  link: (c, t) => renderLinkBlock(c, t),
  image: (c, t) => renderImageBlock(c, t),
};

// === @section:ui:main ===
export function renderBlocks(
  blocks: NoteBlock[],
  options?: NoteBlocksOptions,
  targetContainer?: HTMLElement
): HTMLElement {
  const container = targetContainer || document.createElement('div');
  container.className = 'note-blocks';

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return container;
  }

  const sorted = [...blocks].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));

  for (const block of sorted) {
    if (!block || typeof block !== 'object') continue;
    const type = block.block_type || 'unknown';
    const renderer = renderers[type];
    const textAlt = block.text_alternative || '';

    let blockElement: HTMLElement;
    try {
      blockElement = renderer
        ? renderer(block.content, textAlt, block, options)
        : renderPlaceholder(type, textAlt);
    } catch {
      blockElement = renderPlaceholder(type, textAlt);
    }

    if (block.id) {
      blockElement.dataset.blockId = block.id;
    }
    container.appendChild(blockElement);
  }

  return container;
}
