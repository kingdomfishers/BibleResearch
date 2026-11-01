// @file: src/ui/components/ChronologyPanel.ts
// @feature: verse-reader
// @tables: verses | chronology_models | chronology_runs | chronology_assertions | chronology_evidence
// @candidates: chronology-elements
// @toc: imports | types | ui:chronology-elements | ui:evidence | ui:assertions | ui:context | ui:body | ui:main | logic:load | logic:pagination

// === @section:imports ===
import '../styles-chronology.css';
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage, ChronologyAssertion, ChronologyAxis, ChronologyEvidence,
  ChronologyPacket, ChronologyResponse, ChronologySummary } from '../../api/types';

// === @section:types ===
const axisLabels: Record<ChronologyAxis, string> = {
  source_placement: 'Source placement', setting: 'Narrative context',
  composition: 'Composition context', mentioned_event: 'Associated event start',
};
const categoryLabels: Record<ChronologyEvidence['category'], string> = {
  textual: 'Textual evidence', archaeological: 'Archaeological evidence',
  model_premise: 'Model premise', scholarly_interpretation: 'Source interpretation',
};
const reviewLabels = { source_import: 'Attributed source import', model_assumption: 'Model assumption',
  reviewed: 'Reviewed record', candidate: 'Unpublished candidate' };
type SummaryCallback = (summary: ChronologySummary | null) => void;

// === @section:ui:chronology-elements ===
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function citation(label: string, locator: string) {
  try {
    const url = new URL(locator);
    if (url.protocol === 'https:') {
      const a = node('a', 'chronology-link', label);
      a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      return a;
    }
  } catch { /* Local model records are displayed as plain text. */ }
  return node('span', 'chronology-citation', label);
}
function detail(title: string) {
  const element = node('details', 'chronology-detail');
  element.append(node('summary', '', title));
  return element;
}
function field(label: string, value: string) {
  const p = node('p', 'chronology-field');
  p.append(node('strong', '', `${label}: `), document.createTextNode(value));
  return p;
}

// === @section:ui:evidence ===
function evidenceCard(e: ChronologyEvidence) {
  const item = detail(`${e.relationship[0].toUpperCase()}${e.relationship.slice(1)} · ${e.title}`);
  item.dataset.evidenceId = e.id;
  item.append(citation(e.citation, e.locator), node('p', '', e.summary),
    field('Dating method', e.dating_method), field('Scope', e.scope),
    field('Uncertainty', e.uncertainty), field('Relationship', e.explanation),
    field('Review', reviewLabels[e.review_status]));
  if (e.object_date_label || e.event_date_label) item.append(field('Object / event',
    `${e.object_date_label ?? 'Object date unavailable'} / ${e.event_date_label ?? 'Event date unavailable'}`));
  return item;
}
function evidenceGroups(packet: ChronologyPacket) {
  const section = node('section', 'chronology-evidence');
  section.setAttribute('aria-label', 'Chronology evidence');
  const seen = new Set<string>();
  for (const [category, label] of Object.entries(categoryLabels)) {
    const group = node('div', 'chronology-evidence-group');
    group.append(node('h4', '', label));
    let count = 0;
    for (const e of packet.evidence) {
      const key = `${e.id}:${e.relationship}:${e.explanation}`;
      if (e.category !== category || seen.has(key)) continue;
      seen.add(key); group.append(evidenceCard(e)); count++;
    }
    if (count) section.append(group);
  }
  if (!packet.has_archaeological_evidence) section.append(node('p', 'chronology-absence',
    'No reviewed archaeological date evidence is attached to this model and passage.'));
  if (!packet.evidence.length) section.append(node('p', 'chronology-muted',
    'No published evidence record is attached. Try another model to inspect its source estimates.'));
  return section;
}

// === @section:ui:assertions ===
function assertionCard(a: ChronologyAssertion) {
  const item = node('article', 'chronology-assertion');
  item.append(node('p', 'chronology-axis', axisLabels[a.axis]),
    node('h4', '', a.event_title ? `${a.event_title} · ${a.date_label}` : a.date_label),
    node('p', '', a.rationale));
  if (a.axis === 'mentioned_event' && a.original_date) item.append(field('Source date / duration',
    `${a.original_date}${a.duration ? ` / ${a.duration}` : ''} (source claim)`));
  const source = detail('Source, reference mapping and review');
  source.append(citation(a.source.dataset, a.source.locator), field('Attribution', a.source.attribution),
    field('License', `${a.source.license} · changes: chronology metadata projection`),
    field('Version', a.source.version), field('Review', `${reviewLabels[a.review_status]} · ${a.author}`));
  for (const key of ['source_ref', 'context', 'correspondence', 'method', 'uncertainty']) {
    const value = a.mapping[key];
    if (typeof value === 'string') source.append(field(key.replaceAll('_', ' '), value));
  }
  if (a.supersedes) source.append(field('Revision', `Supersedes assertion ${a.supersedes}`));
  item.append(source);
  return item;
}

