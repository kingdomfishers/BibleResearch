// @file: src/ui/components/VerseMapCanvas.ts
// @feature: verse-reader
// @tables: places | place_locations | verse_geography | passage_geography
// @candidates: map-style-builder
// @toc: imports | types | logic:style | logic:features | logic:viewport | ui:markers | ui:popup | logic:layers | ui:init | ui:main

// === @section:imports ===
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeographyEraPlace, GeographyLocation, VerseGeographyPacket } from '../../api/types';
import { type CuratedMediaAsset, getMediaForPlace, renderMediaFigure } from '../context-tools/curated-media-manifest';

// === @section:types ===
export type BasemapMode = 'hybrid' | 'historical' | 'modern';
export type MapTheme = 'light' | 'dark';

export interface RouteStats {
  totalKm: number;
  totalMiles: number;
  walkDays: number;
  pointCount: number;
}

export interface VerseMapCanvasHandle {
  renderPacket: (packet: VerseGeographyPacket | null, selectedAltIds: Record<string, string>) => Promise<void>;
  focusPlace: (placeKey: string, altId?: string) => void;
  setBasemapMode: (mode: BasemapMode) => Promise<void>;
  setEraGazetteerVisible: (visible: boolean) => Promise<void>;
  setTheme: (theme: MapTheme) => void;
  getRouteStats: () => RouteStats;
  resize: () => void;
}
type MapLibreModule = typeof import('maplibre-gl');

// === @section:logic:style ===
function readActiveTheme(): MapTheme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function getThemePalette(theme: MapTheme) {
  return theme === 'light'
    ? { sea: '#d6e3ec', land: '#ece6d6', outline: '#b7c6d1', river: '#4e8ab3' }
    : { sea: '#101b27', land: '#1b2634', outline: '#32475c', river: '#3b76a0' };
}

function createMapStyle(theme: MapTheme): Record<string, unknown> {
  const palette = getThemePalette(theme);
  return {
    version: 8,
    name: 'BibleResearch Historical & Modern Open Map',
    sources: {
      'physical-relief': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 8,
        attribution: 'US National Park Service Physical Relief (Public Domain)',
      },
      'dare-ancient': {
        type: 'raster',
        tiles: ['https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 11,
        attribution: '© Digital Atlas of the Roman Empire / Pelagios (CC BY-SA 3.0)',
      },
      'osm-modern': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors (ODbL)',
      },
      'ancient-basemap': { type: 'geojson', data: '/geo/ancient-basemap.geojson' },
      'verse-uncertainty': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'verse-regions': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'verse-routes': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'verse-points': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg-sea', type: 'background', paint: { 'background-color': palette.sea } },
      { id: 'ne-land', type: 'fill', source: 'ancient-basemap', filter: ['==', ['get', 'feature_type'], 'land'], paint: { 'fill-color': palette.land, 'fill-outline-color': palette.outline } },
      { id: 'ne-water', type: 'fill', source: 'ancient-basemap', filter: ['==', ['get', 'feature_type'], 'water'], paint: { 'fill-color': palette.sea, 'fill-outline-color': palette.outline } },
      { id: 'layer-physical', type: 'raster', source: 'physical-relief', paint: { 'raster-opacity': 0.55, 'raster-saturation': -0.35 } },
      { id: 'layer-cawm', type: 'raster', source: 'dare-ancient', paint: { 'raster-opacity': 0.72 } },
      { id: 'layer-osm', type: 'raster', source: 'osm-modern', paint: { 'raster-opacity': 0.24, 'raster-saturation': -0.4 } },
      { id: 'ne-rivers', type: 'line', source: 'ancient-basemap', filter: ['==', ['get', 'feature_type'], 'river'], paint: { 'line-color': palette.river, 'line-width': 1.8 } },
      { id: 'verse-uncertainty-fill', type: 'fill', source: 'verse-uncertainty', paint: { 'fill-color': ['match', ['get', 'confidence'], 'established', '#2f9e66', 'probable', '#d4af37', 'disputed', '#d97724', '#60a5fa'], 'fill-opacity': 0.11 } },
      { id: 'verse-uncertainty-line', type: 'line', source: 'verse-uncertainty', paint: { 'line-color': ['match', ['get', 'confidence'], 'established', '#2f9e66', 'probable', '#d4af37', 'disputed', '#d97724', '#60a5fa'], 'line-width': 1.5, 'line-dasharray': [2, 3], 'line-opacity': 0.65 } },
      { id: 'verse-region-fill', type: 'fill', source: 'verse-regions', paint: { 'fill-color': ['match', ['get', 'confidence'], 'established', '#2f9e66', 'probable', '#d4af37', 'disputed', '#d97724', '#60a5fa'], 'fill-opacity': 0.22 } },
      { id: 'verse-region-line', type: 'line', source: 'verse-regions', paint: { 'line-color': ['match', ['get', 'confidence'], 'established', '#2f9e66', 'probable', '#d4af37', 'disputed', '#d97724', '#60a5fa'], 'line-width': 2.2, 'line-dasharray': [3, 2] } },
      { id: 'verse-route-line', type: 'line', source: 'verse-routes', paint: { 'line-color': '#d4af37', 'line-width': 2.6, 'line-dasharray': [2, 2] } },
      { id: 'verse-point-halo', type: 'circle', source: 'verse-points', paint: { 'circle-radius': ['case', ['get', 'is_alternative'], 9, 13], 'circle-color': ['match', ['get', 'visual_class'], 'established', 'rgba(47,158,102,0.32)', 'probable', 'rgba(212,175,55,0.32)', 'disputed', 'rgba(217,119,36,0.34)', 'rgba(90,125,154,0.28)'] } },
      { id: 'verse-point-core', type: 'circle', source: 'verse-points', paint: { 'circle-radius': ['case', ['get', 'is_alternative'], 5.5, 7.5], 'circle-color': ['match', ['get', 'visual_class'], 'established', '#2f9e66', 'probable', '#d4af37', 'disputed', '#d97724', 'mentioned', '#5a7d9a', '#60a5fa'], 'circle-stroke-width': 2, 'circle-stroke-color': ['case', ['get', 'is_selected_alt'], '#ffffff', '#0d1620'] } },
    ],
  };
}

