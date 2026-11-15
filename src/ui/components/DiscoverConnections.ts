/**
 * R10 Discover Connections UI Component
 * Accessible from main workspace header & WordInspector.
 * Persistent search form (never destroys <input> focus/keyboard on Android),
 * separate autocomplete & results slots, subclusters + bridges, bounded SVG map,
 * evidence inspection, passage click-through with return history, filters & node expansion.
 */

import {
  discoverBiblicalConnectionsRpc,
  expandBiblicalConnectionRpc,
  getConnectionEvidenceRpc,
} from '../../api/r10-rpc';
import type {
  ConnectionEvidenceResult,
  DiscoverConnectionsResult,
  R10ConnectionSummary,
  R10EvidenceTier,
  R10PassageRef,
  R10Predicate,
} from '../../relationships/r10-types';

export interface DiscoverConnectionsCallbacks {
  onNavigatePassage: (book: number, chapter: number, verse: number, originWordStrongs?: string) => void;
  onInspectWordQuery?: (strongsOrLemma: string, passage?: R10PassageRef) => void;
}

interface AutocompleteSuggestion {
  label: string;
  insert: string;
  hint: string;
}

const AUTOCOMPLETE_SUGGESTIONS: AutocompleteSuggestion[] = [
  { label: 'ruach (רוּחַ H7307)', insert: 'ruach', hint: 'Spirit · Wind · Breath · Directions' },
  { label: 'pneuma (πνεῦμα G4151)', insert: 'pneuma', hint: 'Spirit · Wind · Breath' },
  { label: 'menorah (מְנוֹרָה H4501)', insert: 'menorah', hint: 'Golden Lampstand' },
  { label: 'seven lamps & eyes', insert: 'seven eyes lamps', hint: 'Zech 4:2,10 · Rev 4:5 · Rev 5:6' },
  { label: 'Red Sea & baptism', insert: 'Red Sea baptism', hint: 'Exod 14 · 1 Cor 10:1-2' },
  { label: 'adam (אָדָם) & dam (דָּם)', insert: 'Adam dam', hint: 'Orthographic & wordplay test' },
  { label: 'adamah (אֲדָמָה ground)', insert: 'adamah', hint: 'Gen 2:7 paronomasia' },
  { label: 'ayin (עַיִן eye vs spring)', insert: 'ayin', hint: 'Homograph H5869' },
  { label: 'Passover lamb, door, blood, Jesus', insert: 'Passover door blood Jesus', hint: 'Exod 12 · 1 Cor 5:7 · John 19:36' },
  { label: 'Genesis 1 & Revelation 4', insert: 'Genesis 1 creation Revelation 4 seven spirits', hint: 'Creation & New Creation' },
];

const EXAMPLE_QUERIES = [
  { label: 'ruach, spirit, seven, eyes, lamps, menorah, oil, water, wind, directions', q: 'ruach, spirit, seven, eyes, lamps, menorah, oil, water, wind, directions' },
  { label: 'Red Sea & baptism', q: 'Red Sea baptism' },
  { label: 'Adam & dam', q: 'Adam dam' },
  { label: 'Genesis 1 & Revelation 4', q: 'Genesis 1 creation Revelation 4 seven spirits' },
  { label: 'Passover door, blood, & Jesus', q: 'Passover door blood Jesus' },
];

type FilterBucket = 'all' | 'explicit' | 'lexical' | 'xref' | 'motif' | 'orthographic';

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tierBadgeLabel(tier: R10EvidenceTier, pred: R10Predicate): string {
  return `Tier ${tier} · ${pred.replace(/_/g, ' ')}`;
}

export class DiscoverConnectionsPanel {
  private container: HTMLElement;
  private callbacks: DiscoverConnectionsCallbacks;

