import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json as reply, preflight } from '../_shared/stripe.ts';
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
 *
 * Volat ji smí přihlášený admin, nebo databáze s tajným klíčem workeru (stejným, jakým se volá
 * doručování upozornění), aby nastavení šlo dokončit i bez prohlížeče. Proto `verify_jwt = false`:
 * obě cesty ověřuje funkce sama a bez jedné z nich nic neudělá. `webhook: true` přihlásí aplikaci
 * k webhooku `whatsapp_business_account` s polem `messages` a adresou `whatsapp-webhook`; Meta při
 * tom ověří náš endpoint stejným tokenem, jaký má `WHATSAPP_VERIFY_TOKEN`. `picture: true` nahraje
 * jako fotku profilu ikonu FLEKu z webu. Obojí potřebuje ID aplikace: z `app_id`, jinak aplikace,
 * ke které patří token (`/app`). Podle odběru účtu se hádat nedá: testovací číslo má přihlášenou
 * i vlastní aplikaci Mety („WA DevX Webhook Events 1P App“). `resubmit: true` spolu s
 * `dry_run: false` pošle zamítnuté šablony znovu ke schválení v dnešním znění z `_shared/whatsapp.ts`.
 *
 * Admin ji volá z prohlížeče na jiné doméně, proto odpovídá na předletový dotaz a posílá hlavičky
 * CORS jen pro adresy FLEKu, stejně jako ostatní funkce volané z aplikace.
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
/** Fotka profilu: ikona pro instalaci aplikace, čtverec s celým špendlíkem uvnitř kruhového ořezu. */
const PICTURE_PATH = '/icon-maskable-512.png';

