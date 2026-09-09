/*
 * The venue page the app has always implied and never had.
 *
 * Favourites tell a customer "3 volných termínů" at a place they follow, and until now there
 * was nowhere to go: the row was a plain <li>, my_favorites returns only counts, and no route
 * for a business existed anywhere in the app. Worse, "Nové u tvých míst" only ever lists
 * offers published after the last visit (published_at > seen_at), and opening the list moves
 * seen_at forward — so an offer that is open but was published earlier had no card anywhere
 * in the product. These two functions give it one.
 */

/** Everything a public venue page needs in its header, for approved venues only. */
create or replace function public.business_public(p_business_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select to_jsonb(x) from (
    select b.id, b.display_name, b.slug, b.description, b.category_slug,
           b.address_line, b.city, b.district, b.logo_url, b.cover_url,
           b.google_place_id, b.cancellation_window_minutes,
           extensions.st_y(b.location::extensions.geometry) as latitude,
           extensions.st_x(b.location::extensions.geometry) as longitude,
           (select count(*) from public.offer_details d
             where d.business_id = b.id and d.bookable)::integer as open_offers
    from public.businesses b
    where b.id = p_business_id and b.status = 'approved'
  ) x;
$$;

/*
 * Every bookable offer at one venue, soonest first. The column list deliberately matches
 * search_offers so the existing OfferCard renders these rows unchanged — including
 * distance_m, which offer_details does not carry and whose absence is why the favourites
 * screen currently prints "NaN km".
 */
create or replace function public.business_offers(p_business_id uuid, p_lat float8 default null, p_lng float8 default null)
returns table(id uuid,business_id uuid,service_id uuid,business_name text,business_slug text,service_name text,description text,category_slug text,start_at timestamptz,end_at timestamptz,booking_cutoff_at timestamptz,original_price_cents integer,deal_price_cents integer,capacity_total integer,capacity_remaining integer,address_line text,city text,district text,latitude float8,longitude float8,cover_url text,logo_url text,image_url text,distance_m float8,discount_pct integer,score float8,server_now timestamptz,rating_avg numeric,rating_count integer,google_place_id text)
language plpgsql stable security definer set search_path=public as $$
begin
  return query
  select d.id, d.business_id, d.service_id, d.business_name, d.business_slug, d.service_name,
         d.description, d.category_slug, d.start_at, d.end_at, d.booking_cutoff_at,
         d.original_price_cents, d.deal_price_cents, d.capacity_total, d.capacity_remaining,
         d.address_line, d.city, d.district, d.latitude, d.longitude, d.cover_url, d.logo_url,
         d.image_url,
         case when p_lat between -90 and 90 and p_lng between -180 and 180
              then extensions.st_distance(
                     b.location,
                     extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)
         end as distance_m,
         d.discount_pct,
         0::float8 as score,
         now() as server_now,
         d.rating_avg, d.rating_count, d.google_place_id
  from public.offer_details d
  join public.businesses b on b.id = d.business_id
  where d.business_id = p_business_id and d.bookable and b.status = 'approved'
  order by d.start_at;
end $$;

-- A venue page is public: someone who is handed a link must see it before signing in.
revoke execute on function public.business_public(uuid), public.business_offers(uuid,float8,float8) from public;
grant execute on function public.business_public(uuid), public.business_offers(uuid,float8,float8) to anon, authenticated, service_role;
