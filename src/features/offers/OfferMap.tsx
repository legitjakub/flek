import { useEffect, useRef } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, type MapOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * All map configuration lives here so the tile provider can be swapped in one file.
 * A light grey canvas with labels on a separate layer: the streets recede and the price
 * pins become the content. Raw OSM tiles carry every shop icon and road shield, which
 * competes with the offers instead of framing them. Raster rather than vector on purpose —
 * no style server, sprites or glyph fonts to fail, and no API key.
 */
export const MAP_ATTRIBUTION = '© Esri, HERE, Garmin, © OpenStreetMap';

const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas';

export const MAP_STYLE: MapOptions['style'] = {
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: [`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 16,
      attribution: MAP_ATTRIBUTION,
    },
    labels: {
      type: 'raster',
      tiles: [`${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 16,
    },
  },
  layers: [
    { id: 'base', type: 'raster', source: 'base' },
    // Labels ride above the ground so street names stay readable under the pins.
    { id: 'labels', type: 'raster', source: 'labels' },
  ],
};

export type MapMarker = { id: string; lat: number; lng: number; label: string; description?: string };

export function MapCanvas({
  center,
  zoom = 13,
  markers,
  onSelect,
  selectedId,
  className,
  interactive = true,
  fitToMarkers = false,
  ariaLabel,
}: {
  center: { lat: number; lng: number };
  zoom?: number;
  markers: MapMarker[];
  onSelect?: (id: string) => void;
  selectedId?: string;
  className?: string;
  interactive?: boolean;
  /** Frame the results rather than a fixed centre, so the map never opens on empty streets. */
  fitToMarkers?: boolean;
  ariaLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const drawn = useRef<Marker[]>([]);
  const lastCenter = useRef<string>('');
  const lastFit = useRef<string>('');

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new MapLibreMap({
      container: container.current,
      // MapLibre takes ownership of the style object and mutates it, so every instance gets
      // its own copy. Sharing one left a remounted map with a consumed style and the error
      // "There is no tile manager with ID 'base'" — a blank map with pins floating on it.
      style: structuredClone(MAP_STYLE),
      center: [center.lng, center.lat],
      zoom,
      interactive,
      attributionControl: { compact: true, customAttribution: MAP_ATTRIBUTION },
    });
    // A map that fails silently is worse than one that complains: without this a broken
    // style just looks like an empty grey box.
    map.current.on('error', (event) => console.error('[mapa]', event.error?.message ?? event));
    lastCenter.current = `${center.lat},${center.lng}`;
    return () => {
      map.current?.remove();
      map.current = null;
      // These refs describe the map instance, not the component. Without clearing them a
      // recreated map (StrictMode remount, provider swap) believes it has already framed
      // the results and silently opens on the wrong place.
      lastCenter.current = '';
      lastFit.current = '';
    };
    // Centre and bounds are applied by the effects below; the map is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reduceMotion = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * An animated camera move needs animation frames, and a hidden tab gets none — a map
   * opened in the background would stay on its initial view. Jumping straight there costs
   * nothing and is correct either way.
   */
  const cameraDuration = () =>
    reduceMotion() || document.visibilityState === 'hidden' ? 0 : 400;

  // Only an actual change of centre moves the map, so fitting is not undone on mount.
  useEffect(() => {
    const key = `${center.lat},${center.lng}`;
    if (key === lastCenter.current) return;
    lastCenter.current = key;
    map.current?.easeTo({ center: [center.lng, center.lat], duration: cameraDuration() ? 300 : 0 });
  }, [center.lat, center.lng]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    drawn.current.forEach((m) => m.remove());
    drawn.current = markers.map((marker) => {
      const selected = marker.id === selectedId;
      const el = document.createElement(onSelect ? 'button' : 'span');
      if (el instanceof HTMLButtonElement) el.type = 'button';
      el.textContent = marker.label;
      el.setAttribute('aria-label', marker.description ?? marker.label);
      if (onSelect) el.setAttribute('aria-pressed', String(selected));
      el.className = `map-pin${selected ? ' map-pin--selected' : ''}`;
      if (onSelect) el.addEventListener('click', () => onSelect(marker.id));
      return new Marker({ element: el }).setLngLat([marker.lng, marker.lat]).addTo(instance);
    });

    // Frame whatever came back, once per result set. A fixed centre leaves half the
    // venues off screen, which is how the map ended up looking empty.
    if (!fitToMarkers || markers.length === 0) return;
    const key = markers.map((m) => m.id).join(',');
    if (key === lastFit.current) return;
    lastFit.current = key;
    const bounds = new LngLatBounds();
    markers.forEach((m) => bounds.extend([m.lng, m.lat]));
    instance.fitBounds(bounds, {
      padding: { top: 48, right: 44, bottom: 88, left: 44 },
      maxZoom: 15,
      duration: cameraDuration(),
    });
    lastCenter.current = '';
  }, [markers, onSelect, selectedId, fitToMarkers]);

  return <div ref={container} className={className} role="region" aria-label={ariaLabel} />;
}