// === @section:logic:features ===
const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function haversineKm(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * DEG_TO_RAD;
  const dLon = (b[0] - a[0]) * DEG_TO_RAD;
  const lat1 = a[1] * DEG_TO_RAD;
  const lat2 = b[1] * DEG_TO_RAD;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function buildCirclePolygon(lon: number, lat: number, radiusKm: number, steps = 48): [number, number][][] {
  const angularDist = radiusKm / EARTH_RADIUS_KM;
  const latRad = lat * DEG_TO_RAD;
  const lonRad = lon * DEG_TO_RAD;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * (i % steps)) / steps;
    const sinLat = Math.sin(latRad) * Math.cos(angularDist) +
      Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearing);
    const destLat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    const destLon = lonRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDist) * Math.cos(latRad),
      Math.cos(angularDist) - Math.sin(latRad) * Math.sin(destLat),
    );
    ring.push([destLon * RAD_TO_DEG, destLat * RAD_TO_DEG]);
  }
  return [ring];
}

function resolveUncertaintyRadiusKm(
  precisionKind: string,
  confidenceLevel: string,
  locationStatus: string,
): number | null {
  if (
    precisionKind === 'approximate_region' ||
    confidenceLevel === 'disputed' ||
    confidenceLevel === 'regional' ||
    locationStatus === 'disputed' ||
    locationStatus === 'regional_only'
  ) {
    return 18;
  }
  if (precisionKind === 'site_area' || confidenceLevel === 'probable') {
    return 6;
  }
  return null;
}

