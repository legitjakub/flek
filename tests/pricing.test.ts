import { describe, expect, it } from 'vitest';
import vector from './fixtures/fee-vector.json';
import {
  FEE_POLICY_V1,
  discountPct,
  maxMerchantPrice,
  merchantPriceForSaving,
  priceProblem,
  quote,
  serviceFeeCents,
} from '../src/lib/pricing';

const kc = (crowns: number) => crowns * 100;

describe('service fee v1', () => {
  it.each(vector.cases)('podnik $merchant Kč → poplatek $fee Kč, zákazník $customer Kč', ({ merchant, fee, customer }) => {
    const q = quote(kc(merchant), kc(10_000))!;
    expect(q.feeCents).toBe(kc(fee));
    expect(q.customerCents).toBe(kc(customer));
    // The merchant is paid exactly what they entered; FLEK's share sits on top of it.
    expect(q.merchantCents).toBe(kc(merchant));
    expect(q.customerCents).toBe(q.merchantCents + q.feeCents);
  });

  it('never goes below the minimum or above the maximum', () => {
    for (let crowns = 1; crowns <= 10_000; crowns += 1) {
      const fee = serviceFeeCents(kc(crowns))!;
      expect(fee).toBeGreaterThanOrEqual(FEE_POLICY_V1.minCents);
      expect(fee).toBeLessThanOrEqual(FEE_POLICY_V1.maxCents);
      expect(fee % 100).toBe(0);
    }
  });

  it('charges plain 5 % between the floor and the cap', () => {
    for (const crowns of [600, 800, 1_200, 2_400]) {
      expect(serviceFeeCents(kc(crowns))).toBe(kc(crowns * 0.05));
    }
  });

  it('rounds half up, consistently', () => {
    expect(serviceFeeCents(kc(750))).toBe(kc(38)); // 37.50
    expect(serviceFeeCents(kc(730))).toBe(kc(37)); // 36.50
    expect(serviceFeeCents(kc(729))).toBe(kc(36)); // 36.45
  });

  it('makes the customer price strictly increasing in the merchant price', () => {
    let previous = 0;
    for (let crowns = 1; crowns <= 6_000; crowns += 1) {
      const customer = quote(kc(crowns), kc(10_000))!.customerCents;
      expect(customer).toBeGreaterThan(previous);
      previous = customer;
    }
  });

  it('refuses amounts that are not whole crowns', () => {
    expect(serviceFeeCents(0)).toBeNull();
    expect(serviceFeeCents(-100)).toBeNull();
    expect(serviceFeeCents(12_345)).toBeNull();
    expect(serviceFeeCents(Infinity)).toBeNull();
    expect(serviceFeeCents(2_147_468_800)).toBeNull();
    expect(serviceFeeCents(2_147_468_700)).toBe(14_900);
  });
});

describe('customer savings', () => {
  it('are measured against the price the customer pays', () => {
    // Běžně 1 000 Kč, podnik chce 750 Kč → zákazník 788 Kč → ušetří 212 Kč, tedy 21 %, ne 25 %.
    const q = quote(kc(750), kc(1_000))!;
    expect(q.customerCents).toBe(kc(788));
    expect(q.savingCents).toBe(kc(212));
    expect(q.discountPct).toBe(21);
    expect(discountPct(kc(1_000), kc(750))).toBe(25); // what it would wrongly say against the merchant price
  });
});

describe('publishing rules mirrored from publish_flek', () => {
  it('refuses an offer the customer would pay the same or more for', () => {
    // Běžně 1 000 Kč, podnik chce 980 Kč → poplatek 49 Kč → zákazník 1 029 Kč.
    expect(priceProblem(quote(kc(980), kc(1_000))!)).toBe('no_saving');
  });

  it('refuses a saving under 10 %', () => {
    expect(priceProblem(quote(kc(900), kc(1_000))!)).toBe('saving_too_small'); // 945 Kč, 5 %
    expect(priceProblem(quote(kc(750), kc(1_000))!)).toBeNull();
  });

  it('refuses what looks like a typo', () => {
    expect(priceProblem(quote(kc(100), kc(1_000))!)).toBe('price_too_low'); // 125 Kč < 15 %
  });
});

describe('quick chips: "Zákazník ušetří X %"', () => {
  it('rejects invalid quick-discount inputs instead of looping or overflowing', () => {
    expect(merchantPriceForSaving(Infinity, 20)).toBeNull();
    expect(merchantPriceForSaving(100_000, NaN)).toBeNull();
    expect(merchantPriceForSaving(100_000, 101)).toBeNull();
    expect(merchantPriceForSaving(-100, 20)).toBeNull();
  });
  it.each([
    [1_000, 20],
    [1_000, 30],
    [1_000, 40],
    [550, 25],
    [300, 30],
    [3_500, 20],
  ])('běžně %i Kč, úspora %i %% → nejvyšší částka pro podnik, která to splní', (regular, pct) => {
    const merchant = merchantPriceForSaving(kc(regular), pct)!;
    const q = quote(merchant, kc(regular))!;
    expect(q.discountPct).toBeGreaterThanOrEqual(pct);
    // One crown more for the merchant and the customer would no longer save that much.
    expect(quote(merchant + 100, kc(regular))!.customerCents * 100).toBeGreaterThan(kc(regular) * (100 - pct));
  });

  it('knows the highest price a merchant can ask', () => {
    const merchant = maxMerchantPrice(kc(1_000))!;
    expect(priceProblem(quote(merchant, kc(1_000))!)).toBeNull();
    expect(priceProblem(quote(merchant + 100, kc(1_000))!)).toBe('saving_too_small');
  });
});
