/**
 * FLEK pricing, v1 — the browser's copy, for the live preview a merchant sees while typing.
 *
 * The server is the authority: private.flek_service_fee_cents computes the fee that is
 * charged, and publish_flek never accepts one from the client. This file exists so the
 * preview does not wait on a round trip per keystroke. tests/fixtures/fee-vector.json is
 * checked against both this file and the SQL, so the two cannot drift apart unnoticed.
 *
 *   merchant price   what the merchant enters and is paid
 *   service fee      5 % of it, at least 25 Kč and at most 149 Kč, rounded half up to a crown
 *   customer price   merchant price + service fee — the only price a customer ever sees
 */
export const FEE_POLICY_V1 = {
  version: 1,
  /** Basis points of the merchant price. */
  rateBps: 500,
  minCents: 2_500,
  maxCents: 14_900,
} as const;

/** A customer saves at least this much, measured on the final price. */
export const MIN_SAVING_PCT = 10;
/** Anything below this share of the regular price is treated as a typo. */
export const MIN_PRICE_PCT = 15;

/** The fee for a merchant price, in whole crowns; null for an amount that is not one. */
export function serviceFeeCents(merchantCents: number): number | null {
  if (!Number.isSafeInteger(merchantCents) || merchantCents <= 0 || merchantCents % 100 !== 0 || merchantCents > 2_147_468_700) return null;
  const crowns = merchantCents / 100;
  // (crowns × 5 + 50) div 100 — the same integer arithmetic as the SQL, rounding half up.
  const fee = Math.floor((crowns * (FEE_POLICY_V1.rateBps / 100) + 50) / 100) * 100;
  return Math.min(FEE_POLICY_V1.maxCents, Math.max(FEE_POLICY_V1.minCents, fee));
}

/** Savings are always measured against what the customer pays, never the merchant price. */
export function discountPct(regularCents: number, customerCents: number): number {
  if (regularCents <= 0) return 0;
  return Math.floor(((regularCents - customerCents) * 100) / regularCents);
}

export type Quote = {
  merchantCents: number;
  feeCents: number;
  customerCents: number;
  regularCents: number;
  savingCents: number;
  discountPct: number;
};

export function quote(merchantCents: number, regularCents: number): Quote | null {
  const feeCents = serviceFeeCents(merchantCents);
  if (feeCents === null) return null;
  const customerCents = merchantCents + feeCents;
  return {
    merchantCents,
    feeCents,
    customerCents,
    regularCents,
    savingCents: regularCents - customerCents,
    discountPct: discountPct(regularCents, customerCents),
  };
}

export type PriceProblem = 'no_saving' | 'saving_too_small' | 'price_too_low';

/** The same three rules publish_flek enforces, so the merchant hears about them first. */
export function priceProblem(q: Quote): PriceProblem | null {
  if (q.customerCents >= q.regularCents) return 'no_saving';
  if (q.customerCents * 100 > q.regularCents * (100 - MIN_SAVING_PCT)) return 'saving_too_small';
  if (q.customerCents * 100 < q.regularCents * MIN_PRICE_PCT) return 'price_too_low';
  return null;
}

/**
 * The highest merchant price at which the customer still saves `pct` percent of the regular
 * price — what the "Zákazník ušetří 30 %" chips fill in. The fee is not linear (floor, then
 * a 5 % band, then a cap), so this walks down from the linear estimate rather than inverting
 * a formula; the customer price rises strictly with the merchant price, so the first fit is
 * the best one.
 */
export function merchantPriceForSaving(regularCents: number, pct: number): number | null {
  if (!Number.isSafeInteger(regularCents) || regularCents <= 0 || regularCents > 2_147_483_647 || !Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;
  const ceilingCents = Math.floor((regularCents * (100 - pct)) / 100);
  for (let crowns = Math.floor(ceilingCents / 100); crowns > 0; crowns -= 1) {
    const merchantCents = crowns * 100;
    const q = quote(merchantCents, regularCents);
    if (q && q.customerCents <= ceilingCents) return merchantCents;
  }
  return null;
}

/** The highest merchant price that still gives the customer the minimum saving. */
export function maxMerchantPrice(regularCents: number): number | null {
  return merchantPriceForSaving(regularCents, MIN_SAVING_PCT);
}
