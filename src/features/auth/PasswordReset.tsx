import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { loginSchema } from '../../lib/schemas';
import { Button, Field, Input } from '../../components/ui';
import { useRouter } from '../../app/router';
import { useSession } from './session';

const emailSchema = loginSchema.pick({ email: true });
const passwordSchema = z
  .object({ password: loginSchema.shape.password, confirm: z.string() })
  .refine((values) => values.password === values.confirm, { path: ['confirm'], message: 'Hesla se neshodují.' });

export function resetRedirect(merchant: boolean) {
  return `${window.location.origin}/prihlaseni?mode=reset${merchant ? '&role=merchant' : ''}`;
}

/** Asks for a reset link. The answer is the same whether the address has an account or not. */
export function ForgotPasswordForm({ formal, initialEmail, onBack }: { formal: boolean; initialEmail: string; onBack: () => void }) {
  const [sent, setSent] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: initialEmail },
    mode: 'onTouched',
  });

  async function submit({ email }: { email: string }) {
    setFailure(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: resetRedirect(formal) });
    // Only a throttle is worth reporting: "no such user" must not be distinguishable.
    if (error && /rate|limit|seconds?|security/i.test(error.message)) {
      setFailure(formal ? 'Další e-mail teď nejde odeslat. Chvíli počkejte a zkuste to znovu.' : 'Další e-mail teď nejde odeslat. Chvíli počkej a zkus to znovu.');
      return;
    }
    if (error) {
      setFailure(formal ? 'E-mail se nepodařilo odeslat. Zkuste to prosím za chvíli znovu.' : 'E-mail se nepodařilo odeslat. Zkus to prosím za chvíli znovu.');
      return;
    }
    setSent(email);
  }

  if (sent) {
    return (
      <div className="mt-6 rounded-2xl bg-card p-5 shadow-card sm:p-6" role="status">
        <h2 className="text-lg font-extrabold">{formal ? 'Zkontrolujte e-mail' : 'Zkontroluj e-mail'}</h2>
        <p className="mt-2 text-base leading-relaxed text-muted">
          Pokud k adrese <strong className="text-ink">{sent}</strong> existuje účet, přijde na ni odkaz pro nastavení nového hesla.{' '}
          {formal ? 'Otevřete odkaz a podívejte se i do nevyžádané pošty.' : 'Otevři odkaz a mrkni i do nevyžádané pošty.'}
        </p>
        <Button variant="secondary" className="mt-4" onClick={onBack}>Zpět na přihlášení</Button>
      </div>
    );
  }

  return (
    <form className="mt-6 flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-card sm:p-6" onSubmit={form.handleSubmit(submit)} noValidate>
      <p className="text-base text-muted">
        {formal ? 'Zadejte e-mail účtu. Pošleme vám odkaz, přes který si nastavíte nové heslo.' : 'Zadej e-mail účtu. Pošleme ti odkaz, přes který si nastavíš nové heslo.'}
      </p>
      <Field id="reset-email" label="E-mail" error={form.formState.errors.email?.message}>
        <Input id="reset-email" type="email" inputMode="email" autoComplete="email" {...form.register('email')} />
      </Field>
      {failure ? <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium text-ink">{failure}</p> : null}
      <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Poslat odkaz</Button>
      <Button variant="ghost" onClick={onBack}>Zpět na přihlášení</Button>
    </form>
  );
}

type LinkState = 'checking' | 'ready' | 'invalid' | 'done';

