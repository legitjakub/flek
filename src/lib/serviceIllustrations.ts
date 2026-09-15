export const SERVICE_PLACEHOLDER = '/images/flek-placeholder.svg';

const HAIR = 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=640&q=70&auto=format&fit=crop';
const MASSAGE = 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=640&q=70&auto=format&fit=crop';
const NAILS = 'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=640&q=70&auto=format&fit=crop';
const SPA = 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=640&q=70&auto=format&fit=crop';
const YOGA = '/images/services/yoga-prague.jpg';
const SAUNA = '/images/services/sauna-prague.jpg';

/** Matched against the service name without diacritics; the first match wins, so specific words come first. */
const PREPARED_ILLUSTRATIONS: Array<[needle: string, imageUrl: string]> = [
  ['padel', '/images/services/padel-prague.jpg'],
  ['tenis', '/images/services/tennis-prague.jpg'],
  ['squash', '/images/services/squash-prague.jpg'],
  ['badminton', '/images/services/badminton-prague.jpg'],
  ['osobni trenink', '/images/services/personal-training-prague.jpg'],
  ['skupinova lekce', '/images/services/group-class-prague.jpg'],
  ['joga', YOGA],
  ['jogy', YOGA],
  ['joze', YOGA],
  ['yoga', YOGA],
  ['pilates', YOGA],
  ['meditac', YOGA],
  ['protazeni', YOGA],
  ['sauna', SAUNA],
  ['masaz', MASSAGE],
  ['strih', HAIR],
  ['vous', HAIR],
  ['vlasy', HAIR],
  ['vlasu', HAIR],
  ['manikur', NAILS],
  ['pedikur', NAILS],
  ['nehty', NAILS],
  ['gel lak', NAILS],
  ['kosmet', SPA],
  ['oboci', SPA],
  ['rasy', SPA],
  ['prodlouzeni ras', SPA],
  ['virivk', SPA],
  ['parni', SPA],
  ['lazen', SPA],
];

/**
 * A picture of the kind of place, by category, for a service whose name matches nothing. The same
 * faceless photos the merchant's activity gallery offers (`service_photos`).
 */
const CATEGORY_ILLUSTRATIONS: Record<string, string> = {
  vlasy: HAIR,
  masaze: MASSAGE,
  krasa: NAILS,
  sport: '/images/services/group-class-prague.jpg',
  joga: YOGA,
  wellness: SAUNA,
};

function searchable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ');
}

/**
 * Which picture a service shows, in order of how specific it is to that service:
 *   1. the photo the merchant chose for this service,
 *   2. the prepared illustration of the activity, matched by name,
 *   3. a photo of the service's category,
 *   4. FLEK's own picture, when even the category is unknown or a photo fails to load.
 *
 * The illustration used to come first, matched on a fragment of the name, so a partner's own
 * choice never showed for anything called "…tenis…" and a massage named "Tenisový loket" got
 * a tennis court. A general venue cover is intentionally not an automatic fallback: it made
 * unrelated services look like the same activity.
 */
export function serviceIllustration(
  serviceName: string,
  serviceImage?: string | null,
  category?: string | null,
): string {
  if (serviceImage) return serviceImage;
  const name = searchable(serviceName);
  return PREPARED_ILLUSTRATIONS.find(([needle]) => name.includes(needle))?.[1]
    ?? (category ? CATEGORY_ILLUSTRATIONS[category] : undefined)
    ?? SERVICE_PLACEHOLDER;
}
