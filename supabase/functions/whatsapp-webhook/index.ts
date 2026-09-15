import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { decisionReply, pairingReply, parseWebhook, textMessage, timingSafeEqual, verifySignature } from '../_shared/whatsapp.ts';

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * GET only answers Meta's subscription handshake and changes nothing. POST is accepted only with a
 * valid `X-Hub-Signature-256` over the raw body. Every decision and pairing is made by the
 * database (`whatsapp_decide`, `whatsapp_pair`), which deduplicates Meta's repeated deliveries;
 * this function only parses, forwards and sends the short reply.
 *
 * Secrets: WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID.
 */
Deno.serve(async (request) => {
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
    const token = url.searchParams.get('hub.verify_token') ?? '';
    if (expected.length >= 16 && url.searchParams.get('hub.mode') === 'subscribe' && timingSafeEqual(token, expected)) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!appSecret) return new Response('Not configured', { status: 503 });
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > 1_000_000) return new Response('Payload too large', { status: 413 });
  if (!(await verifySignature(raw, request.headers.get('X-Hub-Signature-256'), appSecret))) {
    return new Response('Invalid signature', { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Without the number id every change of the account would be taken as ours; refuse rather than guess.
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!phoneNumberId) return new Response('Not configured', { status: 503 });

  let retry = false;
  for (const event of parseWebhook(body, phoneNumberId)) {
    try {
      if (event.kind === 'status') {
        await call(db, 'whatsapp_status', { p_event_key: event.key, p_wamid: event.wamid, p_status: event.status, p_error: event.error });
      } else if (event.kind === 'button') {
        const result = await call(db, 'whatsapp_decide', {
          p_event_key: event.key, p_from: event.from, p_context_id: event.contextId, p_payload: event.payload, p_label: event.label,
        });
        await reply(event.from, decisionReply(result), event.id);
      } else {
        const result = await call(db, 'whatsapp_pair', { p_event_key: event.key, p_from: event.from, p_text: event.text });
        await reply(event.from, pairingReply(result), event.id);
      }
    } catch (error) {
      // The database did not record the event, so Meta's retry will bring it again. A reply that
      // failed after a recorded decision is not retried: the decision stands and the app shows it.
      console.error('whatsapp-webhook', event.kind, error instanceof Error ? error.message : String(error));
      retry = true;
    }
  }
  return new Response(retry ? 'Retry' : 'ok', { status: retry ? 500 : 200, headers: { 'Cache-Control': 'no-store' } });
});

async function call(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

/** A free-form reply inside the 24-hour window the partner's own message has just opened. */
async function reply(to: string, body: string | null, replyTo: string) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!body || !token || !phoneNumberId) return;
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v25.0';
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(textMessage(to, body, replyTo)),
    });
    if (!response.ok) console.error('whatsapp-webhook reply', response.status);
  } catch (error) {
    console.error('whatsapp-webhook reply', error instanceof Error ? error.message : String(error));
  }
}
