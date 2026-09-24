import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { businessPaymentsStatus } from '../../lib/api';
import type { Business } from '../../types/database';
import { ConfirmationWindows } from './PartnerHelp';

/**
 * How new bookings reach the venue now that each one waits for its answer. Shown only when the
 * server says this venue's bookings need confirmation, so it never describes a flow the venue is not on.
 * Two sentences and the minutes behind a tap: the full paragraph and list took a phone screen on a
 * page the venue opens for everything else.
 */
export function BookingConfirmationInfo({ business }: { business: Business }) {
  const status = useQuery({ queryKey: ['business-payments', business.id], queryFn: () => businessPaymentsStatus(business.id) });
  if (!status.data?.manual_confirmation) return null;
  return (
    <section id="potvrzovani" className="scroll-mt-24 rounded-2xl bg-card p-5 shadow-card sm:p-6" aria-labelledby="potvrzovani-nadpis">
      <h2 id="potvrzovani-nadpis" className="text-lg font-extrabold tracking-tight text-ink">Potvrzování rezervací</h2>
      <p className="mt-1 text-base leading-relaxed text-muted">
        Každou novou rezervaci potvrzujete vy. Do potvrzení je částka zákazníkovi jen zablokovaná na kartě. Když
        rezervaci odmítnete nebo ji nestihnete potvrdit, blokace se uvolní a zákazník nic nezaplatí.
      </p>
      <details className="group mt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-bold text-accent [&::-webkit-details-marker]:hidden">
          Kolik mám času na potvrzení?
          <ChevronDown size={17} aria-hidden="true" className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="pb-1">
          <ConfirmationWindows />
        </div>
      </details>
    </section>
  );
}
