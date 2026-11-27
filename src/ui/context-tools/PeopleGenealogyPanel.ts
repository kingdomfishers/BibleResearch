// @file: src/ui/context-tools/PeopleGenealogyPanel.ts
// @feature: context-tools
// @tables: none
// @candidates: none
// @toc: imports | types | styles | svg:helpers | ui:main | ui:tree | ui:detail

// === @section:imports ===
import type { ActivePassage } from '../../api/types';
import type { ContextPreview } from '../components/ContextPreview';
import { action, el, status } from '../study-dom';
import {
  buildBoundedFamilyNeighborhood,
  getHomonyms,
  getPeopleGraphStats,
  getPersonById,
  isFullPeopleGraphLoaded,
  loadFullPeopleGraph,
  loadVersePersonIndex,
  searchPeople,
  type BiblicalPerson,
  type FamilyNeighborhood,
  type LineageGroup,
  type PersonRelationship,
} from './people-data';

// === @section:types ===
export interface PeopleGenealogyHandle {
  element: HTMLElement;
  focusPerson: (personId?: string) => void;
}

type LineageFilter = 'all' | LineageGroup;

const LINEAGE_CHIPS: { id: LineageFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'creation_nations', label: 'Genesis / Nations' },
  { id: 'patriarchs', label: 'Patriarchs' },
  { id: 'exodus_priests', label: 'Exodus / Priests' },
  { id: 'davidic', label: 'Davidic Line' },
  { id: 'kings_prophets', label: 'Kings & Prophets' },
  { id: 'gospels_apostles', label: 'Gospels & Apostles' },
];

const LINEAGE_LABELS: Record<LineageGroup, string> = {
  creation_nations: 'Genesis / Nations',
  patriarchs: 'Patriarchs',
  exodus_priests: 'Exodus / Priests',
  davidic: 'Davidic Line',
  kings_prophets: 'Kings & Prophets',
  gospels_apostles: 'Gospels & Apostles',
};

const QUICK_PICK_CAP = 40;

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'people-genealogy-panel-styles';
const DEFAULT_PERSON_ID = 'abraham';

