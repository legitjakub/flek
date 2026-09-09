import { supabase } from './supabase';

// Mirrored by the allowlist inside record_event(); anything not in both is silently dropped.
const CLIENT_EVENTS = [
  'search_performed',
  'offer_viewed',
  'booking_started',
  'booking_failed',
  'favorite_added',
  'favorite_removed',
  'offer_shared',
  'unavailable_recovery_clicked',
  'similar_offers_clicked',
  'referral_link_opened',
] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

function sessionId(): string {
  try {
    let id = sessionStorage.getItem('flek.session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('flek.session', id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

/** Fire-and-forget: analytics must never block or fail an authoritative mutation. */
export function track(name: ClientEvent, props: Record<string, unknown> = {}) {
  void supabase.rpc('record_event', { p_name: name, p_session_id: sessionId(), p_props: props }).then(
    () => undefined,
    () => undefined,
  );
}
