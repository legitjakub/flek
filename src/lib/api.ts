import { supabase } from './supabase';
import { result } from './errors';
import { noteServerNow } from './clock';
import type {
  AdminBooking,
  AdminBusiness,
  AdminMetrics,
  AdminUser,
  Business,
  Category,
  CustomerBooking,
  CustomerMetrics,
  FavoriteBusiness,
  FavoriteOffer,
  MerchantBooking,
  MerchantBookingDetail,
  MerchantMetrics,
  MerchantOffer,
  OfferDetail,
  Payment,
  Profile,
  PublicBusiness,
  ReferralClaim,
  ReferralStats,
  SearchRow,
  ServicePhoto,
  Service,
  SortKey,
} from '../types/database';

/** Records the server clock carried by any payload that exposes it. */
function withClock<T extends { server_now?: string }>(rows: T[]): T[] {
  noteServerNow(rows[0]?.server_now);
  return rows;
}

export type SearchParams = {
  lat: number;
  lng: number;
  radius_m: number;
  category: string | null;
  from: string | null;
  until: string | null;
  min_discount_pct: number;
  max_price_cents: number | null;
  sort: SortKey;
  daypart: 'morning' | 'afternoon' | 'evening' | null;
  limit?: number;
  offset?: number;
};

export async function searchOffers(p: SearchParams): Promise<SearchRow[]> {
  const rows = await result<SearchRow[]>(
    supabase.rpc('search_offers', {
      p_lat: p.lat,
      p_lng: p.lng,
      p_radius_m: p.radius_m,
      p_category: p.category,
      p_from: p.from,
      p_until: p.until,
      p_min_discount_pct: p.min_discount_pct,
      p_max_price_cents: p.max_price_cents,
      p_sort: p.sort,
      p_limit: p.limit ?? 20,
      p_offset: p.offset ?? 0,
      p_daypart: p.daypart,
    }),
  );
  return withClock(rows ?? []);
}

export async function getOfferDetail(id: string, at: { lat: number; lng: number } | null): Promise<OfferDetail | null> {
  const row = await result<OfferDetail | null>(
    supabase.rpc('get_offer_detail', { p_offer_id: id, p_lat: at?.lat ?? null, p_lng: at?.lng ?? null }),
  );
  noteServerNow(row?.server_now);
  return row;
}

export async function serverClock(): Promise<string> {
  const now = await result<string>(supabase.rpc('server_clock'));
  noteServerNow(now);
  return now;
}

export async function listCategories(): Promise<Category[]> {
  return (await result<Category[]>(supabase.from('categories').select('*').order('sort_order'))) ?? [];
}

export async function myProfile(userId: string): Promise<Profile | null> {
  return await result<Profile | null>(supabase.from('profiles').select('*').eq('id', userId).maybeSingle());
}

export async function saveProfile(input: {
  first_name: string;
  last_name: string;
  phone: string;
  avatar_url?: string | null;
}): Promise<Profile> {
  return await result<Profile>(
    supabase.rpc('save_profile', {
      p_first_name: input.first_name,
      p_last_name: input.last_name,
      p_phone: input.phone,
      p_avatar_url: input.avatar_url ?? null,
    }),
  );
}

/** Opens (or reuses) a payment attempt. The amount always comes from the offer row. */
export async function startPayment(offerId: string): Promise<Payment> {
  return await result<Payment>(supabase.rpc('start_payment', { p_offer_id: offerId }));
}

/**
 * Demo settlement. A real gateway never goes through here — it settles the same row from
 * its webhook, and this call disappears with the demo provider.
 */
export async function confirmDemoPayment(paymentId: string): Promise<Payment> {
  return await result<Payment>(supabase.rpc('demo_confirm_payment', { p_payment_id: paymentId }));
}

export async function createBooking(
  offerId: string,
  paymentId: string,
): Promise<{ booking_id: string; reservation_code: string }> {
  const rows = await result<{ booking_id: string; reservation_code: string }[]>(
    supabase.rpc('create_booking', { p_offer_id: offerId, p_payment_id: paymentId }),
  );
  const row = rows?.[0];
  if (!row) throw new Error('OFFER_UNAVAILABLE');
  return row;
}

export async function cancelBooking(bookingId: string): Promise<void> {
  await result(supabase.rpc('cancel_booking', { p_booking_id: bookingId }));
}

export async function rateBooking(bookingId: string, rating: number): Promise<void> {
  await result(supabase.rpc('rate_booking', { p_booking_id: bookingId, p_rating: rating }));
}

export async function myBookings(): Promise<CustomerBooking[]> {
  return withClock((await result<CustomerBooking[]>(supabase.rpc('my_bookings'))) ?? []);
}

