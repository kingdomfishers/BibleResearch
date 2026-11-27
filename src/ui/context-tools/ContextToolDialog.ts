// @file: src/ui/context-tools/ContextToolDialog.ts
// @feature: context-tools
// @tables: places | place_locations | verse_geography
// @candidates: none
// @toc: imports | types | logic:detection | logic:refs | logic:atlas | ui:dialog | ui:place-tab | ui:lightbox

// === @section:imports ===
import type { ActivePassage, GeographyLocation, GeographyRelationshipType, VerseGeographyPacket } from '../../api/types';
import type { ContextPreview } from '../components/ContextPreview';
import { action, el, status } from '../study-dom';
import { BIBLE_BOOKS, formatVerseRef } from '../utils';
import {
  CURATED_MEDIA_ASSETS,
  type CuratedMediaAsset,
  getMediaForPlace,
  loadBiblePlacesIndex,
  renderMediaFigure,
  searchBiblePlaces,
} from './curated-media-manifest';
import { createFeastsOverviewPanel, detectFeastsForContext } from './FeastsOverviewPanel';
import { createPeopleGenealogyPanel } from './PeopleGenealogyPanel';
import { detectPeopleForContext, getPeopleInVerse } from './people-data';
import { type ArchitecturePlanId, detectArchitectureForPassage } from './sacred-architecture';
import { createSyncedTimelinePanel } from './SyncedTimelinePanel';
import { createTabernacleTemplePanel } from './TabernacleTemplePanel';
import { detectTribesForPassage } from './table-of-nations';
import { createTableOfNationsPanel } from './TableOfNationsPanel';

// === @section:types ===
export type ContextToolKind = 'place' | 'nations' | 'person' | 'timeline' | 'architecture' | 'feast';

export interface ContextToolChip {
  kind: ContextToolKind;
  id: string;
  label: string;
  badge?: string;
  strongs?: string;
  planId?: ArchitecturePlanId;
}

export interface ContextToolDialogCallbacks {
  preview: ContextPreview;
  onNavigate: (p: ActivePassage) => void;
  onFocusMapPlace: (placeKey: string) => void;
  onInspectStrongs?: (strongs: string) => void;
}

export interface ContextToolDialogHandle {
  openPlace: (placeKey?: string, packet?: VerseGeographyPacket | null) => void;
  openNations: (tribeId?: string) => void;
  openPerson: (personId?: string) => void;
  openTimeline: (passage?: ActivePassage) => void;
  openArchitecture: (planId?: ArchitecturePlanId, elementId?: string) => void;
  openFeasts: (feastId?: string) => void;
  openTab: (kind: ContextToolKind) => void;
  close: () => void;
}

type AtlasPlaceRaw = Awaited<ReturnType<typeof searchBiblePlaces>>[number];

interface NormalizedAtlasPlace {
  key: string;
  name: string;
  modernName: string | null;
  aliases: string[];
  strongs: string[];
  lat: number | null;
  lon: number | null;
  featureType: string | null;
  precision: string | null;
  openbibleUrl: string | null;
  pleiadesUrl: string | null;
  verseCount: number | null;
}

const MAX_CONTEXT_CHIPS = 8;
const ATLAS_SEARCH_LIMIT = 24;

const REL_LABELS: Record<GeographyRelationshipType, string> = {
  event_location: 'Direct Event Setting',
  contextual_location: 'Narrative Context Setting',
  audience_location: 'Written To / For',
  composition_location: 'Written From',
  mentioned_location: 'Mentioned Place',
  travel_origin: 'Travel Origin',
  travel_destination: 'Travel Destination',
  uncertain_location: 'Uncertain / Disputed',
};

const TAB_CONFIG: { kind: ContextToolKind; label: string }[] = [
  { kind: 'place', label: 'Places' },
  { kind: 'nations', label: 'Table of Nations' },
  { kind: 'person', label: 'People' },
  { kind: 'timeline', label: 'Timeline' },
  { kind: 'architecture', label: 'Temple & City' },
  { kind: 'feast', label: 'Feasts' },
];

const BOOK_ABBREV_MAP: Record<string, number> = {
  gen: 1, exod: 2, ex: 2, lev: 3, num: 4, deut: 5, dt: 5, josh: 6, judg: 7,
  '1 sam': 9, '2 sam': 10, '1 kgs': 11, '2 kgs': 12, '1 chr': 13, '2 chr': 14,
  neh: 16, esth: 17, ps: 19, psalm: 19, prov: 20, eccl: 21, song: 22, 'song of songs': 22,
  isa: 23, jer: 24, lam: 25, ezek: 26, dan: 27, hos: 28, obad: 31, mic: 33, nah: 34,
  hab: 35, zeph: 36, hag: 37, zech: 38, mal: 39, matt: 40, mt: 40, mk: 41, lk: 42,
  jn: 43, rom: 45, '1 cor': 46, '2 cor': 47, gal: 48, eph: 49, phil: 50, col: 51,
  '1 thess': 52, '2 thess': 53, '1 tim': 54, '2 tim': 55, phlm: 57, heb: 58, jas: 59,
  '1 pet': 60, '2 pet': 61, '1 jn': 62, '2 jn': 63, '3 jn': 64, rev: 66,
};

const ARCH_PLAN_BADGES: Record<ArchitecturePlanId, string> = {
  tabernacle: 'Tabernacle',
  first_temple: '1st Temple',
  second_temple: '2nd Temple',
  jerusalem_gates: 'Jerusalem',
};

