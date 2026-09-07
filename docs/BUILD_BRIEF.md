# MASTER BUILD PROMPT — VOLNO (v2)

> Instructions are in English on purpose (coding agents follow English specs more reliably).
> **All user-facing strings must be in Czech.** Never translate the Czech copy in this document.

---

## 0. HOW YOU MUST OPERATE

You are a senior product engineering team in one process: product manager, marketplace/UX designer, full-stack engineer, PostgreSQL architect, security engineer, QA engineer.

Operating rules — these override any conflicting instinct:

1. **Build, don't propose.** The deliverable is a running application backed by a real database, not a plan, mockups, or a static prototype.
2. **Risk first, polish last.** Section 4 (booking concurrency) and Section 5 (authorization) must be implemented and covered by passing tests **before** any visual polish. If you spend your first hours on a design system, you have failed.
3. **Ambiguity rule.** If something here is ambiguous, pick the simplest option that satisfies the acceptance criteria in Section 17, implement it, and log one line in `DECISIONS.md`. Do not stop to ask unless you are truly blocked.
4. **Honesty rule.** Anything you could not finish goes into `LIMITATIONS.md` with a reason. Never fake it: no mocked backend, no hardcoded arrays standing in for queries, no `setTimeout` fake latency, no dead buttons, no `TODO` in a P0 path.
5. **Scope rule.** Ship **P0 complete** rather than P0+P1 half-done. The priority ladder is Section 2.
6. **Version rule.** Verify current stable versions and current official API surfaces of every library before use. Do not invent APIs. Pin versions in `package.json`.
7. **Self-verification.** Finish by producing `VERIFICATION.md`: every acceptance criterion in Section 17 mapped to evidence (test name, route, or exact steps).

---

## 1. PRODUCT CONTRACT

VOLNO is a Czech marketplace for **last-minute unused service capacity**.

Economic premise: a slot worth 650 Kč at 18:30 is worth **0 Kč at 18:31**. VOLNO lets a business convert that decaying inventory into revenue at a discount.

The MVP exists to validate exactly one hypothesis:

> **Will local businesses repeatedly publish discounted last-minute slots, and will customers book and actually show up?**

Note "repeatedly" and "show up". Those two words drive Sections 11 and 12, and they were the biggest gap in the previous spec.

Two golden flows. Everything else is secondary:

- **Customer:** open app → see a good deal near me starting soon → book in under 60 seconds → get a code.
- **Merchant:** "I have an empty 18:30" → published in **under 30 seconds** on a phone, from a cold start (app already open, service already exists) in **at most 5 taps + 1 price input**.

Business model context (do not build billing): VOLNO would take ~15 % commission on completed bookings. V1 only *measures* this.

Market: Prague pilot. Language **Czech**. Currency **CZK**. Timezone **Europe/Prague**. Nothing may hardcode Prague in schema or logic — city is data, not a constant.

---

## 2. SCOPE LADDER

Implement strictly in this order. Do not start a tier until the previous one is complete and tested.

### P0 — the product does not exist without these
1. Schema, constraints, RLS, security-definer helpers, seed data.
2. `create_booking` / `cancel_booking` RPCs + concurrency and authorization tests (Section 16).
3. Merchant: sign up → business → service → **publish offer** → list offers.
4. Customer: discovery list (server-side, geo-sorted) → offer detail → auth → **book** → reservation code → my bookings.
5. Merchant: today's reservations → find by code → **Dorazil / Nedorazil**.
6. Admin: approve / reject / suspend business.
7. Loading, empty, error, and conflict states on every P0 screen.

### P1 — needed for a credible pilot
8. Filters + sorting; map view with marker → offer preview.
9. Customer cancellation with atomic capacity restore.
10. Merchant metrics (recovered revenue) + admin hypothesis metrics (Section 12).
11. Trust controls: phone required to book, booking limits, no-show counter (Section 11).
12. Full visual design pass, PWA install, responsive verification at 375 / 768 / 1280.
13. Repeat offer ("Zopakovat nabídku") — the single highest-value merchant convenience.

### P2 — only if P0 and P1 are genuinely done
14. Email notifications (behind an interface, best-effort).
15. Favorites (businesses only).
16. Add-to-calendar (.ics).
17. Admin creates a business on behalf of a merchant and invites an owner by email.

### NOT IN V1 — do not build, do not scaffold
Stripe/payments/payouts/refunds · subscriptions · loyalty/points/coupons/referrals · reviews · chat · push · SMS · dynamic pricing · booking-system integrations (Reservio/Fresha/Bookio/Mindbody) · AI recommendations · restaurants/hotels/tickets/food/e-commerce · multi-language UI · native apps · complex analytics · invoicing · QR scanning.

**Cut from the previous spec on purpose** — do not reintroduce: booking `quantity` (always 1), a separate merchant "Nastavení" page (fold into Provozovna), an admin "Users" page (email lookup only), favoriting individual offers, `business_images` table (one logo + one cover URL per business is enough).

---

## 3. DOMAIN MODEL AND INVARIANTS

PostgreSQL via Supabase. Write real migrations. Money is **integer haléře** (`_cents`, CZK × 100) — floating point for money anywhere is a defect. Prices are entered and displayed as whole CZK.

