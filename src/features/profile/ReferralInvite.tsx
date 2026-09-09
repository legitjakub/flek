import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Share2 } from 'lucide-react';
import { myReferralCode, myReferralStats } from '../../lib/api';
import { Button, Skeleton } from '../../components/ui';

/**
 * Attribution first, money later. This deliberately promises nothing spendable: the payment
 * invariant requires a settled payment matching the offer price, so a credit balance shown
 * here would be a number the booking flow could not honour. When a reward can actually be
 * redeemed end to end, the copy changes — not before.
 */
export function ReferralInvite({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);

  const code = useQuery({ queryKey: ['referral-code-mine', userId], queryFn: myReferralCode, staleTime: Infinity });
  const stats = useQuery({ queryKey: ['referral-stats', userId], queryFn: myReferralStats, staleTime: 60_000 });

  if (code.isPending) return <Skeleton className="h-32 w-full" />;
  if (code.isError || !code.data) return null;

  const url = `${window.location.origin}/r/${code.data}`;
  const text = 'Pošli FLEK někomu, komu by se hodily volné termíny na poslední chvíli.';
  const invited = stats.data?.invited ?? 0;
  const qualified = stats.data?.qualified ?? 0;

  return (
    <section className="rounded-2xl bg-card p-5 shadow-card">
      <h2 className="text-base font-extrabold">Pozvi kamaráda</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>

      <p className="tnum mt-3 overflow-x-auto rounded-xl bg-surface px-3 py-2 font-mono text-base font-bold tracking-[0.12em]">
        {url.replace(/^https?:\/\//, '')}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {typeof navigator !== 'undefined' && navigator.share ? (
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.share({ title: 'FLEK', text, url });
              } catch {
                // Dismissing the share sheet is a choice, not an error.
              }
            }}
          >
            <Share2 size={17} aria-hidden="true" />
            Sdílet pozvánku
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
          {copied ? 'Zkopírováno' : 'Kopírovat odkaz'}
        </Button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Odkaz na pozvánku zkopírován.' : ''}
      </span>

      {/* Shown only once there is something true to report. "Využilo" means the invited
          person actually completed a FLEK — not that they clicked, not that they signed up. */}
      {invited > 0 ? (
        <p className="tnum mt-4 border-t border-line pt-3 text-sm text-muted">
          Pozváno {invited} · z toho {qualified} už FLEK opravdu využilo
        </p>
      ) : null}
    </section>
  );
}
