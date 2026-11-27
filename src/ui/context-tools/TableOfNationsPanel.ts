// @file: src/ui/context-tools/TableOfNationsPanel.ts
// @feature: context-tools
// @tables: none
// @candidates: none
// @toc: imports | types | styles | logic:geo | logic:style | ui:main

// === @section:imports ===
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ActivePassage } from '../../api/types';
import type { ContextPreview } from '../components/ContextPreview';
import { action, el, status } from '../study-dom';
import { normalizeStrongsKey } from './curated-media-manifest';
import {
  BIBLICAL_TRIBES,
  getTribeById,
  type BiblicalTribeEntry,
  type NationBranch,
} from './table-of-nations';

// === @section:types ===
export interface TableOfNationsHandle {
  element: HTMLElement;
  focusTribe: (tribeId?: string) => void;
  resize: () => void;
}

type MapLibreModule = typeof import('maplibre-gl');
type MapTheme = 'light' | 'dark';
type BranchFilter = 'all' | NationBranch;

const STYLE_ID = 'table-of-nations-panel-styles';
const DEFAULT_CENTER: [number, number] = [35.5, 31.0];
const DEFAULT_ZOOM = 2.9;

const BRANCH_FILTERS: { id: BranchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'Shem', label: 'Shem' },
  { id: 'Ham', label: 'Ham' },
  { id: 'Japheth', label: 'Japheth' },
  { id: 'Israel', label: '12 Tribes of Israel' },
  { id: 'Other', label: 'Other Neighbors' },
];

const BRANCH_LABELS: Record<NationBranch, string> = {
  Shem: 'Shem',
  Ham: 'Ham',
  Japheth: 'Japheth',
  Israel: '12 Tribes of Israel',
  Other: 'Other Neighbors',
};

const BRANCH_COLORS: Record<NationBranch, string> = {
  Shem: '#d4af37',
  Ham: '#e07a5f',
  Japheth: '#60a5fa',
  Israel: '#2f9e66',
  Other: '#a78bfa',
};

const QUICK_JUMPS: { id: string; label: string }[] = [
  { id: 'amorites', label: 'Amorites' },
  { id: 'hittites', label: 'Hittites' },
  { id: 'javan', label: 'Javan (Greece)' },
  { id: 'elam', label: 'Elam' },
  { id: 'judah', label: 'Judah' },
];

const CONFIDENCE_META: Record<
  BiblicalTribeEntry['confidence'],
  { label: string; badgeClass: string; note: string }
> = {
  established: {
    label: 'Established Biblical Geography',
    badgeClass: 'nations-confidence-badge is-established',
    note: 'Textual witnesses and historical-geographical attestations converge on this regional setting.',
  },
  probable: {
    label: 'Probable Identification',
    badgeClass: 'nations-confidence-badge is-probable',
    note: 'Well-supported by comparative ancient Near Eastern inscriptions and textual context, with broad regional bounds.',
  },
  proposed_conjecture: {
    label: 'Proposed Historical / Scholarly Conjecture',
    badgeClass: 'nations-confidence-badge is-conjecture',
    note: 'Genesis 10 records kinship/eponym relationships; this geographic placement is a scholarly proposal rather than a fixed coordinate.',
  },
};

