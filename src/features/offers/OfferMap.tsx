// Side effect only, and it must run before any map is constructed: it tells MapLibre where
// its tile-decoding worker lives. Without it vector tiles are never requested at all.
import './mapWorker';
import { spreadPins } from '../discovery/mapClusters';
import { categoryGlyph } from '../../lib/categoryGlyphs';
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




export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  description?: string;
  count?: number;
  price?: number;
  /** Category slug of the service, drawn in the pin; an unknown one gets FLEK's own mark. */
  category?: string | null;
};

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
  selectedId,
  className,
  interactive = true,
  fitToMarkers = false,
  framePadding = { top: 88, right: 72, bottom: 52, left: 72 },
  focusId,
  focusArea,
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
  /** Room kept free around the framed results, for controls floating over the map. */
  framePadding?: { top: number; right: number; bottom: number; left: number };
  /** A marker whose preview covers part of the map: it is panned into the part left uncovered. */
  focusId?: string;
  /** How much of the map, from the top and the bottom, is covered while `focusId` is shown. */
  focusArea?: { top: number; bottom: number };
  ariaLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const selectedRef = useRef(selectedId);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  const framePaddingRef = useRef(framePadding);
  useEffect(() => { framePaddingRef.current = framePadding; }, [framePadding]);
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
    // On a narrow map MapLibre opens the compact attribution as a full-width strip until the
    // first drag. It is collapsed to its "i" button once the map settles, so it does not
    // cover the pins along the bottom; the button opens the sources again.
    instance.once('idle', () => {
      instance.getContainer().querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
    });
    const fallbackTimer = window.setTimeout(() => useFallback('vypršel čas'), 6000);
    // A map that fails silently is worse than one that complains: without this a broken
    // style just looks like an empty grey box.
    instance.on('error', (event) => {
      const message = event.error?.message ?? String(event);
      console.error('[mapa]', message);
      useFallback(message);
    });

    // Bottom right: the top of a full-screen map belongs to the floating search controls.
    if (interactive) instance.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
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
        // A glyph tile over a price ticket: as wide as the ticket, never narrower than the tile.
        return { x: point.x, y: point.y, width: Math.max(56, marker.label.length * 7.5 + 24), indexes: [index] };
      });
      const positions = selectable ? spreadPins(projected) : projected.map((point) => ({ ...point, offsetX: 0, offsetY: 0 }));
      drawn.current = positions.map((position) => {
        const entry = markers[position.indexes[0]];
        const ids = [entry.id];
        const count = entry.count ?? 1;
        const label = entry.label;
        const el = document.createElement(selectable ? 'button' : 'span');
        if (el instanceof HTMLButtonElement) el.type = 'button';
        el.dataset.mapIds = JSON.stringify(ids);
        const price = document.createElement('span');
        price.textContent = label;

        el.className = 'map-pin';
        if (position.offsetX || position.offsetY) el.classList.add('is-displaced');
        el.setAttribute('aria-label', entry.description ?? label);
        const glyph = categoryGlyph(entry.category);
        const tile = document.createElement('span');
        tile.className = `map-pin-tile map-pin-tile--${glyph.modifier}`;
        tile.setAttribute('aria-hidden', 'true');
        // Constant markup from categoryGlyphs.ts, never anything that came from the database.
        tile.innerHTML = glyph.markup;
        price.className = 'map-pin-price';
        price.setAttribute('aria-hidden', 'true');
        el.append(tile, price);
        if (count > 1) {
          const badge = document.createElement('span');
          badge.className = 'map-pin-count';
          badge.textContent = String(count);
          badge.setAttribute('aria-hidden', 'true');
          el.append(badge);
        }

        const active = ids.includes(selectedRef.current ?? '');
        el.classList.toggle('is-selected', active);
        if (selectable) el.setAttribute('aria-pressed', String(active));
        if (selectable) {
          el.addEventListener('click', () => selectRef.current?.(entry.id));
        }
        const pin = new Marker({ element: el, offset: [position.offsetX, position.offsetY] })
          .setLngLat([entry.lng, entry.lat])
          .addTo(instance);
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
      instance.fitBounds(bounds, { padding: framePaddingRef.current, maxZoom: 15, duration: 0 });
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
      element.classList.toggle('is-selected', active);
      if (selectable && element.classList.contains('map-pin')) element.setAttribute('aria-pressed', String(active));
    });
  }, [selectedId, markers, selectable]);

  // A pin tapped near the bottom would open its card right on top of itself. Move the camera
  // just enough to keep the chosen pin in sight above the card; leave it alone if it already is.
  //
  // The card is measured only after it has rendered, so the first pass for a new pin still
  // sees the height of the empty slot and judged a pin under the card as visible. The pass
  // runs again once the real height arrives, until the customer moves the map themselves:
  // a re-render must never undo their pan.
  const focusClaim = useRef<{ id?: string; released: boolean }>({ released: false });
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const release = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) focusClaim.current.released = true;
    };
    instance.on('movestart', release);
    return () => { instance.off('movestart', release); };
  }, []);

  useEffect(() => {
    if (focusClaim.current.id !== focusId) focusClaim.current = { id: focusId, released: false };
    if (focusClaim.current.released) return;
    const instance = map.current;
    const marker = markers.find((entry) => entry.id === focusId);
    if (!instance || !marker || !focusArea) return;
    const { clientWidth: width, clientHeight: height } = instance.getContainer();
    const visibleBottom = height - focusArea.bottom;
    if (visibleBottom - focusArea.top < 80) return;
    const point = instance.project([marker.lng, marker.lat]);
    // The selected pin is 64 px tall around its point and scaled up by 12 %.
    if (point.y > focusArea.top + 40 && point.y < visibleBottom - 40 && point.x > 32 && point.x < width - 32) return;
    instance.easeTo({
      center: [marker.lng, marker.lat],
      offset: [0, (focusArea.top - focusArea.bottom) / 2],
      duration: cameraDuration(),
    });
    // A new focus or a remeasured card moves the camera; new markers from the same search do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, focusArea?.top, focusArea?.bottom]);

  return <div ref={container} className={className} role="region" aria-label={ariaLabel} />;
}
