// @file: src/ui/components/ResearchPanel.ts
// @feature: app-shell
// @tables: words | verses | verse_translation_sources | chronology_models | chronology_runs | chronology_assertions | chronology_evidence | places | place_locations | verse_geography | passage_geography | geography_sources | lexemes | concepts | assertions | assertion_evidence
// @candidates: none
// @toc: imports | types | ui:tabs | ui:prompt1 | ui:prompt2 | ui:prompt3 | ui:prompt4 | ui:prompt5 | ui:prompt6 | ui:openapi | ui:main | logic:actions | logic:context-actions

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage } from '../../api/types';
import { BIBLE_BOOKS, formatVerseRef } from '../utils';
import { renderRelationshipExplorerView } from './RelationshipExplorer';
import { createHydratedResearch } from './HydratedResearch';

// === @section:types ===
export interface ResearchPanelProps {
  onSelectPassage: (p: ActivePassage) => void;
  onInspectWord: (wordId: number) => void;
}
export interface ResearchPanelHandle {
  element: HTMLElement;
  updatePassage: (p: ActivePassage) => void;
}

// === @section:ui:tabs ===
function renderTabs(container: HTMLElement, onTabChange: (id: string) => void) {
  const tabs = [
    { id: 'p1', label: 'Verse words' },
    { id: 'p2', label: 'Find occurrences' },
    { id: 'p3', label: 'Word companions' },
    { id: 'p4', label: 'Compare words' },
    { id: 'p5', label: 'Study chronology' },
    { id: 'p6', label: 'Study geography' },
    { id: 'p7', label: 'Connections & evidence' },
    { id: 'p8', label: 'Research & patterns' },
    { id: 'api', label: 'Integrations' },
  ];
  container.innerHTML = `<div class="research-tablist" role="tablist" aria-label="Research Prompts">` +
    tabs.map((t, i) => `<button type="button" role="tab" id="tab-${t.id}" aria-selected="${i === 0}"
      aria-controls="panel-${t.id}" class="research-tab ${i === 0 ? 'active' : ''}">${t.label}</button>`).join('') +
    `</div>`;
  const buttons = container.querySelectorAll<HTMLButtonElement>('.research-tab');
  buttons.forEach(btn => btn.addEventListener('click', () => {
    buttons.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
    onTabChange(btn.id.replace('tab-', ''));
  }));
}

// === @section:ui:prompt1 ===
function renderPrompt1View(container: HTMLElement, current: ActivePassage, onRun: (p: ActivePassage) => void) {
  container.innerHTML = `<div class="prompt-meta"><p class="prompt-desc">
    <strong>Prompt 1 (<code>prompt_verse_words</code>)</strong>: Computes ordered interlinear tokens for any verse in PostgreSQL, returning original script, transliteration, Strong's number, morphology, and glosses.</p>
    <div class="api-signature">POST /rest/v1/rpc/prompt_verse_words · { p_book: <span id="p1-sig-b">${current.book}</span>, p_chapter: <span id="p1-sig-c">${current.chapter}</span>, p_verse: <span id="p1-sig-v">${current.verse}</span> }</div></div>
    <form class="prompt-form" id="p1-form"><div class="inputs-row">
      <label>Prompt Book <select id="p1-book" aria-label="Prompt Book">${BIBLE_BOOKS.map((b, i) => `<option value="${i + 1}" ${i + 1 === current.book ? 'selected' : ''}>${i + 1}. ${b}</option>`).join('')}</select></label>
      <label>Prompt Chapter <input type="number" id="p1-chapter" aria-label="Prompt Chapter" min="1" max="150" value="${current.chapter}" /></label>
      <label>Prompt Verse <input type="number" id="p1-verse" aria-label="Prompt Verse" min="0" max="176" value="${current.verse}" /></label>
      <button type="submit" class="run-btn">Run Prompt 1</button></div></form>
    <div class="prompt-results" id="p1-results"><p class="hint-text">Select Run to inspect tokens for this passage.</p></div>`;
  container.querySelector('#p1-form')!.addEventListener('submit', e => {
    e.preventDefault();
    const b = Number((container.querySelector('#p1-book') as HTMLSelectElement).value);
    const c = Number((container.querySelector('#p1-chapter') as HTMLInputElement).value);
    const v = Number((container.querySelector('#p1-verse') as HTMLInputElement).value);
    onRun({ book: b, chapter: c, verse: v });
  });
}

