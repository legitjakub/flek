import {
  ACCOUNT_INCLUDE, accountFlags, appOrigin, caller, type ConnectedAccount, isTestMode, json, message, preflight, serviceClient,
  Stripe, stripeClient, syncAccount, UUID,
} from '../_shared/stripe.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type Business = {
  id: string;
  display_name: string;
  public_email: string | null;
  stripe_account_id: string | null;
};

/**
 * Connects a business to Stripe so it can be paid.
 *   onboard        creates the business's Stripe account once (Accounts v2) and returns Stripe's onboarding link
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
      const accountId = business.stripe_account_id ?? (await createRecipientAccount(stripe, db, business));
      // Stripe requires HTTPS return addresses, so a local build returns to production.
      const origin = appOrigin(request).startsWith('https://') ? appOrigin(request) : 'https://flek-nine.vercel.app';
      const link = await stripe.v2.core.accountLinks.create({
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['recipient'],
            refresh_url: `${origin}/partner/provozovna?stripe=znovu`,
            return_url: `${origin}/partner/provozovna?stripe=hotovo`,
          },
        },
      });
      return json(request, { url: link.url });
    }

    if (action === 'status') {
      if (!business.stripe_account_id) return json(request, { connected: false });
      const account = await stripe.v2.core.accounts.retrieve(business.stripe_account_id, { include: ACCOUNT_INCLUDE });
      await syncAccount(db, business.id, account);
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

/**
 * Accounts v2, recipient configuration: the business receives transfers from FLEK's destination
 * charges, sees payouts in the Stripe Express dashboard, and Stripe collects its details in hosted
 * onboarding. FLEK pays Stripe's fees and carries negative balances, as destination charges require.
 */
async function createRecipientAccount(stripe: Stripe, db: SupabaseClient, business: Business) {
  const account = await stripe.v2.core.accounts.create(
    {
      contact_email: business.public_email ?? undefined,
      display_name: business.display_name,
      dashboard: 'express',
      identity: { country: 'cz' },
      defaults: {
        currency: 'czk',
        locales: ['cs-CZ'],
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
        profile: { product_description: 'Služby na místě rezervované přes FLEK' },
      },
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
      include: ACCOUNT_INCLUDE,
      metadata: { business_id: business.id },
    },
    { idempotencyKey: `flek-account-v2-${business.id}` },
  );
  await syncAccount(db, business.id, account);
  return account.id;
}

function summary(account: ConnectedAccount) {
  const f = accountFlags(account);
  return {
    connected: true,
    charges_enabled: f.charges,
    payouts_enabled: f.payouts,
    details_submitted: f.details,
    currently_due: f.due,
    disabled_reason: f.reason,
  };
}

/**
 * Test mode only. Demo businesses have no people behind them to go through onboarding, so each gets
 * a recipient account without a Stripe dashboard, where FLEK supplies the details itself: Stripe's
 * documented test values (1901-01-01 birth date, `address_full_match`, test IBAN), verified instantly.
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
      const email = `platby-${business.id.slice(0, 8)}@flek.test`;
      let account = business.stripe_account_id
        ? await stripe.v2.core.accounts.retrieve(business.stripe_account_id, { include: ACCOUNT_INCLUDE })
        : await stripe.v2.core.accounts.create(
          {
            contact_email: email,
            display_name: business.display_name,
            dashboard: 'none',
            identity: {
              country: 'cz',
              entity_type: 'individual',
              individual: {
                given_name: 'Demo',
                surname: 'Provozovna',
                email,
                phone: '+420777000000',
                date_of_birth: { day: 1, month: 1, year: 1901 },
                address: { line1: 'address_full_match', city: 'Praha', postal_code: '11000', country: 'cz' },
              },
              attestations: { terms_of_service: { account: { date: new Date().toISOString(), ip: '127.0.0.1' } } },
            },
            defaults: {
              currency: 'czk',
              responsibilities: { fees_collector: 'application', losses_collector: 'application' },
              profile: { business_url: 'https://flek-nine.vercel.app', product_description: `Demo provozovna ${business.display_name}` },
            },
            configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
            include: ACCOUNT_INCLUDE,
            metadata: { business_id: business.id, demo: 'true' },
          },
          { idempotencyKey: `flek-demo-account-v2-${business.id}` },
        );
      if (accountFlags(account).due.includes('external_account')) {
        // Stripe's Czech test IBAN, to which every test payout succeeds.
        await stripe.accounts.createExternalAccount(
          account.id,
          { external_account: { object: 'bank_account', country: 'CZ', currency: 'czk', account_number: 'CZ6508000000192000145399' } },
          { idempotencyKey: `flek-demo-bank-${account.id}` },
        );
        account = await stripe.v2.core.accounts.retrieve(account.id, { include: ACCOUNT_INCLUDE });
      }
      await syncAccount(db, business.id, account);
      results.push({ business: business.display_name, account: account.id, ...summary(account) });
    } catch (error) {
      results.push({ business: business.display_name, error: message(error) });
    }
  }
  return { businesses: results };
}
