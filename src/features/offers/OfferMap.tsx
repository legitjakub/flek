// Side effect only, and it must run before any map is constructed: it tells MapLibre where
// its tile-decoding worker lives. Without it vector tiles are never requested at all.
import './mapWorker';
import { clusterPins } from '../discovery/mapClusters';
import { money } from '../../lib/format';
import { useEffect, useRef } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, type MapOptions, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * All map configuration lives here so the tile provider can be swapped in one file.
 *
 * OpenFreeMap serves OpenStreetMap data as vector tiles with no API key and no quota: labels
 * stay crisp at every zoom, streets and parks carry their real colours, and a phone downloads
 * geometry once instead of a fresh picture per zoom level.
 *
 * The doc comment here used to claim exactly this while the code below served desaturated
 * Esri raster tiles. It is true now.
 */
export const MAP_ATTRIBUTION = '© OpenStreetMap přispěvatelé';
export const FALLBACK_ATTRIBUTION = '© Esri, HERE, Garmin, © OpenStreetMap';

/**
 * A URL, not an object. MapLibre fetches and owns it, so there is nothing of ours for it to
 * mutate — which is why the structuredClone below guards only the fallback.
 *
 * "Bright" out of the five styles OpenFreeMap publishes. Rendered side by side over Prague:
 * liberty runs cool and muddy green, positron is near-monochrome (the desaturated look this
 * change exists to escape) and fiord is a dark theme. Bright keeps warm beige built-up areas
 * and a soft blue river, which sits with the app's cream ground instead of fighting it.
 */
export const MAP_STYLE: MapOptions['style'] = 'https://tiles.openfreemap.org/styles/bright';

/**
 * OpenFreeMap is donated infrastructure with no service agreement, so there has to be a way
 * back. Esri's World Street Map is colourful too, needs no key, and is served from the host
 * this app already relied on.
 *
 * This one IS an object, and MapLibre mutates the style object it is given: sharing a single
 * instance across maps left a remounted map with a consumed style and the error "There is no
 * tile manager with ID 'base'" — a blank map with pins floating over it. Hence the clone at
 * every use.
 */
export const RASTER_FALLBACK: StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: FALLBACK_ATTRIBUTION,
    },
  },
  layers: [{ id: 'base', type: 'raster', source: 'base' }],
};




export type MapMarker = { id: string; lat: number; lng: number; label: string; description?: string; count?: number; price?: number };

/**
 * OpenMapTiles ships every name in `name` (local/English) plus translations in `name:xx`.
 * Liberty renders `name`, so Prague showed up as "Prague" and Malá Strana as "Lesser Town"
 * in a Czech-only product. Rewriting the text field per symbol layer is the documented way
 * to localise a vector style, and it costs one pass over the layer list.
 */
function localiseLabels(instance: MapLibreMap) {
  for (const layer of instance.getStyle().layers ?? []) {
    if (layer.type !== 'symbol') continue;
    const field = (layer.layout as { 'text-field'?: unknown } | undefined)?.['text-field'];
    if (field === undefined) continue;
    try {
      instance.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:cs'], ['get', 'name']]);
    } catch {
      // A layer whose text-field is not a plain name lookup (house numbers, shields) is
      // left exactly as it is rather than broken.
    }
  }
}

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
    const instance = new MapLibreMap({
      container: container.current,
      // A URL: MapLibre fetches it, so there is no object of ours for it to consume.
      style: MAP_STYLE,
      center: [center.lng, center.lat],
      zoom,
      interactive,
      // No customAttribution: each style states its own sources, so attribution follows
      // the basemap across the fallback swap instead of contradicting it.
      attributionControl: { compact: true },
      locale: { 'NavigationControl.ZoomIn': 'Přiblížit mapu', 'NavigationControl.ZoomOut': 'Oddálit mapu', 'AttributionControl.ToggleAttribution': 'Zdroje mapy' },
    });
    map.current = instance;

    /*
     * OpenFreeMap is donated infrastructure with no service agreement. If its style never
     * arrives — outage, DNS, a captive portal — the map would sit there as an empty box, so
     * a timer and the error event both fall back to raster tiles. DOM markers are overlays
     * rather than style layers, so they survive setStyle and the pins stay put.
     */
    let styled = false;
    let fellBack = false;
    const useFallback = (why: string) => {
      if (styled || fellBack) return;
      fellBack = true;
      console.warn('[mapa] vektorový podklad nedojel, přepínám na rastrový:', why);
      instance.setStyle(structuredClone(RASTER_FALLBACK));
    };
    instance.once('style.load', () => {
      styled = true;
      localiseLabels(instance);
    });
    const fallbackTimer = window.setTimeout(() => useFallback('vypršel čas'), 6000);
    // A map that fails silently is worse than one that complains: without this a broken
    // style just looks like an empty grey box.
    instance.on('error', (event) => {
      const message = event.error?.message ?? String(event);
      console.error('[mapa]', message);
      useFallback(message);
    });

    if (interactive) instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    lastCenter.current = `${center.lat},${center.lng}`;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(container.current);
    return () => {
      window.clearTimeout(fallbackTimer);
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
        return { x: point.x, y: point.y, width: Math.max(96, marker.label.length * 8 + 54 + ((marker.count ?? 1) > 1 ? 28 : 0)), indexes: [index] };
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
        el.dataset.mapIds = JSON.stringify(ids);
        el.setAttribute('aria-label', multiple ? `${count} ${count < 5 ? 'termíny' : 'termínů'} v této oblasti, ${label}. Vybrat aktivitu.` : entries[0].description ?? label);
        el.className = 'map-pin';
        const glyph = document.createElement('span');
        glyph.className = 'map-pin-glyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.innerHTML = '<svg viewBox="0 0 36 34" focusable="false"><path d="M12 31s11-11.8 11-17.8a11 11 0 1 0-22 0C1 19.2 12 31 12 31z" class="map-pin-shape"/><circle cx="12" cy="13.2" r="6.5" class="map-pin-face"/><path d="M12 8.8v4.5l3.4 2" class="map-pin-hands"/><path d="M26.2 7.7 31 3M28.4 13.1l5.5-2.3M28.6 18.7l5.7-.6" class="map-pin-rays"/></svg>';
        const price = document.createElement('span');
        price.className = 'map-pin-price';
        price.textContent = label;
        el.append(glyph, price);
        const active = ids.includes(selectedRef.current ?? '');
        el.classList.toggle('map-pin--selected', active);
        if (selectable) el.setAttribute('aria-pressed', String(active));
        if (count > 1) {
          const badge = document.createElement('span');
          badge.className = 'map-pin-count';
          badge.textContent = String(count);
          badge.setAttribute('aria-hidden', 'true');
          price.append(badge);
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
