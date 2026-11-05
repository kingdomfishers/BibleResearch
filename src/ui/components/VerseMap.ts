// @file: src/ui/components/VerseMap.ts
// @feature: verse-reader
// @tables: places | place_locations | verse_geography | passage_geography | geography_sources
// @candidates: none
// @toc: imports | types | ui:labels | ui:cards | ui:main | ui:controls | ui:sidebar | logic:load

// === @section:imports ===
import '../styles-map.css';
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage, GeographyLocation, GeographyRelationshipType, VerseGeographyPacket } from '../../api/types';
import { formatVerseRef } from '../utils';
import { type BasemapMode, createVerseMapCanvas } from './VerseMapCanvas';

// === @section:types ===
export interface VerseMapHandle {
  element: HTMLDetailsElement;
  load: (p: ActivePassage) => Promise<void>;
  focusPlace: (placeKey: string) => void;
}

// === @section:ui:labels ===
const relLabels: Record<GeographyRelationshipType, string> = {
  event_location: 'Direct Event Setting',
  contextual_location: 'Narrative Context Setting',
  audience_location: 'Written To / For (Recipient Setting)',
  composition_location: 'Written From (Place of Writing)',
  mentioned_location: 'Mentioned Place (Not Event Setting)',
  travel_origin: 'Travel Origin',
  travel_destination: 'Travel Destination',
  uncertain_location: 'Uncertain / Disputed Route',
};
const statusLabels: Record<VerseGeographyPacket['resolution_status'], string> = {
  direct_event_location: 'Tier 1 · Direct Event Setting',
  passage_context: 'Tier 2 · Narrative / Provenance Context',
  event_metadata: 'Tier 3 · Event Metadata Context',
  regional_context: 'Tier 4 · Regional Setting',
  symbolic_non_physical: 'Tier 5 · Symbolic / Non-Physical',
  unknown: 'Tier 5 · No Established Location',
};

// === @section:ui:cards ===
function renderPlaceCard(
  loc: GeographyLocation,
  selectedAltIds: Record<string, string>,
  onFocus: (placeKey: string, altId?: string) => void,
  onPickAlt: (placeKey: string, altId: string) => void,
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'verse-map-place-card';
  card.dataset.placeKey = loc.place_key;
  const activeAltId = selectedAltIds[loc.place_key] ?? loc.alternative_locations[0]?.id;
  const activeAlt = loc.alternative_locations.find(a => a.id === activeAltId);
  const origScript = [loc.hebrew_name, loc.greek_name].filter(Boolean).join(' · ');
  const ancientLabel = loc.ancient_name ?? loc.biblical_name;
  const modernLabel = activeAlt?.modern_name ?? loc.modern_name ?? (loc.is_non_physical ? 'Symbolic / Heavenly (Non-GPS)' : 'Regional Area');
  const lat = activeAlt?.latitude ?? loc.latitude;
  const lon = activeAlt?.longitude ?? loc.longitude;
  const coordText = lat != null && lon != null
    ? `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`
    : (loc.geometry ? `${loc.geometry.type} region` : 'No physical coordinates');
  card.innerHTML = `<div class="place-card-header">
    <div><button type="button" class="place-card-title">${loc.biblical_name}${origScript ? ` <span style="font-weight:400;color:var(--gold-light)">(${origScript})</span>` : ''}</button>
    <div class="place-card-ancient">Ancient Era Name: <strong>${ancientLabel}</strong></div>
    <div class="place-card-modern">Modern: <strong>${modernLabel}</strong> · ${coordText}</div></div></div>
    <div class="place-pills">
      <span class="place-pill rel-${loc.relationship_type}">${relLabels[loc.relationship_type]}</span>
      <span class="place-pill conf-${loc.confidence_level}">${loc.confidence_level} · ${activeAlt?.confidence_label ?? loc.confidence_label}</span>
      ${loc.is_inferred ? '<span class="place-pill">Context / Provenance</span>' : '<span class="place-pill">Explicit in Verse</span>'}
    </div>
    <p class="place-evidence">${loc.evidence_explanation}</p>
    <div class="place-refs">Establishing reference: <strong>${loc.establishing_refs}</strong>${loc.passage_title ? ` (${loc.passage_title})` : ''} · Source: ${loc.source.dataset}</div>`;
  card.querySelector<HTMLButtonElement>('.place-card-title')!.addEventListener('click', () => onFocus(loc.place_key, activeAlt?.id));
  if (loc.alternative_locations.length > 0) {
    const primaryCandidate = {
      id: loc.place_id, rank_order: 1, modern_name: loc.modern_name ?? loc.biblical_name,
      confidence_label: loc.confidence_label,
    };
    const candidates = loc.alternative_locations.some(a => a.rank_order === 1)
      ? loc.alternative_locations
      : [primaryCandidate, ...loc.alternative_locations];
    if (candidates.length > 1) {
      const chosenId = activeAlt?.id ?? primaryCandidate.id;
      const altWrap = document.createElement('div');
      altWrap.className = 'place-alternatives';
      altWrap.innerHTML = `<span class="place-alternatives-title">Proposed Identifications (${candidates.length} scholarly candidates):</span>
        <div class="alt-buttons">${candidates.map(alt => `<button type="button" class="alt-btn ${alt.id === chosenId ? 'active' : ''}" data-alt="${alt.id}">
          #${alt.rank_order} ${alt.modern_name} (${alt.confidence_label})</button>`).join('')}</div>`;
      altWrap.querySelectorAll<HTMLButtonElement>('.alt-btn').forEach(btn => {
        btn.addEventListener('click', () => onPickAlt(loc.place_key, btn.getAttribute('data-alt')!));
      });
      card.append(altWrap);
    }
  }
  return card;
}

