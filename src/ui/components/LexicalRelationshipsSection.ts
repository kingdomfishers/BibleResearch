// @file: src/ui/components/LexicalRelationshipsSection.ts
// @feature: word-modal
// @tables: none
// @candidates: none
// @toc: imports | types | ui:edge-card | ui:render | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import {
  isRelationshipPreviewEnabled,
  type ContextualScopeFilter,
  type LexicalDirectionFilter,
  type R9BContextualLayerResult,
  type R9BContextualNeighborItem,
  type R9BLayerKey,
  type R9BLexicalEndpoint,
  type R9BLexicalLayerResult,
  type R9BLexicalRelationItem,
  type R9BLxxLayerResult,
  type R9BLxxTranslationItem,
} from '../../api/relationships-rpc';
import type { RelationshipNotePrefill } from '../../api/relationship-notes-adapter';
import type {
  ActivePassage,
  LexicalRelationshipEdge,
  LexicalRelationshipLookupResponse,
  Note,
  ResearcherRelationshipStance,
} from '../../api/types';
import { notesState } from '../notes-state';
import { action, el, status } from '../study-dom';
import { BOOK_NAMES } from '../utils';
import type { ContextPreview } from './ContextPreview';
import {
  createGrammaticalRelationshipsPanel,
  type GrammaticalWordContext,
} from './GrammaticalRelationshipsPanel';
import { createExploreConnectionsPanel } from './ExploreConnectionsPanel';

// === @section:types ===
export interface LexicalRelationshipsSectionProps {
  onInspectTarget?: (wordId: number, lemmaId?: string) => void;
  onEvaluateRelationship?: (prefill: RelationshipNotePrefill) => void;
  preview?: ContextPreview;
  navigate?: (p: ActivePassage) => void;
}

export interface LexicalRelationshipsSectionHandle {
  element: HTMLElement;
  loadForWord: (
    wordId: number,
    strongsNr: string,
    notes?: Note[],
    context?: GrammaticalWordContext
  ) => Promise<void>;
  clear: () => void;
}

type LayerFilterTab = 'all' | R9BLayerKey | 'explore';

const BOOK_NAME_MAP: ReadonlyMap<number, string> = new Map(
  BOOK_NAMES.map((name: string, idx: number) => [idx + 1, name])
);

const TIER_LABELS: Record<string, string> = {
  attested_lexical_fact: 'Attested lexical fact',
  deterministic_computational: 'Deterministic computational',
  statistical_association: 'Statistical association',
  ai_hypothesis: 'AI hypothesis',
  human_reviewed_interpretation: 'Human-reviewed interpretation',
};

const LANG_LABELS: Record<string, string> = {
  hbo: 'Hebrew',
  arc: 'Aramaic',
  grc: 'Greek',
};

const ROLE_ARROWS: Record<string, string> = {
  outgoing: '→ outgoing',
  incoming: '← incoming',
  symmetric: '↔ symmetric',
};

const CONTEXTUAL_SCOPE_LABELS: ReadonlyArray<{ value: ContextualScopeFilter; label: string }> = [
  { value: 'all', label: 'All scopes' },
  { value: 'same_clause', label: 'Same clause' },
  { value: 'collocation', label: 'Collocation ≤3' },
  { value: 'same_verse', label: 'Same verse' },
];

const LEXICAL_DIR_LABELS: ReadonlyArray<{ value: LexicalDirectionFilter; label: string }> = [
  { value: 'both', label: 'All directions' },
  { value: 'outgoing', label: 'Outgoing' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'symmetric', label: 'Symmetric' },
];

// === @section:ui:edge-card ===
function makePeerButton(
  label: string,
  language: string | null | undefined,
  wordId: number | null | undefined,
  lemmaKey: string | null | undefined,
  props: LexicalRelationshipsSectionProps,
  onEndpointDrill?: (endpointKey: string) => void
): HTMLElement {
  const bdi = document.createElement('bdi');
  bdi.className = 'rel-card__lemma';
  bdi.dir = language === 'grc' ? 'ltr' : 'rtl';
  bdi.textContent = label;
  if (wordId && wordId > 0 && props.onInspectTarget) {
    const btn = action('', () => props.onInspectTarget?.(wordId, lemmaKey ?? undefined), 'text-action rel-card__target-btn');
    btn.replaceChildren(bdi);
    return btn;
  }
  if (lemmaKey && !lemmaKey.startsWith('lemma:') && onEndpointDrill) {
    const btn = action('', () => onEndpointDrill(lemmaKey), 'text-action rel-card__target-btn');
    btn.replaceChildren(bdi);
    return btn;
  }
  return bdi;
}