### Enums
```sql
create type business_status as enum ('pending','approved','rejected','suspended');
create type member_role     as enum ('owner','manager');
create type offer_status    as enum ('draft','published','cancelled');
create type booking_status  as enum ('confirmed','cancelled_by_customer','cancelled_by_merchant','completed','no_show');
```

**Critical design decision — `sold_out` and `expired` are NOT stored statuses.** The previous spec stored them, which creates two sources of truth and a race between a cron job and a live booking. `offer_status` stores only *administrative intent*. Availability is **always derived at query time**:

```sql
create or replace function public.offer_is_bookable(
  p_status offer_status, p_capacity_remaining int,
  p_booking_cutoff_at timestamptz, p_start_at timestamptz
) returns boolean language sql immutable as $$
  select p_status = 'published'
     and p_capacity_remaining > 0
     and now() < p_booking_cutoff_at
     and now() < p_start_at;
$$;
```
This one predicate is used by the search RPC, the offer detail query, and the booking RPC. There is no other definition of "bookable" anywhere in the codebase — not in TypeScript, not in a React hook. Business approval (`businesses.status = 'approved'`) is joined on top of it. A cron job may later archive rows; it must never be required for correctness.

### Tables (minimum)

**profiles** — `id uuid pk references auth.users on delete cascade`, `first_name`, `last_name`, `phone` (nullable; required before first booking), `avatar_url`, `no_show_count int not null default 0`, timestamps. No role/permission column here.

**user_roles** — `user_id`, `role text check (role in ('admin'))`, unique. Admin is *never* a client-writable flag. RLS: nobody can insert/update; seeded by migration or service role only.

**categories** — `slug pk`, `label_cs`, `icon`, `sort_order`. Seeded, referenced by businesses and services (FK). Not a code enum — new categories must not need a deploy.

**businesses** — `id`, `display_name`, `legal_name?`, `slug unique`, `description`, `category_slug fk`, `phone`, `public_email`, `website?`, `address_line`, `city`, `postal_code`, `country default 'CZ'`, `location geography(Point,4326) not null`, `logo_url?`, `cover_url?`, `status business_status not null default 'pending'`, `commission_rate numeric not null default 0.15`, timestamps.

**business_members** — `business_id`, `user_id`, `role member_role`, unique `(business_id,user_id)`.

**services** — `id`, `business_id`, `name`, `description?`, `category_slug`, `duration_minutes int check (duration_minutes between 5 and 480)`, `normal_price_cents int check (> 0)`, `image_url?`, `is_active bool default true`, timestamps. Services are **soft-deleted only** (`is_active=false`) — hard delete with historical bookings is forbidden.

**offers** — `id`, `business_id`, `service_id`, `start_at timestamptz`, `end_at timestamptz`, `original_price_cents`, `deal_price_cents`, `capacity_total int`, `capacity_remaining int`, `booking_cutoff_at timestamptz`, `status offer_status default 'published'`, `cancelled_at?`, timestamps.

Table constraints (enforced in the DB, not only in Zod):
```
check (end_at > start_at)
check (deal_price_cents > 0 and original_price_cents > 0)
check (deal_price_cents <= original_price_cents * 0.90)   -- min 10% discount: it must be a real deal
check (deal_price_cents >= original_price_cents * 0.15)   -- sanity floor, catches a mistyped price
check (capacity_total between 1 and 50)
check (capacity_remaining >= 0 and capacity_remaining <= capacity_total)
check (booking_cutoff_at <= start_at)
```
Application-level validation on create (not table constraints, because `now()` is not immutable): `start_at > now()`, `start_at <= now() + interval '7 days'` (VOLNO is last-minute, not a booking system), `booking_cutoff_at >= now() + interval '5 minutes'` — otherwise the offer is born unbookable, which the previous spec allowed.

**bookings** — `id`, `offer_id`, `business_id` (denormalized, for merchant RLS without a join), `customer_id`, `reservation_code text unique`, `price_cents`, snapshots: `service_name_snapshot`, `business_name_snapshot`, `business_address_snapshot`, `start_at_snapshot`, `end_at_snapshot`, `original_price_cents_snapshot`; `status booking_status default 'confirmed'`, `created_at`, `cancelled_at?`, `resolved_at?`.

No `quantity` column. One booking = one seat.

**The invariant that kills an entire bug class:**
```sql
create unique index bookings_one_active_per_customer_offer
  on bookings (offer_id, customer_id) where status = 'confirmed';
```
This makes double-tap, refresh-resubmit, and two-tab booking harmless at the database level.

**analytics_events** — `id`, `occurred_at default now()`, `user_id?`, `session_id text`, `name text`, `props jsonb`. Insert-only for anon+authenticated; readable only by admin.

**favorites** (P2) — `user_id`, `business_id`, unique.

### Indexes (add these, not "every column")
- `offers`: `(status, start_at)` partial `where status='published'`; `(business_id, start_at desc)`; `(service_id)`.
- `businesses`: GiST on `location`; `(status)`; unique `(slug)`.
- `bookings`: `(customer_id, start_at_snapshot desc)`; `(business_id, start_at_snapshot)`; `(offer_id)`; unique `(reservation_code)`.
- `business_members`: `(user_id)`, `(business_id)`.
- `analytics_events`: `(name, occurred_at desc)`.

