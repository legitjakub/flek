import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { BadgeCheck, Check, Download, FileDown, LifeBuoy, LogOut, Share, ShieldCheck, Sparkles, Store, Trash2, UserRound } from 'lucide-react';
import { deleteMyAccount, exportMyData, saveProfile } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { profileSchema } from '../../lib/schemas';
import { Banner, Button, Field, Input, PromoCard, SettingsList, SettingsRow, Sheet, buttonClass } from '../../components/ui';
import { Link } from '../../app/router';
import { useSession } from './session';
import { useSignOut } from './SignOutButton';
import { CustomerFlekStats } from '../profile/CustomerFlekStats';
import { ReferralInvite } from '../profile/ReferralInvite';
import { useInstallMode } from '../pwa/InstallPrompt';
import { promptInstall } from '../pwa/install';
import { openIntro } from '../onboarding/FirstVisitIntro';
import { useMyBusinesses } from '../merchant/useBusiness';
import { NotificationSettings } from '../notifications/Notifications';
import { WhatsAppSettingsSection } from '../notifications/WhatsApp';
import { LegalFooter } from '../legal/LegalFooter';
import { useLegalInfo } from '../legal/useLegal';

type ProfileValues = z.infer<typeof profileSchema>;

/** Only shown when a real inbox exists behind it; an invented address is worse than none. */
const BUILD_SUPPORT_EMAIL: string | undefined = import.meta.env.VITE_SUPPORT_EMAIL || undefined;

const BENEFITS = [
  'Konečnou cenu i slevu vidíš dřív, než rezervuješ.',
  'Volný FLEK máš za minutu, bez volání.',
  'Platíš předem, v podniku ukážeš kód.',
];

/**
 * Profile is read top to bottom as value, then settings: what FLEK saved, a block to share it,
 * then grouped rows. Colour separates the blocks — a dark card, a promo one, white lists on the
 * cream ground — so nothing needs a heading rule or a hairline to stand apart.
 */
export function ProfilePage() {
  const { userId, profile, session, admin } = useSession();
  const businesses = useMyBusinesses();

  if (!userId) return <SignedOutProfile />;

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  const initial = (profile?.first_name || session?.user.email || '?').trim().charAt(0).toLocaleUpperCase('cs-CZ');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-8">
      <header className="flex items-center gap-4">
        <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full bg-brand text-2xl font-extrabold text-brand-ink">
          {initial}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl leading-tight font-extrabold tracking-tight text-ink">{name || 'Profil'}</h1>
          <p className="truncate text-sm text-muted">{session?.user.email}</p>
        </div>
      </header>

      <CustomerFlekStats userId={userId} />

      {profile && profile.no_show_count > 0 ? (
        <Banner tone="warning">
          Nedorazil/a jsi {profile.no_show_count}×. Po dvou nedostavených rezervacích za 60 dní se rezervace dočasně
          zablokují.
        </Banner>
      ) : null}

      <ReferralInvite userId={userId} />

      <SettingsList title="Můj účet">
        <DetailsRow />
      </SettingsList>

      <NotificationSettings />
      <WhatsAppSettingsSection />

      <AppList partner={(businesses.data?.length ?? 0) > 0} admin={admin} signedIn />

      <SettingsList title="Tvoje data">
        <ExportRow />
        <DeleteAccountRow />
      </SettingsList>

      <SettingsList>
        <SignOutRow />
      </SettingsList>

      <p className="tnum -mt-3 px-1 text-xs text-muted">
        Verze aplikace <span className="font-bold text-ink">{import.meta.env.VITE_BUILD_ID ?? 'dev'}</span>
      </p>

      <LegalFooter />
    </main>
  );
}

