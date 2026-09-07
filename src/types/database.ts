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
  status: BusinessStatus;
  status_reason: string | null;
  commission_rate: number;
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
  distance_m: number;
  discount_pct: number;
  score: number;
  server_now: string;
};

export type OfferDetail = SearchRow & {
  status: OfferStatus;
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

export type SortKey = 'recommended' | 'nearest' | 'discount' | 'cheapest' | 'soonest';
