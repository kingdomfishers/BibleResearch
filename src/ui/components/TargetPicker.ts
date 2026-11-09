// @file: src/ui/components/TargetPicker.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: imports | logic:search | ui:results | ui:tokens | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type {
  TargetCandidate,
  TargetCandidateAnchor,
  TargetCandidateGroup,
} from '../../api/notes-api-types';
import type { ActivePassage, VerseWordToken, WordRecord } from '../../api/types';
import { formatVerseRef } from '../utils';

export interface TargetPickerContext {
  passage?: ActivePassage | null;
  verseId?: number | null;
  selectedWord?: WordRecord | null;
  selectedPosition?: number | null;
  lemmaId?: number | null;
  lemmaLabel?: string | null;
}

export interface TargetPickerProps {
  onPick: (anchor: TargetCandidateAnchor) => void;
}

export interface TargetPickerComponent {
  element: HTMLElement;
  focus: () => void;
  reset: () => void;
  setContext: (context: TargetPickerContext) => void;
}

// === @section:logic:search ===
export type SearchState = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export class TargetSearchManager {
  private currentRequestId = 0;
  private abortController: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  state: SearchState = 'idle';
  query = '';
  errorMessage = '';
  groups: TargetCandidateGroup[] = [];
  flatCandidates: TargetCandidate[] = [];
  activeIndex = -1;

  constructor(private onChange: () => void) {}

  search(q: string, debounceMs = 250): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.query = q.trim();
    if (!this.query) { this.reset(); return; }
    this.debounceTimer = setTimeout(() => void this.executeSearch(), debounceMs);
  }

  async executeSearch(): Promise<void> {
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();
    const reqId = ++this.currentRequestId;
    this.state = 'loading'; this.errorMessage = ''; this.onChange();

    try {
      const res = await BibleRPC.notes.searchTargets(this.query, null, this.abortController.signal);
      if (reqId !== this.currentRequestId) return;
      if (res.error || !res.data) {
        this.state = 'error'; this.errorMessage = res.error || 'Failed to search targets';
      } else {
        this.groups = res.data.groups || [];
        this.flatCandidates = this.groups.flatMap(g => g.candidates);
        this.state = this.flatCandidates.length ? 'success' : 'empty';
        this.activeIndex = this.flatCandidates.length ? 0 : -1;
      }
    } catch (err: unknown) {
      if (reqId !== this.currentRequestId) return;
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this.state = 'error'; this.errorMessage = err instanceof Error ? err.message : 'Search error';
      }
    }
    this.onChange();
  }

  moveActive(delta: number): void {
    if (!this.flatCandidates.length) return;
    const len = this.flatCandidates.length;
    this.activeIndex = (this.activeIndex + delta + len) % len;
    this.onChange();
  }

  getActiveCandidate(): TargetCandidate | null {
    return this.flatCandidates[this.activeIndex] ?? null;
  }

  reset(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.abortController) this.abortController.abort();
    this.state = 'idle'; this.query = ''; this.errorMessage = '';
    this.groups = []; this.flatCandidates = []; this.activeIndex = -1;
    this.onChange();
  }
}

