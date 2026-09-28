import { describe, expect, it } from 'vitest';
import { verifyWithAnySecret } from '../supabase/functions/_shared/webhookSecrets';

// Stands in for Stripe's constructEventAsync: accepts only the secret the event was signed with.
const signedWith = (expected: string) => async (secret: string) => {
  if (secret !== expected) throw new Error('No signatures found matching the expected signature for payload');
  return { id: 'evt_1', signedBy: secret };
};

describe('Stripe webhook secrets', () => {
  it('accepts an event from the platform endpoint or from the Connect endpoint', async () => {
    expect(await verifyWithAnySecret(['whsec_platform', 'whsec_connect'], signedWith('whsec_platform'))).toEqual({ id: 'evt_1', signedBy: 'whsec_platform' });
    expect(await verifyWithAnySecret(['whsec_platform', 'whsec_connect'], signedWith('whsec_connect'))).toEqual({ id: 'evt_1', signedBy: 'whsec_connect' });
  });

  it('refuses a signature neither endpoint made', async () => {
    expect(await verifyWithAnySecret(['whsec_platform', 'whsec_connect'], signedWith('whsec_other'))).toBeNull();
  });

  it('works before the Connect secret is set, and never verifies against an empty secret', async () => {
    expect(await verifyWithAnySecret(['whsec_platform', undefined], signedWith('whsec_platform'))).not.toBeNull();
    expect(await verifyWithAnySecret([undefined, '', null], signedWith(''))).toBeNull();
  });
});