function makeEndpointDisplayLabel(ep: R9BLexicalEndpoint | undefined): string {
  if (!ep) return 'Unknown endpoint';
  const script = ep.lemma_script || ep.original_script || ep.lemma_text || ep.canonical_key || ep.key || ep.endpoint_key || '';
  const translit = ep.transliteration ? ` (${ep.transliteration})` : '';
  const code = (ep.entity_kind === 'sense' && ep.canonical_key)
    ? ep.canonical_key
    : (ep.disambiguated_strongs || ep.extended_strongs || ep.base_strongs || ep.lemma_key || ep.canonical_key || ep.key || '');
  return code && code !== script ? `${script}${translit} [${code}]` : `${script}${translit}`;
}

function makeSampleVerseLink(
  book: number,
  chapter: number,
  verse: number,
  refLabel: string,
  reason: string,
  props: LexicalRelationshipsSectionProps
): HTMLElement {
  const passage: ActivePassage = { book, chapter, verse };
  const label = refLabel || `${BOOK_NAME_MAP.get(book) ?? `Book ${book}`} ${chapter}:${verse}`;
  if (props.preview) {
    const btn = action(label, () => props.preview?.pin(passage, reason), 'reference-link');
    props.preview.attach(btn, passage, reason);
    return btn;
  }
  if (props.navigate) {
    return action(label, () => props.navigate?.(passage), 'reference-link');
  }
  return el('span', 'study-muted', label);
}

function createV2LexicalCard(
  item: R9BLexicalRelationItem,
  matchedNotes: Note[],
  props: LexicalRelationshipsSectionProps,
  onEndpointDrill?: (endpointKey: string) => void
): HTMLElement {
  const card = el('article', 'rel-card');
  const head = el('div', 'rel-card__head');
  const peer = item.peer;
  const peerKey = peer.canonical_key || peer.key || peer.endpoint_key || peer.lemma_key || (typeof peer.lemma_id === 'string' ? peer.lemma_id : null);
  const peerWordId = peer.word_id ?? null;
  head.append(
    makePeerButton(
      makeEndpointDisplayLabel(peer),
      peer.language,
      peerWordId,
      peerKey,
      props,
      onEndpointDrill
    ),
    el('span', 'rel-badge', ROLE_ARROWS[item.role] ?? item.role),
    el('span', 'rel-badge', item.category.replace(/_/g, ' ')),
    el('span', 'rel-badge rel-badge--tier', TIER_LABELS[item.epistemic_tier] ?? item.epistemic_tier),
    ...(peer.language ? [el('span', 'rel-badge', LANG_LABELS[peer.language] ?? peer.language)] : [])
  );
  card.append(head);

  if (item.explanation) card.append(el('p', 'rel-card__why', item.explanation));
  if (peer.primary_gloss) card.append(el('p', 'study-muted', `Peer gloss: ${peer.primary_gloss}`));

  const provTitle = item.provenance?.source_title || 'STEPBible / BibleOntology';
  const license = item.provenance?.license ? ` · ${item.provenance.license}` : '';
  const impliesSyn = item.guardrails && item.guardrails.implies_synonymy === true;
  const guardText = impliesSyn ? 'Source-attested synonymy' : 'Shared root/form does not imply synonymy';
  card.append(el('p', 'study-muted rel-card__prov', `Source: ${provTitle}${license} · ${guardText}`));

  if (matchedNotes.length > 0) {
    const stances = matchedNotes
      .map(n => BibleRPC.relationships.extractRelationshipEvaluation(n)?.stance ?? 'noted')
      .join(', ');
    card.append(el('p', 'rel-card__notes-count', `Researcher notes (${matchedNotes.length}): ${stances.replace(/_/g, ' ')}`));
  }
  return card;
}

