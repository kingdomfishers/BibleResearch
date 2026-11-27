// @file: src/ui/components/VerseMap.ts
// @feature: verse-reader
// @tables: places | place_locations | verse_geography | passage_geography | geography_sources
// @candidates: none
// @toc: imports | types | ui:labels | ui:lightbox | ui:cards | ui:main | ui:controls | ui:sidebar | logic:load

// === @section:imports ===
import '../styles-map.css';
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage, GeographyLocation, GeographyRelationshipType, VerseGeographyPacket } from '../../api/types';
import {
  type CuratedMediaAsset,
  getCommonsThumbnailUrl,
  getMediaForPlace,
  renderMediaFigure,
} from '../context-tools/curated-media-manifest';
import { formatVerseRef } from '../utils';
import { type BasemapMode, computeRouteStats, createVerseMapCanvas } from './VerseMapCanvas';

// === @section:types ===
export interface VerseMapHandle {
  element: HTMLDetailsElement;
  load: (p: ActivePassage) => Promise<void>;
  focusPlace: (placeKey: string) => void;
  getCurrentPacket: () => VerseGeographyPacket | null;
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

function attachLightDismissFallback(dialog: HTMLDialogElement): void {
  if ('closedBy' in HTMLDialogElement.prototype) return;
  let pressedOutside = false;
  const isOutside = (e: PointerEvent) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  dialog.addEventListener('pointerdown', e => {
    pressedOutside = isOutside(e);
  });
  dialog.addEventListener('pointerup', e => {
    if (pressedOutside && isOutside(e)) dialog.close();
  });
}

function createExternalAnchor(href: string, label: string, className?: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  if (className) a.className = className;
  return a;
}

function resolveExternalIdUrl(provider: string, rawVal: string): { label: string; url: string } | null {
  const val = rawVal.trim();
  if (!val) return null;
  if (val.startsWith('https://') || val.startsWith('http://')) {
    return { label: provider, url: val };
  }
  const key = provider.toLowerCase();
  if (key === 'pleiades') {
    const id = val.replace(/^pleiades:/i, '');
    return { label: `Pleiades (${id})`, url: `https://pleiades.stoa.org/places/${encodeURIComponent(id)}` };
  }
  if (key === 'openbible' || key === 'openbible_id') {
    return { label: `OpenBible (${val})`, url: `https://www.openbible.info/geo/places/${encodeURIComponent(val)}` };
  }
  if (key === 'wikidata') {
    return { label: `Wikidata (${val})`, url: `https://www.wikidata.org/wiki/${encodeURIComponent(val)}` };
  }
  if (key === 'geonames') {
    return { label: `GeoNames (${val})`, url: `https://www.geonames.org/${encodeURIComponent(val)}` };
  }
  return null;
}

// === @section:ui:lightbox ===
function createMediaLightbox(): (asset: CuratedMediaAsset) => void {
  let dialog: HTMLDialogElement | null = null;
  let titleEl: HTMLHeadingElement | null = null;
  let bodyEl: HTMLDivElement | null = null;

  function ensureDialog() {
    if (dialog && titleEl && bodyEl) return;
    dialog = document.createElement('dialog');
    dialog.className = 'media-lightbox-dialog';
    dialog.setAttribute('closedby', 'any');
    const titleId = `media-lightbox-title-${Math.random().toString(36).slice(2, 8)}`;
    dialog.setAttribute('aria-labelledby', titleId);

    const shell = document.createElement('div');
    shell.className = 'media-lightbox-shell';

    const header = document.createElement('header');
    header.className = 'media-lightbox-header';
    titleEl = document.createElement('h2');
    titleEl.id = titleId;
    titleEl.className = 'media-lightbox-title';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'verse-map-btn media-lightbox-close';
    closeBtn.textContent = 'Close ✕';
    closeBtn.addEventListener('click', () => dialog?.close());

    header.append(titleEl, closeBtn);

    bodyEl = document.createElement('div');
    bodyEl.className = 'media-lightbox-body';

    shell.append(header, bodyEl);
    dialog.append(shell);
    attachLightDismissFallback(dialog);
    document.body.append(dialog);
  }

  return (asset: CuratedMediaAsset) => {
    ensureDialog();
    if (!dialog || !titleEl || !bodyEl) return;
    titleEl.textContent = asset.title;
    bodyEl.replaceChildren();

    const frame = document.createElement('div');
    frame.className = 'media-lightbox-stage';

    const img = document.createElement('img');
    img.className = 'media-lightbox-img';
    img.src = getCommonsThumbnailUrl(asset.commonsFile, 1280);
    img.alt = asset.title;
    img.loading = 'eager';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';

    const fallback = document.createElement('div');
    fallback.className = 'curated-media-fallback';
    fallback.hidden = true;
    const fbStrong = document.createElement('strong');
    fbStrong.textContent = asset.title;
    const fbLink = createExternalAnchor(asset.sourceURL, 'Open full image on Wikimedia Commons ↗', 'curated-media-fallback-link');
    fallback.append(fbStrong, fbLink);

    img.addEventListener('error', () => {
      img.hidden = true;
      fallback.hidden = false;
    });
    frame.append(img, fallback);

    const badges = document.createElement('div');
    badges.className = 'curated-media-badges';
    for (const [text, cls] of [
      [asset.depictionType.replace('_', ' '), `curated-media-badge type-${asset.depictionType}`],
      [`Period: ${asset.depictsPeriod}`, 'curated-media-badge period'],
      [`Created: ${asset.creationDate}`, 'curated-media-badge period'],
      [asset.confidence, `curated-media-badge conf-${asset.confidence}`],
    ] as const) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      badges.append(span);
    }

    const caption = document.createElement('p');
    caption.className = 'media-lightbox-caption';
    caption.textContent = asset.caption;

    bodyEl.append(frame, badges, caption);

    if (asset.historicalNote) {
      const note = document.createElement('p');
      note.className = 'media-lightbox-note';
      note.textContent = asset.historicalNote;
      bodyEl.append(note);
    }

    if (asset.sourceRefs.length > 0) {
      const refs = document.createElement('div');
      refs.className = 'media-lightbox-meta';
      refs.textContent = `Biblical references: ${asset.sourceRefs.join(' · ')}`;
      bodyEl.append(refs);
    }

    const footer = document.createElement('div');
    footer.className = 'media-lightbox-meta';
    footer.append(
      document.createTextNode(`Creator: ${asset.creator} · License: `),
      createExternalAnchor(asset.licenseURL, asset.licenseAttribution),
      document.createTextNode(' · '),
      createExternalAnchor(asset.sourceURL, 'Wikimedia Commons File Page ↗'),
    );
    bodyEl.append(footer);

    if (!dialog.open) dialog.showModal();
  };
}