export function computeRouteStats(
  locations: GeographyLocation[],
  selectedAltIds: Record<string, string>,
): RouteStats {
  const coords: [number, number][] = [];
  for (const loc of locations) {
    if (loc.is_non_physical || loc.relationship_type === 'mentioned_location') continue;
    const chosenAltId = selectedAltIds[loc.place_key];
    const activeAlt = loc.alternative_locations.find(a => a.id === chosenAltId)
      ?? loc.alternative_locations.find(a => a.rank_order === 1);
    const lat = activeAlt?.latitude ?? loc.latitude;
    const lon = activeAlt?.longitude ?? loc.longitude;
    if (lat === null || lon === null) continue;
    coords.push([lon, lat]);
  }
  let totalKm = 0;
  for (let i = 1; i < coords.length; i++) {
    totalKm += haversineKm(coords[i - 1], coords[i]);
  }
  const totalMiles = totalKm * 0.621371;
  const walkDays = totalKm > 0 ? Math.round((totalKm / 30) * 10) / 10 : 0;
  return { totalKm, totalMiles, walkDays, pointCount: coords.length };
}

function buildGeoJsonCollections(locations: GeographyLocation[], selectedAltIds: Record<string, string>) {
  const points: Record<string, unknown>[] = [];
  const regions: Record<string, unknown>[] = [];
  const routes: Record<string, unknown>[] = [];
  const uncertainties: Record<string, unknown>[] = [];
  const routeCoords: [number, number][] = [];
  for (const loc of locations) {
    if (loc.is_non_physical) continue;
    const chosenAltId = selectedAltIds[loc.place_key];
    const activeAlt = loc.alternative_locations.find(a => a.id === chosenAltId);
    const geom = activeAlt?.geometry ?? loc.geometry;
    const visualClass = loc.relationship_type === 'mentioned_location' ? 'mentioned'
      : loc.confidence_level === 'established' ? 'established'
        : loc.confidence_level === 'disputed' ? 'disputed' : 'probable';
    if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
      regions.push({ type: 'Feature', properties: { place_key: loc.place_key, biblical_name: loc.biblical_name, confidence: loc.confidence_level }, geometry: geom });
    }
    const primaryCandidate = {
      id: loc.place_id, rank_order: 1, modern_name: loc.modern_name ?? loc.biblical_name,
      latitude: loc.latitude, longitude: loc.longitude, geometry: loc.geometry, bbox: loc.bbox,
      precision_kind: loc.precision_kind, location_status: loc.location_status, confidence_label: loc.confidence_label,
      raw_source_score: loc.raw_source_score, is_alternative: false, evidence_summary: loc.identification_evidence, source_citations: loc.source_citations,
    };
    const hasPrimaryInAlts = loc.alternative_locations.some(a => a.rank_order === 1);
    const altsToRender = loc.alternative_locations.length === 0 ? [primaryCandidate]
      : hasPrimaryInAlts ? loc.alternative_locations : [primaryCandidate, ...loc.alternative_locations];
    for (const alt of altsToRender) {
      if (alt.latitude === null || alt.longitude === null) continue;
      const isSelected = activeAlt ? alt.id === activeAlt.id : alt.rank_order === 1;
      if (isSelected && loc.relationship_type !== 'mentioned_location') {
        routeCoords.push([alt.longitude, alt.latitude]);
      }
      if (isSelected) {
        const radiusKm = resolveUncertaintyRadiusKm(alt.precision_kind, loc.confidence_level, alt.location_status);
        if (radiusKm !== null) {
          uncertainties.push({
            type: 'Feature',
            properties: { place_key: loc.place_key, confidence: loc.confidence_level, radius_km: radiusKm },
            geometry: { type: 'Polygon', coordinates: buildCirclePolygon(alt.longitude, alt.latitude, radiusKm) },
          });
        }
      }
      points.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [alt.longitude, alt.latitude] },
        properties: {
          place_key: loc.place_key, alt_id: alt.id, biblical_name: loc.biblical_name,
          ancient_name: loc.ancient_name ?? loc.biblical_name,
          modern_name: alt.modern_name, relationship_type: loc.relationship_type,
          confidence_level: loc.confidence_level, confidence_label: alt.confidence_label,
          evidence_explanation: loc.evidence_explanation, establishing_refs: loc.establishing_refs,
          source_url: alt.source_citations[0]?.url ?? loc.source.attribution,
          strongs_csv: loc.strongs_numbers.join(','),
          visual_class: visualClass, is_alternative: !isSelected, is_selected_alt: isSelected,
        },
      });
    }
  }
  if (routeCoords.length >= 2) {
    routes.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords } });
  }
  return { points, regions, routes, uncertainties };
}