// === @section:ui:main ===
export function createVerseMap(onResolved?: (packet: VerseGeographyPacket | null) => void): VerseMapHandle {
  const element = document.createElement('details');
  element.className = 'verse-map-panel';
  element.open = false;
  element.setAttribute('aria-label', 'Biblical Geography Map');
  element.innerHTML = `<summary class="verse-map-summary">
    <div class="verse-map-summary-title"><p class="eyebrow"><span class="gold-line"></span> CONTEXT-AWARE BIBLICAL GEOGRAPHY</p>
    <h2>Where this passage unfolds &amp; was written</h2></div>
    <div class="verse-map-summary-meta">
      <span class="verse-map-era-pill" id="map-era-pill">Era: Resolving…</span>
      <span class="verse-map-badge" id="map-status-badge" data-status="unknown">Loading geography…</span>
      <span class="verse-map-toggle-hint">Toggle Map ▾</span>
    </div></summary>
    <div class="verse-map-body"><div class="verse-map-stage">
      <div class="verse-map-toolbar">
        <button type="button" class="verse-map-btn" id="btn-fit-map">Reset Viewport</button>
        <div class="verse-map-mode-group" role="group" aria-label="Basemap Mode">
          <button type="button" class="verse-map-btn mode-btn active" data-mode="hybrid" id="btn-toggle-osm">Historical + Modern</button>
          <button type="button" class="verse-map-btn mode-btn" data-mode="historical">Ancient Atlas</button>
          <button type="button" class="verse-map-btn mode-btn" data-mode="modern">Modern OpenStreetMap</button>
        </div>
        <button type="button" class="verse-map-btn active" id="btn-toggle-gazetteer" title="Show contemporary ancient biblical places of this chronological era">Era Places: On</button>
      </div>
      <div class="verse-map-canvas" id="verse-map-canvas"></div>
      <div class="verse-map-empty-overlay" id="verse-map-empty" hidden>
        <strong id="verse-map-empty-title">No reliable geographical location identified for this verse.</strong>
        <span id="verse-map-empty-sub">This passage has no established physical coordinate in verified scholarly sources.</span>
      </div>
      <div class="verse-map-legend" aria-label="Map Legend">
        <span><i class="legend-dot established"></i> Event / Setting</span>
        <span><i class="legend-dot audience"></i> Written To</span>
        <span><i class="legend-dot composition"></i> Written From</span>
        <span><i class="legend-dot disputed"></i> Disputed / Alt</span>
      </div></div>
      <div class="verse-map-sidebar" id="verse-map-sidebar"></div></div>
    <div class="verse-map-attribution">
      <span>Sources: <a href="https://www.openbible.info/geo/" target="_blank" rel="noopener noreferrer">OpenBible.info</a> (CC BY 4.0) ·
      <a href="https://github.com/robertrouse/theographic-bible-metadata" target="_blank" rel="noopener noreferrer">Theographic</a> (CC BY-SA 4.0) ·
      <a href="https://github.com/STEPBible/STEPBible-Data" target="_blank" rel="noopener noreferrer">STEPBible TIPNR</a> (CC BY 4.0) ·
      <a href="https://pleiades.stoa.org" target="_blank" rel="noopener noreferrer">Pleiades</a> (CC BY 3.0)</span>
      <span>Basemap: <a href="https://dh.gu.se/dare/" target="_blank" rel="noopener noreferrer">DARE / Pelagios Ancient World Tiles</a> (CC BY-SA 3.0) · Natural Earth (CC0) · © OpenStreetMap contributors (ODbL)</span>
    </div>`;
  const badge = element.querySelector<HTMLElement>('#map-status-badge')!;
  const eraPill = element.querySelector<HTMLElement>('#map-era-pill')!;
  const canvasEl = element.querySelector<HTMLElement>('#verse-map-canvas')!;
  const emptyOverlay = element.querySelector<HTMLElement>('#verse-map-empty')!;
  const emptyTitle = element.querySelector<HTMLElement>('#verse-map-empty-title')!;
  const emptySub = element.querySelector<HTMLElement>('#verse-map-empty-sub')!;
  const sidebar = element.querySelector<HTMLElement>('#verse-map-sidebar')!;
  let currentPacket: VerseGeographyPacket | null = null;
  let selectedAltIds: Record<string, string> = {};
  let gazetteerOn = true;
  const canvas = createVerseMapCanvas(canvasEl, placeKey => {
    sidebar.querySelectorAll('.verse-map-place-card').forEach(el => {
      el.classList.toggle('active', (el as HTMLElement).dataset.placeKey === placeKey);
    });
  });
  // === @section:ui:controls ===
  let pendingFocus: string | null = null;
  element.addEventListener('toggle', () => {
    if (element.open) { void canvas.renderPacket(currentPacket, selectedAltIds).then(() => {
      canvas.resize(); if (pendingFocus) canvas.focusPlace(pendingFocus);
    }); }
  });
  element.querySelector('#btn-fit-map')!.addEventListener('click', () => { void canvas.renderPacket(currentPacket, selectedAltIds); });
  element.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = (btn.dataset.mode ?? 'hybrid') as BasemapMode;
      element.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      await canvas.setBasemapMode(mode);
    });
  });
  const gazBtn = element.querySelector<HTMLButtonElement>('#btn-toggle-gazetteer')!;
  gazBtn.addEventListener('click', async () => {
    gazetteerOn = !gazetteerOn;
    gazBtn.classList.toggle('active', gazetteerOn);
    gazBtn.textContent = `Era Places: ${gazetteerOn ? 'On' : 'Off'}`;
    await canvas.setEraGazetteerVisible(gazetteerOn);
  });

  // === @section:ui:sidebar ===
  function renderSidebar(packet: VerseGeographyPacket, p: ActivePassage) {
    sidebar.innerHTML = '';
    const ref = formatVerseRef(p);
    if (packet.chronological_context) {
      const eraBox = document.createElement('div');
      eraBox.className = 'verse-map-era-box';
      eraBox.innerHTML = `<strong>Historical Map Period: ${packet.chronological_context.era_label}</strong>
        <span>Chronology of ${ref}: <em>${packet.chronological_context.date_label}</em> · Ancient place names synchronized to this period.</span>`;
      sidebar.append(eraBox);
    }
    for (const ctx of packet.passage_contexts.slice(0, 2)) {
      const box = document.createElement('div');
      box.className = 'verse-map-context-box';
      box.innerHTML = `<strong>Context: ${ctx.title} (${ctx.evidence_refs})</strong>
        <span>${ctx.evidence_explanation}</span>`;
      sidebar.append(box);
    }
    if (packet.locations.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'chronology-muted';
      msg.textContent = packet.message || 'No reliable geographical location identified for this verse.';
      sidebar.append(msg);
      return;
    }
    for (const loc of packet.locations) {
      sidebar.append(renderPlaceCard(
        loc,
        selectedAltIds,
        (placeKey, altId) => canvas.focusPlace(placeKey, altId),
        (placeKey, altId) => {
          selectedAltIds[placeKey] = altId;
          renderSidebar(packet, p);
          void canvas.renderPacket(packet, selectedAltIds);
          canvas.focusPlace(placeKey, altId);
        },
      ));
    }
    const footer = document.createElement('p');
    footer.className = 'place-refs';
    footer.textContent = `Resolved ${packet.locations.length} geographical link(s) for ${ref}.`;
    sidebar.append(footer);
  }

  // === @section:logic:load ===
  let generation = 0;
  async function load(p: ActivePassage) {
    const current = ++generation;
    selectedAltIds = {};
    badge.textContent = `Resolving ${formatVerseRef(p)}…`;
    const res = await BibleRPC.getVerseGeography(p);
    if (current !== generation) return;
    if (!res.data || res.data.status !== 'ok') {
      onResolved?.(null);
      currentPacket = null;
      badge.dataset.status = 'unknown';
      badge.textContent = 'Geography unavailable';
      eraPill.textContent = 'Era: Unavailable';
      emptyOverlay.hidden = false;
      emptyTitle.textContent = 'No reliable geographical location identified for this verse.';
      emptySub.textContent = res.error ?? 'Geography could not be loaded.';
      sidebar.innerHTML = `<p class="chronology-muted">${res.error ?? 'No reliable geographical location identified for this verse.'}</p>`;
      if (element.open) await canvas.renderPacket(null, {});
      return;
    }
    const packet = res.data;
    onResolved?.(packet);
    currentPacket = packet;
    badge.dataset.status = packet.resolution_status;
    if (packet.chronological_context) {
      eraPill.textContent = `${packet.chronological_context.era_label} (${packet.chronological_context.date_label})`;
    }
    const primaryPlace = packet.locations.find(l => l.relationship_type !== 'mentioned_location') ?? packet.locations[0];
    badge.textContent = primaryPlace
      ? `${statusLabels[packet.resolution_status]} · ${primaryPlace.biblical_name}`
      : statusLabels[packet.resolution_status];
    if (!packet.has_physical_location) {
      emptyOverlay.hidden = false;
      emptyTitle.textContent = 'No reliable geographical location identified for this verse.';
      emptySub.textContent = packet.message ?? 'Symbolic, heavenly, or non-geographical passage — no physical GPS marker is fabricated.';
    } else {
      emptyOverlay.hidden = true;
    }
    renderSidebar(packet, p);
    if (element.open) {
      await canvas.renderPacket(packet, selectedAltIds);
      if (pendingFocus) canvas.focusPlace(pendingFocus);
    }
  }
  return { element, load, focusPlace: (placeKey: string) => {
    pendingFocus = placeKey; element.open = true;
    if (currentPacket) void canvas.renderPacket(currentPacket, selectedAltIds).then(() => canvas.focusPlace(placeKey));
    element.scrollIntoView({ block: 'start' }); element.querySelector('summary')?.focus();
  } };
}
