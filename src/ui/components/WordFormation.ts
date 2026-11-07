// @file: src/ui/components/WordFormation.ts
// @feature: word-modal
// @tables: lexical_formations | lemma_components | lexical_connections | lemmas | lexical_roots
// @candidates: none
// @toc: imports | types | ui:components | ui:formation | ui:roots | ui:categories

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type {
  DocumentedRootRecord, LemmaComponentRecord,
  OrthographicCandidateRecord, RootRelativeRecord, WordFormationResponse,
} from '../../api/types';
import { action, el, heading, status } from '../study-dom';

// === @section:types ===
export type WordSelectHandler = (
  wordId: number,
  options?: { english?: string; rendering?: string; suggested?: boolean },
) => void;

export interface FormationViewOptions {
  currentPassageRef?: string;
  onReturnToPassage?: () => void;
}

async function resolveAndSelect(
  query: string,
  english: string | undefined,
  onSelectWord: WordSelectHandler,
): Promise<void> {
  const resolved = await BibleRPC.resolveWordId(query);
  if (resolved) onSelectWord(resolved, { english });
}

// === @section:ui:components ===
function renderComponentCard(
  comp: LemmaComponentRecord,
  isHebrew: boolean,
  onSelectWord: WordSelectHandler,
): HTMLElement {
  const card = el('div', 'formation-component-item');
  const spelling = comp.original_lemma || comp.surface_text;
  const gloss = comp.semantic_contribution || comp.primary_gloss || comp.senses[0]?.short_gloss || '';
  const translit = comp.transliteration ? comp.transliteration.replaceAll('.', '') : '';
  const displayLabel = `${spelling} — ${translit || comp.surface_text} — ${gloss}`;
  const btn = action(displayLabel, () => {
    const q = comp.base_strongs || comp.original_lemma || comp.surface_text;
    void resolveAndSelect(q, gloss, onSelectWord);
  }, 'component-link-button');
  btn.setAttribute('aria-label', `Explore component: ${spelling}, ${translit}, meaning: ${gloss}`);
  const origSpan = el('span', 'component-original', spelling);
  origSpan.dir = isHebrew ? 'rtl' : 'ltr';
  origSpan.lang = isHebrew ? 'he' : 'el';
  const roleBadge = el('span', 'component-role-badge', comp.role.replaceAll('_', ' '));
  card.append(btn, roleBadge);
  if (comp.component_note) {
    card.append(el('p', 'study-muted component-note', comp.component_note));
  }
  return card;
}

// === @section:ui:formation ===
export function renderWordFormation(
  container: HTMLElement,
  data: WordFormationResponse | null,
  onSelectWord: WordSelectHandler,
): void {
  container.replaceChildren();
  const wrap = el('section', 'word-formation-section');
  wrap.setAttribute('aria-label', 'Word formation and etymology');
  wrap.append(heading('WORD FORMATION & ETYMOLOGY', 'Lexical Origin & Decomposition'));
  if (!data || data.status !== 'ok') {
    wrap.append(status('Word formation data could not be loaded.'));
    container.append(wrap);
    return;
  }
  if (data.needs_disambiguation && (data.matched_lemmas?.length ?? 0) > 1) {
    const disambig = el('div', 'formation-disambiguation');
    disambig.append(el('strong', '', 'Disambiguated Lexical Entries'));
    for (const lemma of data.matched_lemmas ?? []) {
      const tag = lemma.homograph_tag ? ` (${lemma.homograph_tag})` : '';
      disambig.append(el('p', 'study-muted', `${lemma.lemma_key}${tag} — ${lemma.primary_gloss ?? ''}`));
    }
    wrap.append(disambig);
  }
  const formations = data.lexical_formations ?? [];
  if (!formations.length) {
    wrap.append(el('p', 'study-muted formation-empty',
      'No documented compound formation or etymological components are attested for this word in the lexicon. Biblical scholarship does not establish a verified compound origin.'));
    container.append(wrap);
    return;
  }
  for (const f of formations) {
    const card = el('div', 'formation-card');
    const matched = data.matched_lemmas?.[0];
    const lemmaScript = matched?.lemma_script ?? '';
    const translit = matched?.transliteration ? matched.transliteration.replaceAll('.', '') : '';
    const headerTitle = `${lemmaScript} — ${matched?.primary_gloss ?? translit}`;
    const headerEl = el('h4', 'formation-header-title', headerTitle);
    headerEl.dir = matched?.language === 'hbo' ? 'rtl' : 'ltr';
    card.append(headerEl);
    const roles = f.components.map(c => c.role.replaceAll('_', ' ')).join(' + ');
    if (roles) {
      card.append(el('p', 'formation-grammar-decomp', `Decomposition: ${roles}`));
    }
    const compBox = el('div', 'formation-components-list');
    compBox.append(el('strong', 'formation-components-label', 'Components:'));
    const isH = matched?.language !== 'grc';
    for (const comp of f.components) {
      compBox.append(renderComponentCard(comp, isH, onSelectWord));
    }
    card.append(compBox);
    if (f.whole_word_gloss) {
      const wholeMeaning = el('div', 'formation-whole-meaning');
      wholeMeaning.append(el('strong', '', 'Whole-name meaning:'), el('p', 'whole-gloss-text', f.whole_word_gloss));
      card.append(wholeMeaning);
    }
    const prov = el('div', 'formation-provenance');
    prov.append(el('span', 'evidence-badge', f.evidence_status));
    if (f.source.title) {
      prov.append(el('span', 'source-label', ` · Source: ${f.source.title}`));
    }
    card.append(prov);
    if (f.evidence_note) card.append(el('p', 'study-muted', f.evidence_note));
    wrap.append(card);
  }
  container.append(wrap);
}

