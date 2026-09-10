import { describe, expect, it } from 'vitest';
import { offerDiscountError, offerDiscountPct } from '../src/features/merchant/CreateOfferSheet';

describe('offer pricing', () => {
  it('accepts the inclusive 10–85 percent discount range', () => {
    expect(offerDiscountError(100_000, 90_000)).toBeUndefined();
    expect(offerDiscountError(100_000, 15_000)).toBeUndefined();
  });

  it('rejects a price that is too close to or too far below the original', () => {
    expect(offerDiscountError(100_000, 91_000)).toContain('aspoň 10 %');
    expect(offerDiscountError(100_000, 14_000)).toContain('přesáhnout 85 %');
  });

  it('derives the customer-facing discount from the two offer prices', () => {
    expect(offerDiscountPct(65_000, 52_000)).toBe(20);
    expect(offerDiscountPct(25_000, 16_200)).toBe(35);
  });
});
