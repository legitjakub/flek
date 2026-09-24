import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { whatsappDisable, whatsappSettings, whatsappStartPairing } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useServerNow } from '../../lib/clock';
import { displayPhone, pairingCode, whatsappLink } from '../../lib/phone';
import { Banner, Button, Field, Input, buttonClass } from '../../components/ui';
import { timeLeft } from '../bookings/confirmationView';
import { useSession } from '../auth/session';
import type { WhatsAppPairing, WhatsAppSettings } from '../../types/database';

type Notice = { tone: 'success' | 'warning'; text: string };

const COPY = {
  business: {
    title: 'WhatsApp upozornění',
    purpose: 'Nové rezervace, žádosti o potvrzení s tlačítky Potvrdit a Nemohu přijmout a zrušení vám pošleme i na WhatsApp. Odpověď tlačítkem platí stejně jako v aplikaci.',
    consent: 'Klepnutím otevřete WhatsApp s připravenou zprávou s kódem, po jejím odeslání číslo ověříme. Souhlasíte tím, aby FLEK na toto číslo posílal přes WhatsApp zprávy o rezervacích s termínem, službou a částkou a aby odpověď tlačítkem Potvrdit nebo Nemohu přijmout platila jako rozhodnutí provozovny. Vypnout to můžete kdykoli tady.',
    send: 'Odešlete ve WhatsAppu připravenou zprávu',
    off: 'WhatsApp máte vypnutý.',
    unfinished: 'Ověření nebylo dokončené. Klepněte znovu, kód bude nový.',
    disabled: 'WhatsApp upozornění jsou vypnutá.',
    verified: 'Hotovo, WhatsApp je ověřený. Další rezervace vám přijde i tam.',
  },
  customer: {
    title: 'Zprávy na WhatsApp',
    purpose: 'Potvrzený FLEK s rezervačním kódem a zprávu, když se rezervace zruší, ti pošleme i na WhatsApp.',
    consent: 'Klepnutím otevřeš WhatsApp s připravenou zprávou s kódem, po jejím odeslání číslo ověříme. Souhlasíš tím, aby ti FLEK na toto číslo posílal přes WhatsApp zprávy o tvých rezervacích včetně rezervačního kódu. Vypnout to můžeš kdykoli v Profilu.',
    send: 'Odešli ve WhatsAppu připravenou zprávu',
    off: 'WhatsApp máš vypnutý.',
    unfinished: 'Ověření nebylo dokončené. Klepni znovu, kód bude nový.',
    disabled: 'Zprávy na WhatsApp jsou vypnuté.',
    verified: 'Hotovo, WhatsApp je ověřený.',
  },
} as const;

export function whatsappSettingsKey(userId: string | null | undefined, businessId?: string) {
  return ['whatsapp-settings', userId ?? null, businessId ?? 'customer'];
}

/** One number's settings: a venue's (`businessId`) or the signed-in customer's own. Shared by every WhatsApp surface. */
export function useWhatsAppSettings(businessId?: string) {
  const { userId } = useSession();
  return useQuery({
    queryKey: whatsappSettingsKey(userId, businessId),
    queryFn: () => whatsappSettings(businessId ?? null),
    enabled: Boolean(userId),
    staleTime: 60_000,
    // While a code is out, look for the message to arrive.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3_000 : false),
  });
}

/**
 * Turning WhatsApp on in one tap. The code is made here, so the button is a plain wa.me link with
 * "FLEK 123456" typed in: the only thing that reliably opens WhatsApp on a phone is a link the person
 * taps. The same tap stores the code (its hash) and the consent; the message from that number then
 * verifies it. The code lives only in this page's memory.
 */