// === @section:ui:prompt2 ===
function renderPrompt2View(container: HTMLElement, onRun: (q: string) => void) {
  container.innerHTML = `<div class="prompt-meta"><p class="prompt-desc">
    <strong>Prompt 2 (<code>prompt_word_occurrences</code>)</strong>: Uses PostgreSQL GIN index over <code>verses.word_ids</code> to find every verse containing a word across all inflections, grouped by Strong's number.</p>
    <div class="api-signature">POST /rest/v1/rpc/prompt_word_occurrences · { p_word_query: "H7225" }</div></div>
    <form class="prompt-form" id="p2-form"><div class="inputs-row">
      <label class="flex-grow">Word / Strong's <input type="text" id="p2-query" value="H7225" placeholder="e.g. H7225, G3056, בְּרֵאשִׁית, logos" /></label>
      <button type="submit" class="run-btn">Run Prompt 2</button></div>
      <div class="quick-samples"><span>Quick queries:</span>
        <button type="button" data-q="H7225">H7225 (beginning)</button><button type="button" data-q="G3056">G3056 (Word/Logos)</button><button type="button" data-q="H1254">H1254 (create)</button>
      </div></form>
    <div class="prompt-results" id="p2-results"><p class="hint-text">Enter a Strong's number or word to search across Scripture.</p></div>`;
  container.querySelector('#p2-form')!.addEventListener('submit', e => {
    e.preventDefault(); onRun((container.querySelector('#p2-query') as HTMLInputElement).value.trim());
  });
  container.querySelectorAll('.quick-samples button').forEach(b => b.addEventListener('click', () => {
    const q = b.getAttribute('data-q')!; (container.querySelector('#p2-query') as HTMLInputElement).value = q; onRun(q);
  }));
}

// === @section:ui:prompt3 ===
function renderPrompt3View(container: HTMLElement, onRun: (q: string) => void) {
  container.innerHTML = `<div class="prompt-meta"><p class="prompt-desc">
    <strong>Prompt 3 (<code>prompt_word_cooccurrences</code>)</strong>: Returns top cached lexical co-occurrence partners hydrated in SQL with frequency, average token distance, and statistical association score.</p>
    <div class="api-signature">POST /rest/v1/rpc/prompt_word_cooccurrences · { p_word_query: "H7225" }</div></div>
    <form class="prompt-form" id="p3-form"><div class="inputs-row">
      <label class="flex-grow">Word / Strong's <input type="text" id="p3-query" value="H7225" placeholder="e.g. H7225, G3056" /></label>
      <button type="submit" class="run-btn">Run Prompt 3</button></div>
      <div class="quick-samples"><span>Quick queries:</span>
        <button type="button" data-q="H7225">H7225 (beginning)</button><button type="button" data-q="G3056">G3056 (Logos)</button><button type="button" data-q="H430">H430 (God)</button>
      </div></form>
    <div class="prompt-results" id="p3-results"><p class="hint-text">Inspect the strongest lexical associations for any biblical word.</p></div>`;
  container.querySelector('#p3-form')!.addEventListener('submit', e => {
    e.preventDefault(); onRun((container.querySelector('#p3-query') as HTMLInputElement).value.trim());
  });
  container.querySelectorAll('.quick-samples button').forEach(b => b.addEventListener('click', () => {
    const q = b.getAttribute('data-q')!; (container.querySelector('#p3-query') as HTMLInputElement).value = q; onRun(q);
  }));
}

