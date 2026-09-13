const PREPARED_ILLUSTRATIONS: Array<[needle: string, imageUrl: string]> = [
  ['padel', '/images/services/padel-prague.jpg'],
  ['tenis', '/images/services/tennis-prague.jpg'],
  ['squash', '/images/services/squash-prague.jpg'],
  ['badminton', '/images/services/badminton-prague.jpg'],
  ['osobni trenink', '/images/services/personal-training-prague.jpg'],
  ['skupinova lekce', '/images/services/group-class-prague.jpg'],
];

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
 *   3. the venue's general cover.
 *
 * The illustration used to come first, matched on a fragment of the name, so a partner's own
 * choice never showed for anything called "…tenis…" and a massage named "Tenisový loket" got
 * a tennis court. It still beats the venue cover, which is not a picture of this service.
 */
export function serviceIllustration(
  serviceName: string,
  serviceImage?: string | null,
  venueCover?: string | null,
): string | null {
  if (serviceImage) return serviceImage;
  const name = searchable(serviceName);
  return PREPARED_ILLUSTRATIONS.find(([needle]) => name.includes(needle))?.[1] ?? venueCover ?? null;
}
