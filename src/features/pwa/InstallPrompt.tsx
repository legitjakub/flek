import { useEffect, useState } from 'react';
import { Share, X } from 'lucide-react';
import { Button } from '../../components/ui';
import {
  canPrompt,
  dismissed,
  isIos,
  isStandalone,
  promptInstall,
  rememberDismissal,
  subscribeInstall,
} from './install';

/**
 * Offered only where it has been earned — after a booking, or from Profile — never thrown at
 * a first-time visitor who has no reason yet to want FLEK on their home screen. A dismissal
 * is remembered, so this asks once and then stops.
 */
export function InstallPrompt() {
  const [gone, setGone] = useState(() => dismissed() || isStandalone());
  const [, force] = useState(0);

  useEffect(() => subscribeInstall(() => force((n) => n + 1)), []);

  // Chromium can open the real dialog; iOS cannot, and gets instructions instead. Anywhere
  // else there is nothing honest to offer, so nothing is shown.
  const mode = canPrompt() ? 'prompt' : isIos() ? 'ios' : null;
  if (gone || !mode) return null;

  return (
    <section className="relative rounded-2xl bg-card p-4 shadow-card">
      <button
        type="button"
        aria-label="Skrýt"
        onClick={() => {
          rememberDismissal();
          setGone(true);
        }}
        className="absolute top-2 right-2 grid size-11 place-items-center rounded-xl text-muted hover:bg-surface"
      >
        <X size={18} aria-hidden="true" />
      </button>
      <h2 className="pr-11 text-base font-extrabold">Měj FLEK po ruce</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Přidej si ho na plochu a otevřeš ho jedním klepnutím.
      </p>
      {mode === 'prompt' ? (
        <Button
          variant="secondary"
          className="mt-3"
          onClick={async () => {
            const installed = await promptInstall();
            if (installed) setGone(true);
          }}
        >
          Přidat na plochu
        </Button>
      ) : (
        <p className="mt-3 inline-flex flex-wrap items-center gap-1.5 text-sm text-muted">
          V Safari klepni na
          <Share size={15} aria-hidden="true" className="inline" />
          <span className="font-bold text-ink">Sdílet</span>a pak
          <span className="font-bold text-ink">Přidat na plochu</span>.
        </p>
      )}
    </section>
  );
}
