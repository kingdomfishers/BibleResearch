// @file: src/ui/drag-controller.ts
// @feature: exploration-state
// @tables: none
// @candidates: none
// @toc: imports | types | logic:helpers | logic:controller

// === @section:imports ===
import type { ActivePassage } from '../api/types';
import { explorationState, type PinnedPassage } from './exploration-state';
import { action, el } from './study-dom';
import { formatVerseRef } from './utils';

// === @section:types ===
export interface DragAnchorPayload {
  kind: 'verse' | 'occurrence' | 'edge';
  passage: ActivePassage;
  label: string;
  wordPosition?: number;
  strongs?: string;
  original?: string;
}

export interface DragControllerCallbacks {
  getCurrentPassage: () => ActivePassage;
  onDropPinA: (payload: DragAnchorPayload) => void;
  onDropCompareB: (payload: DragAnchorPayload) => void;
  onDropQuickNote: (payload: DragAnchorPayload) => void;
  onUndoPins?: (prevPins: { a: PinnedPassage | null; b: PinnedPassage | null }) => void;
}

export interface DragControllerHandle {
  registerHandle: (target: HTMLElement, getPayload: () => DragAnchorPayload) => () => void;
  destroy: () => void;
}

type DropZoneId = 'pin-a' | 'compare-b' | 'quick-note';

interface DragSession {
  pointerId: number;
  pointerType: string;
  target: HTMLElement;
  getPayload: () => DragAnchorPayload;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  active: boolean;
  payload: DragAnchorPayload | null;
  holdTimer: number;
  hoveredZone: DropZoneId | null;
}

// === @section:logic:helpers ===
const MOUSE_DRAG_THRESHOLD_PX = 8;
const TOUCH_HOLD_DELAY_MS = 350;
const TOUCH_MOVE_TOLERANCE_PX = 10;
const UNDO_TOAST_DURATION_MS = 5000;

function clonePins(pins: { a: PinnedPassage | null; b: PinnedPassage | null }): {
  a: PinnedPassage | null;
  b: PinnedPassage | null;
} {
  return {
    a: pins.a ? { ...pins.a, passage: { ...pins.a.passage } } : null,
    b: pins.b ? { ...pins.b, passage: { ...pins.b.passage } } : null,
  };
}

function restoreExplorationPins(prevPins: { a: PinnedPassage | null; b: PinnedPassage | null }): void {
  if (prevPins.a) {
    explorationState.pinPassage('a', prevPins.a.passage, prevPins.a.label, prevPins.a.wordPosition);
  } else {
    explorationState.unpinPassage('a');
  }
  if (prevPins.b) {
    explorationState.pinPassage('b', prevPins.b.passage, prevPins.b.label, prevPins.b.wordPosition);
  } else {
    explorationState.unpinPassage('b');
  }
}

function isInteractiveOrigin(target: HTMLElement, eventTarget: EventTarget | null): boolean {
  const origin = eventTarget instanceof Element ? eventTarget : null;
  const interactive = origin?.closest('input, select, textarea, button');
  if (!interactive) return false;
  if (interactive.getAttribute('data-drag-handle') === 'true') return false;
  if (interactive === target && target.getAttribute('data-drag-handle') === 'true') return false;
  return true;
}