function createLexicalEdgeCard(
  edge: LexicalRelationshipEdge,
  matchedNotes: Note[],
  props: LexicalRelationshipsSectionProps
): HTMLElement {
  const card = el('article', 'rel-card');
  const head = el('div', 'rel-card__head');
  const code = edge.target.disambiguated_strongs || edge.target.extended_strongs || edge.target.base_strongs || '';
  const label = `${edge.target.lemma_text} (${edge.target.transliteration ?? ''}) [${code}]`;
  head.append(
    makePeerButton(label, edge.target.language, edge.target.word_id, null, props),
    el('span', 'rel-badge', edge.category.replace(/_/g, ' ')),
    el('span', 'rel-badge rel-badge--tier', TIER_LABELS[edge.epistemic_tier] ?? edge.epistemic_tier),
    el('span', 'rel-badge', LANG_LABELS[edge.target.language] ?? edge.target.language)
  );
  card.append(head);

  card.append(el('p', 'rel-card__why', edge.explanation));
  if (edge.target.primary_gloss) {
    card.append(el('p', 'study-muted', `Target gloss: ${edge.target.primary_gloss}`));
  }

  const guardNote = !edge.guardrails.implies_synonymy && !edge.guardrails.implies_common_etymology
    ? ' · Non-etymological / non-synonymous'
    : !edge.guardrails.implies_synonymy
      ? ' · Does not imply synonymy'
      : ' · Source-attested synonymy';
  card.append(
    el('p', 'study-muted rel-card__prov', `Source: ${edge.provenance.source_title} (${edge.reused_source_table})${guardNote}`)
  );

  if (matchedNotes.length > 0) {
    const stances = matchedNotes
      .map(n => BibleRPC.relationships.extractRelationshipEvaluation(n)?.stance ?? 'noted')
      .join(', ');
    card.append(el('p', 'rel-card__notes-count', `Researcher notes (${matchedNotes.length}): ${stances.replace(/_/g, ' ')}`));
  }

  if (props.onEvaluateRelationship) {
    const actions = el('div', 'rel-card__actions');
    const stances: Array<[ResearcherRelationshipStance, string]> = [
      ['agree', 'Note: Agree'],
      ['disagree', 'Disagree'],
      ['alternative_interpretation', 'Alternative'],
    ];
    for (const [stance, text] of stances) {
      actions.append(
        action(text, () => {
          const selectedNoteId = notesState.getSelectedNoteId();
          const prefill = BibleRPC.relationships.buildNotePrefillFromLexicalEdge(edge, {
            stance,
            bookNamesById: BOOK_NAME_MAP,
            connectToNote: selectedNoteId ? { id: selectedNoteId } : null,
          });
          props.onEvaluateRelationship?.(prefill);
        }, 'editor-btn editor-btn--sm')
      );
    }
    card.append(actions);
  }
  return card;
}

function createContextualCard(
  item: R9BContextualNeighborItem,
  props: LexicalRelationshipsSectionProps
): HTMLElement {
  const card = el('article', 'rel-card gram-card');
  const head = el('div', 'rel-card__head');
  const label = [
    item.target_lemma_script || item.target_lemma_key,
    item.target_transliteration ? `(${item.target_transliteration})` : '',
    item.target_base_strongs ? `[${item.target_base_strongs}]` : '',
  ].filter(Boolean).join(' ');

  head.append(
    makePeerButton(label, item.target_language, item.target_word_id, item.target_lemma_key, props),
    ...(item.target_language ? [el('span', 'rel-badge', LANG_LABELS[item.target_language] ?? item.target_language)] : []),
    el('span', 'gram-badge gram-badge--occ', `${item.counts.same_verse} verses`)
  );
  card.append(head);

  if (item.target_primary_gloss) {
    card.append(el('p', 'study-muted', `Gloss: ${item.target_primary_gloss}`));
  }

  const verseStats = el(
    'p',
    'rel-card__why',
    `Distinct verses: ${item.counts.same_verse} same-verse · ${item.counts.same_clause} same-clause · ${item.counts.collocation_distance_le_3} collocation ≤3 · ${item.counts.near_verse_window_distance_le_3} near-window`
  );
  const occStats = el(
    'p',
    'study-muted',
    `Occurrences (separate unit): ${item.occurrence_counts.same_clause_instances} same-clause instances · ${item.occurrence_counts.strict_collocation_token_pairs} collocation token pairs`
  );
  card.append(verseStats, occStats);

  if (item.sample_passages?.length) {
    const det = el('details', 'gram-card__evidence');
    det.append(el('summary', '', `Sample passages (${item.sample_passages.length})`));
    const ul = el('div', 'r9b-sample-list');
    for (const p of item.sample_passages) {
      const row = el('span', 'gram-ref-chip');
      const flags = [
        p.in_same_clause ? 'clause' : null,
        p.is_collocation ? 'colloc≤3' : null,
        !p.in_same_clause && p.near_verse_window ? 'window≤3' : null,
      ].filter(Boolean).join('/');
      const reason = `Contextual co-occurrence (${flags || 'same verse'})`;
      row.append(makeSampleVerseLink(p.book, p.chapter, p.verse, p.ref ?? '', reason, props));
      if (flags) row.append(el('span', 'gram-badge', flags));
      ul.append(row);
    }
    det.append(ul);
    card.append(det);
  }
  return card;
}