---

## 4. BOOKING CONCURRENCY — THE HARDEST REQUIREMENT

Overselling is the one failure that destroys merchant trust permanently. Get this exactly right.

**Rules**
- All capacity mutation happens **only** inside `security definer` PostgreSQL functions. The client has **no** UPDATE privilege on `offers.capacity_remaining` (RLS must deny it even to the owning merchant).
- The decrement is a **single conditional UPDATE**, not read-then-write. A `select` followed by an `update` in application code is wrong even inside a transaction at READ COMMITTED.
- Price comes from the database row, never from the request.
- A PL/pgSQL function runs in one transaction: if anything after the decrement raises, the decrement rolls back. Rely on that instead of manual compensation.

**`public.create_booking(p_offer_id uuid) returns table (booking_id uuid, reservation_code text)`**

```sql
create or replace function public.create_booking(p_offer_id uuid)
returns table (booking_id uuid, reservation_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_phone text;
  v_offer offers%rowtype;
  v_svc   services%rowtype;
  v_biz   businesses%rowtype;
  v_code  text;
  v_active int;
  v_noshow int;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select phone, no_show_count into v_phone, v_noshow from profiles where id = v_user;
  if v_phone is null or length(v_phone) < 9 then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001';
  end if;

  -- trust controls (Section 11)
  select count(*) into v_active from bookings
    where customer_id = v_user and status = 'confirmed' and start_at_snapshot > now();
  if v_active >= 3 then
    raise exception 'TOO_MANY_ACTIVE' using errcode = 'P0001';
  end if;

  select count(*) into v_noshow from bookings
    where customer_id = v_user and status = 'no_show' and start_at_snapshot > now() - interval '60 days';
  if v_noshow >= 2 then
    raise exception 'BLOCKED_NO_SHOW' using errcode = 'P0001';
  end if;

  -- ATOMIC CLAIM: one statement, no prior read
  update offers o
     set capacity_remaining = o.capacity_remaining - 1,
         updated_at = now()
   where o.id = p_offer_id
     and o.status = 'published'
     and o.capacity_remaining >= 1
     and now() < o.booking_cutoff_at
     and now() < o.start_at
     and exists (select 1 from businesses b
                  where b.id = o.business_id and b.status = 'approved')
  returning o.* into v_offer;

  if not found then
    raise exception 'OFFER_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_svc from services   where id = v_offer.service_id;
  select * into v_biz from businesses where id = v_offer.business_id;

  for i in 1..5 loop                    -- code collision retry
    v_code := 'VOLNO-' || public.generate_reservation_code(6);
    begin
      insert into bookings (
        offer_id, business_id, customer_id, reservation_code, price_cents,
        service_name_snapshot, business_name_snapshot, business_address_snapshot,
        start_at_snapshot, end_at_snapshot, original_price_cents_snapshot, status)
      values (
        v_offer.id, v_offer.business_id, v_user, v_code, v_offer.deal_price_cents,
        v_svc.name, v_biz.display_name, v_biz.address_line,
        v_offer.start_at, v_offer.end_at, v_offer.original_price_cents, 'confirmed')
      returning id, reservation_code into booking_id, reservation_code;
      return next;
      return;
    exception when unique_violation then
      if position('bookings_one_active_per_customer_offer' in coalesce(sqlerrm,'')) > 0 then
        raise exception 'ALREADY_BOOKED' using errcode = 'P0001';   -- rolls back the decrement
      end if;
      -- otherwise it was a code collision: retry
    end;
  end loop;
  raise exception 'CODE_GENERATION_FAILED' using errcode = 'P0001';
end $$;
```

