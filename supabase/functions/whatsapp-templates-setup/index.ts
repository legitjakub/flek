import { createClient } from 'jsr:@supabase/supabase-js@2';
import { TEMPLATE_DEFINITIONS, TEMPLATE_SECRETS, templateCreatePayload } from '../_shared/whatsapp.ts';

/**
 * Zakládá u Mety pět šablon zpráv, které FLEK posílá, aby je nikdo nemusel klikat ve WhatsApp
 * Manageru — ten v prohlížeči opakovaně zamrzal a 18. ani 19. 9. se neuložila jediná. Jen pro
 * adminy, stejně jako `stripe-webhook-setup`.
 *
 * Šablona, která už existuje, se nepřepisuje: vrátí se její stav od Mety (APPROVED, PENDING,
 * REJECTED). `{ "dry_run": true }` jen vypíše, co by se založilo. V odpovědi nikdy není token.
 */
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

  const body = await request.json().catch(() => ({})) as { dry_run?: boolean; waba_id?: string };
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
  // Jméno tajného klíče u každé šablony: podle něj se doplní zbytek nastavení v Supabase.
  return json({ language, graph_version: version, dry_run: Boolean(body.dry_run), created, failed, templates: results }, failed ? 207 : 200);
});
