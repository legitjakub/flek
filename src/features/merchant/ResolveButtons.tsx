import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { resolveBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { StatusBadge } from '../../components/StatusBadge';
import { Banner, Button, Sheet } from '../../components/ui';
import type { MerchantBooking, MerchantBookingDetail } from '../../types/database';
import { clockTime, dayLabel } from '../../lib/time';
import { serverNow, useServerNow } from '../../lib/clock';

/**
 * Attendance is the exception, not a chore. A booking nobody marks completes on its own 24 h
 * after the slot ends (private.flek_maintenance), so the happy path asks nothing — the only
 * action offered is "Nedorazil", from the start of the slot until that deadline.
 */
function deadlineLabel(booking: MerchantBooking | MerchantBookingDetail): string {
  const deadline = 'resolution_deadline' in booking && booking.resolution_deadline ? booking.resolution_deadline : null;
  if (!deadline) return '24 hodin po konci termínu';
  return `${dayLabel(deadline, serverNow()).toLocaleLowerCase('cs-CZ')} ${clockTime(deadline)}`;
}

export function ResolveButtons({ booking }: { booking: MerchantBooking | MerchantBookingDetail }) {
  const queryClient = useQueryClient();
  const now = Date.parse(useServerNow());
  const deadline = Date.parse(booking.resolution_deadline || new Date(Date.parse(booking.end_at_snapshot) + 86_400_000).toISOString());
  const canResolve = now >= Date.parse(booking.start_at_snapshot) && now < deadline;
  const awaitingCompletion = now >= deadline;
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmNoShow, setConfirmNoShow] = useState(false);

  const resolve = useMutation({
    mutationFn: (outcome: 'completed' | 'no_show') => resolveBooking(booking.id, outcome),
    onSuccess: async () => {
      setFailure(null);
      setConfirmNoShow(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['merchant-bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['merchant-metrics'] }),
        queryClient.invalidateQueries({ queryKey: ['merchant-booking-lookup'] }),
      ]);
    },
    onError: (error) => setFailure(errorMessage(error, 'merchant')),
  });

  if (booking.status !== 'confirmed') {
    // The merchant's own wording, but carried by the shared badge so a resolved booking is
    // the same colour here as everywhere else. This was the last of three separate status
    // vocabularies, and the only one still rendering as flat grey text.
    const label =
      booking.status === 'completed' ? 'Zákazník dorazil' : booking.status === 'no_show' ? 'Nedorazil' : undefined;
    return <StatusBadge status={booking.status} label={label} />;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {canResolve ? (
        <Button
          variant="danger"
          disabled={resolve.isPending}
          loading={resolve.isPending && resolve.variables === 'no_show'}
          onClick={() => setConfirmNoShow(true)}
        >
          Nedorazil
        </Button>
      ) : null}
      <p className="max-w-64 text-right text-xs text-muted">
        {canResolve
          ? `Pokud zákazník dorazil, nemusíte nic dělat. Nedorazil? Označte do ${deadlineLabel(booking)}.`
          : awaitingCompletion ? 'Rezervace se automaticky dokončuje. Nemusíte nic dělat.' : 'Nedorazil? Označit půjde od začátku termínu.'}
      </p>
      {failure ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {failure}
        </p>
      ) : null}

      <Sheet
        open={confirmNoShow}
        onClose={() => setConfirmNoShow(false)}
        title="Označit jako nedorazil?"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmNoShow(false)}>
              Zpět
            </Button>
            <Button
              variant="danger"
              className="flex-[2]"
              loading={resolve.isPending}
              onClick={() => resolve.mutate('no_show')}
            >
              Nedorazil
            </Button>
          </div>
        }
      >
        <Banner tone="warning">
          Nedostavení se zákazníkovi započítá. Po dvou během 60 dnů mu FLEK dočasně zablokuje rezervace.
        </Banner>
        <p className="mt-3 text-sm text-muted">
          {booking.customer_label} · {booking.service_name_snapshot} · {booking.reservation_code}
        </p>
      </Sheet>
    </div>
  );
}
