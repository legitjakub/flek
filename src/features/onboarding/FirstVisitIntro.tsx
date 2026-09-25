import { Dialog } from '@base-ui/react/dialog';
import { BadgePercent, MapPin, TicketCheck, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../../app/router';
import { Button, Wordmark } from '../../components/ui';
import { useSession } from '../auth/session';
import { IntroDeck } from './IntroDeck';

const STORAGE_KEY = 'flek.intro.v1';

/*
 * One screen, not four slides. The carousel explained the map, the price, the code and the watch
 * in turn, and a first visit swiped past most of it. What makes someone want FLEK fits on one
 * screen: real-looking deals dealing themselves, the promise in the same words as the feed, and
 * three things they get. The watch is offered in Objevit when nothing fits, where it makes sense.
 * Every line describes what the app does now.
 */
const BENEFITS: Array<{ icon: LucideIcon; text: string }> = [
  { icon: MapPin, text: 'Volno kousek od tebe' },
  { icon: BadgePercent, text: 'Vždy víš, kolik ušetříš' },
  { icon: TicketCheck, text: 'V podniku jen ukážeš kód' },
];

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
  const popup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = () => setRequested(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

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
          {/* It opens by itself on arrival, so focus goes to the screen, not to the button: a focus
              ring round "Najít svůj FLEK" greeted every first visit on a phone. Tab still reaches it. */}
          <Dialog.Popup
            ref={popup}
            initialFocus={() => popup.current ?? true}
            className="flex h-dvh w-full flex-col overflow-hidden bg-surface text-ink outline-none sm:h-[min(760px,92dvh)] sm:max-w-lg sm:rounded-3xl sm:shadow-lift"
          >
            <header className="flex shrink-0 items-center justify-between px-5 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-4">
              <Wordmark />
              <Dialog.Close aria-label="Zavřít" className="grid size-11 place-items-center rounded-xl text-muted hover:bg-card hover:text-ink">
                <X size={20} aria-hidden="true" />
              </Dialog.Close>
            </header>

            {/* The deals take whatever height the words leave, so a short phone still shows the button. */}
            <div className="flex min-h-0 flex-1 flex-col px-6 pt-2 sm:px-9">
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <IntroDeck playing={open} className="h-full max-h-[20rem] max-w-full" />
              </div>
              <Dialog.Title className="mt-5 text-[2rem] leading-[1.05] font-extrabold tracking-tight text-ink">
                Volné FLEKy.
                <br />
                <span className="text-brand">Se slevou.</span>
              </Dialog.Title>
              <p className="mt-3 max-w-sm text-base leading-relaxed text-muted">
                Když se podniku uvolní termín, nabídne ti ho levněji.
              </p>
              <ul className="mt-4 mb-2 flex flex-col gap-2.5">
                {BENEFITS.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-3 text-base font-bold text-ink">
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-accent">
                      <Icon size={18} />
                    </span>
                    {text}
                  </li>
                ))}
              </ul>
            </div>

            <footer className="shrink-0 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button variant="brand" size="lg" className="w-full" onClick={finish}>
                Najít svůj FLEK
              </Button>
            </footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
