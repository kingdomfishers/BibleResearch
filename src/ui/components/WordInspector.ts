// @file: src/ui/components/WordInspector.ts
// @feature: word-modal
// @tables: words | reader_rendering_groups | verse_translation_sources | assertions | lexical_formations | lemma_components | lexical_connections
// @candidates: none
// @toc: imports | types | ui:main | ui:summary | ui:occurrences | ui:connections | ui:notes | logic:inspect | logic:page

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage, ReaderOverview, ReaderWord, WordRecord } from '../../api/types';
import { action, el, heading, status } from '../study-dom';
import { calculateGematria, formatVerseRef } from '../utils';
import { appState } from '../state';
import type { ContextPreview } from './ContextPreview';
import { renderCategorizedConnections, renderWordFormation } from './WordFormation';
import { createWordNotes } from './WordNotes';

// === @section:types ===
interface Selection { id: number; position?: number; english?: string; rendering?: string; suggested?: boolean }

// === @section:ui:main ===
export function createWordInspector(
  preview: ContextPreview,
  navigate: (p: ActivePassage) => void,
  onAddNote?: (data: { word: WordRecord; position?: number }) => void
) {
  const element = el('aside', 'word-inspector'); element.setAttribute('aria-label', 'Word meaning and connections');
  let generation = 0, selection: Selection | null = null, overview: ReaderOverview | null = null;
  let currentData: ReaderWord | null = null;
  const history: Selection[] = [];
  const summary = el('div', 'inspector-summary'), occurrences = el('section', 'inspector-occurrences');
  const formation = el('section', 'inspector-formation');
  const categorized = el('section', 'inspector-categorized');
  const connections = el('section', 'inspector-connections');
  let opener: HTMLElement | null = null;
  const close = () => { element.dataset.open = 'false'; opener?.focus(); };
  const closeButton = action('Close word details', close, 'study-button inspector-close');
  const back = action('← Previous word', () => {
    const previous = history.pop(); if (previous) void inspect(previous, false);
  }, 'text-action'); back.hidden = true;
  const returnPassage = action('', () => {
    const p = appState.getPassage(); navigate(p);
  }, 'text-action return-passage-btn'); returnPassage.hidden = true;
  element.append(closeButton, back, returnPassage, summary, formation, occurrences, categorized, connections);
  summary.append(heading('WORD & CONNECTIONS', 'Follow a word'), status('Choose an original word to explore its meanings and connections.'));
  element.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  // === @section:ui:summary ===
  function renderSummary(word: WordRecord, data: ReaderWord, selected: Selection) {
    summary.replaceChildren(el('p', 'eyebrow', selected.suggested ? 'SUGGESTED WORD' : 'SELECTED WORD'));
    const original = el('h2', 'modal-original', word.original_word);
    original.dir = word.strongs_nr.startsWith('H') ? 'rtl' : 'ltr';
    original.lang = word.strongs_nr.startsWith('H') ? 'he' : 'el';
    const gematria = word.gematria ?? calculateGematria(word.original_word);
    const metaRow = el('div', 'inspector-word-meta');
    metaRow.append(
      el('span', 'meta-pill', `Gematria ${gematria}`),
      el('span', 'meta-pill', `Strong’s ${word.strongs_nr}`),
    );
    summary.append(original, el('p', 'inspector-transliteration', word.transliteration), metaRow,
      el('p', 'inspector-here', selected.english ? `Here: ${selected.english.replaceAll('/', ' ')}` : word.english_translations?.join(' · ') ?? ''),
      el('p', 'inspector-definition', word.biblical_def || 'A sourced definition is not available for this word.'));
    const grammar = selected.position ? overview?.grammar[selected.position] : null;
    if (grammar) summary.append(el('p', 'word-grammar', Object.entries(grammar)
      .filter(([, value]) => typeof value === 'string').map(([, value]) => value).join(' · ')));
    if (data.lexemes.length > 1) {
      const meanings = el('div', 'lexeme-possibilities');
      meanings.append(el('strong', '', 'Unified Word · Meanings in Different Verses'),
        status('Homographs are unified as a single focus word: explore its different meanings and nuances across Scripture.'));
      for (const lexeme of data.lexemes) {
        const row = el('div', 'homograph-meaning-row');
        row.append(el('p', '', `${lexeme.extended_strongs} — ${lexeme.primary_gloss}`));
        if (lexeme.homograph_note) {
          row.append(el('p', 'study-muted', `📖 Meaning in verses: ${lexeme.homograph_note}`));
        }
        meanings.append(row);
      }
      summary.append(meanings);
    } else if (data.lexemes.length === 1 && data.lexemes[0].homograph_note) {
      const single = el('div', 'lexeme-possibilities');
      single.append(el('strong', '', 'Meaning in Verses'),
        el('p', 'study-muted', `📖 ${data.lexemes[0].homograph_note}`));
      summary.append(single);
    }
    const details = el('details', 'study-disclosure'); details.append(el('summary', '', 'Identifiers and source'));
    details.append(el('p', 'strongs', `Strong’s ${word.strongs_nr}`),
      el('p', 'gematria-badge', `Gematria: ${gematria}`),
      el('p', '', word.grammar_code ?? 'Grammar unavailable'),
      el('p', 'study-muted', 'STEP Bible · occurrence renderings across the base Strong’s group. These are observed translations, not assigned semantic senses.'));
    summary.append(details);
  }

  // === @section:ui:occurrences ===
  function renderOccurrences(data: ReaderWord, append = false) {
    if (!append) {
      occurrences.replaceChildren(el('h3', '', selection?.rendering ? `Rendered “${selection.rendering}”` : 'Same word elsewhere'),
        el('p', 'study-muted', `${data.token_total.toLocaleString()} tokens · ${data.verse_total.toLocaleString()} verses · base Strong’s scope`));
      if (selection?.rendering) occurrences.append(action('Show all renderings', () => {
        if (selection) void inspect({ ...selection, rendering: undefined }, false);
      }, 'text-action'));
    }
    occurrences.querySelector('.load-more')?.remove();
    const list = el('div', 'occurrence-evidence');
    for (const item of data.occurrences) {
      const row = el('div', 'evidence-row');
      const reason = `Same base Strong’s group. STEP rendering in this passage: ${item.source_english.replaceAll('/', ' ')}. ${item.occurrence_count} matching token(s).`;
      const reference = action(formatVerseRef(item), () => preview.pin(item, reason), 'reference-link');
      preview.attach(reference, item, reason);
      row.append(reference, el('span', 'evidence-gloss', item.source_english.replaceAll('/', ' ')),
        action('Read →', () => navigate(item), 'text-action'));
      list.append(row);
    }
    occurrences.append(list);
    if (!data.occurrences.length) occurrences.append(status('No occurrence evidence was returned for this rendering.'));
    if (data.next_cursor !== null) occurrences.append(action('Load more occurrences', () => { void loadMore(); }, 'study-button load-more'));
    void BibleRPC.preloadReaderPassages(data.occurrences.slice(0, 5));
  }

  // === @section:ui:connections ===
  async function renderConnections(id: number, strongs: string, request: number) {
    connections.replaceChildren(el('h3', '', 'Often appears with'), status('Loading word companions…'));
    const result = await BibleRPC.getWordCoOccurrences(id);
    if (request !== generation) return;
    connections.replaceChildren(el('h3', '', 'Often appears with'), el('p', 'study-muted', 'Shared context is an association; it does not establish the same meaning.'));
    for (const word of result.data.slice(0, 7)) {
      const button = action(`${word.original_word} · ${word.primary_english ?? word.transliteration}`, () => {
        void inspect({ id: word.word_id });
      }, 'connected-word');
      connections.append(button);
    }
    if (!result.data.length) connections.append(status(result.error ?? 'No cached word connections available.'));
    const deeper = el('details', 'study-disclosure'); deeper.append(el('summary', '', 'Related concepts & textual evidence'));
    const body = el('div'); deeper.append(body); connections.append(deeper);
    deeper.addEventListener('toggle', async () => {
      if (!deeper.open || body.childElementCount) return;
      body.append(status('Loading reviewed evidence…'));
      const response = await BibleRPC.researchRelationships(strongs);
      if (request !== generation) return;
      body.replaceChildren();
      for (const path of response.data?.evidence_paths ?? []) {
        body.append(el('p', 'evidence-category', path.epistemic_category), el('p', '', path.summary));
        for (const span of path.evidence_spans) {
          const p = { book: span.book, chapter: span.start_chapter, verse: span.start_verse };
          const reference = action(span.reference, () => preview.pin(p, span.explanation), 'reference-link');
          preview.attach(reference, p, span.explanation); body.append(reference);
        }
        body.append(el('p', 'study-muted', path.limitations_note));
      }
      if (!body.childElementCount) body.append(status(response.error ?? 'No reviewed concept annotation available for this query.'));
    });
  }

  // === @section:ui:notes ===
  const wordNotes = createWordNotes({
    onInspectWord: (targetWordId: number) => { void inspect({ id: targetWordId }); },
    onAddNote: onAddNote ? () => {
      if (currentData?.word) {
        onAddNote({ word: currentData.word, position: selection?.position });
      }
    } : undefined,
  });
  element.appendChild(wordNotes.element);

  // === @section:logic:inspect ===
  async function inspect(next: Selection, remember = true) {
    const request = ++generation;
    if (selection && remember && selection.id !== next.id) history.push(selection);
    selection = next; currentData = null; back.hidden = !history.length;
    const currentPassage = appState.getPassage();
    returnPassage.textContent = `↩ Return to reading (${formatVerseRef(currentPassage)})`;
    returnPassage.hidden = !history.length;
    if (!next.suggested) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.dataset.open = 'true';
    }
    summary.replaceChildren(heading('WORD & CONNECTIONS', 'Opening word…'));
    formation.replaceChildren(status('Loading word formation & etymology…'));
    occurrences.replaceChildren(); categorized.replaceChildren(); connections.replaceChildren();
    wordNotes.clear();
    element.setAttribute('aria-busy', 'true');
    const result = await BibleRPC.getReaderWord(next.id, 0, next.rendering ?? null);
    if (request !== generation) return;
    element.setAttribute('aria-busy', 'false');
    if (!result.data?.word) {
      summary.replaceChildren(heading('WORD & CONNECTIONS', 'Word unavailable'), status(result.error ?? 'No live word evidence is available.'),
        action('Retry', () => { void inspect(next, false); }));
      formation.replaceChildren(); wordNotes.clear();
      return;
    }
    currentData = result.data;
    renderSummary(result.data.word, result.data, next); renderOccurrences(result.data);
    const strongs = result.data.word.strongs_nr;
    const [formationRes, candsRes] = await Promise.all([
      BibleRPC.lookupWordFormation(strongs, next.id),
      BibleRPC.suggestOrthographicCandidates(strongs, 8, 2),
    ]);
    if (request !== generation) return;
    renderWordFormation(formation, formationRes.data, (targetId, opts) => {
      void inspect({ id: targetId, ...opts });
    });
    renderCategorizedConnections(categorized, formationRes.data, candsRes.data?.candidate_connections ?? [], (targetId, opts) => {
      void inspect({ id: targetId, ...opts });
    });
    void renderConnections(next.id, strongs, request);
    const curPassage = appState.getPassage();
    const curOcc = result.data.occurrences?.find(
      o => o.book === curPassage.book && o.chapter === curPassage.chapter && o.verse === curPassage.verse
    );
    void wordNotes.setWord(next.id, curOcc?.verse_id ?? null, next.position ?? null);
  }

  // === @section:logic:page ===
  async function loadMore() {
    if (!selection || currentData?.next_cursor == null) return;
    const request = generation, button = occurrences.querySelector<HTMLButtonElement>('.load-more');
    if (button) button.disabled = true;
    const result = await BibleRPC.getReaderWord(selection.id, currentData.next_cursor, selection.rendering ?? null);
    if (request !== generation) return;
    if (!result.data) { if (button) { button.disabled = false; button.textContent = 'Could not load more · Retry'; } return; }
    currentData = result.data; renderOccurrences(result.data, true);
  }
  return { element, inspect: (id: number, options: Omit<Selection, 'id'> = {}) => inspect({ id, ...options }),
    setOverview: (value: ReaderOverview | null) => { overview = value; },
    reset: () => { generation++; selection = null; history.length = 0; element.dataset.open = 'false';
      returnPassage.hidden = true;
      summary.replaceChildren(heading('WORD & CONNECTIONS', 'Follow a word'), status('Choose a word to explore.'));
      formation.replaceChildren(); occurrences.replaceChildren(); categorized.replaceChildren(); connections.replaceChildren();
      wordNotes.clear(); }, close };
}
