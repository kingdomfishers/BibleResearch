// @file: src/ui/components/ResearchTrailHeader.ts
// @feature: app-shell
// @tables: none
// @candidates: none
// @toc: imports | types | ui:main | logic:render

// === @section:imports ===
import { explorationState, type ExplorationSnapshot, type ExplorationStep } from '../exploration-state';
import { action, el } from '../study-dom';

// === @section:types ===
export interface ResearchTrailHeaderActions {
  onCompare: () => void;
  onToggleGraph: () => void;
  onTogglePatterns?: () => void;
  onOpenMap?: () => void;
  onOpenNations?: () => void;
  onOpenFeasts?: () => void;
  onOpenPeople?: () => void;
  onOpenTimeline?: () => void;
  onOpenArchitecture?: () => void;
  onQuickNote: () => void;
  onAllNotes: () => void;
  onToggleInspector?: () => void;
  onToggleTheme: () => void;
}

export interface ResearchTrailHeaderHandle {
  element: HTMLElement;
  setInspectorOpen: (open: boolean) => void;
  setThemeLabel: (theme: string) => void;
  destroy: () => void;
}

// === @section:ui:main ===
export function createResearchTrailHeader(actions: ResearchTrailHeaderActions): ResearchTrailHeaderHandle {
  const element = document.createElement('header');
  element.className = 'research-trail-header';
  element.setAttribute('aria-label', 'Research navigation and trail');

  const brand = document.createElement('a');
  brand.className = 'trail-brand';
  brand.href = '#1-1-1';
  brand.title = 'BibleResearch home (Genesis 1:1)';
  const symbol = el('span', 'trail-brand__symbol', 'א');
  symbol.setAttribute('aria-hidden', 'true');
  const wordmark = el('span', 'trail-brand__text', 'BibleResearch');
  brand.append(symbol, wordmark);

  const navControls = el('div', 'trail-controls');
  const backBtn = action('← Back', () => explorationState.back(), 'trail-btn');
  backBtn.title = 'Return to previous step';

  const forkWrap = el('div', 'trail-fork-wrap');
  const forkBtn = action('⑂ Fork', () => {
    forkMenu.hidden = !forkMenu.hidden;
    forkBtn.setAttribute('aria-expanded', String(!forkMenu.hidden));
  }, 'trail-btn');
  forkBtn.setAttribute('aria-haspopup', 'true');
  forkBtn.setAttribute('aria-expanded', 'false');

  const forkMenu = el('div', 'trail-fork-menu');
  forkMenu.hidden = true;
  forkMenu.setAttribute('role', 'menu');
  forkWrap.append(forkBtn, forkMenu);

  navControls.append(backBtn, forkWrap);

  const breadcrumbs = document.createElement('nav');
  breadcrumbs.className = 'trail-breadcrumbs';
  breadcrumbs.setAttribute('aria-label', 'Research trail');

  const rightActions = el('div', 'trail-actions');
  const compareBtn = action('Compare', actions.onCompare, 'trail-btn trail-btn--accent');
  const graphBtn = action('Graph', actions.onToggleGraph, 'trail-btn');
  const patternsBtn = actions.onTogglePatterns ? action('Patterns', actions.onTogglePatterns, 'trail-btn') : null;
  const mapBtn = actions.onOpenMap ? action('Map', actions.onOpenMap, 'trail-btn') : null;
  const nationsBtn = actions.onOpenNations ? action('Nations', actions.onOpenNations, 'trail-btn') : null;
  const feastsBtn = actions.onOpenFeasts ? action('Feasts', actions.onOpenFeasts, 'trail-btn') : null;
  const peopleBtn = actions.onOpenPeople ? action('People', actions.onOpenPeople, 'trail-btn') : null;
  const timelineBtn = actions.onOpenTimeline ? action('Timeline', actions.onOpenTimeline, 'trail-btn') : null;
  const templeBtn = actions.onOpenArchitecture ? action('Temple', actions.onOpenArchitecture, 'trail-btn') : null;
  const quickNoteBtn = action('+ Note', actions.onQuickNote, 'trail-btn');
  const allNotesBtn = action('Notes', actions.onAllNotes, 'trail-btn');
  allNotesBtn.id = 'all-notes-btn';
  const inspectorBtn = actions.onToggleInspector
    ? action('Inspector', () => actions.onToggleInspector?.(), 'trail-btn js-inspector-toggle is-active')
    : null;
  if (inspectorBtn) {
    inspectorBtn.setAttribute('aria-pressed', 'true');
    inspectorBtn.title = 'Hide word inspector';
  }
  const themeBtn = action('Theme', actions.onToggleTheme, 'trail-btn trail-btn--icon');
  themeBtn.id = 'appearance';
  rightActions.append(compareBtn, graphBtn);
  if (patternsBtn) rightActions.append(patternsBtn);
  if (mapBtn) rightActions.append(mapBtn);
  if (nationsBtn) rightActions.append(nationsBtn);
  if (feastsBtn) rightActions.append(feastsBtn);
  if (peopleBtn) rightActions.append(peopleBtn);
  if (timelineBtn) rightActions.append(timelineBtn);
  if (templeBtn) rightActions.append(templeBtn);
  rightActions.append(quickNoteBtn, allNotesBtn);
  if (inspectorBtn) rightActions.append(inspectorBtn);
  rightActions.append(themeBtn);

  element.append(brand, navControls, breadcrumbs, rightActions);

  let expandedEarlier = false;

  const closeMenuOnOutsideClick = (event: MouseEvent) => {
    if (!forkMenu.hidden && !forkWrap.contains(event.target as Node)) {
      forkMenu.hidden = true;
      forkBtn.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', closeMenuOnOutsideClick);

  // === @section:logic:render ===
  function buildCrumb(step: ExplorationStep, isCurrent: boolean): HTMLButtonElement {
    const btn = action(step.anchor.label, () => explorationState.returnToStep(step.id),
      `trail-crumb${isCurrent ? ' is-current' : ''}`);
    btn.title = step.traversedEdge ? `${step.anchor.label} — ${step.traversedEdge.why}` : step.anchor.label;
    if (isCurrent) btn.setAttribute('aria-current', 'step');
    return btn;
  }

  function render(snapshot: ExplorationSnapshot) {
    const chain = explorationState.getBreadcrumbs();
    const current = explorationState.getCurrentStep();
    const parent = current.parentStepId ? snapshot.steps[current.parentStepId] : null;
    backBtn.disabled = !current.parentStepId;
    backBtn.title = parent ? `Return to ${parent.anchor.label}` : 'At start of trail';

    const childBranches = explorationState.getForkChildren(current.id);
    const nearestFork = explorationState.findNearestForkAncestor();
    const branchCount = childBranches.length;
    forkBtn.textContent = branchCount > 0 ? `⑂ Fork (${branchCount})` : '⑂ Fork';

    forkMenu.replaceChildren();
    if (nearestFork && nearestFork.id !== current.id) {
      forkMenu.append(action(`↩ Return to fork (${nearestFork.anchor.label})`, () => {
        forkMenu.hidden = true;
        explorationState.returnToFork();
      }, 'trail-fork-item'));
    }
    if (current.id !== snapshot.rootStepId) {
      const rootStep = snapshot.steps[snapshot.rootStepId];
      forkMenu.append(action(`⌂ Origin (${rootStep?.anchor.label ?? 'start'})`, () => {
        forkMenu.hidden = true;
        explorationState.returnToOrigin();
      }, 'trail-fork-item'));
    }
    if (childBranches.length > 0) {
      forkMenu.append(el('p', 'trail-fork-heading', 'Visited branches from here'));
      for (const child of childBranches) {
        forkMenu.append(action(`↳ ${child.anchor.label}`, () => {
          forkMenu.hidden = true;
          explorationState.returnToStep(child.id);
        }, 'trail-fork-item'));
      }
    }
    if (!forkMenu.childElementCount) {
      forkMenu.append(el('p', 'trail-fork-empty', 'Follow any word or passage to create a branch from here.'));
    }

    breadcrumbs.replaceChildren();
    const shouldCollapse = !expandedEarlier && chain.length > 5;
    if (shouldCollapse) {
      const origin = chain[0]!;
      breadcrumbs.append(buildCrumb(origin, false));
      breadcrumbs.append(el('span', 'trail-sep', '›'));
      const hiddenCount = chain.length - 4;
      const expandBtn = action(`…${hiddenCount} earlier`, () => {
        expandedEarlier = true;
        render(explorationState.getSnapshot());
      }, 'trail-crumb trail-crumb--collapse');
      expandBtn.title = 'Show full research path';
      breadcrumbs.append(expandBtn);
      for (const step of chain.slice(-3)) {
        breadcrumbs.append(el('span', 'trail-sep', '›'));
        breadcrumbs.append(buildCrumb(step, step.id === current.id));
      }
    } else {
      chain.forEach((step, idx) => {
        if (idx > 0) breadcrumbs.append(el('span', 'trail-sep', '›'));
        breadcrumbs.append(buildCrumb(step, step.id === current.id));
      });
    }

    const pinCount = (snapshot.pins.a ? 1 : 0) + (snapshot.pins.b ? 1 : 0);
    compareBtn.textContent = pinCount > 0 ? `Compare (${pinCount})` : 'Compare';
  }

  const unsubscribe = explorationState.subscribe(render);

  return {
    element,
    setInspectorOpen(open: boolean) {
      if (!inspectorBtn) return;
      inspectorBtn.classList.toggle('is-active', open);
      inspectorBtn.setAttribute('aria-pressed', String(open));
      inspectorBtn.title = open ? 'Hide word inspector' : 'Show word inspector';
    },
    setThemeLabel(theme: string) {
      themeBtn.textContent = theme === 'dark' ? 'Light' : 'Dark';
      themeBtn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
      themeBtn.setAttribute('aria-label', themeBtn.title);
    },
    destroy() {
      unsubscribe();
      document.removeEventListener('click', closeMenuOnOutsideClick);
    },
  };
}
