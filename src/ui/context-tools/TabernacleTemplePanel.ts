// @file: src/ui/context-tools/TabernacleTemplePanel.ts
// @feature: context-tools
// @tables: none
// @candidates: none
// @toc: imports | types | styles | ui:main

// === @section:imports ===
import type { ActivePassage } from '../../api/types';
import type { ContextPreview } from '../components/ContextPreview';
import { action, el, status } from '../study-dom';
import {
  ARCHITECTURE_PLANS,
  renderArchitectureSvg,
  type ArchitectureElement,
  type ArchitecturePlanId,
} from './sacred-architecture';

// === @section:types ===
export interface TabernacleTempleCallbacks {
  preview: ContextPreview;
  onNavigate: (p: ActivePassage) => void;
  onInspectStrongs?: (strongs: string) => void;
}

export interface TabernacleTempleHandle {
  element: HTMLElement;
  focusPlan: (planId?: ArchitecturePlanId, elementId?: string) => void;
  focusElement: (planId: ArchitecturePlanId, elementId?: string) => void;
}

const PLAN_TABS: { id: ArchitecturePlanId; label: string }[] = [
  { id: 'tabernacle', label: 'Wilderness Tabernacle' },
  { id: 'first_temple', label: '1st Temple (Solomon)' },
  { id: 'second_temple', label: 'Second Temple (NT)' },
  { id: 'jerusalem_gates', label: 'Jerusalem & Gates' },
];

const QUICK_JUMP_PRIORITY: Record<ArchitecturePlanId, string[]> = {
  tabernacle: ['ark_covenant', 'mercy_seat', 'menorah', 'table_showbread', 'incense_altar', 'veil', 'bronze_laver', 'bronze_altar', 'courtyard_gate'],
  first_temple: ['debir', 'solomon_ark_cherubim', 'hekal', 'ten_lampstands', 'ten_tables', 'pillars_jachin_boaz', 'molten_sea', 'first_bronze_altar', 'ten_lavers', 'side_chambers'],
  second_temple: ['second_most_holy', 'second_veil', 'second_menorah', 'second_showbread', 'beautiful_gate', 'nicanor_gate', 'solomons_portico', 'royal_stoa', 'soreq_balustrade', 'court_israel_priests'],
  jerusalem_gates: ['east_gate', 'sheep_gate', 'fish_gate', 'water_gate', 'fountain_gate', 'dung_gate', 'valley_gate', 'horse_gate', 'antonia_fortress', 'gethsemane', 'herods_palace', 'gihon_spring', 'pool_of_siloam', 'pool_of_bethesda', 'mount_of_olives', 'kidron_valley', 'tyropoeon_valley', 'temple_mount'],
};

const STYLE_ID = 'tabernacle-temple-panel-styles';
const DEFAULT_PLAN_ID: ArchitecturePlanId = 'tabernacle';

// === @section:styles ===
function ensureArchitecturePanelStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.arch-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
  color: var(--text);
  min-width: 0;
}
.arch-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px 12px;
}
.arch-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.arch-title {
  margin: 0;
  font: 600 18px/1.25 Georgia, serif;
}
.arch-subtitle {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}
.arch-era-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--gold);
  background: color-mix(in srgb, var(--gold) 12%, var(--background));
  color: var(--gold-light);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.arch-plan-switcher {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
}
.arch-plan-btn {
  flex: 1 1 150px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--muted);
  padding: 7px 11px;
  font-size: 12.5px;
  font-weight: 500;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}
