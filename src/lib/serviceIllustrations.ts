import { ACTIVITY_GALLERIES, activityForName } from './activityGalleries';

export const SERVICE_PLACEHOLDER = '/images/flek-placeholder.svg';

/**
 * Prepared catalogue imagery is disclosed as illustrative. Merchant uploads live in Supabase
 * Storage and deliberately return false: a real photo must never be presented as a placeholder.
 */
export function isIllustrativeServiceImage(imageUrl: string | null | undefined): boolean {
  if (!imageUrl || imageUrl === SERVICE_PLACEHOLDER) return false;
  return imageUrl.startsWith('/images/activities/')
    || imageUrl.startsWith('/images/services/')
    || imageUrl.startsWith('https://images.unsplash.com/');
}

/**
 * Which picture a service shows, in order of how specific it is to that service:
 *   1. the photo the merchant chose for this service,
 *   2. the prepared illustration of the activity, matched by name,
 *   3. FLEK's neutral picture when the service is too ambiguous to match safely.
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
  const activity = activityForName(serviceName, category);
  if (activity) return ACTIVITY_GALLERIES[activity]?.[0] ?? SERVICE_PLACEHOLDER;
  return SERVICE_PLACEHOLDER;
}
