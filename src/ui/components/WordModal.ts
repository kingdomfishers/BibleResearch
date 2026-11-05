// @file: src/ui/components/WordModal.ts
// @feature: word-modal
// @tables: words | verses
// @candidates: ui:cooccurrences
// @toc: imports | ui:details | ui:cooccurrences | ui:occurrences | ui:relationships | ui:main | logic:open

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage, HydratedCoOccurrence, WordOccurrence, WordRecord, WordRelationship } from '../../api/types';
import { formatVerseRef } from '../utils';

// === @section:ui:details ===
function renderDetails(container: HTMLElement, word: WordRecord, sample: boolean) {
  container.innerHTML = `<p class="eyebrow">WORD INSPECTOR</p><h2 id="word-modal-title" class="modal-original"></h2>
    <p class="modal-transliteration"></p><div class="word-meta"><span class="strongs"></span><span class="grammar"></span><span class="gematria"></span></div>
    <p class="modal-source"></p><section><h3>Biblical definition</h3><p class="biblical-definition"></p></section>
    <section><h3>Physical definition</h3><p class="physical-definition"></p></section>
    <section><h3>English translations</h3><p class="translation-note">Ordered by frequency when available. Counts are not supplied.</p><div class="translations"></div></section>`;
  const set = (selector: string, text: string) => { container.querySelector(selector)!.textContent = text; };
  const original = container.querySelector<HTMLElement>('.modal-original')!;
  original.textContent = word.original_word;
  original.dir = word.strongs_nr.startsWith('H') ? 'rtl' : 'ltr';
  original.lang = word.strongs_nr.startsWith('H') ? 'he' : 'el';
  set('.modal-transliteration', word.transliteration);
  set('.strongs', `Strong’s ${word.strongs_nr}`);
  set('.grammar', word.grammar_code ?? 'Grammar not available');
  const gematriaEl = container.querySelector<HTMLElement>('.gematria')!;
  if (word.gematria != null) {
    gematriaEl.textContent = `Gematria ${word.gematria}`;
  } else {
    gematriaEl.hidden = true;
  }
  set('.modal-source', sample ? 'Built-in sample · Definitions are concise study notes; relationship scores are illustrative.' : 'Live database word record');
  set('.biblical-definition', word.biblical_def || 'Not yet available.');
  set('.physical-definition', word.physical_def || 'Not yet available.');
  const translations = container.querySelector('.translations')!;
  for (const translation of word.english_translations ?? []) {
    const tag = document.createElement('span'); tag.textContent = translation; translations.append(tag);
  }
  if (!translations.childElementCount) translations.textContent = 'Not yet available.';
}

// === @section:ui:cooccurrences ===
function renderCoOccurrenceTags(container: HTMLElement, words: HydratedCoOccurrence[],
  onClick: (id: number) => void, onCompare: (partner: HydratedCoOccurrence) => void) {
  container.innerHTML = '<h3>Prompt 3 · Co-occurring words</h3>';
  if (!words.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No relationship data is available for this word yet.';
    container.append(empty); return;
  }
  const list = document.createElement('div'); list.className = 'related-words';
  for (const word of words) {
    const card = document.createElement('div'); card.className = 'related-card';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'related-inspect-btn';
    const title = document.createElement('span'); title.className = 'related-title';
    title.textContent = `${word.original_word} · ${word.transliteration}`;
    const detail = document.createElement('span');
    detail.textContent = `Frequency ${word.frequency} · Distance ${word.avg_distance} · Score ${word.score}`;
    button.append(title, detail);
    button.addEventListener('click', () => onClick(word.word_id));
    const compareBtn = document.createElement('button'); compareBtn.type = 'button'; compareBtn.className = 'related-compare-btn';
    compareBtn.textContent = 'Compare (Prompt 4)';
    compareBtn.addEventListener('click', () => onCompare(word));
    card.append(button, compareBtn); list.append(card);
  }
  container.append(list);
}

// === @section:ui:occurrences ===
function renderOccurrences(container: HTMLElement, occurrences: WordOccurrence[],
  onSelectPassage?: (p: ActivePassage) => void) {
  container.innerHTML = '<h3>Prompt 2 · Word occurrences across Scripture</h3>';
  if (!occurrences.length) {
    const empty = document.createElement('p'); empty.textContent = 'No occurrences found.';
    container.append(empty); return;
  }
  const subtitle = document.createElement('p'); subtitle.className = 'translation-note';
  subtitle.textContent = `Found in ${occurrences.length} passages. Select any verse to navigate:`;
  container.append(subtitle);
  const grid = document.createElement('div'); grid.className = 'occurrences-grid';
  for (const occ of occurrences.slice(0, 30)) {
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'occurrence-chip';
    const ref = formatVerseRef({ book: occ.book, chapter: occ.chapter, verse: occ.verse_nr });
    chip.innerHTML = `<span class="ref">${ref}</span><span class="count">${occ.occurrence_count}×</span>`;
    chip.addEventListener('click', () => { onSelectPassage?.({ book: occ.book, chapter: occ.chapter, verse: occ.verse_nr }); });
    grid.append(chip);
  }
  if (occurrences.length > 30) {
    const more = document.createElement('span'); more.className = 'occurrence-more';
    more.textContent = `+${occurrences.length - 30} more verses`; grid.append(more);
  }
  container.append(grid);
}

