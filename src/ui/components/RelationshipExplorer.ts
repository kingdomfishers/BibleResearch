// @file: src/ui/components/RelationshipExplorer.ts
// @feature: app-shell
// @tables: lexemes | concepts | assertions | assertion_evidence
// @candidates: none
// @toc: imports | types | ui:paths | ui:main

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage, RelationshipResearchPacket, ResearchAssertionPath } from '../../api/types';

// === @section:types ===
export interface RelationshipExplorerProps {
  onSelectPassage: (p: ActivePassage) => void;
}

// === @section:ui:paths ===
function renderAssertionCard(path: ResearchAssertionPath, onSelectPassage: (p: ActivePassage) => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'spec-card';
  card.style.marginBottom = '12px';
  const spansHtml = path.evidence_spans.map(s => `<button type="button" class="p2-chip" data-b="${s.book}" data-c="${s.start_chapter}" data-v="${s.start_verse}" title="${s.explanation}">
    <span class="ref">${s.reference}</span><span class="count">${s.role.replaceAll('_', ' ')}</span></button>`).join(' ');
  card.innerHTML = `<div class="spec-row"><strong>${path.scope_reference}</strong> · <code>${path.epistemic_category}</code> · <code>${path.predicate}</code></div>
    <div class="spec-row">${path.summary}</div>
    ${path.denominator_note ? `<div class="spec-row"><strong>Scope / Denominator:</strong> ${path.denominator_note}</div>` : ''}
    <div class="spec-row"><strong>Boundary / Limitation:</strong> ${path.limitations_note}</div>
    <div class="spec-row" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${spansHtml}</div>`;
  card.querySelectorAll<HTMLButtonElement>('.p2-chip').forEach(btn => btn.addEventListener('click', () => {
    onSelectPassage({
      book: Number(btn.getAttribute('data-b')),
      chapter: Number(btn.getAttribute('data-c')),
      verse: Number(btn.getAttribute('data-v')),
    });
  }));
  return card;
}
function renderPacketView(container: HTMLElement, pkt: RelationshipResearchPacket, onSelectPassage: (p: ActivePassage) => void) {
  container.innerHTML = '';
  const lexemes = [...pkt.resolution.subject_lexemes, ...pkt.resolution.target_lexemes];
  if (lexemes.length > 0) {
    const lexBox = document.createElement('div');
    lexBox.className = 'spec-card';
    lexBox.style.marginBottom = '12px';
    lexBox.innerHTML = `<div class="spec-row"><strong>Resolved Lexemes (${lexemes.length}${pkt.resolution.needs_disambiguation ? ' · Disambiguated Homographs' : ''}):</strong></div>` +
      lexemes.map(l => `<div class="spec-row"><code>${l.extended_strongs}</code> (${l.original_lemma} · <em>${l.transliteration}</em>) — <strong>${l.primary_gloss}</strong>${l.homograph_note ? ` · <span style="color:var(--muted)">${l.homograph_note}</span>` : ''}</div>`).join('');
    container.append(lexBox);
  }
  for (const path of pkt.evidence_paths) container.append(renderAssertionCard(path, onSelectPassage));
  for (const ctrl of pkt.controls_and_distinctions) container.append(renderAssertionCard(ctrl, onSelectPassage));
  if (!pkt.evidence_paths.length && !lexemes.length) {
    container.innerHTML = '<p class="hint-text">No reviewed motif paths or lexemes matched this query in the current scope.</p>';
  }
}

// === @section:ui:main ===
export function renderRelationshipExplorerView(container: HTMLElement, props: RelationshipExplorerProps) {
  container.innerHTML = `<div class="prompt-meta"><p class="prompt-desc">
    <strong>Prompt 7 (<code>research_relationships_v1</code> · MCP Tool <code>research_relationships</code>)</strong>: One-lookup original-language & literary evidence graph returning disambiguated lexemes, narrative parallels, intertextual chains, and counterexample controls.</p>
    <div class="api-signature">POST /rest/v1/rpc/research_relationships_v1 · { p_request: { subject: { text: "well" }, target: { text: "marriage" }, mode: "explain" } }</div></div>
    <form class="prompt-form" id="p7-form"><div class="inputs-row">
      <label class="flex-grow">Subject (Word / Concept / Strong's) <input type="text" id="p7-subject" value="well" placeholder="e.g. well, menorah, H1254" /></label>
      <label class="flex-grow">Target (Optional) <input type="text" id="p7-target" value="marriage" placeholder="e.g. marriage, seven spirits of God" /></label>
      <button type="submit" class="run-btn">Run Evidence Lookup</button></div>
      <div class="quick-samples"><span>Benchmarks:</span>
        <button type="button" data-s="well" data-t="marriage">Well + Marriage (Gen 24, 29, Exod 2 + Controls)</button>
        <button type="button" data-s="menorah" data-t="seven spirits of God">Menorah + Seven Spirits (Exod 25, Zech 4, Rev 4:5/5:6 + Rev 1:20)</button>
        <button type="button" data-s="H1254" data-t="">H1254 Homographs (bara I/II/III)</button>
      </div></form>
    <div class="prompt-results" id="p7-results"><p class="hint-text">Select a benchmark or enter a subject/target to inspect multi-layer evidence in one call.</p></div>`;
  const run = async (subj: string, targ: string) => {
    const res = container.querySelector<HTMLElement>('#p7-results')!;
    res.innerHTML = '<p class="hint-text">Resolving concepts, homographs, and reviewed evidence paths in PostgreSQL…</p>';
    const out = await BibleRPC.researchRelationships(subj, targ || undefined);
    if (!out.data || out.data.status !== 'ok') {
      res.innerHTML = `<p class="hint-text">${out.error ?? out.data?.message ?? 'Research packet unavailable.'}</p>`;
      return;
    }
    renderPacketView(res, out.data, props.onSelectPassage);
  };
  container.querySelector('#p7-form')!.addEventListener('submit', e => {
    e.preventDefault();
    const s = (container.querySelector('#p7-subject') as HTMLInputElement).value.trim();
    const t = (container.querySelector('#p7-target') as HTMLInputElement).value.trim();
    void run(s, t);
  });
  container.querySelectorAll<HTMLButtonElement>('.quick-samples button').forEach(btn => btn.addEventListener('click', () => {
    const s = btn.getAttribute('data-s')!;
    const t = btn.getAttribute('data-t')!;
    (container.querySelector('#p7-subject') as HTMLInputElement).value = s;
    (container.querySelector('#p7-target') as HTMLInputElement).value = t;
    void run(s, t);
  }));
}
