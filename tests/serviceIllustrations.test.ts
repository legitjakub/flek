import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVITY_GALLERIES, ACTIVITY_LABELS } from '../src/lib/activityGalleries';
import { isIllustrativeServiceImage, SERVICE_PLACEHOLDER, serviceIllustration } from '../src/lib/serviceIllustrations';

/**
 * A service shows the most specific picture there is. A venue's general cover is not one of them:
 * it made a bike rental look like whatever the venue's cover happened to show.
 */
describe('serviceIllustration', () => {
  it('prefers the photo the merchant chose for the service', () => {
    const upload = 'https://yupkrntknbkvmlajwlph.supabase.co/storage/v1/object/public/covers/business/services/real.jpg';
    expect(serviceIllustration('Padel 60 min', upload, null)).toBe(upload);
    expect(isIllustrativeServiceImage(upload)).toBe(false);
  });

  it('discloses prepared catalogue photos, but not a merchant upload', () => {
    expect(isIllustrativeServiceImage('/images/activities/sport-padel-1.jpg')).toBe(true);
    expect(isIllustrativeServiceImage('/images/services/padel-prague.jpg')).toBe(true);
    expect(isIllustrativeServiceImage(SERVICE_PLACEHOLDER)).toBe(false);
  });

  it('falls back to the prepared picture of the activity, matched without diacritics', () => {
    expect(serviceIllustration('Padel 60 min')).toBe('/images/activities/sport-padel-1.jpg');
    expect(serviceIllustration('Osobní trénink')).toBe('/images/activities/sport-osobni-trenink-1.jpg');
  });

  it('matches the other kinds of service by name, and not on fragments of unrelated words', () => {
    expect(serviceIllustration('Vinyasa jóga')).toBe('/images/activities/joga-vinyasa-1.jpg');
    expect(serviceIllustration('Privátní sauna')).toBe('/images/activities/wellness-privatni-sauna-1.jpg');
    expect(serviceIllustration('Relaxační masáž')).toBe('/images/activities/masaze-relaxacni-1.jpg');
    // "vlastní" is not "vlasy", and "trasa" is not "řasy".
    expect(serviceIllustration('Vlastní lekce na trase', null, null)).toBe(SERVICE_PLACEHOLDER);
  });

  it('falls back to a photo of the category before FLEK\'s own picture', () => {
    expect(serviceIllustration('Kurz lukostřelby', null, 'sport')).toBe('/images/services/group-class-prague.jpg');
    expect(serviceIllustration('Speciální balíček', null, 'krasa')).toMatch(/images\.unsplash\.com/);
    expect(serviceIllustration('Půjčení kola', null, 'neznama-kategorie')).toBe(SERVICE_PLACEHOLDER);
    expect(serviceIllustration('Půjčení kola')).toBe('/images/activities/sport-pujceni-kola-1.jpg');
  });

  it('has two real local pictures for every prepared activity', () => {
    expect(Object.keys(ACTIVITY_GALLERIES).sort()).toEqual(Object.keys(ACTIVITY_LABELS).sort());
    for (const photos of Object.values(ACTIVITY_GALLERIES)) {
      expect(photos).toHaveLength(2);
      for (const photo of photos) {
        expect(photo).toMatch(/^\/images\/activities\/[a-z0-9-]+-[12]\.jpg$/);
        expect(existsSync(join(process.cwd(), 'public', photo))).toBe(true);
        expect(existsSync(join(process.cwd(), 'public', photo.replace(/\.jpg$/, '-800.jpg')))).toBe(true);
        expect(existsSync(join(process.cwd(), 'public', photo.replace(/\.jpg$/, '-176.jpg')))).toBe(true);
      }
    }
  });
});