// === @section:styles ===
function ensureTableOfNationsStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.nations-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
  color: var(--text);
}
.nations-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px 14px;
}
.nations-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.nations-title {
  margin: 0;
  font: 600 17px/1.25 Georgia, serif;
}
.nations-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.nations-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nations-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.nations-filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--background);
  color: var(--muted);
  padding: 4px 11px;
  font-size: 12px;
  line-height: 1.35;
  cursor: pointer;
}
.nations-filter-pill:hover,
.nations-filter-pill:focus-visible {
  background: var(--soft);
  color: var(--text);
  border-color: var(--gold);
}
.nations-filter-pill.is-active {
  background: var(--accent);
  border-color: var(--gold);
  color: var(--text);
  font-weight: 600;
}
.nations-branch-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.nations-search-jump-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.nations-search-input {
  flex: 1 1 230px;
  min-width: 190px;
  padding: 7px 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
  color: var(--text);
  font-size: 13px;
}
.nations-quick-jumps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.nations-quick-label {
  font-size: 11px;
  color: var(--muted);
  margin-right: 2px;
}
.nations-jump-btn {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-alt, var(--background));
  color: var(--gold-light, var(--text));
  padding: 4px 9px;
  font-size: 11.5px;
  cursor: pointer;
}
.nations-jump-btn:hover,
.nations-jump-btn:focus-visible {
  border-color: var(--gold);
  background: var(--soft);
}
.nations-jump-btn.is-active {
  border-color: var(--gold);
  background: var(--accent);
  font-weight: 600;
}
.nations-picker-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  max-height: 92px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
}
.nations-tribe-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  padding: 3px 8px;
  font-size: 11.5px;
  cursor: pointer;
}
.nations-tribe-pill:hover,
.nations-tribe-pill:focus-visible {
  border-color: var(--gold);
  background: var(--soft);
}
.nations-tribe-pill.is-active {
  border-color: var(--gold);
  background: var(--accent);
  font-weight: 600;
}
.nations-main-split {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
}
@media (max-width: 860px) {
  .nations-main-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.nations-map-pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
  overflow: hidden;
  min-width: 0;
}
.nations-map-canvas-wrap {
  position: relative;
  width: 100%;
  min-height: 360px;
  flex: 1 1 auto;
}
.nations-map-canvas {
  width: 100%;
  height: 100%;
  min-height: 360px;
}
.nations-map-fallback {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  min-height: 360px;
  justify-content: center;
  background: var(--surface-alt, var(--background));
}
.nations-map-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  padding: 7px 10px;
  border-top: 1px solid var(--border);
  background: var(--surface-alt, var(--panel));
  font-size: 11px;
  color: var(--muted);
}
.nations-legend-swatches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
}
.nations-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.nations-detail-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
  min-width: 0;
}
.nations-detail-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.nations-confidence-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--border);
}
.nations-confidence-badge.is-established {
  border-color: color-mix(in srgb, #2f9e66 65%, transparent);
  background: color-mix(in srgb, #2f9e66 15%, transparent);
  color: #34c77b;
}
.nations-confidence-badge.is-probable {
  border-color: color-mix(in srgb, #d4af37 65%, transparent);
  background: color-mix(in srgb, #d4af37 16%, transparent);
  color: var(--gold-light, #e8c766);
}
.nations-confidence-badge.is-conjecture {
  border-color: color-mix(in srgb, #e07a5f 65%, transparent);
  background: color-mix(in srgb, #e07a5f 15%, transparent);
  color: #f0957d;
}
.nations-branch-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-size: 11px;
}
.nations-detail-heading {
  margin: 0;
  font: 600 19px/1.25 Georgia, serif;
}
.nations-script-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px 10px;
  font-size: 13px;
}
.nations-script-orig {
  font-size: 16px;
  font-weight: 600;
}
.nations-strongs-btn {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--gold-light, var(--gold));
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.nations-strongs-btn:hover,
.nations-strongs-btn:focus-visible {
  border-color: var(--gold);
  background: var(--soft);
}
.nations-chain-box {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
}
.nations-chain-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.nations-section-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--gold);
}
.nations-chain-trail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  font-size: 12px;
}
.nations-chain-node {
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--background);
  color: var(--text);
}
.nations-chain-node.is-leaf {
  border-color: var(--gold);
  font-weight: 600;
}
.nations-chain-arrow {
  color: var(--muted);
  font-size: 12px;
}
.nations-genealogy-btn {
  border: 1px solid var(--gold);
  border-radius: 6px;
  background: color-mix(in srgb, var(--gold) 12%, var(--background));
  color: var(--gold-light, var(--text));
  padding: 3px 9px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.nations-genealogy-btn:hover,
.nations-genealogy-btn:focus-visible {
  background: color-mix(in srgb, var(--gold) 22%, var(--background));
}
.nations-geo-split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 560px) {
  .nations-geo-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.nations-geo-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
}
.nations-geo-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text);
}
.nations-epistemic-note {
  margin: 0;
  padding: 7px 10px;
  border-left: 3px solid var(--gold);
  border-radius: 5px;
  background: color-mix(in srgb, var(--gold) 9%, var(--panel));
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text);
}
.nations-summary {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
}
.nations-refs-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.nations-ref-btn {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--gold-light, var(--gold));
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.nations-ref-btn:hover,
.nations-ref-btn:focus-visible {
  border-color: var(--gold);
  background: var(--soft);
}
.nations-map-popup {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text);
}
`;
  document.head.append(style);
}

// === @section:logic:geo ===
const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function buildGeodesicCircle(lon: number, lat: number, radiusKm: number, steps = 48): [number, number][][] {
  const angularDist = radiusKm / EARTH_RADIUS_KM;
  const latRad = lat * DEG_TO_RAD;
  const lonRad = lon * DEG_TO_RAD;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * (i % steps)) / steps;
    const sinLat =
      Math.sin(latRad) * Math.cos(angularDist) +
      Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearing);
    const destLat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    const destLon =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDist) * Math.cos(latRad),
        Math.cos(angularDist) - Math.sin(latRad) * Math.sin(destLat),
      );
    ring.push([destLon * RAD_TO_DEG, destLat * RAD_TO_DEG]);
  }
  return [ring];
}

function buildCurvedDispersalArc(
  origin: [number, number],
  dest: [number, number],
  steps = 24,
): [number, number][] {
  const dx = dest[0] - origin[0];
  const dy = dest[1] - origin[1];
  const dist = Math.hypot(dx, dy);
  if (dist < 0.05) return [origin, dest];

  // Gentle northward bow proportional to span for visual separation of dispersal lines
  const archHeight = Math.min(7.5, dist * 0.16);
  const perpX = (-dy / dist) * archHeight;
  const perpY = (Math.abs(dx / dist) * archHeight) + (dx === 0 ? 0 : 0.4);
  const ctrl: [number, number] = [
    (origin[0] + dest[0]) / 2 + perpX * 0.35,
    (origin[1] + dest[1]) / 2 + Math.max(0.8, perpY * 0.55),
  ];

  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const oneMinusT = 1 - t;
    const lon =
      oneMinusT * oneMinusT * origin[0] +
      2 * oneMinusT * t * ctrl[0] +
      t * t * dest[0];
    const lat =
      oneMinusT * oneMinusT * origin[1] +
      2 * oneMinusT * t * ctrl[1] +
      t * t * dest[1];
    coords.push([lon, lat]);
  }
  return coords;
}

function formatCoordsLabel(coords: [number, number]): string {
  const [lon, lat] = coords;
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`;
}

