// @file: src/ui/components/GrammaticalRelationshipsPanel.ts
// @feature: word-modal
// @tables: none
// @candidates: none
// @toc: imports | types | ui:refs | ui:evidence | ui:card | ui:panel | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type {
  GrammaticalCategoryGroup,
  GrammaticalLemmaProfile,
  GrammaticalOccurrenceEvidence,
  GrammaticalRefCoords,
  GrammaticalRelationshipsResponse,
  GrammaticalSummaryItem,
} from '../../api/relationships-rpc';
import type { ActivePassage } from '../../api/types';
import { action, el, status } from '../study-dom';
import type { ContextPreview } from './ContextPreview';

// === @section:types ===
export interface GrammaticalWordContext {
  book?: number;
  chapter?: number;
  verse?: number;
  position?: number;
  extendedStrongs?: string;
  preferredLemmaId?: string;
}

export interface GrammaticalPanelProps {
  onInspectTarget?: (wordId: number, lemmaId?: string) => void;
  preview?: ContextPreview;
  navigate?: (p: ActivePassage) => void;
  onCountChange?: (totalSummaries: number) => void;
}

export interface GrammaticalPanelState {
  wordId: number;
  strongsNr: string;
  context: GrammaticalWordContext;
  selectedLemmaId?: string;
  edition: string;
  includeUncertain: boolean;
  offset: number;
  groups: GrammaticalCategoryGroup[];
  response: GrammaticalRelationshipsResponse | null;
}

const EDITIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Edition: Auto' },
  { value: 'macula-hebrew-wlc', label: 'MACULA Hebrew (WLC)' },
  { value: 'macula-greek-nestle1904', label: 'MACULA Greek (Nestle 1904)' },
  { value: 'macula-greek-sblgnt', label: 'MACULA Greek (SBLGNT)' },
];

const QUALITY_LABELS: Readonly<Record<string, string>> = {
  source_explicit: 'Source explicit',
  rule_derived: 'Rule derived',
  candidate: 'Candidate',
  high_quality: 'High quality',
  candidate_only: 'Candidate only',
};

// === @section:ui:refs ===
function makeRefChip(
  label: string,
  coords: GrammaticalRefCoords | null,
  reason: string,
  props: GrammaticalPanelProps,
): HTMLElement {
  const wrap = el('span', 'gram-ref-chip');
  if (!coords) {
    wrap.append(el('span', 'study-muted', label));
    return wrap;
  }
  const passage: ActivePassage = { book: coords.book, chapter: coords.chapter, verse: coords.verse };
  if (props.preview) {
    const refBtn = action(label, () => props.preview?.pin(passage, reason), 'reference-link');
    props.preview.attach(refBtn, passage, reason);
    wrap.append(refBtn);
  } else if (props.navigate) {
    wrap.append(action(label, () => props.navigate?.(passage), 'reference-link'));
  } else {
    wrap.append(el('span', 'study-muted', label));
  }
  if (props.navigate) {
    const go = action('Read →', () => props.navigate?.(passage), 'text-action gram-ref-chip__go');
    go.setAttribute('aria-label', `Open ${label}`);
    wrap.append(go);
  }
  return wrap;
}

function makeLemmaLabel(
  profile: {
    lemma_id: string;
    lemma_form: string | null;
    transliteration: string | null;
    extended_strongs?: string | null;
    language?: string;
    gloss?: string | null;
    word_id?: number | null;
    primary_word_id?: number | null;
    surface_form?: string | null;
  },
  props: GrammaticalPanelProps,
  useSurface = false,
): HTMLElement {
  const bdi = document.createElement('bdi');
  bdi.className = 'rel-card__lemma';
  bdi.dir = profile.language === 'greek' ? 'ltr' : 'rtl';
  const mainText = (useSurface ? profile.surface_form : null) || profile.lemma_form || profile.lemma_id;
  const code = profile.extended_strongs || profile.lemma_id.replace(/^lemma:/, '');
  const parts = [mainText];
  if (profile.transliteration) parts.push(`(${profile.transliteration})`);
  if (code) parts.push(`[${code}]`);
  bdi.textContent = parts.join(' ');

  const targetWordId = profile.primary_word_id ?? profile.word_id ?? null;
  if (targetWordId && targetWordId > 0 && props.onInspectTarget) {
    const btn = action('', () => props.onInspectTarget?.(targetWordId, profile.lemma_id), 'text-action rel-card__target-btn');
    btn.replaceChildren(bdi);
    return btn;
  }
  return bdi;
}

