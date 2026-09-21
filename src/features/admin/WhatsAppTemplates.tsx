import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { adminSetWhatsAppEnabled, WhatsAppNotConfigured, whatsappTemplatesSetup, type WhatsAppTemplateRow, type WhatsAppTemplateSetup } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Banner, Button } from '../../components/ui';

/**
 * Pět šablon zpráv, které FLEK posílá na WhatsApp, musí schválit Meta. Klikat je ve WhatsApp
 * Manageru se 18. i 19. 9. nepodařilo (prohlížeč zamrzal), takže je zakládá Edge Function přes
 * Graph API a tohle tlačítko je jediné místo, odkud ji jde spustit: běží pod přihlášením admina,
 * token od Mety zůstává v Supabase secrets a do prohlížeče se nikdy nedostane.
 */
export function WhatsAppTemplates() {
  const [done, setDone] = useState<WhatsAppTemplateSetup | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => whatsappTemplatesSetup(dryRun),
    onSuccess: setDone,
  });
  const activate = useMutation({ mutationFn: () => adminSetWhatsAppEnabled(true) });
  const missing = run.error instanceof WhatsAppNotConfigured ? run.error.missing : null;
  const allApproved = Boolean(done?.templates.length) && done!.templates.every((row) => row.status === 'APPROVED');

  return (
    <section className="mt-8 flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-card" aria-labelledby="whatsapp-sablony">
      <h2 id="whatsapp-sablony" className="text-lg font-extrabold tracking-tight text-ink">Šablony zpráv na WhatsAppu</h2>
      <p className="text-sm text-muted">
        Žádost o potvrzení, potvrzení a zrušení pro podnik i pro zákazníka. Meta je schvaluje sama, obvykle v řádu
        minut. Šablona, která už u Mety je, se nepřepisuje — přepsání by znamenalo nové schvalování. Než jsou
        schválené, zprávy na WhatsApp se jen přeskakují; zbytek upozornění chodí dál.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" loading={run.isPending && run.variables} onClick={() => run.mutate(true)}>
          Zkontrolovat
        </Button>
        <Button loading={run.isPending && !run.variables} onClick={() => run.mutate(false)}>
          Založit chybějící
        </Button>
      </div>

      {missing ? (
        <Banner tone="warning">
          V Supabase → Edge Functions → Secrets chybí: {missing.join(', ')}. Bez nich se u Mety nedá nic založit.
        </Banner>
      ) : run.isError ? (
        <Banner tone="warning">{errorMessage(run.error, 'merchant')}</Banner>
      ) : null}

      {done && !run.isPending ? (
        <>
          <ul className="flex flex-col gap-2" role="status">
            {done.templates.map((row) => (
              <li key={row.template} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                <code className="font-bold text-ink">{row.name}</code>
                <span className="text-muted">{rowLabel(row)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            {done.dry_run
              ? 'Zatím nic neodešlo — tohle je jen přehled.'
              : done.created > 0
                ? `Odesláno ke schválení: ${done.created}. Stav ověříte tlačítkem Zkontrolovat.`
                : 'Nic nového k založení.'}
            {' '}Jazyk šablon: {done.language}.
          </p>
          {allApproved ? (
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="text-sm text-muted">
                Zpřístupněte kanál až po ověření callbacku <code>messages</code>, propojení čísla a úspěšné testovací zprávě. Do té doby ho zákazník ani podnik neuvidí.
              </p>
              <Button className="mt-3" loading={activate.isPending} onClick={() => activate.mutate()}>
                Zpřístupnit WhatsApp
              </Button>
              {activate.isSuccess ? <p role="status" className="mt-2 text-sm font-bold text-positive">WhatsApp je v aplikaci dostupný.</p> : null}
              {activate.isError ? <div className="mt-2"><Banner tone="warning">{errorMessage(activate.error, 'merchant')}</Banner></div> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Stav od Mety česky; `detail` se ukazuje jen u neúspěchu, protože jinak nemá co říct. */
function rowLabel(row: WhatsAppTemplateRow): string {
  if (row.action === 'would_create') return 'chybí, založí se';
  if (row.action === 'created') return 'odesláno ke schválení';
  if (row.action === 'failed') return `nepodařilo se${row.detail ? `: ${row.detail}` : ''}`;
  switch (row.status) {
    case 'APPROVED':
      return 'schválená';
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return 'čeká na schválení';
    case 'REJECTED':
      return 'Meta ji zamítla — text je potřeba upravit';
    case 'PAUSED':
    case 'DISABLED':
      return 'Meta ji pozastavila';
    default:
      return row.status ? `u Mety je (${row.status})` : 'u Mety je';
  }
}
