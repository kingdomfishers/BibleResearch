// @file: src/ui/components/NoteCard.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: imports | ui:icons | ui:provenance | ui:anchors | ui:connections | ui:footer | ui:main

// === @section:imports ===
import type {
  Note,
  NoteAnchor,
  NoteBlock,
  NoteConnection,
  NoteReviewStatus,
} from '../../api/types';
import { parseMarkdown, renderMarkdown } from '../note-markdown';
import { buildNoteHash } from '../notes-state';
import { renderBlocks as defaultRenderBlocks } from './NoteBlocks';

export interface NoteCardHandlers {
  onAnchor?: (anchor: NoteAnchor) => void;
  onReview?: (noteId: string, status: NoteReviewStatus) => void;
  onEdit?: (note: Note) => void;
  onDelete?: (noteId: string) => void;
  onOpen?: (noteId: string) => void;
  renderBlocks?: (blocks: NoteBlock[], container: HTMLElement) => void;
}

// === @section:ui:icons ===
const SVG_NS = 'http://www.w3.org/2000/svg';

export function createSvgIcon(pathD: string, viewBox = '0 0 24 24'): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'note-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

export function createPersonIcon(): SVGElement {
  return createSvgIcon(
    'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'
  );
}

export function createSparkleIcon(): SVGElement {
  return createSvgIcon(
    'M12 2L9.5 8.5 3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5L12 2zm7 12l-1.25 3.25L14.5 18.5l3.25 1.25L19 23l1.25-3.25L23.5 18.5l-3.25-1.25L19 14z'
  );
}

export function directionGlyph(direction?: string): string {
  if (direction === 'directed') return '→';
  if (direction === 'bidirectional') return '↔';
  return '—';
}

// === @section:ui:provenance ===
export function createProvenanceBadge(note: Note): HTMLElement {
  const container = document.createElement('div');
  container.className = 'note-card__provenance';

  const isAi = note.author?.kind === 'ai';
  const icon = isAi ? createSparkleIcon() : createPersonIcon();
  container.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'note-card__author-label';

  const srText = document.createElement('span');
  srText.className = 'visually-hidden';

  if (isAi) {
    const model = note.author?.ai_model || 'Assistant';
    label.textContent = `AI · ${model}`;
    srText.textContent = `AI-generated note by ${model}, ${note.review_status || 'unreviewed'}`;
  } else {
    label.textContent = 'You';
    srText.textContent = 'Human note by You';
  }

  container.appendChild(label);
  container.appendChild(srText);

  if (isAi && note.review_status) {
    const reviewPill = document.createElement('span');
    reviewPill.className = `note-card__review-pill note-card__review-pill--${note.review_status}`;
    reviewPill.textContent = note.review_status;
    container.appendChild(reviewPill);
  }

  return container;
}

export function createHeader(note: Note): HTMLElement {
  const header = document.createElement('header');
  header.className = 'note-card__header';

  header.appendChild(createProvenanceBadge(note));

  const meta = document.createElement('div');
  meta.className = 'note-card__meta';

  if (note.note_kind) {
    const kindTag = document.createElement('span');
    kindTag.className = 'note-card__kind-tag';
    kindTag.textContent = note.note_kind.replace(/_/g, ' ');
    meta.appendChild(kindTag);
  }

  if (note.created_at) {
    const time = document.createElement('time');
    time.className = 'note-card__time';
    const date = new Date(note.created_at);
    time.textContent = isNaN(date.getTime()) ? '' : date.toLocaleDateString();
    meta.appendChild(time);
  }

  header.appendChild(meta);
  return header;
}

// === @section:ui:anchors ===
export function createAnchorChips(
  anchors: NoteAnchor[],
  onAnchor?: (a: NoteAnchor) => void
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'note-card__anchors';

  for (const anchor of anchors) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `note-chip note-chip--${anchor.role || 'mention'}`;
    chip.setAttribute('aria-label', `Anchor: ${anchor.label || anchor.kind}`);

    const bdi = document.createElement('bdi');
    bdi.textContent = anchor.label || anchor.kind;
    chip.appendChild(bdi);

    if (onAnchor) {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        onAnchor(anchor);
      });
    }
    list.appendChild(chip);
  }
  return list;
}

