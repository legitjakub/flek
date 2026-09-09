import { useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { track } from '../../lib/analytics';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import { Button } from '../../components/ui';
import type { OfferDetail } from '../../types/database';

/**
 * The message is built from the offer's own facts, because that is what makes a forwarded
 * link worth opening: the service, when it is, and what it costs against the usual price.
 */
export function shareText(offer: OfferDetail, now: string): string {
  return `Mrkni na tenhle FLEK — ${offer.service_name}, ${offer.business_name}, ${dayLabel(
    offer.start_at,
    now,
  ).toLowerCase()} v ${clockTime(offer.start_at)}. Místo ${money(offer.original_price_cents)} za ${money(
    offer.deal_price_cents,
  )}.`;
}

/**
 * Always the offer's own deep link, never the discovery page the sender happened to be on:
 * a recipient who lands on a list has to hunt for the thing they were sent. If the slot is
 * gone by the time they open it, the detail page's recovery block takes over — which is why
 * sharing a specific offer stays worthwhile rather than becoming a dead end.
 */
export function ShareOfferButton({ offer, now, compact = false }: { offer: OfferDetail; now: string; compact?: boolean }) {
  const [done, setDone] = useState<'shared' | 'copied' | null>(null);
  const [failed, setFailed] = useState(false);

  const url = `${window.location.origin}/nabidka/${offer.id}`;
  const text = shareText(offer, now);

  return (
    <span className="relative inline-flex shrink-0 flex-wrap items-center gap-2">
      <Button
        variant={compact ? 'ghost' : 'secondary'}
        className={compact ? 'size-11 rounded-full! px-0!' : undefined}
        aria-label={compact ? 'Sdílet nabídku' : undefined}
        title={compact ? 'Sdílet nabídku' : undefined}
        onClick={async () => {
          setFailed(false);
          try {
            if (navigator.share) {
              await navigator.share({ title: `FLEK · ${offer.service_name}`, text, url });
              setDone('shared');
            } else {
              await navigator.clipboard.writeText(`${text} ${url}`);
              setDone('copied');
            }
            track('offer_shared', { offer_id: offer.id, business_id: offer.business_id });
          } catch (error) {
            // Dismissing the OS share sheet raises AbortError. That is a person changing
            // their mind, not a failure, and must not be reported as one.
            if (error instanceof DOMException && error.name === 'AbortError') return;
            setFailed(true);
          }
        }}
      >
        {done === 'copied' ? <Check size={18} className="shrink-0" aria-hidden="true" /> : <Share2 size={18} className="shrink-0" aria-hidden="true" />}
        {compact ? null : 'Sdílet'}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {done === 'copied' ? 'Odkaz zkopírován do schránky.' : done === 'shared' ? 'Sdíleno.' : ''}
      </span>
      {done === 'copied' && !compact ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-positive">
          <Check size={15} aria-hidden="true" />
          Zkopírováno
        </span>
      ) : null}
      {failed ? <span role="alert" className={compact ? 'absolute top-full right-0 z-10 w-44 rounded-lg bg-card p-2 text-sm text-danger shadow-card' : 'text-sm text-danger'}>Sdílení se nepodařilo.</span> : null}
    </span>
  );
}
