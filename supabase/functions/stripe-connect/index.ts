import { appOrigin, caller, isTestMode, json, message, preflight, serviceClient, Stripe, stripeClient, UUID } from '../_shared/stripe.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type Business = {
  id: string;
  display_name: string;
  public_email: string | null;
  stripe_account_id: string | null;
};

/**
 * Connects a business to Stripe so it can be paid.
 *   onboard        creates the business's Express account once and returns Stripe's onboarding link
 *   status         asks Stripe what the account may do and stores it
 *   dashboard      returns a one-time link to the business's Stripe Express dashboard (payouts)
 *   demo_accounts  admin, test mode only: gives every demo business a ready test account
 */
Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const who = await caller(request);
  if (!who) return json(request, { error: 'AUTH_REQUIRED' }, 401);
  const stripe = stripeClient();
  if (!stripe) return json(request, { error: 'PAYMENTS_NOT_CONFIGURED' }, 503);

  let action = '';
  let businessId = '';
  try {
    const body = await request.json();
    action = typeof body.action === 'string' ? body.action : '';
    businessId = typeof body.business_id === 'string' ? body.business_id : '';
  } catch {
    return json(request, { error: 'INVALID_REQUEST' }, 400);
  }
  const db = serviceClient();

  try {
    if (action === 'demo_accounts') {
      const { data: admin } = await who.client.rpc('is_admin');
      if (admin !== true) return json(request, { error: 'FORBIDDEN' }, 403);
      if (!isTestMode()) return json(request, { error: 'LIVE_MODE' }, 409);
      return json(request, await demoAccounts(stripe, db));
    }

    if (!UUID.test(businessId)) return json(request, { error: 'INVALID_REQUEST' }, 400);
    const { data: member } = await who.client.rpc('is_member_of', { p_business_id: businessId });
    if (member !== true) return json(request, { error: 'FORBIDDEN' }, 403);
    const { data: business } = await db
      .from('businesses')
      .select('id, display_name, public_email, stripe_account_id')
      .eq('id', businessId)
      .single<Business>();
    if (!business) return json(request, { error: 'NOT_FOUND' }, 404);

    if (action === 'onboard') {
      const accountId = business.stripe_account_id ?? (await createExpressAccount(stripe, db, business));
      const origin = appOrigin(request);
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        refresh_url: `${origin}/partner/provozovna?stripe=znovu`,
        return_url: `${origin}/partner/provozovna?stripe=hotovo`,
      });
      return json(request, { url: link.url });
    }

    if (action === 'status') {
      if (!business.stripe_account_id) return json(request, { connected: false });
      const account = await stripe.accounts.retrieve(business.stripe_account_id);
      await sync(db, business.id, account);
      return json(request, summary(account));
    }

    if (action === 'dashboard') {
      if (!business.stripe_account_id) return json(request, { error: 'NOT_CONNECTED' }, 409);
      const link = await stripe.accounts.createLoginLink(business.stripe_account_id);
      return json(request, { url: link.url });
    }

    return json(request, { error: 'INVALID_REQUEST' }, 400);
  } catch (error) {
    console.error('stripe-connect', action, message(error));
    return json(request, { error: 'STRIPE_REQUEST_FAILED', detail: message(error) }, 502);
  }
});

async function createExpressAccount(stripe: Stripe, db: SupabaseClient, business: Business) {
  const account = await stripe.accounts.create(
    {
      country: 'CZ',
      email: business.public_email ?? undefined,
      controller: {
        stripe_dashboard: { type: 'express' },
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        requirement_collection: 'stripe',
      },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { name: business.display_name, product_description: 'Služby na místě rezervované přes FLEK' },
      metadata: { business_id: business.id },
    },
    { idempotencyKey: `flek-account-${business.id}` },
  );
  await sync(db, business.id, account);
  return account.id;
}

async function sync(db: SupabaseClient, businessId: string, account: Stripe.Account) {
  const { error } = await db.rpc('stripe_account_synced', {
    p_business_id: businessId,
    p_account: account.id,
    p_charges: account.charges_enabled,
    p_payouts: account.payouts_enabled,
    p_details: account.details_submitted,
  });
  if (error) throw new Error(`stripe_account_synced: ${error.message}`);
}

function summary(account: Stripe.Account) {
  return {
    connected: true,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    details_submitted: account.details_submitted,
    currently_due: account.requirements?.currently_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
  };
}

/**
 * Test mode only. Demo businesses have no people behind them to go through onboarding, so each gets
 * an account whose details are Stripe's documented test values (1901-01-01 birth date,
 * `address_full_match`, Stripe's Czech test IBAN), which Stripe verifies instantly.
 */
async function demoAccounts(stripe: Stripe, db: SupabaseClient) {
  const { data: members, error } = await db.from('business_members').select('business_id, user_id');
  if (error) throw error;
  const users = await db.auth.admin.listUsers({ perPage: 1000 });
  if (users.error) throw users.error;
  const emailOf = new Map(users.data.users.map((user) => [user.id, user.email ?? '']));
  const byBusiness = new Map<string, string[]>();
  for (const row of members ?? []) {
    byBusiness.set(row.business_id, [...(byBusiness.get(row.business_id) ?? []), emailOf.get(row.user_id) ?? '']);
  }
  const demoIds = [...byBusiness.entries()]
    .filter(([, emails]) => emails.length > 0 && emails.every((email) => email.endsWith('@flek.test')))
    .map(([id]) => id);

  const { data: businesses } = await db
    .from('businesses')
    .select('id, display_name, public_email, stripe_account_id')
    .eq('status', 'approved')
    .in('id', demoIds);

  const results = [];
  for (const business of (businesses ?? []) as Business[]) {
    try {
      const account = business.stripe_account_id
        ? await stripe.accounts.retrieve(business.stripe_account_id)
        : await stripe.accounts.create(
          {
            country: 'CZ',
            email: `platby-${business.id.slice(0, 8)}@flek.test`,
            controller: {
              stripe_dashboard: { type: 'none' },
              fees: { payer: 'application' },
              losses: { payments: 'application' },
              requirement_collection: 'application',
            },
            capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
            business_type: 'individual',
            business_profile: {
              mcc: '7298',
              url: 'https://flek-nine.vercel.app',
              product_description: `Demo provozovna ${business.display_name}`,
            },
            individual: {
              first_name: 'Demo',
              last_name: 'Provozovna',
              email: `platby-${business.id.slice(0, 8)}@flek.test`,
              phone: '+420777000000',
              dob: { day: 1, month: 1, year: 1901 },
              address: { line1: 'address_full_match', city: 'Praha', postal_code: '11000', country: 'CZ' },
            },
            external_account: {
              object: 'bank_account',
              country: 'CZ',
              currency: 'czk',
              account_number: 'CZ6508000000192000145399',
            },
            tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
            metadata: { business_id: business.id, demo: 'true' },
          },
          { idempotencyKey: `flek-demo-account-${business.id}` },
        );
      await sync(db, business.id, account);
      results.push({ business: business.display_name, account: account.id, ...summary(account) });
    } catch (error) {
      results.push({ business: business.display_name, error: message(error) });
    }
  }
  return { businesses: results };
}
