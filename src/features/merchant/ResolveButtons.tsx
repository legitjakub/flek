import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { resolveBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Button } from '../../components/ui';
import type { MerchantBooking, MerchantBookingDetail } from '../../types/database';

/** Attendance can only be recorded after the appointment started; the RPC enforces it too. */
export function ResolveButtons({ booking }: { booking: MerchantBooking | MerchantBookingDetail }) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const resolve = useMutation({
    mutationFn: (outcome: 'completed' | 'no_show') => resolveBooking(booking.id, outcome),
    onSuccess: async () => {
      setFailure(null);
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  if (booking.status !== 'confirmed') {
    return <span className="text-sm text-muted">{booking.status === 'completed' ? 'Dorazil' : 'Vyřízeno'}</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          size="lg"
          disabled={!booking.can_resolve}
          loading={resolve.isPending && resolve.variables === 'completed'}
          onClick={() => resolve.mutate('completed')}
        >
          Zákazník dorazil
        </Button>
        <Button
          size="lg"
          variant="secondary"
          disabled={!booking.can_resolve}
          loading={resolve.isPending && resolve.variables === 'no_show'}
          onClick={() => resolve.mutate('no_show')}
        >
          Nedorazil
        </Button>
      </div>
      {!booking.can_resolve ? (
        <p className="text-xs text-muted">Docházku potvrdíte až po začátku termínu.</p>
      ) : null}
      {failure ? (
        <p role="alert" className="text-xs font-medium text-accent">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
