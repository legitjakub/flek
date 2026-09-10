import { useEffect, useState, type CSSProperties } from 'react';
import { money } from '../../lib/format';
import { DiscountBadge, OriginalPrice } from '../../components/Price';

/*
 * Illustrative, not inventory: no venue names, so the intro never presents a business
 * that does not exist as if it were a real offer. Service, district and time are enough
 * to show what the product is — and the spread of prices and discounts is the point.
 *
 * The photographs are 560 px copies of the service illustrations (260 kB for all five
 * instead of 1.5 MB), because this is the very first thing a new visitor downloads.
 */
const DECK = [
  { image: '/images/intro/padel-prague.jpg', service: 'Padel na hodinu', place: 'Holešovice', time: 'Dnes 18:30', price: 390, was: 650 },
  { image: '/images/intro/sauna-prague.jpg', service: 'Privátní sauna', place: 'Dejvice', time: 'Dnes 20:00', price: 225, was: 450 },
  { image: '/images/intro/yoga-prague.jpg', service: 'Jóga pro začátečníky', place: 'Karlín', time: 'Dnes 17:00', price: 180, was: 240 },
  { image: '/images/intro/personal-training-prague.jpg', service: 'Osobní trénink', place: 'Vinohrady', time: 'Zítra 7:30', price: 585, was: 900 },
  { image: '/images/intro/tennis-prague.jpg', service: 'Tenisový kurt', place: 'Letná', time: 'Dnes 19:00', price: 320, was: 460 },
] as const;

const INTERVAL_MS = 2600;
const EXIT_MS = 560;
/** How many cards show behind the front one; the rest wait invisibly at the back. */
const VISIBLE_BEHIND = 2;

/**
 * A deck of offers that deals itself: the front card is thrown aside and the next one comes
 * forward, so the slide about price shows five different services at five different prices
 * instead of one frozen mock-up of a single number.
 *
 * It only moves while it can be seen — `playing` is false on the other slides and once the
 * intro closes — and never for someone who has asked for reduced motion, who gets the same
 * deck standing still.
 */
export function IntroDeck({ playing }: { playing: boolean }) {
  // One state, pure updaters: the card that leaves is always the one that was in front.
  const [{ front, leaving }, setDeck] = useState<{ front: number; leaving: number | null }>({ front: 0, leaving: null });
  const [still] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (!playing || still) return;
    let exit: number | undefined;
    const deal = window.setInterval(() => {
      setDeck((deck) => ({ front: (deck.front + 1) % DECK.length, leaving: deck.front }));
      exit = window.setTimeout(() => setDeck((deck) => ({ ...deck, leaving: null })), EXIT_MS);
    }, INTERVAL_MS);
    return () => {
      window.clearInterval(deal);
      if (exit !== undefined) window.clearTimeout(exit);
    };
  }, [playing, still]);

  return (
    <div className="relative mx-auto aspect-[5/4] w-full max-w-sm" aria-hidden="true">
      {DECK.map((card, index) => {
        const position = (index - front + DECK.length) % DECK.length;
        const exiting = index === leaving;
        const hidden = !exiting && position > VISIBLE_BEHIND;
        const style: CSSProperties = exiting
          ? { transform: 'translateX(-118%) rotate(-11deg)', opacity: 0, zIndex: DECK.length + 1 }
          : {
              // Each card behind sits a step higher and a step smaller, so the deck reads as
              // depth rather than as a pile of identical rectangles.
              transform: `translateY(${-Math.min(position, VISIBLE_BEHIND) * 13}px) scale(${1 - Math.min(position, VISIBLE_BEHIND) * 0.055})`,
              opacity: hidden ? 0 : 1,
              zIndex: DECK.length - position,
            };
        const pct = Math.floor(((card.was - card.price) * 100) / card.was);
        return (
          <article
            key={card.service}
            style={style}
            className="absolute inset-x-3 top-7 bottom-0 flex origin-top flex-col overflow-hidden rounded-2xl bg-card shadow-lift transition-[transform,opacity] duration-[560ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          >
            {/* The photograph takes whatever height the facts leave, so the text block stays
                tight instead of pushing the price to the bottom with a gap above it. */}
            <div className="relative min-h-0 flex-1">
              <img
                src={card.image}
                alt=""
                width={560}
                height={420}
                decoding="async"
                className="size-full object-cover"
              />
              {/* Only the front card carries its badge: behind it, the badges peeked out as
                  green slivers above the deck and read as clutter. */}
              <DiscountBadge
                pct={pct}
                className={`absolute top-3 left-3 shadow-card transition-opacity duration-300 ${position === 0 || exiting ? 'opacity-100' : 'opacity-0'}`}
              />
            </div>
            <div className="shrink-0 px-3.5 pt-3 pb-3.5">
              <p className="truncate text-base leading-snug font-extrabold text-ink">{card.service}</p>
              <p className="tnum truncate text-sm text-muted">
                {card.place} · <span className="font-bold text-ink">{card.time}</span>
              </p>
              <p className="mt-2 flex items-baseline gap-2">
                <span className="tnum text-xl leading-none font-extrabold text-ink">{money(card.price * 100)}</span>
                <OriginalPrice cents={card.was * 100} className="text-sm" />
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
