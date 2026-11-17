/**
 * R10 / R11 Discover Connections UI Component
 * Accessible from main workspace header & WordInspector.
 * Persistent search form (never destroys <input> focus/keyboard on Android),
 * separate autocomplete & results slots, subclusters + bridges, bounded SVG map,
 * evidence inspection, passage click-through with return history, filters, iterative modes,
 * and node expansion.
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
  R10ResolvedConcept,
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
  { label: 'Lily (שׁוֹשָׁן H7799 / κρίνον G2918)', insert: 'Lily', hint: 'Passover · Temple · Song of Songs · Matt 6:28' },
  { label: 'Hyssop (אֵזוֹב H231 / ὕσσωπος G5301)', insert: 'Hyssop', hint: 'Exod 12:22 · Lev 14 · Ps 51:7 · John 19:29' },
  { label: 'Pomegranate (רִמּוֹן H7416 / ῥόα)', insert: 'Pomegranate', hint: 'Priestly hem · Temple pillars · Promised Land' },
  { label: 'Cedar (אֶרֶז H730 / κέδρος)', insert: 'Cedar', hint: 'Lebanon · Cleansing ritual · Temple construction' },
  { label: 'Water Spirit (ruach over waters)', insert: 'Water Spirit', hint: 'Gen 1:2 · Ezek 36:25-27 · John 3:5' },
  { label: 'Oil Lampstand (menorah & shemen)', insert: 'Oil Lampstand', hint: 'Exod 25:31 · Zech 4:2 · Rev 1:12' },
  { label: 'Blood Door (Passover typology)', insert: 'Blood Door', hint: 'Exod 12:7,13 · John 10:9 · Heb 10:19-20' },
  { label: 'Tree of Life (עֵץ הַחַיִּים)', insert: 'Tree Life', hint: 'Gen 2:9 · Prov 3:18 · Rev 22:2' },
  { label: 'ruach, spirit, seven, eyes, lamps...', insert: 'ruach, spirit, seven, eyes, lamps, menorah, oil, water, wind, directions', hint: 'Zech 4:2,10 · Rev 4:5 · Rev 5:6' },
  { label: 'Red Sea & baptism', insert: 'Red Sea baptism', hint: 'Exod 14 · 1 Cor 10:1-2' },
  { label: 'adam (אָדָם) & dam (דָּם)', insert: 'Adam dam', hint: 'Orthographic & wordplay test' },
  { label: 'adamah (אֲדָמָה ground)', insert: 'adamah', hint: 'Gen 2:7 paronomasia' },
  { label: 'ayin (עַיִן eye vs spring)', insert: 'ayin', hint: 'Homograph H5869' },
  { label: 'Passover lamb, door, blood, Jesus', insert: 'Passover door blood Jesus', hint: 'Exod 12 · 1 Cor 5:7 · John 19:36' },
  { label: 'Genesis 1 & Revelation 4', insert: 'Genesis 1 creation Revelation 4 seven spirits', hint: 'Creation & New Creation' },
];

const EXAMPLE_QUERIES = [
  { label: 'Lily', q: 'Lily' },
  { label: 'Hyssop', q: 'Hyssop' },
  { label: 'Pomegranate', q: 'Pomegranate' },
  { label: 'Cedar', q: 'Cedar' },
  { label: 'Water Spirit', q: 'Water Spirit' },
  { label: 'Oil Lampstand', q: 'Oil Lampstand' },
  { label: 'Blood Door', q: 'Blood Door' },
  { label: 'Tree Life', q: 'Tree Life' },
  { label: 'ruach, spirit, seven, eyes, lamps, menorah, oil, water, wind, directions', q: 'ruach, spirit, seven, eyes, lamps, menorah, oil, water, wind, directions' },
  { label: 'Red Sea & baptism', q: 'Red Sea baptism' },
  { label: 'Adam & dam', q: 'Adam dam' },
];

type FilterBucket = 'all' | 'explicit' | 'lexical' | 'xref' | 'motif' | 'orthographic';
type DiscoveryMode = 'discover' | 'expand' | 'bridge' | 'compare' | 'explain' | 'challenge';

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
  private currentMode: DiscoveryMode = 'discover';
  private currentClusterId: string | undefined = undefined;
  private focusLemma: string | undefined = undefined;
  private compareTargets: string[] | undefined = undefined;
  private viewMode: 'cards' | 'map' = 'cards';
  private loading = false;
  private errorMsg: string | null = null;
  private result: DiscoverConnectionsResult | null = null;
  private evidenceCache = new Map<string, ConnectionEvidenceResult>();
  private openEvidenceIds = new Set<string>();
  private previousStates: Array<{
    query: string;
    filter: FilterBucket;
    mode: DiscoveryMode;
    result: DiscoverConnectionsResult | null;
  }> = [];
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
        this.currentMode = prev.mode || 'discover';
        this.result = prev.result;
        this.awayFromDiscovery = false;
        this.renderResults();
      }
    });
  }

  public async runDiscovery(queryText: string, pushHistory = true): Promise<void> {
    const clean = queryText.trim();
    if (!clean) return;
    if (pushHistory && this.result && this.currentQuery && (this.currentQuery !== clean || this.currentMode !== 'discover')) {
      this.previousStates.push({
        query: this.currentQuery,
        filter: this.activeFilter,
        mode: this.currentMode,
        result: this.result,
      });
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
      mode: this.currentMode,
      cluster_id: this.currentClusterId,
      focus_lemma: this.focusLemma,
      compare_targets: this.compareTargets,
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

  private buildFilterPayload(): { max_tier?: R10EvidenceTier; predicates?: R10Predicate[] } | undefined {
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
      mode: this.currentMode,
      cluster_id: this.currentClusterId,
      focus_lemma: this.focusLemma,
      compare_targets: this.compareTargets,
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

  private async loadMoreOccurrences(cursor: string): Promise<void> {
    if (!this.result?.iterative_analysis?.lemma_occurrences || this.loading) return;
    this.loading = true;
    this.renderResults();
    const strongs = this.result.iterative_analysis.lemma_occurrences.strongs;
    const res = await discoverBiblicalConnectionsRpc({
      query: this.currentQuery,
      mode: 'expand',
      focus_lemma: strongs,
      cluster_id: this.currentClusterId,
      cursor,
      limit: 10,
    });
    this.loading = false;
    if (res.data?.iterative_analysis?.lemma_occurrences) {
      const nextOcc = res.data.iterative_analysis.lemma_occurrences;
      const currentOcc = this.result.iterative_analysis.lemma_occurrences;
      this.result.iterative_analysis.lemma_occurrences = {
        ...nextOcc,
        passages: [...new Map([...currentOcc.passages, ...nextOcc.passages].map(p => [p.verse_id, p])).values()],
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
      this.previousStates.push({
        query: this.currentQuery,
        filter: this.activeFilter,
        mode: this.currentMode,
        result: this.result,
      });
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

  private renderConceptResolution(rcs: R10ResolvedConcept[]): string {
    const hasAnyResolved = rcs.some(r => r.matched);
    if (!hasAnyResolved && rcs.length === 0) return '';

    return `
      <div class="discover-resolution-section">
        ${this.focusLemma ? `
          <div class="discover-focus-banner">
            <span>Filtered to original-language lemma: <strong>${esc(this.focusLemma)}</strong></span>
            <button type="button" class="study-button js-clear-focus">Clear filter (show all lemmas)</button>
          </div>
        ` : ''}
        <div class="discover-concepts-grid">
          ${rcs.map(rc => {
            const hasMultipleLemmas = rc.lemmas.length > 1;
            return `
              <div class="discover-concept-card ${rc.matched ? '' : 'is-unresolved'}">
                <div class="discover-concept-header">
                  <span class="discover-lemma-pill ${rc.matched ? '' : 'is-unresolved'}">
                    <strong>${esc(rc.input_token)}</strong>
                    <span class="study-muted">→ ${rc.matched ? esc(rc.resolution_kind.replace(/_/g, ' ')) : 'unresolved'}</span>
                  </span>
                  ${rc.entity_kind ? `<span class="discover-badge">${esc(rc.entity_kind.replace(/_/g, ' '))}</span>` : ''}
                  ${rc.total_verses !== undefined ? `<span class="study-muted">${rc.total_verses} verse(s)</span>` : ''}
                </div>

                ${rc.lemmas.length > 0 ? `
                  <div class="discover-lemmas-row">
                    ${rc.lemmas.map(l => {
                      const isFocused = this.focusLemma === l.strongs;
                      return `
                        <div class="discover-resolved-lemma">
                          <span class="original-script" dir="${l.language === 'hbo' ? 'rtl' : 'ltr'}">${esc(l.lemma_script)}</span>
                          <strong>${esc(l.transliteration)}</strong>
                          <span class="study-muted">(${esc(l.strongs)})</span>
                          <em>"${esc(l.gloss)}"${l.sense_note ? ` · ${esc(l.sense_note)}` : ''}</em>
                          ${hasMultipleLemmas || rcs.length > 1 ? `
                            <button type="button" class="discover-chip js-focus-lemma ${isFocused ? 'is-active' : ''}" data-focus-lemma="${esc(l.strongs || l.lemma_key || '')}">
                              ${isFocused ? '✓ Focused' : `Focus ${esc(l.lemma_script)} (${esc(l.strongs)})`}
                            </button>
                          ` : ''}
                        </div>
                      `;
                    }).join('')}
                  </div>
                ` : ''}

                ${rc.forms && rc.forms.length > 0 ? `
                  <div class="discover-forms-row">
                    <span class="study-muted">Attested surface forms:</span>
                    ${rc.forms.slice(0, 5).map(f => `
                      <span class="discover-form-tag" title="${esc(f.gl)} (${f.cnt}x)">
                        <strong>${esc(f.sf)}</strong> <em>${esc(f.tr)}</em> (${f.cnt})
                      </span>
                    `).join(' ')}
                  </div>
                ` : ''}

                ${rc.sense_candidates && rc.sense_candidates.length > 0 ? `
                  <div class="discover-senses-row">
                    <span class="study-muted">Senses:</span>
                    ${rc.sense_candidates.slice(0, 4).map(s => `
                      <span class="discover-sense-tag">${esc(s.gl)}${s.note ? ` <small class="study-muted">(${esc(s.note)})</small>` : ''}</span>
                    `).join('; ')}
                  </div>
                ` : ''}

                ${rc.homograph_siblings && rc.homograph_siblings.length > 0 ? `
                  <div class="discover-homograph-box">
                    <span class="study-muted">Excluded homograph sibling(s):</span>
                    ${rc.homograph_siblings.map(h => `
                      <span class="discover-homograph-item">
                        <strong>${esc(h.bs)}</strong> ${esc(h.sc)} (<em>${esc(h.tr)}</em> — "${esc(h.gl)}")
                      </span>
                    `).join(' · ')}
                  </div>
                ` : ''}

                ${rc.ambiguity_note ? `
                  <p class="discover-uncertainty" style="margin:4px 0 0"><small>${esc(rc.ambiguity_note)}</small></p>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  private renderClusters(res: DiscoverConnectionsResult): string {
    if (this.viewMode !== 'map' && res.clusters.length < 1) return '';

    return `
      <div class="discover-section">
        <h3>Concept Subclusters & Evidence Clusters (${res.clusters.length})</h3>
        <div class="discover-clusters-grid">
          ${res.clusters.map(cl => `
            <div class="discover-cluster-card">
              <div class="discover-cluster-header">
                <h4>${esc(cl.label)}</h4>
                ${cl.category ? `<span class="discover-badge">${esc(cl.category.replace(/_/g, ' '))}</span>` : ''}
                ${cl.total_passages !== undefined ? `<span class="study-muted">${cl.total_passages} passage(s)</span>` : ''}
              </div>
              <p class="study-muted">${esc(cl.summary)}</p>
              ${cl.uncertainty_note ? `<p class="discover-uncertainty">${esc(cl.uncertainty_note)}</p>` : ''}

              ${cl.passages && cl.passages.length > 0 ? `
                <div class="discover-chips-row">
                  <span class="study-muted">Passages:</span>
                  ${cl.passages.slice(0, 8).map(p => {
                    const label = p.mt_ref ? `${p.ref} [MT ${p.mt_ref}]` : p.ref;
                    return `<button type="button" class="discover-chip js-nav-passage" data-book="${p.book}" data-chapter="${p.chapter}" data-verse="${p.verse}">${esc(label)}</button>`;
                  }).join('')}
                </div>
              ` : ''}

              ${cl.collocated_words && cl.collocated_words.length > 0 ? `
                <div class="discover-chips-row">
                  <span class="study-muted">Collocations:</span>
                  ${cl.collocated_words.slice(0, 6).map(w => `
                    <button type="button" class="discover-chip js-inspect-word" data-strongs="${esc(w.bs)}" title="${esc(w.tr)} (${esc(w.gl)}) · ${w.hits} hits">
                      <strong>${esc(w.sc)}</strong> <small>${esc(w.bs)} ${esc(w.gl)} (${w.hits})</small>
                    </button>
                  `).join('')}
                </div>
              ` : ''}

              <div class="discover-cluster-actions" style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <button type="button" class="study-button js-expand-cluster" data-cluster-id="${esc(cl.cluster_id)}">Expand cluster</button>
                ${cl.anchor_nodes.map(n => `<button type="button" class="discover-chip js-expand-node" data-node="${esc(n.id)}" data-label="${esc(n.label)}">${esc(n.label)}</button>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        ${res.bridges.map(b => `<div class="discover-bridge-banner"><strong>Bridge:</strong> ${esc(b.explanation)}</div>`).join('')}
        ${this.viewMode === 'map' ? this.renderLightweightMap(res) : ''}
      </div>
    `;
  }

  private renderIterativeAnalysis(ia: NonNullable<DiscoverConnectionsResult['iterative_analysis']>): string {
    const occ = ia.lemma_occurrences;
    const bridges = ia.bridges || [];
    const comp = ia.comparison;
    const challenges = ia.challenges || [];

    return `
      <div class="discover-section discover-iterative-panel">
        <div class="discover-iterative-header">
          <h3>Iterative Analysis: <span class="discover-badge is-mode">${esc(ia.mode.toUpperCase())}</span></h3>
          ${ia.mode !== 'discover' ? `<button type="button" class="study-button js-reset-mode">Reset to standard discovery</button>` : ''}
        </div>
        ${ia.explanation ? `<p class="discover-conn-summary">${esc(ia.explanation)}</p>` : ''}

        ${occ && occ.passages.length > 0 ? `
          <div class="discover-occurrences-box">
            <h4>Canonical Witnesses for ${esc(occ.strongs)} <span class="study-muted">(${occ.passages.length} of ${occ.total_verses} total verses)</span></h4>
            <div class="discover-chips-row">
              ${occ.passages.map(p => {
                const label = p.mt_ref ? `${p.ref} [MT ${p.mt_ref}]` : p.ref;
                return `<button type="button" class="discover-chip js-nav-passage" data-book="${p.book}" data-chapter="${p.chapter}" data-verse="${p.verse}">${esc(label)}</button>`;
              }).join('')}
            </div>
            ${occ.has_more && occ.next_cursor ? `
              <div style="margin-top:8px">
                <button type="button" class="study-button js-load-more-occurrences" data-cursor="${esc(occ.next_cursor)}">Load next occurrences</button>
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${comp ? `
          <div class="discover-comparison-box">
            <h4>Comparative Analysis</h4>
            ${comp.targets ? `<p><strong>Targets:</strong> ${esc(Array.isArray(comp.targets) ? comp.targets.join(', ') : String(comp.targets))}</p>` : ''}
            ${comp.differences ? `<p class="study-muted">${esc(comp.differences)}</p>` : ''}
            ${Array.isArray(comp.clusters) && comp.clusters.length > 0 ? `
              <div class="discover-chips-row">
                <span class="study-muted">Clusters compared:</span>
                ${comp.clusters.map((c: any) => `<span class="discover-badge">${esc(c.label || c.id)} (${c.passages_count ?? 0} passages)</span>`).join(' ')}
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${bridges.length > 0 ? `
          <div class="discover-bridges-box">
            <h4>Conceptual Bridges</h4>
            ${bridges.map((b: any) => `
              <div class="discover-bridge-banner">
                <strong>Bridge ${b.bridging_node?.label ? `(${esc(b.bridging_node.label)}):` : ':'}</strong> ${esc(b.explanation || b.summary || '')}
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${challenges.length > 0 ? `
          <div class="discover-challenges-box">
            <h4>Controls & Challenge Analysis</h4>
            ${challenges.map(ctrl => `
              <div class="discover-control-item">
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
                  <span class="discover-badge is-caution">${esc(ctrl.kind.replace(/_/g, ' '))}</span>
                  <strong>${esc(ctrl.title)}</strong>
                </div>
                <p style="margin:2px 0 0">${esc(ctrl.explanation)}</p>
                ${ctrl.passages && ctrl.passages.length > 0 ? `
                  <div class="discover-chips-row" style="margin-top:6px">
                    ${ctrl.passages.map(p => `<button type="button" class="discover-chip js-nav-passage" data-book="${p.book}" data-chapter="${p.chapter}" data-verse="${p.verse}">${esc(p.ref)}</button>`).join('')}
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
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
        ${c.query_support ? `<p class="study-muted">Query support: ${esc(c.query_support.replace(/_/g, ' '))}${c.shared_witness_refs?.length ? ` · ${esc(c.shared_witness_refs.join(', '))}` : ''}</p>` : ''}
        ${c.ranking_rationale?.why_ranked_high ? `
          <p class="discover-ranking-rationale"><span class="study-muted">Ranking rationale:</span> ${esc(c.ranking_rationale.why_ranked_high)}</p>
        ` : ''}
        <p class="discover-uncertainty">${esc(c.uncertainty_note)}</p>
        <div class="discover-chips-row">
          ${c.passages.map(p => {
            const label = p.mt_ref ? `${p.ref} [MT ${p.mt_ref}]` : p.ref;
            return `<button type="button" class="discover-chip js-nav-passage" data-book="${p.book}" data-chapter="${p.chapter}" data-verse="${p.verse}" data-strongs="${esc(c.original_words[0]?.strongs || '')}">${esc(label)} (${p.testament})</button>`;
          }).join('')}
          ${c.original_words.map(w => `<button type="button" class="discover-chip js-expand-node" data-node="lemma:${esc(w.strongs || w.transliteration)}" data-label="${esc(w.transliteration || w.gloss)}">${esc(w.lemma_script)} ${esc(w.transliteration)} (${esc(w.gloss)})</button>`).join('')}
        </div>
        <div class="discover-conn-actions">
          <button type="button" class="study-button js-toggle-evidence" data-evidence-id="${esc(c.evidence_id)}">${isOpen ? 'Hide evidence' : 'Inspect biblical evidence'}</button>
          <button type="button" class="study-button js-copy-path" data-conn-id="${esc(c.connection_id)}">Copy path</button>
          <button type="button" class="study-button js-card-bridge" data-conn-id="${esc(c.connection_id)}" data-concepts="${esc(c.matched_concepts.join(' '))}">Bridge</button>
          <button type="button" class="study-button js-card-compare" data-conn-id="${esc(c.connection_id)}" data-concepts="${esc(c.matched_concepts.join(' '))}">Compare</button>
          <button type="button" class="study-button js-card-challenge" data-conn-id="${esc(c.connection_id)}">Challenge</button>
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
          const mtRefLabel = pd.passage.mt_ref ? ` [MT ${pd.passage.mt_ref}]` : '';
          const editionLabel = pd.passage.verse === 0 || pd.passage.is_psalm_heading
            ? '[Hebrew superscription gloss]'
            : (pd.english_edition ? `[${pd.english_edition}]` : '[WEB]');
          return `
            <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
              <button type="button" class="reference-link js-nav-passage" data-book="${pd.passage.book}" data-chapter="${pd.passage.chapter}" data-verse="${pd.passage.verse}">${esc(pd.passage.ref)}${esc(mtRefLabel)} → Open in Reader</button>
              ${pd.english_text ? `<p style="margin:4px 0;font-size:13px">${esc(pd.english_text)} <span class="study-muted">${esc(editionLabel)}</span></p>` : ''}
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
          <div class="discover-mode-bar">
            <span class="study-muted">Mode:</span>
            ${(['discover', 'bridge', 'compare', 'explain', 'challenge'] as const).map(m => `
              <button type="button" class="discover-chip ${this.currentMode === m ? 'is-active' : ''} js-switch-mode" data-mode="${m}">${m.charAt(0).toUpperCase() + m.slice(1)}</button>
            `).join('')}
          </div>

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
          ${this.currentMode !== 'discover' ? ` · <span class="discover-badge is-mode">Mode: ${esc(this.currentMode.toUpperCase())}</span>` : ''}
          ${this.currentClusterId ? ` · <span class="study-muted">Cluster: ${esc(this.currentClusterId)}</span>` : ''}
        </div>

        ${this.renderConceptResolution(res.parsed_query.resolved_concepts)}

        ${res.iterative_analysis ? this.renderIterativeAnalysis(res.iterative_analysis) : ''}

        ${this.renderClusters(res)}

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

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-switch-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.mode as DiscoveryMode;
        if (m) {
          this.currentMode = m;
          void this.runDiscovery(this.currentQuery, false);
        }
      });
    });

    this.resultsSlot.querySelector<HTMLButtonElement>('.js-reset-mode')?.addEventListener('click', () => {
      this.currentMode = 'discover';
      this.currentClusterId = undefined;
      this.compareTargets = undefined;
      void this.runDiscovery(this.currentQuery, false);
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-focus-lemma').forEach(btn => {
      btn.addEventListener('click', () => {
        const lemma = btn.dataset.focusLemma;
        if (lemma) {
          this.focusLemma = this.focusLemma === lemma ? undefined : lemma;
          void this.runDiscovery(this.currentQuery, false);
        }
      });
    });

    this.resultsSlot.querySelector<HTMLButtonElement>('.js-clear-focus')?.addEventListener('click', () => {
      this.focusLemma = undefined;
      void this.runDiscovery(this.currentQuery, false);
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-expand-cluster').forEach(btn => {
      btn.addEventListener('click', () => {
        const cid = btn.dataset.clusterId;
        if (cid) {
          this.currentClusterId = cid;
          this.currentMode = 'expand';
          void this.runDiscovery(this.currentQuery, true);
        }
      });
    });

    this.resultsSlot.querySelector<HTMLButtonElement>('.js-load-more-occurrences')?.addEventListener('click', e => {
      const cursor = (e.currentTarget as HTMLButtonElement).dataset.cursor;
      if (cursor) void this.loadMoreOccurrences(cursor);
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

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-card-bridge').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = 'bridge';
        const concepts = btn.dataset.concepts?.trim();
        if (concepts) {
          void this.runDiscovery(concepts, true);
        } else {
          void this.runDiscovery(this.currentQuery, true);
        }
      });
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-card-compare').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = 'compare';
        const concepts = btn.dataset.concepts?.trim().split(/\s+/).filter(Boolean);
        this.compareTargets = concepts && concepts.length > 0 ? concepts : undefined;
        void this.runDiscovery(this.currentQuery, true);
      });
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-card-challenge').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = 'challenge';
        void this.runDiscovery(this.currentQuery, true);
      });
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-inspect-word').forEach(btn => {
      btn.addEventListener('click', () => {
        const strongs = btn.dataset.strongs;
        if (strongs && this.callbacks.onInspectWordQuery) {
          this.callbacks.onInspectWordQuery(strongs);
        }
      });
    });

    this.resultsSlot.querySelectorAll<HTMLButtonElement>('.js-nav-passage').forEach(btn => {
      btn.addEventListener('click', () => {
        const book = Number(btn.dataset.book);
        const chapter = Number(btn.dataset.chapter);
        const verse = Number(btn.dataset.verse);
        const strongs = btn.dataset.strongs || undefined;
        if (Number.isFinite(book) && Number.isFinite(chapter) && Number.isFinite(verse) && book > 0 && chapter > 0 && verse >= 0) {
          this.awayFromDiscovery = true;
          this.renderReturnBar();
          this.callbacks.onNavigatePassage(book, chapter, verse, strongs);
        }
      });
    });
  }
}
