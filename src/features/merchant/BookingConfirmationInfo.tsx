import { useQuery } from '@tanstack/react-query';
import { businessPaymentsStatus } from '../../lib/api';
import type { Business } from '../../types/database';

/**
 * How new bookings reach the venue now that each one waits for its answer. Shown only when the
 * server says this venue's bookings need confirmation, so it never describes a flow the venue is not on.
 */
export function BookingConfirmationInfo({ business }: { business: Business }) {
  const status = useQuery({ queryKey: ['business-payments', business.id], queryFn: () => businessPaymentsStatus(business.id) });
  if (!status.data?.manual_confirmation) return null;
  return (
    <section className="rounded-2xl bg-card p-5 shadow-card sm:p-6" aria-labelledby="potvrzovani">
      <h2 id="potvrzovani" className="text-lg font-extrabold tracking-tight text-ink">Potvrzování rezervací</h2>
      <p className="mt-1 text-base leading-relaxed text-muted">
        Každou novou rezervaci potvrzujete vy. Zákazníkovi se částka na kartě zatím jen zablokuje a vám přijde žádost
        s odpočtem. Po potvrzení platbu dokončíme a zákazník dostane rezervační kód. Když rezervaci odmítnete nebo ji
        nestihnete potvrdit, blokace se uvolní a zákazník nic nezaplatí.
      </p>
      <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
        <li><span className="font-bold">10 minut</span> na potvrzení, když termín začíná za víc než 2 hodiny,</li>
        <li><span className="font-bold">5 minut</span>, když začíná za 30 minut až 2 hodiny,</li>
        <li><span className="font-bold">3 minuty</span>, když začíná za 15 až 30 minut,</li>
        <li>vždy nejpozději 10 minut před začátkem. Termín, který začíná dřív než za 15 minut, si rezervovat nejde.</li>
      </ul>
    </section>
  );
}
