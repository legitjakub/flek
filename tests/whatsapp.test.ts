import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  actionPayload, bookingRequestMessage, decisionReply, pairingReply, parseWebhook, textMessage, timingSafeEqual, verifySignature,
} from '../supabase/functions/_shared/whatsapp';
import { displayPhone, whatsappLink } from '../src/lib/phone';

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
    const message = bookingRequestMessage({
      to: '+420 777 123 456', token: 'tok_0123456789abcdefghij', when: 'dnes 14:30', service: 'Střih\n(45 min)', payout: '750 Kč', deadline: '14:08',
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
    expect(actionPayload(false, 'abc')).toBe('FLEK1.r.abc');
    expect(textMessage('+420777123456', 'Ahoj', 'wamid.TAP')).toMatchObject({ to: '420777123456', text: { body: 'Ahoj' }, context: { message_id: 'wamid.TAP' } });
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
    expect(pairingReply({ result: 'paired', business: 'Salon Petra' })).toMatch(/Salon Petra/);
    expect(pairingReply({ result: 'failed' })).toMatch(/nový/);
    expect(pairingReply({ result: 'blocked' })).toBeNull();
    expect(pairingReply({ result: 'ignored' })).toBeNull();
  });

  it('formats numbers for people and opens a chat without sending anything', () => {
    expect(displayPhone('+420777123456')).toBe('+420 777 123 456');
    expect(displayPhone('+4915123456789')).toBe('+4915123456789');
    expect(displayPhone(null)).toBe('');
    expect(whatsappLink('+420 222 333 444', 'FLEK 123456')).toBe('https://wa.me/420222333444?text=FLEK%20123456');
  });
});
