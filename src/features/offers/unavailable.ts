import type { OfferDetail } from '../../types/database';

/**
 * Why an offer cannot be booked — for presentation only.
 *
 * Bookability itself stays a database decision (offer_is_bookable); nothing here ever makes
 * an offer bookable or unbookable. This only names, from facts the server already sent, the
 * reason behind a `bookable: false` the server has already decided, so the page can say
 * something true instead of greying a button out.
 */
export type UnavailableReason = 'cancelled' | 'caught' | 'started' | 'closed' | 'unknown';

/**
 * Order is the whole design here, because more than one fact can be true at once and only
 * one of them is the honest headline.
 *
 * A venue cancellation outranks everything: the slot never went to anyone. An empty capacity
 * genuinely means somebody took it, which stays true even after the appointment has passed,
 * so it outranks the clock. Only when seats were still free does time get to speak — first
 * the appointment itself, then the booking cutoff.
 */
export function unavailableReason(
  offer: Pick<OfferDetail, 'status' | 'capacity_remaining' | 'booking_cutoff_at' | 'start_at' | 'bookable'>,
  serverNow: string,
): UnavailableReason | null {
  if (offer.bookable) return null;
  const now = Date.parse(serverNow);
  if (offer.status === 'cancelled') return 'cancelled';
  if (offer.capacity_remaining <= 0) return 'caught';
  if (Date.parse(offer.start_at) <= now) return 'started';
  if (Date.parse(offer.booking_cutoff_at) <= now) return 'closed';
  // Something the client cannot see (a draft, a suspended venue). Say nothing specific.
  return 'unknown';
}

/** Headline and supporting line. Never claims a person took it unless a person did. */
export function unavailableCopy(reason: UnavailableReason): { title: string; body: string } {
  switch (reason) {
    case 'cancelled':
      return {
        title: 'Tenhle FLEK podnik zrušil.',
        body: 'Mrzí nás to. Další se může objevit kdykoliv.',
      };
    case 'caught':
      return {
        title: 'Tenhle FLEK už někdo chytil.',
        body: 'Další se může objevit kdykoliv — nejčastěji pár hodin předem.',
      };
    case 'started':
      return {
        title: 'Tenhle FLEK už proběhl.',
        body: 'Termín, na který odkaz mířil, je minulostí. Volné termíny přibývají každý den.',
      };
    case 'closed':
      return {
        title: 'Rezervace tohohle FLEKu už skončila.',
        body: 'Podnik potřebuje chvíli na přípravu, tak se termín před začátkem uzavírá.',
      };
    default:
      return {
        title: 'Tenhle FLEK už není dostupný.',
        body: 'Zkus se podívat, co je volné teď.',
      };
  }
}