// === @section:logic:detection ===
function toArchitectureChip(match: ReturnType<typeof detectArchitectureForPassage>[number]): ContextToolChip {
  return {
    kind: 'architecture',
    id: match.element.id,
    label: match.element.name,
    badge: ARCH_PLAN_BADGES[match.planId] ?? 'Blueprint',
    strongs: match.element.strongs?.[0],
    planId: match.planId,
  };
}

function readFirstStrongs(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const s = (item as { strongs?: unknown }).strongs;
  if (Array.isArray(s) && typeof s[0] === 'string') return s[0];
  if (typeof s === 'string' && s.trim()) return s.trim();
  return undefined;
}

export function detectContextTools(args: {
  passage: ActivePassage;
  strongsList: string[];
  verseTokens?: Array<{
    strongs_nr: string;
    word_position: number;
    selected_english?: string | null;
    source_english?: string | null;
  }>;
  geographyPacket: VerseGeographyPacket | null;
}): ContextToolChip[] {
  const { passage, strongsList, verseTokens, geographyPacket } = args;
  const seen = new Set<string>();
  const buckets: Record<ContextToolKind, ContextToolChip[]> = {
    place: [],
    nations: [],
    person: [],
    timeline: [],
    architecture: [],
    feast: [],
  };

  const pushUnique = (chip: ContextToolChip) => {
    const key = `${chip.kind}:${chip.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    buckets[chip.kind].push(chip);
  };

  for (const tribe of detectTribesForPassage(strongsList, verseTokens)) {
    pushUnique({
      kind: 'nations',
      id: tribe.id,
      label: tribe.name,
      badge: 'Nation',
      strongs: readFirstStrongs(tribe),
    });
  }

  for (const arch of detectArchitectureForPassage(passage, verseTokens)) {
    pushUnique(toArchitectureChip(arch));
  }

  for (const f of detectFeastsForContext(passage, strongsList)) {
    pushUnique({
      kind: 'feast',
      id: f.id,
      label: f.name,
      badge: 'Feast',
      strongs: f.strongs?.[0],
    });
  }

  const versePeople = getPeopleInVerse(passage);
  const peopleMatches = versePeople.length > 0 ? versePeople : detectPeopleForContext(passage, strongsList);
  for (const p of peopleMatches) {
    pushUnique({
      kind: 'person',
      id: p.id,
      label: p.disambiguator ? `${p.name} (${p.disambiguator})` : p.name,
      badge: 'Person',
      strongs: p.strongs?.[0],
    });
  }

  if (geographyPacket?.locations.length) {
    const sortedLocs = [...geographyPacket.locations].sort((a, b) => {
      const aMedia = getMediaForPlace(a).length > 0 ? 1 : 0;
      const bMedia = getMediaForPlace(b).length > 0 ? 1 : 0;
      if (aMedia !== bMedia) return bMedia - aMedia;
      const aDirect = a.relationship_type === 'event_location' ? 1 : 0;
      const bDirect = b.relationship_type === 'event_location' ? 1 : 0;
      return bDirect - aDirect;
    });
    for (const loc of sortedLocs.slice(0, 2)) {
      const hasPhoto = getMediaForPlace(loc).length > 0;
      pushUnique({
        kind: 'place',
        id: loc.place_key,
        label: loc.biblical_name,
        badge: hasPhoto ? 'Place · Photo' : 'Place',
        strongs: loc.strongs_numbers?.[0],
      });
    }
  }

  // Interleave across categories so one category does not crowd out others before reaching the cap.
  const out: ContextToolChip[] = [];
  const order: ContextToolKind[] = ['place', 'nations', 'person', 'architecture', 'feast'];
  let idx = 0;
  while (out.length < MAX_CONTEXT_CHIPS) {
    let added = false;
    for (const kind of order) {
      const item = buckets[kind][idx];
      if (item) {
        out.push(item);
        added = true;
        if (out.length >= MAX_CONTEXT_CHIPS) break;
      }
    }
    if (!added) break;
    idx += 1;
  }
  return out;
}

// === @section:logic:refs ===
function resolveBookNumber(rawBook: string): number {
  const key = rawBook.trim().replace(/\./g, '').toLowerCase();
  if (BOOK_ABBREV_MAP[key]) return BOOK_ABBREV_MAP[key]!;
  const idx = BIBLE_BOOKS.findIndex(name => name.toLowerCase() === key);
  return idx >= 0 ? idx + 1 : 0;
}

function parseScriptureRef(raw: string): ActivePassage | null {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  const fullMatch = /^([1-3]?\s*[A-Za-z][A-Za-z.\s]*?)\s+(\d+):(\d+)(?:[–-]\d+)?$/.exec(cleaned);
  const chapMatch = /^([1-3]?\s*[A-Za-z][A-Za-z.\s]*?)\s+(\d+)$/.exec(cleaned);
  const match = fullMatch ?? chapMatch;
  if (!match) return null;

  const book = resolveBookNumber(match[1]!);
  if (book < 1) return null;

  const chapter = Number(match[2]);
  const verse = fullMatch ? Number(match[3]) : 1;
  if (!Number.isFinite(chapter) || chapter < 1 || !Number.isFinite(verse) || verse < 1) return null;
  return { book, chapter, verse };
}

function splitEstablishingRefs(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map(part => part.trim())
    .filter(Boolean);
}

function buildLightboxImageUrl(commonsFile: string, width = 1280): string {
  const normalized = commonsFile.trim().replace(/^file:/i, '').replace(/\s+/g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(normalized)}?width=${width}`;
}

function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? '°N' : '°S';
  const ew = lon >= 0 ? '°E' : '°W';
  return `${Math.abs(lat).toFixed(4)}${ns}, ${Math.abs(lon).toFixed(4)}${ew}`;
}

