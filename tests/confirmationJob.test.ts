import { describe, expect, it } from 'vitest';
import { captureStep, unpaidCheckoutStep } from '../supabase/functions/_shared/confirmationJob';

describe('confirmation worker decisions', () => {
  it('captures only when the database says the job is ready', () => {
    expect(captureStep('ready')).toBe('capture');
  });

  it('never ends an accepted request because another run took the job or the database did not answer', () => {
    for (const state of ['lease_lost', 'done', 'missing', null, undefined, 'something new']) {
      expect(captureStep(state)).toBe('skip');
    }
  });

  it('gives up only once the appointment has started, and releases a request that moved on', () => {
    expect(captureStep('started')).toBe('give_up');
    expect(captureStep('cancel_requested')).toBe('release');
    expect(captureStep('not_capturing')).toBe('release');
  });

  it('settles a request nobody paid for as released, and only then', () => {
    expect(unpaidCheckoutStep(null)).toEqual({ step: 'released' });
    expect(unpaidCheckoutStep({ status: 'expired', payment_intent: null })).toEqual({ step: 'released' });
    expect(unpaidCheckoutStep({ status: 'open', payment_intent: null })).toEqual({ step: 'retry' });
  });

  it('releases the authorisation of a page the customer finished just before it closed', () => {
    expect(unpaidCheckoutStep({ status: 'complete', payment_intent: 'pi_123' })).toEqual({ step: 'use_intent', intent: 'pi_123' });
    expect(unpaidCheckoutStep({ status: 'complete', payment_intent: null })).toEqual({ step: 'retry' });
  });
});
