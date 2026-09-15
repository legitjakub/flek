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

  it('matches the other kinds of service by name, and not on fragments of unrelated words', () => {
    expect(serviceIllustration('Ranní jóga')).toBe('/images/services/yoga-prague.jpg');
    expect(serviceIllustration('Privátní sauna')).toBe('/images/services/sauna-prague.jpg');
    expect(serviceIllustration('Relaxační masáž')).toMatch(/images\.unsplash\.com/);
    // "vlastní" is not "vlasy", and "trasa" is not "řasy".
    expect(serviceIllustration('Vlastní lekce na trase', null, null)).toBe(SERVICE_PLACEHOLDER);
  });

  it('falls back to a photo of the category before FLEK\'s own picture', () => {
    expect(serviceIllustration('Kurz lukostřelby', null, 'sport')).toBe('/images/services/group-class-prague.jpg');
    expect(serviceIllustration('Speciální balíček', null, 'krasa')).toMatch(/images\.unsplash\.com/);
    expect(serviceIllustration('Půjčení kola', null, 'neznama-kategorie')).toBe(SERVICE_PLACEHOLDER);
    expect(serviceIllustration('Půjčení kola')).toBe(SERVICE_PLACEHOLDER);
  });
});
