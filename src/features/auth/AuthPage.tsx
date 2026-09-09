import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { loginSchema } from '../../lib/schemas';
import { Button, Field, Input, Wordmark } from '../../components/ui';
import { Link, useRouter } from '../../app/router';

const PENDING_SIGNUP_KEY = 'flek.pending-signup';

function rememberSignup(email: string, returnTo: string, merchant: boolean) {
  try {
    localStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify({ email, returnTo, merchant }));
  } catch {
    // The callback still works without this convenience state (for example in private mode).
  }
}

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
  const target = search.get('returnTo') || '/';
  const returnTo = target.startsWith('/') && !target.startsWith('//') ? target : '/';
  const merchant = search.get('role') === 'merchant';
  const [mode, setMode] = useState<'login' | 'signup'>(search.get('mode') === 'signup' ? 'signup' : 'login');
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const formal = merchant;

  const form = useForm<SignupValues>({
    resolver: zodResolver(mode === 'signup' ? signupSchema : loginSchema.extend({ first_name: z.string(), last_name: z.string() })),
    defaultValues: { email: '', password: '', first_name: '', last_name: '' },
    mode: 'onTouched',
  });

  async function submit(values: SignupValues) {
    setFailure(null);
    setConfirmSent(false);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
        if (error) throw error;
      } else {
        const confirmationUrl = `${window.location.origin}/potvrzeni`;
        rememberSignup(values.email, returnTo, merchant);
        const { data, error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
          options: {
            data: {
              first_name: values.first_name,
              last_name: values.last_name,
              signup_return_to: returnTo,
              signup_role: merchant ? 'merchant' : 'customer',
            },
            emailRedirectTo: confirmationUrl,
          },
        });
        if (error) throw error;
        // With e-mail confirmation switched on, sign-up returns no session. Navigating here
        // would drop the customer back into the app still signed out, which reads as
        // "registration is broken" — so say what actually has to happen next.
        if (!data.session) {
          setConfirmationEmail(values.email);
          setConfirmSent(true);
          return;
        }
      }
      navigate(returnTo, { replace: true });
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  const isSignup = mode === 'signup';

  async function resendConfirmation() {
    const email = confirmationEmail || form.getValues('email');
    if (!email) return;
    setResending(true);
    setResendMessage(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/potvrzeni` },
      });
      if (error) throw error;
      setResendMessage('Nový potvrzovací e-mail je odeslaný. Starší odkaz už nemusí fungovat.');
    } catch (error) {
      const message = errorMessage(error);
      setResendMessage(
        /rate|limit|security|seconds?/i.test(message)
          ? 'Další e-mail teď nejde odeslat. Chvíli počkej a zkus to znovu.'
          : message,
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8 sm:py-14">
      <Link to="/" aria-label="FLEK — domů" className="inline-flex min-h-11 items-center"><Wordmark suffix={merchant ? 'Partner' : undefined} /></Link>
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

      {confirmSent ? (
        <div className="mt-6 rounded-2xl bg-card shadow-card p-5 sm:p-6">
          <h2 className="text-lg font-extrabold">Potvrď svůj e-mail</h2>
          <p className="mt-2 text-base leading-relaxed text-muted">
            Poslali jsme odkaz na <strong className="text-ink">{confirmationEmail || form.getValues('email')}</strong>. Otevři ho a účet se
            aktivuje. Mrkni i do složky s nevyžádanou poštou.
          </p>
          {resendMessage ? <p role="status" className="mt-3 text-sm text-muted">{resendMessage}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" loading={resending} onClick={() => void resendConfirmation()}>
              Poslat e-mail znovu
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmSent(false);
                setMode('login');
              }}
            >
              Přihlásit se
            </Button>
          </div>
        </div>
      ) : null}

      <form hidden={confirmSent} className="mt-6 flex flex-col gap-4 rounded-2xl bg-card shadow-card p-5 sm:p-6" onSubmit={form.handleSubmit(submit)} noValidate>
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
        className="mt-5 min-h-11 w-full text-sm font-bold text-ink underline underline-offset-4"
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
