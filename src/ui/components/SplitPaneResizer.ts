// @file: src/ui/components/SplitPaneResizer.ts
// @feature: app-shell
// @tables: none
// @candidates: none
// @toc: imports | types | ui:main

// === @section:imports ===
import { el } from '../study-dom';

// === @section:types ===
export interface SplitPaneResizerOptions {
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  storageKey?: string;
  minMainWidth?: number;
}

export interface SplitPaneResizerHandle {
  element: HTMLDivElement;
  getWidth(): number;
  setWidth(width: number): void;
  reset(): void;
  destroy(): void;
}

// === @section:ui:main ===
export function createSplitPaneResizer(
  targetContainer: HTMLElement,
  options: SplitPaneResizerOptions = {},
): SplitPaneResizerHandle {
  const minWidth = options.minWidth ?? 300;
  const maxWidth = options.maxWidth ?? 680;
  const defaultWidth = options.defaultWidth ?? 410;
  const storageKey = options.storageKey ?? 'br-inspector-width';
  const minMainWidth = options.minMainWidth ?? 380;

  const getEffectiveMax = (): number => {
    if (targetContainer.clientWidth > 0) {
      return Math.max(minWidth, Math.min(maxWidth, targetContainer.clientWidth - minMainWidth));
    }
    return Math.max(minWidth, maxWidth);
  };

  const clampWidth = (raw: number): number => {
    const effectiveMax = getEffectiveMax();
    const numeric = Number.isFinite(raw) ? raw : defaultWidth;
    return Math.round(Math.min(effectiveMax, Math.max(minWidth, numeric)));
  };

  const readStoredWidth = (): number => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null && saved.trim() !== '') {
        const parsed = Number(saved);
        if (Number.isFinite(parsed)) return parsed;
      }
    } catch {
      // Continue with default width when localStorage is unavailable.
    }
    return defaultWidth;
  };

  const saveWidth = (width: number): void => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      // Ignore storage failures in restricted browsing contexts.
    }
  };

  const element = el('div', 'workspace-resizer');
  element.setAttribute('role', 'separator');
  element.setAttribute('aria-orientation', 'vertical');
  element.setAttribute('aria-label', 'Resize inspector pane');
  element.tabIndex = 0;
  element.setAttribute('aria-valuemin', String(minWidth));
  element.title = 'Drag to resize inspector · Double-click to reset';

  const grip = el('span', 'workspace-resizer-grip');
  grip.setAttribute('aria-hidden', 'true');
  element.append(grip);

  let currentWidth = clampWidth(readStoredWidth());

  const applyWidth = (raw: number, persist: boolean): number => {
    const effectiveMax = getEffectiveMax();
    currentWidth = clampWidth(raw);
    targetContainer.style.setProperty('--inspector-width', `${currentWidth}px`);
    element.setAttribute('aria-valuemax', String(effectiveMax));
    element.setAttribute('aria-valuenow', String(currentWidth));
    if (persist) saveWidth(currentWidth);
    return currentWidth;
  };

  applyWidth(currentWidth, false);

  let activePointerId: number | null = null;
  let isDragging = false;

  const stopDrag = (persist: boolean): void => {
    if (!isDragging) return;
    isDragging = false;
    if (activePointerId !== null) {
      try {
        if (element.hasPointerCapture?.(activePointerId)) {
          element.releasePointerCapture(activePointerId);
        }
      } catch {
        // Ignore if pointer capture was already released.
      }
      activePointerId = null;
    }
    element.classList.remove('is-dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (persist) saveWidth(currentWidth);
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    isDragging = true;
    try {
      element.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic events in tests may not support pointer capture.
    }
    element.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!isDragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    const nextWidth = targetContainer.getBoundingClientRect().right - e.clientX;
    applyWidth(nextWidth, false);
  };

  const onPointerEnd = (e: PointerEvent): void => {
    if (!isDragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    stopDrag(true);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 40 : 16;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      applyWidth(currentWidth + step, true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      applyWidth(currentWidth - step, true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      applyWidth(minWidth, true);
    } else if (e.key === 'End') {
      e.preventDefault();
      applyWidth(getEffectiveMax(), true);
    }
  };

  const onDblClick = (): void => {
    applyWidth(defaultWidth, true);
  };

  const onWindowResize = (): void => {
    if (targetContainer.clientWidth > 0) {
      applyWidth(currentWidth, false);
    }
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerEnd);
  element.addEventListener('pointercancel', onPointerEnd);
  element.addEventListener('keydown', onKeyDown);
  element.addEventListener('dblclick', onDblClick);
  window.addEventListener('resize', onWindowResize, { passive: true });

  return {
    element,
    getWidth: () => currentWidth,
    setWidth: (width: number) => {
      applyWidth(width, true);
    },
    reset: () => {
      applyWidth(defaultWidth, true);
    },
    destroy: () => {
      stopDrag(false);
      window.removeEventListener('resize', onWindowResize);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerEnd);
      element.removeEventListener('pointercancel', onPointerEnd);
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('dblclick', onDblClick);
    },
  };
}