// === @section:ui:cards ===
function renderPlaceCard(
  loc: GeographyLocation,
  selectedAltIds: Record<string, string>,
  onFocus: (placeKey: string, altId?: string) => void,
  onPickAlt: (placeKey: string, altId: string) => void,
  onOpenLightbox: (asset: CuratedMediaAsset) => void,
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

  const header = document.createElement('div');
  header.className = 'place-card-header';
  const headerInfo = document.createElement('div');

  const titleBtn = document.createElement('button');
  titleBtn.type = 'button';
  titleBtn.className = 'place-card-title';
  titleBtn.textContent = loc.biblical_name;
  if (origScript) {
    const scriptSpan = document.createElement('span');
    scriptSpan.className = 'place-card-script';
    scriptSpan.textContent = ` (${origScript})`;
    titleBtn.append(scriptSpan);
  }
  titleBtn.addEventListener('click', () => onFocus(loc.place_key, activeAlt?.id));

  const ancientDiv = document.createElement('div');
  ancientDiv.className = 'place-card-ancient';
  ancientDiv.append(document.createTextNode('Ancient Era Name: '));
  const ancientStrong = document.createElement('strong');
  ancientStrong.textContent = ancientLabel;
  ancientDiv.append(ancientStrong);

  const modernDiv = document.createElement('div');
  modernDiv.className = 'place-card-modern';
  modernDiv.append(document.createTextNode('Modern: '));
  const modernStrong = document.createElement('strong');
  modernStrong.textContent = modernLabel;
  modernDiv.append(modernStrong, document.createTextNode(` · ${coordText}`));

  headerInfo.append(titleBtn, ancientDiv, modernDiv);
  header.append(headerInfo);

  const pills = document.createElement('div');
  pills.className = 'place-pills';

  const relPill = document.createElement('span');
  relPill.className = `place-pill rel-${loc.relationship_type}`;
  relPill.textContent = relLabels[loc.relationship_type];

  const confPill = document.createElement('span');
  confPill.className = `place-pill conf-${loc.confidence_level}`;
  confPill.textContent = `${loc.confidence_level} · ${activeAlt?.confidence_label ?? loc.confidence_label}`;

  const provPill = document.createElement('span');
  provPill.className = 'place-pill';
  provPill.textContent = loc.is_inferred ? 'Context / Provenance' : 'Explicit in Verse';

  pills.append(relPill, confPill, provPill);

  const evidenceP = document.createElement('p');
  evidenceP.className = 'place-evidence';
  evidenceP.textContent = loc.evidence_explanation;

  const refsDiv = document.createElement('div');
  refsDiv.className = 'place-refs';
  refsDiv.append(document.createTextNode('Establishing reference: '));
  const refsStrong = document.createElement('strong');
  refsStrong.textContent = loc.establishing_refs;
  refsDiv.append(refsStrong);
  if (loc.passage_title) {
    refsDiv.append(document.createTextNode(` (${loc.passage_title})`));
  }
  refsDiv.append(document.createTextNode(` · Source: ${loc.source.dataset}`));

  card.append(header, pills, evidenceP, refsDiv);

  const extEntries = Object.entries(loc.external_ids ?? {})
    .map(([provider, raw]) => (raw ? resolveExternalIdUrl(provider, raw) : null))
    .filter((entry): entry is { label: string; url: string } => entry !== null);
  if (extEntries.length > 0) {
    const extWrap = document.createElement('div');
    extWrap.className = 'place-external-links';
    for (const entry of extEntries) {
      extWrap.append(createExternalAnchor(entry.url, `${entry.label} ↗`, 'place-ext-link'));
    }
    card.append(extWrap);
  }

  const mediaMatches = getMediaForPlace(loc).slice(0, 2);
  if (mediaMatches.length > 0) {
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'place-media-card';
    for (const asset of mediaMatches) {
      mediaWrap.append(renderMediaFigure(asset, { compact: true, onOpenLightbox }));
    }
    card.append(mediaWrap);
  }

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

      const altTitle = document.createElement('span');
      altTitle.className = 'place-alternatives-title';
      altTitle.textContent = `Proposed Identifications (${candidates.length} scholarly candidates):`;

      const altButtons = document.createElement('div');
      altButtons.className = 'alt-buttons';
      for (const alt of candidates) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = alt.id === chosenId ? 'alt-btn active' : 'alt-btn';
        btn.dataset.alt = alt.id;
        btn.textContent = `#${alt.rank_order} ${alt.modern_name} (${alt.confidence_label})`;
        btn.addEventListener('click', () => onPickAlt(loc.place_key, alt.id));
        altButtons.append(btn);
      }
      altWrap.append(altTitle, altButtons);
      card.append(altWrap);
    }
  }
  return card;
}

