import { ArrowUpRight, Clock3, MapPin } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { money, distance as formatDistance } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import type { SearchRow } from '../../types/database';

/** A missing photo is a compact text card, never a placeholder for a business. */
export function OfferCard({ offer, now }: { offer: SearchRow; now: string }) {
  const { path, search } = useRouter();
  const origin = `${path}${search.size ? `?${search}` : ''}`;
  const photo = offer.image_url ?? offer.cover_url;
  return (
    <Link to={`/nabidka/${offer.id}?from=${encodeURIComponent(origin)}`} className="offer-card group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-150 hover:border-accent/40 hover:shadow-card">
      {photo ? <img src={photo} alt="" loading="lazy" decoding="async" className="aspect-[2/1] w-full object-cover" /> : null}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base leading-snug font-extrabold text-ink [overflow-wrap:anywhere]">{offer.service_name}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">{offer.business_name}{offer.district ? ` · ${offer.district}` : ''}</p>
          </div>
          <ArrowUpRight aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-muted transition-colors group-hover:text-accent" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="tnum rounded-lg bg-accent-soft px-3 py-2 text-base font-extrabold text-accent">{dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}</p>
          {offer.capacity_remaining === 1 && offer.capacity_total > 1 ? <span className="text-sm font-semibold text-muted">Poslední místo</span> : null}
        </div>
        <p className="tnum mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5"><Clock3 size={15} aria-hidden="true" />{duration(offer.start_at, offer.end_at)} min</span>
          <span className="inline-flex items-center gap-1.5"><MapPin size={15} aria-hidden="true" />{formatDistance(offer.distance_m)}</span>
        </p>
        <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-4">
          <span className="tnum text-xl font-extrabold tracking-tight">{money(offer.deal_price_cents)}</span>
          <s className="tnum text-sm text-muted">{money(offer.original_price_cents)}</s>
          <span className="tnum ml-auto text-sm font-bold text-accent">−{offer.discount_pct} %</span>
        </div>
      </div>
    </Link>
  );
}