`generate_reservation_code(n)` uses an unambiguous alphabet — `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0/O/1/I/5/S confusion) — and `gen_random_bytes`. 6 characters, not 4: 4 is guessable and collides.

**`public.cancel_booking(p_booking_id uuid)`** — customer-owned; allowed while `now() < start_at_snapshot - interval '60 minutes'` **OR** `now() < created_at + interval '10 minutes'`. That grace window exists because the booking cutoff (15 min before start) is later than the cancellation cutoff (60 min before start) — without it a customer who books at T-30 can never cancel, which the previous spec did not notice. On success: set status + `cancelled_at`, and `update offers set capacity_remaining = least(capacity_remaining + 1, capacity_total) where id = ...`. Capacity restore makes the offer bookable again automatically because bookability is derived (Section 3).

**Other RPCs, all `security definer`, all re-checking membership via `is_member_of()`:**
- `merchant_cancel_offer(p_offer_id, p_reason text)` — sets offer `cancelled`, cancels every `confirmed` booking as `cancelled_by_merchant`, emits events. Refuses if `now() > start_at`.
- `merchant_resolve_booking(p_booking_id, p_outcome)` where outcome ∈ `completed | no_show`. **Refuse if `now() < start_at_snapshot`** — you cannot mark a no-show before the appointment. `no_show` increments `profiles.no_show_count`.
- `merchant_lookup_booking(p_code text)` — returns a booking only if it belongs to a business the caller is a member of. Never a global code lookup; that would let any merchant enumerate the marketplace.

**Client error mapping (Czech, exact strings):**
| code | message |
|---|---|
| `OFFER_UNAVAILABLE` | „Tento termín už bohužel není volný." |
| `ALREADY_BOOKED` | „Tuto nabídku už máš zarezervovanou." |
| `PHONE_REQUIRED` | „Pro rezervaci potřebujeme tvoje telefonní číslo." |
| `TOO_MANY_ACTIVE` | „Máš 3 aktivní rezervace. Dokonči nebo zruš některou z nich." |
| `BLOCKED_NO_SHOW` | „Rezervace je dočasně nedostupná, protože jsi opakovaně nedorazil/a." |
| `CANCELLATION_CLOSED` | „Rezervaci už nejde zrušit. Dej prosím podniku vědět telefonicky." |

---

## 5. AUTHORIZATION AND RLS

RLS enabled on **every** table. No table left open.

**Helpers (`security definer`, `set search_path = public`, `stable`)** — these exist to avoid the classic Supabase infinite-recursion bug where a policy on `business_members` queries `business_members`:
```sql
create function public.is_member_of(p_business_id uuid) returns boolean ...
create function public.is_admin() returns boolean ...          -- reads user_roles
create function public.my_business_ids() returns setof uuid ...
```

**Policy matrix**

| Table | anon | customer | merchant member | admin |
|---|---|---|---|---|
| businesses | select where `status='approved'` | same | select/update own | all |
| services | select where business approved and `is_active` | same | CRUD own | all |
| offers | select where business approved and `status='published'` | same | select/insert/update own (**never** `capacity_remaining`) | all |
| bookings | — | select/insert own via RPC only | select own business | all |
| profiles | — | select/update own | see Section 11 for customer identity | all |
| user_roles | — | — | — | read-only |
| analytics_events | insert | insert | insert | select |
| favorites | — | CRUD own | — | all |

Hard requirements:
- Grant no direct `insert` on `bookings` to `authenticated`; bookings are created only through the RPC.
- Deny `update` on `offers.capacity_remaining` at column level (or by making merchant updates go through an RPC).
- Never trust a `business_id` sent from the client. Every merchant mutation re-derives authorization server-side.
- Admin comes from `user_roles`, verified in SQL. A client-side `isAdmin` boolean guards **routing only**, never data.
- Anonymous route guards are UX, not security. Every protected screen must still be safe if the guard is bypassed — verify this with a test that queries as the wrong role.
- Service-role key never reaches the browser bundle. `.env.example` contains only public keys, with comments.
- Storage buckets: public read for `logos`/`covers`; write only by members of the owning business; MIME allowlist; ≤ 5 MB; resize on upload.

---

## 6. SEARCH, GEO, AND SORTING

Use **PostGIS** (`geography(Point,4326)` + GiST + `ST_DWithin`). Filtering and distance must be server-side: client-side filtering leaks inventory, breaks pagination, and cannot scale.

One RPC is the only discovery entry point:
```sql
public.search_offers(
  p_lat double precision, p_lng double precision,
  p_radius_m int default 5000,
  p_category text default null,
  p_from timestamptz default now(),
  p_until timestamptz default null,
  p_min_discount_pct int default 0,
  p_max_price_cents int default null,
  p_sort text default 'recommended',   -- recommended|nearest|discount|cheapest|soonest
  p_limit int default 20,
  p_offset int default 0
) returns table (... offer fields, business fields, distance_m, discount_pct ...)
```
It applies `offer_is_bookable(...)` and `businesses.status='approved'`. It never returns a business's exact street-level data for unpublished offers.

**Define "Doporučené" concretely** (otherwise the agent invents randomness):
```
proximity  = 1 - least(distance_m / p_radius_m, 1)
imminence  = 1 - least(extract(epoch from start_at - now()) / 43200.0, 1)   -- 12h horizon
discount   = least(discount_pct / 60.0, 1)
score      = 0.45*proximity + 0.35*imminence + 0.20*discount
order by score desc, start_at asc, id asc      -- deterministic tie-break
```
`discount_pct` is **floored**: 39.6 % displays as −39 %, never −40 %.

**Cold-start ladder (this matters more than it looks).** At pilot launch the city may hold three offers. An empty "Nejblíž právě teď" makes the app look dead. So: if the current filter returns fewer than 3 results, automatically widen — radius 2 → 5 → 10 km, then today → tomorrow → next 7 days — and label it honestly: „Do 2 km nic není. Ukazujeme nabídky do 5 km." Never render a bare empty grid on the home screen.

---

## 7. TIME AND MONEY RULES

- Every timestamp is `timestamptz`. All eligibility comparisons use PostgreSQL `now()`. **Client clocks are never authoritative** for anything.
- "Dnes"/"Zítra" are computed in **Europe/Prague**, not in the browser's timezone. A customer whose phone is on another timezone must still see Prague days.
- Merchant time input is local Prague wall-clock → convert with a real IANA-aware library (e.g. `date-fns-tz` / `Temporal` polyfill). Verify DST: an offer at 02:30 on the March and October switch dates must round-trip correctly. Include this as a test.
- Countdown/"za 20 minut" labels recompute from server-derived times and re-render on an interval; never freeze at mount.
- Money: integer haléře end to end. One formatting helper (`650 Kč`, non-breaking space, tabular numerals). Never `toFixed` on a float.

---

## 8. CUSTOMER EXPERIENCE

Mobile-first (design at 375 px, then scale up). Bottom nav: **Objevit · Mapa · Rezervace · Profil** (Oblíbené only if P2 is reached — four items beat five).

**Discovery / home.** The screen must answer one question in under two seconds: *co můžu mít dnes levněji poblíž.* Structure: location chip (Praha, editable) → one-line value prop → quick filter row (`Teď · Dnes · Zítra · Do 2 km · −30 % a víc`) → category strip → **Nejblíž právě teď** → **Největší slevy dnes** → **Zítra**. No hero carousel, no marketing sections, no newsletter box.

**Offer card** — the single most important component. Shows: image, service name, business name + district, distance, start time + duration, original price struck through, deal price (largest element after the image), floored discount badge. `Poslední místo` only when `capacity_remaining = 1` **and** `capacity_total > 1` — a 1-of-1 slot is not urgency, it is the normal case, and fake urgency is exactly the pattern this product must avoid. Cards vanish the moment they stop being bookable (invalidate the query on a timer and on window focus).

**Offer detail.** Everything from the card plus address, small map, savings line („Ušetříš 260 Kč"), duration window („18:30–19:15"), business + service description, cancellation rule in plain words, and a sticky CTA: **`Rezervovat za 390 Kč`** with `Platba na místě` directly beneath it — never buried in a paragraph.

**Booking flow.** Tap Rezervovat → if anonymous, open auth **preserving the target offer** and return straight to the confirmation sheet (a `returnTo` param; losing intent here is the classic conversion leak). → phone capture if missing → confirmation sheet showing what, where, when, price on site, savings, cancellation deadline, and a short commitment line: „Podnik ti termín drží. Když nemůžeš dorazit, zruš to prosím včas." → `Potvrdit rezervaci` (disabled + spinner while in flight, idempotent by the unique index) → success screen with the code in a large monospace/tabular treatment, address, `Navigovat` (maps deep link), `Zobrazit rezervaci`.

**Moje rezervace.** Tabs Nadcházející / Historie. An upcoming card leads with the code and time; a "dnes" booking is visually distinct. Cancel button visible only while cancellation is actually allowed, with the deadline stated.

**Auth.** Email + password is the baseline; magic link only if it round-trips cleanly (magic links opening in a different browser lose state — if that happens, drop them). No social login in V1. Browsing never requires an account.

---

## 9. MERCHANT EXPERIENCE

The merchant is a barber holding scissors, standing up, using one thumb. Design for that, not for a desk.

Branded as **VOLNO Partner**, visually distinct from the customer app but obviously the same product. If one account has both roles, provide an explicit switch.

**Dashboard home:** today's numbers (aktivní nabídky / rezervace / volná místa), the next reservation with its code, then unresolved bookings needing `Dorazil/Nedorazil`. One dominant CTA everywhere: **`+ Přidat volný termín`**. No charts on this screen.

**Create offer — the flow that decides whether this company exists.** Target: under 30 seconds, one screen, no wizard, no page transitions.
- Service picker (recently used first, as large tap targets) → auto-fills duration + normal price.
- Date defaults to **Dnes**; time as a set of quick chips generated from now (`+1 h`, `+2 h`, `18:00`, `18:30`, `19:00` …) plus a manual field. Typing a time in a native picker is the slowest step; chips remove it.
- Price: preset discount buttons **−20 % / −30 % / −40 %** that fill the field instantly, plus manual entry. Live line: `650 Kč → 390 Kč · −40 %`.
- Capacity defaults to 1, collapsed behind "více míst".
- Booking cutoff defaults to 15 min before start, collapsed under advanced.
- `Zveřejnit nabídku` → inline success, stay on the dashboard.

Validation the merchant will actually hit: start time in the past; start beyond 7 days; deal price ≥ 90 % of normal („Sleva musí být aspoň 10 %."); an obviously mistyped price (< 15 %); a start time so close that the cutoff has already passed. **Soft warning on overlap:** if the new offer's time window overlaps another active offer of the same business, warn — „Ve stejnou dobu už máte jinou nabídku. Máte volnou kapacitu?" — with a confirm. Do not block: a salon has several chairs. Nobody caught this in v1 and it is how a merchant ends up double-booked and blames VOLNO.

**Nabídky:** tabs Aktivní / Nadcházející / Ukončené. Row shows service, time, price, `1/1 obsazeno`. Actions: **Zopakovat** (prefills the create sheet with the same service+price, next free time — merchants have the same empty slot every week), Upravit, Zrušit. Editing rules: once a booking exists, only capacity may be **increased**; price, time, and service are immutable, and capacity may never drop below the number of confirmed bookings. Otherwise the merchant cancels the offer (which cancels bookings with a clear reason).

**Rezervace:** Dnes / Nadcházející / Historie, plus a code lookup field („Zadejte rezervační kód"). Row: time, customer first name + last initial, service, price, code, and two big buttons **`Zákazník dorazil`** / **`Nedorazil`**, enabled only after the start time. No QR in V1.

**Metriky:** published offers, bookings, completed, no-shows, and the number that makes a merchant stay: „Tento měsíc jste z jinak prázdných termínů získali **8 420 Kč**." Nothing else.

---

## 10. ADMIN

Internal tool. Functional, not pretty. Server-verified `is_admin()`.
- **Provozovny:** pending queue first, with everything needed to judge one — details, location on a map, services, contact. Approve / Reject (with reason) / Suspend. Suspending hides future offers immediately and cancels upcoming confirmed bookings as `cancelled_by_merchant`; the UI must state that consequence before the click.
- **Nabídky / Rezervace:** searchable lists, deactivate an offer.
- **Uživatelé:** lookup by email; see bookings and no-show count; toggle a manual booking block.
- **Metriky:** Section 12.
- P2: create a business and invite an owner by email — the founder will onboard the first 20 venues by hand, and self-serve signup will not be the real path during a pilot.

---

## 11. TRUST AND NO-SHOWS (the risk v1 ignored)

A discount marketplace with zero payment and free cancellation attracts no-shows, and no-shows are what make merchants quit. Without payments the mitigations must be behavioural and cheap:

1. **Phone required** before the first booking (collected in-flow, not at signup). The merchant needs a way to reach the customer; the customer's phone raises commitment.
2. **Max 3 active upcoming bookings** per customer.
3. **No-show ledger:** `profiles.no_show_count` incremented only by `merchant_resolve_booking`. Two no-shows in 60 days → booking blocked, with a clear message and an admin override. Enforced **inside the RPC**, not in the UI.
4. **Commitment microcopy** on the confirmation sheet and in the confirmation state — one line, not a legal wall.
5. **Merchant sees the customer as `Jakub H.`** in lists; the full name and phone are revealed only on the booking detail of a confirmed booking at that merchant's own business. Never expose email.
6. **Unresolved bookings**: a booking still `confirmed` 24 h after start is surfaced to the merchant as „Nevyřízené" and excluded from both completion and no-show rates so the pilot metrics stay honest. Do not add a status for it.

---

## 12. MEASURING THE HYPOTHESIS

The pilot is worthless if it cannot be read. Emit `analytics_events` (never blocking a mutation) for at least: `offer_published`, `offer_cancelled`, `search_performed`, `offer_viewed`, `booking_started`, `booking_created`, `booking_failed` (with error code), `booking_cancelled`, `booking_completed`, `booking_no_show`, `merchant_signup_completed`.

Admin metrics page, expressed as the hypothesis itself:
- **Fill rate** — booked capacity ÷ published capacity, overall and by category.
- **Time to first booking** — median minutes from publish to first booking. If this is 4 hours, "last-minute" does not work.
- **Merchant repeat rate** — businesses that published in ≥ 2 distinct weeks ÷ approved businesses. *This is the single most important number in the pilot.*
- **Customer repeat rate** — customers with ≥ 2 completed bookings.
- **Show-up rate** — completed ÷ (completed + no_show), plus the unresolved count.
- **Realized value** — Σ deal price of completed bookings, and **estimated commission** at each business's `commission_rate`.
- **Funnel** — offer views → booking started → booking created, plus a breakdown of `booking_failed` reasons.

---

## 13. DESIGN AND CZECH COPY

**Do not look like:** enterprise SaaS, a Bootstrap dashboard, a crypto app, a coupon site, Too Good To Go, or ClassPass. Build an original consumer identity: confident, urban, useful, a little premium, never childish or shouty.

Concrete constraints so this doesn't drift into default shadcn slate:
- Light theme. Warm off-white surface, near-black text, **one** saturated accent used for the primary CTA only.
- The **discount badge and the CTA must not compete** — pick one loud element per card. Price hierarchy: deal price > discount badge > struck-through original.
- Type: one strong geometric/grotesque family, a clear scale (12/14/16/20/24/32), tabular numerals for all prices and times.
- Generous whitespace, subtle rounded geometry, real photography, one shadow level.
- Ban: gradients, glassmorphism, pills everywhere, decorative icons, stock illustrations, emoji in UI.
- Create a simple original VOLNO wordmark, isolated in one component so it can be replaced.
- Accessibility is not optional: WCAG AA contrast, visible focus rings, keyboard-operable dialogs and filter sheets, labelled inputs, ≥ 44 px touch targets, `prefers-reduced-motion`, never colour alone to convey state.

**Czech, and this is a decision the previous prompt never made:**
> **Customer side = tykání. Merchant side = vykání.** Consistently. No mixing (v1 had „Ušetříš" next to „Vaši provozovnu").

Canonical strings — use these exactly:

| Context | Czech |
|---|---|
| Customer CTA | `Rezervovat za 390 Kč` |
| Payment note | `Platba na místě` |
| Savings | `Ušetříš 260 Kč` |
| Last seat | `Poslední místo` |
| Cancel | `Zrušit rezervaci` |
| Cancellation rule | `Zrušit můžeš zdarma do 17:30` |
| Sold/expired | `Tento termín už bohužel není volný.` |
| Empty nearby | `V okolí teď nic volného není.` |
| Merchant CTA | `+ Přidat volný termín` |
| Publish | `Zveřejnit nabídku` |
| Published | `Nabídka je aktivní.` |
| Attendance | `Zákazník dorazil` / `Nedorazil` |
| Pending approval | `Vaši provozovnu kontrolujeme. Ozveme se do 24 hodin.` |
| Merchant empty | `Dnes zatím nemáte žádnou volnou nabídku.` |

Copy is short, concrete, human. Never „Provést rezervaci nabídky". Never machine-translated English syntax. If unsure between two phrasings, pick the shorter one.

---

## 14. EDGE CASES — ALL MUST BE HANDLED

1. Two customers claim the last seat simultaneously → exactly one succeeds; the other sees `OFFER_UNAVAILABLE`.
2. Double-tap / refresh / two tabs → one booking (unique partial index).
3. Booking an offer past its cutoff or start → rejected server-side even if the card was stale.
4. Booking a cancelled offer, or one whose business was suspended between page load and tap → rejected.
5. Customer cancels in time → capacity restored; the offer reappears in discovery without a job running.
6. Customer booked at T−30 min tries to cancel → allowed only inside the 10-minute grace window; otherwise `CANCELLATION_CLOSED` with a phone-the-venue suggestion.
7. Merchant cancels an offer with bookings → bookings become `cancelled_by_merchant` with a reason; the customer sees it clearly in Moje rezervace.
8. Merchant edits or deactivates a service after a booking → the booking is unaffected (snapshots).
9. Merchant tries to lower capacity below confirmed bookings → rejected.
10. Merchant tries `Nedorazil` before the start time → rejected.
11. Merchant guesses another business's UUID / calls an RPC with a foreign `business_id` → denied by RLS and by the RPC's own membership check.
12. Merchant looks up a reservation code belonging to another business → not found.
13. Pending or rejected business publishes → blocked in UI and in the database.
14. Suspended business → offers vanish from discovery; upcoming bookings cancelled with notice.
15. Geolocation denied or unavailable → default to Prague centre + explicit manual location picker, no blocking modal.
16. Zero results → cold-start ladder (Section 6), never a bare empty screen.
17. Offer created at 23:50 for "dnes 00:30" → the date label must be tomorrow; verify Prague-day boundaries.
18. DST transitions in March/October → offers round-trip correctly; add a test.
19. Customer's device clock is wrong by hours → nothing breaks, because eligibility is `now()` in the database.
20. Session expires mid-booking → clean re-auth returning to the same offer, no silent failure.
21. Reservation code collision → retried transparently.
22. Blocked (no-show) customer tries to book → clear message, not a generic error.
23. Slow or offline network on the confirm tap → button locked, no duplicate, honest error, retry possible.
24. Business deleted/soft-removed with historical bookings → prevented; snapshots keep history readable regardless.

---

## 15. SEED DATA

Enough that the app feels alive on first run and every state is demonstrable.

- 12–15 fictional Prague businesses (clearly fictional names), spread across Vinohrady, Karlín, Holešovice, Smíchov, Dejvice, Žižkov, Anděl, with believable real coordinates and 6+ categories.
- 20+ services with realistic Czech prices (střih 450–800 Kč, masáž 60 min 900–1 400 Kč, padel hodina 600–900 Kč, lekce jógy 250–350 Kč).
- 30–40 offers covering: several today at different hours, several tomorrow, one fully booked, one with one seat left, one already past, one cancelled, one at −20 %, one at −45 %, capacities of 1, 4 and 12.
- Bookings in every status, including a completed one and a no-show, so merchant metrics and customer history are non-empty.
- Accounts: `demo-customer@volno.test`, `demo-merchant@volno.test` (approved business), `demo-merchant2@volno.test` (pending business — so the approval queue is demonstrable), `demo-admin@volno.test`. Passwords documented in the README as local-only development credentials.
- Offer times must be seeded **relative to `now()`**, not as fixed dates, so the demo is still alive next week.

---

## 16. TESTS — SPECIFIC, NOT "SENSIBLE TESTS"

Vitest (unit) + integration tests against a local Supabase instance. `npm test` must pass. Each item below is a named test.

**Concurrency (mandatory, this is the one that matters)**
- `capacity=1`, 10 parallel `create_booking` calls from 10 distinct users → exactly 1 success, 9 `OFFER_UNAVAILABLE`, `capacity_remaining=0`, exactly 1 booking row.
- `capacity=5`, 20 parallel calls → exactly 5 successes, `capacity_remaining=0`.
- Same user calls `create_booking` twice concurrently → 1 booking, second is `ALREADY_BOOKED`, capacity decremented once.

**Booking rules**
- Booking after `booking_cutoff_at` → rejected. After `start_at` → rejected.
- Booking an offer of a `pending` / `suspended` business → rejected.
- Booking with no phone → `PHONE_REQUIRED`.
- 4th active booking → `TOO_MANY_ACTIVE`. Blocked no-show customer → `BLOCKED_NO_SHOW`.
- Cancel in time → status + capacity restored, and the offer is bookable again.
- Cancel at T−30 outside grace → rejected; inside grace → allowed.
- Booking price always equals `offers.deal_price_cents`, even if the client sends something else.

**Authorization / RLS (run as real JWTs, not service role)**
- Merchant A cannot read/update Merchant B's offers, services, bookings, or business.
- Merchant A cannot look up Merchant B's reservation code.
- Customer cannot read another customer's bookings or profile.
- Anonymous cannot read `pending` businesses, `draft` offers, or any booking.
- No client role can update `offers.capacity_remaining` directly.
- Non-admin cannot call admin functions or read `analytics_events`.

**Domain**
- Offer constraints: discount < 10 % rejected; price ≥ original rejected; `end_at <= start_at` rejected; `start_at` beyond 7 days rejected.
- Capacity cannot be reduced below confirmed bookings.
- `no_show` before `start_at` rejected; after → increments `no_show_count`.
- Service edit does not alter existing booking snapshots.
- Prague day-boundary + DST formatting cases.
- `search_offers` never returns unbookable or unapproved inventory; the score ordering is deterministic.

**Manual QA checklist** (document results in `VERIFICATION.md`): the full end-to-end workflow in Section 17 on a 375 px viewport; refresh persistence at every step; map ↔ list; every filter; geolocation denied; auth interruption mid-booking; every empty and error state; keyboard-only navigation of booking and offer creation.

---

## 17. ACCEPTANCE CRITERIA

Not done until every line is true and evidenced in `VERIFICATION.md`.

**End-to-end workflow, on real backend state, surviving a hard refresh at every step:**
1. Merchant registers → creates business → sees `Vaši provozovnu kontrolujeme`.
2. Admin approves it; the merchant's state updates.
3. Merchant creates the service `Pánský střih · 45 min · 650 Kč`.
4. Merchant publishes: today, a future time, 390 Kč, capacity 1 — **timed at under 30 seconds** from dashboard to confirmation.
5. A customer in another browser sees the offer in discovery with correct distance and `−40 %`.
6. Customer opens detail → registers → adds phone → books → receives `VOLNO-XXXXXX`.
7. The offer immediately stops being bookable everywhere; a second customer attempting to book it gets „Tento termín už bohužel není volný."
8. Merchant sees the booking under Dnes, finds it by code, and marks `Zákazník dorazil` after the start time.
9. Customer sees it under Historie as dokončeno.
10. Merchant "recovered revenue" and admin fill rate both update.
11. A second offer, capacity 2: two different customers book it; the third is refused.
12. A customer cancels an eligible booking; the offer returns to discovery with capacity restored.

**Technical:** `npm run build` and `tsc --noEmit` clean; no console errors on any P0 route; every automated test passes, concurrency tests included; RLS enabled on every table; no service key in the client bundle (grep it); Lighthouse mobile performance ≥ 80 and accessibility ≥ 90 on discovery and offer detail.

**Product:** at 375 px, every P0 screen is usable one-handed with no horizontal scroll; there is no dead navigation, no placeholder text, no lorem ipsum, no English string on a user-facing surface; every list has designed empty, loading, and error states.

---

## 18. STACK, STRUCTURE, DELIVERABLES

**Stack:** React + TypeScript + Vite · Tailwind · shadcn/ui only where it saves real time · TanStack Query (with cache invalidation on booking mutations and on window focus, so stale inventory is not shown) · React Hook Form + Zod · MapLibre GL + OpenStreetMap-compatible tiles (map config isolated in one module) · Supabase (Postgres, Auth, Storage, RLS, PostGIS) · a timezone-correct date library · PWA installable, service worker caching **shell only — never offer or booking API responses**.

Zod schemas are shared between form validation and RPC argument typing; database constraints remain the source of truth.

**Structure:** feature-oriented — `src/features/{auth,discovery,offers,bookings,merchant,admin}`, plus `components/ui`, `lib/{supabase,format,time,geo,analytics}`, `hooks`, `types` (generated from the database schema, not hand-written). No god components; no `any`; no business rule duplicated between SQL and TypeScript.

**Build order:** ① migrations + RLS + RPCs + their tests → ② one ugly vertical slice (publish → book → complete) proving the backend end to end → ③ merchant flows → ④ customer discovery + booking UI → ⑤ admin → ⑥ design pass → ⑦ metrics + trust controls → ⑧ QA, responsive, accessibility, seed polish.

**Deliverables:** working app · `supabase/migrations/*` · seed script · test suite · `.env.example` (public keys only) · `README.md` (what VOLNO is, setup, Supabase config, migrations, seeding, demo accounts, main flows, V1 limitations, V2 roadmap) · `DECISIONS.md` · `LIMITATIONS.md` · `VERIFICATION.md`.

**Future extension points (design for, do not build):** `bookings.price_cents` and a nullable payment-intent column make deposits addable; the offer creation RPC is the seam where an automated rule ("still empty 3 h before start → publish at −25 %") plugs in; `analytics_events` becomes the input for dynamic pricing; the notification module is an interface with an in-app implementation so email/push slot in behind it. No abstraction beyond these four seams.

---

## 19. FINAL FILTER

Before building anything, ask: **does this help us learn whether merchants will repeatedly publish discounted last-minute capacity and whether customers will book it and show up?**

If no — do not build it.

Two actions must feel effortless:

- **Zákazník:** „Najdu si výhodný termín na dnes a rezervuju ho."
- **Podnik:** „Mám prázdný termín a za třicet vteřin ho nabídnu."

Everything else is secondary. Now inspect the environment, set up the database and its tests first, and build the application.