// === @section:logic:viewport ===
function computeTargetBounds(points: Record<string, unknown>[], packetBounds: number[] | null): [[number, number], [number, number]] | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const pt of points) {
    const coords = (pt.geometry as { coordinates: [number, number] }).coordinates;
    if (coords[0] < minLon) minLon = coords[0];
    if (coords[0] > maxLon) maxLon = coords[0];
    if (coords[1] < minLat) minLat = coords[1];
    if (coords[1] > maxLat) maxLat = coords[1];
  }
  if (!Number.isFinite(minLon) && packetBounds && packetBounds.length === 4) {
    [minLon, minLat, maxLon, maxLat] = packetBounds;
  }
  if (!Number.isFinite(minLon)) return null;
  const padLon = Math.max((maxLon - minLon) * 0.28, 0.55);
  const padLat = Math.max((maxLat - minLat) * 0.28, 0.45);
  return [[minLon - padLon, minLat - padLat], [maxLon + padLon, maxLat + padLat]];
}

// === @section:ui:markers ===
const shortRoleBadge: Record<string, string> = {
  event_location: 'EVENT',
  contextual_location: 'SETTING',
  audience_location: 'WRITTEN TO',
  composition_location: 'WRITTEN FROM',
  travel_origin: 'ORIGIN',
  travel_destination: 'DESTINATION',
  mentioned_location: 'MENTIONED',
  uncertain_location: 'ROUTE / REGION',
};

function renderDomMarkers(
  maplibregl: MapLibreModule,
  map: import('maplibre-gl').Map,
  points: Record<string, unknown>[],
  eraGazetteer: GeographyEraPlace[],
  mode: BasemapMode,
  showGazetteer: boolean,
  onMarkerClick: (coords: [number, number], props: Record<string, string>) => void,
  onGazetteerClick: (gp: GeographyEraPlace) => void,
): import('maplibre-gl').Marker[] {
  const markers: import('maplibre-gl').Marker[] = [];
  const activeKeys = new Set<string>();
  const MarkerCtor = maplibregl.Marker ?? (maplibregl as unknown as { default: MapLibreModule }).default.Marker;
  for (const pt of points) {
    const props = pt.properties as Record<string, string>;
    activeKeys.add(props.place_key);
    if (String(props.is_selected_alt) === 'false') continue;
    const coords = (pt.geometry as { coordinates: [number, number] }).coordinates;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `map-ancient-pin rel-${props.relationship_type} conf-${props.confidence_level}`;
    const roleText = shortRoleBadge[props.relationship_type] ?? 'PLACE';
    const primaryLabel = mode === 'modern' ? (props.modern_name || props.biblical_name) : (props.ancient_name || props.biblical_name);
    const subLabel = mode === 'historical' ? ''
      : mode === 'modern' ? `Ancient: ${props.ancient_name || props.biblical_name}`
        : `Modern: ${props.modern_name || props.biblical_name}`;

    const roleSpan = document.createElement('span');
    roleSpan.className = 'pin-role';
    roleSpan.textContent = roleText;

    const ancientSpan = document.createElement('span');
    ancientSpan.className = 'pin-ancient';
    ancientSpan.textContent = primaryLabel;

    el.append(roleSpan, ancientSpan);
    if (subLabel) {
      const modernSpan = document.createElement('span');
      modernSpan.className = 'pin-modern';
      modernSpan.textContent = subLabel;
      el.append(modernSpan);
    }

    el.addEventListener('click', ev => { ev.stopPropagation(); onMarkerClick(coords, props); });
    markers.push(new MarkerCtor({ element: el, anchor: 'bottom', offset: [0, -8] }).setLngLat(coords).addTo(map));
  }
  if (showGazetteer) {
    for (const gp of eraGazetteer) {
      if (activeKeys.has(gp.place_key) || gp.latitude == null || gp.longitude == null) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-era-gazetteer-label';
      el.title = `Contemporary Biblical Place (${gp.place_type}): ${gp.ancient_name} · Modern: ${gp.modern_name ?? gp.biblical_name}`;
      el.textContent = mode === 'modern' ? `${gp.biblical_name} (${gp.modern_name ?? ''})` : gp.ancient_name;
      el.addEventListener('click', ev => { ev.stopPropagation(); onGazetteerClick(gp); });
      markers.push(new MarkerCtor({ element: el, anchor: 'center' }).setLngLat([gp.longitude, gp.latitude]).addTo(map));
    }
  }
  return markers;
}