.arch-plan-btn:hover,
.arch-plan-btn:focus-visible {
  border-color: var(--gold);
  color: var(--text);
}
.arch-plan-btn.is-active {
  border-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 16%, var(--panel));
  color: var(--gold-light);
  font-weight: 600;
}
.arch-epistemic-box {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--gold);
  border-radius: 6px;
  background: color-mix(in srgb, var(--gold) 8%, var(--background));
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
}
.arch-quick-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.arch-section-eyebrow {
  margin: 0;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gold);
}
.arch-quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.arch-element-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--background);
  color: var(--text);
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.35;
  cursor: pointer;
}
.arch-element-chip:hover,
.arch-element-chip:focus-visible {
  border-color: var(--gold);
  background: var(--soft);
}
.arch-element-chip.is-active {
  border-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 18%, var(--panel));
  color: var(--gold-light);
  font-weight: 600;
}
.arch-svg-viewport {
  width: 100%;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
  overflow-x: auto;
}
.arch-svg-viewport svg {
  width: 100%;
  min-width: 300px;
  height: auto;
}
.arch-spotlight-card {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
  min-width: 0;
}
.arch-spotlight-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.arch-spotlight-title {
  margin: 0;
  font: 600 18px/1.25 Georgia, serif;
}
.arch-zone-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  font-size: 11px;
}
.arch-script-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
}
.arch-original-hebrew {
  font-size: 18px;
  font-weight: 600;
  color: var(--gold-light);
}
.arch-original-greek {
  font-size: 16px;
  font-weight: 600;
  color: var(--gold-light);
}
.arch-translit {
  font-size: 13px;
  font-style: italic;
  color: var(--muted);
}
.arch-strongs-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.arch-strongs-pill {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--soft);
  color: var(--gold-light);
  padding: 3px 9px;
  font-size: 11.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.arch-strongs-pill:hover,
