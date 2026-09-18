// End-to-end acceptance run against a real Supabase project, using only the public anon
// key and the demo accounts from supabase/seed.sql. No service-role key, so every call
// goes through real JWTs and real RLS — exactly what a browser would do.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/acceptance.mjs
//
// The script provisions its own offers through publish_flek and cancels them afterwards,
// leaving cancelled demo history (bookings/payments), not active test inventory.
// Run only in the demo environment, never against real customer accounts.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

/*
 * The project URL and anon key already live in .env.local, where Vite reads them. Requiring
 * them to be exported by hand as well produced the one failure this script must never have:
 * an error about missing configuration that is actually present, three lines above the real
 * work. Read the file, and let the environment override it when someone points the run at a
 * different project.
 */
function fromEnvFile(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
        })
        .filter(([key]) => key),
    );
  } catch {
    return {};
  }
}

const file = { ...fromEnvFile('.env'), ...fromEnvFile('.env.local') };
const URL_ = process.env.SUPABASE_URL || file.SUPABASE_URL || file.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || file.SUPABASE_ANON_KEY || file.VITE_SUPABASE_ANON_KEY;
const PASSWORD = process.env.DEMO_PASSWORD || file.DEMO_PASSWORD;
// The admin account is deliberately not on the shared demo password.
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || file.DEMO_ADMIN_PASSWORD || PASSWORD;

// Name what is missing and where to put it. "Set SUPABASE_URL" is useless advice when the
// value is sitting in .env.local under a different name.
const missing = [
  !URL_ && 'VITE_SUPABASE_URL (nebo SUPABASE_URL)',
  !ANON && 'VITE_SUPABASE_ANON_KEY (nebo SUPABASE_ANON_KEY)',
  !PASSWORD && 'DEMO_PASSWORD — heslo demo účtů ze supabase/seed.sql',
].filter(Boolean);
if (missing.length) {
  throw new Error(
    `Chybí:\n  - ${missing.join('\n  - ')}\n\n` +
      'Přidejte je do .env.local (jeden řádek KLÍČ=hodnota), nebo předejte v příkazu:\n' +
      '  DEMO_PASSWORD=... DEMO_ADMIN_PASSWORD=... npm run test:acceptance\n\n' +
      'Adresu projektu a anon klíč si skript vezme z .env.local sám.',
  );
}
const SERVICE_ID = '11d06bdf-8e9c-63c3-6bd3-3774c2773965'; // md5('flek-service-1'), Pánský střih
const MERCHANT_PRICE = 36500;
const CUSTOMER_PRICE = 39000;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const err = (e) => e?.message ?? '';
/*
 * Anonymous callers are stopped in one of two places: by the EXECUTE grant (PostgREST
 * reports 42501 and the function body never runs) or, where the grant exists, by the
 * function's own AUTH_REQUIRED. Both are correct refusals, so tests assert the outcome —
 * no data came back — rather than one particular layer.
 */
const refused = (res) => Boolean(res.error) && (res.data === null || res.data === undefined);

async function signIn(email) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = email.startsWith('demo-admin@') ? ADMIN_PASSWORD : PASSWORD;
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return { client, id: data.user.id, email };
}

const merchant = await signIn('demo-merchant@flek.test');
/*
 * Once the legal texts are published, a booking carries the version of the customer terms in force
 * and publishing needs the venue's consent to the merchant terms; the server records both. The demo
 * venue consents through the same RPC as the partner banner. While nothing is published, both are null.
 */
const legal = (await merchant.client.rpc('legal_info')).data;
const TERMS = legal?.documents?.customer_terms?.version ?? null;
const MERCHANT_TERMS = legal?.documents?.merchant_terms?.version ?? null;
if (MERCHANT_TERMS) {
  for (const venue of (await merchant.client.rpc('my_businesses')).data ?? []) {
    const accepted = await merchant.client.rpc('accept_merchant_terms', { p_business_id: venue.id, p_version: MERCHANT_TERMS });
    if (accepted.error) throw new Error(`accept_merchant_terms: ${accepted.error.message}`);
  }
}
const created = [];
try {
async function publish(capacity, minutesAhead = 180) {
  const start = new Date(Date.now() + minutesAhead * 60_000).toISOString();
  // 365 Kč for the merchant + the 25 Kč minimum fee = the 390 Kč customer price the rest of
  // this suite was written against.
  const { data, error } = await merchant.client.rpc('publish_flek', {
    p_service_id: SERVICE_ID,
    p_start_at: start,
    p_merchant_price_cents: MERCHANT_PRICE,
    p_capacity_total: capacity,
    p_booking_cutoff_at: new Date(Date.now() + (minutesAhead - 15) * 60_000).toISOString(),
    p_confirm_overlap: true,
  });
  if (error) throw new Error(`publish_flek: ${error.message}`);
  created.push(data.id);
  return data.id;
}


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls the customer's view of a payment until `done` says so, for Stripe's asynchronous webhook. */
async function waitPayment(client, paymentId, done, timeoutMs = 45_000) {
  const until = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < until) {
    last = (await client.rpc('my_payment_state', { p_payment_id: paymentId })).data;
    if (last && done(last)) return last;
    await sleep(750);
  }
  return last;
}

/**
 * Pays a started payment the way a customer would: Stripe charges the test card through
 * stripe-test-pay and the webhook marks it paid and books the seat (or asks for a refund).
 */
async function settle(client, paymentId, paymentMethod = 'pm_card_visa') {
  const { error } = await client.functions.invoke('stripe-test-pay', { body: { payment_id: paymentId, payment_method: paymentMethod } });
  if (error) {
    const body = await error.context?.json?.().catch(() => null);
    return { data: null, error: new Error(body?.error ?? error.message) };
  }
  const state = await waitPayment(client, paymentId, (x) => x.status !== 'pending');
  if (!state || state.status === 'pending') return { data: null, error: new Error('WEBHOOK_TIMEOUT') };
  return { data: { ...state, id: paymentId }, error: null };
}

/**
 * A payment that waits for the venue: the test card is only authorised, exactly as Checkout would do it,
 * and the webhook opens the venue's window. Resolves once the request left pending_payment.
 */
async function authorise(client, paymentId, paymentMethod = 'pm_card_visa') {
  const { data, error } = await client.functions.invoke('stripe-test-pay', { body: { payment_id: paymentId, payment_method: paymentMethod } });
  if (error) {
    const body = await error.context?.json?.().catch(() => null);
    return { data: null, error: new Error(body?.error ?? error.message) };
  }
  if (data?.status === 'declined') return { data: { declined: true }, error: null };
  const state = await waitPayment(client, paymentId, (x) => x.booking_status && x.booking_status !== 'pending_payment');
  if (!state || state.booking_status === 'pending_payment') return { data: null, error: new Error('WEBHOOK_TIMEOUT') };
  return { data: state, error: null };
}

