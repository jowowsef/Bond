import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useState } from 'react';

/**
 * Bond's dark map style.
 *
 * Base: OpenFreeMap's free "liberty" style (no API key). We use liberty
 * rather than OpenFreeMap's "dark" style because liberty draws the parts that
 * make a map useful: points of interest (restaurants, fast food, shops,
 * schools, transit), parks and green spaces, land use, a full road hierarchy,
 * and street / neighborhood labels. "dark" has no POI layers at all.
 *
 * We recolor liberty into a muted charcoal and slate theme with sage green
 * parks. Only colors change: the data, layers, zoom rules and label rules
 * stay exactly as OpenFreeMap ships them, so nothing is invented.
 *
 * Data: OpenStreetMap contributors via OpenMapTiles. The tile source carries
 * that attribution and MapLibre shows it through its attribution control.
 *
 * The recolored style is cached in memory, so the preview and the fullscreen
 * map share it with no second download and no flash.
 */
export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Fallback if the style can't be downloaded and recolored. */
export const FALLBACK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

// ---------- palette (muted, easy on the eyes) ----------
const C = {
  land: '#1F2329', // charcoal slate
  residential: '#23282F',
  building: '#2A3038',
  buildingLine: '#333A44',
  park: '#25382D', // muted forest green
  parkLine: '#2F4637',
  grass: '#283C30', // sage
  wood: '#22352A',
  pitch: '#2A3D31',
  cemetery: '#27342C',
  hospital: '#2E2A2E',
  school: '#2B2B33',
  sand: '#2D2B27',
  ice: '#2A3038',
  water: '#172634', // deep muted slate blue
  waterway: '#1D3244',
  aeroway: '#262B32',
  runway: '#3A4049',
  casing: '#16191D',
  minor: '#353C46',
  service: '#2F353E',
  path: '#3B424C',
  secondary: '#434B56',
  primary: '#505A66',
  motorway: '#5E6875',
  rail: '#3C424B',
  boundary: '#4D5562',
  roadLabel: '#9AA3AE',
  poiLabel: '#AAB3BD',
  transitLabel: '#7FA6CC',
  waterLabel: '#5F7D96',
  placeMinor: '#A7AFB9',
  placeTown: '#BCC4CD',
  placeCity: '#D2D8DE',
  placeRegion: '#8A929C',
  halo: '#1A1D22',
};

/** Matches the recolored land color, so the map area never flashes. */
export const MAP_BACKGROUND = C.land;

type Paint = Record<string, unknown>;

/**
 * Ordered rules: the FIRST rule whose pattern matches a layer id wins.
 * Each rule lists paint values; a value is only applied when it belongs to
 * that layer's type (a "line-color" is never put on a fill layer).
 */