// === @section:ui:results ===
export function renderSearchResults(
  container: HTMLElement,
  mgr: TargetSearchManager,
  onPick: (anchor: TargetCandidateAnchor) => void
): void {
  container.replaceChildren();
  if (mgr.state === 'idle') { container.hidden = true; return; }
  container.hidden = false;

  if (mgr.state === 'loading' || mgr.state === 'empty') {
    const el = document.createElement('div');
    el.className = `target-picker__status target-picker__status--${mgr.state}`;
    el.textContent = mgr.state === 'loading' ? 'Searching targets...' : `No targets found for "${mgr.query}"`;
    container.append(el);
    return;
  }
  if (mgr.state === 'error') {
    const el = document.createElement('div');
    el.className = 'target-picker__status target-picker__status--error';
    const msg = document.createElement('span'); msg.textContent = mgr.errorMessage || 'Search failed';
    const retry = document.createElement('button'); retry.type = 'button';
    retry.className = 'target-picker__retry-btn'; retry.textContent = 'Retry';
    retry.addEventListener('click', () => void mgr.executeSearch());
    el.append(msg, retry); container.append(el); return;
  }

  let candIdx = 0;
  for (const group of mgr.groups) {
    if (!group.candidates.length) continue;
    const grpEl = document.createElement('div'); grpEl.className = 'target-picker__group';
    grpEl.setAttribute('role', 'group'); grpEl.setAttribute('aria-label', group.label);
    const title = document.createElement('div'); title.className = 'target-picker__group-title';
    title.textContent = group.label; grpEl.append(title);

    for (const cand of group.candidates) {
      const idx = candIdx++;
      const opt = document.createElement('div');
      opt.className = 'target-candidate' + (idx === mgr.activeIndex ? ' is-focused' : '');
      opt.setAttribute('role', 'option'); opt.setAttribute('id', `target-opt-${idx}`);
      opt.setAttribute('aria-selected', String(idx === mgr.activeIndex));

      const main = document.createElement('div'); main.className = 'target-candidate__main';
      const label = document.createElement('bdi'); label.className = 'target-candidate__label';
      label.textContent = cand.label;
      const badge = document.createElement('span');
      badge.className = `target-candidate__badge target-candidate__badge--${cand.match_type}`;
      badge.textContent = cand.match_type;
      main.append(label, badge);
      if (cand.sublabel) {
        const sub = document.createElement('div'); sub.className = 'target-candidate__sublabel';
        sub.textContent = cand.sublabel; opt.append(main, sub);
      } else { opt.append(main); }

      opt.addEventListener('mouseenter', () => {
        if (mgr.activeIndex !== idx) {
          const prev = container.querySelector('.target-candidate.is-focused');
          if (prev) {
            prev.classList.remove('is-focused');
            prev.setAttribute('aria-selected', 'false');
          }
          mgr.activeIndex = idx;
          opt.classList.add('is-focused');
          opt.setAttribute('aria-selected', 'true');
        }
      });
      const pickHandler = (e: Event) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        onPick(cand.anchor);
      };
      opt.addEventListener('mousedown', pickHandler);
      opt.addEventListener('click', pickHandler);
      grpEl.append(opt);
    }
    container.append(grpEl);
  }
}

// === @section:ui:tokens ===
export function createTokenPicker(
  onPick: (anchor: TargetCandidateAnchor) => void
): { element: HTMLElement; update: (p: ActivePassage | null, verseId: number | null) => void } {
  const element = document.createElement('div');
  element.className = 'token-picker';
  let tokenRequestId = 0;

  function update(passage: ActivePassage | null, verseId: number | null): void {
    element.replaceChildren();
    if (!passage) { element.hidden = true; return; }
    element.hidden = false;
    const header = document.createElement('div'); header.className = 'target-picker__section-title';
    header.textContent = `Select word occurrence (${formatVerseRef(passage)}):`;
    const list = document.createElement('div'); list.className = 'token-picker__list';
    list.textContent = 'Loading verse tokens...';
    element.append(header, list);

    const reqId = ++tokenRequestId;
    void BibleRPC.getVerseWords(passage.book, passage.chapter, passage.verse).then(res => {
      if (reqId !== tokenRequestId) return;
      list.replaceChildren();
      const tokens: VerseWordToken[] = res.data ?? [];
      if (!tokens.length) { list.textContent = 'No tokens available for this verse.'; return; }
      tokens.forEach(tok => {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'token-btn';
        btn.setAttribute('data-word-id', String(tok.word_id));
        btn.setAttribute('data-position', String(tok.word_position));
        btn.setAttribute('aria-label', `Tag token ${tok.original_word} (${tok.transliteration})`);

        const orig = document.createElement('bdi'); orig.className = 'token-btn__original';
        orig.textContent = tok.original_word;
        const translit = document.createElement('span'); translit.className = 'token-btn__transliteration';
        translit.textContent = tok.transliteration; translit.setAttribute('dir', 'ltr');
        btn.append(orig, translit);

        btn.addEventListener('click', () => {
          btn.classList.toggle('is-selected');
          onPick({
            kind: 'word_occurrence', verse_id: verseId ?? 0, word_position: tok.word_position,
            word_id: tok.word_id, label: `${tok.original_word} (${tok.transliteration})`,
          });
        });
        list.append(btn);
      });
    });
  }

  return { element, update };
}

