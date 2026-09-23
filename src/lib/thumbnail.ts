/**
 * A small copy of a picture for places that show it as a 44 px circle — map pins above all.
 * A map of forty offers must not download forty 1280 px photos to draw forty dots.
 *
 *   Unsplash         resized by its image CDN through the w / h / q parameters
 *   anything else    returned unchanged, because there is no honest way to shrink it here
 */
export function thumbnail(url: string | null | undefined, px = 132, square = true): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'images.unsplash.com') {
      parsed.searchParams.set('w', String(px));
      if (square) {
        parsed.searchParams.set('h', String(px));
        parsed.searchParams.set('fit', 'crop');
      } else {
        parsed.searchParams.delete('h');
      }
      parsed.searchParams.set('q', '60');
      parsed.searchParams.set('auto', 'format');
      return parsed.toString();
    }
  } catch {
    // A relative or malformed address: leave it for the browser to resolve.
  }
  return url;
}
