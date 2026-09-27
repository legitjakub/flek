import { describe, expect, it } from 'vitest';
import { isMetaTestNumber, metaBlockers, metaCanSend } from '../src/features/admin/whatsappHealth';

// The answer Meta gave for FLEK's account on 25. 9. 2026, trimmed to what matters.
const blocked = {
  account: {
    name: 'Test WhatsApp Business Account', account_review_status: 'APPROVED', business_verification_status: 'pending_submission', ownership_type: 'SELF',
    health: {
      can_send_message: 'BLOCKED',
      entities: [
        { entity_type: 'WABA', can_send_message: 'BLOCKED', errors: [{ error_code: 141006, error_description: 'There is an error with the payment method.' }] },
        {
          entity_type: 'BUSINESS', can_send_message: 'BLOCKED',
          errors: [{ error_code: 141010, error_description: 'The Business has not passed business verification.' }, { error_code: 131000, error_description: 'Your business profile is incomplete.' }],
        },
        { entity_type: 'APP', can_send_message: 'AVAILABLE' },
      ],
    },
  },
  phone_health: {
    can_send_message: 'BLOCKED',
    entities: [
      { entity_type: 'PHONE_NUMBER', can_send_message: 'AVAILABLE', errors: [{ error_code: 138024, error_description: 'SIP not enabled' }] },
      { entity_type: 'WABA', can_send_message: 'BLOCKED', errors: [{ error_code: 141006, error_description: 'There is an error with the payment method.' }] },
    ],
  },
};

describe('metaBlockers', () => {
  it('names each blocker once, in Czech, business info first, calling left out', () => {
    const blockers = metaBlockers(blocked);
    expect(blockers.map((blocker) => blocker.code)).toEqual([131000, 141006, 141010]);
    expect(blockers[0].title).toBe('Profil firmy u Mety není úplný');
    expect(blockers[1].fix).toContain('Přidat platební metodu');
    expect(blockers[2].fix).toContain('Ověření firmy');
    expect(metaCanSend(blocked)).toBe(false);
  });

  it('passes an unknown error through with Meta\'s own words', () => {
    const blockers = metaBlockers({ account: { name: null, account_review_status: null, business_verification_status: null, ownership_type: null, health: { can_send_message: 'LIMITED', entities: [{ can_send_message: 'LIMITED', errors: [{ error_code: 1, error_description: 'Something new', possible_solution: 'Do this' }] }] } } });
    expect(blockers).toEqual([{ code: 1, title: 'Something new', fix: 'Do this' }]);
  });

  it('lets FLEK send only when both the account and the number may', () => {
    const fine = { account: { name: null, account_review_status: 'APPROVED', business_verification_status: 'verified', ownership_type: 'SELF', health: { can_send_message: 'AVAILABLE', entities: [] } }, phone_health: { can_send_message: 'AVAILABLE', entities: [] } };
    expect(metaCanSend(fine)).toBe(true);
    expect(metaBlockers(fine)).toEqual([]);
    expect(metaCanSend({ account: { error: 'HTTP 400' } })).toBe(false);
  });
});

describe('isMetaTestNumber', () => {
  it('recognises Meta\'s test number and leaves a real one alone', () => {
    expect(isMetaTestNumber({ verified_name: 'Test Number', display_phone_number: '+1 555-156-7838' })).toBe(true);
    expect(isMetaTestNumber({ verified_name: 'FLEK', display_phone_number: '+1 555-010-9999' })).toBe(true);
    expect(isMetaTestNumber({ verified_name: 'FLEK', display_phone_number: '+420 777 123 456' })).toBe(false);
    expect(isMetaTestNumber(null)).toBe(false);
  });
});