// === @section:ui:prompt4 ===
function renderPrompt4View(container: HTMLElement, onRun: (q: string) => void) {
  container.innerHTML = `<div class="prompt-meta"><p class="prompt-desc">
    <strong>Prompt 4 (<code>prompt_word_relationships</code>)</strong>: Computes multi-word verse containment (<code>@></code>) and density relationship scoring directly in PostgreSQL across two or more words.</p>
    <div class="api-signature">POST /rest/v1/rpc/prompt_word_relationships · { p_word_ids: [129386, 79640] }</div></div>
    <form class="prompt-form" id="p4-form"><div class="inputs-row">
      <label class="flex-grow">Words to compare <input type="text" id="p4-query" value="H7225, H1254" placeholder="e.g. H7225, H1254 or 129386, 79640" /></label>
      <button type="submit" class="run-btn">Run Prompt 4</button></div>
      <div class="quick-samples"><span>Quick comparisons:</span>
        <button type="button" data-q="H7225, H1254">H7225 + H1254 (beginning + created)</button><button type="button" data-q="G3056, G2316">G3056 + G2316 (Word + God)</button><button type="button" data-q="H430, H853">H430 + H853 (God + object)</button>
      </div></form>
    <div class="prompt-results" id="p4-results"><p class="hint-text">Find shared verses containing all target words with relationship scores.</p></div>`;
  container.querySelector('#p4-form')!.addEventListener('submit', e => {
    e.preventDefault(); onRun((container.querySelector('#p4-query') as HTMLInputElement).value.trim());
  });
  container.querySelectorAll('.quick-samples button').forEach(b => b.addEventListener('click', () => {
    const q = b.getAttribute('data-q')!; (container.querySelector('#p4-query') as HTMLInputElement).value = q; onRun(q);
  }));
}

// === @section:ui:prompt5 ===
function renderPrompt5View(container: HTMLElement, current: ActivePassage, onRun: (p: ActivePassage, m: string) => void) {
  container.innerHTML = `<div class="prompt-meta"><p class="prompt-desc">
    <strong>Prompt 5 (<code>get_verse_chronology_v1</code> · MCP Prompt <code>study_chronology</code>)</strong>: Resolves multi-model historical setting, composition dating, competing chronological models, and archaeological/textual evidence for any verse.</p>
    <div class="api-signature">POST /rest/v1/rpc/get_verse_chronology_v1 · { p_book: <span id="p5-sig-b">${current.book}</span>, p_chapter: <span id="p5-sig-c">${current.chapter}</span>, p_verse: <span id="p5-sig-v">${current.verse}</span>, p_model_id: "theographic-verse-v1" }</div></div>
    <form class="prompt-form" id="p5-form"><div class="inputs-row">
      <label>Book <select id="p5-book" aria-label="Chronology Book">${BIBLE_BOOKS.map((b, i) => `<option value="${i + 1}" ${i + 1 === current.book ? 'selected' : ''}>${i + 1}. ${b}</option>`).join('')}</select></label>
      <label>Chapter <input type="number" id="p5-chapter" min="1" max="150" value="${current.chapter}" /></label>
      <label>Verse <input type="number" id="p5-verse" min="0" max="176" value="${current.verse}" /></label>
      <label>Model <select id="p5-model"><option value="theographic-verse-v1">Theographic Consensus</option><option value="adam-resurrection-30-v1">Adam ~4000 yr before AD 30</option><option value="adam-resurrection-33-v1">Adam ~4000 yr before AD 33</option><option value="archaeology-pilot-v1">Archaeology Pilot</option></select></label>
      <button type="submit" class="run-btn">Run Chronology Prompt</button></div>
      <div class="quick-samples"><span>Sample passages:</span>
        <button type="button" data-b="1" data-c="2" data-v="7">Genesis 2:7 (Creation Models)</button>
        <button type="button" data-b="12" data-c="18" data-v="13">2 Kings 18:13 (701 BC Sennacherib Prism)</button>
        <button type="button" data-b="44" data-c="2" data-v="1">Acts 2:1 (AD 30 / 33)</button>
      </div></form>
    <div class="prompt-results" id="p5-results"><p class="hint-text">Run Prompt 5 to inspect multi-model chronology and copy an AI-ready prompt packet.</p></div>`;
  const getArgs = () => ({
    p: {
      book: Number((container.querySelector('#p5-book') as HTMLSelectElement).value),
      chapter: Number((container.querySelector('#p5-chapter') as HTMLInputElement).value),
      verse: Number((container.querySelector('#p5-verse') as HTMLInputElement).value),
    },
    m: (container.querySelector('#p5-model') as HTMLSelectElement).value,
  });
  container.querySelector('#p5-form')!.addEventListener('submit', e => {
    e.preventDefault(); const { p, m } = getArgs(); onRun(p, m);
  });
  container.querySelectorAll<HTMLButtonElement>('.quick-samples button').forEach(btn => btn.addEventListener('click', () => {
    (container.querySelector('#p5-book') as HTMLSelectElement).value = btn.getAttribute('data-b')!;
    (container.querySelector('#p5-chapter') as HTMLInputElement).value = btn.getAttribute('data-c')!;
    (container.querySelector('#p5-verse') as HTMLInputElement).value = btn.getAttribute('data-v')!;
    const { p, m } = getArgs(); onRun(p, m);
  }));
}

