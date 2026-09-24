import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Copy } from 'lucide-react';
import {
  adminSetWhatsAppDisplayNumber,
  adminSetWhatsAppEnabled,
  adminWhatsAppState,
  metaFailed,
  WhatsAppNotConfigured,
  whatsappTemplatesSetup,
  type WhatsAppSetupAction,
  type WhatsAppTemplateRow,
  type WhatsAppTemplateSetup,
} from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Banner, Button, cx } from '../../components/ui';

/**
 * WhatsApp od začátku do konce na jednom místě. Stav se čte přímo od Mety přes
 * `whatsapp-templates-setup` (token zůstává v Supabase secrets, do prohlížeče se nedostane):
 * tajné klíče, číslo, odběr zpráv účtu, kam Meta posílá webhook, profil a šablony. Každý krok
 * má tlačítko, včetně webhooku a loga v profilu; ruční návod do konzole Mety zůstal jen jako
 * záloha. Klikat šablony ve WhatsApp Manageru se 18. i 19. 9. nepodařilo, proto je zakládá funkce.
 */
const OPTIONAL_SECRETS = ['WHATSAPP_TEMPLATE_LANGUAGE'];

export function WhatsAppSetup() {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ['admin-whatsapp-state'], queryFn: adminWhatsAppState });
  const [done, setDone] = useState<WhatsAppTemplateSetup | null>(null);
  const run = useMutation({
    mutationFn: ({ dryRun, ...actions }: { dryRun: boolean } & Partial<Record<WhatsAppSetupAction, boolean>>) =>
      whatsappTemplatesSetup(dryRun, actions),
    onSuccess: setDone,
  });
  const saveNumber = useMutation({
    mutationFn: adminSetWhatsAppDisplayNumber,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-whatsapp-state'] }),
  });
  const activate = useMutation({
    mutationFn: () => adminSetWhatsAppEnabled(true),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-whatsapp-state'] }),
  });
  const missing = run.error instanceof WhatsAppNotConfigured ? run.error.missing : null;
  const check = () => run.mutate({ dryRun: true });

  const phone = done?.phone && !metaFailed(done.phone) ? done.phone : null;
  const metaNumber = phone?.display_phone_number ? `+${phone.display_phone_number.replace(/\D/g, '')}` : null;
  const storedNumber = state.data?.display_number ?? null;
  const numberSaved = Boolean(metaNumber && storedNumber === metaNumber);
  const hooks = phone?.webhook ?? null;
  const webhookOk = Boolean(done?.callback_url && [hooks?.application, hooks?.whatsapp_business_account, hooks?.phone_number].includes(done.callback_url));
  const apps = done?.subscription && !metaFailed(done.subscription) ? done.subscription.apps : null;
  const subscribed = Boolean(apps?.length);
  const profile = done?.profile && !metaFailed(done.profile) ? done.profile : null;
  const textsOk = Boolean(profile && done?.brand_profile && profile.about === done.brand_profile.about);
  const pictureOk = Boolean(profile?.has_picture);
  const profileOk = textsOk && pictureOk;
  // Jazyk šablon má výchozí `cs`, bez něj kanál funguje; ostatní klíče jsou potřeba.
  const missingSecrets = done?.secrets ? Object.entries(done.secrets).filter(([name, set]) => !set && !OPTIONAL_SECRETS.includes(name)).map(([name]) => name) : [];
  const allApproved = Boolean(done?.templates.length) && done!.templates.every((row) => row.status === 'APPROVED');
  const toCreate = done?.templates.some((row) => row.action === 'would_create') ?? false;
  const ready = numberSaved && webhookOk && subscribed && allApproved && missingSecrets.length === 0;

  return (
    <section className="mt-8 flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-card" aria-labelledby="whatsapp-nastaveni">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="whatsapp-nastaveni" className="text-lg font-extrabold tracking-tight text-ink">WhatsApp</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Žádosti o potvrzení pro podniky a potvrzené FLEKy s kódem pro zákazníky. Stav se čte přímo od Mety, token
            zůstává v Supabase. {state.data?.enabled ? 'V aplikaci je kanál zapnutý.' : 'V aplikaci je kanál zatím skrytý.'}
          </p>
        </div>
        <Button variant="secondary" loading={run.isPending} onClick={check}>
          Zkontrolovat stav
        </Button>
      </div>

      {missing ? (
        <Banner tone="warning">
          V Supabase → Edge Functions → Secrets chybí: {missing.join(', ')}. Bez nich se u Mety nedá nic ověřit ani založit.
        </Banner>
      ) : run.isError ? (
        <Banner tone="warning">{errorMessage(run.error, 'merchant')}</Banner>
      ) : null}

      {done && !run.isPending ? (
        <ol className="flex flex-col divide-y divide-line">
          <Row ok={missingSecrets.length === 0} title="Tajné klíče v Supabase">
            {missingSecrets.length === 0 ? 'Všechny vyplněné.' : `Chybí: ${missingSecrets.join(', ')}. Šablona bez klíče se jen přeskočí.`}
          </Row>

          <Row ok={numberSaved} title="Číslo FLEKu">
            {metaFailed(done.phone) ? (
              <>Meta číslo nevrátila: {done.phone.error}</>
            ) : phone ? (
              <>
                U Mety <span className="tnum font-bold text-ink">{phone.display_phone_number}</span>
                {phone.verified_name ? <> ({phone.verified_name}{phone.name_status ? `, jméno ${nameStatus(phone.name_status)}` : ''})</> : null}.{' '}
                {storedNumber ? <>Ve FLEKu <span className="tnum font-bold text-ink">{storedNumber}</span>.</> : 'Ve FLEKu zatím žádné.'}
                {!numberSaved && metaNumber ? (
                  <div className="mt-2">
                    <Button size="sm" loading={saveNumber.isPending} onClick={() => saveNumber.mutate(metaNumber)}>
                      Uložit {metaNumber} do FLEKu
                    </Button>
                    {saveNumber.isError ? <p className="mt-1 text-danger">{errorMessage(saveNumber.error, 'merchant')}</p> : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </Row>

          <Row ok={subscribed} title="Odběr zpráv účtu">
            {metaFailed(done.subscription) ? (
              <>Stav odběru se nepodařilo zjistit: {done.subscription.error}</>
            ) : subscribed ? (
              `Přihlášeno: ${apps!.map((app) => app.name ?? app.id).join(', ')}.`
            ) : (
              <>
                Aplikace není přihlášená k odběru zpráv z účtu WhatsApp, zprávy by nechodily.
                <div className="mt-2">
                  <Button size="sm" loading={run.isPending} onClick={() => run.mutate({ dryRun: true, subscribe: true })}>
                    Přihlásit odběr
                  </Button>
                </div>
              </>
            )}
            <ActionError value={done.actions?.subscribe} />
          </Row>

          <Row ok={webhookOk} title="Webhook (odpovědi a tlačítka z WhatsAppu)">
            {webhookOk ? (
              'Meta posílá zprávy do FLEKu.'
            ) : (
              <>
                {hooks?.application ? <>Meta teď posílá na <code className="break-all">{hooks.application}</code>. </> : 'Meta zatím nikam neposílá. '}
                {subscribed ? <>Tlačítko nastaví adresu FLEKu a Meta ji hned ověří tokenem z <code>WHATSAPP_VERIFY_TOKEN</code>.</> : 'Nastavit půjde po přihlášení odběru výš.'}
                {subscribed ? (
                  <div className="mt-2">
                    <Button size="sm" loading={run.isPending} onClick={() => run.mutate({ dryRun: true, webhook: true })}>
                      Nastavit webhook FLEKu
                    </Button>
                  </div>
                ) : null}
                <details className="mt-1">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center font-bold text-accent [&::-webkit-details-marker]:hidden">
                    Ručně v konzoli Mety
                  </summary>
                  WhatsApp → Konfigurace → Webhook → Upravit. Callback URL:
                  <CopyValue value={done.callback_url ?? ''} />
                  Ověřovací token: stejná hodnota, jakou má <code>WHATSAPP_VERIFY_TOKEN</code> v Supabase. Po „Ověřit a uložit“
                  u Webhook fields přihlaste pole <code>messages</code>.
                </details>
              </>
            )}
            <ActionError value={done.actions?.webhook} />
          </Row>

          <Row ok={profileOk} optional title="Profil FLEKu na WhatsAppu">
            {metaFailed(done.profile) ? (
              <>Profil se nepodařilo načíst: {done.profile.error}</>
            ) : profileOk ? (
              'Texty i logo odpovídají FLEKu.'
            ) : (
              <>
                {textsOk ? 'Texty profilu odpovídají FLEKu. ' : 'Popis, web a e-mail podpory ve stejných slovech jako aplikace. '}
                {pictureOk ? 'Fotka je nahraná.' : 'Jako fotka se nahraje logo FLEKu.'}
                <div className="mt-2">
                  <Button size="sm" variant="secondary" loading={run.isPending} onClick={() => run.mutate({ dryRun: true, profile: !textsOk, picture: !pictureOk })}>
                    Nastavit profil FLEKu
                  </Button>
                </div>
              </>
            )}
            <ActionError value={done.actions?.profile} />
            <ActionError value={done.actions?.picture} />
          </Row>

          <Row ok={allApproved} title="Šablony zpráv">
            <ul className="mt-1 flex flex-col gap-1">
              {done.templates.map((row) => (
                <li key={row.template} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <code className="font-bold text-ink">{row.name}</code>
                  <span>{rowLabel(row)}</span>
                </li>
              ))}
            </ul>
            {toCreate ? (
              <div className="mt-2">
                <Button size="sm" loading={run.isPending} onClick={() => run.mutate({ dryRun: false })}>
                  Založit chybějící
                </Button>
              </div>
            ) : allApproved ? null : (
              <p className="mt-1">Meta je schvaluje sama, obvykle v řádu minut. Stav ověříte znovu tlačítkem Zkontrolovat stav.</p>
            )}
          </Row>
        </ol>
      ) : null}

      {done && !run.isPending ? (
        state.data?.enabled ? (
          <p role="status" className="text-sm font-bold text-positive">WhatsApp je v aplikaci dostupný.</p>
        ) : (
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-sm text-muted">
              {ready
                ? 'Vše je připravené. Po zpřístupnění uvidí podniky i zákazníci „Ověřit ve WhatsAppu“. Nejdřív si ho ověřte na svém čísle a pošlete si testovací žádost.'
                : 'Zpřístupnit půjde, až budou všechny řádky výš v pořádku.'}
            </p>
            <Button className="mt-3" disabled={!ready} loading={activate.isPending} onClick={() => activate.mutate()}>
              Zpřístupnit WhatsApp
            </Button>
            {activate.isError ? <div className="mt-2"><Banner tone="warning">{errorMessage(activate.error, 'merchant')}</Banner></div> : null}
          </div>
        )
      ) : null}
    </section>
  );
}

function Row({ ok, optional = false, title, children }: { ok: boolean; optional?: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {ok ? (
        <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-positive" />
      ) : (
        <AlertCircle size={20} aria-hidden="true" className={cx('mt-0.5 shrink-0', optional ? 'text-muted' : 'text-warning')} />
      )}
      <div className="min-w-0 flex-1 text-sm text-muted">
        <p className="font-bold text-ink">
          {title}
          {optional ? <span className="font-normal text-muted"> · doporučeno</span> : null}
          <span className="sr-only">{ok ? ' — v pořádku' : ' — chybí'}</span>
        </p>
        <div className="mt-0.5">{children}</div>
      </div>
    </li>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="my-1.5 flex flex-wrap items-center gap-2">
      <code className="rounded-lg bg-surface px-2 py-1 break-all text-ink">{value}</code>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true));
        }}
      >
        <Copy size={15} aria-hidden="true" />
        {copied ? 'Zkopírováno' : 'Kopírovat'}
      </Button>
    </span>
  );
}

/** Chyby, které funkce pojmenuje sama; ostatní jsou text od Mety. */
const ACTION_ERRORS: Record<string, string> = {
  APP_ID: 'Nejdřív přihlaste odběr zpráv účtu výš, podle něj se pozná aplikace FLEK.',
  WHATSAPP_APP_SECRET: 'V Supabase chybí WHATSAPP_APP_SECRET.',
  WHATSAPP_VERIFY_TOKEN: 'WHATSAPP_VERIFY_TOKEN v Supabase chybí nebo má méně než 16 znaků.',
};

function ActionError({ value }: { value: unknown }) {
  if (!metaFailed(value)) return null;
  return <p className="mt-1 text-danger">{ACTION_ERRORS[value.error] ?? value.error}</p>;
}

function nameStatus(status: string): string {
  switch (status) {
    case 'APPROVED':
    case 'AVAILABLE_WITHOUT_REVIEW':
      return 'schválené';
    case 'PENDING_REVIEW':
      return 'čeká na schválení';
    case 'DECLINED':
      return 'zamítnuté';
    default:
      return status.toLowerCase();
  }
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
