import { Dialog } from '@base-ui/react/dialog';
import { MapPin, TicketCheck } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from '../../app/router';
import { Button, Wordmark, cx } from '../../components/ui';
import { useSnapCarousel } from '../../components/useSnapCarousel';
import { useSession } from '../auth/session';
import { IntroDeck } from './IntroDeck';

const STORAGE_KEY = 'flek.intro.v1';

const SLIDES = [
  {
    title: 'Volný termín právě teď',
    body: 'Najdi poblíž kadeřnictví, masáž, sport nebo wellness, kde mají last-minute místo za mnohem nižší cenu.',
  },
  {
    title: 'Lepší cena bez čekání',
    body: 'Konečnou cenu i úsporu vidíš předem. Žádné volání ani domlouvání přes zprávy.',
  },
  {
    title: 'Rezervuješ za minutu',
    body: 'Zaplatíš bezpečně v aplikaci a v podniku už jen ukážeš svůj rezervační kód.',
  },
] as const;

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
  const open = ready && !userId && !dismissed && path === '/';
  const carousel = useSnapCarousel<HTMLDivElement>(SLIDES.length, open ? 'open' : 'closed');

  function finish() {
    rememberDismissal();
    setDismissed(true);
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
              <div className="mb-4 flex justify-center gap-2" aria-label={`Krok ${carousel.index + 1} ze ${SLIDES.length}`}>
                {SLIDES.map((slide, index) => (
                  <button
                    key={slide.title}
                    type="button"
                    aria-label={`Přejít na krok ${index + 1}`}
                    aria-current={carousel.index === index ? 'step' : undefined}
                    onClick={() => carousel.goTo(index)}
                    className={cx('h-2 rounded-full transition-[width,background-color]', carousel.index === index ? 'w-8 bg-brand' : 'w-2 bg-line')}
                  />
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
 * All three visuals share one aspect ratio. The slides are centred vertically, so a taller
 * picture on one of them moved its heading up or down while swiping between them.
 */
function IntroVisual({ index, playing }: { index: number; playing: boolean }) {
  if (index === 0) {
    return (
      <div className="relative mx-auto aspect-[5/4] w-full max-w-sm overflow-hidden rounded-3xl bg-accent-soft shadow-card" aria-hidden="true">
        <div className="absolute inset-0 opacity-55" style={{ backgroundImage: 'linear-gradient(30deg, transparent 46%, #d8e5bd 47%, #d8e5bd 50%, transparent 51%), linear-gradient(120deg, transparent 44%, #d8e5bd 45%, #d8e5bd 48%, transparent 49%)', backgroundSize: '80px 80px' }} />
        <span className="absolute top-[22%] left-[14%] rounded-full bg-card px-3 py-2 text-sm font-extrabold shadow-lift">od 225 Kč</span>
        <span className="absolute top-[48%] right-[9%] rounded-full bg-card px-3 py-2 text-sm font-extrabold shadow-lift">350 Kč</span>
        <span className="absolute bottom-[14%] left-[36%] grid size-14 place-items-center rounded-full bg-brand text-ink shadow-lift"><MapPin size={27} aria-hidden="true" /></span>
      </div>
    );
  }
  if (index === 1) return <IntroDeck playing={playing} />;
  return (
    <div className="mx-auto flex aspect-[5/4] w-full max-w-sm flex-col items-center justify-center rounded-3xl bg-ink p-6 text-center text-card shadow-lift" aria-hidden="true">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand text-ink"><TicketCheck size={29} /></span>
      <p className="mt-5 text-sm font-bold text-card/70">Tvůj rezervační kód</p>
      <p className="tnum mt-2 rounded-xl bg-card/10 px-5 py-3 text-xl font-extrabold tracking-[0.14em]">FLEK-8K3P</p>
    </div>
  );
}