// === @section:ui:prompt6 ===
function renderPrompt6View(container: HTMLElement, current: ActivePassage, onRun: (p: ActivePassage) => void) {
  container.innerHTML = `<div class="prompt-meta"><p class="prompt-desc">
    <strong>Prompt 6 (<code>get_verse_geography</code> · MCP Prompt <code>study_geography</code>)</strong>: Resolves context-aware biblical geography across 5 tiers (direct event, narrative passage context, event metadata, regional polygon, or symbolic/unknown) with disputed alternatives.</p>
    <div class="api-signature">POST /rest/v1/rpc/get_verse_geography · { p_book: <span id="p6-sig-b">${current.book}</span>, p_chapter: <span id="p6-sig-c">${current.chapter}</span>, p_verse: <span id="p6-sig-v">${current.verse}</span> }</div></div>
    <form class="prompt-form" id="p6-form"><div class="inputs-row">
      <label>Book <select id="p6-book" aria-label="Geography Book">${BIBLE_BOOKS.map((b, i) => `<option value="${i + 1}" ${i + 1 === current.book ? 'selected' : ''}>${i + 1}. ${b}</option>`).join('')}</select></label>
      <label>Chapter <input type="number" id="p6-chapter" min="1" max="150" value="${current.chapter}" /></label>
      <label>Verse <input type="number" id="p6-verse" min="0" max="176" value="${current.verse}" /></label>
      <button type="submit" class="run-btn">Run Geography Prompt</button></div>
      <div class="quick-samples"><span>Sample passages:</span>
        <button type="button" data-b="43" data-c="4" data-v="7">John 4:7 (Sychar Narrative Context)</button>
        <button type="button" data-b="1" data-c="29" data-v="10">Genesis 29:10 (Haran Well Context)</button>
        <button type="button" data-b="2" data-c="15" data-v="23">Exodus 15:23 (Marah Disputed Route)</button>
        <button type="button" data-b="66" data-c="21" data-v="2">Revelation 21:2 (Symbolic Guard)</button>
      </div></form>
    <div class="prompt-results" id="p6-results"><p class="hint-text">Run Prompt 6 to inspect context-aware geography and copy an AI-ready prompt packet.</p></div>`;
  const getPassage = () => ({
    book: Number((container.querySelector('#p6-book') as HTMLSelectElement).value),
    chapter: Number((container.querySelector('#p6-chapter') as HTMLInputElement).value),
    verse: Number((container.querySelector('#p6-verse') as HTMLInputElement).value),
  });
  container.querySelector('#p6-form')!.addEventListener('submit', e => {
    e.preventDefault(); onRun(getPassage());
  });
  container.querySelectorAll<HTMLButtonElement>('.quick-samples button').forEach(btn => btn.addEventListener('click', () => {
    (container.querySelector('#p6-book') as HTMLSelectElement).value = btn.getAttribute('data-b')!;
    (container.querySelector('#p6-chapter') as HTMLInputElement).value = btn.getAttribute('data-c')!;
    (container.querySelector('#p6-verse') as HTMLInputElement).value = btn.getAttribute('data-v')!;
    onRun(getPassage());
  }));
}

