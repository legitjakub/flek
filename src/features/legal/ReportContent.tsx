import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { reportContent } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Banner, Button, Field, Sheet, Textarea } from '../../components/ui';
import { useRouter } from '../../app/router';
import { useSession } from '../auth/session';
import type { ContentReportReason } from '../../types/database';
import { useLegalInfo } from './useLegal';

const REASONS: [ContentReportReason, string][] = [
  ['misleading', 'Klamavé údaje o ceně, slevě nebo službě'],
  ['prohibited_service', 'Zakázaná služba, například erotická'],
  ['illegal', 'Nezákonná služba nebo obsah'],
  ['rights', 'Fotky nebo texty použité bez svolení'],
  ['other', 'Jiný problém'],
];

/** Notice of content that breaks the law or the content rules (Digital Services Act), from an offer or a venue. */
export function ReportContent({ businessId, offerId = null }: { businessId: string; offerId?: string | null }) {
  const { userId } = useSession();
  const { navigate, path, search } = useRouter();
  const legal = useLegalInfo();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ContentReportReason>('misleading');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => reportContent({ businessId, offerId, reason, message: message.trim() }),
    onSuccess: () => {
      setSent(true);
      setMessage('');
    },
  });
  const email = legal.data?.operator.email;
  const tooShort = message.trim().length < 10;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSent(false);
          send.reset();
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-bold text-muted hover:text-ink"
      >
        <Flag size={16} aria-hidden="true" />
        Nahlásit
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Nahlásit obsah"
        footer={userId && !sent ? (
          <Button size="lg" className="w-full" loading={send.isPending} disabled={tooShort} onClick={() => send.mutate()}>
            Odeslat nahlášení
          </Button>
        ) : undefined}
      >
        {sent ? (
          <Banner tone="success">Díky, nahlášení máme. Posoudí ho člověk, obvykle do 7 dnů.</Banner>
        ) : !userId ? (
          <div className="flex flex-col gap-4">
            <p className="text-base text-ink">
              Nahlásit v aplikaci můžeš po přihlášení.{email ? ` Bez přihlášení pošli oznámení na ${email}.` : ''}
            </p>
            <Button
              data-autofocus
              onClick={() => navigate(`/prihlaseni?returnTo=${encodeURIComponent(path + (search.size ? `?${search}` : ''))}`)}
            >
              Přihlásit se
            </Button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (!tooShort) send.mutate(); }} noValidate>
            <fieldset className="flex flex-col gap-1">
              <legend className="pb-1 text-sm font-bold text-ink">Co je špatně</legend>
              {REASONS.map(([value, label]) => (
                <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-ink">
                  <input
                    type="radio"
                    name="report-reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="size-5 accent-[var(--color-accent)]"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <Field id="report-message" label="Popis" hint="Napiš, o co jde a proč to porušuje pravidla nebo zákon. Aspoň 10 znaků.">
              <Textarea id="report-message" maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} />
            </Field>
            {send.isError ? <Banner tone="warning">{errorMessage(send.error)}</Banner> : null}
            <p className="text-sm text-muted">
              Jak nahlášení posuzujeme, popisují{' '}
              <a href="/pravidla" target="_blank" rel="noopener" className="font-bold text-ink underline underline-offset-4">Pravidla obsahu</a>.
            </p>
          </form>
        )}
      </Sheet>
    </>
  );
}