// === @section:ui:evidence ===
function renderOccurrenceRow(
  rel: GrammaticalOccurrenceEvidence,
  props: GrammaticalPanelProps,
): HTMLElement {
  const row = el('div', 'gram-ev-row');
  const top = el('div', 'gram-ev-row__head');
  top.append(
    makeRefChip(rel.canonical_ref, rel.coords, `${rel.predicate}: ${rel.frame_context?.predicate_form ?? rel.canonical_ref}`, props),
    el('span', `rel-badge gram-badge--${rel.quality}`, QUALITY_LABELS[rel.quality] ?? rel.quality),
    el('span', 'rel-badge', rel.rule_id),
  );
  row.append(top);

  const tokens = el('div', 'gram-ev-row__tokens');
  const lang = rel.language;
  tokens.append(
    makeLemmaLabel({ ...rel.subject, language: lang }, props, true),
    el('span', 'study-muted gram-ev-row__arrow', ` ${rel.display_label ?? rel.predicate} → `),
    makeLemmaLabel({ ...rel.object, language: lang }, props, true),
  );
  if (rel.subject.gloss || rel.object.gloss) {
    tokens.append(el('span', 'study-muted', ` ("${rel.subject.gloss ?? '?'}" → "${rel.object.gloss ?? '?'}")`));
  }
  row.append(tokens);

  const quals: string[] = [];
  if (rel.qualifiers.polarity && rel.qualifiers.polarity !== 'unknown') quals.push(`polarity: ${rel.qualifiers.polarity}`);
  if (rel.qualifiers.modality && rel.qualifiers.modality !== 'unknown') quals.push(`modality: ${rel.qualifiers.modality}`);
  if (rel.qualifiers.voice && rel.qualifiers.voice !== 'unknown') quals.push(`voice: ${rel.qualifiers.voice}`);
  if (rel.qualifiers.quotation && rel.qualifiers.quotation !== 'unknown') quals.push(`quotation: ${rel.qualifiers.quotation}`);
  const provText = [...quals, rel.source_clause_id, rel.edition].filter(Boolean).join(' · ');
  row.append(el('p', 'study-muted rel-card__prov', provText));
  return row;
}

function createEvidenceDrawer(
  item: GrammaticalSummaryItem,
  includeUncertain: boolean,
  props: GrammaticalPanelProps,
): { button: HTMLButtonElement; drawer: HTMLElement } {
  const drawer = el('div', 'gram-card__evidence');
  drawer.hidden = true;
  let loaded = false;
  let nextOffset = 0;

  async function fetchPage(offset: number, append: boolean) {
    if (!append) drawer.replaceChildren(status('Loading exact clause evidence…'));
    const res = await BibleRPC.relationships.lookupGrammaticalRelationships({
      op: 'evidence',
      summary_id: item.summary_id,
      include_uncertain: includeUncertain,
      limit: 12,
      offset,
    });
    const listWrap = append
      ? (drawer.querySelector<HTMLElement>('.gram-ev-list') ?? el('div', 'gram-ev-list'))
      : el('div', 'gram-ev-list');
    if (!append) drawer.replaceChildren(listWrap);

    const rows = res.data.relations ?? [];
    for (const rel of rows) listWrap.append(renderOccurrenceRow(rel, props));

    const prevMore = drawer.querySelector('.gram-ev-more');
    if (prevMore) prevMore.remove();
    if (!rows.length && !append) {
      drawer.replaceChildren(status(res.data.error_message ?? 'No matching occurrence evidence under current filters.'));
      return;
    }
    if (res.data.page?.has_more && res.data.page.next_offset != null) {
      nextOffset = res.data.page.next_offset;
      const moreBtn = action(`Load more evidence (${listWrap.childElementCount} shown)`, () => {
        moreBtn.disabled = true;
        void fetchPage(nextOffset, true);
      }, 'editor-btn editor-btn--sm gram-ev-more');
      drawer.append(moreBtn);
    }
  }

  const button = action(`Inspect evidence (${item.stats.occurrences})`, () => {
    drawer.hidden = !drawer.hidden;
    button.setAttribute('aria-expanded', String(!drawer.hidden));
    if (!drawer.hidden && !loaded) {
      loaded = true;
      void fetchPage(0, false);
    }
  }, 'editor-btn editor-btn--sm');
  button.setAttribute('aria-expanded', 'false');
  return { button, drawer };
}