/** Until the request ends one way or the other: a reservation code, or a final status without one. */
async function waitOutcome(client, paymentId, timeoutMs = 60_000) {
  return waitPayment(client, paymentId, (x) => Boolean(x.reservation_code) || !['pending_payment', 'pending_merchant', 'capturing'].includes(x.booking_status), timeoutMs);
}

/** The whole confirmation flow for one payment: authorise, the venue confirms, the server captures and books. */
async function confirmAndBook(client, paymentId, paymentMethod = 'pm_card_visa') {
  const requested = await authorise(client, paymentId, paymentMethod);
  if (requested.error) return requested;
  if (requested.data.declined) return { data: null, error: new Error('CARD_DECLINED') };
  if (requested.data.booking_status === 'pending_merchant') {
    const decision = await merchant.client.rpc('respond_to_booking', { p_booking_id: requested.data.booking_id, p_accept: true });
    if (decision.error) return decision;
  }
  const done = await waitOutcome(client, paymentId);
  if (!done?.reservation_code) return { data: null, error: new Error(`CONFIRMATION_${done?.booking_status ?? 'TIMEOUT'}`) };
  return { data: [{ booking_id: done.booking_id, reservation_code: done.reservation_code, payment_id: paymentId }], error: null };
}

/** Booking now requires settled money, so every attempt goes through the payment first. */
async function book(client, offerId) {
  const started = await client.rpc('start_payment', { p_offer_id: offerId, p_terms_version: TERMS });
  if (started.error) return started;
  // With the venue's confirmation switched on, start_payment already holds the seat.
  if (started.data.confirmation_version === 1) return confirmAndBook(client, started.data.id);
  const settled = await settle(client, started.data.id);
  if (settled.error) return settled;
  const result = await client.rpc('create_booking', { p_offer_id: offerId, p_payment_id: settled.data.id });
  if (result.error) await client.rpc('release_unbooked_payment', { p_payment_id: settled.data.id });
  return result;
}

const users = await Promise.all(
  ['demo-5', 'demo-6', 'demo-7', 'demo-8', 'demo-9', 'demo-10', 'demo-11', 'demo-12', 'demo-customer', 'demo-merchant2']
    .map((n) => signIn(`${n}@flek.test`)),
);
check('Přihlášení 10 účtů skutečnými JWT', users.length === 10);

const offerA = await publish(1);
const offerB = await publish(5);
const offerC = await publish(1);
check('Partner zveřejní nabídku přes publish_flek', created.length === 3);
if (TERMS) {
  check('Platba bez souhlasu s platnými podmínkami nezačne',
    err((await users[0].client.rpc('start_payment', { p_offer_id: offerA })).error).includes('TERMS_OUTDATED'));
}
// The rollout switch decides per venue whether new bookings wait for its confirmation; the demo venue follows it.
const MANUAL = (await merchant.client.rpc('confirmation_quote', { p_offer_id: offerA })).data?.manual === true;
console.log(MANUAL ? 'Režim: rezervace potvrzuje podnik (autorizace → potvrzení → stržení)' : 'Režim: rezervace bez potvrzení podniku');

// --- concurrency: the failure that would destroy merchant trust permanently
const raceA = await Promise.all(users.map((u) => book(u.client, offerA)));
const okA = raceA.filter((r) => !r.error);
check('capacity=1, 10 souběžných uživatelů: právě 1 uspěje', okA.length === 1,
  `úspěchů ${okA.length}, OFFER_UNAVAILABLE ${raceA.filter((r) => err(r.error).includes('OFFER_UNAVAILABLE')).length}`);
check('Kód má tvar FLEK-XXXXXX bez zaměnitelných znaků',
  /^FLEK-[2346789ABCDEFGHJKLMNPQRTUVWXYZ]{6}$/.test(okA[0]?.data?.[0]?.reservation_code ?? ''),
  okA[0]?.data?.[0]?.reservation_code);

const raceB = await Promise.all(users.map((u) => book(u.client, offerB)));
check('capacity=5, 10 souběžných volání: právě 5 uspěje', raceB.filter((r) => !r.error).length === 5);

// A separate account, so the three-booking limit from the races above cannot mask this.
const tapper = await signIn('demo-admin@flek.test');
const dbl = await Promise.all([
  book(tapper.client, offerC),
  book(tapper.client, offerC),
]);
const okC = dbl.filter((r) => !r.error);
check('Dvojité klepnutí téhož uživatele: jedna rezervace', okC.length >= 1 && new Set(okC.map((r) => r.data?.[0]?.booking_id)).size === 1,
  dbl.map((r) => (r.error ? err(r.error) : 'ok')).join(' / '));

const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const soldOut = await anon.rpc('get_offer_detail', { p_offer_id: offerA, p_lat: null, p_lng: null });
check('Vyprodaná nabídka přestane být rezervovatelná', soldOut.data.bookable === false && soldOut.data.capacity_remaining === 0);

// --- authorization, as real JWTs rather than the service role
check('Zákazník nevidí cizí rezervace',
  ((await users[1].client.from('bookings').select('*').eq('customer_id', users[0].id)).data ?? []).length === 0);
check('Zákazník vidí jen svůj profil',
  ((await users[1].client.from('profiles').select('*')).data ?? []).length <= 1);
check('Klient nemůže zapsat capacity_remaining',
  ((await users[0].client.from('offers').update({ capacity_remaining: 99 }).eq('id', offerA).select()).data ?? []).length === 0);
check('Klient nemůže vložit rezervaci přímo',
  Boolean((await users[0].client.from('bookings').insert({
    offer_id: offerA, business_id: '00000000-0000-0000-0000-000000000000', customer_id: users[0].id,
    reservation_code: 'FLEK-FORGED', price_cents: 100, service_name_snapshot: 'x', business_name_snapshot: 'x',
    business_address_snapshot: 'x', start_at_snapshot: new Date().toISOString(),
    end_at_snapshot: new Date().toISOString(), original_price_cents_snapshot: 100,
  })).error));
check('admin_metrics odmítne neadmina', err((await users[0].client.rpc('admin_metrics')).error).includes('FORBIDDEN'));
check('Neadmin nepřečte analytics_events',
  ((await users[0].client.from('analytics_events').select('*')).data ?? []).length === 0);
check('Anonym nevidí neschválené provozovny',
  ((await anon.from('businesses').select('*').eq('status', 'pending')).data ?? []).length === 0);
check('Anonym nevidí žádné rezervace', ((await anon.from('bookings').select('*')).data ?? []).length === 0);

