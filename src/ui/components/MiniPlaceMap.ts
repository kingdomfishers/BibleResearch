// @file: src/ui/components/MiniPlaceMap.ts
// @feature: word-modal
// @tables: places | place_locations
// @candidates: mini-place-map
// @toc: imports | types | logic:style | logic:features | ui:init

// === @section:imports ===
import 'maplibre-gl/dist/maplibre-gl.css';

// === @section:types ===
export interface MiniPlaceMapHandle {
  element: HTMLElement;
  setLocation: (loc: { name: string; lat: number; lon: number; uncertain?: boolean }) => Promise<void>;
  resize: () => void;
  destroy: () => void;
}

type MapLibreModule = typeof import('maplibre-gl');
type MapTheme = 'light' | 'dark';

interface MiniLocationInput {
  name: string;
  lat: number;
  lon: number;
  uncertain?: boolean;
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

function createMiniMapStyle(theme: MapTheme): Record<string, unknown> {
  const palette = getThemePalette(theme);
  return {
    version: 8,
    name: 'BibleResearch Mini Place Spotlight Map',
    sources: {
      'physical-relief': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 8,
      },
      'ancient-basemap': { type: 'geojson', data: '/geo/ancient-basemap.geojson' },
      'uncertainty-ring': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'verse-point': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
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
        paint: { 'raster-opacity': 0.52, 'raster-saturation': -0.3 },
      },
      {
        id: 'ne-rivers',
        type: 'line',
        source: 'ancient-basemap',
        filter: ['==', ['get', 'feature_type'], 'river'],
        paint: { 'line-color': palette.river, 'line-width': 1.5 },
      },
      {
        id: 'uncertainty-ring-fill',
        type: 'fill',
        source: 'uncertainty-ring',
        paint: { 'fill-color': '#d4af37', 'fill-opacity': 0.14 },
      },
      {
        id: 'uncertainty-ring-line',
        type: 'line',
        source: 'uncertainty-ring',
        paint: {
          'line-color': '#d4af37',
          'line-width': 1.6,
          'line-dasharray': [2, 2],
          'line-opacity': 0.8,
        },
      },
      {
        id: 'verse-point-halo',
        type: 'circle',
        source: 'verse-point',
        paint: {
          'circle-radius': 14,
          'circle-color': 'rgba(212, 175, 55, 0.28)',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(47, 158, 102, 0.55)',
        },
      },
      {
        id: 'verse-point-core',
        type: 'circle',
        source: 'verse-point',
        paint: {
          'circle-radius': 6.5,
          'circle-color': '#2f9e66',
          'circle-stroke-width': 2.2,
          'circle-stroke-color': '#d4af37',
        },
      },
    ],
  };
}

