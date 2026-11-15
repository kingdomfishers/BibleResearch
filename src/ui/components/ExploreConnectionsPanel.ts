// @file: src/ui/components/ExploreConnectionsPanel.ts
// @feature: word-modal
// @tables: none
// @candidates: none
// @toc: imports | types | ui:render | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type {
  ConceptResolutionResult,
  GraphLayer,
  MultiHopPath,
  MultiHopResult,
} from '../../api/relationships-rpc';
import type {
  ConceptCandidate,
  GraphEntityRef,
} from '../../relationships/multihop-types';
import type { ActivePassage } from '../../api/types';
import { action, el, status } from '../study-dom';
import type { ContextPreview } from './ContextPreview';

// === @section:types ===
export interface ExploreConnectionsPanelProps {
  onInspectTarget?: (wordId: number, lemmaId?: string) => void;
  preview?: ContextPreview;
  navigate?: (p: ActivePassage) => void;
}

export interface ExploreConnectionsPanelHandle {
  element: HTMLElement;
  setSource: (sourceKey: string | null, displayLabel?: string) => void;
  clear: () => void;
}

const BOOK_BY_OSIS: ReadonlyMap<string, number> = new Map(
  [
    'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
    '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
    'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
    'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT',
    'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP',
    'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE',
    '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
  ].map((code, idx) => [code, idx + 1])
);

const LAYER_LABELS: ReadonlyArray<{ id: GraphLayer; label: string }> = [
  { id: 'grammatical', label: 'Grammatical' },
  { id: 'lexical', label: 'Lexical' },
  { id: 'contextual', label: 'Contextual' },
  { id: 'lxx_translation', label: 'LXX' },
];

const EPISTEMIC_LABELS: Record<string, string> = {
  direct_attested_grammar: 'Attested grammar',
  attested_lexical_fact: 'Attested lexical fact',
  statistical_association: 'Statistical co-occurrence',
  translation_correspondence: 'LXX translation candidate',
};

const JOIN_SCOPE_LABELS: Record<string, string> = {
  direct: 'Direct edge',
  same_frame: 'Same clause frame',
  same_passage: 'Same verse overlap',
  cross_passage: 'Cross-passage join',
  lexical_or_translation_bridge: 'Lexical / LXX bridge',
};

function parseReference(ref: string): ActivePassage | null {
  const m = /^([1-3]?[A-Za-z]+)\s+(\d+):(\d+)/.exec(ref.trim());
  if (!m) return null;
  const book = BOOK_BY_OSIS.get(m[1].toUpperCase());
  if (!book) return null;
  const chapter = Number(m[2]);
  const verse = Number(m[3]);
  if (!Number.isInteger(chapter) || !Number.isInteger(verse)) return null;
  return { book, chapter, verse };
}

function makeEntityLabel(ent: GraphEntityRef | { entity_key: string }): string {
  if ('label' in ent && ent.label) {
    const code = ent.entity_key.replace(/^lemma:/, '');
    const tr = ent.transliteration ? ` (${ent.transliteration})` : '';
    return code && code !== ent.label ? `${ent.label}${tr} [${code}]` : `${ent.label}${tr}`;
  }
  return ent.entity_key;
}