function SignedOutProfile() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-8">
      <header>
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-ink">Vítej ve FLEKu</h1>
        <p className="mt-1 text-base text-muted">Prohlížet můžeš bez účtu. Potřebuješ ho až k rezervaci.</p>
      </header>

      <section className="rounded-3xl bg-card p-5 shadow-card sm:p-6">
        <h2 className="text-lg font-extrabold tracking-tight">S účtem ve FLEKu</h2>
        <ul className="mt-4 flex flex-col gap-3">
          {BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-3 text-base text-ink">
              <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand text-brand-ink">
                <Check size={14} strokeWidth={3} />
              </span>
              {benefit}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link to="/prihlaseni?returnTo=%2Fprofil" className={buttonClass({ size: 'lg', shape: 'pill' }) + ' sm:flex-1'}>
            Přihlásit se
          </Link>
          <Link
            to="/prihlaseni?mode=signup&returnTo=%2Fprofil"
            className={buttonClass({ variant: 'soft', size: 'lg', shape: 'pill' }) + ' sm:flex-1'}
          >
            Vytvořit účet
          </Link>
        </div>
      </section>

      <AppList partner={false} admin={false} signedIn={false} />

      <PromoCard tone="promo">
        <Store size={26} aria-hidden="true" />
        <h2 className="mt-3 text-lg font-extrabold tracking-tight">Máte podnik?</h2>
        <p className="mt-1 max-w-sm text-base text-ink">
          Nabídněte volné termíny a naplňte je i na poslední chvíli. Registrace je zdarma.
        </p>
        <Link to="/partner" className={buttonClass({ shape: 'pill' }) + ' mt-4'}>
          FLEK Partner
        </Link>
      </PromoCard>

      <LegalFooter />
    </main>
  );
}

function AppList({ partner, admin, signedIn }: { partner: boolean; admin: boolean; signedIn: boolean }) {
  const install = useInstallMode();
  const [iosHelp, setIosHelp] = useState(false);
  const legal = useLegalInfo();
  const supportEmail = legal.data?.operator.email ?? BUILD_SUPPORT_EMAIL;

  return (
    <>
      <SettingsList title="Aplikace">
        <SettingsRow icon={<Sparkles size={20} />} label="Jak FLEK funguje?" hint="Krátké představení ve třech krocích" onClick={openIntro} />
        {install ? (
          <SettingsRow
            icon={<Download size={20} />}
            label="Nainstalovat aplikaci"
            hint="Otevřeš ji jedním klepnutím z plochy"
            onClick={() => (install === 'prompt' ? void promptInstall() : setIosHelp(true))}
          />
        ) : null}
        {signedIn ? (
          <SettingsRow
            icon={<Store size={20} />}
            label={partner ? 'FLEK Partner' : 'Pro podniky'}
            hint={partner ? 'Správa provozovny a termínů' : 'Nabídněte volné termíny'}
            to="/partner"
          />
        ) : null}
        {admin ? <SettingsRow icon={<ShieldCheck size={20} />} label="Administrace" to="/admin" /> : null}
        {supportEmail ? (
          <SettingsRow icon={<LifeBuoy size={20} />} label="Podpora" hint={supportEmail} href={`mailto:${supportEmail}`} />
        ) : null}
      </SettingsList>

      <Sheet open={iosHelp} onClose={() => setIosHelp(false)} title="Přidat FLEK na plochu">
        <ol className="flex flex-col gap-3 text-base text-ink">
          <li className="flex items-center gap-2">
            <span className="tnum grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent">1</span>
            <span>
              V Safari klepni dole na <Share size={18} aria-hidden="true" className="inline align-[-3px]" />{' '}
              <span className="font-bold">Sdílet</span>.
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span className="tnum grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent">2</span>
            <span>
              Vyber <span className="font-bold">Přidat na plochu</span>.
            </span>
          </li>
        </ol>
      </Sheet>
    </>
  );
}

