// End-to-end acceptance run against a real Supabase project, using only the public anon
// key and the demo accounts from supabase/seed.sql. No service-role key, so every call
// goes through real JWTs and real RLS — exactly what a browser would do.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/acceptance.mjs
//
// The script provisions its own offers through publish_offer and cancels them afterwards,
// so it leaves the demo seed as it found it.
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_ || !ANON) throw new Error('Nastavte SUPABASE_URL a SUPABASE_ANON_KEY.');
const PASSWORD = process.env.DEMO_PASSWORD ?? 'FlekDemo2026!';
// The admin account is deliberately not on the shared demo password.
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? PASSWORD;
const SERVICE_ID = '11d06bdf-8e9c-63c3-6bd3-3774c2773965'; // md5('flek-service-1'), Pánský střih

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const err = (e) => e?.message ?? '';

async function signIn(email) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = email.startsWith('demo-admin@') ? ADMIN_PASSWORD : PASSWORD;
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return { client, id: data.user.id, email };
}

const merchant = await signIn('demo-merchant@flek.test');
const created = [];
async function publish(capacity, minutesAhead = 180) {
  const start = new Date(Date.now() + minutesAhead * 60_000).toISOString();
  const { data, error } = await merchant.client.rpc('publish_offer', {
    p_service_id: SERVICE_ID,
    p_start_at: start,
    p_deal_price_cents: 39000,
    p_capacity_total: capacity,
    p_booking_cutoff_at: new Date(Date.now() + (minutesAhead - 15) * 60_000).toISOString(),
    p_confirm_overlap: true,
  });
  if (error) throw new Error(`publish_offer: ${error.message}`);
  created.push(data.id);
  return data.id;
}


/** Booking now requires settled money, so every attempt goes through the payment first. */
async function book(client, offerId) {
  const started = await client.rpc('start_payment', { p_offer_id: offerId });
  if (started.error) return started;
  const settled = await client.rpc('demo_confirm_payment', { p_payment_id: started.data.id });
  if (settled.error) return settled;
  return client.rpc('create_booking', { p_offer_id: offerId, p_payment_id: settled.data.id });
}

const users = await Promise.all(
  ['demo-5', 'demo-6', 'demo-7', 'demo-8', 'demo-9', 'demo-10', 'demo-11', 'demo-12', 'demo-customer', 'demo-merchant2']
    .map((n) => signIn(`${n}@flek.test`)),
);
check('Přihlášení 10 účtů skutečnými JWT', users.length === 10);

const offerA = await publish(1);
const offerB = await publish(5);
const offerC = await publish(1);
check('Partner zveřejní nabídku přes publish_offer', created.length === 3);

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
check('Dvojité klepnutí téhož uživatele: jedna rezervace', okC.length === 1,
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
check('admin_businesses vrátí frontu ke schválení',
  ((await adminUser.client.rpc('admin_businesses', { p_status: 'pending' })).data ?? []).length > 0);

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
const payOffer = await publish(1, 200);
const attempt = await payer.client.rpc('start_payment', { p_offer_id: payOffer });
check('Platba se otevře s částkou z nabídky', !attempt.error && attempt.data.amount_cents === 39000,
  `${attempt.data?.amount_cents} h, stav ${attempt.data?.status}`);
check('Nezaplacená rezervace je odmítnuta',
  err((await payer.client.rpc('create_booking', { p_offer_id: payOffer, p_payment_id: attempt.data.id })).error).includes('PAYMENT_REQUIRED'));
const settledPay = await payer.client.rpc('demo_confirm_payment', { p_payment_id: attempt.data.id });
check('Po zaplacení rezervace projde',
  !(await payer.client.rpc('create_booking', { p_offer_id: payOffer, p_payment_id: settledPay.data.id })).error);
check('Tutéž platbu nelze použít podruhé',
  err((await payer.client.rpc('create_booking', { p_offer_id: payOffer, p_payment_id: settledPay.data.id })).error).length > 0);
check('Cizí platbu nelze potvrdit',
  err((await users[2].client.rpc('demo_confirm_payment', { p_payment_id: settledPay.data.id })).error).includes('FORBIDDEN'));
const payerBooking = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.offer_id === payOffer);
check('Rezervace nese stav zaplaceno', payerBooking?.payment_status === 'paid', payerBooking?.payment_status);
await payer.client.rpc('cancel_booking', { p_booking_id: payerBooking.id });
const afterRefund = ((await payer.client.rpc('my_bookings')).data ?? []).find((b) => b.id === payerBooking.id);
check('Zrušení vrátí peníze', afterRefund?.payment_status === 'refunded', afterRefund?.payment_status);

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

// Cancelling the offers releases every booking this run created, so the demo seed is left
// as it was found and the next run starts from a clean three-booking allowance.
for (const id of created) await merchant.client.rpc('merchant_cancel_offer', { p_offer_id: id, p_reason: 'Úklid po akceptačním běhu.' });

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} prošlo`);
process.exit(passed === results.length ? 0 : 1);
