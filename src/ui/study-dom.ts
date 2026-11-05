// @file: src/ui/study-dom.ts
// @feature: verse-reader
// @tables: none
// @candidates: none
// @toc: ui:elements

// === @section:ui:elements ===
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function action(text: string, run: () => void, className = 'study-button') {
  const button = el('button', className, text); button.type = 'button';
  button.addEventListener('click', run); return button;
}
export function status(text: string) {
  const p = el('p', 'study-muted', text); p.setAttribute('role', 'status'); return p;
}
export function heading(eyebrow: string, title: string) {
  const h = el('div', 'study-section-heading');
  h.append(el('p', 'eyebrow', eyebrow), el('h2', '', title)); return h;
}
export const yearLabel = (year: number) => year <= 0 ? `${1 - year} BC` : `AD ${year}`;
