import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { resolveBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { StatusBadge } from '../../components/StatusBadge';
import { Banner, Button, Sheet } from '../../components/ui';
import type { MerchantBooking, MerchantBookingDetail } from '../../types/database';

/** Attendance can only be recorded after the appointment started; the RPC enforces it too. */
export function ResolveButtons({ booking }: { booking: MerchantBooking | MerchantBookingDetail }) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmNoShow, setConfirmNoShow] = useState(false);

  const resolve = useMutation({
    mutationFn: (outcome: 'completed' | 'no_show') => resolveBooking(booking.id, outcome),
    onSuccess: async () => {
      setFailure(null);
      setConfirmNoShow(false);
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
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
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="lg"
          disabled={!booking.can_resolve || resolve.isPending}
          loading={resolve.isPending && resolve.variables === 'completed'}
          onClick={() => resolve.mutate('completed')}
        >
          Zákazník dorazil
        </Button>
        <Button
          size="lg"
          variant="danger"
          disabled={!booking.can_resolve || resolve.isPending}
          loading={resolve.isPending && resolve.variables === 'no_show'}
          onClick={() => setConfirmNoShow(true)}
        >
          Nedorazil
        </Button>
      </div>
      {!booking.can_resolve ? (
        <p className="text-xs text-muted">Docházku potvrdíte až po začátku termínu.</p>
      ) : null}
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
