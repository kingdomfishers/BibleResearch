// @file: src/ui/components/LiteraryStructurePanel.ts
// Interactive Literary Structure Discovery panel synced with VerseReader (verse + chapter modes).
// Consumes engine-owned `patternFamilies` spans directly so phrase/clause functions share cohesive continuous highlights.

import { BibleRPC } from '../../api/rpc';
import type { ActivePassage } from '../../api/types';
import type {
  LiteraryAnalysisResult,
  LiteraryPatternFamily,
  LiteraryPatternSpan,
  LiteraryToken,
  SymmetryPattern,
  WordplayFinding,
} from '../../relationships/literary-types';
import { action, el, status } from '../study-dom';
import { formatVerseRef } from '../utils';

export type LiteraryCategory =
  | 'segmentation'
  | 'template'
  | 'deviations'
  | 'symmetries'
  | 'wordplay'
  | 'keywords'
  | 'acrostics'
  | 'thematic'
  | 'nested'
  | 'lxx';

export type LiterarySensitivity = 'focused' | 'balanced' | 'exploratory';
export type LiteraryIntensity = 'subtle' | 'normal' | 'vivid';

export interface LiteraryTokenStyle {
  colorIdx: number;
  familyId: string;
  familyLabel: string;
  spanId: string;
  spanPos: 'single' | 'start' | 'mid' | 'end';
  category: string;
  isDeviation?: boolean;
  deviationKind?: string;
  nestedDepth?: number;
  wpCharIndices?: number[];
  dimmed?: boolean;
}

export interface LiteraryHighlightMap {
  active: boolean;
  intensity: LiteraryIntensity;
  showNested: boolean;
  activeFamilyId: string | null;
  analysis: LiteraryAnalysisResult | null;
  visibleFamilies: LiteraryPatternFamily[];
  tokenStyles: Map<string, LiteraryTokenStyle>;
  focusedWordIds: Set<string>;
}

export interface LiterarySettings {
  categories: Set<LiteraryCategory>;
  sensitivity: LiterarySensitivity;
  minStrength: number;
  intensity: LiteraryIntensity;
  depth: 1 | 2 | 3;
  showAlternatives: boolean;
  compareLxx: boolean;
  scope: 'chapter' | 'chapter_plus_tail' | 'verse';
}

export interface LiteraryStructurePanelActions {
  onHighlightUpdate: (map: LiteraryHighlightMap) => void;
  onNavigate: (p: ActivePassage) => void;
  onInspectWord: (wordId: number, position: number, english: string) => void;
}

const PALETTE_COUNT = 8;

// Default view surfaces meaningful phrase/clause functions, units, symmetries, deviations, attested wordplay, and nested structures.
// Repeated individual keywords (`keywords`) and speculative alternatives are opt-in to keep the text legible.
const DEFAULT_CATEGORIES: LiteraryCategory[] = [
  'template',
  'segmentation',
  'symmetries',
  'deviations',
  'wordplay',
  'thematic',
  'acrostics',
  'nested',
  'lxx',
];

const ALL_CATEGORIES: LiteraryCategory[] = [
  'template',
  'segmentation',
  'symmetries',
  'deviations',
  'wordplay',
  'thematic',
  'acrostics',
  'nested',
  'keywords',
  'lxx',
];

const CATEGORY_LABELS: Record<LiteraryCategory, string> = {
  template: 'Recurring phrases & templates',
  segmentation: 'Literary units',
  symmetries: 'Chiasms & parallelism',
  deviations: 'Deviations',
  wordplay: 'Wordplay',
  thematic: 'Thematic & analogies',
  acrostics: 'Acrostics',
  nested: 'Nested structures',
  keywords: 'Repeated keywords (optional)',
  lxx: 'MT vs LXX',
};

const SENSITIVITY_STRENGTH: Record<LiterarySensitivity, number> = {
  focused: 0.78,
  balanced: 0.62,
  exploratory: 0.35,
};

function renderMarkedOriginal(form: string, indices: number[]): HTMLElement {
  const span = document.createElement('span');
  if (!indices.length) {
    span.textContent = form;
    return span;
  }
  const idxSet = new Set(indices);
  let buf = '';
  let inMark = false;
  const flush = () => {
    if (!buf) return;
    if (inMark) {
      const m = document.createElement('mark');
      m.className = 'lit-wp-char';
      m.textContent = buf;
      span.append(m);
    } else {
      span.append(document.createTextNode(buf));
    }
    buf = '';
  };
  for (let i = 0; i < form.length; i++) {
    const isHit = idxSet.has(i);
    if (isHit !== inMark) {
      flush();
      inMark = isHit;
    }
    buf += form[i];
  }
  flush();
  return span;
}

