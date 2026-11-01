// @file: src/ui/components/VerseMapCanvas.ts
// @feature: verse-reader
// @tables: places | place_locations | verse_geography | passage_geography
// @candidates: map-style-builder
// @toc: imports | types | logic:style | logic:features | logic:viewport | ui:markers | ui:popup | logic:layers | ui:init | ui:main

// === @section:imports ===
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeographyEraPlace, GeographyLocation, VerseGeographyPacket } from '../../api/types';

// === @section:types ===
export type BasemapMode = 'hybrid' | 'historical' | 'modern';
export interface VerseMapCanvasHandle {
  renderPacket: (packet: VerseGeographyPacket | null, selectedAltIds: Record<string, string>) => Promise<void>;
  focusPlace: (placeKey: string, altId?: string) => void;
  setBasemapMode: (mode: BasemapMode) => Promise<void>;
  setEraGazetteerVisible: (visible: boolean) => Promise<void>;
  resize: () => void;
}
type MapLibreModule = typeof import('maplibre-gl');

// === @section:logic:style ===
function createMapStyle(): Record<string, unknown> {
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
      'verse-regions': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'verse-routes': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'verse-points': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg-sea', type: 'background', paint: { 'background-color': '#101b27' } },
      { id: 'ne-land', type: 'fill', source: 'ancient-basemap', filter: ['==', ['get', 'feature_type'], 'land'], paint: { 'fill-color': '#1b2634', 'fill-outline-color': '#32475c' } },
      { id: 'ne-water', type: 'fill', source: 'ancient-basemap', filter: ['==', ['get', 'feature_type'], 'water'], paint: { 'fill-color': '#101b27', 'fill-outline-color': '#32475c' } },
      { id: 'layer-physical', type: 'raster', source: 'physical-relief', paint: { 'raster-opacity': 0.55, 'raster-saturation': -0.35 } },
      { id: 'layer-cawm', type: 'raster', source: 'dare-ancient', paint: { 'raster-opacity': 0.72 } },
      { id: 'layer-osm', type: 'raster', source: 'osm-modern', paint: { 'raster-opacity': 0.24, 'raster-saturation': -0.4 } },
      { id: 'ne-rivers', type: 'line', source: 'ancient-basemap', filter: ['==', ['get', 'feature_type'], 'river'], paint: { 'line-color': '#3b76a0', 'line-width': 1.8 } },
      { id: 'verse-region-fill', type: 'fill', source: 'verse-regions', paint: { 'fill-color': ['match', ['get', 'confidence'], 'established', '#2f9e66', 'probable', '#d4af37', 'disputed', '#d97724', '#60a5fa'], 'fill-opacity': 0.22 } },
      { id: 'verse-region-line', type: 'line', source: 'verse-regions', paint: { 'line-color': ['match', ['get', 'confidence'], 'established', '#2f9e66', 'probable', '#d4af37', 'disputed', '#d97724', '#60a5fa'], 'line-width': 2.2, 'line-dasharray': [3, 2] } },
      { id: 'verse-route-line', type: 'line', source: 'verse-routes', paint: { 'line-color': '#d4af37', 'line-width': 2.6, 'line-dasharray': [2, 2] } },
      { id: 'verse-point-halo', type: 'circle', source: 'verse-points', paint: { 'circle-radius': ['case', ['get', 'is_alternative'], 9, 13], 'circle-color': ['match', ['get', 'visual_class'], 'established', 'rgba(47,158,102,0.32)', 'probable', 'rgba(212,175,55,0.32)', 'disputed', 'rgba(217,119,36,0.34)', 'rgba(90,125,154,0.28)'] } },
      { id: 'verse-point-core', type: 'circle', source: 'verse-points', paint: { 'circle-radius': ['case', ['get', 'is_alternative'], 5.5, 7.5], 'circle-color': ['match', ['get', 'visual_class'], 'established', '#2f9e66', 'probable', '#d4af37', 'disputed', '#d97724', 'mentioned', '#5a7d9a', '#60a5fa'], 'circle-stroke-width': 2, 'circle-stroke-color': ['case', ['get', 'is_selected_alt'], '#ffffff', '#0d1620'] } },
    ],
  };
}