// === @section:ui:popup ===
function buildPopupDom(
  props: Record<string, string>,
  onOpenLightbox?: (asset: CuratedMediaAsset) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'map-popup-card';

  const title = document.createElement('strong');
  title.className = 'map-popup-title';
  title.textContent = props.ancient_name || props.biblical_name;

  const sub = document.createElement('div');
  sub.className = 'map-popup-sub';
  sub.textContent = `Biblical: ${props.biblical_name} · Modern: ${props.modern_name || 'Regional / Unidentified'}`;

  const meta = document.createElement('div');
  meta.className = 'map-popup-meta';
  const relCode = document.createElement('code');
  relCode.textContent = props.relationship_type;
  const confStrong = document.createElement('strong');
  confStrong.textContent = props.confidence_level;
  meta.append(relCode, document.createTextNode(' · '), confStrong, document.createTextNode(` (${props.confidence_label})`));

  const evidence = document.createElement('div');
  evidence.className = 'map-popup-evidence';
  evidence.textContent = props.evidence_explanation;

  const refs = document.createElement('div');
  refs.className = 'map-popup-refs';
  refs.textContent = `Refs: ${props.establishing_refs}`;
  if (props.source_url?.startsWith('http://') || props.source_url?.startsWith('https://')) {
    const link = document.createElement('a');
    link.href = props.source_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'map-popup-link';
    link.textContent = 'Source citation ↗';
    refs.append(document.createTextNode(' '), link);
  }

  wrap.append(title, sub, meta, evidence, refs);

  const strongsList = props.strongs_csv
    ? props.strongs_csv.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;
  const mediaMatches = getMediaForPlace({
    place_key: props.place_key,
    biblical_name: props.biblical_name,
    ancient_name: props.ancient_name,
    strongs_numbers: strongsList,
  });
  if (mediaMatches.length > 0) {
    const mediaBox = document.createElement('div');
    mediaBox.className = 'map-popup-media';
    mediaBox.append(renderMediaFigure(mediaMatches[0], { compact: true, onOpenLightbox }));
    wrap.append(mediaBox);
  }

  return wrap;
}

function buildGazetteerPopupDom(
  gp: GeographyEraPlace,
  onOpenLightbox?: (asset: CuratedMediaAsset) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'map-popup-card';

  const title = document.createElement('strong');
  title.className = 'map-popup-title';
  title.textContent = gp.ancient_name || gp.biblical_name;

  const sub = document.createElement('div');
  sub.className = 'map-popup-sub';
  sub.textContent = `Biblical: ${gp.biblical_name} · Modern: ${gp.modern_name || 'Regional / Unidentified'}`;

  const meta = document.createElement('div');
  meta.className = 'map-popup-meta';
  const typeCode = document.createElement('code');
  typeCode.textContent = gp.place_type;
  meta.append(document.createTextNode('Era Gazetteer · '), typeCode);

  const coordsEl = document.createElement('div');
  coordsEl.className = 'map-popup-refs';
  coordsEl.textContent = `Coordinates: ${gp.latitude.toFixed(4)}°N, ${gp.longitude.toFixed(4)}°E`;

  wrap.append(title, sub, meta, coordsEl);

  const mediaMatches = getMediaForPlace({
    place_key: gp.place_key,
    biblical_name: gp.biblical_name,
    ancient_name: gp.ancient_name,
  });
  if (mediaMatches.length > 0) {
    const mediaBox = document.createElement('div');
    mediaBox.className = 'map-popup-media';
    mediaBox.append(renderMediaFigure(mediaMatches[0], { compact: true, onOpenLightbox }));
    wrap.append(mediaBox);
  }

  return wrap;
}

