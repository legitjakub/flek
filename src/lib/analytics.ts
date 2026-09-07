import { supabase } from './supabase';

const CLIENT_EVENTS = ['search_performed', 'offer_viewed', 'booking_started', 'booking_failed'] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

function sessionId(): string {
  try {
    let id = sessionStorage.getItem('volno.session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('volno.session', id);
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