// === @section:ui:card ===
function createSummaryCard(
  item: GrammaticalSummaryItem,
  includeUncertain: boolean,
  props: GrammaticalPanelProps,
): HTMLElement {
  const card = el('article', 'rel-card gram-card');
  const head = el('div', 'rel-card__head');

  const related = item.related_lemma ?? {
    lemma_id: item.related_lemma_id,
    lemma_form: item.related_lemma_id,
    transliteration: null,
    extended_strongs: null,
    language: 'hebrew',
    gloss: null,
    primary_word_id: null,
  };

  head.append(
    makeLemmaLabel(related, props),
    el('span', `rel-badge gram-badge--${item.quality_tier}`, QUALITY_LABELS[item.quality_tier] ?? item.quality_tier),
    el('span', 'rel-badge', item.source_edition),
  );
  card.append(head);

  if (related.gloss) {
    card.append(el('p', 'rel-card__why', `Gloss: "${related.gloss}"`));
  }

  const statBits = [
    `${item.stats.occurrences} occ`,
    `${item.stats.distinct_passages} verses`,
    `${item.stats.distinct_books} books`,
  ];
  if (item.stats.source_explicit > 0) statBits.push(`explicit ${item.stats.source_explicit}`);
  if (item.stats.rule_derived > 0) statBits.push(`rule ${item.stats.rule_derived}`);
  if (item.stats.candidate > 0) statBits.push(`cand ${item.stats.candidate}`);
  if (item.stats.negated_or_uncertain > 0) statBits.push(`neg/uncertain ${item.stats.negated_or_uncertain}`);
  if (item.stats.command_or_prediction > 0) statBits.push(`cmd/pred ${item.stats.command_or_prediction}`);
  card.append(el('p', 'study-muted gram-card__stats', statBits.join(' · ')));

  if (item.sample_passages.length > 0) {
    const refsRow = el('div', 'gram-card__refs');
    for (const sp of item.sample_passages) {
      refsRow.append(makeRefChip(sp.reference, sp.coords, `${item.display_label}: ${related.lemma_form ?? related.lemma_id}`, props));
    }
    card.append(refsRow);
  }

  const actions = el('div', 'rel-card__actions');
  const { button, drawer } = createEvidenceDrawer(item, includeUncertain, props);
  actions.append(button);
  card.append(actions, drawer);
  return card;
}

// === @section:ui:panel ===
function mergeGroups(existing: GrammaticalCategoryGroup[], incoming: GrammaticalCategoryGroup[]): GrammaticalCategoryGroup[] {
  const byKey = new Map(existing.map(g => [g.group_key, { ...g, items: [...g.items] }]));
  for (const g of incoming) {
    const cur = byKey.get(g.group_key);
    if (!cur) {
      byKey.set(g.group_key, { ...g, items: [...g.items] });
      continue;
    }
    const seenIds = new Set(cur.items.map(i => i.summary_id));
    for (const item of g.items) {
      if (!seenIds.has(item.summary_id)) {
        cur.items.push(item);
        seenIds.add(item.summary_id);
      }
    }
  }
  return [...byKey.values()];
}

