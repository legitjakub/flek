import { describe, expect, it } from 'vitest';
import { GLYPH_CATEGORIES, categoryGlyph } from '../src/lib/categoryGlyphs';

/**
 * Every category a venue can pick has its own pin glyph, and anything else still gets a pin.
 * The slugs mirror `public.categories`, which also names the lucide icon each one stands for.
 */
const CATEGORIES = ['vlasy', 'masaze', 'krasa', 'sport', 'joga', 'wellness'];

describe('categoryGlyph', () => {
  it('covers every category in the database, and nothing more', () => {
    expect([...GLYPH_CATEGORIES].sort()).toEqual([...CATEGORIES].sort());
  });

  it('draws the icon of the trade for a known category', () => {
    for (const category of CATEGORIES) {
      const glyph = categoryGlyph(category);
      expect(glyph.modifier).toBe('icon');
      expect(glyph.markup).toContain('class="map-pin-icon"');
      expect(glyph.markup.startsWith('<svg')).toBe(true);
    }
  });

  it('gives each trade a different shape, so a map of pins is readable', () => {
    const shapes = new Set(CATEGORIES.map((category) => categoryGlyph(category).markup));
    expect(shapes.size).toBe(CATEGORIES.length);
  });

  it("falls back to FLEK's own mark when the category is unknown or missing", () => {
    for (const unknown of ['pojisteni', '', null, undefined]) {
      const glyph = categoryGlyph(unknown);
      expect(glyph.modifier).toBe('mark');
      expect(glyph.markup).toContain('map-pin-shape');
    }
  });

  it('never yields anything but shapes: the markup goes into the DOM as it is', () => {
    for (const category of [...CATEGORIES, 'neznama']) {
      const markup = categoryGlyph(category).markup;
      expect(markup).not.toMatch(/<script|on[a-z]+=|href|javascript:/i);
      expect(markup.endsWith('</svg>')).toBe(true);
    }
  });
});
