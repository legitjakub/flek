import { useEffect } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { merchantBookings } from '../../lib/api';
import { dayBounds } from '../../lib/time';
import { serverNow, useServerNow } from '../../lib/clock';
import { supabase } from '../../lib/supabase';
import { useSession } from '../auth/session';
import type { Business, BookingStatus } from '../../types/database';
import type { WaitingRequest } from './RequestRing';
import { waitingFrom } from './waitingRequests';

/**
 * Requests waiting at the person's other approved venues, the ones not open on screen. A person who
 * runs two venues must hear a request of the other one too: it rings, and the full screen names its
 * venue. Only the requests are read here: the selected venue's banners, title count and chime stay its own.
 * The query key is the one `useBookingAlerts` polls with, so switching venues starts from what is known.
 */
export function useOtherVenueRequests(venues: Pick<Business, 'id' | 'display_name'>[]): {
  waiting: WaitingRequest[];
  statusOf: (id: string) => BookingStatus | undefined;
} {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const now = useServerNow(5_000);
  const polls = useQueries({
    queries: venues.map((venue) => ({
      queryKey: ['booking-alert-poll', `${userId}:${venue.id}`],
      queryFn: () => merchantBookings(venue.id, dayBounds(serverNow(), -2).from),
      enabled: Boolean(userId),
      // As for the open venue: realtime brings a request within a second, this is the floor without it.
      refetchInterval: 15_000,
      refetchIntervalInBackground: true,
    })),
  });

  const ids = venues.map((venue) => venue.id).join(',');
  useEffect(() => {
    if (!userId || !ids) return;
    let active = true;
    const channels = ids.split(',').map((id) =>
      supabase.channel(`merchant-other-${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `business_id=eq.${id}` }, () => {
        if (active) void queryClient.invalidateQueries({ queryKey: ['booking-alert-poll', `${userId}:${id}`] });
      }));
    void supabase.realtime.setAuth().then(() => {
      if (active) channels.forEach((channel) => channel.subscribe());
    }).catch(() => { /* Polling remains available when the socket cannot authenticate. */ });
    return () => {
      active = false;
      channels.forEach((channel) => void supabase.removeChannel(channel));
    };
  }, [userId, ids, queryClient]);

  const waiting = venues.flatMap((venue, index) => waitingFrom(polls[index]?.data, venue.id, now, venue.display_name));
  const statusOf = (id: string) => {
    for (const poll of polls) {
      const row = poll.data?.find((booking) => booking.id === id);
      if (row) return row.status;
    }
    return undefined;
  };
  return { waiting, statusOf };
}
