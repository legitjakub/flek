import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker, type MapOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/** All map configuration lives here so the tile provider can be swapped in one file. */
export const MAP_STYLE: MapOptions['style'] = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
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
  ariaLabel,
}: {
  center: { lat: number; lng: number };
  zoom?: number;
  markers: MapMarker[];
  onSelect?: (id: string) => void;
  selectedId?: string;
  className?: string;
  interactive?: boolean;
  ariaLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const drawn = useRef<Marker[]>([]);

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE,
      center: [center.lng, center.lat],
      zoom,
      interactive,
      attributionControl: { compact: true },
    });
    return () => {
      map.current?.remove();
      map.current = null;
    };
    // Centre changes are applied by the next effect; the map is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.easeTo({ center: [center.lng, center.lat], duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200 });
  }, [center.lat, center.lng]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    drawn.current.forEach((m) => m.remove());
    drawn.current = markers.map((marker) => {
      const el = document.createElement(onSelect ? 'button' : 'span');
      if (el instanceof HTMLButtonElement) el.type = 'button';
      el.textContent = marker.label;
      el.setAttribute('aria-label', marker.description ?? marker.label);
      if (onSelect) el.setAttribute('aria-pressed', String(marker.id === selectedId));
      el.className =
        `tnum inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 px-3 text-sm font-bold shadow-card ${marker.id === selectedId ? 'border-card bg-accent text-card ring-2 ring-accent' : 'border-ink bg-card text-ink'}`;
      if (onSelect) el.addEventListener('click', () => onSelect(marker.id));
      return new Marker({ element: el }).setLngLat([marker.lng, marker.lat]).addTo(instance);
    });
  }, [markers, onSelect, selectedId]);

  return <div ref={container} className={className} role="region" aria-label={ariaLabel} />;
}