// === @section:ui:openapi ===
function renderOpenApiView(container: HTMLElement) {
  container.innerHTML = `<div class="openapi-guide">
    <h3>OpenAPI 3.1.0 Specification & Public MCP Server (<code>bible-mcp</code>)</h3>
    <p>Both <strong>ChatGPT Custom GPT Actions</strong>, <strong>Gemini Extensions</strong>, and <strong>MCP Clients</strong> can query original-language words, multi-model chronology, context-aware geography, and evidence-graph relationships directly.</p>
    <div class="spec-card">
      <div class="spec-row"><strong>OpenAPI 3.1.0 Spec:</strong> <code>supabase/openapi.json</code> · Base URL: <code>https://ejoperxiwxlcbsqrkrvb.supabase.co/rest/v1</code></div>
      <div class="spec-row"><strong>Public MCP Endpoint:</strong> <code>https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp</code> (Streamable HTTP, No Auth Required)</div>
      <div class="spec-row"><strong>AI MCP Prompts:</strong> Six study prompts plus ten pattern templates: repetition, literary structure, motifs, allusions, semantics, grammar, rare connections, time/place, translation effects, and counterexamples. Use the Hydrated Verse & Patterns tab to copy a template with data.</div>
    </div>
    <div class="prompt-table-wrap"><table class="prompt-table">
      <thead><tr><th>Prompt</th><th>PostgREST / MCP Tool</th><th>Parameters</th><th>What AI Retrieves</th></tr></thead>
      <tbody>
        <tr><td><strong>1</strong></td><td><code>/rpc/prompt_verse_words</code></td><td><code>p_book, p_chapter, p_verse</code></td><td>Ordered interlinear original words, Strong's, grammar, and glosses</td></tr>
        <tr><td><strong>2</strong></td><td><code>/rpc/prompt_word_occurrences</code></td><td><code>p_word_query</code></td><td>All Bible verses where word appears with occurrence counts</td></tr>
        <tr><td><strong>3</strong></td><td><code>/rpc/prompt_word_cooccurrences</code></td><td><code>p_word_query</code></td><td>Top co-occurring words, frequency, distance, and association score</td></tr>
        <tr><td><strong>4</strong></td><td><code>/rpc/prompt_word_relationships</code></td><td><code>p_word_ids</code></td><td>Shared verses with multi-word relationship density score</td></tr>
        <tr><td><strong>5</strong></td><td><code>/rpc/get_verse_chronology_v1</code></td><td><code>p_book, p_chapter, p_verse, p_model_id</code></td><td>Multi-model historical setting, composition date, and competing chronologies</td></tr>
        <tr><td><strong>6</strong></td><td><code>/rpc/get_verse_geography</code></td><td><code>p_book, p_chapter, p_verse</code></td><td>5-tier context-aware locations, coordinates/polygons, confidence, and disputed sites</td></tr>
        <tr><td><strong>7</strong></td><td><code>/rpc/research_relationships_v1</code></td><td><code>p_request (subject, target, mode)</code></td><td>One-lookup disambiguated lexemes, narrative parallels, allusions, and controls</td></tr>
        <tr><td><strong>8</strong></td><td><code>/rpc/get_verse_research_v1</code> · MCP <code>get_verse_research</code></td><td><code>p_request (passages, occurrences)</code></td><td>Hydrated words, complete occurrences, seven connections, translations, grammar, dates, map data, and available semantic evidence</td></tr>
      </tbody></table></div></div>`;
}