type MetaTemplate = { id?: string; name: string; status?: string; category?: string; language?: string; rejected_reason?: string };

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  const json = (body: unknown, status = 200) => reply(request, body, status);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'AUTH_REQUIRED' }, 401);

  // Databáze s tajným klíčem workeru, nebo admin; klíč workeru má aspoň 32 znaků a JWT mu nikdy nerovná.
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: worker } = await service.rpc('notification_worker_authorized', { p_secret: authorization.slice(7) });
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (worker !== true) {
    const { data: admin } = await client.rpc('is_admin');
    if (admin !== true) return json({ error: 'FORBIDDEN' }, 403);
  }

  const body = await request.json().catch(() => ({})) as {
    dry_run?: boolean; waba_id?: string; subscribe?: boolean; profile?: boolean; webhook?: boolean; picture?: boolean; app_id?: string;
    resubmit?: boolean;
  };
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const waba = body.waba_id ?? Deno.env.get('WHATSAPP_WABA_ID');
  const language = Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'cs';
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v25.0';
  // Řekni, co chybí, jménem tajného klíče — hádat se to nedá a hodnotu stejně nikdo neuvidí.
  const missing = [!token && 'WHATSAPP_ACCESS_TOKEN', !waba && 'WHATSAPP_WABA_ID'].filter(Boolean);
  if (missing.length) return json({ error: 'WHATSAPP_NOT_CONFIGURED', missing }, 503);

  const graphRoot = `https://graph.facebook.com/${version}`;
  const graph = `${graphRoot}/${waba}/message_templates`;
  const auth = { Authorization: `Bearer ${token}` };

  let existing: MetaTemplate[];
  try {
    const response = await fetch(`${graph}?fields=id,name,status,language,category,rejected_reason&limit=200`, { headers: auth });
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
    // Důvod zamítnutí od Mety (INVALID_FORMAT, INCORRECT_CATEGORY…), podle něj se upraví text.
    const rejectedReason = found?.status === 'REJECTED' ? found.rejected_reason ?? null : null;
    if (found && found.status === 'REJECTED' && body.resubmit && found.id) {
      if (body.dry_run) {
        results.push({ template: definition.template, name, secret, action: 'would_resubmit', status: found.status, rejected_reason: rejectedReason });
        continue;
      }
      // Úprava zamítnuté šablony: stejný název i jazyk, nové tělo; Meta ji posoudí znovu.
      const { category, components } = templateCreatePayload(definition, name, language);
      try {
        const response = await fetch(`${graphRoot}/${found.id}`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ category, components }),
        });
        const payload = await response.json().catch(() => null);
        results.push(response.ok
          ? { template: definition.template, name, secret, action: 'resubmitted', status: 'PENDING' }
          : { template: definition.template, name, secret, action: 'failed', status: response.status, detail: payload?.error?.error_user_msg ?? payload?.error?.message ?? null });
      } catch (error) {
        results.push({ template: definition.template, name, secret, action: 'failed', detail: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    if (found) {
      results.push({ template: definition.template, name, secret, action: 'exists', status: found.status ?? null, rejected_reason: rejectedReason });
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

  const created = results.filter((result) => result.action === 'created' || result.action === 'resubmitted').length;
  const failed = results.filter((result) => result.action === 'failed').length;
  console.log(`whatsapp-templates-setup created=${created} failed=${failed}`);

  const secrets = Object.fromEntries(
    [...SECRET_NAMES, ...Object.values(TEMPLATE_SECRETS)].map((name) => [name, Boolean(Deno.env.get(name))]),
  );
  const metaApi = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${graphRoot}/${path}`, { ...init, headers: { ...auth, 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.error_user_msg ?? payload?.error?.message ?? `HTTP ${response.status}`);
    return payload;
  };
  const failure = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) });
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

  // Na výslovné klepnutí: přihlásit odběr zpráv účtu, nastavit webhook, fotku a texty profilu.
  const actions: Record<string, unknown> = {};
  if (body.subscribe) {
    actions.subscribe = await metaApi(`${waba}/subscribed_apps`, { method: 'POST' }).then(() => ({ ok: true }), failure);
  }
  const subscription = await metaApi(`${waba}/subscribed_apps`)
    .then((data) => ({
      apps: ((data?.data ?? []) as { whatsapp_business_api_data?: { id?: string; name?: string }; override_callback_uri?: string }[])
        .map((app) => ({ id: app.whatsapp_business_api_data?.id ?? null, name: app.whatsapp_business_api_data?.name ?? null, override_callback_uri: app.override_callback_uri ?? null })),
    }), failure);
  // Aplikace, ke které patří token: tu přihlašuje `subscribe`, pro ni se nastavuje webhook i logo.
  const tokenApp = await metaApi('app?fields=id,name')
    .then((data) => ({ id: typeof data?.id === 'string' ? data.id : null, name: data?.name ?? null }), failure);
  const tokenAppId = 'id' in tokenApp && tokenApp.id && /^\d{5,20}$/.test(tokenApp.id) ? tokenApp.id : null;
  const appId = body.app_id && /^\d{5,20}$/.test(body.app_id) ? body.app_id : tokenAppId;

  const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`;
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
  const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
  // Webhook aplikace se dá nastavit jen tokenem aplikace (ID|App Secret); ten nikdy neopustí funkci.
  const appToken = appId && appSecret ? `${appId}|${appSecret}` : null;
  if (body.webhook) {
    actions.webhook = !appId ? { error: 'APP_ID' }
      : !appToken || verifyToken.length < 16 ? { error: !appToken ? 'WHATSAPP_APP_SECRET' : 'WHATSAPP_VERIFY_TOKEN' }
      : await fetch(`${graphRoot}/${appId}/subscriptions`, {
        method: 'POST',
        body: new URLSearchParams({
          object: 'whatsapp_business_account', callback_url: callbackUrl, verify_token: verifyToken,
          fields: 'messages', include_values: 'true', access_token: appToken,
        }),
      }).then(async (response) => {
        const payload = await response.json().catch(() => null);
        return response.ok ? { ok: true } : { error: payload?.error?.message ?? `HTTP ${response.status}` };
      }, failure);
  }
  if (body.picture && phoneNumberId) {
    // Nahrávací API Mety: sezení u aplikace, pak samotný soubor, a vrácený handle do profilu.
    actions.picture = !appId ? { error: 'APP_ID' } : await (async () => {
      const site = Deno.env.get('SITE_URL') ?? 'https://www.app-flek.eu';
      const image = await fetch(`${site}${PICTURE_PATH}`);
      if (!image.ok) throw new Error(`PICTURE_HTTP_${image.status}`);
      const bytes = new Uint8Array(await image.arrayBuffer());
      const session = await metaApi(`${appId}/uploads?${new URLSearchParams({ file_name: 'flek.png', file_length: String(bytes.byteLength), file_type: 'image/png' })}`, { method: 'POST' });
      if (typeof session?.id !== 'string') throw new Error('UPLOAD_SESSION');
      const upload = await fetch(`${graphRoot}/${session.id}`, {
        method: 'POST', headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'content-type': 'image/png' }, body: bytes,
      });
      const uploaded = await upload.json().catch(() => null);
      if (!upload.ok || typeof uploaded?.h !== 'string') throw new Error(uploaded?.error?.message ?? `HTTP ${upload.status}`);
      await metaApi(`${phoneNumberId}/whatsapp_business_profile`, {
        method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', profile_picture_handle: uploaded.h }),
      });
      return { ok: true };
    })().catch(failure);
  }
  if (body.profile && phoneNumberId) {
    // Veřejný údaj; klíč workeru není JWT, takže by ho PostgREST pod `client` odmítl.
    const { data: legal } = await service.rpc('legal_info');
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
  const numbers = await metaApi(`${waba}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating`)
    .then((data) => ({ list: (data?.data ?? []) as Record<string, unknown>[] }), failure);
  const appSubscriptions = appToken
    ? await fetch(`${graphRoot}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) return { error: payload?.error?.message ?? `HTTP ${response.status}` };
        return {
          list: ((payload?.data ?? []) as { object?: string; callback_url?: string; active?: boolean; fields?: { name?: string }[] }[])
            .map((entry) => ({ object: entry.object ?? null, callback_url: entry.callback_url ?? null, active: entry.active ?? null, fields: (entry.fields ?? []).map((field) => field.name) })),
        };
      }, failure)
    : null;
  const profile = phoneNumberId
    ? await metaApi(`${phoneNumberId}/whatsapp_business_profile?fields=about,description,email,websites,vertical,profile_picture_url`)
      .then((data) => {
        const found = (data?.data ?? [])[0] ?? {};
        return { about: found.about ?? null, description: found.description ?? null, email: found.email ?? null, websites: found.websites ?? [], vertical: found.vertical ?? null, has_picture: Boolean(found.profile_picture_url) };
      }, failure)
    : null;

  // Proč šablony nebo zprávy stojí: kontrola účtu, ověření firmy, režim čísla a „zdraví“ podle Mety
  // (co brání posílání a jak to vyřešit). Každý dotaz zvlášť, aby jedno nepodporované pole nesmazalo zbytek.
  const account = await metaApi(`${waba}?fields=name,account_review_status,business_verification_status,ownership_type`)
    .then((data) => ({
      name: data?.name ?? null,
      account_review_status: data?.account_review_status ?? null,
      business_verification_status: data?.business_verification_status ?? null,
      ownership_type: data?.ownership_type ?? null,
    }), failure);
  const accountHealth = await metaApi(`${waba}?fields=health_status`).then((data) => data?.health_status ?? null, failure);
  const phoneStatus = phoneNumberId
    ? await metaApi(`${phoneNumberId}?fields=status,account_mode,messaging_limit_tier,platform_type`)
      .then((data) => ({
        status: data?.status ?? null,
        account_mode: data?.account_mode ?? null,
        messaging_limit_tier: data?.messaging_limit_tier ?? null,
        platform_type: data?.platform_type ?? null,
      }), failure)
    : null;
  const phoneHealth = phoneNumberId ? await metaApi(`${phoneNumberId}?fields=health_status`).then((data) => data?.health_status ?? null, failure) : null;

  // Jméno tajného klíče u každé šablony: podle něj se doplní zbytek nastavení v Supabase.
  return json({
    language, graph_version: version, dry_run: Boolean(body.dry_run), created, failed, templates: results,
    secrets, callback_url: callbackUrl, token_app: tokenApp,
    phone, numbers, subscription, app_subscriptions: appSubscriptions, profile, actions, brand_profile: PROFILE,
    account: { ...account, health: accountHealth }, phone_status: phoneStatus, phone_health: phoneHealth,
  }, failed ? 207 : 200);
});
