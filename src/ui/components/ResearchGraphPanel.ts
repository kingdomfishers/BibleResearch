// @file: src/ui/components/ResearchGraphPanel.ts
// @feature: research-graph
// @tables: rg_nodes | rg_claims | rg_claim_evidence | rg_claim_links | rg_research_trails

import '../styles-research-graph.css';
import type {
  RgClaimSummary,
  RgContradictionsResponse,
  RgEvidenceClass,
  RgPathItem,
  RgReviewStatus,
  RgTraceResponse,
  RgTrailSummary,
} from '../../api/research-graph-types';
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage } from '../../api/types';
import { action, el, status } from '../study-dom';
import type { ContextPreview } from './ContextPreview';
import type { ClaimComposerPrefill } from './ClaimComposerDialog';

export interface ResearchGraphPanelCallbacks {
  preview: ContextPreview;
  navigate: (p: ActivePassage) => void;
  onOpenComposer: (prefill?: ClaimComposerPrefill) => void;
  onClaimsMutated?: () => void;
}

export interface ResearchGraphPanelHandle {
  element: HTMLElement;
  refresh: () => void;
  searchFor: (query: string) => void;
}

type TabKey = 'search' | 'paths' | 'trails';

export function createResearchGraphPanel(callbacks: ResearchGraphPanelCallbacks): ResearchGraphPanelHandle {
  const root = el('section', 'rg-panel');
  root.setAttribute('aria-label', 'Research Knowledge Graph workspace');

  let activeTab: TabKey = 'search';
  let claims: RgClaimSummary[] = [];
  let selectedClaimId: string | null = null;
  let traceCache = new Map<string, RgTraceResponse>();
  let pathsResult: RgPathItem[] = [];
  let contradictions: RgContradictionsResponse | null = null;
  let trails: RgTrailSummary[] = [];
  let loadingSearch = false;
  let searchLoaded = false;

  const head = el('div', 'rg-panel__head');
  const titleWrap = el('div', '');
  titleWrap.append(
    el('p', 'eyebrow', 'LAYER 3 · PERSISTENT RESEARCH KNOWLEDGE GRAPH'),
    el('h3', 'rg-panel__title', 'Discoveries, Dossiers, Evidence Traces & Research Trails'),
  );
  const newClaimBtn = action('+ New Claim / Hypothesis', () => {
    callbacks.onOpenComposer({ mode: 'create' });
  }, 'study-button primary');
  head.append(titleWrap, newClaimBtn);

  const untrustedBanner = el(
    'p',
    'rg-untrusted-notice',
    'Epistemic isolation notice: Entries here store human and AI research observations, DLM hypotheses, and external citations. They never alter Scripture text or deterministic discovery rankings.',
  );

  // Single-row accessible tablist (modern-web-guidance tabs spec)
  const uid = Math.random().toString(36).slice(2, 7);
  const tablist = el('div', 'rg-tablist');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Research Knowledge Graph views');
  tablist.setAttribute('focusgroup', 'tablist nomemory');

  const panelSearch = el('div', 'rg-tabpanel');
  panelSearch.id = `rg-panel-search-${uid}`;
  panelSearch.setAttribute('role', 'tabpanel');

  const panelPaths = el('div', 'rg-tabpanel');
  panelPaths.id = `rg-panel-paths-${uid}`;
  panelPaths.setAttribute('role', 'tabpanel');

  const panelTrails = el('div', 'rg-tabpanel');
  panelTrails.id = `rg-panel-trails-${uid}`;
  panelTrails.setAttribute('role', 'tabpanel');

  const makeTab = (key: TabKey, label: string, panel: HTMLElement) => {
    const btn = action(label, () => selectTab(key), 'rg-tab');
    btn.id = `rg-tab-${key}-${uid}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', panel.id);
    panel.setAttribute('aria-labelledby', btn.id);
    return btn;
  };

  const tabSearchBtn = makeTab('search', 'Search & Dossiers', panelSearch);
  const tabPathsBtn = makeTab('paths', 'Multi-Entity Paths', panelPaths);
  const tabTrailsBtn = makeTab('trails', 'Trails & Contradictions', panelTrails);
  tablist.append(tabSearchBtn, tabPathsBtn, tabTrailsBtn);

  function selectTab(next: TabKey) {
    activeTab = next;
    const pairs: Array<[TabKey, HTMLButtonElement, HTMLElement]> = [
      ['search', tabSearchBtn, panelSearch],
      ['paths', tabPathsBtn, panelPaths],
      ['trails', tabTrailsBtn, panelTrails],
    ];
    for (const [k, btn, pan] of pairs) {
      const sel = k === next;
      btn.setAttribute('aria-selected', String(sel));
      btn.tabIndex = sel ? 0 : -1;
      pan.hidden = !sel;
    }
    if (next === 'search' && !searchLoaded) void runSearch();
    if (next === 'trails') void loadTrailsAndContradictions();
  }

  // === Tab 1: Search & Evidence Trace ===
  const filterRow = el('div', 'rg-filters');
  const queryIn = document.createElement('input');
  queryIn.type = 'search';
  queryIn.className = 'rg-input rg-input--grow';
  queryIn.placeholder = 'Search claims by concept, passage, Strongs, predicate, or scientific term…';

  const authorSel = document.createElement('select');
  authorSel.className = 'rg-select';
  for (const [v, l] of [['', 'All authors'], ['human', 'Human research'], ['ai', 'AI research']] as const) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    authorSel.append(o);
  }

  const evSel = document.createElement('select');
  evSel.className = 'rg-select';
  for (const v of ['', 'TEXT_EXPLICIT', 'TEXT_LINGUISTIC', 'TEXT_INTERTEXTUAL', 'TEXT_PATTERN', 'SCIENCE_EMPIRICAL', 'DLM_HYPOTHESIS', 'DISPUTED', 'OPEN'] as Array<'' | RgEvidenceClass>) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v || 'All evidence classes';
    evSel.append(o);
  }

  const revSel = document.createElement('select');
  revSel.className = 'rg-select';
  for (const v of ['', 'unreviewed', 'confirmed', 'disputed', 'rejected', 'superseded'] as Array<'' | RgReviewStatus>) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v || 'All review statuses';
    revSel.append(o);
  }

  const staleChkLabel = el('label', 'rg-actions-row');
  const staleChk = document.createElement('input');
  staleChk.type = 'checkbox';
  staleChkLabel.append(staleChk, el('span', 'study-muted', 'Stale only'));

  const searchBtn = action('Search', () => void runSearch(), 'study-button');
  queryIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') void runSearch();
  });
  for (const sel of [authorSel, evSel, revSel, staleChk]) {
    sel.addEventListener('change', () => void runSearch());
  }
  filterRow.append(queryIn, authorSel, evSel, revSel, staleChkLabel, searchBtn);

  const searchWorkspace = el('div', 'rg-workspace');
  const claimsListWrap = el('div', 'rg-list');
  const detailWrap = el('div', 'rg-detail');
  searchWorkspace.append(claimsListWrap, detailWrap);
  panelSearch.append(filterRow, searchWorkspace);

  async function runSearch() {
    searchLoaded = true;
    loadingSearch = true;
    claimsListWrap.replaceChildren(status('Querying Research Knowledge Graph…'));
    const filters: Record<string, unknown> = {
      include_superseded: revSel.value === 'superseded',
    };
    if (authorSel.value) filters.author_kind = authorSel.value;
    if (evSel.value) filters.evidence_class = evSel.value;
    if (revSel.value) filters.review_status = revSel.value;
    if (staleChk.checked) filters.is_potentially_stale = true;

    const res = await BibleRPC.graph.search(queryIn.value.trim() || null, filters, 25, 0);
    loadingSearch = false;
    if (!res.data || res.error) {
      claims = [];
      claimsListWrap.replaceChildren(el('p', 'study-muted', res.error || 'Could not query Research Knowledge Graph.'));
      return;
    }
    claims = res.data.items ?? [];
    if (!selectedClaimId && claims.length > 0) {
      selectedClaimId = claims[0]!.id;
      void ensureTrace(selectedClaimId);
    }
    renderClaimsList();
    renderClaimDetail();
  }

  async function ensureTrace(claimId: string) {
    if (traceCache.has(claimId)) return;
    const res = await BibleRPC.graph.traceEvidence(claimId, 5);
    if (res.data) {
      traceCache.set(claimId, res.data);
      if (selectedClaimId === claimId) renderClaimDetail();
    }
  }

  function appendClaimBadges(target: HTMLElement, c: RgClaimSummary) {
    const badges = el('div', 'rg-badges');
    const isAi = c.author.kind === 'ai';
    badges.append(
      el('span', `rg-badge ${isAi ? 'rg-badge--ai' : 'rg-badge--human'}`,
        isAi ? `AI · ${c.author.ai_model || c.author.display_name}` : `Human · ${c.author.display_name}`),
      el('span', 'rg-badge', c.evidence_class),
      el('span', `rg-badge ${c.review_status === 'confirmed' ? 'rg-badge--confirmed' : c.review_status === 'disputed' || c.review_status === 'rejected' ? 'rg-badge--disputed' : ''}`,
        c.review_status),
    );
    if (c.is_potentially_stale) {
      badges.append(el('span', 'rg-badge rg-badge--stale', 'Potentially Stale'));
    }
    if ((c.independent_primary_witness_count ?? 0) > 0) {
      badges.append(el('span', 'rg-badge rg-badge--scripture', `${c.independent_primary_witness_count} primary witness(es)`));
    }
    target.append(badges);
  }

  function renderClaimsList() {
    if (loadingSearch) return;
    if (claims.length === 0) {
      claimsListWrap.replaceChildren(el('p', 'study-muted', 'No matching research claims yet. Create the first claim or widen your filters.'));
      return;
    }
    const cards: HTMLElement[] = [];
    for (const c of claims) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `rg-claim-card ${c.author.kind === 'ai' ? 'rg-claim-card--ai' : 'rg-claim-card--human'}${c.id === selectedClaimId ? ' is-selected' : ''}`;
      btn.setAttribute('aria-pressed', String(c.id === selectedClaimId));
      btn.addEventListener('click', () => {
        selectedClaimId = c.id;
        renderClaimsList();
        renderClaimDetail();
        void ensureTrace(c.id);
      });
      const subj = c.subject?.label ?? 'Entity';
      const obj = c.object?.label ? ` → ${c.object.label}` : '';
      btn.append(
        el('p', 'rg-claim-card__title', c.title),
        el('div', 'rg-claim-card__triple', `${subj} —[${c.predicate_label}]${obj}`),
      );
      appendClaimBadges(btn, c);
      cards.push(btn);
    }
    claimsListWrap.replaceChildren(...cards);
  }

  async function applyReview(claim: RgClaimSummary, reviewStatus: RgReviewStatus, clearStale = false) {
    const res = await BibleRPC.graph.reviewClaim(claim.id, reviewStatus, { clearStale });
    if (res.ok) {
      traceCache.delete(claim.id);
      callbacks.onClaimsMutated?.();
      await runSearch();
      await ensureTrace(claim.id);
    }
  }

  function renderClaimDetail() {
    const claim = claims.find(c => c.id === selectedClaimId);
    if (!claim) {
      detailWrap.replaceChildren(el('p', 'study-muted', 'Select a claim to inspect provenance, primary evidence lineage, challenges, and review actions.'));
      return;
    }

    const items: HTMLElement[] = [
      el('p', 'eyebrow', `${claim.claim_kind.replace(/_/g, ' ').toUpperCase()} · v${claim.version}`),
      el('h4', 'rg-panel__title', claim.title),
    ];
    const badgeHost = el('div', '');
    appendClaimBadges(badgeHost, claim);
    items.push(badgeHost);

    if (claim.is_potentially_stale) {
      items.push(el('div', 'rg-warning-box', `Staleness flag: ${claim.stale_reason || 'Upstream evidence or dependency was disputed/updated.'}`));
    }

    const relBox = el('div', 'rg-row-card');
    relBox.append(
      el('div', '', `Relationship: ${claim.subject?.label ?? 'Entity'} —[${claim.predicate_label}${claim.predicate_is_transitive ? ', transitive' : ', non-transitive'}]${claim.object?.label ? `→ ${claim.object.label}` : ''}`),
      el('div', '', `Assertion: ${claim.assertion_text}`),
      el('div', 'study-muted', `Scope: ${claim.contextual_scope || 'Unspecified'}`),
      ...(claim.limitations ? [el('div', 'study-muted', `Limitations: ${claim.limitations}`)] : []),
    );
    items.push(relBox);

    if (claim.participants && claim.participants.length > 0) {
      const pWrap = el('div', 'rg-row-card');
      pWrap.append(el('span', 'rg-field__label', 'Ordered N-ary Participants'));
      for (const p of claim.participants) {
        pWrap.append(el('div', 'study-muted', `${p.ordinal}. [${p.role}] ${p.label}${p.notes ? ` — ${p.notes}` : ''}`));
      }
      items.push(pWrap);
    }

    const trace = traceCache.get(claim.id);
    if (!trace) {
      items.push(status('Tracing upstream primary evidence…'));
    } else {
      if (trace.circular_dependency_detected) {
        items.push(el('div', 'rg-warning-box', 'Circular dependency cycle detected in claim chain; independent confirmation cannot be claimed.'));
      }
      if (trace.shared_upstream_warnings.length > 0) {
        const w = trace.shared_upstream_warnings[0]!;
        items.push(el('div', 'rg-warning-box', `Echo-chamber guard (${trace.independent_primary_witness_count} independent primary witnesses): ${w.warning}`));
      }
      if (trace.primary_witnesses.length > 0) {
        const pwBox = el('div', 'rg-row-card');
        pwBox.append(el('span', 'rg-field__label', `Primary Witnesses (${trace.independent_primary_witness_count} independent)`));
        for (const pw of trace.primary_witnesses) {
          const text = pw.external_title
            ? `${pw.external_title} (${pw.external_url ?? pw.source_key})`
            : `${pw.evidence_kind}: ${pw.source_key}`;
          pwBox.append(el('div', 'study-muted', `${text} · cited by ${pw.citing_claim_count} claim(s)`));
        }
        items.push(pwBox);
      }
      if (trace.challenges.length > 0) {
        const chBox = el('div', 'rg-warning-box');
        chBox.append(el('strong', '', `Challenges / Counterclaims (${trace.challenges.length})`));
        for (const ch of trace.challenges) {
          chBox.append(el('div', '', `• [${ch.author_kind}/${ch.review_status}] ${ch.title}: ${ch.assertion_text}`));
        }
        items.push(chBox);
      }
    }

    const actRow = el('div', 'rg-actions-row');
    actRow.append(
      action('Confirm', () => void applyReview(claim, 'confirmed', true), 'study-button'),
      action('Dispute', () => void applyReview(claim, 'disputed', false), 'study-button'),
      ...(claim.is_potentially_stale ? [action('Mark Reevaluated', () => void applyReview(claim, claim.review_status, true), 'study-button primary')] : []),
      action('Challenge…', () => {
        callbacks.onOpenComposer({
          mode: 'challenge',
          targetClaim: {
            id: claim.id,
            title: claim.title,
            subject_ref: claim.subject?.node_key,
            object_ref: claim.object?.node_key,
          },
        });
      }, 'study-button'),
      action('Supersede…', () => {
        callbacks.onOpenComposer({
          mode: 'supersede',
          targetClaim: {
            id: claim.id,
            title: claim.title,
            subject_ref: claim.subject?.node_key,
            object_ref: claim.object?.node_key,
          },
        });
      }, 'study-button'),
      ...(claim.author.kind === 'human'
        ? [
            action('Edit…', () => callbacks.onOpenComposer({ mode: 'edit', existingClaim: claim }), 'study-button'),
            action('Remove', async () => {
              if (!window.confirm(`Remove claim "${claim.title}"? Dependent claims will be flagged stale.`)) return;
              const res = await BibleRPC.graph.deleteClaim(claim.id, claim.version);
              if (res.ok) {
                selectedClaimId = null;
                callbacks.onClaimsMutated?.();
                await runSearch();
              }
            }, 'text-action'),
          ]
        : []),
    );
    items.push(actRow);
    detailWrap.replaceChildren(...items);
  }

  // === Tab 2: Multi-Entity Paths ===
  const pathForm = el('div', 'rg-filters');
  const fromIn = document.createElement('input');
  fromIn.className = 'rg-input rg-input--grow';
  fromIn.placeholder = 'From entity refs/queries (comma-separated, e.g. H2233, adam)';
  const toIn = document.createElement('input');
  toIn.className = 'rg-input rg-input--grow';
  toIn.placeholder = 'To entity refs/queries (e.g. principle:information, H0127)';
  const hopsSel = document.createElement('select');
  hopsSel.className = 'rg-select';
  for (const h of [2, 3, 4]) {
    const o = document.createElement('option');
    o.value = String(h);
    o.textContent = `Max ${h} hops`;
    hopsSel.append(o);
  }
  hopsSel.value = '3';
  const findPathsBtn = action('Find Paths', () => void runPathSearch(), 'study-button primary');
  pathForm.append(fromIn, toIn, hopsSel, findPathsBtn);
  const pathsOutput = el('div', 'rg-list');
  pathsOutput.append(el('p', 'study-muted', 'Enter source and target entities to trace typed research paths across the Research Knowledge Graph.'));
  panelPaths.append(pathForm, pathsOutput);

  async function runPathSearch() {
    const fromRefs = fromIn.value.split(',').map(s => s.trim()).filter(Boolean);
    const toRefs = toIn.value.split(',').map(s => s.trim()).filter(Boolean);
    if (!fromRefs.length || !toRefs.length) {
      pathsOutput.replaceChildren(el('p', 'study-muted', 'Provide at least one source entity and one target entity.'));
      return;
    }
    pathsOutput.replaceChildren(status('Searching bounded multi-hop research paths…'));
    const res = await BibleRPC.graph.findPaths(fromRefs, toRefs, Number(hopsSel.value), {}, 10);
    if (!res.data || res.error) {
      pathsOutput.replaceChildren(el('p', 'study-muted', res.error || 'Path query failed.'));
      return;
    }
    pathsResult = res.data.paths ?? [];
    if (pathsResult.length === 0) {
      pathsOutput.replaceChildren(el('p', 'study-muted', 'No connecting research paths found within the hop bound.'));
      return;
    }
    const cards: HTMLElement[] = [];
    for (const p of pathsResult) {
      const card = el('div', 'rg-path-card');
      const badges = el('div', 'rg-badges');
      badges.append(
        el('span', 'rg-badge', `${p.hop_count} hop(s)`),
        el('span', `rg-badge ${p.transitivity_valid ? 'rg-badge--confirmed' : 'rg-badge--stale'}`, p.path_classification.replace(/_/g, ' ')),
      );
      card.append(badges);
      if (p.transitivity_warning) {
        card.append(el('p', 'study-muted', p.transitivity_warning));
      }
      const ol = el('ol', 'rg-path-steps');
      for (const s of p.steps) {
        ol.append(el('li', '', `[${s.author_kind}/${s.evidence_class}/${s.review_status}] ${s.predicate_label}: ${s.title}${s.is_potentially_stale ? ' [STALE]' : ''}`));
      }
      card.append(ol);
      cards.push(card);
    }
    pathsOutput.replaceChildren(...cards);
  }

  // === Tab 3: Trails & Contradictions ===
  const trailsOutput = el('div', 'rg-list');
  const newTrailRow = el('div', 'rg-filters');
  const trailTitleIn = document.createElement('input');
  trailTitleIn.className = 'rg-input rg-input--grow';
  trailTitleIn.placeholder = 'New research trail title…';
  const trailQIn = document.createElement('input');
  trailQIn.className = 'rg-input rg-input--grow';
  trailQIn.placeholder = 'Central research question / open frontier…';
  const saveTrailBtn = action('Start / Save Trail', async () => {
    if (trailTitleIn.value.trim().length < 2 || trailQIn.value.trim().length < 3) return;
    const res = await BibleRPC.graph.saveTrail({
      title: trailTitleIn.value.trim(),
      research_question: trailQIn.value.trim(),
      status: 'active',
    });
    if (res.ok) {
      trailTitleIn.value = '';
      trailQIn.value = '';
      await loadTrailsAndContradictions();
    }
  }, 'study-button primary');
  newTrailRow.append(trailTitleIn, trailQIn, saveTrailBtn);
  panelTrails.append(newTrailRow, trailsOutput);

  async function loadTrailsAndContradictions() {
    trailsOutput.replaceChildren(status('Loading active trails & unresolved tensions…'));
    const [trRes, conRes] = await Promise.all([
      BibleRPC.graph.listTrails(null, null, 15),
      BibleRPC.graph.findContradictions(null, null, 20),
    ]);
    trails = trRes.data?.trails ?? [];
    contradictions = conRes.data ?? null;

    const nodes: HTMLElement[] = [];
    nodes.push(el('p', 'eyebrow', `PERSISTENT RESEARCH TRAILS (${trails.length})`));
    if (trails.length === 0) {
      nodes.push(el('p', 'study-muted', 'No persistent research trails recorded yet.'));
    } else {
      for (const t of trails) {
        const card = el('div', 'rg-trail-card');
        const badgeRow = el('div', 'rg-badges');
        badgeRow.append(
          el('span', `rg-badge ${t.author_kind === 'ai' ? 'rg-badge--ai' : 'rg-badge--human'}`, `${t.author_kind} · ${t.author_display_name}`),
          el('span', 'rg-badge', `${t.status} · v${t.version}`),
        );
        card.append(
          el('strong', '', t.title),
          el('div', 'study-muted', t.research_question),
          badgeRow,
        );
        nodes.push(card);
      }
    }

    const staleItems = contradictions?.disputed_stale_or_open ?? [];
    const chItems = contradictions?.challenges ?? [];
    nodes.push(el('p', 'eyebrow', `CHALLENGES (${chItems.length}) & DISPUTED / STALE ITEMS (${staleItems.length})`));
    for (const row of [...chItems.slice(0, 8), ...staleItems.slice(0, 8)]) {
      const card = el('div', 'rg-warning-box');
      card.textContent = String(row.title ?? row.assertion_text ?? row.claim_id ?? 'Unresolved tension');
      nodes.push(card);
    }
    trailsOutput.replaceChildren(...nodes);
  }

  root.append(head, untrustedBanner, tablist, panelSearch, panelPaths, panelTrails);
  selectTab('search');

  return {
    element: root,
    refresh: () => {
      traceCache.clear();
      if (activeTab === 'search') void runSearch();
      if (activeTab === 'trails') void loadTrailsAndContradictions();
    },
    searchFor: (q: string) => {
      queryIn.value = q;
      selectTab('search');
      void runSearch();
    },
  };
}