// === @section:ui:main ===
export function createResearchPanel(props: ResearchPanelProps): ResearchPanelHandle {
  const element = document.createElement('section');
  element.className = 'research-panel';
  element.setAttribute('aria-label', 'Database Research Prompts');
  element.innerHTML = `<div class="research-header">
    <div class="research-header-title"><span class="gold-line"></span><span class="eyebrow">GO DEEPER</span>
    <h2>Study the patterns. Follow the evidence.</h2></div>
    <p class="research-sub">Compare words, explore historical context, prepare research and connect your study tools.</p>
    </div><div class="research-tabs-mount"></div><div class="research-panels-mount"></div>`;
  const tabsMount = element.querySelector<HTMLElement>('.research-tabs-mount')!;
  const panelsMount = element.querySelector<HTMLElement>('.research-panels-mount')!;
  const panels: Record<string, HTMLElement> = {};
  let currentPassage: ActivePassage = { book: 1, chapter: 1, verse: 1 };
  const switchTab = (tabId: string) => {
    Object.entries(panels).forEach(([id, el]) => { el.style.display = id === tabId ? 'block' : 'none'; });
  };
  renderTabs(tabsMount, switchTab);
  ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'api'].forEach(id => {
    const p = document.createElement('div'); p.id = `panel-${id}`; p.className = 'research-tabpanel';
    p.style.display = id === 'p1' ? 'block' : 'none'; panels[id] = p; panelsMount.append(p);
  });
  const actions = wireActions();
  const ctxActions = wireContextActions();
  renderPrompt1View(panels['p1'], currentPassage, p => actions.runPrompt1(panels['p1'], p, props));
  renderPrompt2View(panels['p2'], q => actions.runPrompt2(panels['p2'], q, props));
  renderPrompt3View(panels['p3'], q => actions.runPrompt3(panels['p3'], q, props));
  renderPrompt4View(panels['p4'], q => actions.runPrompt4(panels['p4'], q, props));
  renderPrompt5View(panels['p5'], currentPassage, (p, m) => ctxActions.runPrompt5(panels['p5'], p, m));
  renderPrompt6View(panels['p6'], currentPassage, p => ctxActions.runPrompt6(panels['p6'], p));
  renderRelationshipExplorerView(panels['p7'], { onSelectPassage: props.onSelectPassage });
  const hydrated = createHydratedResearch(panels['p8']);
  renderOpenApiView(panels['api']);
  return {
    element,
    updatePassage(p: ActivePassage) {
      currentPassage = p;
      hydrated.updatePassage(p);
      for (const prefix of ['p1', 'p5', 'p6']) {
        const panel = panels[prefix];
        const b = panel.querySelector<HTMLSelectElement>(`#${prefix}-book`);
        const c = panel.querySelector<HTMLInputElement>(`#${prefix}-chapter`);
        const v = panel.querySelector<HTMLInputElement>(`#${prefix}-verse`);
        if (b) b.value = String(p.book); if (c) c.value = String(p.chapter); if (v) v.value = String(p.verse);
        const sb = panel.querySelector(`#${prefix}-sig-b`); if (sb) sb.textContent = String(p.book);
        const sc = panel.querySelector(`#${prefix}-sig-c`); if (sc) sc.textContent = String(p.chapter);
        const sv = panel.querySelector(`#${prefix}-sig-v`); if (sv) sv.textContent = String(p.verse);
      }
    },
  };
}