function usePairing(businessId: string | undefined) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const settings = useWhatsAppSettings(businessId);
  const copy = COPY[businessId ? 'business' : 'customer'];
  const [code, setCode] = useState(pairingCode);
  const [pairing, setPairing] = useState<{ started: WhatsAppPairing; at: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: whatsappSettingsKey(userId, businessId) });

  const start = useMutation({
    mutationFn: (phone: string | null) =>
      whatsappStartPairing({ businessId: businessId ?? null, phone, consentVersion: settings.data!.consent_version, code }),
    onSuccess: (result) => {
      setPairing({ started: result, at: Date.now() });
      setNotice(null);
      void refresh();
    },
    onError: (error) => {
      setCode(pairingCode());
      setNotice({ tone: 'warning', text: errorMessage(error, businessId ? 'merchant' : 'customer') });
    },
  });
  const disable = useMutation({
    mutationFn: () => whatsappDisable(businessId ?? null),
    onSuccess: () => {
      setPairing(null);
      setCode(pairingCode());
      setNotice({ tone: 'success', text: copy.disabled });
      void refresh();
    },
    onError: (error) => setNotice({ tone: 'warning', text: errorMessage(error, businessId ? 'merchant' : 'customer') }),
  });

  // Only an answer fetched after this code was stored says anything about it: the one before still
  // shows the old state, "verified" while a number is being changed or "expired" from a past try.
  const status = pairing && settings.dataUpdatedAt > pairing.at ? settings.data?.status : undefined;
  useEffect(() => {
    if (status !== 'verified' && status !== 'expired') return;
    setPairing(null);
    setCode(pairingCode());
    setNotice(status === 'verified' ? { tone: 'success', text: copy.verified } : { tone: 'warning', text: copy.unfinished });
  }, [status, copy]);

  return { settings, code, pairing: pairing?.started ?? null, notice, setNotice, start, disable, copy, formal: Boolean(businessId) };
}

type Pairing = ReturnType<typeof usePairing>;

/**
 * WhatsApp in Provozovna (with `businessId`) and in Profil. A customer sees nothing until FLEK has a WhatsApp number.
 * `embedded` drops the card: in Profil it sits inside the opened Upozornění row.
 */
