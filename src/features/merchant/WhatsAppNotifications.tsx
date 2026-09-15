import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { businessPaymentsStatus, whatsappDisable, whatsappSettings, whatsappStartPairing } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useServerNow } from '../../lib/clock';
import { displayPhone, whatsappLink } from '../../lib/phone';
import { Banner, Button, Field, Input, buttonClass } from '../../components/ui';
import { timeLeft } from '../bookings/confirmationView';
import type { Business, WhatsAppPairing } from '../../types/database';

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

/**
 * WhatsApp notifications for requests. The number is proven by a pairing code the venue sends from
 * it; nothing on this page is a link that acts by being opened. The code lives only in this page's
 * memory: the database keeps its hash, so a reload asks for a new one.
 */
export function WhatsAppNotifications({ business }: { business: Business }) {
  const queryClient = useQueryClient();
  const now = useServerNow(1_000);
  const [phone, setPhone] = useState(business.phone ?? '');
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pairing, setPairing] = useState<WhatsAppPairing | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const settings = useQuery({
    queryKey: ['whatsapp-settings', business.id],
    queryFn: () => whatsappSettings(business.id),
    // While a code is out, look for the venue's message to arrive.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3_000 : false),
  });
  const data = settings.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['whatsapp-settings', business.id] });

  const start = useMutation({
    mutationFn: () => whatsappStartPairing(business.id, phone, data!.consent_version),
    onSuccess: (result) => {
      setPairing(result);
      setEditing(false);
      setNotice(null);
      void refresh();
    },
    onError: (error) => setNotice({ tone: 'warning', text: errorMessage(error, 'merchant') }),
  });
  const disable = useMutation({
    mutationFn: () => whatsappDisable(business.id),
    onSuccess: () => {
      setPairing(null);
      setNotice({ tone: 'success', text: 'WhatsApp upozornění jsou vypnutá.' });
      void refresh();
    },
    onError: (error) => setNotice({ tone: 'warning', text: errorMessage(error, 'merchant') }),
  });

  const verified = data?.status === 'verified';
  useEffect(() => {
    if (!verified || !pairing) return;
    setPairing(null);
    setConsent(false);
    setNotice({ tone: 'success', text: 'Hotovo, WhatsApp je propojený. Další žádost o rezervaci vám přijde i tam.' });
  }, [verified, pairing]);

  if (!data) return null;

  const left = pairing ? timeLeft(pairing.expires_at, now) : null;
  const waitingForCode = data.status === 'pending' && pairing && left && left.seconds > 0;
  const showForm = data.available && (editing || (!verified && !waitingForCode));

  return (
    <section className="rounded-2xl bg-card p-5 shadow-card sm:p-6" aria-labelledby="whatsapp">
      <h2 id="whatsapp" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
        <MessageCircle size={20} aria-hidden="true" />
        WhatsApp upozornění
      </h2>

      {!data.available ? (
        <p className="mt-1 text-sm text-muted">
          WhatsApp upozornění zatím nejsou aktivní. Nové žádosti o rezervaci uvidíte tady v aplikaci, a pokud máte
          zapnutý e-mail nebo oznámení na telefonu, přijdou vám i tam.
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Na novou žádost o rezervaci vám pošleme zprávu s tlačítky Potvrdit a Nemohu přijmout. Odpověď z WhatsAppu
          platí stejně jako v aplikaci.
        </p>
      )}

      {notice ? <div className="mt-3"><Banner tone={notice.tone}>{notice.text}</Banner></div> : null}

      {verified && !editing ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-base text-ink">
            Zprávy chodí na <span className="tnum font-bold whitespace-nowrap">{displayPhone(data.phone)}</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { setEditing(true); setNotice(null); }}>Změnit číslo</Button>
            <Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate()}>Vypnout</Button>
          </div>
        </div>
      ) : null}

      {waitingForCode && data.flek_number ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl bg-surface p-4">
          <p className="text-sm text-ink">
            Pošlete z WhatsAppu na čísle <span className="tnum font-bold whitespace-nowrap">{displayPhone(pairing.phone)}</span> tuto
            zprávu na číslo FLEK <span className="tnum font-bold whitespace-nowrap">{displayPhone(data.flek_number)}</span>:
          </p>
          <p className="tnum font-mono text-2xl font-extrabold tracking-[0.12em] text-ink">FLEK {pairing.code}</p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={whatsappLink(data.flek_number, `FLEK ${pairing.code}`)}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ size: 'lg' })}
            >
              Otevřít WhatsApp
            </a>
            <Button variant="ghost" loading={disable.isPending} onClick={() => disable.mutate()}>Zrušit</Button>
          </div>
          <p className="tnum text-sm text-muted" role="timer" aria-live="off">
            Kód platí ještě {left.label}. Jakmile zprávu dostaneme, tady se to přepne samo.
          </p>
        </div>
      ) : null}

      {showForm ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            start.mutate();
          }}
        >
          {data.status === 'pending' || data.status === 'expired' ? (
            <p className="text-sm text-muted">Propojení nebylo dokončené. Vygenerujte si nový kód.</p>
          ) : null}
          <Field id="whatsapp-phone" label="Číslo s WhatsAppem" hint="České číslo stačí bez předvolby.">
            <Input
              id="whatsapp-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              aria-describedby="whatsapp-phone-hint"
            />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-accent"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              Souhlasím, aby FLEK na toto číslo posílal přes WhatsApp žádosti o rezervaci s termínem, službou a částkou
              a aby odpověď tlačítkem Potvrdit nebo Nemohu přijmout platila jako rozhodnutí provozovny. Vypnout to můžu
              kdykoli tady.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={start.isPending} disabled={!consent || phone.trim().length < 9}>
              {verified ? 'Propojit nové číslo' : 'Propojit WhatsApp'}
            </Button>
            {editing ? <Button variant="ghost" onClick={() => setEditing(false)}>Zpět</Button> : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