// === @section:logic:actions ===
function wireActions() {
  return {
    async runPrompt1(container: HTMLElement, p: ActivePassage, props: ResearchPanelProps) {
      const res = container.querySelector('#p1-results')!;
      res.innerHTML = '<p class="hint-text">Loading Prompt 1 tokens from PostgreSQL…</p>';
      const data = await BibleRPC.getVerseWords(p.book, p.chapter, p.verse);
      if (!data.data.length) { res.innerHTML = '<p class="hint-text">No words returned for this verse.</p>'; return; }
      res.innerHTML = `<div class="p1-tokens-grid">${data.data.map(t => `<button type="button" class="p1-token-card" data-id="${t.word_id}">
        <span class="tok-pos">#${t.word_position}</span><span class="tok-orig" dir="${t.strongs_nr.startsWith('H') ? 'rtl' : 'ltr'}">${t.original_word}</span>
        <span class="tok-trans">${t.transliteration}</span><span class="tok-strongs">${t.strongs_nr}</span>
        <span class="tok-gloss">${t.primary_english ?? ''}</span></button>`).join('')}</div>`;
      res.querySelectorAll<HTMLButtonElement>('.p1-token-card').forEach(btn =>
        btn.addEventListener('click', () => props.onInspectWord(Number(btn.getAttribute('data-id')))));
    },
    async runPrompt2(container: HTMLElement, query: string, props: ResearchPanelProps) {
      const res = container.querySelector('#p2-results')!;
      res.innerHTML = `<p class="hint-text">Searching GIN index for "${query}"…</p>`;
      const data = await BibleRPC.getWordOccurrences(query);
      if (!data.data.length) { res.innerHTML = `<p class="hint-text">No occurrences found for "${query}".</p>`; return; }
      res.innerHTML = `<p class="result-count">Found ${data.data.length} passages:</p><div class="p2-grid">${data.data.slice(0, 40).map(o => {
        const ref = formatVerseRef({ book: o.book, chapter: o.chapter, verse: o.verse_nr });
        return `<button type="button" class="p2-chip" data-b="${o.book}" data-c="${o.chapter}" data-v="${o.verse_nr}">
          <span class="ref">${ref}</span><span class="count">${o.occurrence_count}×</span></button>`;
      }).join('')}</div>`;
      res.querySelectorAll<HTMLButtonElement>('.p2-chip').forEach(btn => btn.addEventListener('click', () =>
        props.onSelectPassage({ book: Number(btn.getAttribute('data-b')), chapter: Number(btn.getAttribute('data-c')), verse: Number(btn.getAttribute('data-v')) })));
    },
    async runPrompt3(container: HTMLElement, query: string, props: ResearchPanelProps) {
      const res = container.querySelector('#p3-results')!;
      res.innerHTML = `<p class="hint-text">Fetching cached co-occurrences for "${query}"…</p>`;
      const data = await BibleRPC.getWordCoOccurrences(query);
      if (!data.data.length) { res.innerHTML = `<p class="hint-text">No co-occurrences found for "${query}".</p>`; return; }
      res.innerHTML = `<div class="p3-list">${data.data.map(w => `<button type="button" class="p3-item" data-id="${w.word_id}">
        <div class="p3-left"><span class="orig">${w.original_word}</span><span class="trans">${w.transliteration}</span>
        <span class="gloss">${w.primary_english ?? ''}</span></div>
        <div class="p3-right"><span>Score <strong>${w.score}</strong></span><span>Freq ${w.frequency}</span><span>Dist ${w.avg_distance}</span></div>
        </button>`).join('')}</div>`;
      res.querySelectorAll<HTMLButtonElement>('.p3-item').forEach(btn =>
        btn.addEventListener('click', () => props.onInspectWord(Number(btn.getAttribute('data-id')))));
    },
    async runPrompt4(container: HTMLElement, input: string, props: ResearchPanelProps) {
      const res = container.querySelector('#p4-results')!;
      res.innerHTML = '<p class="hint-text">Resolving words and computing relationship score…</p>';
      const rawTokens = input.split(/[,+\s]+/).map(s => s.trim()).filter(Boolean);
      const ids: number[] = [];
      for (const tok of rawTokens) {
        if (/^\d+$/.test(tok)) ids.push(Number(tok));
        else { const id = await BibleRPC.resolveWordId(tok); if (id) ids.push(id); }
      }
      if (ids.length < 2) { res.innerHTML = '<p class="hint-text">Please provide at least 2 valid words or Strong\'s numbers (e.g. H7225, H1254).</p>'; return; }
      const data = await BibleRPC.getWordRelationships(ids);
      if (!data.data.length) { res.innerHTML = '<p class="hint-text">No verses found containing all requested words.</p>'; return; }
      res.innerHTML = `<p class="result-count">${data.data.length} shared verses ordered by density score:</p><div class="p4-list">${data.data.map(r => {
        const ref = formatVerseRef({ book: r.book, chapter: r.chapter, verse: r.verse_nr });
        return `<button type="button" class="p4-item" data-b="${r.book}" data-c="${r.chapter}" data-v="${r.verse_nr}">
          <span class="ref">${ref}</span><span class="score-badge">Score ${r.relationship_score}</span></button>`;
      }).join('')}</div>`;
      res.querySelectorAll<HTMLButtonElement>('.p4-item').forEach(btn => btn.addEventListener('click', () =>
        props.onSelectPassage({ book: Number(btn.getAttribute('data-b')), chapter: Number(btn.getAttribute('data-c')), verse: Number(btn.getAttribute('data-v')) })));
    },
  };
}

