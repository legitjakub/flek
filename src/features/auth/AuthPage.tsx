import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { loginSchema } from '../../lib/schemas';
import { Button, Field, Input, Wordmark } from '../../components/ui';
import { useRouter } from '../../app/router';

const signupSchema = loginSchema.extend({
  first_name: z.string().trim().min(1, 'Vyplň prosím jméno.').max(80),
  last_name: z.string().trim().max(80),
});
type SignupValues = z.infer<typeof signupSchema>;

/**
 * Booking intent survives authentication: `returnTo` carries the offer the customer
 * tapped, so they land back on the confirmation sheet instead of the home screen.
 */
export function AuthPage() {
  const { search, navigate } = useRouter();
  const returnTo = search.get('returnTo') || '/';
  const merchant = search.get('role') === 'merchant';
  const [mode, setMode] = useState<'login' | 'signup'>(search.get('mode') === 'signup' ? 'signup' : 'login');
  const [failure, setFailure] = useState<string | null>(null);
  const formal = merchant;

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', password: '', first_name: '', last_name: '' },
    mode: 'onTouched',
  });

  async function submit(values: SignupValues) {
    setFailure(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
          options: { data: { first_name: values.first_name, last_name: values.last_name } },
        });
        if (error) throw error;
      }
      navigate(returnTo, { replace: true });
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  const isSignup = mode === 'signup';

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Wordmark suffix={merchant ? 'Partner' : undefined} />
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-ink">
        {isSignup
          ? formal
            ? 'Založte si účet partnera'
            : 'Založ si účet'
          : formal
            ? 'Přihlaste se'
            : 'Přihlas se'}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {formal
          ? 'Účtem partnera spravujete provozovnu, služby a volné termíny.'
          : 'Prohlížet můžeš i bez účtu. Účet potřebuješ až k rezervaci.'}
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={form.handleSubmit(submit)} noValidate>
        {isSignup ? (
          <div className="grid grid-cols-2 gap-3">
            <Field id="first_name" label="Jméno" error={form.formState.errors.first_name?.message}>
              <Input
                id="first_name"
                autoComplete="given-name"
                aria-invalid={Boolean(form.formState.errors.first_name) || undefined}
                {...form.register('first_name')}
              />
            </Field>
            <Field id="last_name" label="Příjmení" error={form.formState.errors.last_name?.message}>
              <Input id="last_name" autoComplete="family-name" {...form.register('last_name')} />
            </Field>
          </div>
        ) : null}

        <Field id="email" label="E-mail" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-invalid={Boolean(form.formState.errors.email) || undefined}
            {...form.register('email')}
          />
        </Field>
        <Field
          id="password"
          label="Heslo"
          hint={isSignup ? 'Alespoň 8 znaků.' : undefined}
          error={form.formState.errors.password?.message}
        >
          <Input
            id="password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            aria-invalid={Boolean(form.formState.errors.password) || undefined}
            {...form.register('password')}
          />
        </Field>

        {failure ? (
          <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium text-ink">
            {failure}
          </p>
        ) : null}

        <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
          {isSignup ? 'Vytvořit účet' : 'Přihlásit se'}
        </Button>
      </form>

      <button
        type="button"
        className="mt-5 w-full text-sm font-semibold text-ink underline underline-offset-4"
        onClick={() => {
          setFailure(null);
          setMode(isSignup ? 'login' : 'signup');
        }}
      >
        {isSignup ? 'Už mám účet — přihlásit se' : 'Nemám účet — vytvořit'}
      </button>
    </main>
  );
}