// === @section:ui:context ===
function modelContext(packet: ChronologyPacket) {
  const section = detail('Model assumptions and coverage');
  if (packet.model.id.startsWith('adam-')) section.open = true;
  for (const [key, value] of Object.entries(packet.model.assumptions)) {
    if (typeof value === 'string' || typeof value === 'number') section.append(field(key.replaceAll('_', ' '), String(value)));
  }
  const c = packet.run.coverage;
  section.append(field('Coverage in this model', `${c.dated.toLocaleString()} dated context placements / ${c.passages.toLocaleString()} passage records; ${c.unresolved.toLocaleString()} without a setting or placement estimate.`));
  if (packet.model.id === 'theographic-events-v1') section.append(node('p', '',
    'Event associations are listed separately. An event start is not automatically the setting date of a verse.'));
  return section;
}
function alternatives(packet: ChronologyPacket, selectModel: (id: string) => void) {
  const section = detail('Compare other chronology models');
  section.dataset.comparison = '';
  section.open = packet.alternatives.length > 0;
  if (!packet.alternatives.length) section.append(node('p', 'chronology-muted', 'No other published estimate for this passage.'));
  for (const other of packet.alternatives) {
    const row = node('div', 'chronology-alternative');
    const label = node('div');
    label.append(node('strong', '', other.date_label), node('span', '',
      `${other.model_name} · ${axisLabels[other.axis]}${other.event_title ? ` · ${other.event_title}` : ''}`));
    const button = node('button', 'chronology-button', 'View model'); button.type = 'button';
    button.setAttribute('aria-label', `View ${other.model_name}`);
    button.addEventListener('click', () => selectModel(other.model_id));
    row.append(label, button); section.append(row);
  }
  return section;
}

// === @section:ui:body ===
function renderBody(packet: ChronologyPacket, selectModel: (id: string) => void, more: () => void) {
  const body = node('div', 'chronology-content');
  body.append(node('h3', 'chronology-date', packet.summary.label));
  const status = packet.assignment_status === 'source_estimate' ? 'Approximate source estimate'
    : packet.assignment_status === 'estimated' ? 'Model estimate'
      : packet.assignment_status === 'conflicting' ? 'Competing estimates' : 'Unresolved setting date';
  body.append(node('p', 'chronology-status', `${status}${packet.passage.is_heading ? ' · Psalm heading' : ''}`));
  if (packet.summary.axis) body.append(node('p', 'chronology-axis', axisLabels[packet.summary.axis]));
  if (!packet.assertions.length) body.append(node('p', 'chronology-muted',
    'A chronology status exists for this passage, but this model has no supported date estimate.'));
  body.append(modelContext(packet));
  for (const a of packet.assertions) body.append(assertionCard(a));
  if (packet.assertions_truncated) body.append(node('p', 'chronology-muted',
    `Showing 20 of ${packet.assertion_count} assertions. Additional assertions are not shown.`));
  body.append(evidenceGroups(packet));
  if (packet.next_evidence_cursor) {
    const button = node('button', 'chronology-button', 'Load more evidence');
    button.type = 'button'; button.addEventListener('click', more); body.append(button);
  }
  body.append(alternatives(packet, selectModel));
  const history = detail('Published revision history');
  history.append(field('Viewing release', `${packet.run.id} · ${packet.run.label}`));
  for (const run of packet.history) history.append(node('p', '', `Release ${run.id} · ${run.label}`));
  body.append(history);
  const attribution = node('p', 'chronology-attribution');
  attribution.append(citation('Theographic Bible Metadata', 'https://github.com/robertrouse/theographic-bible-metadata'),
    document.createTextNode(' · CC BY-SA 4.0 · adapted metadata, source versions retained. Text remains attributed to STEP Bible.'));
  body.append(attribution);
  return body;
}