  private inputEl!: HTMLInputElement;
  private submitBtn!: HTMLButtonElement;
  private prevBtn!: HTMLButtonElement;
  private returnBarSlot!: HTMLElement;
  private acSlot!: HTMLElement;
  private resultsSlot!: HTMLElement;

  private currentQuery = '';
  private activeFilter: FilterBucket = 'all';
  private viewMode: 'cards' | 'map' = 'cards';
  private loading = false;
  private errorMsg: string | null = null;
  private result: DiscoverConnectionsResult | null = null;
  private evidenceCache = new Map<string, ConnectionEvidenceResult>();
  private openEvidenceIds = new Set<string>();
  private previousStates: Array<{ query: string; filter: FilterBucket; result: DiscoverConnectionsResult | null }> = [];
  private awayFromDiscovery = false;
  private showAutocomplete = false;

  constructor(container: HTMLElement, callbacks: DiscoverConnectionsCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.mountShell();
    this.renderResults();
  }

  private mountShell(): void {
    this.container.innerHTML = `
      <section class="discover-panel" aria-label="Discover Biblical Connections">
        <div class="js-return-bar-slot"></div>
        <div class="discover-header">
          <div>
            <p class="eyebrow">DISCOVER CONNECTIONS · CONCEPT, MOTIF & TYPOLOGY ENGINE</p>
            <h2>Discover Biblical Connections</h2>
          </div>
          <button type="button" class="study-button js-prev-discovery" hidden>← Previous discovery</button>
        </div>

        <form class="discover-search-row js-discover-form" autocomplete="off">
          <input
            type="text"
            class="discover-input js-discover-input"
            placeholder="Enter words, passages, symbols, numbers, or events…"
            aria-label="Enter words, passages, symbols, numbers, or events"
          />
          <button type="submit" class="study-button primary js-discover-submit">Discover</button>
          <div class="js-ac-slot"></div>
        </form>

        <div class="discover-chips-row">
          <span class="study-muted">Try:</span>
          ${EXAMPLE_QUERIES.map(ex => `<button type="button" class="discover-chip js-example-query" data-q="${esc(ex.q)}">${esc(ex.label)}</button>`).join('')}
        </div>

        <div class="js-results-slot"></div>
      </section>
    `;

    this.inputEl = this.container.querySelector<HTMLInputElement>('.js-discover-input')!;
    this.submitBtn = this.container.querySelector<HTMLButtonElement>('.js-discover-submit')!;
    this.prevBtn = this.container.querySelector<HTMLButtonElement>('.js-prev-discovery')!;
    this.returnBarSlot = this.container.querySelector<HTMLElement>('.js-return-bar-slot')!;
    this.acSlot = this.container.querySelector<HTMLElement>('.js-ac-slot')!;
    this.resultsSlot = this.container.querySelector<HTMLElement>('.js-results-slot')!;

    this.inputEl.addEventListener('focus', () => {
      this.showAutocomplete = true;
      this.renderAutocomplete();
    });
    this.inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        this.showAutocomplete = false;
        this.renderAutocomplete();
      }, 150);
    });
    this.inputEl.addEventListener('input', () => {
      this.currentQuery = this.inputEl.value;
      this.showAutocomplete = true;
      this.renderAutocomplete();
    });

    this.container.querySelector<HTMLFormElement>('.js-discover-form')!.addEventListener('submit', e => {
      e.preventDefault();
      const val = this.inputEl.value.trim();
      if (val) void this.runDiscovery(val, true);
    });

    this.container.querySelectorAll<HTMLButtonElement>('.js-example-query').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.q) void this.runDiscovery(btn.dataset.q, true);
      });
    });

    this.prevBtn.addEventListener('click', () => {
      const prev = this.previousStates.pop();
      if (prev) {
        this.currentQuery = prev.query;
        this.inputEl.value = prev.query;
        this.activeFilter = prev.filter;
        this.result = prev.result;
        this.awayFromDiscovery = false;
        this.renderResults();
      }
    });
  }

  public async runDiscovery(queryText: string, pushHistory = true): Promise<void> {
    const clean = queryText.trim();
    if (!clean) return;
    if (pushHistory && this.result && this.currentQuery && this.currentQuery !== clean) {
      this.previousStates.push({ query: this.currentQuery, filter: this.activeFilter, result: this.result });
      if (this.previousStates.length > 8) this.previousStates.shift();
    }
    this.currentQuery = clean;
    this.inputEl.value = clean;
    this.awayFromDiscovery = false;
    this.showAutocomplete = false;
    this.loading = true;
    this.errorMsg = null;
    this.renderAutocomplete();
    this.renderResults();

    const res = await discoverBiblicalConnectionsRpc({
      query: clean,
      filters: this.buildFilterPayload(),
      limit: 10,
      cursor: null,
    });

    this.loading = false;
    if (res.error || !res.data) {
      this.errorMsg = res.error || 'Discovery request failed.';
      this.result = null;
    } else {
      this.result = res.data;
    }
    this.renderResults();
  }

  public seedAndOpen(term: string): void {
    this.container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void this.runDiscovery(term, true);
  }

  public markNavigatedToReader(): void {
    if (this.result) {
      this.awayFromDiscovery = true;
      this.renderReturnBar();
    }
  }

  private renderAutocomplete(): void {
    if (!this.showAutocomplete) {
      this.acSlot.innerHTML = '';
      return;
    }
    const q = this.inputEl.value.trim().toLowerCase();
    const items = AUTOCOMPLETE_SUGGESTIONS
      .filter(s => !q || s.label.toLowerCase().includes(q) || s.hint.toLowerCase().includes(q))
      .slice(0, 6);
    if (items.length === 0) {
      this.acSlot.innerHTML = '';
      return;
    }
    this.acSlot.innerHTML = `
      <div class="discover-autocomplete">
        ${items.map(item => `<button type="button" class="discover-ac-item js-ac-pick" data-insert="${esc(item.insert)}"><strong>${esc(item.label)}</strong><span class="study-muted">${esc(item.hint)}</span></button>`).join('')}
      </div>
    `;
    this.acSlot.querySelectorAll<HTMLButtonElement>('.js-ac-pick').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        const ins = btn.dataset.insert || '';
        if (ins) void this.runDiscovery(ins, true);
      });
    });
  }

  private renderReturnBar(): void {
    if (!this.awayFromDiscovery || !this.result) {
      this.returnBarSlot.innerHTML = '';
      return;
    }
    this.returnBarSlot.innerHTML = `
      <div class="discover-return-bar">
        <span>Inspecting passage from discovery: <strong>${esc(this.currentQuery)}</strong></span>
        <button type="button" class="study-button primary js-return-discovery">← Return to discovery</button>
      </div>
    `;
    this.returnBarSlot.querySelector<HTMLButtonElement>('.js-return-discovery')?.addEventListener('click', () => {
      this.awayFromDiscovery = false;
      this.renderReturnBar();
      this.container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  private buildFilterPayload() {
    switch (this.activeFilter) {
      case 'explicit':
        return { max_tier: 2 as R10EvidenceTier };
      case 'lexical':
        return { predicates: ['verified_lexical_grammatical', 'cross_language_bridge'] as R10Predicate[] };
      case 'xref':
        return { predicates: ['literary_correspondence', 'cross_reference_witness'] as R10Predicate[] };
      case 'motif':
        return { predicates: ['shared_motif', 'literary_pattern', 'numbered_entity'] as R10Predicate[] };
      case 'orthographic':
        return { predicates: ['orthographic_wordplay', 'orthographic_overlap'] as R10Predicate[] };
      default:
        return undefined;
    }
  }

  private async loadMore(): Promise<void> {
    if (!this.result?.pagination.next_cursor || this.loading) return;
    this.loading = true;
    this.renderResults();
    const res = await discoverBiblicalConnectionsRpc({
      query: this.currentQuery,
      filters: this.buildFilterPayload(),
      limit: 10,
      cursor: this.result.pagination.next_cursor,
    });
    this.loading = false;
    if (res.data) {
      this.result = {
        ...res.data,
        strongest_connections: [...this.result.strongest_connections, ...res.data.strongest_connections],
        connection_paths: [...this.result.connection_paths, ...res.data.connection_paths],
      };
    }
    this.renderResults();
  }

  private async toggleEvidenceDrawer(evidenceId: string): Promise<void> {
    if (this.openEvidenceIds.has(evidenceId)) {
      this.openEvidenceIds.delete(evidenceId);
      this.renderResults();
      return;
    }
    this.openEvidenceIds.add(evidenceId);
    if (!this.evidenceCache.has(evidenceId)) {
      this.renderResults();
      const res = await getConnectionEvidenceRpc(evidenceId);
      if (res.data) {
        this.evidenceCache.set(evidenceId, res.data);
      }
    }
    this.renderResults();
  }

  private async handleExpandNode(nodeId: string, label: string): Promise<void> {
    if (this.result) {
      this.previousStates.push({ query: this.currentQuery, filter: this.activeFilter, result: this.result });
    }
    this.loading = true;
    this.errorMsg = null;
    this.renderResults();
    const exp = await expandBiblicalConnectionRpc(nodeId, { limit: 8 });
    this.loading = false;
    if (exp.data && exp.data.connections.length > 0) {
      const next = await discoverBiblicalConnectionsRpc({ query: label.replace(/^[a-z]+:/, ''), limit: 8 });
      if (next.data) {
        this.currentQuery = label;
        this.inputEl.value = label;
        this.result = next.data;
      }
    }
    this.renderResults();
  }

  private copyPathText(conn: R10ConnectionSummary): void {
    const refs = conn.passages.map(p => p.ref).join(', ');
    const words = conn.original_words.map(w => `${w.lemma_script} (${w.transliteration} ${w.strongs})`).join('; ');
    const text = `[BibleResearch R10 | ${tierBadgeLabel(conn.evidence_tier, conn.predicate)}]\n${conn.title}\n${conn.explanation}\nPassages: ${refs}\nOriginal words: ${words}\nNote: ${conn.uncertainty_note}`;
    void navigator.clipboard?.writeText(text);
  }

  private renderLightweightMap(res: DiscoverConnectionsResult): string {
    const clusters = res.clusters.slice(0, 3);
    const conns = res.strongest_connections.slice(0, 6);
    if (clusters.length === 0 && conns.length === 0) {
      return '<p class="study-muted">No bounded visual nodes available for this query.</p>';
    }
    const width = 680;
    const height = Math.max(180, clusters.length * 95 + 40);
    const lines: string[] = [];
    const nodes: string[] = [];

    if (clusters.length >= 2) {
      const leftY = 85;
      const rightY = clusters.length > 2 ? 235 : 85;
      const rightX = clusters.length > 2 ? 340 : 490;
      const bridgeLabel = res.bridges[0]?.bridging_node?.label || 'Bridge';
      lines.push(`<line x1="205" y1="${leftY}" x2="${rightX}" y2="${rightY}" stroke="currentColor" stroke-opacity="0.35" stroke-width="2" />`);
      nodes.push(`<g transform="translate(340, ${Math.round((leftY + rightY) / 2)})"><rect x="-78" y="-16" width="156" height="32" rx="16" fill="var(--accent)" stroke="var(--green)" /><text x="0" y="5" text-anchor="middle" font-size="11" fill="currentColor">${esc(bridgeLabel.slice(0, 22))}</text></g>`);
    }

    clusters.forEach((cl, idx) => {
      const cx = idx === 0 ? 115 : idx === 1 ? 520 : 340;
      const cy = idx === 2 ? 235 : 85;
      nodes.push(`<g><rect x="${cx - 102}" y="${cy - 34}" width="204" height="68" rx="8" fill="var(--panel)" stroke="var(--gold)" /><text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">${esc(cl.label.slice(0, 28))}</text><text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(cl.concepts.slice(0, 4).join(' · '))}</text></g>`);
    });

    if (clusters.length < 2) {
      conns.slice(0, 5).forEach((c, idx) => {
        const y = 34 + idx * 34;
        const p0 = c.passages[0]?.ref || c.matched_concepts[0] || 'Evidence';
        const p1 = c.passages[1]?.ref || c.original_words[0]?.lemma_script || c.predicate.replace(/_/g, ' ');
        lines.push(`<line x1="175" y1="${y}" x2="485" y2="${y}" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5" />`);
        nodes.push(`<rect x="18" y="${y - 13}" width="160" height="26" rx="5" fill="var(--panel)" stroke="var(--border)" /><text x="98" y="${y + 4}" text-anchor="middle" font-size="11" fill="currentColor">${esc(p0.slice(0, 22))}</text>`);
        nodes.push(`<rect x="245" y="${y - 11}" width="180" height="22" rx="11" fill="var(--soft)" /><text x="335" y="${y + 3}" text-anchor="middle" font-size="10" fill="var(--green)">${esc(c.predicate.replace(/_/g, ' ').slice(0, 24))}</text>`);
        nodes.push(`<rect x="485" y="${y - 13}" width="175" height="26" rx="5" fill="var(--panel)" stroke="var(--gold)" /><text x="572" y="${y + 4}" text-anchor="middle" font-size="11" fill="currentColor">${esc(p1.slice(0, 22))}</text>`);
      });
    }

    return `<div class="discover-map-svg-wrap"><svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:680px;display:block" role="img" aria-label="Bounded biblical connection map">${lines.join('')}${nodes.join('')}</svg><p class="study-muted">Bounded lightweight map (clustered & capped for mobile speed).</p></div>`;
  }

  private renderCard(c: R10ConnectionSummary): string {
    const isOpen = this.openEvidenceIds.has(c.evidence_id);
    const evData = this.evidenceCache.get(c.evidence_id);
    const isCaution = c.evidence_tier >= 5 || c.predicate === 'orthographic_overlap';

    return `
      <article class="discover-conn-card tier-${c.evidence_tier}" data-evidence-id="${esc(c.evidence_id)}">
        <div class="discover-conn-meta">
          <span class="discover-badge ${isCaution ? 'is-caution' : ''}">${esc(tierBadgeLabel(c.evidence_tier, c.predicate))}</span>
          <span class="discover-badge">${esc(c.epistemic_class.replace(/_/g, ' '))}</span>
          <span class="study-muted">Score ${c.score} · ${c.witness_count} witness(es)</span>
        </div>
        <h4 class="discover-conn-title">${esc(c.title)}</h4>
        <p class="discover-conn-summary">${esc(c.explanation)}</p>
        <p class="discover-uncertainty">${esc(c.uncertainty_note)}</p>
        <div class="discover-chips-row">
          ${c.passages.map(p => `<button type="button" class="discover-chip js-nav-passage" data-book="${p.book}" data-chapter="${p.chapter}" data-verse="${p.verse}" data-strongs="${esc(c.original_words[0]?.strongs || '')}">${esc(p.ref)} (${p.testament})</button>`).join('')}
          ${c.original_words.map(w => `<button type="button" class="discover-chip js-expand-node" data-node="lemma:${esc(w.strongs || w.transliteration)}" data-label="${esc(w.transliteration || w.gloss)}">${esc(w.lemma_script)} ${esc(w.transliteration)} (${esc(w.gloss)})</button>`).join('')}
        </div>
        <div class="discover-conn-actions">
          <button type="button" class="study-button js-toggle-evidence" data-evidence-id="${esc(c.evidence_id)}">${isOpen ? 'Hide evidence' : 'Inspect biblical evidence'}</button>
          <button type="button" class="study-button js-copy-path" data-conn-id="${esc(c.connection_id)}">Copy path</button>
        </div>
        ${isOpen ? this.renderEvidenceDrawer(c.evidence_id, evData) : ''}
      </article>
    `;
  }

  private renderEvidenceDrawer(evidenceId: string, evData?: ConnectionEvidenceResult): string {
    if (!evData) {
      return `<div class="discover-evidence-drawer"><p class="study-muted">Loading original-language evidence for ${esc(evidenceId)}…</p></div>`;
    }
    if (!evData.evidence) {
      return `<div class="discover-evidence-drawer"><p class="study-muted">Detailed passage breakdown unavailable for this synthetic item.</p></div>`;
    }
    return `
      <div class="discover-evidence-drawer">
        <strong>Source Evidence & Provenance (${esc(evData.evidence.provenance.source_dataset)} · ${esc(evData.evidence.provenance.license)})</strong>
        ${evData.evidence.orthographic_analysis ? `<p class="study-muted"><strong>Consonants:</strong> ${esc(evData.evidence.orthographic_analysis.source_script)} [${esc(evData.evidence.orthographic_analysis.source_consonants)}] vs ${esc(evData.evidence.orthographic_analysis.target_script)} [${esc(evData.evidence.orthographic_analysis.target_consonants)}] — ${esc(evData.evidence.orthographic_analysis.etymology_warning)}</p>` : ''}
        ${evData.evidence.number_classification ? `<p class="study-muted"><strong>Number analysis:</strong> ${evData.evidence.number_classification.number_value} × ${esc(evData.evidence.number_classification.counted_entity)} (${esc(evData.evidence.number_classification.kind.replace(/_/g, ' '))}; coincidence risk: ${evData.evidence.number_classification.coincidence_risk})</p>` : ''}
        ${(evData.passage_details || []).map(pd => {
          const seenWord = new Set<number>();
          const dedupedTokens = pd.original_tokens.filter(t => {
            if (seenWord.has(t.word_no)) return false;
            seenWord.add(t.word_no);
            return true;
          });
          return `
            <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
              <button type="button" class="reference-link js-nav-passage" data-book="${pd.passage.book}" data-chapter="${pd.passage.chapter}" data-verse="${pd.passage.verse}">${esc(pd.passage.ref)} → Open in Reader</button>
              ${pd.english_text ? `<p style="margin:4px 0;font-size:13px">${esc(pd.english_text)} <span class="study-muted">[WEB]</span></p>` : ''}
              <div class="discover-token-strip">
                ${dedupedTokens.slice(0, 26).map(tok => `<span class="discover-token-chip ${tok.is_highlighted ? 'is-hit' : ''}" title="${esc(tok.strongs)} · ${esc(tok.gloss)}"><strong>${esc(tok.surface)}</strong><br><small>${esc(tok.strongs)} ${esc(tok.gloss)}</small></span>`).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  private renderResults(): void {
    this.submitBtn.disabled = this.loading;
    this.submitBtn.textContent = this.loading ? 'Discovering…' : 'Discover';
    this.prevBtn.hidden = this.previousStates.length === 0;
    this.renderReturnBar();

    const res = this.result;
    if (!res && !this.errorMsg) {
      this.resultsSlot.innerHTML = '';
      return;
    }

    this.resultsSlot.innerHTML = `
      ${res ? `
        <div class="discover-controls-bar">
          <div class="discover-chips-row" style="margin:0">
            ${(['all', 'explicit', 'lexical', 'xref', 'motif', 'orthographic'] as FilterBucket[]).map(fb => {
              const labels: Record<FilterBucket, string> = {
                all: 'All evidence',
                explicit: 'Explicit & Typology (1–2)',
                lexical: 'Lexical & LXX (3)',
                xref: 'Cross-Refs (4)',
                motif: 'Motifs & Numbers',
                orthographic: 'Wordplay & Orthography',
              };
              return `<button type="button" class="discover-chip ${this.activeFilter === fb ? 'is-active' : ''} js-filter-bucket" data-filter="${fb}">${labels[fb]}</button>`;
            }).join('')}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <form class="discover-add-concept js-add-concept-form">
              <input type="text" class="js-add-concept-input" placeholder="+ Add concept (e.g. fire)" aria-label="Add concept to investigation" />
              <button type="submit" class="study-button">Add</button>
            </form>
            <button type="button" class="study-button js-toggle-view">${this.viewMode === 'cards' ? 'Show cluster map' : 'Card view'}</button>
          </div>
        </div>

        <div class="discover-status-banner">
          <strong>Status: ${esc(res.status.toUpperCase())}</strong> · ${res.strongest_connections.length} of ${res.pagination.total_available} ranked connections shown · ${res.search_metadata.execution_ms} ms (${res.search_metadata.asset_requests_used} shard reads · ${res.search_metadata.exhaustive ? 'exhaustive' : 'bounded'})
        </div>

        <div class="discover-resolved-row">
          ${res.parsed_query.resolved_concepts.map(rc => `
            <span class="discover-lemma-pill ${rc.matched ? '' : 'is-unresolved'}">
              <strong>${esc(rc.input_token)}</strong>
              ${rc.lemmas[0] ? `→ ${esc(rc.lemmas[0].lemma_script)} (${esc(rc.lemmas[0].strongs)})` : rc.matched ? `→ ${esc(rc.resolution_kind)}` : '→ no match'}
            </span>
          `).join('')}
        </div>

        ${this.viewMode === 'map' || res.clusters.length >= 2 ? `
          <div class="discover-section">
            <h3>Concept Subclusters & Bridges</h3>
            <div class="discover-clusters-grid">
              ${res.clusters.map(cl => `
                <div class="discover-cluster-card">
                  <h4>${esc(cl.label)}</h4>
                  <p class="study-muted">${esc(cl.summary)}</p>
                  <div class="discover-chips-row">
                    ${cl.anchor_nodes.map(n => `<button type="button" class="discover-chip js-expand-node" data-node="${esc(n.id)}" data-label="${esc(n.label)}">${esc(n.label)}</button>`).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
            ${res.bridges.map(b => `<div class="discover-bridge-banner"><strong>Bridge:</strong> ${esc(b.explanation)}</div>`).join('')}
            ${this.viewMode === 'map' ? this.renderLightweightMap(res) : ''}
          </div>
        ` : ''}

        <div class="discover-section">
          <h3>Strongest Connections</h3>
          ${res.strongest_connections.length > 0
            ? `<div class="discover-card-list">${res.strongest_connections.map(c => this.renderCard(c)).join('')}</div>`
            : `<p class="study-muted">No connections matched this query/filter combination.</p>`
          }
          ${res.pagination.has_more ? `<button type="button" class="study-button load-more js-load-more">Load more connections (${res.pagination.total_available - res.strongest_connections.length} remaining)</button>` : ''}
        </div>

        ${res.connection_paths.length > 0 ? `
          <div class="discover-section">
            <h3>Connection Paths</h3>
            ${res.connection_paths.map(p => `
              <div class="discover-control-item">
                <strong>${esc(p.start_node.label)}</strong> → ${p.steps.map(s => `<span class="discover-badge">${esc(s.predicate.replace(/_/g, ' '))} (Tier ${s.evidence_tier})</span>`).join(' → ')} → <strong>${esc(p.end_node.label)}</strong>
                <p class="study-muted" style="margin:4px 0 0">${esc(p.explanation)}</p>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${res.controls_and_alternatives.length > 0 || res.related_discoveries.cross_references.length > 0 || res.related_discoveries.biblical_events.length > 0 ? `
          <div class="discover-section">
            <h3>Related Discoveries, Controls & Alternative Explanations</h3>
            ${res.controls_and_alternatives.map(ctrl => `
              <div class="discover-control-item">
                <strong>${esc(ctrl.title)}</strong>
                <p style="margin:4px 0 0">${esc(ctrl.explanation)}</p>
              </div>
            `).join('')}
            ${res.related_discoveries.biblical_events.length > 0 ? `
              <div class="discover-chips-row">
                <span class="study-muted">Biblical Events:</span>
                ${res.related_discoveries.biblical_events.map(ev => ev.passages[0] ? `<button type="button" class="discover-chip js-nav-passage" data-book="${ev.passages[0].book}" data-chapter="${ev.passages[0].chapter}" data-verse="${ev.passages[0].verse}">${esc(ev.title)} (${esc(ev.passages[0].ref)})</button>` : '').join('')}
              </div>
            ` : ''}
            ${res.related_discoveries.cross_references.length > 0 ? `
              <div class="discover-chips-row">
                <span class="study-muted">Verified Cross-Refs:</span>
                ${res.related_discoveries.cross_references.slice(0, 8).map(xr => `<button type="button" class="discover-chip js-nav-passage" data-book="${xr.to_passage.book}" data-chapter="${xr.to_passage.chapter}" data-verse="${xr.to_passage.verse}">${esc(xr.from_ref)} ↔ ${esc(xr.to_ref)}</button>`).join('')}
              </div>
            ` : ''}
          </div>
        ` : ''}
      ` : ''}
      ${this.errorMsg ? `<p class="discover-status-banner" style="color:var(--gold)">${esc(this.errorMsg)}</p>` : ''}
    `;

    this.bindResultEvents();
  }

  private bindResultEvents(): void {
    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-filter-bucket').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeFilter = (btn.dataset.filter as FilterBucket) || 'all';
        void this.runDiscovery(this.currentQuery, false);
      });
    });

    this.resultsSlot.querySelector<HTMLButtonElement>('.js-toggle-view')?.addEventListener('click', () => {
      this.viewMode = this.viewMode === 'cards' ? 'map' : 'cards';
      this.renderResults();
    });

    this.resultsSlot.querySelector<HTMLFormElement>('.js-add-concept-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const extra = this.resultsSlot.querySelector<HTMLInputElement>('.js-add-concept-input')?.value.trim();
      if (extra) void this.runDiscovery(`${this.currentQuery} ${extra}`.trim(), true);
    });

    this.resultsSlot.querySelector<HTMLButtonElement>('.js-load-more')?.addEventListener('click', () => {
      void this.loadMore();
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-toggle-evidence').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.evidenceId;
        if (id) void this.toggleEvidenceDrawer(id);
      });
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-expand-node').forEach(btn => {
      btn.addEventListener('click', () => {
        const nid = btn.dataset.node;
        const lbl = btn.dataset.label || nid || '';
        if (nid) void this.handleExpandNode(nid, lbl);
      });
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-copy-path').forEach(btn => {
      btn.addEventListener('click', () => {
        const cid = btn.dataset.connId;
        const conn = this.result?.strongest_connections.find(x => x.connection_id === cid);
        if (conn) {
          this.copyPathText(conn);
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy path'; }, 1400);
        }
      });
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-nav-passage').forEach(btn => {
      btn.addEventListener('click', () => {
        const book = Number(btn.dataset.book);
        const chapter = Number(btn.dataset.chapter);
        const verse = Number(btn.dataset.verse);
        const strongs = btn.dataset.strongs || undefined;
        if (book && chapter && verse) {
          this.awayFromDiscovery = true;
          this.renderReturnBar();
          this.callbacks.onNavigatePassage(book, chapter, verse, strongs);
        }
      });
    });
  }
}