function zoomForRadiusKm(radiusKm: number): number {
  if (radiusKm >= 320) return 3.6;
  if (radiusKm >= 200) return 4.3;
  if (radiusKm >= 110) return 5.0;
  if (radiusKm >= 60) return 5.7;
  return 6.4;
}

// === @section:logic:style ===
function readActiveTheme(): MapTheme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function getThemePalette(theme: MapTheme) {
  return theme === 'light'
    ? { sea: '#d6e3ec', land: '#ece6d6', outline: '#b7c6d1', river: '#4e8ab3' }
    : { sea: '#101b27', land: '#1b2634', outline: '#32475c', river: '#3b76a0' };
}

function createNationsMapStyle(theme: MapTheme): Record<string, unknown> {
  const palette = getThemePalette(theme);
  return {
    version: 8,
    name: 'BibleResearch Table of Nations Global Map',
    sources: {
      'physical-relief': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 8,
      },
      'dare-ancient': {
        type: 'raster',
        tiles: ['https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 11,
      },
      'osm-modern': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
      },
      'ancient-basemap': { type: 'geojson', data: '/geo/ancient-basemap.geojson' },
      'dispersal-lines': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'settlement-radii': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'origin-points': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'settlement-points': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg-sea', type: 'background', paint: { 'background-color': palette.sea } },
      {
        id: 'ne-land',
        type: 'fill',
        source: 'ancient-basemap',
        filter: ['==', ['get', 'feature_type'], 'land'],
        paint: { 'fill-color': palette.land, 'fill-outline-color': palette.outline },
      },
      {
        id: 'ne-water',
        type: 'fill',
        source: 'ancient-basemap',
        filter: ['==', ['get', 'feature_type'], 'water'],
        paint: { 'fill-color': palette.sea, 'fill-outline-color': palette.outline },
      },
      {
        id: 'layer-physical',
        type: 'raster',
        source: 'physical-relief',
        paint: { 'raster-opacity': 0.52, 'raster-saturation': -0.35 },
      },
      {
        id: 'layer-dare',
        type: 'raster',
        source: 'dare-ancient',
        paint: { 'raster-opacity': 0.65 },
      },
      {
        id: 'layer-osm-labels',
        type: 'raster',
        source: 'osm-modern',
        paint: { 'raster-opacity': 0.18, 'raster-saturation': -0.5 },
      },
      {
        id: 'ne-rivers',
        type: 'line',
        source: 'ancient-basemap',
        filter: ['==', ['get', 'feature_type'], 'river'],
        paint: { 'line-color': palette.river, 'line-width': 1.5 },
      },
      {
        id: 'settlement-radii-fill',
        type: 'fill',
        source: 'settlement-radii',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['get', 'is_selected'], 0.2, 0.06],
        },
      },
      {
        id: 'settlement-radii-line',
        type: 'line',
        source: 'settlement-radii',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'is_selected'], 2, 1],
          'line-dasharray': [2, 2],
          'line-opacity': ['case', ['get', 'is_selected'], 0.9, 0.4],
        },
      },
      {
        id: 'dispersal-lines-layer',
        type: 'line',
        source: 'dispersal-lines',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'is_selected'], 2.8, 1.2],
          'line-dasharray': [3, 2],
          'line-opacity': ['case', ['get', 'is_selected'], 0.95, 0.38],
        },
      },
      {
        id: 'origin-points-core',
        type: 'circle',
        source: 'origin-points',
        paint: {
          'circle-radius': 6,
          'circle-color': '#f59e0b',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      },
      {
        id: 'settlement-points-halo',
        type: 'circle',
        source: 'settlement-points',
        paint: {
          'circle-radius': ['case', ['get', 'is_selected'], 15, 7],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['get', 'is_selected'], 0.34, 0.16],
        },
      },
      {
        id: 'settlement-points-core',
        type: 'circle',
        source: 'settlement-points',
        paint: {
          'circle-radius': ['case', ['get', 'is_selected'], 7.5, 5],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': ['case', ['get', 'is_selected'], 2.4, 1.4],
          'circle-stroke-color': ['case', ['get', 'is_selected'], '#ffffff', '#0d1620'],
        },
      },
    ],
  };
}