// === @section:ui:main ===
export function createChronologyPanel(onSummary: SummaryCallback) {
  const element = node('section', 'chronology-panel');
  element.setAttribute('aria-label', 'Verse chronology'); element.setAttribute('aria-busy', 'false');
  const heading = node('div', 'chronology-heading');
  const title = node('div'); title.append(node('p', 'eyebrow', 'DATES & EVIDENCE'), node('h2', '', 'Place this passage in time'));
  const controls = node('div', 'chronology-controls');
  const label = node('label', '', 'Chronology model');
  const select = node('select'); select.setAttribute('aria-label', 'Chronology model');
  label.append(select); controls.append(label);
  const releaseLabel = node('label', '', 'Published release');
  const release = node('select'); release.setAttribute('aria-label', 'Chronology release');
  releaseLabel.append(release); releaseLabel.hidden = true; controls.append(releaseLabel);
  heading.append(title, controls);
  let content = node('div', 'chronology-content');
  element.append(heading, content);
  let modelId = 'theographic-verse-v1';
  try { modelId = localStorage.getItem('bible-chronology-model') || modelId; } catch { /* Storage is optional. */ }
  let passage: ActivePassage | null = null;
  let generation = 0;
  let packet: ChronologyPacket | null = null;
  function replace(next: HTMLDivElement) { content.replaceWith(next); content = next; }
  function chooseModel(id: string) {
    modelId = id; select.value = id;
    try { localStorage.setItem('bible-chronology-model', id); } catch { /* Storage is optional. */ }
    if (passage) void load(passage);
  }
  select.addEventListener('change', () => chooseModel(select.value));
  release.addEventListener('change', () => { if (passage) void load(passage, release.value || undefined); });
  function message(text: string, retry = false) {
    const next = node('div', 'chronology-content');
    const status = node('p', 'chronology-muted', text); status.setAttribute('role', 'status'); next.append(status);
    if (retry) {
      const button = node('button', 'chronology-button', 'Retry chronology'); button.type = 'button';
      button.addEventListener('click', () => { if (passage) void load(passage); }); next.append(button);
    }
    replace(next);
  }
  function updateModels(data: ChronologyResponse) {
    select.replaceChildren(...data.models.map(m => new Option(m.name, m.id)));
    select.value = modelId;
  }
  function show(data: ChronologyPacket) {
    packet = data;
    release.replaceChildren(new Option('Current published release', ''),
      ...data.history.map(r => new Option(`Release ${r.id} · ${r.label}`, r.id)));
    release.value = data.run.id; releaseLabel.hidden = data.history.length < 2;
    replace(renderBody(data, chooseModel, () => { void moreEvidence(); }));
  }

  // === @section:logic:load ===
  async function load(p: ActivePassage, runId?: string) {
    passage = p;
    const current = ++generation;
    packet = null; onSummary(null);
    element.setAttribute('aria-busy', 'true');
    message('Loading chronology and evidence…');
    const result = await BibleRPC.getVerseChronology(p, modelId, runId);
    if (current !== generation) return;
    element.setAttribute('aria-busy', 'false');
    const data = result.data;
    if (!data) { message(result.error ?? 'Chronology is unavailable.', true); return; }
    updateModels(data);
    if (data.status !== 'ok') {
      if (data.status === 'invalid_model' && modelId !== 'theographic-verse-v1') {
        chooseModel('theographic-verse-v1'); return;
      }
      const text = data.status === 'passage_not_found' ? 'This reference has no passage record in the selected text.'
        : data.status === 'release_unavailable' ? 'This published release is unavailable. Select the current release.'
          : 'Chronology could not be loaded for this reference and model.';
      message(text, data.status !== 'passage_not_found'); return;
    }
    show(data); onSummary(data.summary);
  }

  // === @section:logic:pagination ===
  async function moreEvidence() {
    const prior = packet;
    if (!passage || !prior?.next_evidence_cursor || element.getAttribute('aria-busy') === 'true') return;
    const current = generation;
    element.setAttribute('aria-busy', 'true');
    const result = await BibleRPC.getVerseChronology(passage, modelId, prior.run.id, prior.next_evidence_cursor);
    if (current !== generation) return;
    element.setAttribute('aria-busy', 'false');
    if (!result.data || result.data.status !== 'ok') {
      const error = node('p', 'chronology-muted', 'More evidence could not be loaded. Your current evidence is retained; try again.');
      error.setAttribute('role', 'status'); content.append(error); return;
    }
    show({ ...result.data, evidence: [...prior.evidence, ...result.data.evidence] });
  }
  return { element, load };
}