// === @section:ui:roots ===
function renderRootFamily(
  roots: DocumentedRootRecord[],
  relatives: RootRelativeRecord[],
  onSelectWord: WordSelectHandler,
): HTMLElement {
  const box = el('div', 'related-category-box root-family-box');
  box.append(el('h4', 'category-title', 'Documented Root Family'));
  box.append(el('p', 'study-muted', 'Attested Semitic roots anchor etymological families. Shared roots do not imply identical meaning or synonymy.'));
  if (!roots.length && !relatives.length) {
    box.append(el('p', 'study-muted', 'No documented root family attested for this entry.'));
    return box;
  }
  for (const r of roots) {
    const item = el('div', 'root-record-row');
    item.append(el('span', 'root-script', r.root_script), el('span', 'root-translit', r.root_transliteration ?? ''),
      el('span', 'study-muted', ` (${r.relation_type.replaceAll('_', ' ')})`));
    box.append(item);
  }
  if (relatives.length) {
    const relList = el('div', 'root-relatives-list');
    relList.append(el('strong', '', 'Related Lemmas in Root Family:'));
    for (const rel of relatives) {
      const gloss = rel.primary_gloss ?? '';
      const label = `${rel.lemma_script} · ${rel.transliteration ?? ''} — ${gloss} (${rel.relation_type.replaceAll('_', ' ')})`;
      const b = action(label, () => {
        void resolveAndSelect(rel.base_strongs || rel.relative_lemma_key, gloss, onSelectWord);
      }, 'connected-word');
      relList.append(b);
    }
    box.append(relList);
  }
  return box;
}

// === @section:ui:categories ===
export function renderCategorizedConnections(
  container: HTMLElement,
  data: WordFormationResponse | null,
  candidates: OrthographicCandidateRecord[] | null,
  onSelectWord: WordSelectHandler,
): void {
  container.replaceChildren();
  const section = el('section', 'categorized-connections-section');
  section.append(heading('RELATED WORDS & PATTERNS', 'Four Distinct Relationship Tiers'));
  section.append(renderRootFamily(data?.documented_roots ?? [], data?.root_relatives ?? [], onSelectWord));
  const compBox = el('div', 'related-category-box composition-box');
  compBox.append(el('h4', 'category-title', 'Lexical Composition'));
  const comps = (data?.lexical_formations ?? []).flatMap(f => f.components);
  if (comps.length) {
    for (const c of comps) {
      const g = c.semantic_contribution || c.primary_gloss || '';
      const b = action(`${c.original_lemma || c.surface_text} — ${c.transliteration ?? ''} — ${g} (${c.role.replaceAll('_', ' ')})`, () => {
        void resolveAndSelect(c.base_strongs || c.surface_text, g, onSelectWord);
      }, 'connected-word');
      compBox.append(b);
    }
  } else {
    compBox.append(el('p', 'study-muted', 'Single-root or uncompounded lemma (no lexical composition).'));
  }
  section.append(compBox);
  const wordplayBox = el('div', 'related-category-box wordplay-box');
  wordplayBox.append(el('h4', 'category-title', 'Literary Wordplay'));
  const wordplay = (data?.other_connections ?? []).filter(c => c.relation_type === 'literary_wordplay');
  if (wordplay.length) {
    for (const wp of wordplay) {
      const row = el('div', 'wordplay-item');
      if (wp.passage_reference) row.append(el('p', 'wordplay-ref', `📖 Passages: ${wp.passage_reference}`));
      row.append(el('p', 'wordplay-note', wp.evidence_note));
      const targetQuery = wp.target_strongs || wp.target_lemma_key;
      row.append(action(`Inspect connected wordplay (${targetQuery}) →`, () => {
        void resolveAndSelect(targetQuery, undefined, onSelectWord);
      }, 'text-action'));
      wordplayBox.append(row);
    }
  } else {
    wordplayBox.append(el('p', 'study-muted', 'No verified literary wordplay recorded for this lemma.'));
  }
  section.append(wordplayBox);
  const candBox = el('div', 'related-category-box orthographic-candidates-box');
  candBox.append(el('h4', 'category-title', 'Possible Spelling or Sound Connections'));
  candBox.append(el('p', 'candidate-warning-note',
    '⚠️ Unverified Candidates: Consonantal similarity does not establish etymology or shared linguistic origin. These exploratory candidates show orthographic overlap in the ancient text.'));
  if (candidates && candidates.length) {
    for (const cand of candidates) {
      const g = cand.candidate_gloss ?? '';
      const pos = cand.overlap_position.replaceAll('_', ' ');
      const desc = `${cand.candidate_script} · ${cand.candidate_transliteration ?? ''} — ${g} (${cand.overlap_chars}-consonant match, ${pos})`;
      const b = action(desc, () => {
        void resolveAndSelect(cand.candidate_strongs || cand.candidate_lemma_key, g, onSelectWord);
      }, 'connected-word');
      candBox.append(b);
    }
  } else {
    candBox.append(el('p', 'study-muted', 'No orthographic candidate overlap discovered.'));
  }
  section.append(candBox);
  container.append(section);
}