// === @section:logic:context-actions ===
function wireContextActions() {
  return {
    async runPrompt5(container: HTMLElement, p: ActivePassage, modelId: string) {
      const res = container.querySelector('#p5-results')!;
      res.innerHTML = '<p class="hint-text">Loading multi-model chronology packet from PostgreSQL…</p>';
      const out = await BibleRPC.getVerseChronology(p, modelId);
      if (!out.data || out.data.status !== 'ok') {
        res.innerHTML = `<p class="hint-text">${out.error ?? 'Chronology unavailable for this passage.'}</p>`;
        return;
      }
      const pkt = out.data;
      const ref = formatVerseRef(p);
      const aiPrompt = `Study the biblical chronology of ${ref} using get_verse_chronology_v1 (model: ${pkt.model.id}). Primary estimate: ${pkt.summary.label} (${pkt.assignment_status}). Compare competing models (${pkt.alternatives.map(a => `${a.model_name}: ${a.date_label}`).join('; ') || 'none'}) and cite supporting textual/archaeological evidence.`;
      res.innerHTML = `<div class="spec-card"><div class="spec-row"><strong>${ref} (${pkt.model.name}):</strong> ${pkt.summary.label} · Status: <code>${pkt.assignment_status}</code></div>
        <div class="spec-row"><strong>Assertions (${pkt.assertion_count}):</strong> ${pkt.assertions.map(a => `${a.axis}: ${a.date_label} (${a.rationale})`).join(' | ') || 'None'}</div>
        <div class="spec-row"><strong>Competing Models (${pkt.alternatives.length}):</strong> ${pkt.alternatives.map(a => `${a.model_name}: ${a.date_label}`).join(' · ') || 'None'}</div>
        <div class="spec-row"><strong>AI Prompt (<code>study_chronology</code>):</strong> <code>${aiPrompt}</code></div></div>`;
    },
    async runPrompt6(container: HTMLElement, p: ActivePassage) {
      const res = container.querySelector('#p6-results')!;
      res.innerHTML = '<p class="hint-text">Resolving 5-tier context-aware geography from PostgreSQL…</p>';
      const out = await BibleRPC.getVerseGeography(p);
      if (!out.data || out.data.status !== 'ok') {
        res.innerHTML = `<p class="hint-text">${out.error ?? 'Geography unavailable for this passage.'}</p>`;
        return;
      }
      const pkt = out.data;
      const ref = formatVerseRef(p);
      const locs = pkt.locations.map(l => `${l.biblical_name} (${l.modern_name ?? 'regional/symbolic'}, ${l.relationship_type}, ${l.confidence_level}${l.alternative_locations.length > 1 ? `, ${l.alternative_locations.length} alternatives` : ''})`).join('; ');
      const summaryText = pkt.message ?? (pkt.passage_contexts[0]?.title ? `Narrative Context: ${pkt.passage_contexts[0].title}` : `Resolved ${pkt.locations.length} place(s)`);
      const aiPrompt = `Study the biblical geography of ${ref} using get_verse_geography. Status (${pkt.resolution_status}): ${summaryText}. Locations: ${locs || 'No physical site established'}. Distinguish event settings from mentioned places and explain any disputed identifications.`;
      res.innerHTML = `<div class="spec-card"><div class="spec-row"><strong>${ref} (<code>${pkt.resolution_status}</code>):</strong> ${summaryText}</div>
        <div class="spec-row"><strong>Resolved Places (${pkt.locations.length}):</strong> ${locs || 'No reliable geographical location identified for this verse.'}</div>
        <div class="spec-row"><strong>AI Prompt (<code>study_geography</code>):</strong> <code>${aiPrompt}</code></div></div>`;
    },
  };
}