function applyThemeToNationsMap(m: import('maplibre-gl').Map, theme: MapTheme): void {
  const palette = getThemePalette(theme);
  if (m.getLayer('bg-sea')) m.setPaintProperty('bg-sea', 'background-color', palette.sea);
  if (m.getLayer('ne-water')) {
    m.setPaintProperty('ne-water', 'fill-color', palette.sea);
    m.setPaintProperty('ne-water', 'fill-outline-color', palette.outline);
  }
  if (m.getLayer('ne-land')) {
    m.setPaintProperty('ne-land', 'fill-color', palette.land);
    m.setPaintProperty('ne-land', 'fill-outline-color', palette.outline);
  }
  if (m.getLayer('ne-rivers')) m.setPaintProperty('ne-rivers', 'line-color', palette.river);
}

// === @section:ui:main ===
export function createTableOfNationsPanel(callbacks: {
  preview: ContextPreview;
  onNavigate: (p: ActivePassage) => void;
  onInspectStrongs?: (strongs: string) => void;
  onOpenPerson?: (personId: string) => void;
}): TableOfNationsHandle {
  ensureTableOfNationsStyles();

  let activeBranch: BranchFilter = 'all';
  let searchQuery = '';
  let selectedId: string = BIBLICAL_TRIBES[1]?.id ?? BIBLICAL_TRIBES[0]?.id ?? 'amorites';

  let maplibregl: MapLibreModule | null = null;
  let map: import('maplibre-gl').Map | null = null;
  let mapInitPromise: Promise<import('maplibre-gl').Map | null> | null = null;
  let mapPopup: import('maplibre-gl').Popup | null = null;
  let mapStyleReady = false;
  let webglFailed = false;
  let currentTheme: MapTheme = readActiveTheme();

  const root = el('section', 'nations-panel');
  root.setAttribute('aria-label', 'Table of Nations & Biblical Peoples');

  // Top bar
  const topbar = el('div', 'nations-topbar');
  const titleWrap = el('div', 'nations-title-wrap');
  const titleEl = el('h3', 'nations-title', 'Table of Nations & Biblical Peoples');
  const subtitleEl = el(
    'p',
    'nations-subtitle',
    `${BIBLICAL_TRIBES.length} peoples across Genesis 10, the 12 Tribes of Israel, and OT/NT neighbors`,
  );
  titleWrap.append(titleEl, subtitleEl);
  const countBadge = status(`${BIBLICAL_TRIBES.length} shown`);
  topbar.append(titleWrap, countBadge);

  // Controls: branch pills, search + quick jumps, tribe picker strip
  const controls = el('div', 'nations-controls');
  const filterRow = el('div', 'nations-filter-row');
  filterRow.setAttribute('role', 'group');
  filterRow.setAttribute('aria-label', 'Filter by lineage branch');

  const filterButtons = new Map<BranchFilter, HTMLButtonElement>();
  for (const f of BRANCH_FILTERS) {
    const btn = action('', () => {
      activeBranch = f.id;
      renderAll(false);
    }, 'nations-filter-pill');
    if (f.id !== 'all') {
      const dot = el('span', 'nations-branch-dot');
      dot.style.backgroundColor = BRANCH_COLORS[f.id];
      btn.append(dot);
    }
    btn.append(document.createTextNode(f.label));
    filterButtons.set(f.id, btn);
    filterRow.append(btn);
  }

  const searchJumpRow = el('div', 'nations-search-jump-row');
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'nations-search-input';
  searchInput.placeholder = 'Search tribe, ancestor, biblical region, modern area, or Strong’s (e.g. H567)…';
  searchInput.setAttribute('aria-label', 'Search biblical tribes and peoples');
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderAll(false);
  });

  const quickJumpsWrap = el('div', 'nations-quick-jumps');
  quickJumpsWrap.append(el('span', 'nations-quick-label', 'Quick jump:'));
  const jumpButtons = new Map<string, HTMLButtonElement>();
  for (const q of QUICK_JUMPS) {
    const btn = action(q.label, () => {
      focusTribe(q.id);
    }, 'nations-jump-btn');
    jumpButtons.set(q.id, btn);
    quickJumpsWrap.append(btn);
  }
  searchJumpRow.append(searchInput, quickJumpsWrap);

  const pickerStrip = el('div', 'nations-picker-strip');
  pickerStrip.setAttribute('role', 'listbox');
  pickerStrip.setAttribute('aria-label', 'Matching tribes and peoples');

  controls.append(filterRow, searchJumpRow, pickerStrip);

  // Main split: left map + right detail card
  const mainSplit = el('div', 'nations-main-split');

  const mapPane = el('div', 'nations-map-pane');
  const mapCanvasWrap = el('div', 'nations-map-canvas-wrap');
  const mapCanvas = el('div', 'nations-map-canvas');
  mapCanvas.setAttribute('aria-label', 'Global Dispersal and Biblical Tribes Map');
  const mapFallback = el('div', 'nations-map-fallback');
  mapFallback.hidden = true;
  mapCanvasWrap.append(mapCanvas, mapFallback);

  const mapLegend = el('div', 'nations-map-legend');
  const legendSwatches = el('div', 'nations-legend-swatches');
  for (const branch of ['Shem', 'Ham', 'Japheth', 'Israel', 'Other'] as NationBranch[]) {
    const item = el('span', 'nations-legend-item');
    const dot = el('span', 'nations-branch-dot');
    dot.style.backgroundColor = BRANCH_COLORS[branch];
    item.append(dot, document.createTextNode(branch === 'Israel' ? 'Israel' : branch));
    legendSwatches.append(item);
  }
  const legendNote = el(
    'span',
    '',
    'Dashed dispersal arcs & radii show textual/scholarly proposals, not fixed borders.',
  );
  mapLegend.append(legendSwatches, legendNote);
  mapPane.append(mapCanvasWrap, mapLegend);

  const detailPane = el('div', 'nations-detail-pane');
  mainSplit.append(mapPane, detailPane);
  root.append(topbar, controls, mainSplit);

  const themeObserver = new MutationObserver(() => {
    const next = readActiveTheme();
    if (next !== currentTheme) {
      currentTheme = next;
      if (map && mapStyleReady) applyThemeToNationsMap(map, next);
    }
  });
  if (typeof document !== 'undefined' && document.documentElement) {
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function getFilteredTribes(): BiblicalTribeEntry[] {
    const q = searchQuery.trim().toLowerCase();
    const qStrongs = /^[hg]0*\d+[a-z]*$/i.test(q) ? normalizeStrongsKey(q) : '';

    return BIBLICAL_TRIBES.filter(tribe => {
      if (activeBranch !== 'all' && tribe.branch !== activeBranch) return false;
      if (!q) return true;
      if (qStrongs && tribe.strongs.some(s => normalizeStrongsKey(s) === qStrongs)) return true;

      return (
        tribe.name.toLowerCase().includes(q) ||
        tribe.biblicalRegion.toLowerCase().includes(q) ||
        tribe.modernAreaNote.toLowerCase().includes(q) ||
        tribe.summary.toLowerCase().includes(q) ||
        (tribe.transliteration?.toLowerCase().includes(q) ?? false) ||
        (tribe.hebrew?.includes(searchQuery.trim()) ?? false) ||
        (tribe.greek?.toLowerCase().includes(q) ?? false) ||
        tribe.ancestralChain.some(step => step.toLowerCase().includes(q)) ||
        tribe.strongs.some(s => s.toLowerCase().includes(q))
      );
    });
  }

  function renderFallbackCard(tribe: BiblicalTribeEntry | undefined): void {
    mapCanvas.hidden = true;
    mapFallback.hidden = false;
    mapFallback.replaceChildren();

    if (!tribe) {
      mapFallback.append(status('No tribes match the current filter.'));
      return;
    }

    const heading = el('strong', '', `${tribe.name} — Dispersal Summary`);
    const originLine = el(
      'p',
      'nations-geo-text',
      `Proposed dispersal arc: ${formatCoordsLabel(tribe.originCoords)} → ${formatCoordsLabel(tribe.settlementCoords)} (approx. ${tribe.radiusKm} km zone)`,
    );
    const noteLine = el('p', 'nations-subtitle', CONFIDENCE_META[tribe.confidence].note);
    mapFallback.append(heading, originLine, noteLine);
  }

  function syncMapGeoJson(filtered: BiblicalTribeEntry[], selected: BiblicalTribeEntry | undefined): void {
    if (!map || !mapStyleReady) return;

    const lineFeatures = filtered.map(t => ({
      type: 'Feature',
      properties: {
        id: t.id,
        name: t.name,
        color: BRANCH_COLORS[t.branch],
        is_selected: selected?.id === t.id,
      },
      geometry: {
        type: 'LineString',
        coordinates: buildCurvedDispersalArc(t.originCoords, t.settlementCoords),
      },
    }));

    const radiiFeatures = filtered.map(t => ({
      type: 'Feature',
      properties: {
        id: t.id,
        name: t.name,
        color: BRANCH_COLORS[t.branch],
        is_selected: selected?.id === t.id,
      },
      geometry: {
        type: 'Polygon',
        coordinates: buildGeodesicCircle(t.settlementCoords[0], t.settlementCoords[1], t.radiusKm),
      },
    }));

    const pointFeatures = filtered.map(t => ({
      type: 'Feature',
      properties: {
        id: t.id,
        name: t.name,
        branch: BRANCH_LABELS[t.branch],
        confidence: CONFIDENCE_META[t.confidence].label,
        color: BRANCH_COLORS[t.branch],
        is_selected: selected?.id === t.id,
      },
      geometry: {
        type: 'Point',
        coordinates: t.settlementCoords,
      },
    }));

    const originFeatures = selected
      ? [
          {
            type: 'Feature',
            properties: { id: selected.id, name: 'Dispersal origin zone' },
            geometry: { type: 'Point', coordinates: selected.originCoords },
          },
        ]
      : [];

    (map.getSource('dispersal-lines') as import('maplibre-gl').GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: lineFeatures as never[],
    });
    (map.getSource('settlement-radii') as import('maplibre-gl').GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: radiiFeatures as never[],
    });
    (map.getSource('settlement-points') as import('maplibre-gl').GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: pointFeatures as never[],
    });
    (map.getSource('origin-points') as import('maplibre-gl').GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: originFeatures as never[],
    });
  }

  function showMapPopup(tribe: BiblicalTribeEntry): void {
    if (!maplibregl || !map) return;
    mapPopup?.remove();
    const popupEl = el('div', 'nations-map-popup');
    popupEl.append(
      el('strong', '', tribe.name),
      el('span', 'nations-subtitle', `${BRANCH_LABELS[tribe.branch]} · ${CONFIDENCE_META[tribe.confidence].label}`),
    );
    const PopupCtor = maplibregl.Popup ?? (maplibregl as unknown as { default: MapLibreModule }).default.Popup;
    mapPopup = new PopupCtor({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '250px' })
      .setLngLat(tribe.settlementCoords)
      .setDOMContent(popupEl)
      .addTo(map);
  }

  async function ensureMap(): Promise<import('maplibre-gl').Map | null> {
    if (webglFailed) return null;
    if (map && mapStyleReady) return map;
    if (mapInitPromise) return mapInitPromise;

    mapInitPromise = (async () => {
      try {
        const mod = (await import('maplibre-gl')) as unknown as { default?: MapLibreModule } & MapLibreModule;
        maplibregl = mod.default ?? mod;
        maplibregl.setWorkerUrl('/geo/maplibre-gl-worker.mjs');
        currentTheme = readActiveTheme();

        const created = new maplibregl.Map({
          container: mapCanvas,
          style: createNationsMapStyle(currentTheme) as unknown as import('maplibre-gl').StyleSpecification,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          attributionControl: false,
        });
        map = created;
        created.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
        created.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

        created.on('mouseenter', 'settlement-points-core', () => {
          created.getCanvas().style.cursor = 'pointer';
        });
        created.on('mouseleave', 'settlement-points-core', () => {
          created.getCanvas().style.cursor = '';
        });
        created.on('click', 'settlement-points-core', e => {
          const feat = e.features?.[0];
          const id = feat?.properties?.id;
          if (typeof id === 'string') {
            focusTribe(id);
          }
        });

        await new Promise<void>(resolve => {
          let settled = false;
          const done = () => {
            if (!settled) {
              settled = true;
              mapStyleReady = true;
              resolve();
            }
          };
          if (created.isStyleLoaded()) done();
          created.once('styledata', done);
          created.once('load', done);
          setTimeout(done, 1200);
        });

        applyThemeToNationsMap(created, currentTheme);
        return created;
      } catch {
        webglFailed = true;
        map = null;
        renderFallbackCard(getTribeById(selectedId));
        return null;
      }
    })();

    return mapInitPromise;
  }

  function renderDetailCard(tribe: BiblicalTribeEntry | undefined): void {
    detailPane.replaceChildren();
    if (!tribe) {
      detailPane.append(status('No biblical people match the current search or branch filter.'));
      return;
    }

    const confMeta = CONFIDENCE_META[tribe.confidence];

    // Epistemic & branch badges
    const badgeRow = el('div', 'nations-detail-badges');
    badgeRow.append(el('span', confMeta.badgeClass, confMeta.label));

    const branchBadge = el('span', 'nations-branch-badge');
    const bDot = el('span', 'nations-branch-dot');
    bDot.style.backgroundColor = BRANCH_COLORS[tribe.branch];
    branchBadge.append(bDot, document.createTextNode(BRANCH_LABELS[tribe.branch]));
    badgeRow.append(branchBadge);
    detailPane.append(badgeRow);

    // Title
    detailPane.append(el('h4', 'nations-detail-heading', tribe.name));

    // Original script & Strong's pills
    if (tribe.hebrew || tribe.greek || tribe.transliteration || tribe.strongs.length > 0) {
      const scriptRow = el('div', 'nations-script-row');
      if (tribe.hebrew) {
        const heSpan = el('span', 'nations-script-orig', tribe.hebrew);
        heSpan.dir = 'rtl';
        heSpan.lang = 'he';
        scriptRow.append(heSpan);
      }
      if (tribe.greek) {
        const elSpan = el('span', 'nations-script-orig', tribe.greek);
        elSpan.dir = 'ltr';
        elSpan.lang = 'el';
        scriptRow.append(elSpan);
      }
      if (tribe.transliteration) {
        scriptRow.append(el('span', 'study-muted', tribe.transliteration));
      }
      for (const code of tribe.strongs) {
        if (callbacks.onInspectStrongs) {
          const sBtn = action(code, () => callbacks.onInspectStrongs?.(code), 'nations-strongs-btn');
          sBtn.title = `Inspect Strong's ${code}`;
          scriptRow.append(sBtn);
        } else {
          scriptRow.append(el('span', 'nations-strongs-btn', code));
        }
      }
      detailPane.append(scriptRow);
    }

    // Ancestral breadcrumb trail + Genealogy cross-link
    const chainBox = el('div', 'nations-chain-box');
    const chainHeader = el('div', 'nations-chain-header');
    chainHeader.append(el('span', 'nations-section-label', 'Ancestral Lineage Chain'));
    if (tribe.lineagePersonId && callbacks.onOpenPerson) {
      const personId = tribe.lineagePersonId;
      const openPersonBtn = action(
        'View Patriarch in Genealogy ↗',
        () => callbacks.onOpenPerson?.(personId),
        'nations-genealogy-btn',
      );
      chainHeader.append(openPersonBtn);
    }
    const chainTrail = el('div', 'nations-chain-trail');
    tribe.ancestralChain.forEach((step, idx) => {
      if (idx > 0) chainTrail.append(el('span', 'nations-chain-arrow', '→'));
      const isLast = idx === tribe.ancestralChain.length - 1;
      chainTrail.append(el('span', isLast ? 'nations-chain-node is-leaf' : 'nations-chain-node', step));
    });
    chainBox.append(chainHeader, chainTrail);
    detailPane.append(chainBox);

    // Biblical Location & Provenance vs. Modern Geographic Area Today
    const geoSplit = el('div', 'nations-geo-split');
    const biblicalCard = el('div', 'nations-geo-card');
    biblicalCard.append(
      el('span', 'nations-section-label', 'Biblical Location & Provenance'),
      el('p', 'nations-geo-text', tribe.biblicalRegion),
    );
    const modernCard = el('div', 'nations-geo-card');
    modernCard.append(
      el('span', 'nations-section-label', 'Modern Geographic Area Today'),
      el('p', 'nations-geo-text', tribe.modernAreaNote),
    );
    geoSplit.append(biblicalCard, modernCard);
    detailPane.append(geoSplit);

    // Epistemic note
    const noteEl = el('p', 'nations-epistemic-note', confMeta.note);
    noteEl.setAttribute('role', 'note');
    detailPane.append(noteEl);

    // Summary
    detailPane.append(el('p', 'nations-summary', tribe.summary));

    // Scripture Citations
    if (tribe.sourceRefs.length > 0) {
      const refsWrap = el('div', 'nations-refs-wrap');
      refsWrap.append(el('span', 'nations-section-label', 'Scripture citations:'));
      for (const r of tribe.sourceRefs) {
        const refBtn = action(r.label, () => callbacks.onNavigate(r.passage), 'nations-ref-btn');
        refBtn.title = `Open ${r.label} in reader`;
        callbacks.preview.attach(refBtn, r.passage, `${tribe.name} — textual witness (${r.label})`);
        refsWrap.append(refBtn);
      }
      detailPane.append(refsWrap);
    }
  }

  function renderAll(shouldFlyToSelected: boolean): void {
    const filtered = getFilteredTribes();
    countBadge.textContent = `${filtered.length} of ${BIBLICAL_TRIBES.length} peoples`;

    for (const [branch, btn] of filterButtons.entries()) {
      btn.classList.toggle('is-active', branch === activeBranch);
      btn.setAttribute('aria-pressed', String(branch === activeBranch));
    }

    let selected = filtered.find(t => t.id === selectedId);
    if (!selected && filtered.length > 0) {
      selected = filtered[0];
      selectedId = selected.id;
    }

    for (const [id, btn] of jumpButtons.entries()) {
      btn.classList.toggle('is-active', selected?.id === id);
    }

    pickerStrip.replaceChildren();
    if (filtered.length === 0) {
      pickerStrip.append(status('No matching tribes. Clear search or choose another branch.'));
    } else {
      for (const tribe of filtered) {
        const pill = action('', () => {
          selectedId = tribe.id;
          renderAll(true);
        }, tribe.id === selected?.id ? 'nations-tribe-pill is-active' : 'nations-tribe-pill');
        pill.setAttribute('role', 'option');
        pill.setAttribute('aria-selected', String(tribe.id === selected?.id));
        const dot = el('span', 'nations-branch-dot');
        dot.style.backgroundColor = BRANCH_COLORS[tribe.branch];
        pill.append(dot, document.createTextNode(tribe.name));
        pickerStrip.append(pill);
      }
    }

    renderDetailCard(selected);

    if (webglFailed) {
      renderFallbackCard(selected);
      return;
    }

    if (map && mapStyleReady) {
      syncMapGeoJson(filtered, selected);
      if (selected && shouldFlyToSelected) {
        map.flyTo({
          center: selected.settlementCoords,
          zoom: zoomForRadiusKm(selected.radiusKm),
          duration: 600,
        });
        showMapPopup(selected);
      } else if (!selected) {
        mapPopup?.remove();
      }
    }
  }

  function focusTribe(tribeId?: string): void {
    const target = tribeId ? getTribeById(tribeId) : undefined;
    if (target) {
      selectedId = target.id;
      const inCurrent = getFilteredTribes().some(t => t.id === target.id);
      if (!inCurrent) {
        activeBranch = 'all';
        searchQuery = '';
        searchInput.value = '';
      }
    } else if (!getTribeById(selectedId)) {
      selectedId = BIBLICAL_TRIBES[0]?.id ?? 'amorites';
    }

    renderAll(Boolean(target));

    if (!map && !webglFailed) {
      void ensureMap().then(m => {
        if (!m) return;
        const filtered = getFilteredTribes();
        const active = filtered.find(t => t.id === selectedId);
        syncMapGeoJson(filtered, active);
        if (target && active) {
          m.flyTo({
            center: active.settlementCoords,
            zoom: zoomForRadiusKm(active.radiusKm),
            duration: 550,
          });
          showMapPopup(active);
        }
      });
    }
  }

  // Initial render + lazy map bootstrap
  renderAll(false);
  void ensureMap().then(m => {
    if (!m) return;
    const filtered = getFilteredTribes();
    const active = filtered.find(t => t.id === selectedId);
    syncMapGeoJson(filtered, active);
  });

  return {
    element: root,
    focusTribe,
    resize() {
      map?.resize();
    },
  };
}
