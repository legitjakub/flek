import { describe, expect, it } from 'vitest';
import { radiusLabel, travelSentence, watchRadius } from '../src/features/watches/travel';
import { circleDiameterPx, metersPerPixel } from '../src/lib/mapGeometry';

describe('FLEK watch travel radius', () => {
  // The same numbers as private.watch_radius in 20260924130650_flek_watches.sql.
  it('mirrors the database: 75 m a minute on foot, 200 m by tram or bike', () => {
    expect(watchRadius('walk', 10)).toBe(750);
    expect(watchRadius('walk', 30)).toBe(2250);
    expect(watchRadius('ride', 30)).toBe(6000);
  });

  it('stays inside the bounds the table accepts', () => {
    for (const mode of ['walk', 'ride'] as const) {
      for (const minutes of [10, 20, 30] as const) {
        const radius = watchRadius(mode, minutes);
        expect(radius).toBeGreaterThanOrEqual(500);
        expect(radius).toBeLessThanOrEqual(6000);
      }
    }
  });

  it('says the distance the way Czech people read it', () => {
    expect(radiusLabel(750)).toBe('750\u00a0m');
    expect(radiusLabel(2250)).toBe('2,3\u00a0km');
    expect(radiusLabel(6000)).toBe('6\u00a0km');
    expect(travelSentence('ride', 20)).toBe('do 20 min MHD nebo kolem');
  });
});

describe('map geometry', () => {
  it('matches the Web Mercator scale MapLibre uses (512 px tiles)', () => {
    // At the equator and zoom 0 the whole world is 512 px wide.
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.5, 0);
    // Prague at zoom 13: about 6.1 m a pixel.
    expect(metersPerPixel(50.08, 13)).toBeCloseTo(6.13, 1);
  });

  it('draws a 1 km circle at its true size', () => {
    expect(circleDiameterPx(50.08, 13, 1000)).toBeCloseTo(326, -1);
    expect(circleDiameterPx(50.08, 14, 1000)).toBeCloseTo(652, -1);
  });
});