function createLxxCard(
  item: R9BLxxTranslationItem,
  direction: string | null | undefined,
  props: LexicalRelationshipsSectionProps
): HTMLElement {
  const card = el('article', 'rel-card');
  const head = el('div', 'rel-card__head');
  const isHebToGk = direction !== 'greek_to_hebrew';
  const candidates = isHebToGk ? item.greek_candidates : item.hebrew_candidates;
  const fallbackKeys = isHebToGk ? item.greek_lemma_keys : item.hebrew_lemma_keys;

  if (candidates && candidates.length > 0) {
    for (const c of candidates) {
      const code = c.extended_strongs || c.lemma_key || '';
      const script = c.original_script || (c as unknown as { lemma_script?: string | null }).lemma_script || code;
      const label = [script, c.transliteration ? `(${c.transliteration})` : '', code ? `[${code}]` : '']
        .filter(Boolean)
        .join(' ');
      head.append(makePeerButton(label, c.language, c.word_id, c.lemma_key, props));
    }
  } else if (fallbackKeys && fallbackKeys.length > 0) {
    head.append(el('span', 'rel-card__lemma', fallbackKeys.join(', ')));
  } else {
    head.append(el('span', 'rel-card__lemma', isHebToGk ? item.greek_strong ?? item.edge_id : item.hebrew_strong ?? item.edge_id));
  }

  const pct = (item.translation_share * 100).toFixed(1);
  head.append(
    el('span', 'gram-badge gram-badge--occ', `${item.published_count} attested (${pct}%)`),
    ...(item.mapping_status ? [el('span', 'rel-badge', item.mapping_status.replace(/_/g, ' '))] : []),
    ...(item.homograph_ambiguity ? [el('span', 'gram-badge gram-badge--cand', 'Homograph ambiguity')] : [])
  );
  card.append(head);

  if (candidates && candidates.length > 0) {
    const glosses = candidates
      .map(c => {
        const g = c.primary_gloss || (c as unknown as { gloss?: string | null }).gloss;
        return g ? `${c.extended_strongs || c.lemma_key}: ${g}` : null;
      })
      .filter(Boolean)
      .join(' · ');
    if (glosses) card.append(el('p', 'study-muted', glosses));
  }
  return card;
}

// === @section:ui:render ===
function renderLegacyLexicalPacket(
  lexBox: HTMLElement,
  packet: LexicalRelationshipLookupResponse,
  notes: Note[],
  props: LexicalRelationshipsSectionProps
): number {
  lexBox.replaceChildren(el('h4', 'rel-subheading', 'Lexical & Root Connections'));
  if (packet.status !== 'ok') {
    lexBox.append(status(packet.error_message ?? 'No extended lexical graph slice entry for this word.'));
    return 0;
  }

  lexBox.append(
    el(
      'p',
      'study-muted rel-disclaimer',
      'Categories and epistemic tiers are strictly separated: shared English translations or spelling overlap never imply synonymy or common etymology.'
    )
  );

  if (packet.homograph_siblings.length > 0) {
    const homoRow = el('p', 'study-muted');
    const codes = packet.homograph_siblings
      .map(h => `${h.disambiguated_strongs || h.extended_strongs} (${h.primary_gloss ?? ''})`)
      .join(' · ');
    homoRow.textContent = `Homograph siblings preserved: ${codes}`;
    lexBox.append(homoRow);
  }

  const notesMap = BibleRPC.relationships.indexNotesByRelationshipId(notes);
  const list = el('div', 'rel-list');
  for (const edge of packet.edges) {
    list.append(createLexicalEdgeCard(edge, notesMap.get(edge.relationship_id) ?? [], props));
  }
  if (!packet.edges.length) {
    lexBox.append(status('No lexical relationships recorded for this word.'));
  } else {
    lexBox.append(list);
  }
  return packet.page.total_available;
}

function makeFilterPills<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  active: T,
  onSelect: (value: T) => void
): HTMLElement {
  const row = el('div', 'r9b-filter-pills');
  for (const opt of options) {
    const btn = action(
      opt.label,
      () => onSelect(opt.value),
      opt.value === active ? 'r9b-pill is-active' : 'r9b-pill'
    );
    row.append(btn);
  }
  return row;
}

