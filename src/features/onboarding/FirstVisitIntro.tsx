import { Dialog } from '@base-ui/react/dialog';
import { BellRing, Dumbbell, Scissors, Sparkles, TicketCheck, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from '../../app/router';
import { Button, Wordmark, cx } from '../../components/ui';
import { useSnapCarousel } from '../../components/useSnapCarousel';
import { useSession } from '../auth/session';
import { IntroDeck } from './IntroDeck';

const STORAGE_KEY = 'flek.intro.v1';

/*
 * Four steps, in the order a first visit goes: see what is free nearby, see the price against
 * the usual one, book, and — when nothing fits today — let FLEK keep looking. Every sentence
 * describes what the app does now; the booking step holds whether or not the venue confirms.
 */
const SLIDES = [
  {
    title: 'Volné FLEKy kolem tebe',
    body: 'Kadeřník, masáž, sport nebo wellness, které se právě uvolnily, se slevou. Na mapě vidíš, co máš kousek od sebe.',
  },
  {
    title: 'Lepší cena bez čekání',
    body: 'U každého FLEKu vidíš konečnou cenu i to, kolik stojí běžně. Žádné volání ani domlouvání přes zprávy.',
  },
  {
    title: 'Rezervuješ za minutu',
    body: 'Zaplatíš v aplikaci a potvrzení s kódem máš do pár minut. Když podnik nepotvrdí, nic neplatíš.',
  },
  {
    title: 'Hlídač ti dá vědět',
    body: 'Nic tě nezaujalo? Nastav si hlídač: jak daleko a co tě zajímá. Když se poblíž uvolní FLEK, pípne ti telefon.',
  },
] as const;

const OPEN_EVENT = 'flek:open-intro';

/** Opens the intro on demand — "Jak FLEK funguje?" in the profile — for anyone, anywhere. */
export function openIntro() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function wasDismissed() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'done';
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    // The local state below still prevents a loop during this browser session.
  }
}

