import { describe, expect, it } from 'vitest';
import { thumbnail } from '../src/lib/thumbnail';

describe('thumbnail', () => {
  it('asks Unsplash for a small square crop, replacing any size already in the address', () => {
    const url = new URL(thumbnail('https://images.unsplash.com/photo-1?w=1200&q=80') as string);
    expect(url.searchParams.get('w')).toBe('132');
    expect(url.searchParams.get('h')).toBe('132');
    expect(url.searchParams.get('fit')).toBe('crop');
    expect(url.searchParams.get('q')).toBe('60');
  });

  it('keeps the aspect ratio for a wide picture', () => {
    const url = new URL(thumbnail('https://images.unsplash.com/photo-1?h=900', 720, false) as string);
    expect(url.searchParams.get('w')).toBe('720');
    expect(url.searchParams.has('h')).toBe(false);
  });

  it('uses the pre-rendered copy of a bundled photo only when it is big enough', () => {
    expect(thumbnail('/images/services/padel-prague.jpg')).toBe('/images/services/thumbs/padel-prague.jpg');
    expect(thumbnail('/images/services/padel-prague.jpg', 720)).toBe('/images/services/padel-prague.jpg');
  });

  it('uses responsive local copies of generated activity photos', () => {
    const image = '/images/activities/masaze-relaxacni-1.jpg';
    expect(thumbnail(image)).toBe('/images/activities/masaze-relaxacni-1-176.jpg');
    expect(thumbnail(image, 720, false)).toBe('/images/activities/masaze-relaxacni-1-800.jpg');
    expect(thumbnail(image, 1200, false)).toBe(image);
  });

  it('leaves other hosts and missing pictures alone', () => {
    expect(thumbnail('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(thumbnail(null)).toBeNull();
    expect(thumbnail('')).toBeNull();
  });
});