// === @section:ui:main ===
export function createLexicalRelationshipsSection(
  props: LexicalRelationshipsSectionProps
): LexicalRelationshipsSectionHandle {
  const details = el('details', 'study-disclosure lexical-rels');
  const summaryEl = el('summary', '', 'Relationships · 4 Evidence Layers');
  const body = el('div', 'lexical-rels__body');
  const tabBar = el('div', 'r9b-layer-tabs');
  const lexBox = el('section', 'lex-rels-panel');
  const ctxBox = el('section', 'lex-rels-panel r9b-ctx-panel');
  const lxxBox = el('section', 'lex-rels-panel r9b-lxx-panel');

  let activeTab: LayerFilterTab = 'all';
  let gramCount: number | null = null;
  let lexCount: number | null = null;
  let ctxCount: number | null = null;
  let lxxCount: number | null = null;
  let reqCounter = 0;

  let currentBaseParams: {
    wordId: number;
    strongsNr: string;
    notes: Note[];
    context: GrammaticalWordContext;
    lemmaId?: string;
  } | null = null;

  let lexicalState: {
    direction: LexicalDirectionFilter;
    category: string;
    endpointKey?: string;
    items: R9BLexicalRelationItem[];
    layer: R9BLexicalLayerResult | null;
  } = { direction: 'both', category: '', items: [], layer: null };

  let contextualState: {
    scope: ContextualScopeFilter;
    items: R9BContextualNeighborItem[];
    layer: R9BContextualLayerResult | null;
  } = { scope: 'all', items: [], layer: null };

  let lxxState: {
    items: R9BLxxTranslationItem[];
    layer: R9BLxxLayerResult | null;
  } = { items: [], layer: null };

  const gramPanel = createGrammaticalRelationshipsPanel({
    onInspectTarget: props.onInspectTarget,
    preview: props.preview,
    navigate: props.navigate,
    onCountChange: (count) => {
      gramCount = count;
      updateSummaryAndTabs();
    },
  });

  const previewEnabled = isRelationshipPreviewEnabled();
  const explorePanel = createExploreConnectionsPanel({
    onInspectTarget: props.onInspectTarget,
    preview: props.preview,
    navigate: props.navigate,
  });

  function syncTabVisibility() {
    gramPanel.element.hidden = activeTab !== 'all' && activeTab !== 'grammatical';
    lexBox.hidden = activeTab !== 'all' && activeTab !== 'lexical';
    ctxBox.hidden = activeTab !== 'all' && activeTab !== 'contextual';
    lxxBox.hidden = activeTab !== 'all' && activeTab !== 'lxx_translation';
    explorePanel.element.hidden = !previewEnabled || activeTab !== 'explore';
  }

  function updateSummaryAndTabs() {
    const fmt = (n: number | null) => (n === null ? '…' : n.toLocaleString());
    summaryEl.textContent =
      gramCount === null && lexCount === null && ctxCount === null && lxxCount === null
        ? 'Relationships · 4 Evidence Layers'
        : `Relationships · Gram (${fmt(gramCount)}) · Lex (${fmt(lexCount)}) · Ctx (${fmt(ctxCount)}) · LXX (${fmt(lxxCount)})`;

    const tabs: Array<{ id: LayerFilterTab; label: string }> = [
      { id: 'all', label: 'All layers' },
      { id: 'grammatical', label: `Grammatical (${fmt(gramCount)})` },
      { id: 'lexical', label: `Lexical (${fmt(lexCount)})` },
      { id: 'contextual', label: `Contextual (${fmt(ctxCount)})` },
      { id: 'lxx_translation', label: `LXX (${fmt(lxxCount)})` },
      ...(previewEnabled ? [{ id: 'explore' as const, label: 'Explore Paths' }] : []),
    ];
    tabBar.replaceChildren(
      ...tabs.map(t =>
        action(
          t.label,
          () => {
            activeTab = t.id;
            syncTabVisibility();
            updateSummaryAndTabs();
          },
          activeTab === t.id ? 'r9b-tab is-active' : 'r9b-tab'
        )
      )
    );
    syncTabVisibility();
  }

  function buildTargetLookupArgs() {
    if (!currentBaseParams) return {};
    const { wordId, strongsNr, context, lemmaId } = currentBaseParams;
    return {
      word_id: lemmaId ? undefined : wordId,
      lemma_id: lemmaId,
      extended_strongs: lemmaId ? undefined : context.extendedStrongs,
      query: lemmaId ? undefined : strongsNr,
      book: lemmaId ? undefined : context.book,
      chapter: lemmaId ? undefined : context.chapter,
      verse: lemmaId ? undefined : context.verse,
      position: lemmaId ? undefined : context.position,
    };
  }

  function renderV2LexicalPanel() {
    lexBox.replaceChildren(el('h4', 'rel-subheading', 'Lexical Relationships (Roots, Senses & Formations)'));
    const layer = lexicalState.layer;
    if (!layer || !layer.available) {
      lexBox.append(status('No extended R9B lexical shard entry for this word.'));
      return;
    }

    lexBox.append(
      el(
        'p',
        'study-muted rel-disclaimer',
        'Bidirectional lexical graph preserving single canonical edges. Shared roots or spelling overlap never prove synonymy.'
      )
    );

    if (lexicalState.endpointKey) {
      const drillBanner = el('div', 'r9b-toolbar');
      drillBanner.append(
        el('span', 'study-muted', `Inspecting endpoint: ${lexicalState.endpointKey}`),
        action('← Back to lemma', () => {
          lexicalState.endpointKey = undefined;
          void reloadLexical(0, false);
        }, 'text-action')
      );
      lexBox.append(drillBanner);
    }

    const controls = el('div', 'r9b-toolbar');
    controls.append(
      makeFilterPills(LEXICAL_DIR_LABELS, lexicalState.direction, (dir) => {
        lexicalState.direction = dir;
        void reloadLexical(0, false);
      })
    );
    lexBox.append(controls);

    const items = lexicalState.items;
    if (!items.length) {
      lexBox.append(status('No lexical relationships match the current filter.'));
      return;
    }

    const notesMap = BibleRPC.relationships.indexNotesByRelationshipId(currentBaseParams?.notes ?? []);
    const list = el('div', 'rel-list');
    for (const item of items) {
      list.append(
        createV2LexicalCard(item, notesMap.get(item.relationship_id) ?? [], props, (endpointKey) => {
          lexicalState.endpointKey = endpointKey;
          void reloadLexical(0, false);
        })
      );
    }
    lexBox.append(list);

    if (layer.page.has_more && layer.page.next_offset != null) {
      const nextOffset = layer.page.next_offset;
      const moreBtn = action(
        `Load more lexical relations (${items.length.toLocaleString()} / ${layer.page.total_available.toLocaleString()})`,
        () => {
          moreBtn.disabled = true;
          void reloadLexical(nextOffset, true);
        },
        'load-more'
      );
      lexBox.append(moreBtn);
    }
  }

  async function reloadLexical(offset: number, append: boolean) {
    if (!currentBaseParams) return;
    const ticket = reqCounter;
    const res = await BibleRPC.relationships.lookupLexicalRelationsV2({
      ...buildTargetLookupArgs(),
      endpoint_key: lexicalState.endpointKey,
      lexical_direction: lexicalState.direction,
      lexical_categories: lexicalState.category ? [lexicalState.category] : undefined,
      lexical_limit: 25,
      lexical_offset: offset,
      limit: 25,
      offset,
    });
    if (ticket !== reqCounter) return;
    const nextLayer = res.data.lexical ?? res.data.layers?.lexical ?? null;
    if (!nextLayer) return;
    lexicalState = {
      ...lexicalState,
      layer: nextLayer,
      items: append ? [...lexicalState.items, ...nextLayer.items] : nextLayer.items,
    };
    if (!lexicalState.endpointKey) {
      lexCount = nextLayer.counts.total_unfiltered;
      updateSummaryAndTabs();
    }
    renderV2LexicalPanel();
  }

  function renderContextualPanel() {
    ctxBox.replaceChildren(el('h4', 'rel-subheading', 'Contextual Associations (Co-occurrence & Proximity)'));
    const layer = contextualState.layer;
    if (!layer || !layer.available) {
      ctxBox.append(status('No contextual adjacency index entry for this word.'));
      return;
    }

    ctxBox.append(
      el(
        'p',
        'study-muted rel-disclaimer',
        'Statistical corpus co-occurrence only — proximity does not prove grammatical dependency, causality, or synonymy. Distinct verses and token/clause occurrences are reported separately.'
      )
    );

    const controls = el('div', 'r9b-toolbar');
    controls.append(
      makeFilterPills(CONTEXTUAL_SCOPE_LABELS, contextualState.scope, (scope) => {
        contextualState.scope = scope;
        void reloadContextual(0, false);
      }),
      el(
        'span',
        'study-muted',
        `${layer.counts.filtered_total.toLocaleString()} matching (${layer.counts.total_neighbors.toLocaleString()} lossless total)`
      )
    );
    ctxBox.append(controls);

    if (!contextualState.items.length) {
      ctxBox.append(status('No contextual partners match the selected scope filter.'));
      return;
    }

    const list = el('div', 'rel-list');
    for (const item of contextualState.items) {
      list.append(createContextualCard(item, props));
    }
    ctxBox.append(list);

    if (layer.page.has_more && layer.page.next_offset != null) {
      const nextOffset = layer.page.next_offset;
      const moreBtn = action(
        `Load more contextual neighbors (${contextualState.items.length.toLocaleString()} / ${layer.page.total_available.toLocaleString()})`,
        () => {
          moreBtn.disabled = true;
          void reloadContextual(nextOffset, true);
        },
        'load-more'
      );
      ctxBox.append(moreBtn);
    }
  }

  async function reloadContextual(offset: number, append: boolean) {
    if (!currentBaseParams) return;
    const ticket = reqCounter;
    const res = await BibleRPC.relationships.lookupContextualNeighborsPage({
      ...buildTargetLookupArgs(),
      contextual_scope: contextualState.scope,
      contextual_limit: 25,
      contextual_offset: offset,
      limit: 25,
      offset,
    });
    if (ticket !== reqCounter) return;
    const nextLayer = res.data.contextual ?? res.data.layers?.contextual ?? null;
    if (!nextLayer) return;
    contextualState = {
      ...contextualState,
      layer: nextLayer,
      items: append ? [...contextualState.items, ...nextLayer.items] : nextLayer.items,
    };
    ctxCount = nextLayer.counts.total_neighbors;
    updateSummaryAndTabs();
    renderContextualPanel();
  }

  function renderLxxPanel() {
    lxxBox.replaceChildren(el('h4', 'rel-subheading', 'Septuagint (LXX) Translation Candidates'));
    const layer = lxxState.layer;
    if (!layer || !layer.available) {
      lxxBox.append(status('No Septuagint translation bridge entries for this word.'));
      return;
    }

    const dirLabel = layer.direction === 'greek_to_hebrew' ? 'Greek → Hebrew candidates' : 'Hebrew → Greek candidates';
    lxxBox.append(
      el(
        'p',
        'study-muted rel-disclaimer',
        `${dirLabel} (${layer.counts.candidate_count} candidates · ${layer.counts.total_attested_renderings.toLocaleString()} attested renderings, CC BY 4.0). Translation correspondence never establishes semantic identity.`
      )
    );

    if (!lxxState.items.length) {
      lxxBox.append(status('No Septuagint translation candidates recorded for this lemma.'));
      return;
    }

    const list = el('div', 'rel-list');
    for (const item of lxxState.items) {
      list.append(createLxxCard(item, layer.direction, props));
    }
    lxxBox.append(list);

    if (layer.page.has_more && layer.page.next_offset != null) {
      const nextOffset = layer.page.next_offset;
      const moreBtn = action(
        `Load more LXX candidates (${lxxState.items.length.toLocaleString()} / ${layer.page.total_available.toLocaleString()})`,
        () => {
          moreBtn.disabled = true;
          void reloadLxx(nextOffset, true);
        },
        'load-more'
      );
      lxxBox.append(moreBtn);
    }
  }

  async function reloadLxx(offset: number, append: boolean) {
    if (!currentBaseParams) return;
    const ticket = reqCounter;
    const res = await BibleRPC.relationships.lookupLxxTranslations({
      ...buildTargetLookupArgs(),
      lxx_limit: 25,
      lxx_offset: offset,
      limit: 25,
      offset,
    });
    if (ticket !== reqCounter) return;
    const nextLayer = res.data.lxx_translation ?? res.data.layers?.lxx_translation ?? null;
    if (!nextLayer) return;
    lxxState = {
      layer: nextLayer,
      items: append ? [...lxxState.items, ...nextLayer.items] : nextLayer.items,
    };
    lxxCount = nextLayer.counts.candidate_count;
    updateSummaryAndTabs();
    renderLxxPanel();
  }

  body.append(tabBar, gramPanel.element, lexBox, ctxBox, lxxBox, explorePanel.element);
  details.append(summaryEl, body);
  updateSummaryAndTabs();

  return {
    element: details,
    async loadForWord(
      wordId: number,
      strongsNr: string,
      notes: Note[] = [],
      context: GrammaticalWordContext = {}
    ): Promise<void> {
      const current = ++reqCounter;
      gramCount = null;
      lexCount = null;
      ctxCount = null;
      lxxCount = null;
      currentBaseParams = {
        wordId,
        strongsNr,
        notes,
        context,
        lemmaId: context.preferredLemmaId,
      };
      lexicalState = { direction: 'both', category: '', items: [], layer: null };
      contextualState = { scope: 'all', items: [], layer: null };
      lxxState = { items: [], layer: null };
      updateSummaryAndTabs();

      lexBox.replaceChildren(el('h4', 'rel-subheading', 'Lexical Relationships (Roots, Senses & Formations)'), status('Loading lexical relationships…'));
      ctxBox.replaceChildren(el('h4', 'rel-subheading', 'Contextual Associations (Co-occurrence & Proximity)'), status('Loading contextual associations…'));
      lxxBox.replaceChildren(el('h4', 'rel-subheading', 'Septuagint (LXX) Translation Candidates'), status('Loading LXX bridge candidates…'));

      const gramPromise = gramPanel.load(wordId, strongsNr, context);
      const unifiedPromise = BibleRPC.relationships.lookupUnifiedWordRelationships({
        ...buildTargetLookupArgs(),
        layers: ['lexical', 'contextual', 'lxx_translation'],
        lexical_direction: 'both',
        lexical_limit: 25,
        contextual_scope: 'all',
        contextual_limit: 25,
        lxx_limit: 25,
      });

      const [, unifiedRes] = await Promise.all([gramPromise, unifiedPromise]);
      if (current !== reqCounter) return;

      const uData = unifiedRes.data;
      if (uData.focus?.lemma_id) {
        currentBaseParams.lemmaId = uData.focus.lemma_id;
        explorePanel.setSource(
          uData.focus.lemma_id,
          uData.focus.lemma_form || uData.focus.transliteration || undefined
        );
      } else {
        const fallbackKey = context.extendedStrongs
          ? `lemma:${context.extendedStrongs}`
          : strongsNr
            ? `lemma:${strongsNr}`
            : null;
        explorePanel.setSource(fallbackKey);
      }

      const lexLayer = uData.layers?.lexical ?? null;
      if (lexLayer && lexLayer.available) {
        lexicalState = { direction: 'both', category: '', items: lexLayer.items, layer: lexLayer };
        lexCount = lexLayer.counts.total_unfiltered;
        renderV2LexicalPanel();
      } else {
        const legacyRes = await BibleRPC.relationships.lookupLexicalRelationships({
          word_id: wordId,
          query: strongsNr,
          include_statistical: true,
          limit: 30,
        });
        if (current !== reqCounter) return;
        lexCount = renderLegacyLexicalPacket(lexBox, legacyRes.data, notes, props);
      }

      const ctxLayer = uData.layers?.contextual ?? null;
      if (ctxLayer) {
        contextualState = { scope: 'all', items: ctxLayer.items, layer: ctxLayer };
        ctxCount = ctxLayer.available ? ctxLayer.counts.total_neighbors : 0;
        renderContextualPanel();
      } else {
        ctxCount = 0;
        ctxBox.replaceChildren(
          el('h4', 'rel-subheading', 'Contextual Associations (Co-occurrence & Proximity)'),
          status('Contextual index unavailable on current gateway.')
        );
      }

      const lxxLayer = uData.layers?.lxx_translation ?? null;
      if (lxxLayer) {
        lxxState = { items: lxxLayer.items, layer: lxxLayer };
        lxxCount = lxxLayer.available ? lxxLayer.counts.candidate_count : 0;
        renderLxxPanel();
      } else {
        lxxCount = 0;
        lxxBox.replaceChildren(
          el('h4', 'rel-subheading', 'Septuagint (LXX) Translation Candidates'),
          status('LXX translation index unavailable on current gateway.')
        );
      }

      updateSummaryAndTabs();
    },
    clear(): void {
      reqCounter++;
      currentBaseParams = null;
      gramCount = null;
      lexCount = null;
      ctxCount = null;
      lxxCount = null;
      lexicalState = { direction: 'both', category: '', items: [], layer: null };
      contextualState = { scope: 'all', items: [], layer: null };
      lxxState = { items: [], layer: null };
      updateSummaryAndTabs();
      gramPanel.clear();
      lexBox.replaceChildren();
      ctxBox.replaceChildren();
      lxxBox.replaceChildren();
      explorePanel.clear();
    },
  };
}