/* ----------------------------------------------------------------- favourites */

export async function toggleFavorite(businessId: string): Promise<boolean> {
  return (await result<boolean>(supabase.rpc('toggle_favorite', { p_business_id: businessId }))) === true;
}

/**
 * States the desired value instead of flipping the current one. A toggle replayed after
 * authentication can undo the very intent it was meant to carry out; this cannot.
 */
export async function setFavorite(businessId: string, value: boolean): Promise<boolean> {
  return (await result<boolean>(supabase.rpc('set_favorite', { p_business_id: businessId, p_value: value }))) === true;
}

/** Read like categories: public reference data, ordered for a stable picker. */
export async function listServicePhotos(): Promise<ServicePhoto[]> {
  return (
    (await result<ServicePhoto[]>(
      supabase.from('service_photos').select('*').order('category_slug').order('sort_order'),
    )) ?? []
  );
}

/**
 * A venue's own page. Public on purpose: a link handed to someone who has never opened FLEK
 * has to render before they sign in.
 */
export async function businessPublic(id: string): Promise<PublicBusiness | null> {
  return await result<PublicBusiness | null>(supabase.rpc('business_public', { p_business_id: id }));
}

/** Every bookable offer at one venue, soonest first, shaped exactly like a search row. */
export async function businessOffers(id: string, at: { lat: number; lng: number } | null): Promise<SearchRow[]> {
  return withClock(
    (await result<SearchRow[]>(
      supabase.rpc('business_offers', { p_business_id: id, p_lat: at?.lat ?? null, p_lng: at?.lng ?? null }),
    )) ?? [],
  );
}

export async function myFavorites(): Promise<FavoriteBusiness[]> {
  return (await result<FavoriteBusiness[]>(supabase.rpc('my_favorites'))) ?? [];
}

export async function newAtFavorites(): Promise<FavoriteOffer[]> {
  return withClock((await result<FavoriteOffer[]>(supabase.rpc('new_at_favorites', { p_limit: 20 }))) ?? []);
}

export async function newAtFavoritesCount(): Promise<number> {
  return (await result<number>(supabase.rpc('new_at_favorites_count'))) ?? 0;
}

export async function markFavoritesSeen(): Promise<void> {
  await result(supabase.rpc('mark_favorites_seen'));
}

export async function isAdmin(): Promise<boolean> {
  return (await result<boolean>(supabase.rpc('is_admin'))) === true;
}

/* ---------------------------------------------------------------- merchant */

export async function myBusinesses(): Promise<Business[]> {
  return (await result<Business[]>(supabase.rpc('my_businesses'))) ?? [];
}

export async function createBusiness(data: Record<string, unknown>): Promise<Business> {
  return await result<Business>(supabase.rpc('create_business', { p_data: data }));
}

export async function updateBusiness(businessId: string, data: Record<string, unknown>): Promise<Business> {
  return await result<Business>(supabase.rpc('update_business', { p_business_id: businessId, p_data: data }));
}

export async function listServices(businessId: string): Promise<Service[]> {
  return (
    (await result<Service[]>(
      supabase.from('services').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
    )) ?? []
  );
}

export async function saveService(
  businessId: string,
  data: Record<string, unknown>,
  serviceId?: string | null,
): Promise<Service> {
  return await result<Service>(
    supabase.rpc('save_service', { p_business_id: businessId, p_data: data, p_service_id: serviceId ?? null }),
  );
}

export async function publishOffer(input: {
  service_id: string;
  start_at: string;
  deal_price_cents: number;
  capacity_total: number;
  booking_cutoff_at: string | null;
  confirm_overlap?: boolean;
}) {
  return await result(
    supabase.rpc('publish_offer', {
      p_service_id: input.service_id,
      p_start_at: input.start_at,
      p_deal_price_cents: input.deal_price_cents,
      p_capacity_total: input.capacity_total,
      p_booking_cutoff_at: input.booking_cutoff_at,
      p_confirm_overlap: input.confirm_overlap ?? false,
    }),
  );
}

export async function updateOffer(offerId: string, data: Record<string, unknown>, confirmOverlap = false) {
  return await result(
    supabase.rpc('update_offer', { p_offer_id: offerId, p_data: data, p_confirm_overlap: confirmOverlap }),
  );
}

export async function merchantCancelOffer(offerId: string, reason: string): Promise<void> {
  await result(supabase.rpc('merchant_cancel_offer', { p_offer_id: offerId, p_reason: reason }));
}

export async function merchantOffers(businessId: string, from?: string, until?: string): Promise<MerchantOffer[]> {
  return withClock(
    (await result<MerchantOffer[]>(
      supabase.rpc('merchant_offers', { p_business_id: businessId, p_from: from ?? null, p_until: until ?? null }),
    )) ?? [],
  );
}

