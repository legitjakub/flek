import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { UserX } from 'lucide-react';
import { resolveBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { StatusBadge } from '../../components/StatusBadge';
import { Banner, Button, Sheet } from '../../components/ui';
import type { MerchantBooking, MerchantBookingDetail } from '../../types/database';
import { clockTime, dayLabel } from '../../lib/time';
import { serverNow, useServerNow } from '../../lib/clock';
import { CardAction } from './partnerUi';

type Row = MerchantBooking | MerchantBookingDetail;

/**
 * Attendance is the exception, not a chore. A booking nobody marks completes on its own 24 h
 * after the slot ends (private.flek_maintenance), so the happy path asks nothing — the only
 * action offered is "Nedorazil", from the start of the slot until that deadline.
 */
function deadlineLabel(booking: Row): string {
  const deadline = 'resolution_deadline' in booking && booking.resolution_deadline ? booking.resolution_deadline : null;
  if (!deadline) return '24 hodin po konci termínu';
  return `${dayLabel(deadline, serverNow()).toLocaleLowerCase('cs-CZ')} ${clockTime(deadline)}`;
}

/** Whether "Nedorazil" can be marked now, and whether the booking is already completing on its own. */
export function noShowWindow(booking: Row, now: number): { canResolve: boolean; awaitingCompletion: boolean } {
  const deadline = Date.parse(booking.resolution_deadline || new Date(Date.parse(booking.end_at_snapshot) + 86_400_000).toISOString());
  return { canResolve: now >= Date.parse(booking.start_at_snapshot) && now < deadline, awaitingCompletion: now >= deadline };
}

/** The line under a confirmed booking once it has started; before that there is nothing to say. */
export function noShowHint(booking: Row, now: number): string | null {
  if (booking.status !== 'confirmed') return null;
  const { canResolve, awaitingCompletion } = noShowWindow(booking, now);
  if (canResolve) return `Pokud zákazník dorazil, nemusíte nic dělat. Nedorazil? Označte do ${deadlineLabel(booking)}.`;
  if (awaitingCompletion) return 'Rezervace se automaticky dokončuje. Nemusíte nic dělat.';
  return null;
}

/** The confirmation sheet and the call behind it, shared by the button and the card action. */
function useNoShow(booking: Row): { ask: () => void; pending: boolean; sheet: ReactNode } {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const resolve = useMutation({
    mutationFn: () => resolveBooking(booking.id, 'no_show'),
    onSuccess: async () => {
      setFailure(null);
      setConfirming(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['merchant-bookings'] }),
        queryClient.invalidateQueries({ queryKey: ['merchant-metrics'] }),
        queryClient.invalidateQueries({ queryKey: ['merchant-booking-lookup'] }),
      ]);
    },
    onError: (error) => setFailure(errorMessage(error, 'merchant')),
  });

  const sheet = (
    <Sheet
      open={confirming}
      onClose={() => setConfirming(false)}
      title="Označit jako nedorazil?"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>
            Zpět
          </Button>
          <Button variant="danger" className="flex-[2]" loading={resolve.isPending} onClick={() => resolve.mutate()}>
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
      {/* In the sheet, not behind it: the sheet stays open when the call fails. */}
      {failure ? (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {failure}
        </p>
      ) : null}
    </Sheet>
  );

  return {
    ask: () => {
      setFailure(null);
      setConfirming(true);
    },
    pending: resolve.isPending,
    sheet,
  };
}

/** "Nedorazil" as a button, for a list whose heading already says what it is for. */
export function ResolveButtons({ booking }: { booking: Row }) {
  const now = Date.parse(useServerNow());
  const { canResolve } = noShowWindow(booking, now);
  const noShow = useNoShow(booking);

  if (booking.status !== 'confirmed') {
    // The merchant's own wording, but carried by the shared badge so a resolved booking is
    // the same colour here as everywhere else.
    const label =
      booking.status === 'completed' ? 'Zákazník dorazil' : booking.status === 'no_show' ? 'Nedorazil' : undefined;
    return <StatusBadge status={booking.status} label={label} />;
  }

  return (
    <>
      {canResolve ? (
        <Button variant="danger" loading={noShow.pending} onClick={noShow.ask}>
          <UserX size={17} aria-hidden="true" />
          Nedorazil
        </Button>
      ) : null}
      {noShow.sheet}
    </>
  );
}

/** "Nedorazil" along the bottom of a booking's card, while it can be marked. */
export function NoShowAction({ booking }: { booking: Row }) {
  const now = Date.parse(useServerNow());
  const noShow = useNoShow(booking);
  if (booking.status !== 'confirmed' || !noShowWindow(booking, now).canResolve) return null;
  return (
    <>
      <CardAction icon={<UserX size={18} />} label={noShow.pending ? 'Ukládám…' : 'Nedorazil'} tone="danger" onClick={noShow.ask} />
      {noShow.sheet}
    </>
  );
}
