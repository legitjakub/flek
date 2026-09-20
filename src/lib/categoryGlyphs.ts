/**
 * Pin glyphs for the map. A photo in a 48px pin was unreadable at map scale — a towel and a
 * treatment room are the same beige square — so a pin says the trade instead: scissors, hand,
 * sparkles, dumbbell, flower, waves. The shapes are lucide's, the same set the rest of the app
 * draws, and the names come from `public.categories.icon`, which has carried them all along.
 *
 * Markup, not React: MapLibre markers are plain DOM elements built in a loop, so the pin builder
 * needs a string. The strings are constants in this file — nothing here is ever built from data
 * that came over the wire.
 */

/** The inner shapes of each icon, copied from lucide (24×24, stroke, round caps). */
const SHAPES: Record<string, string> = {
  // Scissors
  vlasy: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  // Hand
  masaze: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  // Sparkles
  krasa: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  // Dumbbell
  sport: '<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"/><path d="m2.5 21.5 1.4-1.4"/><path d="m20.1 3.9 1.4-1.4"/><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"/><path d="m9.6 14.4 4.8-4.8"/>',
  // Flower2
  joga: '<path d="M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1"/><circle cx="12" cy="8" r="2"/><path d="M12 10v12"/><path d="M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z"/><path d="M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z"/>',
  // Waves
  wellness: '<path d="M2 12q2.5 2 5 0t5 0 5 0 5 0"/><path d="M2 19q2.5 2 5 0t5 0 5 0 5 0"/><path d="M2 5q2.5 2 5 0t5 0 5 0 5 0"/>',
};

/** FLEK's own mark — a pin with a clock — for a service whose category we do not know. */
const FLEK_MARK =
  '<svg viewBox="0 0 36 34" focusable="false" aria-hidden="true"><path d="M12 31s11-11.8 11-17.8a11 11 0 1 0-22 0C1 19.2 12 31 12 31z" class="map-pin-shape"/><circle cx="12" cy="13.2" r="6.5" class="map-pin-face"/><path d="M12 8.8v4.5l3.4 2" class="map-pin-hands"/></svg>';

export type PinGlyph = {
  /** Ready-to-insert SVG markup. */
  markup: string;
  /** Modifier on the pin tile: the two glyph families sit differently inside it. */
  modifier: 'icon' | 'mark';
};

/** The glyph for one pin. An unknown or missing category falls back to FLEK's own mark. */
export function categoryGlyph(category?: string | null): PinGlyph {
  const shape = category ? SHAPES[category] : undefined;
  if (!shape) return { markup: FLEK_MARK, modifier: 'mark' };
  return {
    markup: `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true" class="map-pin-icon">${shape}</svg>`,
    modifier: 'icon',
  };
}

/** The categories that have an icon of their own; mirrors `public.categories`. */
export const GLYPH_CATEGORIES = Object.keys(SHAPES);