export function createLiteraryStructurePanel(actions: LiteraryStructurePanelActions) {
  const element = document.createElement('section');
  element.className = 'lit-panel';
  element.hidden = true;
  element.setAttribute('aria-label', 'Literary Structure Discovery');

  let active = false;
  let currentPassage: ActivePassage = { book: 1, chapter: 1, verse: 1 };
  let activeTab: 'overview' | 'template' | 'symmetries' | 'wordplay' | 'extras' = 'overview';
  let currentAnalysis: LiteraryAnalysisResult | null = null;
  let focusedWordIds = new Set<string>();
  let isolatedFamilyId: string | null = null;
  let hoveredFamilyId: string | null = null;
  let generation = 0;
  let inspectedInfo: {
    title: string;
    ref: string;
    channel: string;
    confidence?: number;
    surprisal?: number;
    description: string;
    tokens: LiteraryToken[];
    family?: LiteraryPatternFamily | null;
    alternative?: string | null;
  } | null = null;

  const settings: LiterarySettings = {
    categories: new Set<LiteraryCategory>(DEFAULT_CATEGORIES),
    sensitivity: 'balanced',
    minStrength: 0.62,
    intensity: 'normal',
    depth: 2,
    showAlternatives: false,
    compareLxx: false,
    scope: 'chapter',
  };

  function getVisibleFamilies(analysis: LiteraryAnalysisResult): LiteraryPatternFamily[] {
    const out: LiteraryPatternFamily[] = [];
    for (const fam of analysis.patternFamilies ?? []) {
      if (fam.category === 'template_function' && !settings.categories.has('template')) continue;
      if (fam.category === 'symmetry' && !settings.categories.has('symmetries')) continue;
      if (fam.category === 'wordplay' && !settings.categories.has('wordplay')) continue;
      if (fam.category === 'thematic' && !settings.categories.has('thematic')) continue;
      if (fam.category === 'acrostic' && !settings.categories.has('acrostics')) continue;
      if (fam.category === 'keyword' && !settings.categories.has('keywords')) continue;
      if (fam.category === 'keyword') {
        if (!settings.categories.has('keywords')) continue;
      } else if (!fam.defaultVisible && !settings.showAlternatives && settings.sensitivity !== 'exploratory') {
        continue;
      }
      out.push(fam);
    }
    return out;
  }

  function buildHighlightMap(): LiteraryHighlightMap {
    const tokenStyles = new Map<string, LiteraryTokenStyle>();
    if (!active || !currentAnalysis) {
      return {
        active: false,
        intensity: settings.intensity,
        showNested: settings.categories.has('nested'),
        activeFamilyId: null,
        analysis: null,
        visibleFamilies: [],
        tokenStyles,
        focusedWordIds,
      };
    }

    const visibleFamilies = getVisibleFamilies(currentAnalysis);
    const activeFamilyId = isolatedFamilyId ?? hoveredFamilyId;
    const familiesToPaint = isolatedFamilyId
      ? visibleFamilies.filter(f => f.id === isolatedFamilyId)
      : visibleFamilies;

    // Wordplay letter indices (preserved even when inside a phrase band)
    const wpCharMap = new Map<string, number[]>();
    if (settings.categories.has('wordplay')) {
      for (const wp of currentAnalysis.wordplays.slice(0, 6)) {
        if (wp.epistemicClass !== 'attested_textual_wordplay' && !settings.showAlternatives && settings.sensitivity !== 'exploratory') {
          continue;
        }
        if (wp.wordA.matchedCharIndices.length) wpCharMap.set(wp.wordA.id, wp.wordA.matchedCharIndices);
        if (wp.wordB.matchedCharIndices.length) wpCharMap.set(wp.wordB.id, wp.wordB.matchedCharIndices);
      }
    }

    const showDevs = settings.categories.has('deviations');
    const showNested = settings.categories.has('nested');

    // Paint spans cleanly in priority order: template_function -> thematic -> symmetry -> acrostic -> wordplay -> keyword
    const orderRank: Record<string, number> = {
      template_function: 0,
      thematic: 1,
      acrostic: 2,
      symmetry: 3,
      wordplay: 4,
      keyword: 5,
    };
    const orderedFams = [...familiesToPaint].sort(
      (a, b) => (orderRank[a.category] ?? 9) - (orderRank[b.category] ?? 9)
    );

    const assignSpan = (fam: LiteraryPatternFamily, span: LiteraryPatternSpan) => {
      const wids = span.wordIds;
      const len = wids.length;
      const isDimmed = Boolean(activeFamilyId && activeFamilyId !== fam.id);
      for (let i = 0; i < len; i++) {
        const wid = wids[i];
        const pos: LiteraryTokenStyle['spanPos'] =
          len === 1 ? 'single' : i === 0 ? 'start' : i === len - 1 ? 'end' : 'mid';
        const existing = tokenStyles.get(wid);
        const wpChars = wpCharMap.get(wid);
        // Preserve higher-priority phrase band unless isolated or hovered explicitly targets this family
        if (existing && activeFamilyId !== fam.id) {
          if (wpChars?.length && !existing.wpCharIndices) existing.wpCharIndices = wpChars;
          if (showDevs && span.hasDeviation && !existing.isDeviation) {
            existing.isDeviation = true;
            existing.deviationKind = span.deviationKind;
          }
          continue;
        }
        tokenStyles.set(wid, {
          colorIdx: fam.colorSlot % PALETTE_COUNT,
          familyId: fam.id,
          familyLabel: fam.label,
          spanId: span.spanId,
          spanPos: pos,
          category: fam.category,
          isDeviation: showDevs && span.hasDeviation,
          deviationKind: span.deviationKind,
          nestedDepth: showNested ? span.nestedDepth : 0,
          wpCharIndices: wpChars,
          dimmed: isDimmed,
        });
      }
    };

    for (const fam of orderedFams) {
      for (const span of fam.spans) {
        assignSpan(fam, span);
      }
    }

    // Layer standalone deviations whose tokens were not inside a painted template span
    if (showDevs && !isolatedFamilyId) {
      for (const dev of currentAnalysis.deviations.slice(0, 12)) {
        for (let i = 0; i < dev.witnessWordIds.length; i++) {
          const wid = dev.witnessWordIds[i];
          const prev = tokenStyles.get(wid);
          if (prev) {
            prev.isDeviation = true;
            prev.deviationKind = prev.deviationKind ?? dev.kind;
          } else {
            tokenStyles.set(wid, {
              colorIdx: 3,
              familyId: `dev:${dev.id}`,
              familyLabel: `${dev.kind} deviation`,
              spanId: `devspan:${dev.id}`,
              spanPos: dev.witnessWordIds.length === 1 ? 'single' : i === 0 ? 'start' : i === dev.witnessWordIds.length - 1 ? 'end' : 'mid',
              category: 'deviation',
              isDeviation: true,
              deviationKind: dev.kind,
              nestedDepth: 0,
              wpCharIndices: wpCharMap.get(wid),
              dimmed: Boolean(activeFamilyId),
            });
          }
        }
      }
    }

    return {
      active: true,
      intensity: settings.intensity,
      showNested,
      activeFamilyId,
      analysis: currentAnalysis,
      visibleFamilies,
      tokenStyles,
      focusedWordIds,
    };
  }

  function pushHighlights() {
    actions.onHighlightUpdate(buildHighlightMap());
  }

  function focusWords(
    wids: string[],
    info?: {
      title: string;
      ref: string;
      channel: string;
      confidence?: number;
      surprisal?: number;
      description: string;
      family?: LiteraryPatternFamily | null;
      alternative?: string | null;
    }
  ) {
    focusedWordIds = new Set(wids);
    if (info && currentAnalysis) {
      const tokMap = new Map(currentAnalysis.tokens.map(t => [t.id, t]));
      inspectedInfo = {
        ...info,
        tokens: wids.map(id => tokMap.get(id)).filter((t): t is LiteraryToken => Boolean(t)).slice(0, 8),
      };
    }
    pushHighlights();
    renderPanel();
  }

  function isolateOrInspectFamily(fam: LiteraryPatternFamily) {
    if (isolatedFamilyId === fam.id) {
      isolatedFamilyId = null;
      hoveredFamilyId = null;
      focusedWordIds = new Set();
      inspectedInfo = null;
      pushHighlights();
      renderPanel();
      return;
    }
    isolatedFamilyId = fam.id;
    hoveredFamilyId = null;
    const allWordIds = fam.spans.flatMap(s => s.wordIds);
    focusWords(allWordIds, {
      title: fam.label,
      ref: fam.spans.map(s => s.ref).slice(0, 4).join(', '),
      channel: fam.evidenceChannel,
      description: fam.description,
      family: fam,
    });
  }

  function buildPassagesRequest(): {
    passage: string;
    passages: { book: number; chapter: number; start_verse?: number; end_verse?: number; verse?: number }[];
  } {
    if (settings.scope === 'verse') {
      return {
        passage: formatVerseRef(currentPassage),
        passages: [{ book: currentPassage.book, chapter: currentPassage.chapter, verse: currentPassage.verse }],
      };
    }
    if (settings.scope === 'chapter_plus_tail') {
      return {
        passage: `${formatVerseRef({ ...currentPassage, verse: 1 }).replace(/:1$/, '')} (+next ch. 1-5)`,
        passages: [
          { book: currentPassage.book, chapter: currentPassage.chapter },
          { book: currentPassage.book, chapter: currentPassage.chapter + 1, start_verse: 1, end_verse: 5 },
        ],
      };
    }
    return {
      passage: formatVerseRef({ ...currentPassage, verse: 1 }).replace(/:1$/, ''),
      passages: [{ book: currentPassage.book, chapter: currentPassage.chapter }],
    };
  }

  async function loadAnalysis() {
    if (!active) return;
    const req = ++generation;
    isolatedFamilyId = null;
    hoveredFamilyId = null;
    inspectedInfo = null;
    focusedWordIds = new Set();
    element.replaceChildren(status(`Analyzing literary structure for ${formatVerseRef(currentPassage)}…`));
    const reqScope = buildPassagesRequest();
    const res = await BibleRPC.analyzeLiteraryStructure({
      ...reqScope,
      detail: 'standard',
      compare_lxx: settings.compareLxx && currentPassage.book <= 39,
      include_alternatives: settings.showAlternatives,
      min_strength: settings.minStrength,
    });
    if (req !== generation || !active) return;
    if (!res.data || res.data.status !== 'ok') {
      currentAnalysis = null;
      element.replaceChildren(
        el('p', 'study-muted', res.error ?? 'Literary structure analysis unavailable for this passage.')
      );
      pushHighlights();
      return;
    }
    currentAnalysis = res.data;
    pushHighlights();
    renderPanel();
  }

  function renderPatternLegend(res: LiteraryAnalysisResult): HTMLElement {
    const visible = getVisibleFamilies(res);
    const legend = el('div', 'lit-legend');
    if (!visible.length) {
      legend.append(el('span', 'study-muted', 'No visible pattern families for the active filter settings.'));
      return legend;
    }

    visible.forEach(fam => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lit-legend__pill';
      if (isolatedFamilyId === fam.id) btn.classList.add('is-isolated');
      else if (isolatedFamilyId && isolatedFamilyId !== fam.id) btn.classList.add('is-dimmed');
      btn.style.setProperty('--lit-color', `var(--lit-c${fam.colorSlot % PALETTE_COUNT})`);
      btn.title = `${fam.label} — click to isolate and inspect all occurrences`;

      const sw = el('span', 'lit-legend__swatch', '');
      const lbl = el('span', 'lit-legend__label', fam.label);
      const hasDev = fam.spans.some(s => s.hasDeviation);
      const cnt = el('span', 'lit-legend__count', `×${fam.spans.length}${hasDev ? ' ✦' : ''}`);
      btn.append(sw, lbl, cnt);

      btn.addEventListener('mouseenter', () => {
        if (isolatedFamilyId) return;
        hoveredFamilyId = fam.id;
        pushHighlights();
      });
      btn.addEventListener('mouseleave', () => {
        if (isolatedFamilyId || hoveredFamilyId !== fam.id) return;
        hoveredFamilyId = null;
        pushHighlights();
      });
      btn.addEventListener('click', () => isolateOrInspectFamily(fam));
      legend.append(btn);
    });

    if (isolatedFamilyId) {
      legend.append(
        action(
          'Show all',
          () => {
            isolatedFamilyId = null;
            hoveredFamilyId = null;
            focusedWordIds = new Set();
            inspectedInfo = null;
            pushHighlights();
            renderPanel();
          },
          'text-action'
        )
      );
    }

    return legend;
  }

  function renderSettingsBar(): HTMLElement {
    const details = document.createElement('details');
    details.className = 'lit-settings';
    const sum = document.createElement('summary');
    sum.textContent = `Visualization Settings · Scope: ${settings.scope.replaceAll('_', ' ')} · Sensitivity: ${settings.sensitivity} · Highlight: ${settings.intensity}`;
    details.append(sum);

    const grid = el('div', 'lit-settings__grid');

    const scopeLabel = document.createElement('label');
    scopeLabel.textContent = 'Scope: ';
    const scopeSel = document.createElement('select');
    for (const [val, text] of [
      ['chapter', 'Active Chapter'],
      ['chapter_plus_tail', 'Chapter + Next 5v'],
      ['verse', 'Active Verse Only'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      opt.selected = settings.scope === val;
      scopeSel.append(opt);
    }
    scopeSel.addEventListener('change', () => {
      settings.scope = scopeSel.value as LiterarySettings['scope'];
      void loadAnalysis();
    });
    scopeLabel.append(scopeSel);

    const sensLabel = document.createElement('label');
    sensLabel.textContent = 'Sensitivity: ';
    const sensSel = document.createElement('select');
    for (const val of ['focused', 'balanced', 'exploratory'] as const) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val[0].toUpperCase() + val.slice(1);
      opt.selected = settings.sensitivity === val;
      sensSel.append(opt);
    }
    sensSel.addEventListener('change', () => {
      settings.sensitivity = sensSel.value as LiterarySensitivity;
      settings.minStrength = SENSITIVITY_STRENGTH[settings.sensitivity];
      void loadAnalysis();
    });
    sensLabel.append(sensSel);

    const intLabel = document.createElement('label');
    intLabel.textContent = 'Intensity: ';
    const intSel = document.createElement('select');
    for (const val of ['subtle', 'normal', 'vivid'] as const) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val[0].toUpperCase() + val.slice(1);
      opt.selected = settings.intensity === val;
      intSel.append(opt);
    }
    intSel.addEventListener('change', () => {
      settings.intensity = intSel.value as LiteraryIntensity;
      pushHighlights();
    });
    intLabel.append(intSel);

    const depthLabel = document.createElement('label');
    depthLabel.textContent = `Depth: `;
    const depthSel = document.createElement('select');
    for (const d of [1, 2, 3] as const) {
      const opt = document.createElement('option');
      opt.value = String(d);
      opt.textContent = `Level ${d}`;
      opt.selected = settings.depth === d;
      depthSel.append(opt);
    }
    depthSel.addEventListener('change', () => {
      settings.depth = Number(depthSel.value) as 1 | 2 | 3;
      renderPanel();
    });
    depthLabel.append(depthSel);

    const strLabel = document.createElement('label');
    strLabel.textContent = `Min strength (${settings.minStrength.toFixed(2)}): `;
    const strRange = document.createElement('input');
    strRange.type = 'range';
    strRange.min = '0.25';
    strRange.max = '0.90';
    strRange.step = '0.05';
    strRange.value = String(settings.minStrength);
    strRange.addEventListener('change', () => {
      settings.minStrength = Number(strRange.value);
      void loadAnalysis();
    });
    strLabel.append(strRange);

    const altLabel = document.createElement('label');
    const altChk = document.createElement('input');
    altChk.type = 'checkbox';
    altChk.checked = settings.showAlternatives;
    altChk.addEventListener('change', () => {
      settings.showAlternatives = altChk.checked;
      void loadAnalysis();
    });
    altLabel.append(altChk, document.createTextNode('Exploratory & alternatives'));

    const lxxLabel = document.createElement('label');
    const lxxChk = document.createElement('input');
    lxxChk.type = 'checkbox';
    lxxChk.checked = settings.compareLxx;
    lxxChk.disabled = currentPassage.book > 39;
    lxxChk.addEventListener('change', () => {
      settings.compareLxx = lxxChk.checked;
      void loadAnalysis();
    });
    lxxLabel.append(lxxChk, document.createTextNode('Compare MT vs LXX'));

    grid.append(scopeLabel, sensLabel, intLabel, depthLabel, strLabel, altLabel, lxxLabel);
    details.append(grid);

    const catRow = el('div', 'lit-settings__cats');
    for (const cat of ALL_CATEGORIES) {
      const lbl = document.createElement('label');
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = settings.categories.has(cat);
      chk.addEventListener('change', () => {
        if (chk.checked) settings.categories.add(cat);
        else settings.categories.delete(cat);
        pushHighlights();
        renderPanel();
      });
      lbl.append(chk, document.createTextNode(CATEGORY_LABELS[cat]));
      catRow.append(lbl);
    }
    details.append(catRow);
    return details;
  }

  function renderInspector(): HTMLElement {
    const box = el('div', 'lit-inspector');
    if (!inspectedInfo) {
      box.hidden = true;
      return box;
    }
    const head = el('div', 'lit-inspector__header');
    head.append(
      el('strong', '', `${inspectedInfo.title} · ${inspectedInfo.ref}`),
      action('Clear focus', () => {
        inspectedInfo = null;
        isolatedFamilyId = null;
        hoveredFamilyId = null;
        focusedWordIds = new Set();
        pushHighlights();
        renderPanel();
      }, 'text-action')
    );
    box.append(head, el('p', '', inspectedInfo.description));
    const meta = el('div', 'lit-meta-row');
    meta.append(el('span', '', `Channel: ${inspectedInfo.channel}`));
    if (inspectedInfo.confidence !== undefined) meta.append(el('span', '', `Confidence: ${(inspectedInfo.confidence * 100).toFixed(0)}%`));
    if (inspectedInfo.surprisal !== undefined) meta.append(el('span', '', `Surprisal: ${inspectedInfo.surprisal} bits`));
    if (inspectedInfo.family) meta.append(el('span', '', `Category: ${inspectedInfo.family.category.replaceAll('_', ' ')}`));
    box.append(meta);

    if (inspectedInfo.family?.spans.length && currentAnalysis) {
      const occList = el('div', 'lit-inspector__occurrences');
      for (const sp of inspectedInfo.family.spans.slice(0, 12)) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'lit-occ-row';
        const left = el(
          'span',
          '',
          `${sp.unitIndex !== null ? `Unit ${sp.unitIndex + 1} · ` : ''}${sp.ref}${sp.hasDeviation ? ` · ✦ ${sp.deviationKind}` : ''}`
        );
        const orig = el('span', 'lit-occ-row__orig', sp.text);
        row.append(left, orig);
        row.addEventListener('click', () => {
          const firstTok = currentAnalysis!.tokens.find(t => t.id === sp.wordIds[0]);
          if (firstTok) actions.onNavigate({ book: firstTok.book, chapter: firstTok.chapter, verse: firstTok.verse });
          focusedWordIds = new Set(sp.wordIds);
          pushHighlights();
        });
        occList.append(row);
      }
      box.append(occList);
    }

    if (inspectedInfo.tokens.length) {
      const tokList = el('div', 'lit-subunit-list');
      for (const tok of inspectedInfo.tokens) {
        const pill = action(
          `${tok.surfaceForm} (${tok.transliteration} · "${tok.gloss}" · ${tok.strongs})`,
          () => {
            actions.onNavigate({ book: tok.book, chapter: tok.chapter, verse: tok.verse });
            if (tok.wordId > 0) actions.onInspectWord(tok.wordId, tok.pos, tok.gloss);
          },
          'lit-pill lit-pill--clickable'
        );
        tokList.append(pill);
      }
      box.append(tokList);
    }
    if (inspectedInfo.alternative) {
      box.append(el('p', 'lit-disclaimer', `Alternative / uncertainty: ${inspectedInfo.alternative}`));
    }
    return box;
  }

  function renderOverviewTab(res: LiteraryAnalysisResult): HTMLElement {
    const wrap = el('div', 'lit-section-card');

    if (settings.categories.has('segmentation') && res.segmentation) {
      const seg = res.segmentation;
      wrap.append(el('p', 'eyebrow', `DISCOVERED STRUCTURE · ${seg.signals.join(' + ')}`));
      if (seg.introduction) {
        const intro = el('details', 'lit-tree-node');
        intro.open = settings.depth >= 1;
        const s = document.createElement('summary');
        s.append(el('span', '', `Introduction (${seg.introduction.fromRef} – ${seg.introduction.toRef})`));
        intro.append(s, el('p', 'study-muted', seg.introduction.rationale));
        wrap.append(intro);
      }

      for (const u of seg.units) {
        const node = el('details', 'lit-tree-node');
        node.open = settings.depth >= 2 && u.index < 6;
        const sum = document.createElement('summary');
        sum.append(
          el('span', '', `${u.label}: ${u.fromRef} – ${u.toRef}`),
          action('Jump', () => {
            const firstTok = res.tokens.find(t => t.index === u.fromTokenIndex);
            if (firstTok) actions.onNavigate({ book: firstTok.book, chapter: firstTok.chapter, verse: firstTok.verse });
          }, 'text-action')
        );
        node.append(sum);

        if (settings.categories.has('nested') && settings.depth >= 2 && u.subunits.length) {
          const subRow = el('div', 'lit-subunit-list');
          for (const sub of u.subunits.slice(0, settings.depth === 3 ? 12 : 6)) {
            const pill = action(`${sub.label} (${sub.fromRef.split(' ').at(-1)})`, () => {
              focusWords(sub.wordIds, {
                title: `${u.label} · ${sub.label}`,
                ref: sub.fromRef,
                channel: 'grammatical',
                description: `Subunit spans ${sub.fromRef}–${sub.toRef}: ${sub.summary || sub.kind}.`,
              });
            }, 'lit-pill lit-pill--clickable');
            subRow.append(pill);
          }
          node.append(subRow);
        }
        wrap.append(node);
      }

      if (seg.conclusion) {
        const conc = el('details', 'lit-tree-node');
        conc.open = true;
        const s = document.createElement('summary');
        s.append(el('span', '', `Conclusion / Tail (${seg.conclusion.fromRef} – ${seg.conclusion.toRef})`));
        conc.append(
          s,
          el('p', 'study-muted', seg.conclusion.transformationSummary),
          seg.conclusion.droppedTemplateSlots.length
            ? el('p', 'lit-disclaimer', `Dropped peer slots: ${seg.conclusion.droppedTemplateSlots.join(', ')}`)
            : el('span', ''),
          seg.conclusion.newPredicates.length
            ? el('p', 'lit-disclaimer', `New predicates/attributes: ${seg.conclusion.newPredicates.join(', ')}`)
            : el('span', '')
        );
        wrap.append(conc);
      }
    } else {
      wrap.append(el('p', 'study-muted', 'No multi-unit cycle detected; see highlighted pattern families above or inspect Symmetries and Wordplay.'));
    }

    if (res.correspondences.length) {
      wrap.append(el('p', 'eyebrow', 'CROSS-UNIT CORRESPONDENCES (RESIDUAL CONTENT)'));
      const row = el('div', 'lit-subunit-list');
      for (const c of res.correspondences.slice(0, 6)) {
        const lexPreview = c.sharedLexemes.slice(0, 3).map(l => l.lemma).join(' · ');
        const btn = action(
          `${c.labelA} ↔ ${c.labelB} (${(c.score * 100).toFixed(0)}%: ${lexPreview})`,
          () => {
            const wids = c.sharedLexemes.flatMap(l => [...l.wordIdsA, ...l.wordIdsB]);
            focusWords(wids, {
              title: `${c.labelA} ↔ ${c.labelB} Correspondence`,
              ref: res.passage,
              channel: c.evidenceChannel,
              confidence: c.score,
              description: `Shared non-template lexemes: ${c.sharedLexemes.map(l => `${l.lemma} (${l.strongs}, "${l.gloss}")`).join('; ')}.`,
            });
          },
          'lit-pill lit-pill--clickable'
        );
        row.append(btn);
      }
      wrap.append(row);
    }

    if (settings.categories.has('deviations') && res.deviations.length) {
      wrap.append(el('p', 'eyebrow', 'TOP STRUCTURAL DEVIATIONS'));
      const devList = el('div', 'lit-subunit-list');
      const maxDevs = settings.showAlternatives ? 16 : 7;
      for (const d of res.deviations.slice(0, maxDevs)) {
        const pill = action(`✦ ${d.kind} @ ${d.ref}`, () => {
          focusWords(d.witnessWordIds, {
            title: `${d.kind.toUpperCase()} (${d.unitLabel})`,
            ref: d.ref,
            channel: d.evidenceChannel,
            confidence: d.confidence,
            surprisal: d.surprisalBits,
            description: d.description,
            alternative: d.uncertaintyNote,
          });
        }, 'lit-pill lit-pill--clickable');
        pill.style.borderColor = 'var(--lit-c3)';
        devList.append(pill);
      }
      wrap.append(devList);
    }

    if (settings.showAlternatives && res.alternativeSegmentations.length) {
      const altDet = document.createElement('details');
      altDet.className = 'lit-tree-node';
      altDet.append(el('summary', '', `Alternative Segmentations (${res.alternativeSegmentations.length})`));
      for (const alt of res.alternativeSegmentations) {
        altDet.append(
          el('p', 'study-muted', `${alt.signals.join(' + ')}: ${alt.units.length} units (score ${alt.score}, coverage ${Math.round(alt.coverage * 100)}%)`)
        );
      }
      wrap.append(altDet);
    }

    return wrap;
  }

  function renderTemplateTab(res: LiteraryAnalysisResult): HTMLElement {
    const wrap = el('div', 'lit-template-wrap');
    if (!res.template || !res.segmentation || !res.template.slots.length) {
      wrap.append(el('p', 'study-muted', 'No multi-unit aligned template reconstructed for this scope.'));
      return wrap;
    }
    const visibleSlots = res.template.slots
      .filter(
        s =>
          (s.canonicalKey !== 'slot:narrative_action' || settings.showAlternatives) &&
          (settings.showAlternatives || s.support >= 0.4 || s.role === 'emerging')
      )
      .slice(0, 14);
    const table = document.createElement('table');
    table.className = 'lit-template-table';
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    hRow.append(el('th', '', 'Unit / Range'));
    visibleSlots.forEach((s, idx) => {
      const th = document.createElement('th');
      th.textContent = `${s.label} (${s.role})`;
      th.style.borderBottom = `3px solid var(--lit-c${idx % PALETTE_COUNT})`;
      hRow.append(th);
    });
    thead.append(hRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    res.segmentation.units.forEach((u, ui) => {
      const tr = document.createElement('tr');
      const unitTh = document.createElement('th');
      unitTh.textContent = `${u.label} (${u.fromRef.split(' ').at(-1)}–${u.toRef.split(' ').at(-1)})`;
      tr.append(unitTh);
      visibleSlots.forEach((slot, sIdx) => {
        const td = document.createElement('td');
        const cell = slot.cells[ui];
        if (!cell || !cell.present) {
          if (cell?.isDeviant) {
            td.append(el('span', 'lit-cell-omission', '∅ omitted'));
          } else {
            td.append(el('span', 'study-muted', '—'));
          }
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'lit-cell-btn';
          const orig = el('span', 'lit-cell-orig', cell.text);
          orig.style.color = `var(--lit-c${sIdx % PALETTE_COUNT})`;
          btn.append(orig);
          if (cell.isDeviant && cell.deviationKind) {
            btn.append(el('span', 'lit-cell-dev-tag', `✦ ${cell.deviationKind}`));
          }
          btn.addEventListener('click', () => {
            focusWords(cell.wordIds, {
              title: `${u.label} · ${slot.label}`,
              ref: cell.ref ?? u.fromRef,
              channel: 'grammatical',
              description: `Slot role: ${slot.role} (support ${Math.round(slot.support * 100)}%).`,
            });
          });
          td.append(btn);
        }
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);
    wrap.append(table);
    return wrap;
  }

  function renderSymmetriesTab(res: LiteraryAnalysisResult): HTMLElement {
    const container = el('div', '');
    if (!res.symmetries.length) {
      container.append(el('p', 'study-muted', 'No high-confidence chiasms, inclusios, or parallelisms detected above the current threshold.'));
      return container;
    }
    const shown = settings.showAlternatives ? res.symmetries : res.symmetries.slice(0, 5);
    shown.forEach((sym: SymmetryPattern) => {
      const card = el('div', 'lit-chiasm-card');
      const head = el('div', 'lit-inspector__header');
      head.append(
        el('strong', '', `${sym.kind.replaceAll('_', ' ').toUpperCase()} (${sym.level}) · ${sym.fromRef}–${sym.toRef}`),
        el('span', 'lit-pill', `score ${sym.score} · rev ${sym.reverseMean} vs fwd ${sym.forwardMean}`)
      );
      card.append(head);

      sym.pairs.forEach((p, idx) => {
        const armA = el('div', 'lit-chiasm-arm');
        armA.style.setProperty('--lit-color', `var(--lit-c${idx % PALETTE_COUNT})`);
        armA.style.marginInlineStart = `${idx * 14}px`;
        armA.append(el('span', 'lit-chiasm-label', p.label), el('span', '', `${p.leftText} (${p.leftRef})`));
        armA.addEventListener('click', () => {
          focusWords([...p.leftWordIds, ...p.rightWordIds], {
            title: `${sym.kind} · Pair ${p.label}`,
            ref: `${p.leftRef} ↔ ${p.rightRef}`,
            channel: p.evidenceChannel,
            confidence: sym.confidence,
            description: `${p.leftText} ↔ ${p.rightText} (similarity ${p.similarity}).`,
            alternative: sym.alternativeExplanation,
          });
        });
        card.append(armA);
      });

      if (sym.center) {
        const cEl = el('div', 'lit-chiasm-arm lit-chiasm-center');
        cEl.style.marginInlineStart = `${sym.pairs.length * 14}px`;
        cEl.append(el('span', 'lit-chiasm-label', 'X'), el('span', '', `${sym.center.text} (${sym.center.ref})`));
        cEl.addEventListener('click', () => {
          focusWords(sym.center!.wordIds, {
            title: `${sym.kind} · Center`,
            ref: sym.center!.ref,
            channel: 'resolved_lemma',
            description: `Central pivot element: ${sym.center!.text}`,
          });
        });
        card.append(cEl);
      }

      for (let idx = sym.pairs.length - 1; idx >= 0; idx--) {
        const p = sym.pairs[idx];
        const armB = el('div', 'lit-chiasm-arm');
        armB.style.setProperty('--lit-color', `var(--lit-c${idx % PALETTE_COUNT})`);
        armB.style.marginInlineStart = `${idx * 14}px`;
        armB.append(el('span', 'lit-chiasm-label', `${p.label}'`), el('span', '', `${p.rightText} (${p.rightRef})`));
        armB.addEventListener('click', () => {
          focusWords([...p.leftWordIds, ...p.rightWordIds], {
            title: `${sym.kind} · Pair ${p.label}'`,
            ref: `${p.leftRef} ↔ ${p.rightRef}`,
            channel: p.evidenceChannel,
            confidence: sym.confidence,
            description: `${p.leftText} ↔ ${p.rightText} (similarity ${p.similarity}).`,
            alternative: sym.alternativeExplanation,
          });
        });
        card.append(armB);
      }

      if (sym.alternativeExplanation) {
        card.append(el('p', 'lit-disclaimer', sym.alternativeExplanation));
      }
      container.append(card);
    });
    return container;
  }

  function renderWordplayTab(res: LiteraryAnalysisResult): HTMLElement {
    const wrap = el('div', '');
    if (!res.wordplays.length) {
      wrap.append(el('p', 'study-muted', 'No proximate consonantal/phonetic wordplay candidates found at this threshold.'));
      return wrap;
    }
    const grid = el('div', 'lit-wp-grid');
    const items = settings.showAlternatives ? res.wordplays : res.wordplays.slice(0, 8);
    items.forEach((wp: WordplayFinding) => {
      const card = el('div', 'lit-wp-card');
      card.append(el('span', 'lit-pill', `${wp.epistemicClass.replaceAll('_', ' ')} · ${wp.overlapKind.replaceAll('_', ' ')}`));
      const pair = el('div', 'lit-wp-pair');
      pair.append(
        renderMarkedOriginal(wp.wordA.form, wp.wordA.matchedCharIndices),
        el('span', 'study-muted', '↔'),
        renderMarkedOriginal(wp.wordB.form, wp.wordB.matchedCharIndices)
      );
      card.append(
        pair,
        el('div', 'lit-meta-row', `${wp.wordA.transliteration} ("${wp.wordA.gloss}") · ${wp.wordB.transliteration} ("${wp.wordB.gloss}")`),
        el('p', 'lit-disclaimer', `Shared consonants: ${wp.sharedConsonants} · ${wp.wordA.ref} / ${wp.wordB.ref}`)
      );
      card.addEventListener('click', () => {
        focusWords([wp.wordA.id, wp.wordB.id], {
          title: `Wordplay (${wp.overlapKind})`,
          ref: `${wp.wordA.ref} / ${wp.wordB.ref}`,
          channel: 'orthographic',
          confidence: wp.confidence,
          description: `${wp.wordA.form} (${wp.wordA.strongs}) ↔ ${wp.wordB.form} (${wp.wordB.strongs}), shared letters: ${wp.sharedConsonants}.`,
          alternative: wp.etymologyDisclaimer,
        });
      });
      grid.append(card);
    });
    wrap.append(grid);
    return wrap;
  }

  function renderExtrasTab(res: LiteraryAnalysisResult): HTMLElement {
    const box = el('div', 'lit-section-card');

    if (res.acrostics.length && settings.categories.has('acrostics')) {
      box.append(el('p', 'eyebrow', 'ALPHABETIC ACROSTICS'));
      for (const a of res.acrostics) {
        const acrosticList = el('div', 'lit-subunit-list');
        acrosticList.append(...a.entries.map(e => {
          const p = action(`${e.expectedLetter}:${e.form}`, () => {
            focusWords([e.wordId], {
              title: `Acrostic ${e.expectedLetter}`,
              ref: e.ref,
              channel: 'exact_form',
              description: `Line/colon begins with "${e.form}" (${e.letter} vs expected ${e.expectedLetter}).`,
            });
          }, 'lit-pill lit-pill--clickable');
          if (!e.matched) p.style.borderColor = 'var(--lit-c3)';
          return p;
        }));
        box.append(
          el('p', '', `${a.mode.replaceAll('_', ' ')} (${a.lettersCovered}/22 Hebrew letters, stanza ${a.stanzaSize})`),
          acrosticList
        );
      }
    }

    if (res.thematicClusters.length && settings.categories.has('thematic')) {
      box.append(el('p', 'eyebrow', 'RELATIONAL & THEMATIC CLUSTERS'));
      const thRow = el('div', 'lit-subunit-list');
      for (const th of res.thematicClusters.slice(0, 6)) {
        thRow.append(
          action(
            `${th.themeLabel}: ${th.lemmas.map(l => `${l.script}(×${l.count})`).join(', ')}`,
            () => focusWords(th.wordIds, {
              title: `Relational Cluster: ${th.themeLabel}`,
              ref: th.refs.slice(0, 4).join(', '),
              channel: th.evidenceChannel,
              description: `Connects ${th.lemmas.length} original-language lemmas across ${th.refs.length} verse(s).`,
            }),
            'lit-pill lit-pill--clickable'
          )
        );
      }
      box.append(thRow);
    }

    if (res.commandFulfillments.length) {
      box.append(el('p', 'eyebrow', 'COMMAND → FULFILLMENT PAIRS'));
      const cfRow = el('div', 'lit-subunit-list');
      for (const cf of res.commandFulfillments.slice(0, 8)) {
        cfRow.append(
          action(
            `${cf.commandRef} → ${cf.fulfillmentRef} (${cf.kind.replaceAll('_', ' ')})`,
            () => focusWords([...cf.commandWordIds, ...cf.fulfillmentWordIds], {
              title: 'Command → Fulfillment',
              ref: `${cf.commandRef} → ${cf.fulfillmentRef}`,
              channel: 'grammatical',
              description: `Shared lemmas: ${cf.sharedLemmas.join(', ') || 'explicit fulfillment formula'}.`,
            }),
            'lit-pill lit-pill--clickable'
          )
        );
      }
      box.append(cfRow);
    }

    if (res.keyWords.length) {
      box.append(el('p', 'eyebrow', 'KEY WORDS (LEITWÖRTER) & OBSERVED COUNTS'));
      const kwList = el('div', 'lit-subunit-list');
      for (const kw of res.keyWords.slice(0, 12)) {
        const label = `${kw.script} (${kw.gloss || kw.strongs}) ×${kw.count}${kw.isNotableCount ? ' ★' : ''}`;
        const pill = action(label, () => {
          focusWords(kw.wordIds, {
            title: `Leitwort: ${kw.script} (${kw.strongs})`,
            ref: `${kw.verseRefs.length} verse(s)`,
            channel: 'resolved_lemma',
            description: `${kw.transliteration} ("${kw.gloss}") appears ${kw.count} times.${kw.unitCounts.length ? ` Unit distribution: [${kw.unitCounts.join(', ')}].` : ''}`,
          });
        }, 'lit-pill lit-pill--clickable');
        kwList.append(pill);
      }
      box.append(kwList);
    }

    if (res.lxxComparison && settings.categories.has('lxx')) {
      box.append(el('p', 'eyebrow', `MT vs SWETE LXX COMPARISON (${res.lxxComparison.mappedVerses} mapped verses)`));
      if (!res.lxxComparison.divergences.length) {
        box.append(el('p', 'study-muted', 'No structural formula divergences detected between MT and mapped Swete LXX verses.'));
      } else {
        for (const d of res.lxxComparison.divergences) {
          box.append(el('p', '', `${d.mtRef} / ${d.lxxRef}: ${d.description}`));
        }
      }
    }

    if (res.limitations.length) {
      box.append(el('p', 'lit-disclaimer', res.limitations[res.limitations.length - 1]));
    }
    return box;
  }

  function renderPanel() {
    if (!active) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    element.replaceChildren();

    const header = el('div', 'lit-panel__header');
    const title = el('h3', 'lit-panel__title', currentAnalysis ? `Literary Structure · ${currentAnalysis.passage}` : 'Literary Structure Discovery');
    const controls = el('div', 'lit-panel__controls');
    if (currentAnalysis) {
      controls.append(
        el('span', 'lit-pill', `${currentAnalysis.edition.toUpperCase()} · ${currentAnalysis.verseCount}v · ${currentAnalysis.tokenCount}w`)
      );
    }
    controls.append(action('Refresh', () => void loadAnalysis(), 'text-action'));
    header.append(title, controls);
    element.append(header);

    if (!currentAnalysis) {
      element.append(renderSettingsBar(), status('Select a passage to inspect literary structure.'));
      return;
    }

    element.append(renderPatternLegend(currentAnalysis), renderSettingsBar());

    const tabs = el('div', 'lit-tabs');
    const tabDefs: [typeof activeTab, string][] = [
      ['overview', `Structure (${currentAnalysis.segmentation?.units.length ?? 0} units)`],
      ['template', `Template (${currentAnalysis.template?.slots.length ?? 0})`],
      ['symmetries', `Symmetries (${currentAnalysis.symmetries.length})`],
      ['wordplay', `Wordplay (${currentAnalysis.wordplays.length})`],
      ['extras', `Thematic, Acrostics & LXX`],
    ];
    for (const [id, label] of tabDefs) {
      const btn = action(label, () => {
        activeTab = id;
        renderPanel();
      }, `lit-tab${activeTab === id ? ' is-active' : ''}`);
      tabs.append(btn);
    }
    element.append(tabs);

    if (inspectedInfo) element.append(renderInspector());

    if (activeTab === 'overview') element.append(renderOverviewTab(currentAnalysis));
    else if (activeTab === 'template') element.append(renderTemplateTab(currentAnalysis));
    else if (activeTab === 'symmetries') element.append(renderSymmetriesTab(currentAnalysis));
    else if (activeTab === 'wordplay') element.append(renderWordplayTab(currentAnalysis));
    else element.append(renderExtrasTab(currentAnalysis));
  }

  return {
    element,
    isActive: () => active,
    setActive(next: boolean) {
      if (next === active) return;
      active = next;
      element.hidden = !active;
      if (active) void loadAnalysis();
      else {
        focusedWordIds = new Set();
        isolatedFamilyId = null;
        hoveredFamilyId = null;
        pushHighlights();
      }
    },
    setPassage(p: ActivePassage) {
      const changed =
        p.book !== currentPassage.book ||
        p.chapter !== currentPassage.chapter ||
        (settings.scope === 'verse' && p.verse !== currentPassage.verse);
      currentPassage = { ...p };
      if (active && (changed || !currentAnalysis)) {
        void loadAnalysis();
      }
    },
    getHighlightMap: buildHighlightMap,
    hoverFamily(familyId: string | null) {
      if (!active || isolatedFamilyId || hoveredFamilyId === familyId) return;
      hoveredFamilyId = familyId;
      pushHighlights();
    },
    focusFromToken(wordIdStr: string) {
      if (!currentAnalysis) return;
      const map = buildHighlightMap();
      const st = map.tokenStyles.get(wordIdStr);
      if (st) {
        const fam = map.visibleFamilies.find(f => f.id === st.familyId);
        if (fam) {
          const span = fam.spans.find(s => s.wordIds.includes(wordIdStr));
          focusWords(fam.spans.flatMap(s => s.wordIds), {
            title: fam.label,
            ref: span?.ref ?? currentAnalysis.passage,
            channel: fam.evidenceChannel,
            description: span?.deviationNote ? `${fam.description} Variation @ ${span.ref}: ${span.deviationNote}` : fam.description,
            family: fam,
          });
          return;
        }
      }
      const matchingDev = currentAnalysis.deviations.find(d => d.witnessWordIds.includes(wordIdStr));
      if (matchingDev) {
        focusWords(matchingDev.witnessWordIds, {
          title: `${matchingDev.kind} @ ${matchingDev.ref}`,
          ref: matchingDev.ref,
          channel: matchingDev.evidenceChannel,
          confidence: matchingDev.confidence,
          surprisal: matchingDev.surprisalBits,
          description: matchingDev.description,
        });
      }
    },
  };
}