// === @section:logic:features ===
function buildGeoJsonCollections(locations: GeographyLocation[], selectedAltIds: Record<string, string>) {
  const points: Record<string, unknown>[] = [];
  const regions: Record<string, unknown>[] = [];
  const routes: Record<string, unknown>[] = [];
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
          visual_class: visualClass, is_alternative: !isSelected, is_selected_alt: isSelected,
        },
      });
    }
  }
  if (routeCoords.length >= 2) {
    routes.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords } });
  }
  return { points, regions, routes };
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
): import('maplibre-gl').Marker[] {
  const markers: import('maplibre-gl').Marker[] = [];
  const activeKeys = new Set<string>();
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
    el.innerHTML = `<span class="pin-role">${roleText}</span>
      <span class="pin-ancient">${primaryLabel}</span>
      ${subLabel ? `<span class="pin-modern">${subLabel}</span>` : ''}`;
    el.addEventListener('click', ev => { ev.stopPropagation(); onMarkerClick(coords, props); });
    const MarkerCtor = maplibregl.Marker ?? (maplibregl as unknown as { default: MapLibreModule }).default.Marker;
    markers.push(new MarkerCtor({ element: el, anchor: 'bottom', offset: [0, -8] }).setLngLat(coords).addTo(map));
  }
  if (showGazetteer) {
    const MarkerCtor = maplibregl.Marker ?? (maplibregl as unknown as { default: MapLibreModule }).default.Marker;
    for (const gp of eraGazetteer) {
      if (activeKeys.has(gp.place_key) || gp.latitude == null || gp.longitude == null) continue;
      const el = document.createElement('div');
      el.className = 'map-era-gazetteer-label';
      el.title = `Contemporary Biblical Place (${gp.place_type}): ${gp.ancient_name} · Modern: ${gp.modern_name ?? gp.biblical_name}`;
      el.textContent = mode === 'modern' ? `${gp.biblical_name} (${gp.modern_name ?? ''})` : gp.ancient_name;
      markers.push(new MarkerCtor({ element: el, anchor: 'center' }).setLngLat([gp.longitude, gp.latitude]).addTo(map));
    }
  }
  return markers;
}

// === @section:ui:popup ===
function buildPopupHtml(props: Record<string, string>): string {
  const linkHtml = props.source_url?.startsWith('http')
    ? `<a href="${props.source_url}" target="_blank" rel="noopener noreferrer" style="color:#d4af37">Source citation ↗</a>` : '';
  return `<div><strong style="color:#d4af37;font-size:13px">${props.ancient_name || props.biblical_name}</strong>
    <div style="color:#cbd5e1;font-size:11px;margin-bottom:2px">Biblical: ${props.biblical_name} · Modern: ${props.modern_name || 'Regional / Unidentified'}</div>
    <div style="font-size:11px;margin-bottom:4px"><code>${props.relationship_type}</code> · <strong>${props.confidence_level}</strong> (${props.confidence_label})</div>
    <div style="font-size:11.5px;margin-bottom:4px">${props.evidence_explanation}</div>
    <div style="color:#9ca3af;font-size:10.5px">Refs: ${props.establishing_refs} ${linkHtml}</div></div>`;
}
function setGeoJsonSources(
  m: import('maplibre-gl').Map,
  points: Record<string, unknown>[],
  regions: Record<string, unknown>[],
  routes: Record<string, unknown>[],
) {
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

// === @section:ui:init ===
export function createVerseMapCanvas(container: HTMLElement, onSelectPlace: (placeKey: string, altId?: string) => void): VerseMapCanvasHandle {
  let maplibregl: MapLibreModule | null = null;
  let map: import('maplibre-gl').Map | null = null;
  let mapInitPromise: Promise<import('maplibre-gl').Map> | null = null;
  let popup: import('maplibre-gl').Popup | null = null;
  let domMarkers: import('maplibre-gl').Marker[] = [];
  let currentPoints: Record<string, unknown>[] = [];
  let currentEraGazetteer: GeographyEraPlace[] = [];
  let currentMode: BasemapMode = 'hybrid';
  let showGazetteer = true;
  let mapStyleReady = false;
  function clearMarkers() { domMarkers.forEach(mk => mk.remove()); domMarkers = []; }
  function openPopupAt(coords: [number, number], props: Record<string, string>) {
    if (!maplibregl || !map) return;
    popup?.remove();
    const PopupCtor = maplibregl.Popup ?? (maplibregl as unknown as { default: MapLibreModule }).default.Popup;
    popup = new PopupCtor({ closeOnClick: false, offset: 14 }).setLngLat(coords).setHTML(buildPopupHtml(props)).addTo(map);
  }
  function refreshDomMarkers() {
    if (!maplibregl || !map) return;
    clearMarkers();
    domMarkers = renderDomMarkers(maplibregl, map, currentPoints, currentEraGazetteer, currentMode, showGazetteer, (coords, props) => {
      openPopupAt(coords, props);
      onSelectPlace(props.place_key, props.alt_id);
    });
  }
  async function ensureMap() {
    if (map && mapStyleReady) return map;
    if (mapInitPromise) return mapInitPromise;
    mapInitPromise = (async () => {
      const mod = await import('maplibre-gl') as unknown as { default?: MapLibreModule } & MapLibreModule;
      maplibregl = mod.default ?? mod;
      maplibregl.setWorkerUrl('/geo/maplibre-gl-worker.mjs');
      map = new maplibregl.Map({
        container, style: createMapStyle() as unknown as import('maplibre-gl').StyleSpecification,
        center: [35.23, 31.78], zoom: 5.5, attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
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
        currentPoints = []; currentEraGazetteer = []; clearMarkers();
        setGeoJsonSources(m, [], [], []);
        return;
      }
      const { points, regions, routes } = buildGeoJsonCollections(packet.locations, selectedAltIds);
      currentPoints = points;
      currentEraGazetteer = packet.era_gazetteer ?? [];
      setGeoJsonSources(m, points, regions, routes);
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
      map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), 7.2), duration: 350 });
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
    resize() { map?.resize(); },
  };
}
