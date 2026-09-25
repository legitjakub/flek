import { useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { merchantBookings } from '../../lib/api';
import { dayBounds } from '../../lib/time';
import { serverNow, useServerNow } from '../../lib/clock';
import { supabase } from '../../lib/supabase';
import { useSession } from '../auth/session';
import { bookingAlerts } from './bookingAlertStore';
import type { WaitingRequest } from './RequestRing';
export type { BookingAlert } from './bookingAlertStore';

export function useUnreadBookings(businessId?: string): number {
  const { userId } = useSession();
  const scope = userId && businessId ? `${userId}:${businessId}` : '';
  return useSyncExternalStore(bookingAlerts.subscribe, () => bookingAlerts.get(scope).unreadIds.length, () => 0);
}

/**
 * Two short tones for a booking that needs nothing from the venue, only if the browser allows
 * sound without a fresh tap. A request that waits for an answer rings instead (`RequestRing`).
 */
function chime() {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    if (context.state === 'suspended') {
      void context.close();
      return;
    }
    const start = context.currentTime;
    [880, 1320].forEach((frequency, index) => {
      const at = start + index * 0.14;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.2);
    });
    window.setTimeout(() => void context.close(), 700);
  } catch {
    // Sound is a courtesy; the banner and the title carry the news regardless.
  }
}


/** Realtime for arrival, polling for recovery and changes made while disconnected. */
export function useBookingAlerts(businessId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const scope = userId ? `${userId}:${businessId}` : '';
  const state = useSyncExternalStore(bookingAlerts.subscribe, () => bookingAlerts.get(scope), () => bookingAlerts.empty);

  useEffect(() => {
    if (!scope) return;
    bookingAlerts.start(scope, Date.parse(serverNow()));
    let active = true;
    function refresh() {
      for (const key of ['merchant-bookings', 'merchant-metrics', 'merchant-offers']) {
        void queryClient.invalidateQueries({ queryKey: [key, businessId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['merchant-booking-lookup', businessId] });
    }
    const channel = supabase.channel(`merchant-bookings-${businessId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `business_id=eq.${businessId}` }, () => {
        if (!active) return;
        // Only an ID comes from the socket. Read the authorised, current row through RPC;
        // this also prevents a delayed INSERT announcing an already cancelled booking.
        void queryClient.invalidateQueries({ queryKey: ['booking-alert-poll', scope] });
        refresh();
      });
    // Finish loading the current session before joining the private, RLS-filtered feed.
    // Failure leaves the independent 30-second polling recovery running.
    void supabase.realtime.setAuth().then(() => {
      if (!active) return;
      channel.subscribe((status) => {
        if (active && status === 'SUBSCRIBED') {
          void queryClient.invalidateQueries({ queryKey: ['booking-alert-poll', scope] });
        }
      });
    }).catch(() => { /* Polling remains available when the socket cannot authenticate. */ });
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [scope, businessId, queryClient]);

  const poll = useQuery({
    queryKey: ['booking-alert-poll', scope],
    // Include long slots that began before midnight, without fetching years of history.
    queryFn: () => merchantBookings(businessId, dayBounds(serverNow(), -2).from),
    enabled: Boolean(scope),
    // Realtime usually brings a request within a second; this is the floor when the socket is down,
    // and a request can have as little as three minutes.
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    if (!scope || !poll.data) return;
    let freshBooking = false;
    for (const row of poll.data) {
      if (row.business_id !== businessId) continue;
      const alert = { id: row.id, service: row.service_name_snapshot, startAt: row.start_at_snapshot, payoutCents: row.merchant_payout_cents };
      if (row.confirmation_version === 1) {
        // A request is news when the customer's payment is authorised. Once answered, here, on another
        // device or on WhatsApp, the merchant decided it themselves and there is nothing to announce.
        if (row.status !== 'pending_merchant' || !row.authorized_at) { bookingAlerts.dismiss(scope, row.id); continue; }
        bookingAlerts.announce(scope, { ...alert, kind: 'request', deadline: row.confirmation_expires_at }, Date.parse(row.authorized_at));
        continue;
      }
      if (row.status !== 'confirmed') { bookingAlerts.dismiss(scope, row.id); continue; }
      freshBooking = bookingAlerts.announce(scope, { ...alert, kind: 'booking' }, Date.parse(row.created_at)) || freshBooking;
    }
    // Poll refreshes time-derived states even when no new booking arrived.
    for (const key of ['merchant-bookings', 'merchant-metrics', 'merchant-offers', 'merchant-booking-lookup']) {
      void queryClient.invalidateQueries({ queryKey: [key, businessId] });
    }
    if (freshBooking) chime();
  }, [poll.data, poll.dataUpdatedAt, scope, businessId, queryClient]);

  // What still waits for an answer right now; re-read every few seconds so a request that runs
  // out stops ringing on time even when nothing new arrives.
  const now = useServerNow(5_000);
  const waiting: WaitingRequest[] = (poll.data ?? [])
    .filter((row) => row.business_id === businessId && row.confirmation_version === 1 && row.status === 'pending_merchant'
      && Boolean(row.authorized_at) && Date.parse(row.confirmation_expires_at ?? '') > Date.parse(now))
    .map((row) => ({
      id: row.id,
      deadline: row.confirmation_expires_at ?? null,
      authorizedAt: row.authorized_at ?? null,
      service: row.service_name_snapshot,
      startAt: row.start_at_snapshot,
      endAt: row.end_at_snapshot,
      customer: row.customer_label,
      payoutCents: row.merchant_payout_cents,
    }))
    .sort((a, b) => Date.parse(a.deadline ?? '') - Date.parse(b.deadline ?? ''));

  useEffect(() => {
    const previous = document.title;
    document.title = state.unreadIds.length ? `(${state.unreadIds.length}) FLEK Partner` : 'FLEK Partner';
    return () => { document.title = previous; };
  }, [state.unreadIds.length]);

  return {
    waiting,
    /** Where a request ended up once it stopped waiting, as the last read saw it. */
    statusOf: (id: string) => poll.data?.find((row) => row.id === id)?.status,
    alerts: state.alerts,
    unread: state.unreadIds.length,
    markRead: () => bookingAlerts.markRead(scope),
    dismiss: (id: string) => bookingAlerts.dismiss(scope, id),
  };
}
