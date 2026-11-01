// @file: src/ui/state.ts
// @feature: state
// @tables: none
// @candidates: none
// @toc: imports | logic:passage | logic:store

// === @section:imports ===
import type { ActivePassage } from '../api/types';

// === @section:logic:passage ===
const initial: ActivePassage = { book: 1, chapter: 1, verse: 1 };
function valid(p: ActivePassage) {
  return Number.isInteger(p.book) && p.book >= 1 && p.book <= 66 &&
    Number.isInteger(p.chapter) && p.chapter >= 1 && p.chapter <= 150 &&
    Number.isInteger(p.verse) && p.verse >= 0 && p.verse <= 176 && (p.verse !== 0 || p.book === 19);
}
function readHash(): ActivePassage {
  const match = /^#(\d+)-(\d+)-(\d+)$/.exec(location.hash);
  if (!match) return { ...initial };
  const p = { book: Number(match[1]), chapter: Number(match[2]), verse: Number(match[3]) };
  return valid(p) ? p : { ...initial };
}
const hash = (p: ActivePassage) => `#${p.book}-${p.chapter}-${p.verse}`;

// === @section:logic:store ===
let passage = readHash();
const listeners = new Set<(p: ActivePassage) => void>();
history.replaceState(null, '', hash(passage));
function publish(next: ActivePassage) {
  if (hash(next) === hash(passage)) return;
  passage = { ...next };
  listeners.forEach(listener => listener({ ...passage }));
}
window.addEventListener('hashchange', () => {
  const next = readHash();
  if (location.hash !== hash(next)) history.replaceState(null, '', hash(next));
  publish(next);
});
export const appState = {
  getPassage: () => ({ ...passage }),
  setPassage(next: ActivePassage) {
    if (!valid(next)) return;
    if (location.hash !== hash(next)) history.pushState(null, '', hash(next));
    publish(next);
  },
  subscribe(listener: (p: ActivePassage) => void) {
    listeners.add(listener);
    listener({ ...passage });
    return () => { listeners.delete(listener); };
  },
};
