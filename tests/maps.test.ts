import { describe, expect, it } from 'vitest';
import { navigationHref } from '../src/lib/maps';

/**
 * The link people press when they are already on their way. It has to open a route, not a
 * marker, and it must survive a venue that has never been linked to a Google place.
 */
describe('navigationHref', () => {
  it('opens Google Maps in directions mode', () => {
    const url = new URL(navigationHref({ latitude: 50.0755, longitude: 14.4378 }));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('destination')).toBe('50.0755,14.4378');
  });

  it('names the venue when it has been linked to a Google place', () => {
    const url = new URL(navigationHref({ latitude: 50.1, longitude: 14.4, google_place_id: 'ChIJ_abc-123' }));
    expect(url.searchParams.get('destination_place_id')).toBe('ChIJ_abc-123');
  });

  it('omits the place id rather than sending an empty one', () => {
    for (const id of [null, undefined, '', '   ']) {
      const url = new URL(navigationHref({ latitude: 50, longitude: 14, google_place_id: id }));
      expect(url.searchParams.has('destination_place_id')).toBe(false);
    }
  });

  it('encodes the parameters instead of pasting them in raw', () => {
    // A place id is opaque and may contain characters that would otherwise end the query.
    const url = navigationHref({ latitude: 50, longitude: 14, google_place_id: 'a&b=c d' });
    expect(url).not.toContain('a&b=c d');
    expect(new URL(url).searchParams.get('destination_place_id')).toBe('a&b=c d');
  });

  it('keeps negative and fractional coordinates intact', () => {
    const url = new URL(navigationHref({ latitude: -33.8688, longitude: 151.2093 }));
    expect(url.searchParams.get('destination')).toBe('-33.8688,151.2093');
  });
});