// === @section:ui:main ===
export function createVerseMap(onResolved?: (packet: VerseGeographyPacket | null) => void): VerseMapHandle {
  const openMediaLightbox = createMediaLightbox();
  const element = document.createElement('details');
  element.className = 'verse-map-panel';
  element.open = false;
  element.setAttribute('aria-label', 'Biblical Geography Map');

  const summary = document.createElement('summary');
  summary.className = 'verse-map-summary';
  const summaryTitle = document.createElement('div');
  summaryTitle.className = 'verse-map-summary-title';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  const goldLine = document.createElement('span');
  goldLine.className = 'gold-line';
  eyebrow.append(goldLine, document.createTextNode(' CONTEXT-AWARE BIBLICAL GEOGRAPHY'));
  const heading = document.createElement('h2');
  heading.textContent = 'Where this passage unfolds & was written';
  summaryTitle.append(eyebrow, heading);

  const summaryMeta = document.createElement('div');
  summaryMeta.className = 'verse-map-summary-meta';
  const eraPill = document.createElement('span');
  eraPill.className = 'verse-map-era-pill';
  eraPill.textContent = 'Era: Resolving…';
  const badge = document.createElement('span');
  badge.className = 'verse-map-badge';
  badge.dataset.status = 'unknown';
  badge.textContent = 'Loading geography…';
  const toggleHint = document.createElement('span');
  toggleHint.className = 'verse-map-toggle-hint';
  toggleHint.textContent = 'Toggle Map ▾';
  summaryMeta.append(eraPill, badge, toggleHint);
  summary.append(summaryTitle, summaryMeta);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'verse-map-body';

  const stage = document.createElement('div');
  stage.className = 'verse-map-stage';

  const toolbar = document.createElement('div');
  toolbar.className = 'verse-map-toolbar';

  const fitBtn = document.createElement('button');
  fitBtn.type = 'button';
  fitBtn.className = 'verse-map-btn';
  fitBtn.id = 'btn-fit-map';
  fitBtn.textContent = 'Reset Viewport';

  const modeGroup = document.createElement('div');
  modeGroup.className = 'verse-map-mode-group';
  modeGroup.setAttribute('role', 'group');
  modeGroup.setAttribute('aria-label', 'Basemap Mode');
  const modeSpecs: { mode: BasemapMode; label: string; id?: string; active?: boolean }[] = [
    { mode: 'hybrid', label: 'Historical + Modern', id: 'btn-toggle-osm', active: true },
    { mode: 'historical', label: 'Ancient Atlas' },
    { mode: 'modern', label: 'Modern OpenStreetMap' },
  ];
  const modeButtons: HTMLButtonElement[] = [];
  for (const spec of modeSpecs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = spec.active ? 'verse-map-btn mode-btn active' : 'verse-map-btn mode-btn';
    btn.dataset.mode = spec.mode;
    if (spec.id) btn.id = spec.id;
    btn.textContent = spec.label;
    modeButtons.push(btn);
    modeGroup.append(btn);
  }

  const gazBtn = document.createElement('button');
  gazBtn.type = 'button';
  gazBtn.className = 'verse-map-btn active';
  gazBtn.id = 'btn-toggle-gazetteer';
  gazBtn.title = 'Show contemporary ancient biblical places of this chronological era';
  gazBtn.textContent = 'Era Places: On';

  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'verse-map-btn verse-map-expand-btn';
  expandBtn.id = 'btn-expand-map';
  expandBtn.textContent = 'Expand ⤢';

  toolbar.append(fitBtn, modeGroup, gazBtn, expandBtn);

  const canvasEl = document.createElement('div');
  canvasEl.className = 'verse-map-canvas';
  canvasEl.id = 'verse-map-canvas';

  const emptyOverlay = document.createElement('div');
  emptyOverlay.className = 'verse-map-empty-overlay';
  emptyOverlay.id = 'verse-map-empty';
  emptyOverlay.hidden = true;
  const emptyTitle = document.createElement('strong');
  emptyTitle.id = 'verse-map-empty-title';
  emptyTitle.textContent = 'No reliable geographical location identified for this verse.';
  const emptySub = document.createElement('span');
  emptySub.id = 'verse-map-empty-sub';
  emptySub.textContent = 'This passage has no established physical coordinate in verified scholarly sources.';
  emptyOverlay.append(emptyTitle, emptySub);

  const legend = document.createElement('div');
  legend.className = 'verse-map-legend';
  legend.setAttribute('aria-label', 'Map Legend');
  for (const [dotCls, text] of [
    ['established', 'Event / Setting'],
    ['audience', 'Written To'],
    ['composition', 'Written From'],
    ['disputed', 'Disputed / Alt'],
  ] as const) {
    const span = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = `legend-dot ${dotCls}`;
    span.append(dot, document.createTextNode(` ${text}`));
    legend.append(span);
  }

  stage.append(toolbar, canvasEl, emptyOverlay, legend);

  const sidebar = document.createElement('div');
  sidebar.className = 'verse-map-sidebar';
  sidebar.id = 'verse-map-sidebar';

  bodyEl.append(stage, sidebar);

  const attribution = document.createElement('div');
  attribution.className = 'verse-map-attribution';
  const sourcesSpan = document.createElement('span');
  sourcesSpan.append(
    document.createTextNode('Sources: '),
    createExternalAnchor('https://www.openbible.info/geo/', 'OpenBible.info'),
    document.createTextNode(' (CC BY 4.0) · '),
    createExternalAnchor('https://github.com/robertrouse/theographic-bible-metadata', 'Theographic'),
    document.createTextNode(' (CC BY-SA 4.0) · '),
    createExternalAnchor('https://github.com/STEPBible/STEPBible-Data', 'STEPBible TIPNR'),
    document.createTextNode(' (CC BY 4.0) · '),
    createExternalAnchor('https://pleiades.stoa.org', 'Pleiades'),
    document.createTextNode(' (CC BY 3.0)'),
  );
  const basemapSpan = document.createElement('span');
  basemapSpan.append(
    document.createTextNode('Basemap: '),
    createExternalAnchor('https://dh.gu.se/dare/', 'DARE / Pelagios Ancient World Tiles'),
    document.createTextNode(' (CC BY-SA 3.0) · Natural Earth (CC0) · © OpenStreetMap contributors (ODbL)'),
  );
  attribution.append(sourcesSpan, basemapSpan);

  element.append(summary, bodyEl, attribution);

  let currentPacket: VerseGeographyPacket | null = null;
  let selectedAltIds: Record<string, string> = {};
  let gazetteerOn = true;

  const canvas = createVerseMapCanvas(
    canvasEl,
    placeKey => {
      sidebar.querySelectorAll('.verse-map-place-card').forEach(el => {
        el.classList.toggle('active', (el as HTMLElement).dataset.placeKey === placeKey);
      });
    },
    openMediaLightbox,
  );

  // Expanded modal dialog wrapping .verse-map-body
  const mapDialog = document.createElement('dialog');
  mapDialog.className = 'map-popup-dialog';
  mapDialog.setAttribute('closedby', 'any');
  const mapDialogTitleId = `map-popup-title-${Math.random().toString(36).slice(2, 8)}`;
  mapDialog.setAttribute('aria-labelledby', mapDialogTitleId);

  const mapDialogShell = document.createElement('div');
  mapDialogShell.className = 'map-popup-shell';

  const mapDialogHeader = document.createElement('header');
  mapDialogHeader.className = 'map-popup-header';
  const mapDialogTitle = document.createElement('h2');
  mapDialogTitle.id = mapDialogTitleId;
  mapDialogTitle.className = 'map-popup-title';
  mapDialogTitle.textContent = 'Where this passage unfolds & was written';
  const mapDialogClose = document.createElement('button');
  mapDialogClose.type = 'button';
  mapDialogClose.className = 'verse-map-btn map-popup-close';
  mapDialogClose.textContent = 'Close ✕';
  mapDialogHeader.append(mapDialogTitle, mapDialogClose);

  const mapDialogBody = document.createElement('div');
  mapDialogBody.className = 'map-popup-body';

  mapDialogShell.append(mapDialogHeader, mapDialogBody);
  mapDialog.append(mapDialogShell);
  attachLightDismissFallback(mapDialog);
  document.body.append(mapDialog);

  mapDialogClose.addEventListener('click', () => mapDialog.close());
  mapDialog.addEventListener('close', () => {
    element.insertBefore(bodyEl, attribution);
    expandBtn.hidden = false;
    canvas.resize();
    requestAnimationFrame(() => canvas.resize());
    if (expandBtn.isConnected) expandBtn.focus();
  });

  // === @section:ui:controls ===
  let pendingFocus: string | null = null;
  element.addEventListener('toggle', () => {
    if (element.open) {
      void canvas.renderPacket(currentPacket, selectedAltIds).then(() => {
        canvas.resize();
        if (pendingFocus) canvas.focusPlace(pendingFocus);
      });
    }
  });
  fitBtn.addEventListener('click', () => {
    void canvas.renderPacket(currentPacket, selectedAltIds);
  });
  for (const btn of modeButtons) {
    btn.addEventListener('click', async () => {
      const mode = (btn.dataset.mode ?? 'hybrid') as BasemapMode;
      modeButtons.forEach(b => b.classList.toggle('active', b === btn));
      await canvas.setBasemapMode(mode);
    });
  }
  gazBtn.addEventListener('click', async () => {
    gazetteerOn = !gazetteerOn;
    gazBtn.classList.toggle('active', gazetteerOn);
    gazBtn.textContent = `Era Places: ${gazetteerOn ? 'On' : 'Off'}`;
    await canvas.setEraGazetteerVisible(gazetteerOn);
  });
  expandBtn.addEventListener('click', () => {
    if (mapDialog.open) return;
    mapDialogTitle.textContent = currentPacket
      ? `Biblical Geography · ${formatVerseRef(currentPacket.passage)}`
      : 'Where this passage unfolds & was written';
    mapDialogBody.append(bodyEl);
    expandBtn.hidden = true;
    mapDialog.showModal();
    void canvas.renderPacket(currentPacket, selectedAltIds).then(() => {
      canvas.resize();
      requestAnimationFrame(() => canvas.resize());
    });
  });

  // === @section:ui:sidebar ===
  function renderSidebar(packet: VerseGeographyPacket, p: ActivePassage) {
    sidebar.replaceChildren();
    const ref = formatVerseRef(p);
    if (packet.chronological_context) {
      const eraBox = document.createElement('div');
      eraBox.className = 'verse-map-era-box';
      const eraTitle = document.createElement('strong');
      eraTitle.textContent = `Historical Map Period: ${packet.chronological_context.era_label}`;
      const eraDesc = document.createElement('span');
      eraDesc.append(document.createTextNode(`Chronology of ${ref}: `));
      const dateEm = document.createElement('em');
      dateEm.textContent = packet.chronological_context.date_label;
      eraDesc.append(dateEm, document.createTextNode(' · Ancient place names synchronized to this period.'));
      eraBox.append(eraTitle, eraDesc);
      sidebar.append(eraBox);
    }

    const stats = computeRouteStats(packet.locations, selectedAltIds);
    if (stats.pointCount >= 2) {
      const statsBanner = document.createElement('div');
      statsBanner.className = 'verse-map-route-stats';
      const kmLabel = stats.totalKm < 1 ? '< 1 km' : `~${Math.round(stats.totalKm)} km`;
      const miLabel = stats.totalMiles < 1 ? '< 1 mi' : `${Math.round(stats.totalMiles)} mi`;
      const daysLabel = stats.walkDays < 0.1 ? '< 0.1' : `${stats.walkDays}`;
      const lead = document.createElement('strong');
      lead.textContent = `${stats.pointCount} mapped stops`;
      statsBanner.append(
        lead,
        document.createTextNode(` · ${kmLabel} (${miLabel}) · ~${daysLabel} days on foot @ 30 km/day`),
      );
      sidebar.append(statsBanner);
    }

    for (const ctx of packet.passage_contexts.slice(0, 2)) {
      const box = document.createElement('div');
      box.className = 'verse-map-context-box';
      const ctxTitle = document.createElement('strong');
      ctxTitle.textContent = `Context: ${ctx.title} (${ctx.evidence_refs})`;
      const ctxDesc = document.createElement('span');
      ctxDesc.textContent = ctx.evidence_explanation;
      box.append(ctxTitle, ctxDesc);
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
        openMediaLightbox,
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
      const errMsg = document.createElement('p');
      errMsg.className = 'chronology-muted';
      errMsg.textContent = res.error ?? 'No reliable geographical location identified for this verse.';
      sidebar.replaceChildren(errMsg);
      if (element.open || mapDialog.open) await canvas.renderPacket(null, {});
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
    if (element.open || mapDialog.open) {
      await canvas.renderPacket(packet, selectedAltIds);
      if (pendingFocus) canvas.focusPlace(pendingFocus);
    }
  }
  return {
    element,
    load,
    focusPlace: (placeKey: string) => {
      pendingFocus = placeKey;
      element.open = true;
      if (currentPacket) void canvas.renderPacket(currentPacket, selectedAltIds).then(() => canvas.focusPlace(placeKey));
      element.scrollIntoView({ block: 'start' });
      summary.focus();
    },
    getCurrentPacket: () => currentPacket,
  };
}