function applyThemeToMiniMap(m: import('maplibre-gl').Map, theme: MapTheme): void {
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

// === @section:logic:features ===
const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const UNCERTAINTY_RADIUS_KM = 15;

function buildGeodesicCircle(lon: number, lat: number, radiusKm: number, steps = 48): [number, number][][] {
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

function formatCoordsLabel(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lon).toFixed(4)}°${lonDir}`;
}

function createPinMarkerElement(name: string): HTMLElement {
  const pin = document.createElement('div');
  pin.className = 'mini-place-map-pin';
  pin.setAttribute('aria-label', name);
  const pulse = document.createElement('span');
  pulse.className = 'mini-place-map-pin-pulse';
  const dot = document.createElement('span');
  dot.className = 'mini-place-map-pin-dot';
  pin.append(pulse, dot);
  return pin;
}

// === @section:ui:init ===
export function createMiniPlaceMap(): MiniPlaceMapHandle {
  const element = document.createElement('div');
  element.className = 'mini-place-map-wrap';

  const canvas = document.createElement('div');
  canvas.className = 'mini-place-map-canvas';
  element.append(canvas);

  let maplibregl: MapLibreModule | null = null;
  let map: import('maplibre-gl').Map | null = null;
  let mapInitPromise: Promise<import('maplibre-gl').Map | null> | null = null;
  let pinMarker: import('maplibre-gl').Marker | null = null;
  let fallbackBadge: HTMLElement | null = null;
  let currentTheme: MapTheme = readActiveTheme();
  let mapStyleReady = false;
  let webglFailed = false;
  let destroyed = false;
  let latestLoc: MiniLocationInput | null = null;

  const themeObserver = new MutationObserver(() => {
    const next = readActiveTheme();
    if (next !== currentTheme) {
      currentTheme = next;
      if (map && mapStyleReady && !destroyed) {
        applyThemeToMiniMap(map, next);
      }
    }
  });
  if (typeof document !== 'undefined' && document.documentElement) {
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function renderFallbackBadge(loc: MiniLocationInput): void {
    canvas.hidden = true;
    if (!fallbackBadge) {
      fallbackBadge = document.createElement('div');
      fallbackBadge.className = 'mini-place-map-fallback';
      element.append(fallbackBadge);
    }
    fallbackBadge.hidden = false;
    fallbackBadge.replaceChildren();

    const title = document.createElement('strong');
    title.className = 'mini-place-map-fallback-name';
    title.textContent = loc.name;

    const coords = document.createElement('span');
    coords.className = 'mini-place-map-fallback-coords';
    coords.textContent = formatCoordsLabel(loc.lat, loc.lon);

    fallbackBadge.append(title, coords);
    if (loc.uncertain) {
      const note = document.createElement('span');
      note.className = 'mini-place-map-fallback-note';
      note.textContent = `Approximate region (~${UNCERTAINTY_RADIUS_KM} km radius)`;
      fallbackBadge.append(note);
    }
  }

  async function ensureMap(initialCenter: [number, number]): Promise<import('maplibre-gl').Map | null> {
    if (destroyed || webglFailed) return null;
    if (map && mapStyleReady) return map;
    if (mapInitPromise) return mapInitPromise;

    mapInitPromise = (async () => {
      try {
        const mod = await import('maplibre-gl') as unknown as { default?: MapLibreModule } & MapLibreModule;
        if (destroyed) return null;
        maplibregl = mod.default ?? mod;
        maplibregl.setWorkerUrl('/geo/maplibre-gl-worker.mjs');
        currentTheme = readActiveTheme();
        map = new maplibregl.Map({
          container: canvas,
          style: createMiniMapStyle(currentTheme) as unknown as import('maplibre-gl').StyleSpecification,
          center: initialCenter,
          zoom: 8.5,
          attributionControl: false,
          interactive: true,
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

        await new Promise<void>(resolve => {
          let settled = false;
          const done = () => {
            if (!settled) {
              settled = true;
              mapStyleReady = true;
              resolve();
            }
          };
          if (map!.isStyleLoaded()) done();
          map!.once('styledata', done);
          map!.once('load', done);
          setTimeout(done, 1200);
        });

        if (destroyed) {
          map.remove();
          map = null;
          return null;
        }
        applyThemeToMiniMap(map, currentTheme);
        return map;
      } catch {
        webglFailed = true;
        map = null;
        return null;
      }
    })();

    return mapInitPromise;
  }

  return {
    element,
    async setLocation(loc) {
      latestLoc = loc;
      if (destroyed) return;
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) {
        renderFallbackBadge(loc);
        return;
      }

      const m = await ensureMap([loc.lon, loc.lat]);
      if (destroyed || latestLoc !== loc) return;
      if (!m || !maplibregl) {
        renderFallbackBadge(loc);
        return;
      }

      canvas.hidden = false;
      if (fallbackBadge) fallbackBadge.hidden = true;

      const pointSource = m.getSource('verse-point') as import('maplibre-gl').GeoJSONSource | undefined;
      pointSource?.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: loc.name, uncertain: Boolean(loc.uncertain) },
            geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] },
          },
        ],
      } as never);

      const uncertaintySource = m.getSource('uncertainty-ring') as import('maplibre-gl').GeoJSONSource | undefined;
      uncertaintySource?.setData({
        type: 'FeatureCollection',
        features: loc.uncertain
          ? [
              {
                type: 'Feature',
                properties: { name: loc.name, radius_km: UNCERTAINTY_RADIUS_KM },
                geometry: {
                  type: 'Polygon',
                  coordinates: buildGeodesicCircle(loc.lon, loc.lat, UNCERTAINTY_RADIUS_KM),
                },
              },
            ]
          : [],
      } as never);

      const MarkerCtor = maplibregl.Marker ?? (maplibregl as unknown as { default: MapLibreModule }).default.Marker;
      if (!pinMarker) {
        pinMarker = new MarkerCtor({ element: createPinMarkerElement(loc.name), anchor: 'center' })
          .setLngLat([loc.lon, loc.lat])
          .addTo(m);
      } else {
        pinMarker.getElement().setAttribute('aria-label', loc.name);
        pinMarker.setLngLat([loc.lon, loc.lat]);
      }

      m.resize();
      m.flyTo({
        center: [loc.lon, loc.lat],
        zoom: loc.uncertain ? 7.2 : 9.5,
        duration: 400,
      });
    },
    resize() {
      if (!destroyed) map?.resize();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      themeObserver.disconnect();
      pinMarker?.remove();
      pinMarker = null;
      map?.remove();
      map = null;
      mapInitPromise = null;
      mapStyleReady = false;
    },
  };
}