// === @section:ui:relationships ===
function renderRelationships(container: HTMLElement, rels: WordRelationship[], partner: HydratedCoOccurrence,
  onSelectPassage?: (p: ActivePassage) => void) {
  container.innerHTML = `<h3>Prompt 4 · Shared verses with ${partner.original_word} (${partner.transliteration})</h3>`;
  if (!rels.length) {
    const empty = document.createElement('p'); empty.textContent = 'No shared verses found for this pair.';
    container.append(empty); return;
  }
  const subtitle = document.createElement('p'); subtitle.className = 'translation-note';
  subtitle.textContent = `${rels.length} shared passages ordered by density relationship score:`;
  container.append(subtitle);
  const list = document.createElement('div'); list.className = 'relationships-list';
  for (const rel of rels.slice(0, 15)) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'relationship-item';
    const ref = formatVerseRef({ book: rel.book, chapter: rel.chapter, verse: rel.verse_nr });
    btn.innerHTML = `<span class="ref">${ref}</span><span class="score-badge">Score ${rel.relationship_score}</span>`;
    btn.addEventListener('click', () => { onSelectPassage?.({ book: rel.book, chapter: rel.chapter, verse: rel.verse_nr }); });
    list.append(btn);
  }
  container.append(list);
}

// === @section:ui:main ===
export function createWordModal(onSelectPassage?: (p: ActivePassage) => void) {
  const element = document.createElement('dialog'); element.className = 'word-modal';
  element.setAttribute('aria-labelledby', 'word-modal-title');
  element.innerHTML = `<button type="button" class="modal-close" aria-label="Close word inspector">×</button>
    <div class="modal-content"></div><section class="modal-occurrences"></section>
    <section class="modal-related"></section><section class="modal-relationships" style="display:none;"></section>`;
  const content = element.querySelector<HTMLElement>('.modal-content')!;
  const occurrencesSection = element.querySelector<HTMLElement>('.modal-occurrences')!;
  const related = element.querySelector<HTMLElement>('.modal-related')!;
  const relationshipsSection = element.querySelector<HTMLElement>('.modal-relationships')!;
  const close = element.querySelector<HTMLButtonElement>('.modal-close')!;
  let request = 0;
  let opener: HTMLElement | null = null;
  const navigateAndClose = (p: ActivePassage) => { element.close(); onSelectPassage?.(p); };
  close.addEventListener('click', () => element.close());
  element.addEventListener('close', () => { request++; opener?.focus(); });
  element.addEventListener('click', event => {
    if (event.target !== element) return;
    const rect = element.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) element.close();
  });

  // === @section:logic:open ===
  async function openWordModal(wordId: number) {
    const current = ++request;
    if (!element.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    }
    element.setAttribute('aria-busy', 'true');
    content.innerHTML = '<h2 id="word-modal-title">Opening word…</h2>';
    occurrencesSection.replaceChildren(); related.replaceChildren();
    relationshipsSection.style.display = 'none'; relationshipsSection.replaceChildren(); close.focus();
    const [details, cooccurrences, occurrences] = await Promise.all([
      BibleRPC.getWordDetails(wordId), BibleRPC.getWordCoOccurrences(wordId), BibleRPC.getWordOccurrences(wordId),
    ]);
    if (request !== current || !element.open) return;
    element.setAttribute('aria-busy', 'false');
    if (!details.data) {
      content.innerHTML = '<h2 id="word-modal-title">Word unavailable</h2><p>This word has not been imported yet. Please try another word.</p>';
      return;
    }
    renderDetails(content, details.data, details.source === 'sample');
    renderOccurrences(occurrencesSection, occurrences.data, navigateAndClose);
    renderCoOccurrenceTags(related, cooccurrences.data, id => { void openWordModal(id); }, async partner => {
      relationshipsSection.style.display = 'block';
      relationshipsSection.innerHTML = '<p class="translation-note">Calculating Prompt 4 relationship score…</p>';
      const rels = await BibleRPC.getWordRelationships([wordId, partner.word_id]);
      if (request !== current || !element.open) return;
      renderRelationships(relationshipsSection, rels.data, partner, navigateAndClose);
    });
  }
  return { element, openWordModal, close: () => { if (element.open) element.close(); } };
}