function renderHeaderAndControls(
  container: HTMLElement,
  state: GrammaticalPanelState,
  onSelectLemma: (lemmaId: string) => void,
  onToggleUncertain: () => void,
  onChangeEdition: (edition: string) => void,
): void {
  const res = state.response;
  if (!res) return;

  container.append(
    el(
      'p',
      'study-muted rel-disclaimer',
      `Deterministic MACULA clause & phrase grammar (${res.rule_version}, release ${res.release_version}) — syntactic subject/object/construct does not imply semantic agency or ownership.`,
    ),
  );

  const controls = el('div', 'gram-rels__controls');
  if (res.focus) {
    const focusBox = el('div', 'gram-rels__focus');
    const code = res.focus.extended_strongs || res.focus.lemma_id.replace(/^lemma:/, '');
    const bdi = document.createElement('bdi');
    bdi.dir = res.focus.language === 'greek' ? 'ltr' : 'rtl';
    bdi.textContent = `${res.focus.lemma_form} ${res.focus.transliteration ? `(${res.focus.transliteration}) ` : ''}[${code}]`;
    focusBox.append(bdi);
    if (res.focus.gloss) focusBox.append(el('span', 'study-muted', ` · "${res.focus.gloss}"`));
    if (res.resolved_occurrence) {
      focusBox.append(
        el(
          'span',
          'rel-badge',
          `Matched ${res.resolved_occurrence.reference}#${res.resolved_occurrence.word_position}`,
        ),
      );
    }
    controls.append(focusBox);
  }

  const filterBar = el('div', 'gram-rels__filters');
  const toggleBtn = action(
    state.includeUncertain ? 'Showing high-precision + candidates' : 'High precision only',
    onToggleUncertain,
    `editor-btn editor-btn--sm${state.includeUncertain ? ' is-active' : ''}`,
  );
  toggleBtn.setAttribute('aria-pressed', String(state.includeUncertain));

  const editionSelect = el('select', 'gram-rels__select') as HTMLSelectElement;
  editionSelect.setAttribute('aria-label', 'Filter by source edition');
  for (const opt of EDITIONS) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    o.selected = opt.value === state.edition;
    editionSelect.append(o);
  }
  editionSelect.addEventListener('change', () => onChangeEdition(editionSelect.value));
  filterBar.append(toggleBtn, editionSelect);
  controls.append(filterBar);

  const siblings: GrammaticalLemmaProfile[] =
    res.homograph_candidates && res.homograph_candidates.length > 0
      ? res.homograph_candidates
      : res.homograph_siblings;
  if (siblings.length > 1 || (res.homograph_candidates?.length ?? 0) > 0) {
    const sibWrap = el('div', 'gram-rels__siblings');
    sibWrap.append(
      el(
        'span',
        'study-muted',
        res.status === 'needs_disambiguation'
          ? 'Multiple Hebrew homographs match — select a distinct lemma:'
          : 'Distinct Hebrew homographs preserved:',
      ),
    );
    const pills = el('div', 'gram-rels__sibling-pills');
    for (const sib of siblings) {
      const code = sib.extended_strongs || sib.lemma_id.replace(/^lemma:/, '');
      const total = sib.outgoing_summary_count + sib.incoming_summary_count;
      const isCurrent = res.focus?.lemma_id === sib.lemma_id;
      const pill = action(
        `${sib.lemma_form} [${code}]${sib.gloss ? ` "${sib.gloss}"` : ''} (${total})`,
        () => onSelectLemma(sib.lemma_id),
        `editor-btn editor-btn--sm${isCurrent ? ' is-active' : ''}`,
      );
      pills.append(pill);
    }
    sibWrap.append(pills);
    controls.append(sibWrap);
  }

  container.append(controls);
}