export function WhatsAppSettingsSection({ businessId, embedded = false }: { businessId?: string; embedded?: boolean }) {
  const flow = usePairing(businessId);
  const [changing, setChanging] = useState(false);
  const data = flow.settings.data;
  useEffect(() => {
    if (data?.status === 'verified' && !flow.pairing) setChanging(false);
  }, [data?.status, flow.pairing]);
  if (!data || (!data.available && !flow.formal)) return null;

  const shape = flow.formal ? 'rounded' : 'pill';
  const verified = data.status === 'verified';
  return (
    <section
      className={embedded ? 'mt-5 border-t border-line pt-4' : 'rounded-2xl bg-card p-5 shadow-card sm:p-6'}
      aria-labelledby="whatsapp"
    >
      {embedded ? (
        <h3 id="whatsapp" className="flex items-center gap-2 text-base font-extrabold text-ink">
          <MessageCircle size={18} aria-hidden="true" />
          {flow.copy.title}
        </h3>
      ) : (
        <h2 id="whatsapp" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
          <MessageCircle size={20} aria-hidden="true" />
          {flow.copy.title}
        </h2>
      )}
      <p className="mt-1 text-sm text-muted">
        {data.available
          ? flow.copy.purpose
          : 'WhatsApp upozornění zatím nejsou aktivní. Nové žádosti o rezervaci uvidíte tady v aplikaci, a pokud máte zapnutý e-mail nebo oznámení na telefonu, přijdou vám i tam.'}
      </p>
      {flow.notice ? <div className="mt-3"><Banner tone={flow.notice.tone}>{flow.notice.text}</Banner></div> : null}

      {data.available && verified && !changing ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-base text-ink">
            Zprávy chodí na <span className="tnum font-bold whitespace-nowrap">{displayPhone(data.phone)}</span>.
          </p>
          {flow.formal && !data.mine ? (
            <p className="text-sm text-muted">Číslo ověřil jiný člen provozovny, zprávy se řídí jeho nastavením upozornění.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" shape={shape} onClick={() => { setChanging(true); flow.setNotice(null); }}>Změnit číslo</Button>
            <Button variant="danger" shape={shape} loading={flow.disable.isPending} onClick={() => flow.disable.mutate()}>Vypnout</Button>
          </div>
        </div>
      ) : null}

      {data.available && (!verified || changing) ? (
        <Verify flow={flow} data={data} editing={changing} onBack={changing ? () => setChanging(false) : undefined} />
      ) : null}
    </section>
  );
}

/**
 * A customer's nudge where WhatsApp helps most: while a request waits for the venue, and right after
 * booking. Only while FLEK has a number and the customer has neither verified nor switched it off.
 */
export function WhatsAppPrompt({ context }: { context: 'waiting' | 'booked' }) {
  const flow = usePairing(undefined);
  const data = flow.settings.data;
  if (!data?.available || data.status === 'disabled') return null;
  if (data.status === 'verified' && !flow.notice) {
    return context === 'waiting' ? <p className="text-sm text-muted">Jak podnik odpoví, dáme ti vědět i na WhatsApp.</p> : null;
  }
  return (
    <section aria-labelledby="whatsapp-prompt" className="w-full rounded-2xl bg-card p-4 text-left shadow-card sm:p-5">
      <h2 id="whatsapp-prompt" className="flex items-center gap-2 text-base font-extrabold text-ink">
        <MessageCircle size={18} aria-hidden="true" />
        {context === 'waiting' ? 'Nemusíš tu čekat' : 'Potvrzení i na WhatsApp'}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {context === 'waiting'
          ? 'Jak podnik odpoví, pošleme ti výsledek, a když to vyjde, i rezervační kód na WhatsApp.'
          : 'Příště ti potvrzený FLEK s kódem a změny rezervace pošleme i na WhatsApp.'}
      </p>
      {flow.notice ? <div className="mt-3"><Banner tone={flow.notice.tone}>{flow.notice.text}</Banner></div> : null}
      {data.status !== 'verified' ? <Verify flow={flow} data={data} /> : null}
    </section>
  );
}

function Verify({ flow, data, editing = false, onBack }: { flow: Pairing; data: WhatsAppSettings; editing?: boolean; onBack?: () => void }) {
  const now = useServerNow(1_000);
  // null: the number on file, shown as text with "Změnit"; a string: what the person types instead.
  const [phone, setPhone] = useState<string | null>(() => (editing ? '' : data.phone ? null : ''));
  const shape = flow.formal ? 'rounded' : 'pill';
  const id = `whatsapp-phone-${data.kind}`;
  const left = flow.pairing ? timeLeft(flow.pairing.expires_at, now) : null;

  if (flow.pairing && left && left.seconds > 0) {
    return (
      <div className="mt-4 flex flex-col gap-3 rounded-xl bg-surface p-4">
        <p className="text-sm text-ink">
          {flow.copy.send} <span className="tnum font-bold whitespace-nowrap">FLEK {flow.pairing.code}</span> z čísla{' '}
          <span className="tnum font-bold whitespace-nowrap">{displayPhone(flow.pairing.phone)}</span>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={whatsappLink(flow.pairing.flek_number, `FLEK ${flow.pairing.code}`)}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: 'secondary', shape })}
          >
            Otevřít WhatsApp znovu
          </a>
          <Button variant="ghost" shape={shape} loading={flow.disable.isPending} onClick={() => flow.disable.mutate()}>Zrušit</Button>
        </div>
        <p className="tnum text-sm text-muted" role="timer" aria-live="off">
          Kód platí ještě {left.label}. Jakmile zprávu dostaneme, přepne se to tady samo.
        </p>
      </div>
    );
  }

  const number = phone ?? data.phone ?? '';
  const ready = Boolean(data.flek_number) && number.replace(/\D/g, '').length >= 9;
  const label = (
    <>
      <MessageCircle size={18} aria-hidden="true" />
      Ověřit ve WhatsAppu
    </>
  );
  return (
    <div className="mt-4 flex flex-col gap-3">
      {data.status === 'disabled' && !editing && !flow.notice ? <p className="text-sm text-muted">{flow.copy.off}</p> : null}
      {(data.status === 'pending' || data.status === 'expired') && !flow.notice ? <p className="text-sm text-muted">{flow.copy.unfinished}</p> : null}
      {phone === null ? (
        <p className="flex flex-wrap items-center gap-x-3 text-base text-ink">
          <span>
            Číslo <span className="tnum font-bold whitespace-nowrap">{displayPhone(data.phone)}</span>
          </span>
          <button
            type="button"
            className="min-h-11 text-sm font-bold text-accent underline-offset-4 hover:underline"
            onClick={() => setPhone(data.phone ?? '')}
          >
            Změnit
          </button>
        </p>
      ) : (
        <Field id={id} label="Číslo s WhatsAppem" hint="České číslo stačí bez předvolby.">
          <Input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            aria-describedby={`${id}-hint`}
          />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {ready ? (
          <a
            href={whatsappLink(data.flek_number!, `FLEK ${flow.code}`)}
            target="_blank"
            rel="noreferrer"
            aria-busy={flow.start.isPending || undefined}
            onClick={(event) => {
              // One code per tap; a second tap while it is being stored would only open WhatsApp again.
              if (flow.start.isPending) event.preventDefault();
              else flow.start.mutate(phone === null ? null : phone);
            }}
            className={buttonClass({ size: 'lg', shape })}
          >
            {label}
          </a>
        ) : (
          <Button size="lg" shape={shape} disabled>{label}</Button>
        )}
        {onBack ? <Button variant="ghost" shape={shape} onClick={onBack}>Zpět</Button> : null}
      </div>
      <p className="text-xs leading-relaxed text-muted">{flow.copy.consent}</p>
    </div>
  );
}