// --- merchant side
const biz = await merchant.client.rpc('my_businesses');
const businessId = biz.data?.[0]?.id;
check('Partner vidí svoji provozovnu', Boolean(businessId), biz.data?.[0]?.display_name);
const code = okA[0].data[0].reservation_code;
const lookup = await merchant.client.rpc('merchant_lookup_booking', { p_code: code });
check('Partner najde rezervaci podle kódu', lookup.data?.reservation_code === code, lookup.data?.customer_label);
check('Jméno je v seznamu zkrácené, telefon jen v detailu vlastní rezervace',
  /^\S+ \S\.$/.test(lookup.data?.customer_label ?? '') && Boolean(lookup.data?.phone));
check('Cizí partner kód nenajde',
  (await users[9].client.rpc('merchant_lookup_booking', { p_code: code })).data === null);
check('Nedorazil před začátkem termínu je odmítnut',
  err((await merchant.client.rpc('merchant_resolve_booking', { p_booking_id: okA[0].data[0].booking_id, p_outcome: 'no_show' })).error).includes('TOO_EARLY'));
const metrics = await merchant.client.rpc('merchant_metrics', { p_business_id: businessId });
check('merchant_metrics odpoví partnerovi', typeof metrics.data?.recovered_cents === 'number',
  `získaná tržba ${metrics.data?.recovered_cents} h`);
check('merchant_metrics odmítne cizího',
  err((await users[0].client.rpc('merchant_metrics', { p_business_id: businessId })).error).includes('FORBIDDEN'));

// --- admin
const adminUser = await signIn('demo-admin@flek.test');
const adminMetrics = await adminUser.client.rpc('admin_metrics');
check('admin_metrics odpoví adminovi', typeof adminMetrics.data?.published_capacity === 'number',
  `kapacita ${adminMetrics.data?.published_capacity}, dokončeno ${adminMetrics.data?.completed}`);
// The queue may legitimately be empty; what must hold is that the admin can read it and
// nobody else can. (This used to assert "at least one pending venue" — a fact about the data.)
const queue = await adminUser.client.rpc('admin_businesses', { p_status: 'pending' });
check('admin_businesses vrátí frontu ke schválení', !queue.error && Array.isArray(queue.data), `${queue.data?.length ?? '?'} čeká`);
check('admin_businesses odmítne běžného uživatele',
  refused(await users[0].client.rpc('admin_businesses', { p_status: 'pending' })));

// --- cancellation puts the seat back on the market with no job running
const before = await anon.rpc('get_offer_detail', { p_offer_id: offerC, p_lat: null, p_lng: null });
const cancel = await tapper.client.rpc('cancel_booking', { p_booking_id: okC[0].data[0].booking_id });
const after = await anon.rpc('get_offer_detail', { p_offer_id: offerC, p_lat: null, p_lng: null });
check('Zrušení vrátí kapacitu a nabídku do prodeje',
  !cancel.error && before.data.capacity_remaining === 0 && after.data.capacity_remaining === 1 && after.data.bookable === true,
  `před ${before.data.capacity_remaining} → po ${after.data.capacity_remaining}`);