.arch-strongs-pill:focus-visible {
  border-color: var(--gold);
  background: var(--accent);
}
.arch-dimensions-box {
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  font-size: 12.5px;
  line-height: 1.5;
}
.arch-summary {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.6;
}
.arch-historical-note {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--green);
  border-radius: 6px;
  background: color-mix(in srgb, var(--green) 8%, var(--panel));
  font-size: 12.5px;
  line-height: 1.55;
}
.arch-refs-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.arch-ref-btn {
  font-size: 12px;
  padding: 5px 10px;
}
@media (max-width: 540px) {
  .arch-panel { padding: 12px; }
  .arch-plan-btn { flex: 1 1 130px; min-height: 38px; font-size: 12px; }
  .arch-element-chip, .arch-strongs-pill, .arch-ref-btn { min-height: 36px; }
  .arch-svg-viewport { padding: 8px; }
}
`;
  document.head.append(style);
}

// === @section:ui:main ===
export function createTabernacleTemplePanel(callbacks: TabernacleTempleCallbacks): TabernacleTempleHandle {
  ensureArchitecturePanelStyles();

  let activePlanId: ArchitecturePlanId = DEFAULT_PLAN_ID;
  let activeElementId: string = ARCHITECTURE_PLANS[DEFAULT_PLAN_ID].elements[0]!.id;
  let showTerrain = true;

  const element = el('section', 'arch-panel');
  element.setAttribute('aria-label', 'Tabernacle, Temples and Jerusalem Gates');

  const headerHost = el('div', 'arch-header');
  const switcherHost = el('div', 'arch-plan-switcher');
  switcherHost.setAttribute('role', 'tablist');
  switcherHost.setAttribute('aria-label', 'Sacred architecture plans');

  const epistemicHost = el('div', 'arch-epistemic-box');
  const quickWrap = el('div', 'arch-quick-wrap');
  const svgToolbarHost = el('div', '');
  svgToolbarHost.style.display = 'flex';
  svgToolbarHost.style.justifyContent = 'flex-end';
  svgToolbarHost.style.alignItems = 'center';
  svgToolbarHost.style.gap = '8px';
  const svgViewport = el('div', 'arch-svg-viewport');
  const spotlightHost = el('article', 'arch-spotlight-card');

  element.append(headerHost, switcherHost, epistemicHost, quickWrap, svgToolbarHost, svgViewport, spotlightHost);

  function getOrderedElements(planId: ArchitecturePlanId): ArchitectureElement[] {
    const plan = ARCHITECTURE_PLANS[planId];
    const priority = QUICK_JUMP_PRIORITY[planId] ?? [];
    const rank = new Map<string, number>(priority.map((id, idx) => [id, idx]));
    return [...plan.elements].sort((a, b) => {
      const ra = rank.get(a.id) ?? 999;
      const rb = rank.get(b.id) ?? 999;
      return ra - rb;
    });
  }

  function resolveActiveElement(): ArchitectureElement {
    const plan = ARCHITECTURE_PLANS[activePlanId];
    return plan.elements.find(item => item.id === activeElementId) ?? plan.elements[0]!;
  }

  function renderHeader() {
    const plan = ARCHITECTURE_PLANS[activePlanId];
    headerHost.replaceChildren();

    const titleWrap = el('div', 'arch-title-wrap');
    const eyebrow = el('p', 'eyebrow', 'SACRED ARCHITECTURE & BIBLICAL TOPOGRAPHY');
    eyebrow.style.margin = '0 0 2px';
    const title = el('h3', 'arch-title', plan.title);
    const subtitle = el('p', 'arch-subtitle', plan.subtitle);
    titleWrap.append(eyebrow, title, subtitle);

    const eraPill = el('span', 'arch-era-pill', plan.eraLabel);
    headerHost.append(titleWrap, eraPill);
  }

  function renderSwitcher() {
    switcherHost.replaceChildren();
    for (const tab of PLAN_TABS) {
      const isSelected = tab.id === activePlanId;
      const btn = action(
        tab.label,
        () => {
          focusPlan(tab.id);
        },
        isSelected ? 'arch-plan-btn is-active' : 'arch-plan-btn',
      );
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(isSelected));
      switcherHost.append(btn);
    }
  }

  function renderEpistemicNote() {
    const plan = ARCHITECTURE_PLANS[activePlanId];
    epistemicHost.replaceChildren();
    const lead = el('strong', '', 'Historical & Textual Scope: ');
    lead.style.color = 'var(--gold-light)';
    epistemicHost.append(lead, document.createTextNode(plan.epistemicNote));
  }

  function renderQuickChips() {
    quickWrap.replaceChildren();
    quickWrap.append(el('p', 'arch-section-eyebrow', 'Quick-Jump Elements (click chip or plan region)'));

    const row = el('div', 'arch-quick-chips');
    for (const item of getOrderedElements(activePlanId)) {
      const isActive = item.id === activeElementId;
      const chip = action(
        item.name,
        () => {
          activeElementId = item.id;
          renderViewportAndSpotlight();
        },
        isActive ? 'arch-element-chip is-active' : 'arch-element-chip',
      );
      chip.setAttribute('aria-pressed', String(isActive));
      chip.dataset.elementId = item.id;
      row.append(chip);
    }
    quickWrap.append(row);
  }

  function renderSvgToolbar() {
    svgToolbarHost.replaceChildren();
    if (activePlanId !== 'jerusalem_gates') {
      svgToolbarHost.hidden = true;
      return;
    }
    svgToolbarHost.hidden = false;
    const toggleBtn = action(
      showTerrain ? 'Terrain Relief: On' : 'Terrain Relief: Off',
      () => {
        showTerrain = !showTerrain;
        renderSvgToolbar();
        renderViewport();
      },
      showTerrain ? 'arch-element-chip is-active' : 'arch-element-chip',
    );
    toggleBtn.setAttribute('aria-pressed', String(showTerrain));
    svgToolbarHost.append(toggleBtn);
  }

  function renderViewport() {
    const compact = typeof window !== 'undefined' ? window.innerWidth <= 520 : false;
    const svg = renderArchitectureSvg(activePlanId, activeElementId, {
      compact,
      showTerrain,
      onSelectElement: selected => {
        activeElementId = selected.id;
        renderViewportAndSpotlight();
      },
    });
    svgViewport.replaceChildren(svg);
  }

  function renderSpotlightCard() {
    const elem = resolveActiveElement();
    spotlightHost.replaceChildren();

    // Header
    const head = el('div', 'arch-spotlight-head');
    const left = el('div', '');
    left.append(
      el('p', 'arch-section-eyebrow', 'SELECTED ARCHITECTURAL ELEMENT'),
      el('h4', 'arch-spotlight-title', elem.name),
    );
    const zoneBadge = el('span', 'arch-zone-badge', elem.zone);
    head.append(left, zoneBadge);
    spotlightHost.append(head);

    // Original Hebrew / Greek & Transliteration
    if (elem.hebrew || elem.greek || elem.transliteration) {
      const scriptRow = el('div', 'arch-script-row');
      if (elem.hebrew) {
        const heb = el('span', 'arch-original-hebrew', elem.hebrew);
        heb.dir = 'rtl';
        heb.lang = 'he';
        scriptRow.append(heb);
      }
      if (elem.greek) {
        const grk = el('span', 'arch-original-greek', elem.greek);
        grk.dir = 'ltr';
        grk.lang = 'el';
        scriptRow.append(grk);
      }
      if (elem.transliteration) {
        scriptRow.append(el('span', 'arch-translit', elem.transliteration));
      }
      spotlightHost.append(scriptRow);
    }

    // Strong's clickable pills
    if (elem.strongs.length > 0) {
      const strongsRow = el('div', 'arch-strongs-row');
      const lbl = el('span', 'study-muted', "Strong's:");
      lbl.style.fontSize = '12px';
      strongsRow.append(lbl);
      for (const code of elem.strongs) {
        if (callbacks.onInspectStrongs) {
          const inspect = callbacks.onInspectStrongs;
          const btn = action(`${code} ↗`, () => inspect(code), 'study-button arch-strongs-pill');
          btn.setAttribute('aria-label', `Inspect Strong's ${code}`);
          strongsRow.append(btn);
        } else {
          strongsRow.append(el('span', 'arch-strongs-pill', code));
        }
      }
      spotlightHost.append(strongsRow);
    }

    // Dimensions
    if (elem.dimensions) {
      const dimBox = el('div', 'arch-dimensions-box');
      dimBox.append(el('strong', '', 'Dimensions & Form: '), document.createTextNode(elem.dimensions));
      spotlightHost.append(dimBox);
    }

    // Summary
    spotlightHost.append(el('p', 'arch-summary', elem.summary));

    // Historical / Archaeological Note
    if (elem.historicalNote) {
      const noteBox = el('div', 'arch-historical-note');
      const noteLead = el('strong', '', 'Biblical & Historical Note: ');
      noteLead.style.color = 'var(--green)';
      noteBox.append(noteLead, document.createTextNode(elem.historicalNote));
      spotlightHost.append(noteBox);
    }

    // Scripture References with ContextPreview
    const refsWrap = el('div', 'arch-quick-wrap');
    refsWrap.append(el('p', 'arch-section-eyebrow', 'Scripture Witnesses (hover to preview · click to open)'));
    if (elem.sourceRefs.length > 0) {
      const refsRow = el('div', 'arch-refs-row');
      for (const ref of elem.sourceRefs) {
        const refBtn = action(`${ref.label} →`, () => callbacks.onNavigate(ref.passage), 'study-button arch-ref-btn');
        callbacks.preview.attach(refBtn, ref.passage, `${elem.name} (${elem.zone})`);
        refsRow.append(refBtn);
      }
      refsWrap.append(refsRow);
    } else {
      refsWrap.append(status('No direct verse witnesses listed for this element.'));
    }
    spotlightHost.append(refsWrap);
  }

  function renderViewportAndSpotlight() {
    renderQuickChips();
    renderSvgToolbar();
    renderViewport();
    renderSpotlightCard();
  }

  function renderAll() {
    renderHeader();
    renderSwitcher();
    renderEpistemicNote();
    renderViewportAndSpotlight();
  }

  function focusPlan(planId?: ArchitecturePlanId, elementId?: string) {
    const nextPlanId = planId && ARCHITECTURE_PLANS[planId] ? planId : activePlanId;
    activePlanId = nextPlanId;
    const plan = ARCHITECTURE_PLANS[nextPlanId];
    if (elementId && plan.elements.some(e => e.id === elementId)) {
      activeElementId = elementId;
    } else {
      const priorityFirst = QUICK_JUMP_PRIORITY[nextPlanId]?.[0];
      activeElementId =
        (priorityFirst && plan.elements.some(e => e.id === priorityFirst) ? priorityFirst : plan.elements[0]!.id);
    }
    renderAll();
  }

  function focusElement(planId: ArchitecturePlanId, elementId?: string) {
    focusPlan(planId, elementId);
  }

  focusPlan(DEFAULT_PLAN_ID, 'menorah');

  return {
    element,
    focusPlan,
    focusElement,
  };
}