function setGeoJsonSources(
  m: import('maplibre-gl').Map,
  points: Record<string, unknown>[],
  regions: Record<string, unknown>[],
  routes: Record<string, unknown>[],
  uncertainties: Record<string, unknown>[],
) {
  (m.getSource('verse-uncertainty') as import('maplibre-gl').GeoJSONSource)?.setData({ type: 'FeatureCollection', features: uncertainties as never[] });
  (m.getSource('verse-points') as import('maplibre-gl').GeoJSONSource)?.setData({ type: 'FeatureCollection', features: points as never[] });
  (m.getSource('verse-regions') as import('maplibre-gl').GeoJSONSource)?.setData({ type: 'FeatureCollection', features: regions as never[] });
  (m.getSource('verse-routes') as import('maplibre-gl').GeoJSONSource)?.setData({ type: 'FeatureCollection', features: routes as never[] });
}

// === @section:logic:layers ===
function applyBasemapModeToLayers(m: import('maplibre-gl').Map, mode: BasemapMode) {
  if (m.getLayer('layer-physical')) m.setPaintProperty('layer-physical', 'raster-opacity', mode === 'modern' ? 0 : 0.65);
  if (m.getLayer('layer-cawm')) m.setPaintProperty('layer-cawm', 'raster-opacity', mode === 'historical' ? 0.92 : mode === 'hybrid' ? 0.72 : 0);
  if (m.getLayer('layer-osm')) m.setPaintProperty('layer-osm', 'raster-opacity', mode === 'modern' ? 0.92 : mode === 'hybrid' ? 0.24 : 0);
}

