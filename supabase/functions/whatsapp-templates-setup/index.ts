import { createClient } from 'jsr:@supabase/supabase-js@2';
import { TEMPLATE_DEFINITIONS, TEMPLATE_SECRETS, templateCreatePayload } from '../_shared/whatsapp.ts';

/**
 * Zakládá u Mety pět šablon zpráv, které FLEK posílá, aby je nikdo nemusel klikat ve WhatsApp
 * Manageru — ten v prohlížeči opakovaně zamrzal a 18. ani 19. 9. se neuložila jediná. Jen pro
 * adminy, stejně jako `stripe-webhook-setup`.
 *
 * Šablona, která už existuje, se nepřepisuje: vrátí se její stav od Mety (APPROVED, PENDING,
 * REJECTED). `{ "dry_run": true }` jen vypíše, co by se založilo. V odpovědi nikdy není token.
 *
 * Od 24. 9. vrací i stav celého kanálu, aby administrace řekla, co ještě chybí: které tajné klíče
 * jsou vyplněné (jen jména), číslo a jméno od Mety, kam Meta posílá webhook, jestli je aplikace
 * přihlášená k odběru zpráv účtu. `subscribe: true` aplikaci k odběru přihlásí a `profile: true`
 * nastaví texty profilu FLEKu na WhatsAppu; obojí jen na výslovné klepnutí admina.
 */

/** Tajné klíče, které kanál používá; odpověď nese jen to, zda jsou vyplněné. */
const SECRET_NAMES = [
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_WABA_ID', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_TEMPLATE_LANGUAGE',
];

/*
 * Profil FLEKu na WhatsAppu: stejná slova jako aplikace, bez oslovení, protože ho čte zákazník
 * i podnik. Popis říká pravdu o tom, co číslo umí — na běžné zprávy nikdo neodpovídá.
 */