// --- money before seat
// tapper released its only booking in the cancellation check above, so it is not sitting
// at the three-booking limit — which would mask the payment errors this block is about.
const payer = tapper;
if (!MANUAL) {
  const payOffer = await publish(1, 200);
  const attempt = await payer.client.rpc('start_payment', { p_offer_id: payOffer, p_terms_version: TERMS });
  check('Platba se otevře s konečnou cenou z nabídky', !attempt.error && attempt.data.amount_cents === CUSTOMER_PRICE,
    `${attempt.data?.amount_cents} h, stav ${attempt.data?.status}`);
  check('Nezaplacená rezervace je odmítnuta',
    err((await payer.client.rpc('create_booking', { p_offer_id: payOffer, p_payment_id: attempt.data.id })).error).includes('PAYMENT_REQUIRED'));
  const settledPay = await settle(payer.client, attempt.data.id);
  const paidBooking = await payer.client.rpc('create_booking', { p_offer_id: payOffer, p_payment_id: settledPay.data.id });
  check('Po zaplacení rezervace projde', !paidBooking.error);
  const replay = await payer.client.rpc('create_booking', { p_offer_id: payOffer, p_payment_id: settledPay.data.id });
  check('Opakování platby vrací původní rezervaci bez dalšího místa',
    !replay.error && replay.data?.[0]?.booking_id === paidBooking.data?.[0]?.booking_id);
  check('Cizí platbu nelze potvrdit', /NOT_FOUND|FORBIDDEN|PAYMENT_CLOSED/.test(err((await settle(users[2].client, settledPay.data.id)).error)));
  const payerBooking = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.offer_id === payOffer);
  check('Rezervace nese stav zaplaceno', payerBooking?.payment_status === 'paid', payerBooking?.payment_status);
  await payer.client.rpc('cancel_booking', { p_booking_id: payerBooking.id });
  // Stripe returns the money asynchronously; the row turns refunded once Stripe reports the refund succeeded.
  await waitPayment(payer.client, settledPay.data.id, (x) => x.status === 'refunded');
  const afterRefund = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.id === payerBooking.id);
  check('Zrušení vrátí peníze', afterRefund?.payment_status === 'refunded', afterRefund?.payment_status);

  // --- a refund that fails after it looked done is money not returned
  // On Stripe's test card pm_card_refundFail every refund starts as succeeded and fails a little later.
  const failOffer = await publish(1, 205);
  const failStart = await payer.client.rpc('start_payment', { p_offer_id: failOffer, p_terms_version: TERMS });
  const failPay = failStart.error ? { data: null } : await settle(payer.client, failStart.data.id, 'pm_card_refundFail');
  const failBooking = failPay.data
    ? await payer.client.rpc('create_booking', { p_offer_id: failOffer, p_payment_id: failPay.data.id })
    : { data: null };
  const failBookingId = failBooking.data?.[0]?.booking_id;
  if (failBookingId) await payer.client.rpc('cancel_booking', { p_booking_id: failBookingId });
  const failedRefund = failBookingId
    ? await waitPayment(payer.client, failPay.data.id, (x) => x.refund_status === 'failed', 180_000)
    : null;
  const failedBookingRow = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.id === failBookingId);
  check('Vratka, která selže, nezůstane jako vrácená',
    failedRefund?.refund_status === 'failed' && failedRefund?.status === 'paid' && failedBookingRow?.payment_status === 'paid',
    `platba ${failedRefund?.status ?? '?'}, vratka ${failedRefund?.refund_status ?? '?'}`);

} else {
  // --- the venue's confirmation: the money is only authorised until the venue says yes
  const payOffer = await publish(1, 200);
  const attempt = await payer.client.rpc('start_payment', { p_offer_id: payOffer, p_terms_version: TERMS });
  check('Platba se otevře s konečnou cenou a drží místo', !attempt.error && attempt.data.amount_cents === CUSTOMER_PRICE
    && (await anon.rpc('get_offer_detail', { p_offer_id: payOffer, p_lat: null, p_lng: null })).data?.capacity_remaining === 0,
    `${attempt.data?.amount_cents} h, stav ${attempt.data?.status}`);
  const heldRows = (await merchant.client.rpc('merchant_bookings', { p_business_id: businessId, p_from: null, p_until: null })).data ?? [];
  const held = heldRows.find((b) => b.payment_id === attempt.data.id || b.offer_id === payOffer);
  check('Neautorizovaný hold podnik nevyrušuje a kód nikde není', !held || (held.status === 'pending_payment' && !held.reservation_code && !held.authorized_at));
  check('Cizí platbu nelze autorizovat', /NOT_FOUND|FORBIDDEN|PAYMENT_CLOSED/.test(err((await authorise(users[2].client, attempt.data.id)).error)));
  const requested = await authorise(payer.client, attempt.data.id);
  check('Autorizace otevře podniku okno na potvrzení', requested.data?.booking_status === 'pending_merchant'
    && Date.parse(requested.data?.confirmation_expires_at) > Date.now() && !requested.data?.reservation_code,
    `${requested.data?.booking_status ?? err(requested.error)}, do ${requested.data?.confirmation_expires_at}`);
  const waitingRow = ((await merchant.client.rpc('merchant_bookings', { p_business_id: businessId, p_from: null, p_until: null })).data ?? [])
    .find((b) => b.id === requested.data?.booking_id);
  check('Podnik vidí žádost bez kódu a s částkou pro sebe', waitingRow?.status === 'pending_merchant' && !waitingRow?.reservation_code
    && waitingRow?.merchant_payout_cents === MERCHANT_PRICE);
  check('Zákazník žádost nerozhodne', /FORBIDDEN/.test(err((await payer.client.rpc('respond_to_booking', { p_booking_id: requested.data?.booking_id, p_accept: true })).error)));
  check('Cizí podnik žádost nerozhodne', /FORBIDDEN/.test(err((await users[9].client.rpc('respond_to_booking', { p_booking_id: requested.data?.booking_id, p_accept: true })).error)));

  // A, B, D: Potvrdit and Nemohu přijmout from two devices at once — exactly one decides, and it stays decided.
  const decisions = await Promise.all([
    merchant.client.rpc('respond_to_booking', { p_booking_id: requested.data?.booking_id, p_accept: true }),
    merchant.client.rpc('respond_to_booking', { p_booking_id: requested.data?.booking_id, p_accept: false }),
    merchant.client.rpc('respond_to_booking', { p_booking_id: requested.data?.booking_id, p_accept: true }),
  ]);
  const decided = decisions.filter((r) => r.data?.decided);
  check('Souběžné Potvrdit / Nemohu přijmout: rozhodne právě jedno', decided.length === 1 && decisions.every((r) => !r.error),
    decisions.map((r) => r.error ? err(r.error) : `${r.data.status}${r.data.decided ? '*' : ''}`).join(' / '));
  const outcome = await waitOutcome(payer.client, attempt.data.id);
  if (decided[0]?.data?.status === 'capturing') {
    check('Po potvrzení se platba strhne a vznikne rezervace s kódem', Boolean(outcome?.reservation_code) && outcome?.status === 'paid',
      `${outcome?.booking_status}, platba ${outcome?.status}`);
    const booked = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.id === outcome?.booking_id);
    check('Rezervace nese stav zaplaceno', booked?.payment_status === 'paid', booked?.payment_status);
    await payer.client.rpc('cancel_booking', { p_booking_id: booked.id });
    await waitPayment(payer.client, attempt.data.id, (x) => x.status === 'refunded');
    const refunded = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.id === booked.id);
    check('Zrušení potvrzené rezervace vrátí stržené peníze', refunded?.payment_status === 'refunded', refunded?.payment_status);
  } else {
    check('Po odmítnutí se autorizace uvolní, nic se nevrací', outcome?.booking_status === 'rejected' && !outcome?.refund_requested,
      `${outcome?.booking_status}, vratka ${outcome?.refund_requested}`);
  }

  // Refusal: the seat returns once and the authorisation is released — never a refund.
  const refuseOffer = await publish(1, 210);
  const refusePay = await payer.client.rpc('start_payment', { p_offer_id: refuseOffer, p_terms_version: TERMS });
  const refuseReq = refusePay.error ? refusePay : await authorise(payer.client, refusePay.data.id);
  const refusal = await merchant.client.rpc('respond_to_booking', { p_booking_id: refuseReq.data?.booking_id, p_accept: false });
  const released = await waitPayment(payer.client, refusePay.data?.id, (x) => x.status === 'failed', 60_000);
  check('Nemohu přijmout: místo zpět, blokace uvolněna, žádná vratka',
    refusal.data?.status === 'rejected' && released?.status === 'failed' && !released?.refund_requested
    && (await anon.rpc('get_offer_detail', { p_offer_id: refuseOffer, p_lat: null, p_lng: null })).data?.capacity_remaining === 1,
    `${refusal.data?.status ?? err(refusal.error)}, platba ${released?.status}`);

  // C: the customer withdraws while the venue confirms — one of them wins, and the seat is counted once.
  const raceOffer = await publish(1, 215);
  const racePay = await payer.client.rpc('start_payment', { p_offer_id: raceOffer, p_terms_version: TERMS });
  const raceReq = racePay.error ? racePay : await authorise(payer.client, racePay.data.id);
  const [confirmRace, cancelRace] = await Promise.all([
    merchant.client.rpc('respond_to_booking', { p_booking_id: raceReq.data?.booking_id, p_accept: true }),
    payer.client.rpc('cancel_pending_booking', { p_booking_id: raceReq.data?.booking_id }),
  ]);
  const raceEnd = await waitOutcome(payer.client, racePay.data?.id);
  const raceSeats = (await anon.rpc('get_offer_detail', { p_offer_id: raceOffer, p_lat: null, p_lng: null })).data?.capacity_remaining;
  check('Souběh Potvrdit × Zrušit žádost skončí jedním stavem a správnou kapacitou',
    (raceEnd?.reservation_code && raceSeats === 0) || (raceEnd?.booking_status === 'cancelled_by_customer' && raceSeats === 1),
    `potvrzení ${confirmRace.data?.status ?? err(confirmRace.error)}, zrušení ${cancelRace.data ?? err(cancelRace.error)} → ${raceEnd?.booking_status}, místa ${raceSeats}`);
  if (raceEnd?.reservation_code) await payer.client.rpc('cancel_booking', { p_booking_id: raceEnd.booking_id });

  // A declined card authorises nothing: the seat stays held only until the customer gives up.
  const declineOffer = await publish(1, 220);
  const declinePay = await payer.client.rpc('start_payment', { p_offer_id: declineOffer, p_terms_version: TERMS });
  const declined = declinePay.error ? declinePay : await authorise(payer.client, declinePay.data.id, 'pm_card_chargeDeclined');
  const afterDecline = await payer.client.rpc('my_payment_state', { p_payment_id: declinePay.data?.id });
  check('Zamítnutá karta nic neblokuje a podnik nic nerozhoduje',
    declined.data?.declined === true && afterDecline.data?.booking_status === 'pending_payment' && !afterDecline.data?.authorized_at,
    `${declined.data?.declined ? 'zamítnuto' : err(declined.error)}, ${afterDecline.data?.booking_status}`);
  const withdrawn = await payer.client.rpc('cancel_pending_booking', { p_booking_id: afterDecline.data?.booking_id });
  check('Zákazník hold po zamítnuté kartě pustí a místo je zpět', withdrawn.data === 'cancelled_by_customer'
    && (await anon.rpc('get_offer_detail', { p_offer_id: declineOffer, p_lat: null, p_lng: null })).data?.capacity_remaining === 1,
    withdrawn.data ?? err(withdrawn.error));

  // A refund that fails after it looked done is money not returned, captured money included.
  const failOffer = await publish(1, 205);
  const failStart = await payer.client.rpc('start_payment', { p_offer_id: failOffer, p_terms_version: TERMS });
  const failBooked = failStart.error ? failStart : await confirmAndBook(payer.client, failStart.data.id, 'pm_card_refundFail');
  const failBookingId = failBooked.data?.[0]?.booking_id;
  if (failBookingId) await payer.client.rpc('cancel_booking', { p_booking_id: failBookingId });
  const failedRefund = failBookingId
    ? await waitPayment(payer.client, failStart.data.id, (x) => x.refund_status === 'failed', 180_000)
    : null;
  const failedBookingRow = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.id === failBookingId);
  check('Vratka, která selže, nezůstane jako vrácená',
    failedRefund?.refund_status === 'failed' && failedRefund?.status === 'paid' && failedBookingRow?.payment_status === 'paid',
    `platba ${failedRefund?.status ?? err(failBooked.error) ?? '?'}, vratka ${failedRefund?.refund_status ?? '?'}`);
}