/** The page the reset e-mail opens: turns the link into a session, then takes the new password. */
export function NewPasswordForm({ formal }: { formal: boolean }) {
  const { session, ready } = useSession();
  const { search, navigate } = useRouter();
  const attempted = useRef(false);
  const [state, setState] = useState<LinkState>('checking');
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<{ password: string; confirm: string }>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '', confirm: '' },
    mode: 'onTouched',
  });

  useEffect(() => {
    if (session && state === 'checking') setState('ready');
  }, [session, state]);

  useEffect(() => {
    if (!ready || attempted.current) return;
    attempted.current = true;

    async function verify() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callbackError = search.get('error_description') ?? hash.get('error_description');
      const tokenHash = search.get('token_hash') ?? hash.get('token_hash');
      const code = search.get('code');
      if (callbackError) {
        setState('invalid');
        setProblem(/expired/i.test(callbackError) ? 'Odkaz vypršel.' : 'Odkaz není platný nebo už byl použitý.');
        return;
      }
      if (session) {
        setState('ready');
        return;
      }
      if (!tokenHash && !code) {
        setState('invalid');
        setProblem('Odkaz neobsahuje ověřovací údaje.');
        return;
      }
      const result = tokenHash
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        : await supabase.auth.exchangeCodeForSession(code as string);
      window.history.replaceState({}, '', `/prihlaseni?mode=reset${formal ? '&role=merchant' : ''}`);
      if (!result.error) {
        setState('ready');
        return;
      }
      // detectSessionInUrl may already have used the code; a session that exists wins.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setState('ready');
        return;
      }
      setState('invalid');
      setProblem(
        /verifier|pkce|code exchange/i.test(result.error.message)
          ? formal ? 'Odkaz se otevřel v jiném prohlížeči, než ve kterém jste o něj požádali.' : 'Odkaz se otevřel v jiném prohlížeči, než ve kterém sis o něj požádal/a.'
          : /expired/i.test(result.error.message) ? 'Odkaz vypršel.' : 'Odkaz není platný nebo už byl použitý.',
      );
    }

    void verify();
  }, [ready, search, session, formal]);

  async function submit({ password }: { password: string; confirm: string }) {
    setProblem(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setProblem(/different|same/i.test(error.message) ? 'Nové heslo musí být jiné než to současné.' : errorMessage(error));
      return;
    }
    setState('done');
  }

  if (state === 'checking') {
    return <p className="mt-6 text-base text-muted" role="status">Ověřujeme odkaz…</p>;
  }

  if (state === 'invalid') {
    return (
      <div className="mt-6 rounded-2xl bg-card p-5 shadow-card sm:p-6" role="alert">
        <h2 className="text-lg font-extrabold">Heslo teď nejde změnit</h2>
        <p className="mt-2 text-base text-muted">{problem} {formal ? 'Nechte si poslat nový odkaz.' : 'Nech si poslat nový odkaz.'}</p>
        <Button className="mt-4" onClick={() => navigate(`/prihlaseni?mode=forgot${formal ? '&role=merchant' : ''}`, { replace: true })}>
          Poslat nový odkaz
        </Button>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="mt-6 rounded-2xl bg-card p-5 shadow-card sm:p-6" role="status">
        <h2 className="text-lg font-extrabold">Heslo je změněné</h2>
        <p className="mt-2 text-base text-muted">{formal ? 'Jste přihlášeni a příště se přihlásíte novým heslem.' : 'Jsi přihlášený/á a příště se přihlásíš novým heslem.'}</p>
        <Button className="mt-4" onClick={() => navigate(formal ? '/partner' : '/', { replace: true })}>Pokračovat</Button>
      </div>
    );
  }

  return (
    <form className="mt-6 flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-card sm:p-6" onSubmit={form.handleSubmit(submit)} noValidate>
      <Field id="new-password" label="Nové heslo" hint="Alespoň 8 znaků." error={form.formState.errors.password?.message}>
        <Input id="new-password" type="password" autoComplete="new-password" {...form.register('password')} />
      </Field>
      <Field id="new-password-confirm" label="Nové heslo znovu" error={form.formState.errors.confirm?.message}>
        <Input id="new-password-confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
      </Field>
      {problem ? <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium text-ink">{problem}</p> : null}
      <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Uložit nové heslo</Button>
    </form>
  );
}