function installBackdropDismiss(dialog: HTMLDialogElement) {
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

// === @section:logic:atlas ===
function readStr(val: unknown): string | null {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function readNum(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function readStringList(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map(v => readStr(v)).filter((v): v is string => v !== null);
  }
  if (typeof val === 'string') {
    return val
      .split(/[;,]/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeAtlasPlace(raw: AtlasPlaceRaw): NormalizedAtlasPlace {
  const r = raw as unknown as Record<string, unknown>;
  const name =
    readStr(r.name) ??
    readStr(r.biblical_name) ??
    readStr(r.title) ??
    readStr(r.ancient_name) ??
    'Unnamed Place';
  const key =
    readStr(r.place_key) ??
    readStr(r.key) ??
    readStr(r.id) ??
    readStr(r.friendly_id) ??
    readStr(r.friendlyId) ??
    readStr(r.slug) ??
    name;
  const modernName = readStr(r.modernName) ?? readStr(r.modern_name);
  const aliases = [
    ...readStringList(r.aliases),
    ...readStringList(r.altNames),
    ...readStringList(r.historical_names),
  ].filter((alias, idx, arr) => alias.toLowerCase() !== name.toLowerCase() && arr.indexOf(alias) === idx);
  const strongs = readStringList(r.strongs);
  const lat = readNum(r.lat) ?? readNum(r.latitude);
  const lon = readNum(r.lon) ?? readNum(r.lng) ?? readNum(r.longitude);
  const featureType = readStr(r.featureType) ?? readStr(r.feature_type) ?? readStr(r.place_type) ?? readStr(r.type);
  const precision = readStr(r.precision);

  const openbibleId = readStr(r.openbibleId) ?? readStr(r.openbible_id) ?? readStr(r.openbible);
  const rawOpenbibleUrl =
    readStr(r.openBibleUri) ??
    readStr(r.openbibleUri) ??
    readStr(r.openbibleUrl) ??
    readStr(r.openbible_url) ??
    readStr(r.openBibleUrl);
  const openbibleSlug = openbibleId
    ? openbibleId.replace(/^openbible:/i, '')
    : key.startsWith('openbible:')
      ? key.slice('openbible:'.length)
      : readStr(r.friendly_id) ?? readStr(r.friendlyId) ?? (/^a[0-9a-f]{6}$/i.test(key) ? key : null);
  const openbibleUrl =
    rawOpenbibleUrl ??
    (openbibleSlug ? `https://www.openbible.info/geo/places/${encodeURIComponent(openbibleSlug)}` : null);

  const pleiadesId = readStr(r.pleiadesId) ?? readStr(r.pleiades_id) ?? readStr(r.pleiades);
  const rawPleiadesUrl =
    readStr(r.pleiadesUri) ??
    readStr(r.pleiadesUrl) ??
    readStr(r.pleiades_url);
  const pleiadesUrl =
    rawPleiadesUrl ??
    (pleiadesId
      ? pleiadesId.startsWith('http')
        ? pleiadesId
        : `https://pleiades.stoa.org/places/${encodeURIComponent(pleiadesId.replace(/^pleiades:/i, ''))}`
      : null);

  const verseCount = readNum(r.verseCount) ?? readNum(r.verse_count) ?? readNum(r.verses);

  return {
    key,
    name,
    modernName,
    aliases,
    strongs,
    lat,
    lon,
    featureType,
    precision,
    openbibleUrl,
    pleiadesUrl,
    verseCount,
  };
}

function findPacketMatch(atlas: NormalizedAtlasPlace, packet: VerseGeographyPacket | null): GeographyLocation | undefined {
  if (!packet?.locations.length) return undefined;
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/^openbible:/, '');
  const atlasKey = norm(atlas.key);
  const atlasName = norm(atlas.name);
  const atlasBase = atlasName.replace(/\s+\d+$/, '');
  const atlasAliases = new Set(atlas.aliases.map(norm).filter(Boolean));
  return packet.locations.find(loc => {
    const locKey = norm(loc.place_key);
    const locOb = norm(loc.external_ids?.openbible ?? loc.external_ids?.openbible_id);
    if (atlasKey && (locKey === atlasKey || (locOb && locOb === atlasKey))) return true;
    const locName = norm(loc.biblical_name);
    if (atlasName && (locName === atlasName || locName.replace(/\s+\d+$/, '') === atlasBase)) return true;
    return atlasAliases.has(locName);
  });
}

// === @section:ui:dialog ===
export function createContextToolDialog(callbacks: ContextToolDialogCallbacks): ContextToolDialogHandle {
  const dialog = document.createElement('dialog');
  dialog.className = 'context-tool-dialog';
  dialog.setAttribute('closedby', 'any');
  dialog.setAttribute('aria-labelledby', 'context-tool-dialog-title');
  installBackdropDismiss(dialog);

  const lightbox = document.createElement('dialog');
  lightbox.className = 'media-lightbox-dialog';
  lightbox.setAttribute('closedby', 'any');
  lightbox.setAttribute('aria-labelledby', 'media-lightbox-title');
  installBackdropDismiss(lightbox);

  const header = el('header', 'context-tool-header');
  const titleWrap = el('div', 'context-tool-title-wrap');
  const eyebrow = el('p', 'eyebrow', 'CONTEXT EXPLORER');
  const heading = el('h2', 'context-tool-dialog-title', 'Context Explorer');
  heading.id = 'context-tool-dialog-title';
  titleWrap.append(eyebrow, heading);

  const closeBtn = action('Close ✕', () => dialog.close(), 'context-tool-close-btn');
  closeBtn.setAttribute('aria-label', 'Close Context Explorer');

  const topRow = el('div', 'context-tool-header-top');
  topRow.append(titleWrap, closeBtn);

  const tablist = el('div', 'context-tool-tabs context-tool-tablist');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Context Explorer sections');

  const tabButtons = new Map<ContextToolKind, HTMLButtonElement>();
  const tabPanels = new Map<ContextToolKind, HTMLElement>();
  const body = el('div', 'context-tool-body');

  let activeTab: ContextToolKind = 'place';
  let currentPacket: VerseGeographyPacket | null = null;
  let selectedPlaceKey: string | null = null;
  const selectedAltIds: Record<string, string> = {};
  let lastOpener: HTMLElement | null = null;

  let atlasReady = false;
  let atlasLoading: Promise<void> | null = null;
  let atlasError: string | null = null;
  let atlasCount = 0;
  let atlasQuery = '';
  let atlasResults: NormalizedAtlasPlace[] = [];
  let selectedAtlasKey: string | null = null;

  const navigateAndClose = (p: ActivePassage) => {
    close();
    callbacks.onNavigate(p);
  };

  const inspectStrongsAndClose = callbacks.onInspectStrongs
    ? (strongs: string) => {
        close();
        callbacks.onInspectStrongs!(strongs);
      }
    : undefined;

  const openPersonAndSwitch = (personId?: string) => {
    ensureOpen('person');
    peoplePanel.focusPerson(personId);
  };

  const nationsPanel = createTableOfNationsPanel({
    preview: callbacks.preview,
    onNavigate: navigateAndClose,
    onInspectStrongs: inspectStrongsAndClose,
    onOpenPerson: personId => openPersonAndSwitch(personId),
  });

  const timelinePanel = createSyncedTimelinePanel({
    preview: callbacks.preview,
    onNavigate: navigateAndClose,
  });

  const feastsPanel = createFeastsOverviewPanel({
    preview: callbacks.preview,
    onNavigate: navigateAndClose,
    onInspectStrongs: inspectStrongsAndClose,
  });

  const peoplePanel = createPeopleGenealogyPanel({
    preview: callbacks.preview,
    onNavigate: navigateAndClose,
    onInspectStrongs: inspectStrongsAndClose,
  });

  const architecturePanel = createTabernacleTemplePanel({
    preview: callbacks.preview,
    onNavigate: navigateAndClose,
    onInspectStrongs: inspectStrongsAndClose,
  });

  for (const cfg of TAB_CONFIG) {
    const tabBtn = action(cfg.label, () => switchTab(cfg.kind), 'context-tool-tab');
    tabBtn.id = `ctx-tab-${cfg.kind}`;
    tabBtn.setAttribute('role', 'tab');
    tabBtn.setAttribute('aria-selected', cfg.kind === activeTab ? 'true' : 'false');
    tabBtn.tabIndex = cfg.kind === activeTab ? 0 : -1;
    tabButtons.set(cfg.kind, tabBtn);
    tablist.append(tabBtn);

    const panel = el('section', `context-tool-tabpanel context-tool-tabpanel--${cfg.kind}`);
    panel.id = `ctx-panel-${cfg.kind}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabBtn.id);
    panel.hidden = cfg.kind !== activeTab;
    tabPanels.set(cfg.kind, panel);
    body.append(panel);
  }

  tabPanels.get('nations')!.append(nationsPanel.element);
  tabPanels.get('person')!.append(peoplePanel.element);
  tabPanels.get('timeline')!.append(timelinePanel.element);
  tabPanels.get('architecture')!.append(architecturePanel.element);
  tabPanels.get('feast')!.append(feastsPanel.element);

  // Persistent sub-containers inside Places & Photos so active atlas search input keeps focus.
  const passagePlaceHost = el('div', 'context-passage-places-host');
  const atlasSearchHost = el('section', 'places-atlas-section');
  const galleryHost = el('section', 'context-featured-places');
  let placeShellMounted = false;
  let galleryBuilt = false;

  const atlasStatusEl = el('span', 'places-search-status', 'Loading biblical places atlas…');
  const atlasInput = document.createElement('input');
  atlasInput.type = 'search';
  atlasInput.className = 'places-search-input';
  atlasInput.placeholder = 'Search all ~1,297 biblical places (e.g., Shiloh, Damascus, Megiddo, Bethsaida)…';
  atlasInput.setAttribute('aria-label', 'Search biblical places atlas');

  const atlasResultsEl = el('div', 'places-search-results');
  atlasResultsEl.setAttribute('role', 'listbox');
  atlasResultsEl.setAttribute('aria-label', 'Bible Places Atlas search results');
  atlasResultsEl.hidden = true;

  const atlasDetailEl = el('article', 'place-atlas-card');
  atlasDetailEl.hidden = true;

  tablist.addEventListener('keydown', event => {
    const idx = TAB_CONFIG.findIndex(t => t.kind === activeTab);
    if (idx < 0) return;
    let nextIdx = -1;
    if (event.key === 'ArrowRight') nextIdx = (idx + 1) % TAB_CONFIG.length;
    else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + TAB_CONFIG.length) % TAB_CONFIG.length;
    else if (event.key === 'Home') nextIdx = 0;
    else if (event.key === 'End') nextIdx = TAB_CONFIG.length - 1;
    if (nextIdx < 0) return;
    event.preventDefault();
    const nextKind = TAB_CONFIG[nextIdx]!.kind;
    switchTab(nextKind);
    tabButtons.get(nextKind)?.focus();
  });

  header.append(topRow, tablist);
  dialog.append(header, body);

  dialog.addEventListener('close', () => {
    dialog.returnValue = '';
    if (lightbox.open) lightbox.close();
    if (dialog.parentElement) dialog.remove();
    if (lastOpener?.isConnected && document.activeElement === document.body) {
      lastOpener.focus();
    }
    lastOpener = null;
  });

  lightbox.addEventListener('close', () => {
    lightbox.returnValue = '';
    if (lightbox.parentElement) lightbox.remove();
  });

  // === @section:ui:lightbox ===
  function openLightbox(asset: CuratedMediaAsset) {
    const lbHeader = el('div', 'media-lightbox-header');
    const lbTitleWrap = el('div', 'media-lightbox-title-wrap');
    const lbEyebrow = el('p', 'eyebrow', asset.entityType === 'feast' ? 'CURATED FEAST MEDIA' : 'CURATED HISTORICAL SITE');
    const lbTitle = el('h3', 'media-lightbox-title', asset.title);
    lbTitle.id = 'media-lightbox-title';
    lbTitleWrap.append(lbEyebrow, lbTitle);

    const lbClose = action('Close ✕', () => lightbox.close(), 'context-tool-close-btn');
    lbClose.setAttribute('aria-label', 'Close full image view');
    lbHeader.append(lbTitleWrap, lbClose);

    const lbStage = el('div', 'media-lightbox-stage');
    const img = document.createElement('img');
    img.className = 'media-lightbox-img';
    img.src = buildLightboxImageUrl(asset.commonsFile, 1280);
    img.alt = asset.title;
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.replaceWith(status('Full image preview could not be loaded in this environment.'));
    });
    lbStage.append(img);

    const lbMeta = el('div', 'media-lightbox-meta');
    lbMeta.append(el('p', 'media-lightbox-note', asset.historicalNote || asset.caption));

    const facts = el('div', 'media-lightbox-facts');
    facts.append(
      el('span', 'context-tool-pill', `Period: ${asset.depictsPeriod}`),
      el('span', 'context-tool-pill', `Date: ${asset.creationDate}`),
      el('span', 'context-tool-pill', `Confidence: ${asset.confidence}`),
      el('span', 'context-tool-pill', `License: ${asset.licenseID}`),
    );
    lbMeta.append(facts);

    const attr = el('p', 'curated-media-attribution');
    attr.append(document.createTextNode(`${asset.creator} · `));
    const licenseLink = el('a', 'context-source-link', asset.licenseAttribution);
    licenseLink.href = asset.licenseURL;
    licenseLink.target = '_blank';
    licenseLink.rel = 'noopener noreferrer';
    const sourceLink = el('a', 'context-source-link', 'Wikimedia Commons ↗');
    sourceLink.href = asset.sourceURL;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    attr.append(licenseLink, document.createTextNode(' · '), sourceLink);
    lbMeta.append(attr);

    lightbox.replaceChildren(lbHeader, lbStage, lbMeta);
    if (!lightbox.isConnected) document.body.append(lightbox);
    if (!lightbox.open) lightbox.showModal();
    lbClose.focus();
  }

  function wrapMediaCard(asset: CuratedMediaAsset, compact: boolean): HTMLElement {
    const wrap = el('div', 'context-media-card');
    wrap.dataset.assetId = asset.id;

    const figure = renderMediaFigure(asset, { compact, onOpenLightbox: openLightbox });
    const footerBar = el('div', 'context-media-card-actions');
    footerBar.append(action('Enlarge photo ⤢', () => openLightbox(asset), 'study-button context-media-zoom-btn'));

    wrap.append(figure, footerBar);
    return wrap;
  }

  // === @section:ui:place-tab ===
  async function ensureAtlasLoaded(): Promise<void> {
    if (atlasReady) return;
    if (!atlasLoading) {
      atlasStatusEl.textContent = 'Loading biblical places atlas…';
      atlasLoading = loadBiblePlacesIndex()
        .then(index => {
          atlasReady = true;
          atlasError = null;
          atlasCount = Array.isArray(index) ? index.length : 0;
        })
        .catch(() => {
          atlasError = 'Could not load the biblical places atlas index in this environment.';
        })
        .finally(() => {
          atlasLoading = null;
          refreshAtlasSearch();
        });
    }
    await atlasLoading;
  }

  function refreshAtlasSearch(): void {
    const q = atlasQuery.trim();
    if (atlasError) {
      atlasStatusEl.textContent = atlasError;
      atlasResults = [];
      atlasResultsEl.replaceChildren();
      atlasResultsEl.hidden = true;
      renderAtlasDetail();
      return;
    }
    if (!atlasReady) {
      atlasStatusEl.textContent = 'Loading biblical places atlas…';
      return;
    }

    const totalLabel = atlasCount > 0 ? `${atlasCount.toLocaleString()} places indexed` : 'Bible places atlas ready';
    const rawMatches = searchBiblePlaces(q, ATLAS_SEARCH_LIMIT);

    atlasResults = (Array.isArray(rawMatches) ? rawMatches : []).map(normalizeAtlasPlace);
    atlasStatusEl.textContent = q
      ? `${atlasResults.length} match${atlasResults.length === 1 ? '' : 'es'}${atlasResults.length >= ATLAS_SEARCH_LIMIT ? ` (top ${ATLAS_SEARCH_LIMIT})` : ''}`
      : `${totalLabel} · top ${atlasResults.length} by verse refs`;

    atlasResultsEl.replaceChildren();
    if (atlasResults.length === 0) {
      atlasResultsEl.hidden = false;
      atlasResultsEl.append(status(q ? `No biblical places matched "${q}".` : 'No indexed biblical places available yet.'));
      renderAtlasDetail();
      return;
    }

    if (!atlasResults.some(r => r.key === selectedAtlasKey)) {
      selectedAtlasKey = atlasResults[0]!.key;
    }

    atlasResultsEl.hidden = false;
    for (const place of atlasResults) {
      const isSelected = place.key === selectedAtlasKey;
      const btn = action('', () => {
        selectedAtlasKey = place.key;
        renderAtlasResultsSelection();
        renderAtlasDetail();
      }, `places-search-result-btn${isSelected ? ' is-selected' : ''}`);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(isSelected));
      btn.dataset.atlasKey = place.key;

      const topLine = el('span', 'places-search-result-top');
      topLine.append(el('strong', 'places-search-result-name', place.name));
      if (place.featureType) {
        topLine.append(el('span', 'places-search-result-type', place.featureType));
      }
      btn.append(topLine);

      const metaParts: string[] = [];
      if (place.modernName) metaParts.push(place.modernName);
      else if (place.aliases.length > 0) metaParts.push(`aka ${place.aliases.slice(0, 2).join(', ')}`);
      if (place.lat != null && place.lon != null) metaParts.push(formatLatLon(place.lat, place.lon));
      if (metaParts.length > 0) {
        btn.append(el('span', 'places-search-result-meta', metaParts.join(' · ')));
      }
      atlasResultsEl.append(btn);
    }

    renderAtlasDetail();
  }

  function renderAtlasResultsSelection() {
    for (const child of atlasResultsEl.children) {
      if (!(child instanceof HTMLButtonElement)) continue;
      const isSelected = child.dataset.atlasKey === selectedAtlasKey;
      child.classList.toggle('is-selected', isSelected);
      child.setAttribute('aria-selected', String(isSelected));
    }
  }

  function renderAtlasDetail() {
    const selected = atlasResults.find(r => r.key === selectedAtlasKey);
    if (!selected) {
      atlasDetailEl.replaceChildren();
      atlasDetailEl.hidden = true;
      return;
    }

    atlasDetailEl.hidden = false;
    atlasDetailEl.replaceChildren();

    const head = el('div', 'place-atlas-header');
    const titleWrap = el('div', 'place-atlas-title-wrap');
    const titleRow = el('div', 'place-detail-title-row');
    titleRow.append(el('h4', 'place-atlas-name', selected.name));
    if (selected.featureType) {
      titleRow.append(el('span', 'place-pill', selected.featureType));
    }
    if (selected.precision) {
      titleRow.append(el('span', 'place-pill', selected.precision));
    }
    if (selected.verseCount != null) {
      titleRow.append(el('span', 'place-pill', `${selected.verseCount} verse refs`));
    }
    titleWrap.append(titleRow);

    if (selected.modernName) {
      titleWrap.append(el('p', 'place-detail-modern', `Modern identification: ${selected.modernName}`));
    }
    if (selected.aliases.length > 0) {
      titleWrap.append(el('p', 'place-atlas-aliases', `Aliases: ${selected.aliases.join(' · ')}`));
    }
    const coordsText =
      selected.lat != null && selected.lon != null
        ? `Coordinates: ${formatLatLon(selected.lat, selected.lon)}`
        : 'Coordinates: unlocalized / regional';
    titleWrap.append(el('p', 'place-atlas-coords', coordsText));

    head.append(titleWrap);

    const packetMatch = findPacketMatch(selected, currentPacket);
    if (packetMatch) {
      const mapBtn = action(
        'View on Main Map ↗',
        () => {
          close();
          callbacks.onFocusMapPlace(packetMatch.place_key);
        },
        'study-button primary place-map-cta',
      );
      head.append(mapBtn);
    }

    atlasDetailEl.append(head);

    if (selected.openbibleUrl || selected.pleiadesUrl) {
      const linksRow = el('div', 'place-atlas-links');
      linksRow.append(el('span', 'place-detail-refs-label', 'Atlas records:'));
      if (selected.openbibleUrl) {
        const obLink = el('a', 'context-ref-chip', 'OpenBible.info ↗');
        obLink.href = selected.openbibleUrl;
        obLink.target = '_blank';
        obLink.rel = 'noopener noreferrer';
        linksRow.append(obLink);
      }
      if (selected.pleiadesUrl) {
        const plLink = el('a', 'context-ref-chip', 'Pleiades ↗');
        plLink.href = selected.pleiadesUrl;
        plLink.target = '_blank';
        plLink.rel = 'noopener noreferrer';
        linksRow.append(plLink);
      }
      atlasDetailEl.append(linksRow);
    }

    const mediaMatches = getMediaForPlace({
      place_key: selected.key,
      biblical_name: selected.name,
      ancient_name: selected.aliases[0],
      strongs_numbers: selected.strongs,
    });
    if (selected.strongs.length > 0 && inspectStrongsAndClose) {
      const strongsRow = el('div', 'context-strongs-row');
      strongsRow.append(el('span', 'context-strongs-label', 'Lexical links: '));
      for (const s of selected.strongs) {
        strongsRow.append(action(s, () => inspectStrongsAndClose(s), 'context-strongs-chip'));
      }
      atlasDetailEl.append(strongsRow);
    }
    if (mediaMatches.length > 0) {
      const mediaWrap = el('div', 'place-atlas-media');
      mediaWrap.append(el('h5', 'place-media-heading', 'Matching Curated Site Photographs'));
      const mediaGrid = el('div', 'context-place-media-grid');
      for (const asset of mediaMatches) {
        mediaGrid.append(wrapMediaCard(asset, true));
      }
      mediaWrap.append(mediaGrid);
      atlasDetailEl.append(mediaWrap);
    } else {
      atlasDetailEl.append(status(`No curated site photograph registered for ${selected.name}.`));
    }
  }

  atlasInput.addEventListener('input', () => {
    atlasQuery = atlasInput.value;
    if (atlasReady) {
      refreshAtlasSearch();
    } else {
      void ensureAtlasLoaded();
    }
  });

  function ensurePlaceShell() {
    if (placeShellMounted) return;
    placeShellMounted = true;
    const panel = tabPanels.get('place')!;

    const atlasHeader = el('div', 'context-section-header');
    atlasHeader.append(
      el('p', 'eyebrow', 'BIBLE PLACES ATLAS SEARCH'),
      el('h3', '', 'Search All ~1,297 Biblical Places'),
    );
    const searchBar = el('div', 'places-search-bar');
    searchBar.append(atlasInput, atlasStatusEl);
    atlasSearchHost.append(atlasHeader, searchBar, atlasResultsEl, atlasDetailEl);

    panel.append(passagePlaceHost, atlasSearchHost, galleryHost);
  }

  function renderGallerySection() {
    if (galleryBuilt) return;
    galleryBuilt = true;
    const galleryHeader = el('div', 'context-section-header');
    galleryHeader.append(
      el('p', 'eyebrow', 'CURATED SITE GALLERY'),
      el('h3', '', 'Featured Curated Place Photos'),
    );
    galleryHost.append(galleryHeader);

    const placeAssets = CURATED_MEDIA_ASSETS.filter(a => a.entityType === 'place');
    if (placeAssets.length === 0) {
      galleryHost.append(status('No curated place photographs are currently registered.'));
    } else {
      const grid = el('div', 'context-place-gallery-grid');
      for (const asset of placeAssets) {
        grid.append(wrapMediaCard(asset, true));
      }
      galleryHost.append(grid);
    }
  }

  function renderPassagePlaces() {
    passagePlaceHost.replaceChildren();

    const locations = currentPacket?.locations ?? [];
    if (locations.length > 0) {
      const activeLoc: GeographyLocation =
        locations.find(l => l.place_key === selectedPlaceKey) ?? locations[0]!;
      selectedPlaceKey = activeLoc.place_key;

      if (locations.length > 1) {
        const chooser = el('div', 'context-place-chooser');
        chooser.setAttribute('role', 'group');
        chooser.setAttribute('aria-label', 'Passage locations');
        for (const loc of locations) {
          const btn = action(loc.biblical_name, () => {
            selectedPlaceKey = loc.place_key;
            renderPassagePlaces();
          }, `context-place-pill${loc.place_key === activeLoc.place_key ? ' is-active' : ''}`);
          btn.setAttribute('aria-pressed', String(loc.place_key === activeLoc.place_key));
          chooser.append(btn);
        }
        passagePlaceHost.append(chooser);
      }

      passagePlaceHost.append(renderPlaceDetailCard(activeLoc));
    } else {
      const emptyMsg = currentPacket?.message
        ?? 'No physical place is selected for this verse. Search all ~1,297 biblical places below or browse featured historical site photography.';
      passagePlaceHost.append(status(emptyMsg));
    }
  }

  function renderPlaceTab() {
    ensurePlaceShell();
    renderPassagePlaces();
    renderGallerySection();
    void ensureAtlasLoaded();
  }

  function renderPlaceDetailCard(loc: GeographyLocation): HTMLElement {
    const card = el('article', 'place-detail-card');
    const activeAltId = selectedAltIds[loc.place_key] ?? loc.alternative_locations[0]?.id;
    const activeAlt = loc.alternative_locations.find(a => a.id === activeAltId);

    const head = el('div', 'place-detail-header');
    const titleBlock = el('div', 'place-detail-title-block');
    const titleRow = el('div', 'place-detail-title-row');
    titleRow.append(el('h3', 'place-detail-name', loc.biblical_name));
    if (loc.ancient_name && loc.ancient_name !== loc.biblical_name) {
      titleRow.append(el('span', 'place-detail-ancient', `Ancient: ${loc.ancient_name}`));
    }
    titleBlock.append(titleRow);

    if (loc.hebrew_name || loc.greek_name) {
      const scriptLine = el('div', 'place-detail-scripts');
      if (loc.hebrew_name) {
        const he = el('span', 'place-script-he', loc.hebrew_name);
        he.dir = 'rtl';
        he.lang = 'he';
        scriptLine.append(he);
      }
      if (loc.greek_name) {
        const gr = el('span', 'place-script-gr', loc.greek_name);
        gr.lang = 'el';
        scriptLine.append(gr);
      }
      titleBlock.append(scriptLine);
    }

    const modernName = activeAlt?.modern_name ?? loc.modern_name
      ?? (loc.is_non_physical ? 'Symbolic / Non-physical setting' : 'Regional area');
    const lat = activeAlt?.latitude ?? loc.latitude;
    const lon = activeAlt?.longitude ?? loc.longitude;
    const coordStr = lat != null && lon != null
      ? formatLatLon(lat, lon)
      : (loc.geometry ? `${loc.geometry.type} region` : 'No fixed point coordinates');
    titleBlock.append(el('p', 'place-detail-modern', `Modern identification: ${modernName} · ${coordStr}`));

    const mapBtn = action('Show on Interactive Map ↗', () => {
      close();
      callbacks.onFocusMapPlace(loc.place_key);
    }, 'study-button primary place-map-cta');

    head.append(titleBlock, mapBtn);
    card.append(head);

    const pills = el('div', 'place-detail-pills');
    pills.append(
      el('span', `place-pill rel-${loc.relationship_type}`, REL_LABELS[loc.relationship_type]),
      el('span', `place-pill conf-${loc.confidence_level}`, `${loc.confidence_level} · ${activeAlt?.confidence_label ?? loc.confidence_label}`),
      el('span', 'place-pill', loc.is_inferred ? 'Context / Provenance' : 'Explicit in Verse'),
    );
    if (loc.place_type) pills.append(el('span', 'place-pill', loc.place_type));
    card.append(pills);

    if (loc.evidence_explanation) {
      card.append(el('p', 'place-detail-evidence', loc.evidence_explanation));
    }
    if (loc.identification_evidence && loc.identification_evidence !== loc.evidence_explanation) {
      card.append(el('p', 'place-detail-identification', loc.identification_evidence));
    }

    if (loc.alternative_locations.length > 0) {
      const altSection = el('div', 'place-detail-alternatives');
      altSection.append(el('span', 'place-alternatives-title', `Alternative identifications (${loc.alternative_locations.length})`));
      const altButtons = el('div', 'alt-buttons');
      for (const alt of loc.alternative_locations) {
        const btn = action(
          `#${alt.rank_order} ${alt.modern_name} (${alt.confidence_label})`,
          () => {
            selectedAltIds[loc.place_key] = alt.id;
            renderPassagePlaces();
          },
          `alt-btn${alt.id === activeAlt?.id ? ' active' : ''}`,
        );
        altButtons.append(btn);
      }
      altSection.append(altButtons);
      if (activeAlt?.evidence_summary) {
        altSection.append(el('p', 'place-alt-summary', activeAlt.evidence_summary));
      }
      card.append(altSection);
    }

    if (loc.establishing_refs) {
      const refsBox = el('div', 'place-detail-refs');
      refsBox.append(el('span', 'place-detail-refs-label', 'Establishing references: '));
      for (const part of splitEstablishingRefs(loc.establishing_refs)) {
        const parsed = parseScriptureRef(part);
        if (parsed) {
          const refBtn = action(part, () => navigateAndClose(parsed), 'context-ref-chip');
          refBtn.title = `Open ${formatVerseRef(parsed)}`;
          callbacks.preview.attach(refBtn, parsed, `${loc.biblical_name} — ${part}`);
          refsBox.append(refBtn);
        } else {
          refsBox.append(el('span', 'context-ref-text', part));
        }
      }
      if (loc.passage_title) {
        refsBox.append(el('span', 'study-muted', ` (${loc.passage_title})`));
      }
      card.append(refsBox);
    }

    if (loc.strongs_numbers.length > 0 && inspectStrongsAndClose) {
      const strongsRow = el('div', 'context-strongs-row');
      strongsRow.append(el('span', 'context-strongs-label', 'Lexical links: '));
      for (const s of loc.strongs_numbers) {
        strongsRow.append(action(s, () => inspectStrongsAndClose(s), 'context-strongs-chip'));
      }
      card.append(strongsRow);
    }

    const placeMedia = getMediaForPlace(loc);
    if (placeMedia.length > 0) {
      const mediaSection = el('div', 'place-detail-media');
      mediaSection.append(el('h4', 'place-media-heading', 'Historical Site Photographs & Evidence'));
      const mediaGrid = el('div', 'context-place-media-grid');
      for (const asset of placeMedia) {
        mediaGrid.append(wrapMediaCard(asset, true));
      }
      mediaSection.append(mediaGrid);
      card.append(mediaSection);
    } else {
      card.append(status(`No curated site photo matched for ${loc.biblical_name}; explore the curated gallery below.`));
    }

    card.append(el('p', 'curated-media-attribution', `Source: ${loc.source.dataset} (${loc.source.license})`));
    return card;
  }

  // === @section:logic:navigation ===
  function switchTab(kind: ContextToolKind) {
    activeTab = kind;
    for (const cfg of TAB_CONFIG) {
      const btn = tabButtons.get(cfg.kind)!;
      const panel = tabPanels.get(cfg.kind)!;
      const isSelected = cfg.kind === kind;
      btn.setAttribute('aria-selected', String(isSelected));
      btn.tabIndex = isSelected ? 0 : -1;
      panel.hidden = !isSelected;
      if (isSelected) {
        btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    if (kind === 'place') renderPlaceTab();
    if (kind === 'nations') requestAnimationFrame(() => nationsPanel.resize());
  }

  function ensureOpen(kind: ContextToolKind) {
    if (!dialog.open) {
      lastOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    switchTab(kind);
    if (!dialog.isConnected) document.body.append(dialog);
    if (!dialog.open) {
      dialog.showModal();
      tabButtons.get(kind)?.focus();
    }
  }

  function close() {
    if (lightbox.open) lightbox.close();
    if (dialog.open) dialog.close();
  }

  return {
    openPlace: (placeKey?: string, packet?: VerseGeographyPacket | null) => {
      if (packet !== undefined) currentPacket = packet;
      if (placeKey !== undefined) selectedPlaceKey = placeKey;
      ensureOpen('place');
    },
    openNations: (tribeId?: string) => {
      ensureOpen('nations');
      nationsPanel.focusTribe(tribeId);
      requestAnimationFrame(() => nationsPanel.resize());
    },
    openPerson: (personId?: string) => {
      openPersonAndSwitch(personId);
    },
    openTimeline: (passage?: ActivePassage) => {
      ensureOpen('timeline');
      if (passage) timelinePanel.focusPassage(passage);
    },
    openArchitecture: (planId?: ArchitecturePlanId, elementId?: string) => {
      ensureOpen('architecture');
      architecturePanel.focusPlan(planId, elementId);
    },
    openFeasts: (feastId?: string) => {
      ensureOpen('feast');
      feastsPanel.focusFeast(feastId);
    },
    openTab: (kind: ContextToolKind) => {
      ensureOpen(kind);
    },
    close,
  };
}
