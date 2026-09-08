import { clusterPins } from '../discovery/mapClusters';
import { money } from '../../lib/format';
import { useEffect, useRef } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, type MapOptions } from 'maplibre-gl';
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

export type MapMarker = { id: string; lat: number; lng: number; label: string; description?: string; count?: number; price?: number };

export function MapCanvas({
  center,
  zoom = 13,
  markers,
  onSelect,
  onSelectGroup,
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
  onSelectGroup?: (ids: string[]) => void;
  selectedId?: string;
  className?: string;
  interactive?: boolean;
  /** Frame the results rather than a fixed centre, so the map never opens on empty streets. */
  fitToMarkers?: boolean;
  ariaLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const groupRef = useRef(onSelectGroup);
  const selectedRef = useRef(selectedId);
  useEffect(() => { groupRef.current = onSelectGroup; selectedRef.current = selectedId; }, [onSelectGroup, selectedId]);
  const selectRef = useRef(onSelect);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  const selectable = Boolean(onSelect);
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
      locale: { 'NavigationControl.ZoomIn': 'Přiblížit mapu', 'NavigationControl.ZoomOut': 'Oddálit mapu', 'AttributionControl.ToggleAttribution': 'Zdroje mapy' },
    });
    // A map that fails silently is worse than one that complains: without this a broken
    // style just looks like an empty grey box.
    if (interactive) map.current.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.current.on('error', (event) => console.error('[mapa]', event.error?.message ?? event));
    lastCenter.current = `${center.lat},${center.lng}`;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
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
    function draw() {
      if (!instance) return;
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.mapIds : undefined;
      drawn.current.forEach((marker) => marker.remove());
      const projected = markers.map((marker, index) => {
        const point = instance.project([marker.lng, marker.lat]);
        return { x: point.x, y: point.y, width: Math.max(76, marker.label.length * 9 + 24 + ((marker.count ?? 1) > 1 ? 28 : 0)), indexes: [index] };
      });
      const clusters = groupRef.current ? clusterPins(projected) : projected;
      drawn.current = clusters.map((cluster) => {
        const entries = cluster.indexes.map((index) => markers[index]);
        const ids = entries.map((entry) => entry.id);
        const multiple = entries.length > 1;
        const count = entries.reduce((sum, entry) => sum + (entry.count ?? 1), 0);
        const label = multiple ? `od ${money(Math.min(...entries.map((entry) => entry.price ?? 0)))}` : entries[0].label;
        const el = document.createElement(selectable ? 'button' : 'span');
        if (el instanceof HTMLButtonElement) el.type = 'button';
        el.textContent = label;
        el.dataset.mapIds = JSON.stringify(ids);
        el.setAttribute('aria-label', multiple ? `${count} ${count < 5 ? 'termíny' : 'termínů'} v této oblasti, ${label}. Vybrat aktivitu.` : entries[0].description ?? label);
        el.className = 'map-pin';
        const active = ids.includes(selectedRef.current ?? '');
        el.classList.toggle('map-pin--selected', active);
        if (selectable) el.setAttribute('aria-pressed', String(active));
        if (count > 1) {
          const badge = document.createElement('span');
          badge.className = 'map-pin-count';
          badge.textContent = String(count);
          badge.setAttribute('aria-hidden', 'true');
          el.append(badge);
        }
        if (selectable) el.addEventListener('click', () => multiple ? groupRef.current?.(ids) : selectRef.current?.(ids[0]));
        const pin = new Marker({ element: el }).setLngLat(instance.unproject([cluster.x, cluster.y])).addTo(instance);
        if (focused === el.dataset.mapIds) el.focus({ preventScroll: true });
        return pin;
      });
    }
    draw();
    instance.on('moveend', draw);
    instance.on('resize', draw);
    return () => {
      instance.off('moveend', draw);
      instance.off('resize', draw);
      drawn.current.forEach((marker) => marker.remove());
      drawn.current = [];
    };
  }, [markers, selectable]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    // Reframe for a new result set or viewport size, but leave user pans/zoom alone.
    function frame() {
      if (!instance || !fitToMarkers || markers.length === 0) return;
      const canvas = instance.getContainer();
      const key = `${markers.map((m) => m.id).join(',')}:${canvas.clientWidth}x${canvas.clientHeight}`;
      if (key === lastFit.current) return;
      lastFit.current = key;
      const bounds = new LngLatBounds();
      markers.forEach((marker) => bounds.extend([marker.lng, marker.lat]));
      instance.fitBounds(bounds, { padding: { top: 88, right: 72, bottom: 52, left: 72 }, maxZoom: 15, duration: 0 });
    }
    frame();
    instance.on('resize', frame);
    return () => { instance.off('resize', frame); };
  }, [markers, fitToMarkers]);

  useEffect(() => {
    drawn.current.forEach((marker) => {
      const element = marker.getElement();
      const ids: string[] = JSON.parse(element.dataset.mapIds ?? '[]');
      const active = ids.includes(selectedId ?? '');
      element.classList.toggle('map-pin--selected', active);
      if (selectable) element.setAttribute('aria-pressed', String(active));
    });
  }, [selectedId, markers, selectable]);

  return <div ref={container} className={className} role="region" aria-label={ariaLabel} />;
}
