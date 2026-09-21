import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Star } from 'lucide-react';
import { Link } from '../../app/router';
import { businessReviews } from '../../lib/api';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui';

const date = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });

export function FlekRatingSummary({
  businessId,
  average,
  count,
  href,
}: {
  businessId: string;
  average: number | null;
  count: number;
  href?: string;
}) {
  if (!average || count < 1) return null;
  const content = (
    <>
      <Star size={14} aria-hidden="true" className="fill-brand text-brand" />
      <span className="tnum">{new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(average)}</span>
      <span className="font-normal text-muted">({count}) na FLEKu</span>
    </>
  );
  return href ? (
    <Link
      to={href}
      aria-label={`${average} z 5, ${count} ověřených hodnocení na FLEKu`}
      className="inline-flex min-h-8 items-center gap-1 font-bold text-ink underline decoration-line underline-offset-4 hover:text-accent"
    >
      {content}
    </Link>
  ) : (
    <span data-business-id={businessId} className="inline-flex items-center gap-1 text-sm font-bold text-ink">
      {content}
    </span>
  );
}
export function BusinessReviews({ businessId, average, count }: {
  businessId: string;
  average: number | null;
  count: number;
}) {
  const query = useQuery({
    queryKey: ['business-reviews', businessId],
    queryFn: () => businessReviews(businessId, 8),
    staleTime: 60_000,
  });

  return (
    <section id="hodnoceni-flek" className="mt-8 scroll-mt-24" aria-labelledby="hodnoceni-flek-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="hodnoceni-flek-title" className="text-lg font-extrabold tracking-tight">Hodnocení na FLEKu</h2>
          <p className="mt-1 text-sm text-muted">Jen od zákazníků, kteří rezervaci opravdu dokončili.</p>
        </div>
        <FlekRatingSummary businessId={businessId} average={average} count={count} />
      </div>

      {query.isPending ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : query.isError ? (
        <div className="mt-3"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div>
      ) : query.data.length === 0 ? (
        <div className="mt-3"><EmptyState title="Zatím bez hodnocení." body="První recenzi může přidat zákazník po dokončené návštěvě." /></div>
      ) : (
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {query.data.map((review) => (
            <li key={review.review_id} className="rounded-2xl bg-card p-4 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-0.5" aria-label={`${review.rating} z 5 hvězd`}>
                  {Array.from({ length: 5 }, (_, index) => (
                    <Star key={index} size={16} aria-hidden="true" className={index < review.rating ? 'fill-brand text-brand' : 'text-line'} />
                  ))}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-positive">
                  <ShieldCheck size={14} aria-hidden="true" /> Ověřená návštěva
                </span>
              </div>
              {review.comment ? <p className="mt-3 text-sm leading-relaxed text-ink">„{review.comment}“</p> : null}
              <p className="mt-3 text-xs text-muted">{review.service_name} · {date.format(new Date(review.visited_at))}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