// --- the venue sets its own free-cancellation window, and the booking keeps the one it was made under
const bizWindow = (await merchant.client.rpc('my_businesses')).data?.[0]?.cancellation_window_minutes;
check('Provozovna nese lhůtu pro bezplatné zrušení', typeof bizWindow === 'number', `${bizWindow} min`);
check('Lhůtu mimo rozsah nelze uložit',
  err((await merchant.client.rpc('update_business', { p_business_id: businessId, p_data: { cancellation_window_minutes: 99999 } })).error).includes('INVALID_CANCELLATION_WINDOW'));
const widened = await merchant.client.rpc('update_business', { p_business_id: businessId, p_data: { cancellation_window_minutes: 180 } });
check('Partner si lhůtu nastaví', widened.data?.cancellation_window_minutes === 180);
const windowOffer = await publish(1, 400);
await book(payer.client, windowOffer);
const wb = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.offer_id === windowOffer);
check('Rezervace si lhůtu odnese jako snapshot', wb?.cancellation_window_minutes === 180, `${wb?.cancellation_window_minutes} min`);
const deadlineGap = Math.round((Date.parse(wb.start_at_snapshot) - Date.parse(wb.cancellation_deadline)) / 60000);
check('Lhůta se propíše do termínu pro zrušení', deadlineGap === 180, `${deadlineGap} min před začátkem`);
await merchant.client.rpc('update_business', { p_business_id: businessId, p_data: { cancellation_window_minutes: 60 } });
const wbAfter = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.id === wb.id);
check('Změna politiky nemění už uzavřenou rezervaci', wbAfter?.cancellation_window_minutes === 180,
  `${wbAfter?.cancellation_window_minutes} min`);
await payer.client.rpc('cancel_booking', { p_booking_id: wb.id });

// --- following a venue, and hearing about its next slot
const follower = users[2];
const followBiz = businessId;
check('Sledování se zapne a vypne týmž voláním',
  (await follower.client.rpc('toggle_favorite', { p_business_id: followBiz })).data === true &&
    (await follower.client.rpc('toggle_favorite', { p_business_id: followBiz })).data === false);
await follower.client.rpc('toggle_favorite', { p_business_id: followBiz });
await follower.client.rpc('mark_favorites_seen');
check('Po označení za přečtené nic nového nezbývá',
  (await follower.client.rpc('new_at_favorites_count')).data === 0);
const freshOffer = await publish(1, 500);
const countAfter = (await follower.client.rpc('new_at_favorites_count')).data;
check('Nový termín u sledovaného místa se objeví', countAfter >= 1, `${countAfter} nových`);
const freshList = (await follower.client.rpc('new_at_favorites', { p_limit: 20 })).data ?? [];
check('Seznam novinek obsahuje právě ten termín', freshList.some((o) => o.id === freshOffer));
check('Cizí novinky nikdo jiný nevidí',
  ((await users[3].client.rpc('new_at_favorites', { p_limit: 20 })).data ?? []).every((o) => o.id !== freshOffer));
check('Anonym na oblíbené nedosáhne',
  err((await anon.rpc('my_favorites')).error).length > 0);
await follower.client.rpc('mark_favorites_seen');
check('Otevření seznamu odznak vynuluje',
  (await follower.client.rpc('new_at_favorites_count')).data === 0);
await follower.client.rpc('toggle_favorite', { p_business_id: followBiz });

// --- ratings are earned by attendance, not collected
const customer = users[8]; // demo-customer, the account the seed gives history to
const history = (await customer.client.rpc('my_bookings')).data ?? [];
const done = history.find((b) => b.status === 'completed');
const open_ = history.find((b) => b.status === 'confirmed');
check('Zákazník má dokončenou rezervaci k ohodnocení', Boolean(done), done?.reservation_code);
check('Vlastní dokončenou rezervaci lze ohodnotit',
  !(await customer.client.rpc('rate_booking', { p_booking_id: done.id, p_rating: 5 })).error);
if (open_) {
  check('Nedokončenou rezervaci ohodnotit nelze',
    err((await customer.client.rpc('rate_booking', { p_booking_id: open_.id, p_rating: 5 })).error).includes('NOT_RATEABLE'));
}
check('Cizí rezervaci ohodnotit nelze',
  err((await users[0].client.rpc('rate_booking', { p_booking_id: done.id, p_rating: 1 })).error).includes('FORBIDDEN'));
check('Hodnocení mimo rozsah je odmítnuto',
  err((await customer.client.rpc('rate_booking', { p_booking_id: done.id, p_rating: 9 })).error).includes('VALIDATION_ERROR'));
check('Hodnocení se propíše zpět do rezervace',
  ((await customer.client.rpc('my_bookings')).data ?? []).find((b) => b.id === done.id)?.rating === 5);