function DetailsRow() {
  const { profile } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { first_name: '', last_name: '', phone: '' },
    mode: 'onTouched',
  });

  useEffect(() => {
    if (profile) form.reset({ first_name: profile.first_name, last_name: profile.last_name, phone: profile.phone ?? '' });
  }, [profile, form]);

  const save = useMutation({
    mutationFn: (values: ProfileValues) => saveProfile(values),
    onSuccess: async () => {
      setSaved(true);
      setFailure(null);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error) => {
      setSaved(false);
      setFailure(errorMessage(error));
    },
  });

  const complete = Boolean(profile?.first_name && profile?.last_name && profile?.phone);
  const summary = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');

  return (
    <>
      <SettingsRow
        icon={complete ? <BadgeCheck size={20} /> : <UserRound size={20} />}
        label="Moje údaje"
        hint={complete ? `${summary} · ${profile?.phone}` : 'Doplň jméno a telefon pro podnik'}
        expanded={open}
        controls="profil-udaje"
        onClick={() => {
          setOpen((current) => !current);
          setSaved(false);
        }}
      />
      {open ? (
        <li id="profil-udaje">
          <form
            className="flex flex-col gap-4 px-4 pt-2 pb-5"
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
            noValidate
          >
            <div className="grid grid-cols-2 gap-3">
              <Field id="p-first" label="Jméno" error={form.formState.errors.first_name?.message}>
                <Input id="p-first" autoComplete="given-name" {...form.register('first_name')} />
              </Field>
              <Field id="p-last" label="Příjmení" error={form.formState.errors.last_name?.message}>
                <Input id="p-last" autoComplete="family-name" {...form.register('last_name')} />
              </Field>
            </div>
            <Field
              id="p-phone"
              label="Telefon"
              hint="Podnik ho uvidí až u potvrzené rezervace."
              error={form.formState.errors.phone?.message}
            >
              <Input id="p-phone" type="tel" inputMode="tel" autoComplete="tel" {...form.register('phone')} />
            </Field>
            {saved ? <Banner tone="success">Údaje jsou uložené.</Banner> : null}
            {failure ? <Banner tone="warning">{failure}</Banner> : null}
            <Button type="submit" shape="pill" loading={save.isPending} className="self-start">
              Uložit údaje
            </Button>
          </form>
        </li>
      ) : null}
    </>
  );
}

function SignOutRow() {
  const { busy, signOut } = useSignOut();
  return (
    <SettingsRow
      icon={<LogOut size={20} />}
      label={busy ? 'Odhlašuji…' : 'Odhlásit se'}
      tone="danger"
      chevron={false}
      disabled={busy}
      onClick={() => void signOut()}
    />
  );
}

/** A copy of everything FLEK keeps about the account, as a file the customer saves (right of access and portability). */
function ExportRow() {
  const [failure, setFailure] = useState<string | null>(null);
  const download = useMutation({
    mutationFn: exportMyData,
    onSuccess: (data) => {
      setFailure(null);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `flek-moje-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (error) => setFailure(errorMessage(error)),
  });
  return (
    <>
      <SettingsRow
        icon={<FileDown size={20} />}
        label={download.isPending ? 'Připravuji soubor…' : 'Stáhnout moje data'}
        hint="Vše o tvém účtu v jednom souboru"
        chevron={false}
        disabled={download.isPending}
        onClick={() => download.mutate()}
      />
      {failure ? (
        <li className="px-4 pb-4">
          <Banner tone="warning">{failure}</Banner>
        </li>
      ) : null}
    </>
  );
}

function DeleteAccountRow() {
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { signOut } = useSignOut();
  const legal = useLegalInfo();
  const email = legal.data?.operator.email ?? BUILD_SUPPORT_EMAIL;
  const remove = useMutation({
    mutationFn: deleteMyAccount,
    onSuccess: () => void signOut(),
    onError: (error) => {
      const message = error instanceof Error ? error.message : '';
      // Until the server can delete accounts on its own, a person does it from the account's e-mail.
      setFailure(/could not find the function|delete_my_account/i.test(message)
        ? `Smazání účtu teď vyřizujeme ručně. Napiš nám z e-mailu účtu${email ? ` na ${email}` : ''} a do měsíce ho smažeme.`
        : errorMessage(error));
    },
  });
  return (
    <>
      <SettingsRow
        icon={<Trash2 size={20} />}
        label="Smazat účet"
        tone="danger"
        onClick={() => {
          setUnderstood(false);
          setFailure(null);
          setOpen(true);
        }}
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Smazat účet"
        footer={
          <Button
            size="lg"
            variant="danger"
            className="w-full"
            disabled={!understood}
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Smazat účet
          </Button>
        }
      >
        <div className="flex flex-col gap-3 text-base text-ink">
          <p>Smažeme tvoje jméno, e-mail, telefon, oblíbené podniky, upozornění, nastavení a propojení s WhatsAppem.</p>
          <p>Záznamy o rezervacích a platbách musíme podle daňových předpisů uchovat, ale už bez tvých údajů.</p>
          <p>Nadcházející rezervaci je potřeba nejdřív zrušit, nebo počkat, až proběhne.</p>
          <label htmlFor="delete-understood" className="flex min-h-11 items-start gap-3 text-sm font-medium">
            <input
              id="delete-understood"
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
            />
            Rozumím, že smazání nejde vrátit.
          </label>
          {failure ? <Banner tone="warning">{failure}</Banner> : null}
        </div>
      </Sheet>
    </>
  );
}
