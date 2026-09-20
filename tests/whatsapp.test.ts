import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_DEFINITIONS, TEMPLATE_SECRETS, actionPayload, decisionReply, pairingReply, parseWebhook, templateCreatePayload, templateMessage, textMessage,
  timingSafeEqual, verifySignature,
} from '../supabase/functions/_shared/whatsapp';
import { displayPhone, pairingCode, whatsappLink } from '../src/lib/phone';

const SECRET = 'test-app-secret-0123456789';
const sign = (raw: Uint8Array<ArrayBuffer>, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const bytes = (value: string) => new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;

function webhook(value: Record<string, unknown>, phoneNumberId = '106540352242922') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '102290129340398', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '420222333444', phone_number_id: phoneNumberId }, ...value } }] }],
  };
}

describe('WhatsApp webhook signature', () => {
  it('accepts only an HMAC-SHA256 of the exact raw body with the app secret', async () => {
    // Meta signs the escaped bytes it sent; the same JSON re-serialised would not match.
    const raw = bytes('{"text":"Potvrdit \\u010dasu"}');
    expect(await verifySignature(raw, sign(raw), SECRET)).toBe(true);
    expect(await verifySignature(raw, sign(raw).toUpperCase().replace('SHA256', 'sha256'), SECRET)).toBe(true);
    expect(await verifySignature(bytes('{"text":"Potvrdit času"}'), sign(raw), SECRET)).toBe(false);
    expect(await verifySignature(raw, sign(raw, 'another-secret'), SECRET)).toBe(false);
    expect(await verifySignature(raw, null, SECRET)).toBe(false);
    expect(await verifySignature(raw, 'sha1=' + 'a'.repeat(40), SECRET)).toBe(false);
    expect(await verifySignature(raw, sign(raw), '')).toBe(false);
  });

  it('compares secrets without an early exit on the first difference', () => {
    expect(timingSafeEqual('verify-token-1234', 'verify-token-1234')).toBe(true);
    expect(timingSafeEqual('verify-token-1234', 'verify-token-1235')).toBe(false);
    expect(timingSafeEqual('short', 'shorter')).toBe(false);
  });
});

describe('WhatsApp webhook parser', () => {
  it('reads a quick-reply tap with its payload and the message it belongs to', () => {
    const events = parseWebhook(webhook({
      contacts: [{ profile: { name: 'Salon' }, wa_id: '420777123456' }],
      messages: [{
        context: { from: '420222333444', id: 'wamid.SENT' }, from: '420777123456', id: 'wamid.TAP', timestamp: '1750091045',
        type: 'button', button: { payload: 'FLEK1.a.abcdefghijklmnopqrstuvwxyz012345', text: 'Potvrdit' },
      }],
    }), '106540352242922');
    expect(events).toEqual([{
      kind: 'button', key: 'message:wamid.TAP', id: 'wamid.TAP', from: '420777123456', contextId: 'wamid.SENT',
      payload: 'FLEK1.a.abcdefghijklmnopqrstuvwxyz012345', label: 'Potvrdit',
    }]);
  });

  it('reads pairing texts, interactive replies and delivery statuses, and skips other numbers', () => {
    const events = parseWebhook(webhook({
      messages: [
        { from: '420777123456', id: 'wamid.TEXT', type: 'text', text: { body: 'FLEK 123456' } },
        { from: '420777123456', id: 'wamid.INT', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: 'Nemohu přijmout' } } },
        { from: '420777123456', id: 'wamid.IMG', type: 'image', image: { id: '1' } },
        { id: 'wamid.NOFROM', type: 'text', text: { body: 'FLEK 123456' } },
      ],
      statuses: [{ id: 'wamid.SENT', status: 'failed', recipient_id: '420777123456', errors: [{ code: 131026, title: 'Message undeliverable' }] }],
    }));
    expect(events.map((event) => event.kind)).toEqual(['text', 'button', 'status']);
    expect(events[2]).toEqual({ kind: 'status', key: 'status:wamid.SENT:failed', wamid: 'wamid.SENT', status: 'failed', error: '131026 Message undeliverable' });
    expect(parseWebhook(webhook({ messages: [{ from: '1', id: 'a', type: 'text', text: { body: 'x' } }] }, 'other-number'), '106540352242922')).toEqual([]);
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
});