// --- discovery never leaks unbookable inventory
const search = await anon.rpc('search_offers', {
  p_lat: 50.0875, p_lng: 14.4213, p_radius_m: 25000, p_category: null, p_from: new Date().toISOString(),
  p_until: null, p_min_discount_pct: 0, p_max_price_cents: null, p_sort: 'recommended', p_limit: 100, p_offset: 0,
});
check('Vyhledávání nevrací nedostupné nabídky',
  (search.data ?? []).every((r) => r.capacity_remaining > 0 && new Date(r.booking_cutoff_at) > new Date()),
  `${search.data?.length} nabídek`);
check('Vyprodaná nabídka zmizí z vyhledávání', !(search.data ?? []).some((r) => r.id === offerA));
check('Vyhledávání nese průměr hodnocení a jeho počet',
  (search.data ?? []).every((r) => typeof r.rating_count === 'number' && (r.rating_avg === null || Number(r.rating_avg) > 0)) &&
  (search.data ?? []).some((r) => r.rating_count > 0),
  `${(search.data ?? []).filter((r) => r.rating_count > 0).length} nabídek s hodnocením`);

/* ------------------------------------------------------------------ growth loop ---
 * Everything below runs through real JWTs and real RLS, like the rest of this file. The
 * rules being checked are enforced in the database, so a passing browser is not evidence.
 */
{

const BUSINESS_ID = (await customer.client.rpc('get_offer_detail', { p_offer_id: created[0] })).data?.business_id;

// --- following must be idempotent, because the auth replay calls it again ---
const wasFavorite = ((await customer.client.rpc('my_favorites')).data ?? []).some((f) => f.id === BUSINESS_ID);
await customer.client.rpc('set_favorite', { p_business_id: BUSINESS_ID, p_value: true });
await customer.client.rpc('set_favorite', { p_business_id: BUSINESS_ID, p_value: true });
check('Dvojí „sledovat" nechá podnik sledovaný',
  ((await customer.client.rpc('my_favorites')).data ?? []).some((f) => f.id === BUSINESS_ID));

await customer.client.rpc('set_favorite', { p_business_id: BUSINESS_ID, p_value: false });
await customer.client.rpc('set_favorite', { p_business_id: BUSINESS_ID, p_value: false });
check('Dvojí „přestat sledovat" nechá podnik nesledovaný',
  !((await customer.client.rpc('my_favorites')).data ?? []).some((f) => f.id === BUSINESS_ID));

const anonFollow = await anon.rpc('set_favorite', { p_business_id: BUSINESS_ID, p_value: true });
check('Nepřihlášený nemůže sledovat', refused(anonFollow), err(anonFollow.error));

const ghostFollow = await customer.client.rpc('set_favorite', {
  p_business_id: '00000000-0000-0000-0000-000000000000', p_value: true,
});
check('Neexistující podnik nelze sledovat', /NOT_FOUND/.test(err(ghostFollow.error)));
if (wasFavorite) await customer.client.rpc('set_favorite', { p_business_id: BUSINESS_ID, p_value: true });

// --- an unavailable offer must still be readable, and still not bookable ---
const soldOut = await anon.rpc('get_offer_detail', { p_offer_id: offerA, p_lat: null, p_lng: null });
check('Vyprodaná nabídka má stále veřejný detail', Boolean(soldOut.data?.id));
check('Vyprodaná nabídka není rezervovatelná', soldOut.data?.bookable === false);
check('Vyprodaná nabídka hlásí nulovou kapacitu', soldOut.data?.capacity_remaining === 0);

// --- customer metrics: value that can be defended ---
const myMetrics = (await customer.client.rpc('my_customer_metrics')).data;
check('Zákaznické metriky vracejí všechna pole',
  myMetrics && ['month_completed','month_saved_cents','all_time_completed','all_time_saved_cents','best_discount_pct']
    .every((k) => k in myMetrics));
const completedRows = ((await customer.client.rpc('my_bookings')).data ?? []).filter((b) => b.status === 'completed');
check('Počet započtených rezervací odpovídá skutečně proběhlým',
  myMetrics?.all_time_completed === completedRows.length,
  `${myMetrics?.all_time_completed} vs ${completedRows.length}`);
check('Úspora se počítá ze snapshotů rezervace',
  myMetrics?.all_time_saved_cents ===
    completedRows.reduce((sum, b) => sum + (b.original_price_cents_snapshot - b.price_cents), 0));
check('Zrušené ani nedostavené rezervace se do hodnoty nepočítají',
  ((await customer.client.rpc('my_bookings')).data ?? [])
    .filter((b) => b.status !== 'completed').length > 0 &&
  myMetrics?.all_time_completed === completedRows.length);
check('Nepřihlášený se k metrikám nedostane', refused(await anon.rpc('my_customer_metrics')));

// --- referral attribution ---
const refCode = (await customer.client.rpc('my_referral_code')).data;
check('Doporučující kód se vytvoří', typeof refCode === 'string' && refCode.length === 6);
check('Doporučující kód je stabilní', (await customer.client.rpc('my_referral_code')).data === refCode);
check('Platný kód jde přeložit i bez přihlášení',
  (await anon.rpc('resolve_referral_code', { p_code: refCode })).data?.valid === true);
check('Neexistující kód se netváří jako platný',
  (await anon.rpc('resolve_referral_code', { p_code: 'ZZZZZZ' })).data?.valid === false);
check('Sám sebe doporučit nelze',
  (await customer.client.rpc('claim_referral', { p_code: refCode })).data?.reason === 'self');
// The demo customer has bookings and an old account, which is exactly the case that must
// never be convertible into a "new referred user".
const otherUser = users[0];
const claimOld = await otherUser.client.rpc('claim_referral', { p_code: refCode });
check('Zavedený účet se nestane nově doporučeným',
  claimOld.data?.claimed === false && claimOld.data?.reason === 'not_a_new_account');
check('Nepřihlášený nemůže atribuci uplatnit',
  refused(await anon.rpc('claim_referral', { p_code: refCode })));
check('Cizí atribuční data nejsou čitelná',
  ((await otherUser.client.from('referrals').select('*')).data ?? []).length === 0);
const refStats = (await customer.client.rpc('my_referral_stats')).data;
check('Statistika doporučení vrací obě čísla',
  refStats && typeof refStats.invited === 'number' && typeof refStats.qualified === 'number');

// --- merchant follower count ---
const mMetrics = (await merchant.client.rpc('merchant_metrics', { p_business_id: BUSINESS_ID })).data;
check('Metriky podniku nesou počet sledujících', typeof mMetrics?.followers === 'number');
}


