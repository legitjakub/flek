import { describe, expect, it } from 'vitest';
import { SERVICE_PLACEHOLDER, serviceIllustration } from '../src/lib/serviceIllustrations';

/**
 * A service shows the most specific picture there is. A venue's general cover is not one of them:
 * it made a bike rental look like whatever the venue's cover happened to show.
 */
describe('serviceIllustration', () => {
  it('prefers the photo the merchant chose for the service', () => {
    expect(serviceIllustration('Padel 60 min', '/images/services/massage-prague.jpg', null)).toBe('/images/services/massage-prague.jpg');
  });

  it('falls back to the prepared picture of the activity, matched without diacritics', () => {
    expect(serviceIllustration('Padel 60 min')).toBe('/images/services/padel-prague.jpg');
    expect(serviceIllustration('Osobní trénink')).toBe('/images/services/personal-training-prague.jpg');
  });

  it('uses the universal FLEK picture instead of an unrelated venue cover', () => {
    expect(serviceIllustration('Půjčení kola', null, '/images/services/tennis-prague.jpg')).toBe(SERVICE_PLACEHOLDER);
  });
});
