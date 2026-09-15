/**
 * WhatsApp Cloud API (Meta) for venues and customers: the signature check, the webhook parser, the
 * templates and the replies. No Deno or npm imports, so the unit tests run it as it is.
 *
 * Nothing here decides a booking. The webhook hands the parsed button to `whatsapp_decide`, which
 * runs the same `private.decide_booking` as the app, after checking the number, the message it
 * belongs to and the one-time token carried in the button.
 */

export type WhatsAppEvent =
  | { kind: 'button'; key: string; id: string; from: string; contextId: string | null; payload: string | null; label: string | null }
  | { kind: 'text'; key: string; id: string; from: string; text: string }
  | { kind: 'status'; key: string; wamid: string; status: string; error: string | null };

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings in time that depends only on their length. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Meta signs every POST with `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the raw body
 * keyed with the app secret. The raw bytes are signed, never re-serialised JSON (Meta escapes
 * non-ASCII, so a re-encoded body would not match).
 */
export async function verifySignature(raw: Uint8Array<ArrayBuffer>, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !appSecret) return false;
  const [scheme, signature] = header.split('=', 2);
  if (scheme !== 'sha256' || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, raw));
  return timingSafeEqual(expected, signature.toLowerCase());
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === 'object' ? value as Json : {});
const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * The events FLEK acts on, from a `whatsapp_business_account` webhook: quick-reply taps, text
 * messages (pairing codes) and delivery statuses. Changes for another phone number of the same
 * account are ignored. Anything malformed is skipped rather than guessed at.
 */
export function parseWebhook(body: unknown, phoneNumberId?: string | null): WhatsAppEvent[] {
  const root = record(body);
  if (root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return [];
  const events: WhatsAppEvent[] = [];
  for (const entry of root.entry) {
    const changes = record(entry).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const { field, value } = record(change);
      if (field !== 'messages') continue;
      const data = record(value);
      if (phoneNumberId && record(data.metadata).phone_number_id !== phoneNumberId) continue;
      for (const message of Array.isArray(data.messages) ? data.messages : []) {
        const m = record(message);
        const id = text(m.id);
        const from = text(m.from);
        if (!id || !from) continue;
        if (m.type === 'button') {
          const button = record(m.button);
          events.push({
            kind: 'button', key: `message:${id}`, id, from,
            contextId: text(record(m.context).id), payload: text(button.payload), label: text(button.text),
          });
        } else if (m.type === 'interactive' && record(m.interactive).type === 'button_reply') {
          const reply = record(record(m.interactive).button_reply);
          events.push({
            kind: 'button', key: `message:${id}`, id, from,
            contextId: text(record(m.context).id), payload: text(reply.id), label: text(reply.title),
          });
        } else if (m.type === 'text') {
          const body = text(record(m.text).body);
          if (body) events.push({ kind: 'text', key: `message:${id}`, id, from, text: body.slice(0, 500) });
        }
      }
      for (const status of Array.isArray(data.statuses) ? data.statuses : []) {
        const s = record(status);
        const wamid = text(s.id);
        const state = text(s.status);
        if (!wamid || !state) continue;
        const errors = Array.isArray(s.errors) ? s.errors.map(record) : [];
        const error = errors.length ? `${errors[0].code ?? ''} ${errors[0].title ?? ''}`.trim().slice(0, 120) : null;
        events.push({ kind: 'status', key: `status:${wamid}:${state}`, wamid, status: state, error });
      }
    }
  }
  return events;
}

/** The value carried by a quick-reply button: the decision and the message's one-time token. */
export function actionPayload(accept: boolean, token: string): string {
  return `FLEK1.${accept ? 'a' : 'r'}.${token}`;
}

export type WhatsAppTemplate =
  | 'business_request'
  | 'business_confirmed'
  | 'business_cancelled'
  | 'customer_confirmed'
  | 'customer_cancelled';

/**
 * The Supabase secret holding the approved Meta template name of each message. A message whose
 * secret is missing is skipped, so templates can be approved one at a time. The texts and the order
 * of their parameters are in docs/PRED_SPUSTENIM.md.
 */
export const TEMPLATE_SECRETS: Record<WhatsAppTemplate, string> = {
  business_request: 'WHATSAPP_TEMPLATE_BOOKING_REQUEST',
  business_confirmed: 'WHATSAPP_TEMPLATE_BUSINESS_CONFIRMED',
  business_cancelled: 'WHATSAPP_TEMPLATE_BUSINESS_CANCELLED',
  customer_confirmed: 'WHATSAPP_TEMPLATE_CUSTOMER_CONFIRMED',
  customer_cancelled: 'WHATSAPP_TEMPLATE_CUSTOMER_CANCELLED',
};

/** What `claim_whatsapp_deliveries` hands over for one message: parameters in the template's order. */
export type TemplateJob = { to: string; template: WhatsAppTemplate; params: string[]; token: string | null };

/** Meta refuses text parameters with line breaks, tabs or runs of spaces. */
function parameter(value: string): { type: 'text'; text: string } {
  return { type: 'text', text: value.replace(/\s+/g, ' ').trim().slice(0, 200) || '–' };
}

/**
 * An approved utility template with its body parameters. Only the venue's request carries buttons:
 * quick replies Potvrdit and Nemohu přijmout, each with the message's one-time token.
 */
export function templateMessage(job: TemplateJob, name: string, language: string) {
  const components: Record<string, unknown>[] = [{ type: 'body', parameters: job.params.map(parameter) }];
  if (job.template === 'business_request') {
    if (!job.token) throw new Error('WHATSAPP_TOKEN_MISSING');
    components.push(
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: actionPayload(true, job.token) }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: actionPayload(false, job.token) }] },
    );
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: job.to.replace(/\D/g, ''),
    type: 'template',
    template: { name, language: { code: language }, components },
  };
}

export function textMessage(to: string, body: string, replyTo?: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/\D/g, ''),
    type: 'text',
    text: { body, preview_url: false },
    ...(replyTo ? { context: { message_id: replyTo } } : {}),
  };
}

const APP = 'https://www.app-flek.eu/partner/rezervace';

/** What the partner reads after tapping a button: the server's answer, never the button they pressed. */
export function decisionReply(result: { result?: string; status?: string; decided?: boolean } | null): string | null {
  if (!result) return null;
  switch (result.result) {
    case undefined:
    case 'duplicate':
      return null;
    case 'unknown_action':
    case 'unknown_message':
      return `Tuto zprávu už nejde použít. Žádosti o rezervaci najdete v aplikaci FLEK Partner: ${APP}`;
    case 'wrong_number':
    case 'not_allowed':
      return `Z tohoto čísla teď žádost vyřídit nejde. Otevřete prosím aplikaci FLEK Partner: ${APP}`;
    case 'error':
      return `Žádost se teď nepodařilo vyřídit. Zkuste tlačítko znovu, nebo ji vyřiďte v aplikaci FLEK Partner: ${APP}`;
    default:
      break;
  }
  if (result.decided && result.status === 'capturing') {
    return 'Potvrzeno ✅ Dokončujeme platbu zákazníka. Rezervační kód uvidíte za pár sekund v aplikaci FLEK Partner.';
  }
  if (result.decided && result.status === 'rejected') {
    return 'Rezervaci jste odmítli. Zákazník nic nezaplatí a místo se vrátilo do nabídky.';
  }
  switch (result.status) {
    case 'expired':
      return 'Na potvrzení už bylo pozdě. Žádost vypršela, zákazník nic nezaplatí a místo se vrátilo do nabídky.';
    case 'cancelled_by_customer':
      return 'Zákazník žádost mezitím zrušil.';
    case 'capturing':
    case 'confirmed':
    case 'completed':
    case 'no_show':
      return 'Rezervace už je potvrzená.';
    case 'rejected':
      return 'Žádost už byla odmítnuta.';
    case 'cancelled_by_merchant':
      return 'Nabídka byla mezitím zrušena, žádost už neplatí.';
    case 'payment_failed':
      return 'Platbu zákazníka se nepodařilo dokončit, rezervace nevznikla.';
    default:
      return 'Žádost už mezitím skončila.';
  }
}

export function pairingReply(result: { result?: string; kind?: string; business?: string | null } | null): string | null {
  if (result?.result === 'paired' && result.kind === 'customer') {
    return 'Hotovo ✅ Potvrzené FLEKy s rezervačním kódem a změny tvých rezervací ti budeme posílat sem. Vypnout to můžeš v aplikaci FLEK v Profilu.';
  }
  if (result?.result === 'paired') {
    return `Hotovo ✅ Žádosti o rezervaci a změny rezervací pro ${result.business ?? 'vaši provozovnu'} vám budeme posílat sem. Vypnout to můžete v aplikaci FLEK Partner v sekci Provozovna.`;
  }
  if (result?.result === 'failed') {
    // Nobody knows yet whether a venue or a customer wrote, so the answer addresses neither.
    return 'Kód nesedí, vypršel, nebo nepřišel z čísla zadaného v aplikaci FLEK. Nový kód vytvoří tlačítko Ověřit ve WhatsAppu.';
  }
  return null;
}