// === @section:ui:connections ===
export function createConnectionChips(
  connections: NoteConnection[],
  anchors: NoteAnchor[],
  onAnchor?: (a: NoteAnchor) => void
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'note-card__connections';

  const anchorMap = new Map<string, NoteAnchor>();
  anchors.forEach((a) => { if (a.id) anchorMap.set(a.id, a); });

  for (const conn of connections) {
    const chip = document.createElement('div');
    chip.className = 'note-connection-chip';
    chip.setAttribute('dir', 'ltr');

    const sourceAnchor = anchorMap.get(conn.from_anchor_id);
    const targetAnchor = anchorMap.get(conn.to_anchor_id);

    const sourceBtn = document.createElement('button');
    sourceBtn.type = 'button';
    sourceBtn.className = 'note-connection-chip__endpoint';
    const srcBdi = document.createElement('bdi');
    srcBdi.textContent = sourceAnchor?.label || conn.from_anchor_id || 'Source';
    sourceBtn.appendChild(srcBdi);
    if (sourceAnchor && onAnchor) {
      sourceBtn.addEventListener('click', (e) => { e.stopPropagation(); onAnchor(sourceAnchor); });
    }
    chip.appendChild(sourceBtn);

    const arrow = document.createElement('span');
    arrow.className = 'note-connection-chip__arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = directionGlyph(conn.direction);
    chip.appendChild(arrow);

    const targetBtn = document.createElement('button');
    targetBtn.type = 'button';
    targetBtn.className = 'note-connection-chip__endpoint';
    const tgtBdi = document.createElement('bdi');
    tgtBdi.textContent = targetAnchor?.label || conn.to_anchor_id || 'Target';
    targetBtn.appendChild(tgtBdi);
    if (targetAnchor && onAnchor) {
      targetBtn.addEventListener('click', (e) => { e.stopPropagation(); onAnchor(targetAnchor); });
    }
    chip.appendChild(targetBtn);

    const label = document.createElement('span');
    label.className = 'note-connection-chip__label';
    label.textContent = conn.type_label || conn.connection_type || 'related';
    chip.appendChild(label);

    if (conn.category) {
      const cat = document.createElement('span');
      cat.className = 'note-connection-chip__category';
      cat.textContent = conn.category;
      chip.appendChild(cat);
    }
    list.appendChild(chip);
  }
  return list;
}

// === @section:ui:footer ===
export function createFooter(note: Note, handlers: NoteCardHandlers): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'note-card__footer';

  if (note.author?.kind === 'ai' && handlers.onReview) {
    const reviewGroup = document.createElement('div');
    reviewGroup.className = 'note-card__review-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'note-btn note-btn--confirm';
    confirmBtn.textContent = 'Confirm';
    confirmBtn.addEventListener('click', () => handlers.onReview!(note.id, 'confirmed'));
    reviewGroup.appendChild(confirmBtn);

    const disputeBtn = document.createElement('button');
    disputeBtn.type = 'button';
    disputeBtn.className = 'note-btn note-btn--dispute';
    disputeBtn.textContent = 'Dispute';
    disputeBtn.addEventListener('click', () => handlers.onReview!(note.id, 'disputed'));
    reviewGroup.appendChild(disputeBtn);

    footer.appendChild(reviewGroup);
  }

  const actions = document.createElement('div');
  actions.className = 'note-card__actions';

  if (handlers.onEdit) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'note-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => handlers.onEdit!(note));
    actions.appendChild(editBtn);
  }

  if (handlers.onDelete) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'note-btn note-btn--delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      const confirmed = window.confirm('Are you sure you want to delete this note?');
      if (confirmed) handlers.onDelete!(note.id);
    });
    actions.appendChild(delBtn);
  }

  if (handlers.onOpen || note.id) {
    const openLink = document.createElement('a');
    openLink.className = 'note-card__open-link';
    openLink.href = buildNoteHash(note.id);
    openLink.textContent = 'Open';
    openLink.addEventListener('click', (e) => {
      if (handlers.onOpen) {
        e.preventDefault();
        handlers.onOpen(note.id);
      }
    });
    actions.appendChild(openLink);
  }

  footer.appendChild(actions);
  return footer;
}

// === @section:ui:main ===
export function createNoteCard(note: Note, handlers: NoteCardHandlers = {}): HTMLElement {
  const card = document.createElement('article');
  card.className = `note-card note-card--${note.author?.kind === 'ai' ? 'ai' : 'human'}`;
  card.id = `note-${note.id}`;

  card.appendChild(createHeader(note));

  if (note.title) {
    const title = document.createElement('h3');
    title.className = 'note-card__title';
    title.textContent = note.title;
    card.appendChild(title);
  }

  const bodyContainer = document.createElement('div');
  bodyContainer.className = 'note-card__body';
  const bodyText = note.body_md || '';
  bodyContainer.appendChild(renderMarkdown(parseMarkdown(bodyText)));
  card.appendChild(bodyContainer);

  const blocksContainer = document.createElement('div');
  blocksContainer.className = 'note-card__blocks';
  if (note.blocks && note.blocks.length > 0) {
    if (handlers.renderBlocks) {
      handlers.renderBlocks(note.blocks, blocksContainer);
    } else {
      defaultRenderBlocks(note.blocks, undefined, blocksContainer);
    }
  }
  card.appendChild(blocksContainer);

  if (note.anchors && note.anchors.length > 0) {
    card.appendChild(createAnchorChips(note.anchors, handlers.onAnchor));
  }

  if (note.connections && note.connections.length > 0) {
    card.appendChild(createConnectionChips(note.connections, note.anchors || [], handlers.onAnchor));
  }

  card.appendChild(createFooter(note, handlers));
  return card;
}