// === @section:ui:main ===
export function createTargetPicker(props: TargetPickerProps): TargetPickerComponent {
  const element = document.createElement('div'); element.className = 'target-picker';
  let ctx: TargetPickerContext = {}, resolvedVerseId: number | null = null;
  const quick = document.createElement('div'); quick.className = 'target-picker__quick';
  const wrap = document.createElement('div'); wrap.className = 'target-picker__search-wrap';
  const input = document.createElement('input'); input.type = 'search'; input.className = 'target-picker__input';
  input.placeholder = 'Search verse, lemma, word, concept...';
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', 'target-picker-results');
  wrap.append(input);
  const results = document.createElement('div'); results.className = 'target-picker__results';
  results.id = 'target-picker-results'; results.setAttribute('role', 'listbox');
  results.setAttribute('aria-label', 'Target search results');
  const tokenPicker = createTokenPicker(props.onPick);

  const searchMgr = new TargetSearchManager(() => {
    input.setAttribute('aria-expanded', String(searchMgr.state === 'success' || searchMgr.state === 'empty'));
    const active = searchMgr.getActiveCandidate();
    if (active) input.setAttribute('aria-activedescendant', `target-opt-${searchMgr.activeIndex}`);
    else input.removeAttribute('aria-activedescendant');
    renderSearchResults(results, searchMgr, props.onPick);
  });

  input.addEventListener('input', () => searchMgr.search(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); searchMgr.moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); searchMgr.moveActive(-1); }
    else if (e.key === 'Enter') {
      const active = searchMgr.getActiveCandidate();
      if (active) { e.preventDefault(); props.onPick(active.anchor); }
    } else if (e.key === 'Escape') { input.value = ''; searchMgr.reset(); }
  });

  function addQuickBtn(text: string, onClick: () => void): void {
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = 'target-picker__quick-btn'; btn.textContent = text;
    btn.addEventListener('click', onClick); quick.append(btn);
  }

  function renderQuick(): void {
    quick.replaceChildren();
    if (ctx.passage) {
      const vRef = formatVerseRef(ctx.passage);
      addQuickBtn(`Tag verse (${vRef})`, () => props.onPick({ kind: 'verse', verse_id: resolvedVerseId ?? 0, label: vRef }));
    }
    if (ctx.selectedWord) {
      const w = ctx.selectedWord, lbl = `${w.original_word} (${w.transliteration})`;
      if (ctx.selectedPosition) {
        addQuickBtn(`Tag occurrence: ${lbl}`, () => props.onPick({
          kind: 'word_occurrence', verse_id: resolvedVerseId ?? 0,
          word_position: ctx.selectedPosition ?? 0, word_id: w.id, label: lbl,
        }));
      }
      addQuickBtn(`Tag word form: ${lbl}`, () => props.onPick({ kind: 'word_form', word_id: w.id, label: lbl }));
      if (ctx.lemmaId || ctx.lemmaLabel) {
        const lem = ctx.lemmaLabel ?? lbl;
        addQuickBtn(`Tag lemma: ${lem}`, () => props.onPick({ kind: 'lemma', lemma_id: ctx.lemmaId ?? 0, label: lem }));
      }
    }
  }

  function setContext(newCtx: TargetPickerContext): void {
    ctx = { ...newCtx }; resolvedVerseId = ctx.verseId ?? null;
    renderQuick(); tokenPicker.update(ctx.passage ?? null, resolvedVerseId);
    if (!resolvedVerseId && ctx.passage) {
      void BibleRPC.notes.searchTargets(formatVerseRef(ctx.passage)).then(res => {
        const c = res.data?.groups.find(g => g.kind === 'passage')?.candidates.find(x => x.anchor.kind === 'verse');
        if (c?.anchor.verse_id) {
          resolvedVerseId = c.anchor.verse_id;
          renderQuick(); tokenPicker.update(ctx.passage ?? null, resolvedVerseId);
        }
      });
    }
  }

  element.append(quick, wrap, results, tokenPicker.element);
  return { element, focus: () => input.focus(), reset: () => { input.value = ''; searchMgr.reset(); }, setContext };
}