// === @section:ui:main ===
export function createExploreConnectionsPanel(
  props: ExploreConnectionsPanelProps
): ExploreConnectionsPanelHandle {
  const root = el('section', 'lex-rels-panel r9c-explore-panel');
  const header = el('h4', 'rel-subheading', 'Explore Multi-Hop Connections (Preview)');
  const disclaimer = el(
    'p',
    'study-muted rel-disclaimer',
    'Explores 1–3 hop chains across grammatical, lexical, contextual, and LXX layers. Scores rank evidence strength only — never theological equivalence or truth probability.'
  );

  const form = el('form', 'r9c-form');
  const sourceBanner = el('div', 'r9c-source-row');
  const targetInput = document.createElement('input');
  targetInput.type = 'text';
  targetInput.className = 'r9c-input';
  targetInput.placeholder = "Target Strong's, lemma:G4151, or concept (blank = open exploration)";
  targetInput.setAttribute('aria-label', 'Target lemma or research concept');

  const controlsRow = el('div', 'r9b-toolbar r9c-controls');
  const hopPills = el('div', 'r9b-filter-pills');
  const layerPills = el('div', 'r9b-filter-pills');
  const actionRow = el('div', 'r9c-actions');
  const exploreBtn = action('Explore paths', () => {
    void runExploration(false);
  }, 'r9b-tab is-active r9c-submit');
  exploreBtn.type = 'submit';
  const clearTargetBtn = action('Clear target', () => {
    targetInput.value = '';
    selectedTargetKey = null;
    candidatesBox.replaceChildren();
    void runExploration(false);
  }, 'r9b-pill');
  actionRow.append(exploreBtn, clearTargetBtn);

  controlsRow.append(hopPills, layerPills);
  form.append(sourceBanner, targetInput, controlsRow, actionRow);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void runExploration(false);
  });
  targetInput.addEventListener('input', () => {
    selectedTargetKey = null;
  });

  const candidatesBox = el('div', 'r9c-candidates');
  const resultsBox = el('div', 'r9c-results');
  root.append(header, disclaimer, form, candidatesBox, resultsBox);

  let sourceKey: string | null = null;
  let sourceLabel: string | null = null;
  let selectedTargetKey: string | null = null;
  let maxHops: 1 | 2 | 3 = 2;
  let activeLayers = new Set<GraphLayer>(['grammatical', 'lexical', 'contextual', 'lxx_translation']);
  let paths: MultiHopPath[] = [];
  let lastResult: MultiHopResult | null = null;
  let reqSeq = 0;

  function renderControls() {
    sourceBanner.replaceChildren(
      el('span', 'study-muted', sourceKey ? `Starting word: ${sourceLabel ? `${sourceLabel} · ` : ''}${sourceKey}` : 'Resolving starting lemma…')
    );

    hopPills.replaceChildren(
      ...[1, 2, 3].map((h) =>
        action(
          `${h} hop${h > 1 ? 's' : ''}`,
          () => {
            maxHops = h as 1 | 2 | 3;
            renderControls();
          },
          maxHops === h ? 'r9b-pill is-active' : 'r9b-pill'
        )
      )
    );

    layerPills.replaceChildren(
      ...LAYER_LABELS.map((l) =>
        action(
          l.label,
          () => {
            if (activeLayers.has(l.id) && activeLayers.size > 1) activeLayers.delete(l.id);
            else activeLayers.add(l.id);
            renderControls();
          },
          activeLayers.has(l.id) ? 'r9b-pill is-active' : 'r9b-pill'
        )
      )
    );
  }

  async function inspectEntityNode(ent: GraphEntityRef) {
    if (ent.entity_kind !== 'lemma') {
      targetInput.value = ent.entity_key;
      selectedTargetKey = ent.entity_key;
      return;
    }
    if (!props.onInspectTarget) return;
    const rawCode = ent.entity_key.replace(/^lemma:/i, '');
    const id = (await BibleRPC.resolveWordId(rawCode))
      ?? (ent.strongs_base ? await BibleRPC.resolveWordId(ent.strongs_base) : null);
    if (id && id > 0) {
      props.onInspectTarget(id, ent.entity_key);
    }
  }

  function renderCandidatePicker(res: ConceptResolutionResult) {
    candidatesBox.replaceChildren();
    if (!res.candidates.length) {
      candidatesBox.append(status(res.guidance || `No matches for "${res.query}".`));
      return;
    }
    candidatesBox.append(
      el('p', 'study-muted r9c-guidance', res.guidance || 'Select a canonical lemma candidate:')
    );
    const list = el('div', 'r9c-candidate-list');
    for (const cand of res.candidates.slice(0, 12)) {
      list.append(createCandidateButton(cand));
    }
    candidatesBox.append(list);
  }

  function createCandidateButton(cand: ConceptCandidate): HTMLButtonElement {
    const code = cand.extended_strongs || cand.entity_key.replace(/^lemma:/, '');
    const label = [
      cand.label,
      cand.transliteration ? `(${cand.transliteration})` : '',
      `[${code}]`,
      cand.gloss ? `— ${cand.gloss}` : '',
    ].filter(Boolean).join(' ');
    return action(
      label,
      () => {
        selectedTargetKey = cand.entity_key;
        targetInput.value = cand.entity_key;
        candidatesBox.replaceChildren();
        void runExploration(false);
      },
      'r9b-pill r9c-cand-btn'
    );
  }

  function renderPathCard(path: MultiHopPath): HTMLElement {
    const card = el('article', 'rel-card r9c-path-card');
    const chainRow = el('div', 'r9c-chain');
    path.entities.forEach((ent, idx) => {
      if (idx > 0) {
        const step = path.steps[idx - 1];
        const edgePill = el('span', 'r9c-edge-pill', `→ ${step.display_label}`);
        edgePill.title = `${step.layer} · ${step.source_relationship_id}`;
        chainRow.append(edgePill);
      }
      const label = makeEntityLabel(ent);
      const bdi = document.createElement('bdi');
      bdi.dir = ent.language === 'grc' ? 'ltr' : 'rtl';
      bdi.textContent = label;
      if (ent.entity_kind === 'lemma' && props.onInspectTarget) {
        const btn = action('', () => {
          void inspectEntityNode(ent);
        }, 'text-action r9c-node-btn');
        btn.title = `Inspect ${ent.entity_key}`;
        btn.replaceChildren(bdi);
        chainRow.append(btn);
      } else {
        const span = el('span', 'r9c-node-static');
        span.replaceChildren(bdi);
        chainRow.append(span);
      }
    });
    card.append(chainRow);

    const badges = el('div', 'r9c-badges');
    badges.append(
      el('span', 'gram-badge', `${path.hop_count} hop${path.hop_count > 1 ? 's' : ''}`),
      el('span', 'gram-badge', JOIN_SCOPE_LABELS[path.explanation.join_scope] ?? path.explanation.join_scope),
      ...path.epistemic_classes.map((ec) => el('span', 'rel-badge', EPISTEMIC_LABELS[ec] ?? ec)),
      ...(path.uncertainty_indicators.length
        ? [el('span', 'gram-badge gram-badge--cand', `Uncertainty (${path.uncertainty_indicators.length})`)]
        : [])
    );
    card.append(badges);

    card.append(el('p', 'study-muted', path.explanation.establishes));
    card.append(el('p', 'study-muted r9c-why', `Rank (${path.ranking.score.toFixed(1)}): ${path.ranking.why_ranked}`));

    const stepDetails = document.createElement('details');
    stepDetails.className = 'r9c-steps-details';
    stepDetails.append(el('summary', 'r9c-steps-summary', `Step evidence & guardrails (${path.steps.length})`));
    const stepList = el('div', 'r9c-step-list');
    for (const s of path.steps) {
      const sRow = el('div', 'r9c-step-item');
      sRow.append(
        el(
          'div',
          'r9c-step-title',
          `Hop ${s.hop_index}: ${s.from_entity.entity_key} → ${s.to_entity.entity_key} · ${s.display_label} (${s.predicate})`
        ),
        el(
          'div',
          'study-muted r9c-step-meta',
          `${EPISTEMIC_LABELS[s.epistemic_class] ?? s.epistemic_class} · ${s.editions.join(', ') || 'edition n/a'} · ID: ${s.source_relationship_id}`
        )
      );
      if (s.uncertainty.is_uncertain && s.uncertainty.notes.length) {
        sRow.append(el('div', 'study-muted r9c-step-warn', s.uncertainty.notes.join(' ')));
      }
      if (s.evidence_summary.sample_references.length && props.preview) {
        const refs = el('div', 'r9b-sample-list');
        for (const refStr of s.evidence_summary.sample_references.slice(0, 5)) {
          const parsed = parseReference(refStr);
          if (parsed) {
            const rBtn = action(refStr, () => {
              props.preview?.pin(parsed, `${s.display_label} (${s.source_relationship_id})`);
            }, 'reference-link');
            props.preview.attach(rBtn, parsed, `${s.display_label} (${s.source_relationship_id})`);
            refs.append(rBtn);
          } else {
            refs.append(el('span', 'gram-badge', refStr));
          }
        }
        sRow.append(refs);
      }
      if (s.guardrails.length) {
        sRow.append(el('div', 'study-muted r9c-guardrail', s.guardrails.join(' ')));
      }
      stepList.append(sRow);
    }
    if (path.explanation.does_not_establish.length) {
      stepList.append(
        el('div', 'study-muted r9c-guardrail', `Does not establish: ${path.explanation.does_not_establish.join(' ')}`)
      );
    }
    stepDetails.append(stepList);
    card.append(stepDetails);
    return card;
  }

  function renderResults(appendError?: string) {
    resultsBox.replaceChildren();
    if (appendError) {
      resultsBox.append(status(appendError));
      return;
    }
    if (!lastResult) return;

    const cov = lastResult.coverage;
    if (cov.search_stopped_by_limits || cov.source_coverage_incomplete || lastResult.status === 'incomplete_coverage') {
      const reasons = [
        ...(cov.limits_reached.length ? [`limits: ${cov.limits_reached.join(', ')}`] : []),
        ...(cov.missing_shards.length ? [`missing shards: ${cov.missing_shards.length}`] : []),
        ...(cov.truncated_contextual_entities.length ? ['contextual overflow truncated'] : []),
      ].join(' · ');
      resultsBox.append(
        el(
          'p',
          'study-muted rel-disclaimer r9c-partial-banner',
          `Partial exploration (not exhaustive${reasons ? ` — ${reasons}` : ''}). ${lastResult.message}`
        )
      );
    } else {
      resultsBox.append(el('p', 'study-muted r9c-status-line', lastResult.message));
    }

    if (!paths.length) {
      if (lastResult.status === 'no_supported_path') {
        resultsBox.append(status('No supported connection path within the selected hops and layers.'));
      }
      return;
    }

    const list = el('div', 'rel-list');
    for (const p of paths) {
      list.append(renderPathCard(p));
    }
    resultsBox.append(list);

    if (lastResult.pagination.has_more && lastResult.pagination.next_cursor) {
      const nextBtn = action(
        `Load more paths (${paths.length.toLocaleString()} / ${lastResult.pagination.total_available.toLocaleString()})`,
        () => {
          nextBtn.disabled = true;
          void runExploration(true, lastResult?.pagination.next_cursor ?? undefined);
        },
        'load-more'
      );
      resultsBox.append(nextBtn);
    }
  }

  async function runExploration(append: boolean, cursor?: string) {
    if (!sourceKey) {
      renderResults('Wait for the starting lemma to finish resolving.');
      return;
    }
    const ticket = ++reqSeq;
    const rawTarget = (selectedTargetKey || targetInput.value).trim();

    if (!append) {
      paths = [];
      candidatesBox.replaceChildren();
      resultsBox.replaceChildren(status('Exploring relationship paths…'));
    }

    let resolvedTarget: string | null = null;
    if (rawTarget) {
      if (selectedTargetKey && rawTarget === selectedTargetKey) {
        resolvedTarget = selectedTargetKey;
      } else {
        const resConcept = await BibleRPC.relationships.resolveResearchConcept({ query: rawTarget, limit: 12 });
        if (ticket !== reqSeq) return;
        if (!resConcept.data) {
          renderResults(resConcept.error ?? 'Could not resolve target concept.');
          return;
        }
        if (resConcept.data.status === 'resolved' && resConcept.data.candidates.length === 1) {
          resolvedTarget = resConcept.data.candidates[0].entity_key;
          selectedTargetKey = resolvedTarget;
        } else {
          resultsBox.replaceChildren();
          renderCandidatePicker(resConcept.data);
          return;
        }
      }
    }

    const res = await BibleRPC.relationships.discoverRelationshipPaths({
      source: sourceKey,
      ...(resolvedTarget ? { target: resolvedTarget } : {}),
      max_hops: maxHops,
      layers: Array.from(activeLayers),
      limit: 12,
      ...(cursor ? { cursor } : { offset: 0 }),
    });
    if (ticket !== reqSeq) return;
    if (!res.data) {
      renderResults(res.error ?? 'Multi-hop path discovery unavailable.');
      return;
    }
    lastResult = res.data;
    if (res.data.status === 'invalid_request' || res.data.status === 'unknown_entity') {
      paths = [];
      renderResults(res.data.message);
      return;
    }
    paths = append ? [...paths, ...res.data.paths] : res.data.paths;
    renderResults();
  }

  renderControls();

  return {
    element: root,
    setSource(nextKey: string | null, displayLabel?: string) {
      sourceKey = nextKey;
      sourceLabel = displayLabel ?? null;
      selectedTargetKey = null;
      paths = [];
      lastResult = null;
      candidatesBox.replaceChildren();
      resultsBox.replaceChildren();
      renderControls();
    },
    clear() {
      reqSeq++;
      sourceKey = null;
      sourceLabel = null;
      selectedTargetKey = null;
      targetInput.value = '';
      paths = [];
      lastResult = null;
      candidatesBox.replaceChildren();
      resultsBox.replaceChildren();
      renderControls();
    },
  };
}
