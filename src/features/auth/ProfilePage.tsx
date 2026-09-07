import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { saveProfile } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { profileSchema } from '../../lib/schemas';
import { Banner, Button, EmptyState, Field, Input } from '../../components/ui';
import { Link, useRouter } from '../../app/router';
import { useSession } from './session';

type ProfileValues = z.infer<typeof profileSchema>;

export function ProfilePage() {
  const { userId, profile, session, admin } = useSession();
  const { navigate } = useRouter();
  const queryClient = useQueryClient();
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

  if (!userId) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <EmptyState
          title="Přihlas se ke svému účtu"
          body="Účet potřebuješ jen k rezervaci. Prohlížet můžeš bez něj."
          action={
            <Link
              to="/prihlaseni?returnTo=%2Fprofil"
              className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-semibold text-accent-ink"
            >
              Přihlásit se
            </Link>
          }
        />
        <div className="mt-6 rounded-2xl border border-line bg-card p-4">
          <h2 className="text-base font-bold text-ink">Máte podnik?</h2>
          <p className="mt-1 text-sm text-muted">Nabídněte volné termíny a naplňte je i na poslední chvíli.</p>
          <Link
            to="/prihlaseni?role=merchant&mode=signup&returnTo=%2Fpartner"
            className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold text-ink"
          >
            FLEK Partner
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-4 pb-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">Profil</h1>
      <p className="mt-1 text-sm text-muted">{session?.user.email}</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
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
        <Button type="submit" loading={save.isPending} className="self-start">
          Uložit
        </Button>
      </form>

      {profile && profile.no_show_count > 0 ? (
        <p className="mt-6 text-sm text-muted">
          Nedorazil/a jsi {profile.no_show_count}×. Po dvou nedostavených rezervacích za 60 dní se rezervace dočasně
          zablokují.
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-2">
        <Link
          to="/partner"
          className="inline-flex min-h-11 items-center rounded-xl border border-line bg-card px-4 text-sm font-semibold text-ink"
        >
          FLEK Partner — správa provozovny
        </Link>
        {admin ? (
          <Link
            to="/admin"
            className="inline-flex min-h-11 items-center rounded-xl border border-line bg-card px-4 text-sm font-semibold text-ink"
          >
            Administrace
          </Link>
        ) : null}
        <Button
          variant="secondary"
          className="self-start"
          onClick={async () => {
            await supabase.auth.signOut();
            queryClient.clear();
            navigate('/');
          }}
        >
          Odhlásit se
        </Button>
      </div>
    </main>
  );
}
