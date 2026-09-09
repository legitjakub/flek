// Domain types mirroring supabase/migrations. Regenerate the authoritative file with
// `npm run db:types` once a Postgres instance is reachable; see LIMITATIONS.md.

export type BusinessStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type MemberRole = 'owner' | 'manager';
export type OfferStatus = 'draft' | 'published' | 'cancelled';
export type BookingStatus =
  | 'confirmed'
  | 'cancelled_by_customer'
  | 'cancelled_by_merchant'
  | 'completed'
  | 'no_show';

export type Category = { slug: string; label_cs: string; icon: string; sort_order: number };

export type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  avatar_url: string | null;
  no_show_count: number;
  booking_blocked: boolean;
};

export type Business = {
  id: string;
  display_name: string;
  legal_name: string | null;
  slug: string;
  description: string;
  category_slug: string;
  phone: string;
  public_email: string;
  website: string | null;
  address_line: string;
  city: string;
  district: string;
  postal_code: string;
  country: string;
  logo_url: string | null;
  cover_url: string | null;
  /** Stable Google identifier; rating data itself is fetched live and never persisted. */
  google_place_id: string | null;
  status: BusinessStatus;
  status_reason: string | null;
  commission_rate: number;
  /** Minutes before the start until a customer can still cancel for free. */
  cancellation_window_minutes: number;
  latitude: number;
  longitude: number;
  created_at: string;
};

export type Service = {
  id: string;
  business_id: string;
  name: string;
  description: string;
  category_slug: string;
  duration_minutes: number;
  normal_price_cents: number;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
};

/** One row of `search_offers`. `server_now` is the only trusted clock. */
export type SearchRow = {
  id: string;
  business_id: string;
  service_id: string;
  business_name: string;
  business_slug: string;
  service_name: string;
  description: string;
  category_slug: string;
  start_at: string;
  end_at: string;
  booking_cutoff_at: string;
  original_price_cents: number;
  deal_price_cents: number;
  capacity_total: number;
  capacity_remaining: number;
  address_line: string;
  city: string;
  district: string;
  latitude: number;
  longitude: number;
  cover_url: string | null;
  logo_url: string | null;
  image_url: string | null;
  distance_m: number | null;
  discount_pct: number;
  score: number;
  server_now: string;
  /** Legacy internal feedback kept for database compatibility; public UI uses Google Places. */
  rating_avg: number | null;
  rating_count: number;
  google_place_id: string | null;
};

export type OfferDetail = SearchRow & {
  status: OfferStatus;
  cancellation_window_minutes: number;
  business_description: string;
  business_phone: string;
  business_status: BusinessStatus;
  bookable: boolean;
  distance_m: number | null;
  cancellation_reason: string | null;
};

export type CustomerBooking = {
  id: string;
  offer_id: string;
  business_id: string;
  reservation_code: string;
  price_cents: number;
  service_name_snapshot: string;
  business_name_snapshot: string;
  business_address_snapshot: string;
  start_at_snapshot: string;
  end_at_snapshot: string;
  original_price_cents_snapshot: number;
  status: BookingStatus;
  created_at: string;
  cancelled_at: string | null;
  resolved_at: string | null;
  cancellation_reason: string | null;
  rating: number | null;
  rated_at: string | null;
  /** Snapshotted at booking time: a later policy change must not move the goalposts. */
  cancellation_window_minutes: number;
  payment_status: PaymentStatus | null;
  business_phone: string;
  can_cancel: boolean;
  cancellation_deadline: string;
  server_now: string;
};

/** Raw `bookings` row: what the admin list RPCs return, without the customer view's extras. */
export type AdminBooking = Omit<CustomerBooking, 'business_phone' | 'can_cancel' | 'cancellation_deadline' | 'server_now'>;

export type MerchantBooking = Omit<CustomerBooking, 'business_phone' | 'can_cancel' | 'cancellation_deadline'> & {
  customer_id: string;
  customer_label: string;
  can_resolve: boolean;
  unresolved: boolean;
  server_now: string;
};