describe('WhatsApp messages', () => {
  it('sends the request template with clean parameters and one-time payloads on both buttons', () => {
    const message = templateMessage({
      to: '+420 777 123 456', template: 'business_request', token: 'tok_0123456789abcdefghij',
      params: ['dnes 14:30', 'Střih\n(45 min)', '750 Kč', '14:08'],
    }, 'flek_booking_request', 'cs');
    expect(message.to).toBe('420777123456');
    expect(message.template.language).toEqual({ code: 'cs' });
    expect(message.template.components[0]).toEqual({
      type: 'body',
      parameters: [{ type: 'text', text: 'dnes 14:30' }, { type: 'text', text: 'Střih (45 min)' }, { type: 'text', text: '750 Kč' }, { type: 'text', text: '14:08' }],
    });
    expect(message.template.components.slice(1)).toEqual([
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'FLEK1.a.tok_0123456789abcdefghij' }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'FLEK1.r.tok_0123456789abcdefghij' }] },
    ]);
    // A request without its token would carry buttons that decide nothing; it is not sent at all.
    expect(() => templateMessage({ to: '+420777123456', template: 'business_request', token: null, params: [] }, 'x', 'cs')).toThrow();
    expect(actionPayload(false, 'abc')).toBe('FLEK1.r.abc');
    expect(textMessage('+420777123456', 'Ahoj', 'wamid.TAP')).toMatchObject({ to: '420777123456', text: { body: 'Ahoj' }, context: { message_id: 'wamid.TAP' } });
  });

  it('sends confirmations and cancellations without buttons, each under its own template secret', () => {
    const message = templateMessage({
      to: '+420777888999', template: 'customer_confirmed', token: null,
      params: ['Salon Petra', 'zítra 9:00', 'Střih (45 min)', 'FLEK-7K2Q'],
    }, 'flek_customer_confirmed', 'cs');
    expect(message.template.name).toBe('flek_customer_confirmed');
    expect(message.template.components).toEqual([{
      type: 'body',
      parameters: [{ type: 'text', text: 'Salon Petra' }, { type: 'text', text: 'zítra 9:00' }, { type: 'text', text: 'Střih (45 min)' }, { type: 'text', text: 'FLEK-7K2Q' }],
    }]);
    // An empty parameter is refused by Meta; a dash keeps the message readable.
    expect(templateMessage({ to: '1', template: 'business_cancelled', token: null, params: ['dnes 9:00', '  ', 'Rezervace byla zrušena'] }, 'x', 'cs')
      .template.components[0]).toMatchObject({ parameters: [{ text: 'dnes 9:00' }, { text: '–' }, { text: 'Rezervace byla zrušena' }] });
    expect(TEMPLATE_SECRETS).toEqual({
      business_request: 'WHATSAPP_TEMPLATE_BOOKING_REQUEST',
      business_confirmed: 'WHATSAPP_TEMPLATE_BUSINESS_CONFIRMED',
      business_cancelled: 'WHATSAPP_TEMPLATE_BUSINESS_CANCELLED',
      customer_confirmed: 'WHATSAPP_TEMPLATE_CUSTOMER_CONFIRMED',
      customer_cancelled: 'WHATSAPP_TEMPLATE_CUSTOMER_CANCELLED',
    });
  });

  it('answers with the outcome the database reports', () => {
    expect(decisionReply({ result: 'decided', status: 'capturing', decided: true })).toMatch(/^Potvrzeno/);
    expect(decisionReply({ result: 'decided', status: 'rejected', decided: true })).toMatch(/nic nezaplatí/);
    expect(decisionReply({ result: 'not_decided', status: 'expired', decided: false })).toMatch(/pozdě/);
    expect(decisionReply({ result: 'already', status: 'confirmed', decided: false })).toBe('Rezervace už je potvrzená.');
    expect(decisionReply({ result: 'not_decided', status: 'cancelled_by_customer', decided: false })).toBe('Zákazník žádost mezitím zrušil.');
    expect(decisionReply({ result: 'wrong_number' })).toMatch(/Z tohoto čísla/);
    expect(decisionReply({ result: 'unknown_message' })).toMatch(/nejde použít/);
    // A repeated delivery of the same tap gets no second message.
    expect(decisionReply({ result: 'duplicate' })).toBeNull();
    expect(decisionReply(null)).toBeNull();
    expect(pairingReply({ result: 'paired', kind: 'business', business: 'Salon Petra' })).toMatch(/Salon Petra.*vám/);
    // The customer part of FLEK is on first-name terms, the partner part is formal.
    expect(pairingReply({ result: 'paired', kind: 'customer', business: null })).toMatch(/ti budeme.*můžeš/);
    expect(pairingReply({ result: 'failed' })).toMatch(/Nový kód/);
    expect(pairingReply({ result: 'blocked' })).toBeNull();
    expect(pairingReply({ result: 'ignored' })).toBeNull();
  });

  it('formats numbers for people and opens a chat without sending anything', () => {
    expect(displayPhone('+420777123456')).toBe('+420 777 123 456');
    expect(displayPhone('+4915123456789')).toBe('+4915123456789');
    expect(displayPhone(null)).toBe('');
    expect(whatsappLink('+420 222 333 444', 'FLEK 123456')).toBe('https://wa.me/420222333444?text=FLEK%20123456');
    // The app's pairing code: always six digits, leading zeros kept, from the browser's secure random source.
    expect(pairingCode((values) => { values[0] = 4217; })).toBe('004217');
    expect(pairingCode((values) => { values[0] = 4_294_967_295; })).toBe('967295');
    expect(pairingCode()).toMatch(/^[0-9]{6}$/);
  });
});