const PROFILE = {
  about: 'Volné FLEKy na poslední chvíli se slevou. Potvrzení rezervací a rezervační kódy z aplikace FLEK.',
  description: 'Z tohoto čísla FLEK posílá potvrzení rezervací, rezervační kódy a žádosti o potvrzení pro podniky. Na běžné zprávy tady neodpovídáme; rezervace, změny a nápovědu najdete v aplikaci FLEK na www.app-flek.eu.',
  websites: ['https://www.app-flek.eu'],
  vertical: 'OTHER',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type MetaTemplate = { name: string; status?: string; category?: string; language?: string };

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'AUTH_REQUIRED' }, 401);

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: admin } = await client.rpc('is_admin');
  if (admin !== true) return json({ error: 'FORBIDDEN' }, 403);

  const body = await request.json().catch(() => ({})) as { dry_run?: boolean; waba_id?: string; subscribe?: boolean; profile?: boolean };
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const waba = body.waba_id ?? Deno.env.get('WHATSAPP_WABA_ID');
  const language = Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'cs';
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v25.0';
  // Řekni, co chybí, jménem tajného klíče — hádat se to nedá a hodnotu stejně nikdo neuvidí.
  const missing = [!token && 'WHATSAPP_ACCESS_TOKEN', !waba && 'WHATSAPP_WABA_ID'].filter(Boolean);
  if (missing.length) return json({ error: 'WHATSAPP_NOT_CONFIGURED', missing }, 503);

  const graph = `https://graph.facebook.com/${version}/${waba}/message_templates`;
  const auth = { Authorization: `Bearer ${token}` };

  let existing: MetaTemplate[];
  try {
    const response = await fetch(`${graph}?fields=name,status,language,category&limit=200`, { headers: auth });
    const payload = await response.json();
    if (!response.ok) {
      return json({ error: 'META_REQUEST_FAILED', step: 'list', status: response.status, detail: payload?.error?.message ?? null }, 502);
    }
    existing = (payload.data ?? []) as MetaTemplate[];
  } catch (error) {
    return json({ error: 'META_UNREACHABLE', detail: error instanceof Error ? error.message : String(error) }, 502);
  }

  const results: Record<string, unknown>[] = [];
  for (const definition of TEMPLATE_DEFINITIONS) {
    const secret = TEMPLATE_SECRETS[definition.template];
    const name = Deno.env.get(secret) ?? definition.name;
    const found = existing.find((candidate) => candidate.name === name);
    if (found) {
      results.push({ template: definition.template, name, secret, action: 'exists', status: found.status ?? null });
      continue;
    }
    if (body.dry_run) {
      results.push({ template: definition.template, name, secret, action: 'would_create' });
      continue;
    }
    try {
      const response = await fetch(graph, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(templateCreatePayload(definition, name, language)),
      });
      const payload = await response.json();
      if (!response.ok) {
        results.push({ template: definition.template, name, secret, action: 'failed', status: response.status, detail: payload?.error?.error_user_msg ?? payload?.error?.message ?? null });
        continue;
      }
      results.push({ template: definition.template, name, secret, action: 'created', id: payload.id ?? null, status: payload.status ?? 'PENDING' });
    } catch (error) {
      results.push({ template: definition.template, name, secret, action: 'failed', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const created = results.filter((result) => result.action === 'created').length;
  const failed = results.filter((result) => result.action === 'failed').length;
  console.log(`whatsapp-templates-setup created=${created} failed=${failed}`);

  const secrets = Object.fromEntries(
    [...SECRET_NAMES, ...Object.values(TEMPLATE_SECRETS)].map((name) => [name, Boolean(Deno.env.get(name))]),
  );
  const graphRoot = `https://graph.facebook.com/${version}`;
  const metaApi = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${graphRoot}/${path}`, { ...init, headers: { ...auth, 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.error_user_msg ?? payload?.error?.message ?? `HTTP ${response.status}`);
    return payload;
  };
  const failure = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) });
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

  // Na výslovné klepnutí: přihlásit aplikaci k odběru zpráv účtu, nastavit texty profilu.
  const actions: Record<string, unknown> = {};
  if (body.subscribe) {
    actions.subscribe = await metaApi(`${waba}/subscribed_apps`, { method: 'POST' }).then(() => ({ ok: true }), failure);
  }
  if (body.profile && phoneNumberId) {
    const { data: legal } = await client.rpc('legal_info');
    const email = (legal as { operator?: { email?: string | null } } | null)?.operator?.email ?? undefined;
    actions.profile = await metaApi(`${phoneNumberId}/whatsapp_business_profile`, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', ...PROFILE, ...(email ? { email } : {}) }),
    }).then(() => ({ ok: true }), failure);
  }

  // Jen čtení: číslo a kam Meta posílá webhook, odběr zpráv účtu a profil.
  const phone = phoneNumberId
    ? await metaApi(`${phoneNumberId}?fields=display_phone_number,verified_name,name_status,quality_rating,code_verification_status,webhook_configuration`)
      .then((data) => ({
        display_phone_number: data.display_phone_number ?? null,
        verified_name: data.verified_name ?? null,
        name_status: data.name_status ?? null,
        quality_rating: data.quality_rating ?? null,
        code_verification_status: data.code_verification_status ?? null,
        webhook: data.webhook_configuration ?? null,
      }), failure)
    : { error: 'WHATSAPP_PHONE_NUMBER_ID' };
  const subscription = await metaApi(`${waba}/subscribed_apps`)
    .then((data) => ({
      apps: ((data?.data ?? []) as { whatsapp_business_api_data?: { id?: string; name?: string }; override_callback_uri?: string }[])
        .map((app) => ({ id: app.whatsapp_business_api_data?.id ?? null, name: app.whatsapp_business_api_data?.name ?? null, override_callback_uri: app.override_callback_uri ?? null })),
    }), failure);
  const profile = phoneNumberId
    ? await metaApi(`${phoneNumberId}/whatsapp_business_profile?fields=about,description,email,websites,vertical,profile_picture_url`)
      .then((data) => {
        const found = (data?.data ?? [])[0] ?? {};
        return { about: found.about ?? null, description: found.description ?? null, email: found.email ?? null, websites: found.websites ?? [], vertical: found.vertical ?? null, has_picture: Boolean(found.profile_picture_url) };
      }, failure)
    : null;

  // Jméno tajného klíče u každé šablony: podle něj se doplní zbytek nastavení v Supabase.
  return json({
    language, graph_version: version, dry_run: Boolean(body.dry_run), created, failed, templates: results,
    secrets, callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`,
    phone, subscription, profile, actions, brand_profile: PROFILE,
  }, failed ? 207 : 200);
});