// ------------------------------------------------------------------------------------------
// Pricing v1: the merchant names their price, the server adds the fee, the customer pays the
// sum from the first screen to the booking — and nothing on the client can change the fee.
{
const vector = JSON.parse(readFileSync(new URL('../tests/fixtures/fee-vector.json', import.meta.url), 'utf8'));
const quotes = await Promise.all(vector.cases.map((c) => anon.rpc('flek_price_quote', { p_merchant_cents: c.merchant * 100 })));
const drift = vector.cases.filter((c, i) =>
  quotes[i].error || quotes[i].data.service_fee_cents !== c.fee * 100 || quotes[i].data.customer_price_cents !== c.customer * 100);
check('SQL a src/lib/pricing.ts dávají stejný poplatek pro celou tabulku', drift.length === 0,
  drift.length ? `liší se: ${drift.map((c) => c.merchant).join(', ')} Kč` : `${vector.cases.length} případů`);

const detail = (await anon.rpc('get_offer_detail', { p_offer_id: created[0], p_lat: null, p_lng: null })).data;
check('Nabídka nese rozpad a konečnou cenu',
  detail?.merchant_price_cents === MERCHANT_PRICE && detail?.service_fee_cents === 2500
  && detail?.deal_price_cents === CUSTOMER_PRICE && detail?.fee_policy_version === 1,
  `${detail?.merchant_price_cents} + ${detail?.service_fee_cents} = ${detail?.deal_price_cents}`);
check('Sleva se počítá z konečné ceny',
  detail?.discount_pct === Math.floor(((detail.original_price_cents - CUSTOMER_PRICE) * 100) / detail.original_price_cents),
  `${detail?.discount_pct} %`);

const regular = detail.original_price_cents;
const pubArgs = (merchantCents, extra = {}) => ({
  p_service_id: SERVICE_ID, p_start_at: new Date(Date.now() + 300 * 60_000).toISOString(),
  p_merchant_price_cents: merchantCents, p_capacity_total: 1,
  p_booking_cutoff_at: new Date(Date.now() + 285 * 60_000).toISOString(), p_confirm_overlap: true, ...extra,
});
check('Klient nemá jak poslat vlastní poplatek',
  refused(await merchant.client.rpc('publish_flek', pubArgs(MERCHANT_PRICE, { p_service_fee_cents: 100 }))));
check('Stará publish_offer je pro partnera zamčená',
  refused(await merchant.client.rpc('publish_offer', {
    p_service_id: SERVICE_ID, p_start_at: new Date(Date.now() + 300 * 60_000).toISOString(), p_deal_price_cents: 39000,
    p_capacity_total: 1, p_booking_cutoff_at: new Date(Date.now() + 285 * 60_000).toISOString(), p_confirm_overlap: true })));
check('Cena stejná nebo vyšší než běžná je odmítnuta',
  err((await merchant.client.rpc('publish_flek', pubArgs(regular))).error).includes('NO_CUSTOMER_SAVING'));
check('Úspora pod 10 % je odmítnuta',
  err((await merchant.client.rpc('publish_flek', pubArgs(regular - 5000))).error).includes('SAVING_TOO_SMALL'));
check('update_offer nepřijme zákaznickou cenu',
  err((await merchant.client.rpc('update_offer', { p_offer_id: created[1], p_data: { deal_price_cents: 10000 } })).error).includes('VALIDATION_ERROR'));

// One booking, followed through every surface that shows or charges its price.
const otherUser = users[0];
for (const id of created) await merchant.client.rpc('merchant_cancel_offer', { p_offer_id: id, p_reason: 'Úklid mezi testovacími scénáři.' });
const priced = await publish(2, 240);
const buyer = users.find((u) => u !== customer && u !== otherUser) ?? users[3];
const loser = users.find((u) => u !== buyer && u !== customer && u !== otherUser && u !== users[0]) ?? users[4];
if (!MANUAL) {
  const pay = await buyer.client.rpc('start_payment', { p_offer_id: priced, p_terms_version: TERMS });
  const paid = await settle(buyer.client, pay.data?.id);
  const simultaneous = await Promise.all(Array.from({ length: 8 }, () => buyer.client.rpc('create_booking', { p_offer_id: priced, p_payment_id: paid.data?.id })));
  const first = simultaneous[0];
  check('8 souběžných pokusů se stejnou platbou vrátí stejnou rezervaci', simultaneous.every(r => !r.error) && new Set(simultaneous.map(r => r.data?.[0]?.booking_id)).size === 1);
  check('Souběžné opakování odečte jen jedno místo', (await anon.rpc('get_offer_detail', { p_offer_id: priced })).data?.capacity_remaining === 1);
  const again = await buyer.client.rpc('create_booking', { p_offer_id: priced, p_payment_id: paid.data?.id });
  check('Opakovaná rezervace se stejnou platbou vrátí stejný kód',
    !first.error && !again.error && first.data?.[0]?.reservation_code === again.data?.[0]?.reservation_code,
    `${first.data?.[0]?.reservation_code ?? err(first.error)} / ${again.data?.[0]?.reservation_code ?? err(again.error)}`);
  const row = ((await merchant.client.rpc('merchant_bookings', { p_business_id: businessId, p_from: null, p_until: null })).data ?? [])
    .find((b) => b.id === first.data?.[0]?.booking_id);
  check('Stejná cena od nabídky přes platbu po rezervaci',
    pay.data?.amount_cents === CUSTOMER_PRICE && row?.price_cents === CUSTOMER_PRICE
    && row?.merchant_payout_cents === MERCHANT_PRICE && row?.service_fee_cents === 2500,
    `platba ${pay.data?.amount_cents}, rezervace ${row?.price_cents}, podnik ${row?.merchant_payout_cents}`);
  check('Klient nemůže přepsat finanční snímek rezervace',
    ((await merchant.client.from('bookings').update({ merchant_payout_cents: 1 }).eq('id', row?.id ?? '').select()).data ?? []).length === 0);
  check('Platba s rezervací se „vrátit“ nedá',
    (await buyer.client.rpc('release_unbooked_payment', { p_payment_id: paid.data?.id })).data?.status === 'paid');

  // Paid, then the last seat went to someone else: the money comes straight back.
  const lastSeat = await publish(1, 260);
  const loserPay = await loser.client.rpc('start_payment', { p_offer_id: lastSeat, p_terms_version: TERMS });
  // The webhook books at payment time, so the seat has to go before the loser pays.
  await book(otherUser.client, lastSeat);
  const loserPaid = await settle(loser.client, loserPay.data?.id);
  const lost = await loser.client.rpc('create_booking', { p_offer_id: lastSeat, p_payment_id: loserPay.data?.id });
  await loser.client.rpc('release_unbooked_payment', { p_payment_id: loserPay.data?.id });
  const released = { data: await waitPayment(loser.client, loserPay.data?.id, (x) => x.status === 'refunded') };
  check('Zaplaceno bez místa: platba se hned vrátí',
    /OFFER_UNAVAILABLE|PAYMENT_REQUIRED/.test(err(lost.error)) && released.data?.status === 'refunded' && !loserPaid.data?.reservation_code,
    `${err(lost.error)} → ${released.data?.status}`);
  check('Cizí platbu vrátit nejde', refused(await buyer.client.rpc('release_unbooked_payment', { p_payment_id: loserPay.data?.id })));
} else {
  // One request through every surface that shows or charges its price; eight confirmations at once decide it once.
  const pay = await buyer.client.rpc('start_payment', { p_offer_id: priced, p_terms_version: TERMS });
  const requested = pay.error ? pay : await authorise(buyer.client, pay.data.id);
  const confirmations = await Promise.all(Array.from({ length: 8 }, () =>
    merchant.client.rpc('respond_to_booking', { p_booking_id: requested.data?.booking_id, p_accept: true })));
  check('8 souběžných potvrzení téže žádosti rozhodne jednou',
    confirmations.every((r) => !r.error) && confirmations.filter((r) => r.data?.decided).length === 1,
    confirmations.map((r) => r.error ? err(r.error) : `${r.data.status}${r.data.decided ? '*' : ''}`).join(' '));
  const done = await waitOutcome(buyer.client, pay.data?.id);
  check('Souběžná potvrzení odečtou jen jedno místo', Boolean(done?.reservation_code)
    && (await anon.rpc('get_offer_detail', { p_offer_id: priced })).data?.capacity_remaining === 1, done?.booking_status);
  const row = ((await merchant.client.rpc('merchant_bookings', { p_business_id: businessId, p_from: null, p_until: null })).data ?? [])
    .find((b) => b.id === done?.booking_id);
  check('Stejná cena od nabídky přes autorizaci po rezervaci',
    pay.data?.amount_cents === CUSTOMER_PRICE && row?.price_cents === CUSTOMER_PRICE
    && row?.merchant_payout_cents === MERCHANT_PRICE && row?.service_fee_cents === 2500 && row?.reservation_code === done?.reservation_code,
    `platba ${pay.data?.amount_cents}, rezervace ${row?.price_cents}, podnik ${row?.merchant_payout_cents}`);
  check('Klient nemůže přepsat finanční snímek rezervace',
    ((await merchant.client.from('bookings').update({ merchant_payout_cents: 1 }).eq('id', row?.id ?? '').select()).data ?? []).length === 0);

  // G: the last seat is held by whoever started first; nobody pays for a seat that is not theirs.
  const lastSeat = await publish(1, 260);
  const first = await otherUser.client.rpc('start_payment', { p_offer_id: lastSeat, p_terms_version: TERMS });
  const second = await loser.client.rpc('start_payment', { p_offer_id: lastSeat, p_terms_version: TERMS });
  check('Držené poslední místo druhý zákazník ani nezaplatí', !first.error && /OFFER_UNAVAILABLE/.test(err(second.error)), err(second.error));
  if (!first.error) await otherUser.client.rpc('cancel_pending_booking', {
    p_booking_id: (await otherUser.client.rpc('my_payment_state', { p_payment_id: first.data.id })).data?.booking_id,
  });
}

// Realtime: the venue hears about its booking; another venue listening for it hears nothing.
const merchant2 = users[9]; // demo-merchant2, a member of a different venue
const heard = { own: [], foreign: [] };
const listen = async (client, bucket) => {
  await client.realtime.setAuth();
  return new Promise((resolve) => {
  let timer;
  const channel = client.channel(`acceptance-${bucket}-${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings', filter: `business_id=eq.${businessId}` },
      (payload) => heard[bucket].push(payload.new.id))
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        check(`Realtime: ${bucket} odběr je připojen`, true);
        resolve(channel);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        check(`Realtime: ${bucket} odběr je připojen`, false, error?.message ?? status);
        resolve(channel);
      }
    });
  timer = setTimeout(() => {
    check(`Realtime: ${bucket} odběr je připojen`, false, 'Časový limit 15 sekund');
    resolve(channel);
  }, 15_000);
  });
};
const channels = [await listen(merchant.client, 'own'), await listen(merchant2.client, 'foreign')];
// SUBSCRIBED means the socket joined, not that the server is already streaming changes for
// it; a row written in the same instant can be missed. Measured on the hosted project, a
// settled subscription delivers in 166–487 ms — so settle first, then wait for the event
// itself rather than for a fixed interval.
await new Promise((resolve) => setTimeout(resolve, 2000));
const live = await publish(1, 280);
const liveBuyer = users.find((u) => u !== buyer && u !== loser && u !== otherUser && u !== customer) ?? users[5];
const liveBooking = await book(liveBuyer.client, live);
const liveId = liveBooking.data?.[0]?.booking_id;
for (let waited = 0; waited < 15_000 && liveId && !heard.own.includes(liveId); waited += 250) {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
// Give a leak to the foreign venue the same chance to show up before judging it absent.
await new Promise((resolve) => setTimeout(resolve, 1500));
check('Realtime: podnik se o nové rezervaci dozví bez obnovení', Boolean(liveId) && heard.own.includes(liveId),
  liveId ? `přijato ${heard.own.length}` : `rezervace se nevytvořila: ${err(liveBooking.error)}`);
check('Realtime: cizí podnik nedostane nic', heard.foreign.length === 0, `přijato ${heard.foreign.length}`);
for (const channel of channels) await channel.unsubscribe();

const metricsV1 = (await merchant.client.rpc('merchant_metrics', { p_business_id: businessId })).data;
check('Metriky podniku nesou výdělek a nadcházející výplaty',
  typeof metricsV1?.earned_cents === 'number' && metricsV1?.upcoming_payout_cents >= MERCHANT_PRICE,
  `vyděláno ${metricsV1?.earned_cents}, čeká ${metricsV1?.upcoming_payout_cents}`);
const adminV1 = (await adminUser.client.rpc('admin_metrics')).data;
check('Admin rozlišuje výplaty podnikům a výnos FLEK',
  typeof adminV1?.merchant_payout_cents === 'number' && typeof adminV1?.service_fee_cents === 'number'
  && adminV1.realized_cents === adminV1.merchant_payout_cents + adminV1.service_fee_cents,
  `${adminV1?.realized_cents} = ${adminV1?.merchant_payout_cents} + ${adminV1?.service_fee_cents}`);
check('Nedorazil před začátkem je pořád odmítnut',
  err((await merchant.client.rpc('merchant_resolve_booking', { p_booking_id: liveId, p_outcome: 'no_show' })).error).includes('TOO_EARLY'));
}

} finally {
  // Cleanup runs after a thrown assertion or a network error as well.
  for (const id of created) {
    const result = await merchant.client.rpc('merchant_cancel_offer', { p_offer_id: id, p_reason: 'Úklid po akceptačním běhu.' });
    if (result.error) console.error(`Cleanup ${id}: ${result.error.message}`);
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} prošlo`);
process.exit(passed === results.length ? 0 : 1);