describe('WhatsApp templates at Meta', () => {
  it('has one definition per message, with the parameters the database sends', () => {
    // Pořadí parametrů skládá `claim_whatsapp_deliveries`; počet ukázek tedy musí sedět s {{n}}
    // v textu, jinak Meta šablonu odmítne — nebo, hůř, schválí a zpráva vyjde s prohozenými údaji.
    expect(TEMPLATE_DEFINITIONS.map((definition) => definition.template).sort()).toEqual(Object.keys(TEMPLATE_SECRETS).sort());
    for (const definition of TEMPLATE_DEFINITIONS) {
      const placeholders = [...definition.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
      expect(placeholders).toEqual(definition.example.map((_, index) => index + 1));
      // Meta odmítne ukázku s koncem řádku nebo tabulátorem, stejně jako `parameter()` v odesílání.
      for (const value of definition.example) expect(value).toBe(value.replace(/\s+/g, ' ').trim());
      expect(definition.name).toMatch(/^[a-z0-9_]{1,512}$/);
    }
    // Tlačítka má jen žádost pro podnik: jen u ní `templateMessage` posílá dvě rychlé odpovědi.
    expect(TEMPLATE_DEFINITIONS.filter((definition) => definition.buttons).map((definition) => definition.template)).toEqual(['business_request']);
    expect(TEMPLATE_DEFINITIONS.find((definition) => definition.template === 'business_request')?.buttons).toEqual(['Potvrdit', 'Nemohu přijmout']);
  });

  it('builds the request Meta accepts', () => {
    const request = TEMPLATE_DEFINITIONS.find((definition) => definition.template === 'business_request')!;
    expect(templateCreatePayload(request, 'flek_booking_request', 'cs')).toEqual({
      name: 'flek_booking_request',
      language: 'cs',
      category: 'UTILITY',
      components: [
        { type: 'BODY', text: request.body, example: { body_text: [['dnes 14:30', 'Pánský střih (45 min)', '750 Kč', '14:08']] } },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Potvrdit' }, { type: 'QUICK_REPLY', text: 'Nemohu přijmout' }] },
      ],
    });
    // Zpráva bez tlačítek je jen tělo; název může přebít tajný klíč, kdyby šablona u Mety už byla.
    const confirmed = TEMPLATE_DEFINITIONS.find((definition) => definition.template === 'customer_confirmed')!;
    const payload = templateCreatePayload(confirmed, 'flek_customer_confirmed_v2', 'cs');
    expect(payload.components).toHaveLength(1);
    expect(payload.name).toBe('flek_customer_confirmed_v2');
  });
});