// === @section:styles ===
function ensureGenealogyStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.genealogy-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
  color: var(--text);
}
.genealogy-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.genealogy-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.genealogy-title {
  margin: 0;
  font: 600 17px/1.25 Georgia, serif;
}
.genealogy-stats-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-top: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--background);
  color: var(--muted);
  font-size: 11px;
}
.genealogy-search-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.genealogy-search-input {
  flex: 1 1 220px;
  min-width: 180px;
  padding: 7px 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
  color: var(--text);
  font-size: 13px;
}
.genealogy-depth-toggle {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--background);
}
.genealogy-depth-btn {
  border: 0;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  padding: 6px 10px;
  font-size: 12px;
}
.genealogy-depth-btn:last-child { border-right: 0; }
.genealogy-depth-btn.is-active {
  background: var(--accent);
  color: var(--text);
  font-weight: 600;
}
.genealogy-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.genealogy-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--background);
  color: var(--muted);
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.35;
}
.genealogy-chip:hover {
  background: var(--soft);
  color: var(--text);
}
.genealogy-chip.is-active {
  background: var(--accent);
  border-color: var(--gold);
  color: var(--text);
  font-weight: 600;
}
.genealogy-quick-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 112px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
}
.genealogy-person-pill {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  padding: 4px 9px;
  font-size: 12px;
}
.genealogy-person-pill:hover {
  background: var(--soft);
  border-color: var(--gold);
}
.genealogy-person-pill.is-active {
  background: var(--accent);
  border-color: var(--gold);
  font-weight: 600;
}
.genealogy-person-pill-sub {
  font-size: 10px;
  color: var(--muted);
}
.genealogy-homonym-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  max-height: 112px;
  overflow-y: auto;
  padding: 8px 11px;
  border: 1px solid var(--gold);
  border-radius: 6px;
  background: color-mix(in srgb, var(--gold) 10%, var(--panel));
  font-size: 12px;
}
.genealogy-homonym-label {
  font-weight: 600;
  color: var(--gold);
}
.genealogy-svg-wrap {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
  padding: 10px;
}
.genealogy-zoom-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.genealogy-zoom-controls {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.genealogy-zoom-btn {
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--panel);
  color: var(--text);
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.genealogy-zoom-btn:hover {
  border-color: var(--gold);
  background: var(--soft);
}
.genealogy-zoom-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--gold);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.genealogy-zoom-hint {
  font-size: 11px;
  color: var(--muted);
}
.genealogy-viewport {
  position: relative;
  width: 100%;
  height: clamp(240px, 44vh, 420px);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.genealogy-viewport.is-panning {
  cursor: grabbing;
}
.genealogy-canvas-stage {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.genealogy-svg {
  display: block;
}
.genealogy-svg-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px 14px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}
.genealogy-legend-items {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.genealogy-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.genealogy-legend-swatch {
  display: inline-block;
  width: 18px;
  height: 0;
  border-top: 2px solid var(--border);
}
.genealogy-legend-swatch.is-spouse { border-top: 2.5px solid var(--gold); }
.genealogy-legend-swatch.is-mentor { border-top: 2px dashed #8b5cf6; }
.genealogy-legend-swatch.is-social { border-top: 2px dashed #1b998b; }
.genealogy-legend-swatch.is-adversary { border-top: 2px dashed #c84b4b; }
.genealogy-node {
  cursor: pointer;
}
.genealogy-node:focus-visible {
  outline: none;
}
.genealogy-node:hover .genealogy-node-rect,
.genealogy-node:focus-visible .genealogy-node-rect {
  stroke: var(--gold-light, var(--gold));
  stroke-width: 2.4;
}
.genealogy-detail-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
}
.genealogy-detail-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px 12px;
}
.genealogy-detail-name {
  margin: 0;
  font: 600 18px/1.25 Georgia, serif;
}
.genealogy-detail-disambig {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.genealogy-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.genealogy-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  font-size: 11px;
}
.genealogy-script-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  font-size: 13px;
}
.genealogy-script {
  font-size: 16px;
  font-weight: 600;
  color: var(--gold);
}
.genealogy-translit {
  font-style: italic;
  color: var(--muted);
}
.genealogy-strongs-btn {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--soft);
  color: var(--text);
  padding: 2px 8px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.genealogy-strongs-btn:hover {
  border-color: var(--gold);
  background: var(--accent);
}
.genealogy-epistemic-alert {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--gold);
  border-radius: 6px;
  background: color-mix(in srgb, var(--gold) 8%, var(--panel));
  font-size: 12px;
  line-height: 1.5;
}
.genealogy-epistemic-title {
  display: block;
  margin-bottom: 3px;
  font-size: 11px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--gold);
}
.genealogy-keyrefs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.genealogy-keyref-group {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--panel);
}
.genealogy-keyref-btn {
  border: 0;
  background: transparent;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text);
}
.genealogy-keyref-btn:hover {
  background: var(--soft);
}
.genealogy-keyref-open {
  border: 0;
  border-left: 1px solid var(--border);
  background: var(--soft);
  padding: 4px 7px;
  font-size: 11px;
  color: var(--gold);
  font-weight: 600;
}
.genealogy-keyref-open:hover {
  background: var(--accent);
}
.genealogy-rel-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.genealogy-rel-group-title {
  margin: 0 0 5px;
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--gold);
}
.genealogy-rel-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.genealogy-rel-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
}
.genealogy-rel-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 10px;
}
.genealogy-rel-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.genealogy-role-tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--soft);
  color: var(--muted);
}
.genealogy-rel-person-btn {
  border: 0;
  background: transparent;
  padding: 2px 4px;
  font-weight: 600;
  font-size: 13px;
  color: var(--text);
  text-align: left;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--gold) 55%, transparent);
  text-underline-offset: 3px;
}
.genealogy-rel-person-btn:hover {
  color: var(--gold);
}
.genealogy-witness-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.genealogy-cat-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.genealogy-cat-badge.is-explicit {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 10%, var(--background));
}
.genealogy-cat-badge.is-inferred {
  color: var(--muted);
  background: var(--soft);
}
.genealogy-witness-badge {
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--background);
  color: var(--green);
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
}
.genealogy-witness-badge:hover {
  border-color: var(--gold);
  background: var(--soft);
}
.genealogy-rel-note {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
`;
  document.head.append(style);
}

// === @section:svg:helpers ===
function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    node.setAttribute(key, String(val));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function normalizeSearchQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

function roleLabelForEdge(edge: PersonRelationship, focusId: string): string {
  switch (edge.type) {
    case 'father':
      return edge.toId === focusId ? 'Father' : 'Child';
    case 'mother':
      return edge.toId === focusId ? 'Mother' : 'Child';
    case 'spouse':
      return edge.typeLabel ?? 'Spouse';
    case 'sibling':
      return edge.typeLabel ?? 'Sibling';
    case 'covenant_friend':
      return edge.typeLabel
        ? edge.typeLabel.charAt(0).toUpperCase() + edge.typeLabel.slice(1)
        : 'Covenant Friend';
    case 'mentor_disciple':
      if (edge.typeLabel === 'master' || edge.typeLabel === 'servant') {
        return edge.fromId === focusId ? 'Servant' : 'Master';
      }
      return edge.fromId === focusId ? 'Disciple' : 'Mentor';
    case 'successor':
      return edge.fromId === focusId ? 'Successor' : 'Predecessor';
    case 'adversary':
      return edge.fromId === focusId ? 'Slew' : 'Killed by';
  }
}

interface PlacedSvgNode {
  person: BiblicalPerson;
  x: number;
  y: number;
  roleLabel: string;
  titleText: string;
  kind: 'focus' | 'family' | 'social';
}

// === @section:ui:main ===
export function createPeopleGenealogyPanel(callbacks: {
  preview: ContextPreview;
  onNavigate: (p: ActivePassage) => void;
  onInspectStrongs?: (strongs: string) => void;
}): PeopleGenealogyHandle {
  ensureGenealogyStyles();

  const root = el('section', 'genealogy-panel');
  root.setAttribute('aria-label', 'Biblical People & Genealogy');

  let activePersonId = DEFAULT_PERSON_ID;
  let pendingFocusId: string | null = null;
  let lineageFilter: LineageFilter = 'all';
  let searchQuery = '';
  let maxGenerations: 1 | 2 = 2;
  let treeInteractionAbort: AbortController | null = null;

  // Header & Controls
  const topBar = el('div', 'genealogy-topbar');
  const titleWrap = el('div', 'genealogy-title-wrap');
  const statsPill = el('span', 'genealogy-stats-pill', '');
  titleWrap.append(
    el('p', 'eyebrow', 'CONTEXT TOOL · LINEAGES & WITNESSES'),
    el('h2', 'genealogy-title', 'People & Genealogy'),
    statsPill,
  );

  function updateStatsPill(): void {
    const s = getPeopleGraphStats();
    const figStr = s.peopleCount.toLocaleString('en-US');
    const edgeStr = s.relationshipCount.toLocaleString('en-US');
    statsPill.textContent = s.loaded
      ? `${figStr} biblical figures · ${edgeStr} Scripture edges · CC BY 4.0`
      : `${figStr} curated figures · loading full 3,000+ index…`;
  }
  updateStatsPill();

  const depthToggle = el('div', 'genealogy-depth-toggle');
  depthToggle.setAttribute('role', 'group');
  depthToggle.setAttribute('aria-label', 'Generation depth');
  const depth1Btn = action('1 gen', () => {
    if (maxGenerations === 1) return;
    maxGenerations = 1;
    renderTreeAndDetail();
  }, 'genealogy-depth-btn');
  const depth2Btn = action('2 gens', () => {
    if (maxGenerations === 2) return;
    maxGenerations = 2;
    renderTreeAndDetail();
  }, 'genealogy-depth-btn');
  depthToggle.append(depth1Btn, depth2Btn);
  topBar.append(titleWrap, depthToggle);

  const searchRow = el('div', 'genealogy-search-row');
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'genealogy-search-input';
  searchInput.placeholder = "Filter 3,000+ figures by name, disambiguator, Hebrew/Greek, tribe, or Strong's…";
  searchInput.setAttribute('aria-label', 'Filter biblical people');
  const matchCount = el('span', 'study-muted', '');
  matchCount.style.fontSize = '12px';
  searchInput.addEventListener('input', () => {
    searchQuery = normalizeSearchQuery(searchInput.value);
    renderFilterStrip();
  });
  searchRow.append(searchInput, matchCount);

  const chipRow = el('div', 'genealogy-chips');
  chipRow.setAttribute('role', 'group');
  chipRow.setAttribute('aria-label', 'Lineage group filter');
  const chipButtons = new Map<LineageFilter, HTMLButtonElement>();
  for (const chip of LINEAGE_CHIPS) {
    const btn = action(chip.label, () => {
      lineageFilter = chip.id;
      renderFilterStrip();
    }, 'genealogy-chip');
    chipButtons.set(chip.id, btn);
    chipRow.append(btn);
  }

  const quickStrip = el('div', 'genealogy-quick-strip');
  quickStrip.setAttribute('aria-label', 'Quick select biblical person');
  const homonymStrip = el('div', 'genealogy-homonym-strip');
  homonymStrip.hidden = true;
  const svgWrap = el('div', 'genealogy-svg-wrap');
  const detailWrap = el('div', 'genealogy-detail-card');

  root.append(topBar, searchRow, chipRow, quickStrip, homonymStrip, svgWrap, detailWrap);

  function renderFilterStrip(): void {
    for (const [id, btn] of chipButtons.entries()) {
      const active = id === lineageFilter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    const { matches, totalMatches, totalPeople } = searchPeople(searchQuery, lineageFilter, QUICK_PICK_CAP);
    matchCount.textContent =
      totalMatches > QUICK_PICK_CAP
        ? `Showing ${matches.length} of ${totalMatches.toLocaleString('en-US')} matches (${totalPeople.toLocaleString('en-US')} total)`
        : `${totalMatches.toLocaleString('en-US')} of ${totalPeople.toLocaleString('en-US')} figures`;

    if (matches.length === 0) {
      quickStrip.replaceChildren(status('No biblical figures match the current filter.'));
      return;
    }

    const pills: HTMLElement[] = [];
    for (const person of matches) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = person.id === activePersonId;
      btn.className = isActive ? 'genealogy-person-pill is-active' : 'genealogy-person-pill';
      btn.setAttribute('aria-pressed', String(isActive));
      btn.append(el('span', '', person.name));
      if (person.disambiguator) {
        btn.append(el('span', 'genealogy-person-pill-sub', `(${person.disambiguator})`));
      }
      btn.addEventListener('click', () => {
        focusPerson(person.id);
      });
      pills.push(btn);
    }
    quickStrip.replaceChildren(...pills);
  }

  function renderHomonymStrip(focus: BiblicalPerson): void {
    const others = getHomonyms(focus);
    if (others.length === 0) {
      homonymStrip.hidden = true;
      homonymStrip.replaceChildren();
      return;
    }

    const allInGroup = [focus, ...others].sort((a, b) => a.name.localeCompare(b.name));
    const baseLabel = focus.homonymGroup
      ? focus.homonymGroup.charAt(0).toUpperCase() + focus.homonymGroup.slice(1)
      : focus.name;
    const noticeText = `${allInGroup.length} people named ${baseLabel} — click to switch`;

    const nodes: HTMLElement[] = [el('span', 'genealogy-homonym-label', noticeText)];
    for (const person of allInGroup) {
      const isCurrent = person.id === focus.id;
      const label = person.disambiguator ? `${person.name} (${person.disambiguator})` : person.name;
      const btn = action(label, () => {
        if (!isCurrent) focusPerson(person.id);
      }, isCurrent ? 'genealogy-person-pill is-active' : 'genealogy-person-pill');
      btn.setAttribute('aria-pressed', String(isCurrent));
      nodes.push(btn);
    }
    homonymStrip.hidden = false;
    homonymStrip.replaceChildren(...nodes);
  }

  // === @section:ui:tree ===
  function renderSvgTree(neighborhood: FamilyNeighborhood): void {
    treeInteractionAbort?.abort();
    treeInteractionAbort = new AbortController();
    const { signal } = treeInteractionAbort;

    const NODE_W = 148;
    const NODE_H = 50;
    const H_GAP = 16;
    const V_GAP = neighborhood.spouses.length > 2 ? 46 : 38;
    const PAD_X = 24;
    const PAD_Y = 22;
    const MIN_ZOOM = 0.45;
    const MAX_ZOOM = 2.6;
    const DRAG_THRESHOLD_PX = 6;

    const focus = neighborhood.focus;
    const focusRowNodes: {
      person: BiblicalPerson;
      roleLabel: string;
      witness: string;
      kind: 'focus' | 'family';
      relType?: 'sibling' | 'spouse';
    }[] = [
      ...neighborhood.siblings.map(s => ({
        person: s.person,
        roleLabel: 'Sibling',
        witness: s.edge.witnessRef.label,
        kind: 'family' as const,
        relType: 'sibling' as const,
      })),
      {
        person: focus,
        roleLabel: 'Focus',
        witness: focus.keyRefs[0]?.label ?? '',
        kind: 'focus' as const,
      },
      ...neighborhood.spouses.map(s => ({
        person: s.person,
        roleLabel: 'Spouse',
        witness: s.edge.witnessRef.label,
        kind: 'family' as const,
        relType: 'spouse' as const,
      })),
    ];

    const rows: {
      key: 'grandparents' | 'parents' | 'focus' | 'children' | 'grandchildren';
      items: {
        person: BiblicalPerson;
        roleLabel: string;
        witness: string;
        kind: 'focus' | 'family';
        via?: string;
        relType?: 'sibling' | 'spouse';
      }[];
    }[] = [];

    if (maxGenerations === 2 && neighborhood.grandparents.length > 0) {
      rows.push({
        key: 'grandparents',
        items: neighborhood.grandparents.map(g => ({
          person: g.person,
          roleLabel: `via ${g.via}`,
          witness: g.edge.witnessRef.label,
          kind: 'family',
          via: g.via,
        })),
      });
    }
    if (neighborhood.parents.length > 0) {
      rows.push({
        key: 'parents',
        items: neighborhood.parents.map(p => ({
          person: p.person,
          roleLabel: p.edge.type === 'father' ? 'Father' : 'Mother',
          witness: p.edge.witnessRef.label,
          kind: 'family',
        })),
      });
    }
    rows.push({ key: 'focus', items: focusRowNodes });
    if (neighborhood.children.length > 0) {
      rows.push({
        key: 'children',
        items: neighborhood.children.map(c => ({
          person: c.person,
          roleLabel: 'Child',
          witness: c.edge.witnessRef.label,
          kind: 'family',
        })),
      });
    }
    if (maxGenerations === 2 && neighborhood.grandchildren.length > 0) {
      rows.push({
        key: 'grandchildren',
        items: neighborhood.grandchildren.map(gc => ({
          person: gc.person,
          roleLabel: `via ${gc.via}`,
          witness: gc.edge.witnessRef.label,
          kind: 'family',
          via: gc.via,
        })),
      });
    }

    const maxCols = Math.max(1, ...rows.map(r => r.items.length));
    const colGap = maxCols > 4 ? 22 : H_GAP;
    const mainWidth = Math.max(460, maxCols * NODE_W + (maxCols - 1) * colGap);

    const placedIds = new Set<string>();
    for (const r of rows) {
      for (const item of r.items) placedIds.add(item.person.id);
    }

    const unplacedSocial = neighborhood.socialLinks.filter(s => !placedIds.has(s.person.id));
    const placedSocialMap = new Map<string, { roleText: string; edge: PersonRelationship }>();
    for (const s of neighborhood.socialLinks) {
      if (placedIds.has(s.person.id)) {
        placedSocialMap.set(s.person.id, { roleText: s.roleText, edge: s.edge });
      }
    }

    const sideColWidth = unplacedSocial.length > 0 ? NODE_W + 64 : 0;
    const viewW = PAD_X * 2 + mainWidth + sideColWidth;
    const mainRowsHeight = rows.length * NODE_H + Math.max(0, rows.length - 1) * V_GAP;
    const sideHeight = unplacedSocial.length * NODE_H + Math.max(0, unplacedSocial.length - 1) * 14;
    const viewH = PAD_Y * 2 + Math.max(mainRowsHeight, sideHeight);

    const placedById = new Map<string, PlacedSvgNode>();
    const placedList: PlacedSvgNode[] = [];

    rows.forEach((row, rIdx) => {
      const rowWidth = row.items.length * NODE_W + Math.max(0, row.items.length - 1) * colGap;
      const startX = PAD_X + (mainWidth - rowWidth) / 2;
      const y = PAD_Y + rIdx * (NODE_H + V_GAP);

      row.items.forEach((item, cIdx) => {
        const x = startX + cIdx * (NODE_W + colGap);
        const socialExtra = placedSocialMap.get(item.person.id);
        const roleLabel = socialExtra ? `${item.roleLabel} · ${socialExtra.roleText}` : item.roleLabel;
        const titleParts = [
          item.person.name,
          item.person.disambiguator ? `(${item.person.disambiguator})` : '',
          `— ${roleLabel}`,
          item.witness ? `[${item.witness}]` : '',
        ].filter(Boolean);
        const node: PlacedSvgNode = {
          person: item.person,
          x,
          y,
          roleLabel,
          titleText: titleParts.join(' '),
          kind: item.kind,
        };
        if (!placedById.has(item.person.id)) placedById.set(item.person.id, node);
        placedList.push(node);
      });
    });

    const sideStartX = PAD_X + mainWidth + 52;
    unplacedSocial.forEach((soc, idx) => {
      const y = PAD_Y + idx * (NODE_H + 14);
      const titleParts = [
        soc.person.name,
        soc.person.disambiguator ? `(${soc.person.disambiguator})` : '',
        `— ${soc.roleText} [${soc.edge.witnessRef.label}]`,
      ].filter(Boolean);
      const node: PlacedSvgNode = {
        person: soc.person,
        x: sideStartX,
        y,
        roleLabel: soc.roleText,
        titleText: titleParts.join(' '),
        kind: 'social',
      };
      placedById.set(soc.person.id, node);
      placedList.push(node);
    });

    const svg = svgEl('svg', {
      class: 'genealogy-svg',
      width: viewW,
      height: viewH,
      viewBox: `0 0 ${viewW} ${viewH}`,
      role: 'img',
      'aria-label': `Family and relationship tree centered on ${focus.name}`,
    });

    const edgesGroup = svgEl('g', { class: 'genealogy-svg-edges', fill: 'none' });
    const nodesGroup = svgEl('g', { class: 'genealogy-svg-nodes' });
    svg.append(edgesGroup, nodesGroup);

    const focusNode = placedById.get(focus.id)!;
    const focusCx = focusNode.x + NODE_W / 2;
    const focusCy = focusNode.y + NODE_H / 2;

    // Grandparents -> Parents orthogonal connectors
    for (const gp of neighborhood.grandparents) {
      const gpNode = placedById.get(gp.person.id);
      const viaParent = neighborhood.parents.find(p => p.person.name === gp.via);
      const parentNode = viaParent ? placedById.get(viaParent.person.id) : undefined;
      if (!gpNode || !parentNode) continue;
      const x1 = gpNode.x + NODE_W / 2;
      const y1 = gpNode.y + NODE_H;
      const x2 = parentNode.x + NODE_W / 2;
      const y2 = parentNode.y;
      const midY = (y1 + y2) / 2;
      edgesGroup.append(
        svgEl('path', {
          d: `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`,
          stroke: 'var(--border)',
          'stroke-width': 1.6,
        }),
      );
    }

    // Parents -> Focus orthogonal connectors
    for (const p of neighborhood.parents) {
      const pNode = placedById.get(p.person.id);
      if (!pNode) continue;
      const x1 = pNode.x + NODE_W / 2;
      const y1 = pNode.y + NODE_H;
      const y2 = focusNode.y;
      const midY = (y1 + y2) / 2;
      edgesGroup.append(
        svgEl('path', {
          d: `M ${x1} ${y1} L ${x1} ${midY} L ${focusCx} ${midY} L ${focusCx} ${y2}`,
          stroke: 'var(--border)',
          'stroke-width': 1.8,
        }),
      );
    }

    // Siblings top bracket in Focus row
    if (neighborhood.siblings.length > 0) {
      const sibNodes = neighborhood.siblings
        .map(s => placedById.get(s.person.id))
        .filter((n): n is PlacedSvgNode => Boolean(n));
      const allGroup = [...sibNodes, focusNode];
      const bracketY = focusNode.y - 11;
      const minX = Math.min(...allGroup.map(n => n.x + NODE_W / 2));
      const maxX = Math.max(...allGroup.map(n => n.x + NODE_W / 2));
      edgesGroup.append(
        svgEl('path', {
          d: `M ${minX} ${focusNode.y} L ${minX} ${bracketY} L ${maxX} ${bracketY} L ${maxX} ${focusNode.y}`,
          stroke: 'var(--muted)',
          'stroke-opacity': 0.55,
          'stroke-width': 1.4,
        }),
      );
      for (const sn of sibNodes) {
        const sx = sn.x + NODE_W / 2;
        edgesGroup.append(
          svgEl('line', {
            x1: sx,
            y1: bracketY,
            x2: sx,
            y2: sn.y,
            stroke: 'var(--muted)',
            'stroke-opacity': 0.55,
            'stroke-width': 1.4,
          }),
        );
      }
      edgesGroup.append(
        svgEl('line', {
          x1: focusCx,
          y1: bracketY,
          x2: focusCx,
          y2: focusNode.y,
          stroke: 'var(--muted)',
          'stroke-opacity': 0.55,
          'stroke-width': 1.4,
        }),
      );
    }

    // Spouses solid gold connector
    neighborhood.spouses.forEach((sp, idx) => {
      const spNode = placedById.get(sp.person.id);
      if (!spNode) return;
      if (idx === 0) {
        edgesGroup.append(
          svgEl('line', {
            x1: focusNode.x + NODE_W,
            y1: focusCy,
            x2: spNode.x,
            y2: spNode.y + NODE_H / 2,
            stroke: 'var(--gold, #c99d49)',
            'stroke-width': 2.5,
          }),
        );
      } else {
        const arcY = focusNode.y + NODE_H + 10 + (idx - 1) * 6;
        const spCx = spNode.x + NODE_W / 2;
        edgesGroup.append(
          svgEl('path', {
            d: `M ${focusCx} ${focusNode.y + NODE_H} L ${focusCx} ${arcY} L ${spCx} ${arcY} L ${spCx} ${spNode.y + NODE_H}`,
            stroke: 'var(--gold, #c99d49)',
            'stroke-width': 2.1,
          }),
        );
      }
    });

    // Focus -> Children orthogonal connectors
    for (const c of neighborhood.children) {
      const cNode = placedById.get(c.person.id);
      if (!cNode) continue;
      const y1 = focusNode.y + NODE_H;
      const x2 = cNode.x + NODE_W / 2;
      const y2 = cNode.y;
      const midY = (y1 + y2) / 2;
      edgesGroup.append(
        svgEl('path', {
          d: `M ${focusCx} ${y1} L ${focusCx} ${midY} L ${x2} ${midY} L ${x2} ${y2}`,
          stroke: 'var(--border)',
          'stroke-width': 1.8,
        }),
      );
    }

    // Children -> Grandchildren orthogonal connectors
    for (const gc of neighborhood.grandchildren) {
      const gcNode = placedById.get(gc.person.id);
      const viaChild = neighborhood.children.find(c => c.person.name === gc.via);
      const childNode = viaChild ? placedById.get(viaChild.person.id) : undefined;
      if (!gcNode || !childNode) continue;
      const x1 = childNode.x + NODE_W / 2;
      const y1 = childNode.y + NODE_H;
      const x2 = gcNode.x + NODE_W / 2;
      const y2 = gcNode.y;
      const midY = (y1 + y2) / 2;
      edgesGroup.append(
        svgEl('path', {
          d: `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`,
          stroke: 'var(--border)',
          'stroke-width': 1.6,
        }),
      );
    }

    // Social / Mentorship / Succession / Adversary dashed connectors
    for (const soc of neighborhood.socialLinks) {
      const target = placedById.get(soc.person.id);
      if (!target) continue;
      const stroke =
        soc.edge.type === 'mentor_disciple'
          ? '#8b5cf6'
          : soc.edge.type === 'adversary'
            ? '#c84b4b'
            : '#1b998b';
      const x1 = focusNode.x + NODE_W;
      const y1 = focusCy;
      const x2 = target.x;
      const y2 = target.y + NODE_H / 2;
      const ctrlX = (x1 + x2) / 2;
      const pathD =
        target.x >= focusNode.x + NODE_W
          ? `M ${x1} ${y1} C ${ctrlX} ${y1}, ${ctrlX} ${y2}, ${x2} ${y2}`
          : `M ${focusCx} ${focusCy} Q ${(focusCx + target.x + NODE_W / 2) / 2 + 24} ${(focusCy + target.y + NODE_H / 2) / 2}, ${target.x + NODE_W / 2} ${target.y}`;
      edgesGroup.append(
        svgEl('path', {
          d: pathD,
          stroke,
          'stroke-width': 1.8,
          'stroke-dasharray': '5 4',
        }),
      );
    }

    // Render SVG person cards
    for (const node of placedList) {
      const isFocus = node.kind === 'focus';
      const isSocial = node.kind === 'social';
      const g = svgEl('g', {
        class: 'genealogy-node',
        role: 'button',
        tabindex: '0',
        'aria-label': node.titleText,
      });
      g.append(svgEl('title', {}, node.titleText));

      const rectAttrs: Record<string, string | number> = {
        class: 'genealogy-node-rect',
        x: node.x,
        y: node.y,
        width: NODE_W,
        height: NODE_H,
        rx: 8,
        fill: isFocus ? 'var(--accent)' : 'var(--panel)',
        stroke: isFocus ? 'var(--gold)' : isSocial ? '#1b998b' : 'var(--border)',
        'stroke-width': isFocus ? 2.2 : 1.3,
      };
      if (isSocial) rectAttrs['stroke-dasharray'] = '4 2';

      g.append(svgEl('rect', rectAttrs));

      const displayName = node.person.disambiguator && node.person.homonymGroup
        ? truncateText(`${node.person.name} (${node.person.disambiguator})`, 20)
        : truncateText(node.person.name, 20);

      g.append(
        svgEl('text', {
          x: node.x + NODE_W / 2,
          y: node.y + 21,
          'text-anchor': 'middle',
          fill: 'var(--text)',
          'font-size': 12.5,
          'font-weight': isFocus ? '700' : '600',
        }, displayName),
      );

      g.append(
        svgEl('text', {
          x: node.x + NODE_W / 2,
          y: node.y + 38,
          'text-anchor': 'middle',
          fill: isFocus ? 'var(--gold)' : 'var(--muted)',
          'font-size': 10.5,
        }, truncateText(node.roleLabel, 22)),
      );

      const activate = () => focusPerson(node.person.id);
      g.addEventListener('click', activate);
      g.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });

      nodesGroup.append(g);
    }

    const zoomBar = el('div', 'genealogy-zoom-bar');
    const zoomControls = el('div', 'genealogy-zoom-controls');
    const zoomBadge = el('span', 'genealogy-zoom-badge', '100%');
    zoomBadge.setAttribute('aria-live', 'polite');

    const viewport = el('div', 'genealogy-viewport');
    viewport.setAttribute('aria-label', 'Zoomable and pannable family tree viewport');
    const stage = el('div', 'genealogy-canvas-stage');
    stage.append(svg);
    viewport.append(stage);

    let scale = 1;
    let tx = 0;
    let ty = 0;
    let suppressNextClick = false;

    const getViewportSize = () => {
      const rect = viewport.getBoundingClientRect();
      return {
        w: rect.width > 0 ? rect.width : (svgWrap.clientWidth > 20 ? svgWrap.clientWidth - 20 : 560),
        h: rect.height > 0 ? rect.height : 320,
      };
    };

    const applyTransform = () => {
      stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      zoomBadge.textContent = `${Math.round(scale * 100)}%`;
    };

    const zoomAt = (nextScale: number, anchorX: number, anchorY: number) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextScale));
      if (Math.abs(clamped - scale) < 0.0005) return;
      const factor = clamped / scale;
      tx = anchorX - (anchorX - tx) * factor;
      ty = anchorY - (anchorY - ty) * factor;
      scale = clamped;
      applyTransform();
    };

    const fitView = () => {
      const { w: vpW, h: vpH } = getViewportSize();
      const availW = Math.max(160, vpW - 16);
      const availH = Math.max(140, vpH - 16);
      const fitScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(availW / viewW, availH / viewH, 1)));
      scale = fitScale;
      tx = Math.round((vpW - viewW * scale) / 2);
      ty = Math.round((vpH - viewH * scale) / 2);
      applyTransform();
    };

    const resetZoom = () => {
      const { w: vpW, h: vpH } = getViewportSize();
      scale = 1;
      tx = viewW <= vpW ? Math.round((vpW - viewW) / 2) : Math.round(vpW / 2 - focusCx);
      ty = viewH <= vpH ? Math.round((vpH - viewH) / 2) : Math.round(vpH / 2 - focusCy);
      applyTransform();
    };

    const zoomByButton = (factor: number) => {
      const { w: vpW, h: vpH } = getViewportSize();
      zoomAt(scale * factor, vpW / 2, vpH / 2);
    };

    const zoomOutBtn = action('Zoom −', () => zoomByButton(1 / 1.2), 'genealogy-zoom-btn');
    const zoomInBtn = action('Zoom +', () => zoomByButton(1.2), 'genealogy-zoom-btn');
    const fitBtn = action('Fit', fitView, 'genealogy-zoom-btn');
    const resetBtn = action('100%', resetZoom, 'genealogy-zoom-btn');
    zoomControls.append(zoomOutBtn, zoomInBtn, fitBtn, resetBtn, zoomBadge);

    const zoomHint = el('span', 'genealogy-zoom-hint', 'Drag to pan · Ctrl/scroll wheel or buttons to zoom');
    zoomBar.append(zoomControls, zoomHint);

    viewport.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const anchorX = e.clientX - rect.left;
      const anchorY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(scale * factor, anchorX, anchorY);
    }, { passive: false, signal });

    const activePointers = new Map<number, { x: number; y: number }>();
    let dragPointerId: number | null = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartTx = 0;
    let dragStartTy = 0;
    let didPan = false;
    let pinchLastDist = 0;

    viewport.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 1) {
        dragPointerId = e.pointerId;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartTx = tx;
        dragStartTy = ty;
        didPan = false;
        suppressNextClick = false;
      } else if (activePointers.size === 2) {
        const pts = [...activePointers.values()];
        pinchLastDist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
        dragPointerId = null;
        didPan = true;
        suppressNextClick = true;
      }
    }, { signal });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const pts = [...activePointers.values()];
        const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
        if (pinchLastDist > 0 && dist > 0) {
          const rect = viewport.getBoundingClientRect();
          const midX = (pts[0]!.x + pts[1]!.x) / 2 - rect.left;
          const midY = (pts[0]!.y + pts[1]!.y) / 2 - rect.top;
          zoomAt(scale * (dist / pinchLastDist), midX, midY);
        }
        pinchLastDist = dist;
        return;
      }

      if (e.pointerId === dragPointerId) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (!didPan && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
          didPan = true;
          suppressNextClick = true;
          viewport.classList.add('is-panning');
        }
        if (didPan) {
          tx = dragStartTx + dx;
          ty = dragStartTy + dy;
          applyTransform();
        }
      }
    }, { signal });

    const endPointer = (e: PointerEvent) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinchLastDist = 0;

      if (e.pointerId === dragPointerId) {
        dragPointerId = null;
        viewport.classList.remove('is-panning');
        if (didPan) {
          setTimeout(() => {
            suppressNextClick = false;
          }, 0);
        }
      }
    };

    window.addEventListener('pointerup', endPointer, { signal });
    window.addEventListener('pointercancel', endPointer, { signal });

    viewport.addEventListener('click', (e: MouseEvent) => {
      if (suppressNextClick) {
        e.stopPropagation();
        e.preventDefault();
        suppressNextClick = false;
      }
    }, { capture: true, signal });

    const legend = el('div', 'genealogy-svg-legend');
    const legendItems = el('div', 'genealogy-legend-items');

    const addLegend = (cls: string, text: string) => {
      const item = el('span', 'genealogy-legend-item');
      item.append(el('span', `genealogy-legend-swatch ${cls}`), el('span', '', text));
      legendItems.append(item);
    };
    addLegend('', 'Parent / Child');
    addLegend('is-spouse', 'Spouse');
    addLegend('is-mentor', 'Mentor / Disciple');
    addLegend('is-social', 'Covenant Friend / Successor');
    if (neighborhood.socialLinks.some(s => s.edge.type === 'adversary')) {
      addLegend('is-adversary', 'Slayer / Victim');
    }

    const countNote = neighborhood.truncated
      ? `Showing bounded neighborhood (${neighborhood.nodeCount}/22 max nodes · truncated)`
      : neighborhood.nodeCount <= 1
        ? `No direct 1–2 generation edges in ${isFullPeopleGraphLoaded() ? 'dataset' : 'curated subset'} — see key references below`
        : `Showing ${neighborhood.nodeCount} connected figures (cap 22)`;

    legend.append(legendItems, el('span', '', countNote));
    svgWrap.replaceChildren(zoomBar, viewport, legend);

    fitView();
    if (viewport.getBoundingClientRect().width === 0 && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => fitView());
    }
  }

  // === @section:ui:detail ===
  function renderDetailCard(neighborhood: FamilyNeighborhood): void {
    const person = neighborhood.focus;
    const nodes: HTMLElement[] = [];

    // Header
    const header = el('div', 'genealogy-detail-header');
    const nameBlock = el('div');
    nameBlock.append(el('h3', 'genealogy-detail-name', person.name));
    if (person.disambiguator) {
      nameBlock.append(el('p', 'genealogy-detail-disambig', person.disambiguator));
    }
    const badges = el('div', 'genealogy-badges');
    badges.append(
      el('span', 'genealogy-badge', person.era),
      el('span', 'genealogy-badge', LINEAGE_LABELS[person.lineageGroup]),
    );
    header.append(nameBlock, badges);
    nodes.push(header);

    // Original script & Strong's
    if (person.hebrew || person.greek || person.transliteration || (person.strongs && person.strongs.length > 0)) {
      const scriptRow = el('div', 'genealogy-script-row');
      if (person.hebrew) {
        const heSpan = el('span', 'genealogy-script', person.hebrew);
        heSpan.dir = 'rtl';
        heSpan.lang = 'he';
        scriptRow.append(heSpan);
      }
      if (person.greek) {
        const elSpan = el('span', 'genealogy-script', person.greek);
        elSpan.dir = 'ltr';
        elSpan.lang = 'el';
        scriptRow.append(elSpan);
      }
      if (person.transliteration) {
        scriptRow.append(el('span', 'genealogy-translit', person.transliteration));
      }
      if (person.strongs) {
        for (const code of person.strongs) {
          if (callbacks.onInspectStrongs) {
            const sBtn = action(code, () => callbacks.onInspectStrongs?.(code), 'genealogy-strongs-btn');
            sBtn.title = `Inspect Strong's ${code}`;
            scriptRow.append(sBtn);
          } else {
            scriptRow.append(el('span', 'genealogy-strongs-btn', code));
          }
        }
      }
      nodes.push(scriptRow);
    }

    // Summary
    const summaryP = el('p', '', person.summary);
    summaryP.style.margin = '0';
    summaryP.style.fontSize = '13px';
    nodes.push(summaryP);

    // Competing genealogy / Table of Nations epistemic alert
    if (person.competingGenealogyNote) {
      const alert = el('div', 'genealogy-epistemic-alert');
      alert.setAttribute('role', 'note');
      alert.append(
        el('span', 'genealogy-epistemic-title', 'Textual & Genealogical Notice'),
        el('span', '', person.competingGenealogyNote),
      );
      nodes.push(alert);
    }

    // Key Refs
    if (person.keyRefs.length > 0) {
      const keyRefsRow = el('div', 'genealogy-keyrefs');
      const label = el('span', 'study-muted', 'Key passages:');
      label.style.fontSize = '12px';
      keyRefsRow.append(label);
      for (const kr of person.keyRefs) {
        const grp = el('span', 'genealogy-keyref-group');
        const refBtn = action(
          kr.label,
          () => callbacks.preview.pin(kr.passage, `${person.name} — key passage (${kr.label})`),
          'genealogy-keyref-btn',
        );
        callbacks.preview.attach(refBtn, kr.passage, `${person.name} — key passage (${kr.label})`);
        const openBtn = action('Open', () => callbacks.onNavigate(kr.passage), 'genealogy-keyref-open');
        openBtn.title = `Navigate to ${kr.label}`;
        grp.append(refBtn, openBtn);
        keyRefsRow.append(grp);
      }
      nodes.push(keyRefsRow);
    }

    // Categorized Relationships
    const relGroups = el('div', 'genealogy-rel-groups');

    const appendRelGroup = (
      title: string,
      items: { person: BiblicalPerson; edge: PersonRelationship; roleText: string }[],
    ) => {
      if (items.length === 0) return;
      const group = el('div');
      group.append(el('h4', 'genealogy-rel-group-title', title));
      const list = el('ul', 'genealogy-rel-list');

      for (const item of items) {
        const li = el('li', 'genealogy-rel-item');
        const row = el('div', 'genealogy-rel-row');
        const left = el('div', 'genealogy-rel-left');
        left.append(el('span', 'genealogy-role-tag', item.roleText));

        const personLabel = item.person.disambiguator
          ? `${item.person.name} (${item.person.disambiguator})`
          : item.person.name;
        const personBtn = action(personLabel, () => focusPerson(item.person.id), 'genealogy-rel-person-btn');
        left.append(personBtn);

        const witnessWrap = el('div', 'genealogy-witness-wrap');
        const category = item.edge.category ?? 'explicit';
        witnessWrap.append(
          el('span', `genealogy-cat-badge is-${category}`, category),
        );
        const witnessBtn = action(
          item.edge.witnessRef.label,
          () => callbacks.onNavigate(item.edge.witnessRef.passage),
          'genealogy-witness-badge',
        );
        witnessBtn.title = `Open ${item.edge.witnessRef.label}`;
        callbacks.preview.attach(
          witnessBtn,
          item.edge.witnessRef.passage,
          `${person.name} ↔ ${item.person.name} (${item.roleText})`,
        );
        witnessWrap.append(witnessBtn);

        row.append(left, witnessWrap);
        li.append(row);

        const notes = [item.edge.note, item.edge.competingModel].filter(Boolean).join(' · ');
        if (notes) {
          li.append(el('p', 'genealogy-rel-note', notes));
        }
        list.append(li);
      }
      group.append(list);
      relGroups.append(group);
    };

    appendRelGroup(
      'Parents',
      neighborhood.parents.map(p => ({
        person: p.person,
        edge: p.edge,
        roleText: roleLabelForEdge(p.edge, person.id),
      })),
    );
    if (maxGenerations === 2) {
      appendRelGroup(
        'Grandparents',
        neighborhood.grandparents.map(g => ({
          person: g.person,
          edge: g.edge,
          roleText: `${g.edge.type === 'father' ? 'Grandfather' : 'Grandmother'} (via ${g.via})`,
        })),
      );
    }
    appendRelGroup(
      'Spouses',
      neighborhood.spouses.map(s => ({ person: s.person, edge: s.edge, roleText: 'Spouse' })),
    );
    appendRelGroup(
      'Siblings',
      neighborhood.siblings.map(s => ({ person: s.person, edge: s.edge, roleText: 'Sibling' })),
    );
    appendRelGroup(
      'Children',
      neighborhood.children.map(c => ({ person: c.person, edge: c.edge, roleText: 'Child' })),
    );
    if (maxGenerations === 2) {
      appendRelGroup(
        'Grandchildren',
        neighborhood.grandchildren.map(gc => ({
          person: gc.person,
          edge: gc.edge,
          roleText: `Grandchild (via ${gc.via})`,
        })),
      );
    }
    appendRelGroup('Disciples, Friends & Successors', neighborhood.socialLinks);

    if (relGroups.childElementCount > 0) {
      nodes.push(relGroups);
    }

    detailWrap.replaceChildren(...nodes);
  }

  function renderTreeAndDetail(): void {
    depth1Btn.classList.toggle('is-active', maxGenerations === 1);
    depth1Btn.setAttribute('aria-pressed', String(maxGenerations === 1));
    depth2Btn.classList.toggle('is-active', maxGenerations === 2);
    depth2Btn.setAttribute('aria-pressed', String(maxGenerations === 2));

    const neighborhood = buildBoundedFamilyNeighborhood(activePersonId, maxGenerations);
    if (!neighborhood) {
      homonymStrip.hidden = true;
      svgWrap.replaceChildren(status('Select a biblical figure to inspect their family and social tree.'));
      detailWrap.replaceChildren();
      return;
    }

    renderHomonymStrip(neighborhood.focus);
    renderSvgTree(neighborhood);
    renderDetailCard(neighborhood);
  }

  function focusPerson(personId?: string): void {
    const requested = personId?.trim();
    if (requested && getPersonById(requested)) {
      pendingFocusId = null;
      activePersonId = getPersonById(requested)!.id;
      renderFilterStrip();
      renderTreeAndDetail();
      return;
    }

    if (requested && !isFullPeopleGraphLoaded()) {
      pendingFocusId = requested;
      void loadFullPeopleGraph().then((loaded) => {
        updateStatsPill();
        if (loaded && pendingFocusId === requested && getPersonById(requested)) {
          focusPerson(requested);
        } else {
          renderFilterStrip();
          renderTreeAndDetail();
        }
      });
    }

    activePersonId = DEFAULT_PERSON_ID;
    renderFilterStrip();
    renderTreeAndDetail();
  }

  focusPerson(DEFAULT_PERSON_ID);

  void loadVersePersonIndex();
  void loadFullPeopleGraph().then((loaded) => {
    updateStatsPill();
    if (!loaded) return;
    if (pendingFocusId && getPersonById(pendingFocusId)) {
      focusPerson(pendingFocusId);
      return;
    }
    renderFilterStrip();
    renderTreeAndDetail();
  });

  return {
    element: root,
    focusPerson,
  };
}