export type MerchantBookingDetail = MerchantBooking & {
  first_name?: string;
  last_name?: string;
  phone?: string;
};

export type MerchantOffer = {
  id: string;
  business_id: string;
  service_id: string;
  service_name: string;
  duration_minutes: number;
  start_at: string;
  end_at: string;
  booking_cutoff_at: string;
  original_price_cents: number;
  deal_price_cents: number;
  capacity_total: number;
  capacity_remaining: number;
  status: OfferStatus;
  cancellation_reason: string | null;
  booked: number;
  completed: number;
  bookable: boolean;
  published_at: string;
  server_now: string;
};

export type MerchantMetrics = {
  published_offers: number;
  published_capacity: number;
  booked_capacity: number;
  bookings: number;
  completed: number;
  no_show: number;
  unresolved: number;
  recovered_cents: number;
  active_offers: number;
  today_bookings: number;
  /** People following this venue. Counted from favorites — not a notification delivery. */
  followers: number;
  free_seats: number;
};

export type AdminMetrics = {
  published_capacity: number;
  booked_capacity: number;
  fill_rate_by_category: { category: string; published: number; booked: number }[];
  median_minutes_to_first_booking: number | null;
  approved_businesses: number;
  repeat_merchants: number;
  repeat_customers: number;
  customers: number;
  completed: number;
  no_show: number;
  unresolved: number;
  realized_cents: number;
  commission_cents: number;
  funnel: { offer_viewed: number; booking_started: number; booking_created: number };
  failures: { code: string; count: number }[];
};

export type AdminBusiness = Business & {
  owner_email: string | null;
  services: Pick<Service, 'id' | 'name' | 'duration_minutes' | 'normal_price_cents' | 'is_active'>[];
  upcoming_offers: number;
};

export type AdminUser = Profile & { email: string; bookings: AdminBooking[] };

export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed';

export type Payment = {
  id: string;
  customer_id: string;
  offer_id: string;
  amount_cents: number;
  status: PaymentStatus;
  provider: string;
  provider_reference: string | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
};

export type FavoriteBusiness = Business & {
  favorited_at: string;
  seen_at: string;
  rating_avg: number | null;
  rating_count: number;
  open_offers: number;
  /** Offers published at this venue since the customer last looked at the list. */
  new_offers: number;
};

export type FavoriteOffer = SearchRow & {
  bookable: boolean;
  seen_at: string;
  is_new: boolean;
};

export type SortKey = 'recommended' | 'nearest' | 'discount' | 'cheapest' | 'soonest';

/** What FLEK has demonstrably saved this customer. Every figure comes from booking snapshots. */
export type CustomerMetrics = {
  month_completed: number;
  month_saved_cents: number;
  all_time_completed: number;
  all_time_saved_cents: number;
  /** Null until the first completed booking: "no best catch yet" is not "0 %". */
  best_discount_pct: number | null;
};

/** Invitations sent versus invitations that produced a customer who actually turned up. */
export type ReferralStats = { invited: number; qualified: number };

export type ReferralClaim = {
  claimed: boolean;
  reason: 'already_referred' | 'unknown_code' | 'self' | 'not_a_new_account' | null;
};

/** One activity a venue can sell, with the photograph that belongs to it. Reference data. */
export type ServicePhoto = {
  slug: string;
  category_slug: string;
  label_cs: string;
  /** Null for an activity we have no photograph we may honestly use for. */
  image_url: string | null;
  sort_order: number;
};

/** The public face of a venue: what its own page needs before any offer is loaded. */
export type PublicBusiness = {
  id: string;
  display_name: string;
  slug: string;
  description: string;
  category_slug: string;
  address_line: string;
  city: string;
  district: string | null;
  logo_url: string | null;
  cover_url: string | null;
  google_place_id: string | null;
  cancellation_window_minutes: number;
  latitude: number;
  longitude: number;
  open_offers: number;
};