/** Short product explanation shown once, only before an anonymous visitor sees the feed. */
export function FirstVisitIntro() {
  const { userId, ready } = useSession();
  const { path } = useRouter();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [requested, setRequested] = useState(false);
  // The first visit opens by itself; after that only when someone asks for it.
  const open = requested || (ready && !userId && !dismissed && path === '/');

  useEffect(() => {
    const show = () => setRequested(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  const carousel = useSnapCarousel<HTMLDivElement>(SLIDES.length, open ? 'open' : 'closed');

  function finish() {
    rememberDismissal();
    setDismissed(true);
    setRequested(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) finish(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[70] bg-ink/45 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
          <Dialog.Popup
            initialFocus={(type) => type === 'touch' ? true : document.querySelector<HTMLElement>('[data-intro-next]') ?? true}
            className="flex h-dvh w-full flex-col overflow-hidden bg-surface text-ink outline-none sm:h-[min(720px,90dvh)] sm:max-w-lg sm:rounded-3xl sm:shadow-lift"
          >
            <header className="flex shrink-0 items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2 sm:pt-5">
              <Wordmark />
              <Dialog.Title className="sr-only">Jak funguje FLEK</Dialog.Title>
              <button type="button" onClick={finish} className="min-h-11 rounded-xl px-3 text-sm font-bold text-muted hover:bg-card hover:text-ink">
                Přeskočit
              </button>
            </header>

            <div
              ref={carousel.viewportRef}
              onScroll={carousel.onScroll}
              onKeyDown={carousel.onKeyDown}
              tabIndex={0}
              className="rail flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain touch-pan-x"
              aria-label="Představení aplikace"
            >
              {SLIDES.map((slide, index) => (
                <section
                  key={slide.title}
                  data-snap-item
                  className="flex w-full shrink-0 snap-start snap-always flex-col justify-center px-6 py-5 sm:px-9"
                  aria-label={`Krok ${index + 1} ze ${SLIDES.length}`}
                >
                  <IntroVisual index={index} playing={open && carousel.index === index} />
                  <p className="mt-7 text-sm font-bold text-accent">{index + 1} / {SLIDES.length}</p>
                  <h2 className="mt-2 text-2xl leading-tight font-extrabold tracking-tight text-ink">{slide.title}</h2>
                  <p className="mt-3 max-w-sm text-base leading-relaxed text-muted">{slide.body}</p>
                </section>
              ))}
            </div>

            <footer className="shrink-0 border-t border-line bg-card px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="-mt-2 mb-2 flex justify-center" aria-label={`Krok ${carousel.index + 1} ze ${SLIDES.length}`}>
                {SLIDES.map((slide, index) => (
                  // The mark is 8 px; the button around it is the 44 px a thumb needs.
                  <button
                    key={slide.title}
                    type="button"
                    aria-label={`Přejít na krok ${index + 1}`}
                    aria-current={carousel.index === index ? 'step' : undefined}
                    onClick={() => carousel.goTo(index)}
                    className="grid min-h-11 min-w-11 place-items-center"
                  >
                    <span className={cx('h-2 rounded-full transition-[width,background-color]', carousel.index === index ? 'w-8 bg-brand' : 'w-2 bg-line')} />
                  </button>
                ))}
              </div>
              {/*
                One button, always the same width. A "Zpět" button that appeared from the second
                step on resized "Dále" from 350 to 250 px under the thumb that had just pressed
                it. Going back is still one gesture away — a swipe, the arrow keys, or the dots
                above, which are real buttons.
              */}
              <Button
                data-intro-next
                size="lg"
                className="w-full"
                onClick={() => carousel.index === SLIDES.length - 1 ? finish() : carousel.goTo(carousel.index + 1)}
              >
                {carousel.index === SLIDES.length - 1 ? 'Najít svůj FLEK' : 'Dále'}
              </Button>
            </footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/*
 * All visuals share one aspect ratio. The slides are centred vertically, so a taller picture on
 * one of them moved its heading up or down while swiping between them.
 */
function IntroVisual({ index, playing }: { index: number; playing: boolean }) {
  if (index === 0) {
    return (
      <MapScene>
        <FarPin className="top-[12%] left-[10%]" />
        <FarPin className="right-[8%] bottom-[16%]" />
        <FarPin className="top-[10%] right-[30%]" />
        <PricePin icon={Scissors} price="od 225 Kč" className="top-[16%] left-[36%]" />
        <PricePin icon={Dumbbell} price="350 Kč" className="top-[40%] right-[9%]" />
        <PricePin icon={Sparkles} price="290 Kč" className="bottom-[9%] left-[9%]" />
        <Here className="top-[62%] left-[52%]" />
      </MapScene>
    );
  }
  if (index === 1) return <IntroDeck playing={playing} />;
  if (index === 2) {
    return (
      <div className="mx-auto flex aspect-[5/4] w-full max-w-sm flex-col items-center justify-center rounded-3xl bg-ink p-6 text-center text-card shadow-lift" aria-hidden="true">
        <span className="grid size-14 place-items-center rounded-2xl bg-brand-on-dark text-ink"><TicketCheck size={29} /></span>
        <p className="mt-5 text-sm font-bold text-card/70">Tvůj rezervační kód</p>
        {/* The real shape of a code: FLEK- and six characters. Illustrative, not anyone's booking. */}
        <p className="tnum mt-2 rounded-xl bg-card/10 px-5 py-3 font-mono text-xl font-extrabold tracking-[0.12em] text-brand-on-dark">FLEK-8K3P2Q</p>
      </div>
    );
  }
  return (
    <MapScene>
      <span className="watch-area absolute top-[58%] left-1/2 size-[62%] -translate-x-1/2 -translate-y-1/2" />
      <FarPin className="top-[50%] left-[29%]" />
      <FarPin className="top-[62%] right-[27%]" />
      <Here className="top-[58%] left-1/2" />
      {/* What reaches the lock screen, word for word (public/sw.js): no details there, they wait in the app. */}
      <div
        className={cx(
          'absolute inset-x-3 top-3 flex items-start gap-3 rounded-2xl bg-card/95 p-3 text-left shadow-lift transition-[transform,opacity] duration-500 ease-out',
          playing ? 'translate-y-0 opacity-100 delay-300' : '-translate-y-4 opacity-0',
        )}
      >
        <AppIcon />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-extrabold text-ink">FLEK</span>
            <span className="text-muted">teď</span>
          </span>
          <span className="mt-0.5 block text-sm leading-snug text-ink">V okolí se uvolnil nový FLEK podle tvého hlídače.</span>
        </span>
      </div>
      <span className="glass absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap text-ink">
        <BellRing size={14} className="text-brand" />
        do 20 min pěšky · Masáže
      </span>
    </MapScene>
  );
}

/** The app icon (public/icon.svg) drawn in place, so the picture needs no request of its own. */
function AppIcon() {
  return (
    <svg viewBox="0 0 64 64" className="size-9 shrink-0 rounded-xl">
      <rect width="64" height="64" rx="15" className="fill-ink" />
      <path d="M32 53.4s17-17.2 17-25.4a17 17 0 1 0-34 0c0 8.2 17 25.4 17 25.4z" className="fill-brand-bright" />
      <circle cx="32" cy="28" r="10.8" className="fill-card" />
      <path d="M32 20.6v7.4l5.3 3" fill="none" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" className="stroke-ink" />
    </svg>
  );
}

/** A made-up street grid in the brand's pale blues: enough to read as a map, nothing to read on it. */
function MapScene({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto aspect-[5/4] w-full max-w-sm overflow-hidden rounded-3xl bg-accent-soft shadow-card" aria-hidden="true">
      <div className="absolute inset-0 opacity-55" style={{ backgroundImage: 'linear-gradient(30deg, transparent 46%, var(--color-brand-soft) 47%, var(--color-brand-soft) 50%, transparent 51%), linear-gradient(120deg, transparent 44%, var(--color-brand-soft) 45%, var(--color-brand-soft) 48%, transparent 49%)', backgroundSize: '80px 80px' }} />
      {children}
    </div>
  );
}

/** The map's own pin: the trade on a night tile, the price on a ticket under it. */
function PricePin({ icon: Icon, price, className }: { icon: LucideIcon; price: string; className: string }) {
  return (
    <span className={cx('absolute flex flex-col items-center', className)}>
      <span className="grid size-11 place-items-center rounded-[14px] border-2 border-card bg-ink text-brand-bright shadow-lift">
        <Icon size={20} strokeWidth={2.4} />
      </span>
      <span className="tnum -mt-2 rounded-lg bg-ink px-2 py-1 text-xs leading-none font-extrabold whitespace-nowrap text-card ring-2 ring-card">{price}</span>
    </span>
  );
}

/** A venue further off, drawn the way the zoomed-out map draws it: FLEK's small pin. */
function FarPin({ className }: { className: string }) {
  return (
    <svg viewBox="-1 0 26 33" className={cx('absolute h-[33px] w-[26px] drop-shadow-sm', className)}>
      <path d="M12 30.6s11-11.8 11-17.6a11 11 0 1 0-22 0c0 5.8 11 17.6 11 17.6z" className="fill-brand stroke-card" strokeWidth={2} paintOrder="stroke" />
      <circle cx="12" cy="13" r="6.6" className="fill-card" />
      <path d="M12 8.4v4.6l3.5 2" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="stroke-ink" />
    </svg>
  );
}

/** The blue dot of the map, with its pulse and a label the real map does not need. */
function Here({ className }: { className: string }) {
  return (
    <span className={cx('absolute -translate-x-1/2 -translate-y-1/2', className)}>
      <span className="user-halo absolute top-1/2 left-1/2 size-20 -translate-x-1/2 -translate-y-1/2" />
      <span className="user-dot" />
      <span className="absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-full bg-card px-2.5 py-1 text-xs font-bold whitespace-nowrap text-ink shadow-card">Tady jsi</span>
    </span>
  );
}