// === @section:logic:controller ===
export function createDragController(callbacks: DragControllerCallbacks): DragControllerHandle {
  const overlay = el('div', 'drag-drop-overlay');
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');

  const pinAZone = el('div', 'drag-drop-zone drag-drop-zone--pin-a');
  pinAZone.dataset.zone = 'pin-a';
  pinAZone.append(
    el('strong', 'drag-drop-zone__title', 'Pin as A'),
    el('span', 'drag-drop-zone__hint', 'Anchor primary slot')
  );

  const compareBZone = el('div', 'drag-drop-zone drag-drop-zone--compare-b');
  compareBZone.dataset.zone = 'compare-b';
  const comparePreview = el('span', 'drag-drop-zone__preview', '');
  compareBZone.append(
    el('strong', 'drag-drop-zone__title', 'Compare as B'),
    comparePreview
  );

  const quickNoteZone = el('div', 'drag-drop-zone drag-drop-zone--quick-note');
  quickNoteZone.dataset.zone = 'quick-note';
  quickNoteZone.append(
    el('strong', 'drag-drop-zone__title', '+ Quick Note / Hypothesis'),
    el('span', 'drag-drop-zone__hint', 'Record connection hypothesis')
  );

  overlay.append(pinAZone, compareBZone, quickNoteZone);

  const zoneEntries: Array<{ id: DropZoneId; node: HTMLElement }> = [
    { id: 'pin-a', node: pinAZone },
    { id: 'compare-b', node: compareBZone },
    { id: 'quick-note', node: quickNoteZone },
  ];

  const ghost = el('div', 'drag-ghost');
  ghost.hidden = true;
  ghost.setAttribute('aria-hidden', 'true');
  const ghostLabel = el('span', 'drag-ghost__label');
  const ghostOriginal = el('span', 'drag-ghost__original');
  ghost.append(ghostLabel, ghostOriginal);

  const toast = el('div', 'drag-undo-toast');
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const cleanups = new Set<() => void>();
  let session: DragSession | null = null;
  let rafId = 0;
  let toastTimer = 0;
  let destroyed = false;

  function ensureMounted(): void {
    if (destroyed || !document.body) return;
    if (!overlay.isConnected) document.body.appendChild(overlay);
    if (!ghost.isConnected) document.body.appendChild(ghost);
    if (!toast.isConnected) document.body.appendChild(toast);
  }

  function hideToast(): void {
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = 0;
    }
    toast.hidden = true;
    toast.replaceChildren();
  }

  function showUndoToast(label: string, prevPins: { a: PinnedPassage | null; b: PinnedPassage | null }): void {
    if (destroyed) return;
    ensureMounted();
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = 0;
    }
    const undoBtn = action(
      `Pinned ${label} · Undo`,
      () => {
        hideToast();
        if (callbacks.onUndoPins) {
          callbacks.onUndoPins(prevPins);
        } else {
          restoreExplorationPins(prevPins);
        }
      },
      'drag-undo-toast__btn'
    );
    toast.replaceChildren(undoBtn);
    toast.hidden = false;
    toastTimer = window.setTimeout(hideToast, UNDO_TOAST_DURATION_MS);
  }

  function setHoveredZone(nextZone: DropZoneId | null): void {
    if (session) session.hoveredZone = nextZone;
    for (const entry of zoneEntries) {
      entry.node.classList.toggle('is-over', entry.id === nextZone);
    }
  }

  function hitTestZone(clientX: number, clientY: number): DropZoneId | null {
    for (const entry of zoneEntries) {
      const rect = entry.node.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return entry.id;
      }
    }
    return null;
  }

  function positionGhost(x: number, y: number): void {
    const clampedX = Math.max(8, Math.min(window.innerWidth - 24, x + 14));
    const clampedY = Math.max(8, Math.min(window.innerHeight - 24, y + 14));
    ghost.style.left = `${Math.round(clampedX)}px`;
    ghost.style.top = `${Math.round(clampedY)}px`;
  }

  function scheduleGhostFrame(): void {
    if (rafId || !session?.active) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      if (!session?.active) return;
      positionGhost(session.lastX, session.lastY);
    });
  }

  function detachWindowListeners(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('blur', onWindowBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  function cleanupSession(): void {
    const activeSession = session;
    session = null;
    if (activeSession?.holdTimer) {
      window.clearTimeout(activeSession.holdTimer);
    }
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    detachWindowListeners();
    if (activeSession?.active) {
      try {
        if (activeSession.target.hasPointerCapture(activeSession.pointerId)) {
          activeSession.target.releasePointerCapture(activeSession.pointerId);
        }
      } catch {
        /* Target may be detached or pointer already released. */
      }
    }
    document.body?.classList.remove('is-dragging-anchor');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    ghost.hidden = true;
    setHoveredZone(null);
  }

  function cancelDrag(): void {
    if (!session) return;
    cleanupSession();
  }

  function activateDrag(current: DragSession): void {
    if (destroyed || session !== current || current.active) return;
    const payload = current.getPayload();
    current.active = true;
    current.payload = payload;

    ensureMounted();
    try {
      current.target.setPointerCapture(current.pointerId);
    } catch {
      /* Synthetic or already-ended pointers may reject capture. */
    }

    window.getSelection()?.removeAllRanges();
    document.body?.classList.add('is-dragging-anchor');

    comparePreview.textContent = `Compare ${payload.label} with ${formatVerseRef(callbacks.getCurrentPassage())}`;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');

    ghostLabel.textContent = payload.label;
    ghostOriginal.textContent = payload.original ?? '';
    ghostOriginal.hidden = !payload.original;
    ghost.hidden = false;
    positionGhost(current.lastX, current.lastY);
    scheduleGhostFrame();

    setHoveredZone(hitTestZone(current.lastX, current.lastY));
  }

  function onPointerMove(event: PointerEvent): void {
    if (!session || event.pointerId !== session.pointerId) return;
    session.lastX = event.clientX;
    session.lastY = event.clientY;

    if (!session.active) {
      const dist = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (session.pointerType === 'touch') {
        if (dist > TOUCH_MOVE_TOLERANCE_PX) {
          cancelDrag();
        }
      } else if (dist >= MOUSE_DRAG_THRESHOLD_PX) {
        activateDrag(session);
      }
      return;
    }

    setHoveredZone(hitTestZone(event.clientX, event.clientY));
    scheduleGhostFrame();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!session || event.pointerId !== session.pointerId) return;
    if (!session.active || !session.payload) {
      cleanupSession();
      return;
    }

    const payload = session.payload;
    const droppedZone = hitTestZone(event.clientX, event.clientY);
    cleanupSession();

    if (!droppedZone) return;

    const prevPins = clonePins(explorationState.getSnapshot().pins);
    if (droppedZone === 'pin-a') {
      callbacks.onDropPinA(payload);
      showUndoToast(payload.label, prevPins);
    } else if (droppedZone === 'compare-b') {
      callbacks.onDropCompareB(payload);
      showUndoToast(payload.label, prevPins);
    } else if (droppedZone === 'quick-note') {
      callbacks.onDropQuickNote(payload);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!session || event.pointerId !== session.pointerId) return;
    cancelDrag();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && session) {
      cancelDrag();
    }
  }

  function onScroll(): void {
    if (session) cancelDrag();
  }

  function onWindowBlur(): void {
    if (session) cancelDrag();
  }

  function onVisibilityChange(): void {
    if (session) cancelDrag();
  }

  function attachWindowListeners(): void {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function registerHandle(target: HTMLElement, getPayload: () => DragAnchorPayload): () => void {
    if (destroyed) return () => {};

    const onPointerDown = (event: PointerEvent) => {
      if (destroyed) return;
      if (!event.isPrimary) {
        cancelDrag();
        return;
      }
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (isInteractiveOrigin(target, event.target)) return;

      cancelDrag();

      const nextSession: DragSession = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        target,
        getPayload,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        active: false,
        payload: null,
        holdTimer: 0,
        hoveredZone: null,
      };
      session = nextSession;
      attachWindowListeners();

      if (event.pointerType === 'touch') {
        nextSession.holdTimer = window.setTimeout(() => {
          if (destroyed || session !== nextSession || nextSession.active) return;
          const dist = Math.hypot(nextSession.lastX - nextSession.startX, nextSession.lastY - nextSession.startY);
          if (dist <= TOUCH_MOVE_TOLERANCE_PX) {
            activateDrag(nextSession);
          } else {
            cancelDrag();
          }
        }, TOUCH_HOLD_DELAY_MS);
      }
    };

    target.addEventListener('pointerdown', onPointerDown);

    let unregistered = false;
    const unregister = () => {
      if (unregistered) return;
      unregistered = true;
      target.removeEventListener('pointerdown', onPointerDown);
      cleanups.delete(unregister);
      if (session?.target === target) {
        cancelDrag();
      }
    };
    cleanups.add(unregister);
    return unregister;
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    cancelDrag();
    hideToast();
    for (const unregister of [...cleanups]) {
      unregister();
    }
    cleanups.clear();
    overlay.remove();
    ghost.remove();
    toast.remove();
  }

  return {
    registerHandle,
    destroy,
  };
}