const RULES: [RegExp, Paint][] = [
  [/^background$/, { 'background-color': C.land }],
  [/^natural_earth$/, { 'raster-brightness-max': 0.3, 'raster-saturation': -0.6 }],

  // Green spaces and land use
  [/^park$/, { 'fill-color': C.park, 'fill-opacity': 0.9, 'fill-outline-color': C.parkLine }],
  [/^park_outline$/, { 'line-color': C.parkLine }],
  [/^landuse_residential$/, { 'fill-color': C.residential }],
  [/^landcover_wood$/, { 'fill-color': C.wood, 'fill-opacity': 0.85 }],
  [/^landcover_grass$/, { 'fill-color': C.grass, 'fill-opacity': 0.75 }],
  [/^landcover_ice$/, { 'fill-color': C.ice }],
  [/^landcover_sand$/, { 'fill-color': C.sand }],
  [/^landuse_pitch$/, { 'fill-color': C.pitch }],
  [/^landuse_track$/, { 'fill-color': C.pitch }],
  [/^landuse_cemetery$/, { 'fill-color': C.cemetery }],
  [/^landuse_hospital$/, { 'fill-color': C.hospital }],
  [/^landuse_school$/, { 'fill-color': C.school }],

  // Water
  [/^water$/, { 'fill-color': C.water }],
  [/^waterway_(tunnel|river|other)$/, { 'line-color': C.waterway }],

  // Airports
  [/^aeroway_fill$/, { 'fill-color': C.aeroway, 'fill-opacity': 0.8 }],
  [/^aeroway_(runway|taxiway)$/, { 'line-color': C.runway }],

  // Roads: casings first, then fills from biggest to smallest
  [/_casing$/, { 'line-color': C.casing }],
  [/motorway/, { 'line-color': C.motorway }],
  [/trunk_primary/, { 'line-color': C.primary }],
  [/secondary_tertiary/, { 'line-color': C.secondary }],
  [/_link$/, { 'line-color': C.secondary }],
  [/service_track/, { 'line-color': C.service }],
  [/path_pedestrian/, { 'line-color': C.path }],
  [/^(road_minor|tunnel_minor|bridge_street)$/, { 'line-color': C.minor }],
  [/rail/, { 'line-color': C.rail }],
  [/^road_one_way_arrow/, { 'icon-opacity': 0.35 }],

  // Buildings
  [/^building$/, { 'fill-color': C.building, 'fill-outline-color': C.buildingLine }],
  [/^building-3d$/, { 'fill-extrusion-color': C.building, 'fill-extrusion-opacity': 0.7 }],

  // Boundaries
  [/^boundary/, { 'line-color': C.boundary }],

  // Labels
  [/^(waterway_line_label|water_name)/, { 'text-color': C.waterLabel, 'text-halo-color': C.water, 'text-halo-width': 1 }],
  [/^poi_transit$/, { 'text-color': C.transitLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.2, 'icon-opacity': 0.85 }],
  [/^poi_/, { 'text-color': C.poiLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.2, 'icon-opacity': 0.85 }],
  [/^highway-name/, { 'text-color': C.roadLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.2 }],
  [/^(highway-shield|road_shield)/, { 'icon-opacity': 0.75 }],
  [/^airport$/, { 'text-color': C.roadLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.2, 'icon-opacity': 0.85 }],
  [/^label_city/, { 'text-color': C.placeCity, 'text-halo-color': C.halo, 'text-halo-width': 1.4, 'icon-opacity': 0 }],
  [/^label_town$/, { 'text-color': C.placeTown, 'text-halo-color': C.halo, 'text-halo-width': 1.4 }],
  [/^label_(state|country)/, { 'text-color': C.placeRegion, 'text-halo-color': C.halo, 'text-halo-width': 1.4 }],
  [/^label_/, { 'text-color': C.placeMinor, 'text-halo-color': C.halo, 'text-halo-width': 1.3 }],
];

/** Which paint prefixes belong to which layer type. */
const PREFIX: Record<string, string[]> = {
  background: ['background-'],
  fill: ['fill-'],
  line: ['line-'],
  symbol: ['text-', 'icon-'],
  raster: ['raster-'],
  'fill-extrusion': ['fill-extrusion-'],
};

type AnyLayer = { id: string; type: string; paint?: Paint; layout?: Paint };

/** Recolor a liberty style into Bond's dark theme. Pure; exported for testing. */
export function darkenStyle(style: StyleSpecification): StyleSpecification {
  for (const raw of style.layers as unknown as AnyLayer[]) {
    // Bright texture patterns (road areas, wetlands) don't belong on a dark map.
    if (raw.paint && 'fill-pattern' in raw.paint) {
      raw.layout = { ...(raw.layout ?? {}), visibility: 'none' };
      continue;
    }
    const rule = RULES.find(([re]) => re.test(raw.id));
    if (!rule) continue;
    const allowed = PREFIX[raw.type] ?? [];
    const paint: Paint = { ...(raw.paint ?? {}) };
    for (const [key, value] of Object.entries(rule[1])) {
      // fill-extrusion-* would also match "fill-"; check the longest prefix.
      const ok = allowed.some((p) => key.startsWith(p)) && !(raw.type === 'fill' && key.startsWith('fill-extrusion-'));
      if (ok) paint[key] = value;
    }
    raw.paint = paint;
  }
  return style;
}

let cached: StyleSpecification | null = null;
let inflight: Promise<StyleSpecification | null> | null = null;

async function loadStyle(): Promise<StyleSpecification | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(BASE_STYLE_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as StyleSpecification;
    if (!json || !Array.isArray(json.layers)) return null;
    cached = darkenStyle(json);
    return cached;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The style to give <Map mapStyle>. Returns null for the brief moment the
 * style is loading (show a dark placeholder), then the recolored style, or
 * OpenFreeMap's plain dark style if the download failed.
 */
export function useDarkMapStyle(): StyleSpecification | string | null {
  const [style, setStyle] = useState<StyleSpecification | string | null>(cached);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    if (!inflight) inflight = loadStyle();
    void inflight.then((s) => {
      if (!s) inflight = null; // allow a retry next time
      if (alive) setStyle(s ?? FALLBACK_STYLE_URL);
    });
    return () => {
      alive = false;
    };
  }, []);

  return style;
}