function applyThemeToMap(m: import('maplibre-gl').Map, theme: MapTheme) {
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

// === @section:ui:init ===
export function createVerseMapCanvas(
  container: HTMLElement,
  onSelectPlace: (placeKey: string, altId?: string) => void,
  onOpenLightbox?: (asset: CuratedMediaAsset) => void,
): VerseMapCanvasHandle {
  let maplibregl: MapLibreModule | null = null;
  let map: import('maplibre-gl').Map | null = null;
  let mapInitPromise: Promise<import('maplibre-gl').Map> | null = null;
  let popup: import('maplibre-gl').Popup | null = null;
  let domMarkers: import('maplibre-gl').Marker[] = [];
  let currentPoints: Record<string, unknown>[] = [];
  let currentEraGazetteer: GeographyEraPlace[] = [];
  let currentMode: BasemapMode = 'hybrid';
  let currentTheme: MapTheme = readActiveTheme();
  let currentRouteStats: RouteStats = { totalKm: 0, totalMiles: 0, walkDays: 0, pointCount: 0 };
  let showGazetteer = true;
  let mapStyleReady = false;

  function clearMarkers() { domMarkers.forEach(mk => mk.remove()); domMarkers = []; }
  function openPopupNode(coords: [number, number], content: HTMLElement) {
    if (!maplibregl || !map) return;
    popup?.remove();
    const PopupCtor = maplibregl.Popup ?? (maplibregl as unknown as { default: MapLibreModule }).default.Popup;
    popup = new PopupCtor({ closeOnClick: false, offset: 14, maxWidth: '300px' })
      .setLngLat(coords)
      .setDOMContent(content)
      .addTo(map);
  }
  function openPopupAt(coords: [number, number], props: Record<string, string>) {
    openPopupNode(coords, buildPopupDom(props, onOpenLightbox));
  }
  function openGazetteerPopup(gp: GeographyEraPlace) {
    openPopupNode([gp.longitude, gp.latitude], buildGazetteerPopupDom(gp, onOpenLightbox));
  }
  function refreshDomMarkers() {
    if (!maplibregl || !map) return;
    clearMarkers();
    domMarkers = renderDomMarkers(
      maplibregl,
      map,
      currentPoints,
      currentEraGazetteer,
      currentMode,
      showGazetteer,
      (coords, props) => {
        openPopupAt(coords, props);
        onSelectPlace(props.place_key, props.alt_id);
      },
      gp => {
        openGazetteerPopup(gp);
      },
    );
  }

  const themeObserver = new MutationObserver(() => {
    const next = readActiveTheme();
    if (next !== currentTheme) {
      currentTheme = next;
      if (map && mapStyleReady) applyThemeToMap(map, next);
    }
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  async function ensureMap() {
    if (map && mapStyleReady) return map;
    if (mapInitPromise) return mapInitPromise;
    mapInitPromise = (async () => {
      const mod = await import('maplibre-gl') as unknown as { default?: MapLibreModule } & MapLibreModule;
      maplibregl = mod.default ?? mod;
      maplibregl.setWorkerUrl('/geo/maplibre-gl-worker.mjs');
      currentTheme = readActiveTheme();
      map = new maplibregl.Map({
        container, style: createMapStyle(currentTheme) as unknown as import('maplibre-gl').StyleSpecification,
        center: [35.23, 31.78], zoom: 5.5, attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
      map.on('click', 'verse-point-core', e => {
        const feat = e.features?.[0];
        if (!feat || !maplibregl || !map) return;
        const props = feat.properties as Record<string, string>;
        const coords = (feat.geometry as unknown as { coordinates: [number, number] }).coordinates.slice() as [number, number];
        openPopupAt(coords, props);
        onSelectPlace(props.place_key, props.alt_id);
      });
      await new Promise<void>(resolve => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; mapStyleReady = true; resolve(); } };
        if (map!.isStyleLoaded()) done();
        map!.once('styledata', done);
        map!.once('load', done);
        setTimeout(done, 1200);
      });
      applyThemeToMap(map!, currentTheme);
      applyBasemapModeToLayers(map!, currentMode);
      return map!;
    })();
    return mapInitPromise;
  }

  // === @section:ui:main ===
  return {
    async renderPacket(packet, selectedAltIds) {
      const m = await ensureMap();
      popup?.remove();
      if (!packet || !packet.has_physical_location || packet.locations.length === 0) {
        currentPoints = [];
        currentEraGazetteer = [];
        currentRouteStats = { totalKm: 0, totalMiles: 0, walkDays: 0, pointCount: 0 };
        clearMarkers();
        setGeoJsonSources(m, [], [], [], []);
        return;
      }
      const { points, regions, routes, uncertainties } = buildGeoJsonCollections(packet.locations, selectedAltIds);
      currentPoints = points;
      currentEraGazetteer = packet.era_gazetteer ?? [];
      currentRouteStats = computeRouteStats(packet.locations, selectedAltIds);
      setGeoJsonSources(m, points, regions, routes, uncertainties);
      refreshDomMarkers();
      const targetBounds = computeTargetBounds(points, packet.bounds);
      if (targetBounds) {
        m.fitBounds(targetBounds, { padding: 64, maxZoom: 7.5, duration: 450 });
      }
    },
    focusPlace(placeKey, altId) {
      if (!map) return;
      const match = currentPoints.find(pt => {
        const p = pt.properties as Record<string, unknown>;
        return p.place_key === placeKey && (altId ? p.alt_id === altId : Boolean(p.is_selected_alt));
      }) ?? currentPoints.find(pt => (pt.properties as Record<string, unknown>).place_key === placeKey);
      if (!match) return;
      const coords = (match.geometry as { coordinates: [number, number] }).coordinates;
      map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 9), duration: 550 });
      openPopupAt(coords, match.properties as Record<string, string>);
    },
    async setBasemapMode(mode) {
      currentMode = mode;
      const m = await ensureMap();
      applyBasemapModeToLayers(m, mode);
      refreshDomMarkers();
    },
    async setEraGazetteerVisible(visible) {
      showGazetteer = visible;
      await ensureMap();
      refreshDomMarkers();
    },
    setTheme(theme) {
      currentTheme = theme;
      if (map && mapStyleReady) applyThemeToMap(map, theme);
    },
    getRouteStats() {
      return { ...currentRouteStats };
    },
    resize() { map?.resize(); },
  };
}