export async function merchantBookings(businessId: string, from?: string, until?: string): Promise<MerchantBooking[]> {
  return withClock(
    (await result<MerchantBooking[]>(
      supabase.rpc('merchant_bookings', { p_business_id: businessId, p_from: from ?? null, p_until: until ?? null }),
    )) ?? [],
  );
}

export async function merchantLookupBooking(code: string): Promise<MerchantBookingDetail | null> {
  return await result<MerchantBookingDetail | null>(supabase.rpc('merchant_lookup_booking', { p_code: code }));
}

export async function merchantBookingDetail(bookingId: string): Promise<MerchantBookingDetail | null> {
  return await result<MerchantBookingDetail | null>(supabase.rpc('merchant_booking_detail', { p_booking_id: bookingId }));
}

export async function resolveBooking(bookingId: string, outcome: 'completed' | 'no_show'): Promise<void> {
  await result(supabase.rpc('merchant_resolve_booking', { p_booking_id: bookingId, p_outcome: outcome }));
}

export async function merchantMetrics(businessId: string): Promise<MerchantMetrics> {
  return await result<MerchantMetrics>(supabase.rpc('merchant_metrics', { p_business_id: businessId }));
}

/* ------------------------------------------------------------------- admin */

export async function adminBusinesses(status: string | null): Promise<AdminBusiness[]> {
  return (await result<AdminBusiness[]>(supabase.rpc('admin_businesses', { p_status: status }))) ?? [];
}

export async function adminSetBusinessStatus(businessId: string, status: string, reason: string | null): Promise<void> {
  await result(supabase.rpc('admin_set_business_status', { p_business_id: businessId, p_status: status, p_reason: reason }));
}

export async function adminSetGooglePlaceId(businessId: string, placeId: string | null): Promise<void> {
  await result(
    supabase.rpc('admin_set_google_place_id', {
      p_business_id: businessId,
      p_place_id: placeId,
    }),
  );
}

export type GooglePlaceRatingData = {
  rating: number;
  userRatingCount: number;
  googleMapsUri: string;
};

/** Google content is returned directly and deliberately never written to our database. */
export async function googlePlaceRating(businessId: string): Promise<GooglePlaceRatingData | null> {
  const { data, error } = await supabase.functions.invoke<GooglePlaceRatingData | null>('google-place-rating', {
    body: { business_id: businessId },
  });
  if (error) throw error;
  return data;
}

export async function adminOffers(query: string): Promise<MerchantOffer[]> {
  return (await result<MerchantOffer[]>(supabase.rpc('admin_offers', { p_query: query, p_limit: 50 }))) ?? [];
}

export async function adminBookings(query: string): Promise<AdminBooking[]> {
  return (await result<AdminBooking[]>(supabase.rpc('admin_bookings', { p_query: query, p_limit: 50 }))) ?? [];
}

export async function adminUserLookup(email: string): Promise<AdminUser[]> {
  return (await result<AdminUser[]>(supabase.rpc('admin_user_lookup', { p_email: email }))) ?? [];
}

export async function adminSetBookingBlock(userId: string, blocked: boolean, overrideNoShows = false): Promise<void> {
  await result(
    supabase.rpc('admin_set_booking_block', {
      p_user_id: userId,
      p_blocked: blocked,
      p_override_no_shows: overrideNoShows,
    }),
  );
}

export async function adminMetrics(): Promise<AdminMetrics> {
  return await result<AdminMetrics>(supabase.rpc('admin_metrics'));
}

export async function myCustomerMetrics(): Promise<CustomerMetrics | null> {
  return await result<CustomerMetrics | null>(supabase.rpc('my_customer_metrics'));
}

export async function myReferralCode(): Promise<string | null> {
  return await result<string | null>(supabase.rpc('my_referral_code'));
}

export async function myReferralStats(): Promise<ReferralStats | null> {
  return await result<ReferralStats | null>(supabase.rpc('my_referral_stats'));
}

/** Anonymous: the invitation landing page has to render before anyone signs in. */
export async function resolveReferralCode(code: string): Promise<{ valid: boolean; first_name: string | null }> {
  return (
    (await result<{ valid: boolean; first_name: string | null }>(
      supabase.rpc('resolve_referral_code', { p_code: code }),
    )) ?? { valid: false, first_name: null }
  );
}

/** Idempotent, and decided entirely on the server: the browser never asserts who referred whom. */
export async function claimReferral(code: string): Promise<ReferralClaim> {
  return (
    (await result<ReferralClaim>(supabase.rpc('claim_referral', { p_code: code }))) ?? {
      claimed: false,
      reason: 'unknown_code',
    }
  );
}