// === @section:ui:main ===
export function createGrammaticalRelationshipsPanel(props: GrammaticalPanelProps) {
  const root = el('section', 'gram-rels');
  let reqSeq = 0;
  let state: GrammaticalPanelState | null = null;

  async function runQuery(nextState: GrammaticalPanelState, append: boolean) {
    const ticket = ++reqSeq;
    state = nextState;
    if (!append) root.replaceChildren(el('h4', 'rel-subheading', 'Grammatical Relationships (Syntactic Clause Roles)'), status('Loading syntactic relationships…'));

    const res = await BibleRPC.relationships.lookupGrammaticalRelationships({
      op: 'lemma_relationships',
      word_id: nextState.selectedLemmaId ? undefined : nextState.wordId,
      lemma_id: nextState.selectedLemmaId,
      extended_strongs: nextState.selectedLemmaId ? undefined : nextState.context.extendedStrongs,
      query: nextState.selectedLemmaId ? undefined : nextState.strongsNr,
      book: nextState.selectedLemmaId ? undefined : nextState.context.book,
      chapter: nextState.selectedLemmaId ? undefined : nextState.context.chapter,
      verse: nextState.selectedLemmaId ? undefined : nextState.context.verse,
      position: nextState.selectedLemmaId ? undefined : nextState.context.position,
      filter_to_passage: false,
      edition: nextState.edition || undefined,
      include_uncertain: nextState.includeUncertain,
      limit: 30,
      offset: nextState.offset,
    });
    if (ticket !== reqSeq) return;

    const data = res.data;
    const merged = append ? mergeGroups(nextState.groups, data.category_groups ?? []) : (data.category_groups ?? []);
    state = { ...nextState, response: data, groups: merged };
    props.onCountChange?.(data.counts?.summaries_total ?? merged.reduce((acc, g) => acc + g.items.length, 0));

    root.replaceChildren(el('h4', 'rel-subheading', 'Grammatical Relationships (Syntactic Clause Roles)'));
    renderHeaderAndControls(
      root,
      state,
      (lemmaId) => { if (state) void runQuery({ ...state, selectedLemmaId: lemmaId, offset: 0, groups: [] }, false); },
      () => { if (state) void runQuery({ ...state, includeUncertain: !state.includeUncertain, offset: 0, groups: [] }, false); },
      (edition) => { if (state) void runQuery({ ...state, edition, offset: 0, groups: [] }, false); },
    );

    if (data.status === 'not_covered' || data.status === 'not_found') {
      root.append(el('div', 'gram-rels__notice gram-rels__notice--uncovered',
        data.coverage_notice ?? data.error_message ?? 'Outside current published R3 grammatical slice — do not infer absence.'));
      return;
    }
    if (data.status === 'unavailable') {
      root.append(status(data.error_message ?? 'Grammatical relationship graph unavailable.'));
      return;
    }
    if (data.status === 'needs_disambiguation') {
      root.append(el('div', 'gram-rels__notice',
        data.coverage_notice ?? 'Select one of the Hebrew homograph lemmas above to view grammatical relationships.'));
      return;
    }
    if (data.status === 'no_evidence_in_covered_scope' || merged.length === 0) {
      root.append(el('div', 'gram-rels__notice',
        data.coverage_notice ?? 'Covered in the published slice, with no qualifying syntactic relations under the current filter.'));
      return;
    }

    for (const group of merged) {
      const grpEl = el('div', 'gram-rels__group');
      const grpHead = el('div', 'gram-rels__group-head');
      grpHead.append(
        el('strong', '', group.display_label),
        el('span', 'rel-badge', group.display_predicate),
        el('span', 'study-muted', `${group.summary_count} lemmas · ${group.total_occurrences} occ · ${group.total_passages} verses`),
      );
      grpEl.append(grpHead);
      if (group.guardrail) grpEl.append(el('p', 'study-muted gram-rels__guardrail', group.guardrail));

      const cards = el('div', 'rel-list');
      for (const item of group.items) cards.append(createSummaryCard(item, state.includeUncertain, props));
      grpEl.append(cards);
      root.append(grpEl);
    }

    if (data.page?.has_more && data.page.next_offset != null) {
      const nextOffset = data.page.next_offset;
      const shownCount = merged.reduce((sum, g) => sum + g.items.length, 0);
      const moreBtn = action(
        `Load more grammatical groups (${shownCount} / ${data.page.total_available})`,
        () => {
          moreBtn.disabled = true;
          if (state) void runQuery({ ...state, offset: nextOffset }, true);
        },
        'load-more',
      );
      root.append(moreBtn);
    }
  }

  return {
    element: root,
    load(wordId: number, strongsNr: string, context: GrammaticalWordContext = {}): Promise<void> {
      return runQuery({
        wordId,
        strongsNr,
        context,
        selectedLemmaId: context.preferredLemmaId,
        edition: '',
        includeUncertain: false,
        offset: 0,
        groups: [],
        response: null,
      }, false);
    },
    clear(): void {
      reqSeq++;
      state = null;
      root.replaceChildren();
    },
  };
}
