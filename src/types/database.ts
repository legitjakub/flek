// Domain types mirroring supabase/migrations. Regenerate the authoritative file with
// `npm run db:types` once a Postgres instance is reachable; see LIMITATIONS.md.

export type BusinessStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type MemberRole = 'owner' | 'manager';
export type OfferStatus = 'draft' | 'published' | 'cancelled';
export type BookingStatus =
  | 'pending_payment'
  | 'pending_merchant'
  | 'capturing'
  | 'confirmed'
  | 'expired'
  | 'rejected'
  | 'payment_failed'
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
  content_status?: 'approved' | 'pending' | 'rejected';
  pending_moderation_id?: string | null;
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
  /** Prepared activity used to keep the photo gallery relevant; null for a custom service. */
  template_slug: string | null;
  /** What the merchant asked for last time on this service — prefills the next FLEK. */
  default_merchant_price_cents: number | null;
  default_capacity: number | null;
  is_active: boolean;
  created_at: string;
  content_status?: 'approved' | 'pending' | 'rejected';
  pending_moderation_id?: string | null;
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
  /** The split behind deal_price_cents, which is always the all-in customer price. */
  merchant_price_cents: number;
  service_fee_cents: number;
  fee_policy_version: number;
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
  /** Approved anonymous copy; pending or rejected text is never returned publicly. */
  review_body: string | null;
  review_status: 'pending' | 'approved' | 'rejected' | null;
  review_moderated_at: string | null;
  /** Snapshotted at booking time: a later policy change must not move the goalposts. */
  cancellation_window_minutes: number;
  payment_status: PaymentStatus | null;
  business_phone: string;
  can_cancel: boolean;
  cancellation_deadline: string;
  server_now: string;
  /** 1 for a booking that waited for the merchant; its code stays hidden until it was confirmed. */
  confirmation_version?: number;
  /** How long the seat is held while the customer is on Stripe's page. */
  checkout_expires_at?: string | null;
  /** The merchant's deadline, fixed by the server at authorisation. */
  confirmation_expires_at?: string | null;
  authorized_at?: string | null;
  confirmed_at?: string | null;
  merchant_decided_at?: string | null;
  authorization_state?: AuthorizationState;
};

export type AuthorizationState = 'none' | 'authorized' | 'release_pending' | 'released' | 'captured';

/** Raw `bookings` row: what the admin list RPCs return, without the customer view's extras. */
export type AdminBooking = Omit<CustomerBooking, 'business_phone' | 'can_cancel' | 'cancellation_deadline' | 'server_now'>;

export type MerchantBooking = Omit<CustomerBooking, 'business_phone' | 'can_cancel' | 'cancellation_deadline'> & {
  customer_id: string;
  customer_label: string;
  can_resolve: boolean;
  unresolved: boolean;
  server_now: string;
  /** What the merchant is paid for this booking, snapshot at booking time. */
  merchant_payout_cents: number;
  service_fee_cents: number;
  /** "Nedorazil" can be marked until then; after it the booking completes on its own. */
  resolution_deadline: string;
  decision_channel?: 'app' | 'whatsapp' | null;
};

/** What respond_to_booking answers: the request's state after the decision, and whether this call decided it. */
export type ConfirmationDecision = {
  status: BookingStatus;
  decided: boolean;
  confirmation_expires_at: string | null;
};

export type MerchantBookingDetail = MerchantBooking & {
  first_name?: string;
  last_name?: string;
  phone?: string;
};

export type MerchantOffer = {
  has_bookings: boolean;
  id: string;
  business_id: string;
  service_id: string;
  service_name: string;
  duration_minutes: number;
  start_at: string;
  end_at: string;
  booking_cutoff_at: string;
  original_price_cents: number;
  /** The all-in customer price. */
  deal_price_cents: number;
  /** What the merchant receives per booked seat. */
  merchant_price_cents: number;
  service_fee_cents: number;
  fee_policy_version: number;
  capacity_total: number;
  capacity_remaining: number;
  status: OfferStatus;
  cancellation_reason: string | null;
  booked: number;
  completed: number;
  /** Requests waiting for the merchant's answer or for the capture that follows it. */
  pending_requests?: number;
  bookable: boolean;
  published_at: string;
  server_now: string;
};

/** Keys exactly as merchant_metrics() returns them. */
export type MerchantMetrics = {
  published_offers: number;
  published_capacity: number;
  booked_capacity: number;
  completed: number;
  no_shows: number;
  cancelled: number;
  unresolved: number;
  /** Customer-paid value of completed bookings — not what the merchant receives. */
  recovered_cents: number;
  /** What the merchant earned this month: their own price, for completed and no-show bookings. */
  earned_cents: number;
  /** Merchant price of bookings still ahead. */
  upcoming_payout_cents: number;
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
  /** Customer price paid, completed and no-show bookings. */
  realized_cents: number;
  /** Paid out to merchants: their own prices. */
  merchant_payout_cents: number;
  /** FLEK's revenue: service fees. */
  service_fee_cents: number;
  funnel: { offer_viewed: number; booking_started: number; booking_created: number };
  merchant_funnel: {
    business_created: number;
    business_approved: number;
    with_service: number;
    with_offer: number;
    with_booking: number;
    with_completed_booking: number;
  };
  failures: { code: string; count: number }[];
};

export type AdminBusiness = Business & {
  owner_email: string | null;
  services: Pick<Service, 'id' | 'name' | 'duration_minutes' | 'normal_price_cents' | 'is_active'>[];
  upcoming_offers: number;
  /** Ukázkový podnik (všichni členové mají účet `@flek.test`) smí být schválený bez IČO. */
  is_demo: boolean;
  /** RPC posílá celý řádek provozovny, takže stav Stripe je tu taky. */
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  /** Co admin potřebuje ke kontrole poskytovatele. Nikdy číslo účtu ani datum narození. */
  billing: Pick<BusinessBilling,
    'ico' | 'dic' | 'seller_type' | 'legal_name' | 'contact_person' | 'contact_phone'
    | 'terms_accepted_at' | 'ares_name' | 'ares_address' | 'ares_checked_at'
    | 'billing_address_line' | 'billing_city' | 'billing_postal_code'> | null;
};

export type AdminUser = Profile & { email: string; bookings: AdminBooking[] };

export type AdminAuditEntry = {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  action: 'business_status_changed' | 'booking_block_changed' | 'google_place_id_changed' | string;
  target_type: 'business' | 'user' | string;
  target_id: string | null;
  target_label: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
};

export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed';

export type Payment = {
  id: string;
  customer_id: string;
  offer_id: string;
  amount_cents: number;
  status: PaymentStatus;
  provider: 'demo' | 'stripe';
  provider_reference: string | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  checkout_session_id?: string | null;
  refund_requested_at?: string | null;
};

export type PaymentsMode = { provider: 'stripe'; test: boolean; manual_confirmation?: boolean };

/** What the customer sees after coming back from Stripe Checkout. */
export type PaymentState = {
  id: string;
  offer_id: string;
  provider: 'demo' | 'stripe';
  status: PaymentStatus;
  amount_cents: number;
  refund_requested: boolean;
  /** Stripe's status of the latest refund; `failed` or `canceled` means the money did not go back. */
  refund_status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled' | null;
  failure_reason: string | null;
  booking_id: string | null;
  reservation_code: string | null;
  confirmation_version?: number;
  booking_status?: BookingStatus | null;
  confirmation_expires_at?: string | null;
  checkout_expires_at?: string | null;
  authorized_at?: string | null;
  merchant_decided_at?: string | null;
  confirmed_at?: string | null;
  start_at?: string | null;
  cancellation_reason?: string | null;
  authorization_state?: AuthorizationState;
  server_now?: string;
};

/** A rough, non-binding window for the booking sheet; the binding one is fixed at authorisation. */
export type ConfirmationQuote = { manual: boolean; window_seconds: number | null; hold_seconds: number; server_now: string };

export type WhatsAppSettings = {
  /** Whether FLEK has a WhatsApp number to pair with at all. */
  available: boolean;
  /** A venue's number (Provozovna) or the signed-in customer's own (Profil). */
  kind: 'business' | 'customer';
  status: 'off' | 'pending' | 'expired' | 'verified' | 'disabled';
  /** The saved number, or the one it would be: the venue's phone, or the customer's from their profile. */
  phone: string | null;
  pairing_expires_at: string | null;
  verified_at: string | null;
  /** Whether the signed-in person verified it. A venue's messages follow that member's preferences. */
  mine: boolean;
  flek_number: string | null;
  consent_version: string;
  server_now: string;
};

export type WhatsAppPairing = { code: string; expires_at: string; phone: string; flek_number: string; server_now: string };

export type BusinessPaymentsStatus = {
  provider: 'stripe';
  connected: boolean;
  /** New bookings wait for the venue's confirmation (the rollout switch, decided on the server). */
  manual_confirmation?: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  synced_at: string | null;
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
  rating_avg: number | null;
  rating_count: number;
};

/** business_billing_get returns `{}` before anything has been entered, so every field is optional. */
export type BusinessBilling = {
  ico?: string | null;
  dic?: string | null;
  legal_name?: string | null;
  bank_account?: string | null;
  billing_address_line?: string | null;
  billing_city?: string | null;
  billing_postal_code?: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  terms_accepted_at?: string | null;
  /** DAC7: a natural person in business or a legal entity; the birth date is kept only for the first. */
  seller_type?: 'individual' | 'entity' | null;
  birth_date?: string | null;
  country?: string | null;
  ares_name?: string | null;
  ares_address?: string | null;
  ares_checked_at?: string | null;
  /** Latest merchant terms version any member of the venue accepted. */
  terms_version?: string | null;
  /** Version in force, or null while none is published. */
  terms_current?: string | null;
  terms_accepted_current?: boolean;
  terms_upcoming?: string | null;
  terms_upcoming_at?: string | null;
  terms_upcoming_accepted?: boolean;
};

export type LegalKindKey = 'customer_terms' | 'merchant_terms' | 'privacy';

export type LegalDocumentState = {
  version: string | null;
  effective_at: string | null;
  upcoming_version: string | null;
  upcoming_effective_at: string | null;
};

export type LegalInfo = {
  operator: { name: string | null; ico: string | null; address: string | null; email: string | null };
  documents: Partial<Record<LegalKindKey, LegalDocumentState>>;
  server_now: string;
};

/** Who provides a service, as the customer sees it before booking. */
export type BusinessProvider = { name: string; ico: string | null; address: string | null; demo: boolean };

export type ContentReportReason = 'illegal' | 'misleading' | 'prohibited_service' | 'rights' | 'other';

export type AdminContentReport = {
  id: string;
  status: 'open' | 'actioned' | 'dismissed';
  reason: ContentReportReason;
  message: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  business_id: string;
  business_name: string;
  business_status: string;
  offer_id: string | null;
  service_name: string | null;
  offer_start_at: string | null;
  offer_status: string | null;
  reporter_email: string | null;
};

export type BusinessReview = {
  review_id: string;
  service_name: string;
  visited_at: string;
  rating: number;
  comment: string | null;
  rated_at: string;
  verified: true;
};

export type ContentModerationStatus =
  | 'pending'
  | 'processing'
  | 'manual_review'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'failed';

export type AdminContentModeration = {
  id: string;
  entity_type: 'service' | 'business' | 'review';
  entity_id: string;
  business_id: string | null;
  business_name: string | null;
  payload: Record<string, unknown>;
  image_paths: Record<string, string>;
  status: ContentModerationStatus;
  attempts: number;
  last_error: string | null;
  provider_result: Record<string, unknown> | null;
  created_at: string;
  resolved_at: string | null;
};

export type Dac7Row = {
  business_id: string;
  display_name: string;
  legal_name: string | null;
  seller_type: 'individual' | 'entity' | null;
  ico: string | null;
  dic: string | null;
  birth_date: string | null;
  country: string;
  address: string | null;
  stripe_account_id: string | null;
  ares_checked_at: string | null;
  demo: boolean;
} & Record<`q${1 | 2 | 3 | 4}_${'count' | 'payout_cents' | 'fee_cents'}`, number>;

export type AresLookup =
  | { found: false }
  | {
      found: true;
      ico: string;
      name: string;
      address: string;
      line: string | null;
      city: string | null;
      postal_code: string | null;
      seller_type: 'individual' | 'entity';
      dic: string | null;
      ended: boolean;
    };

/** A saved FLEK watch (`my_watches`). The point is stored rounded to about 100 m. */
export type FlekWatch = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  travel_mode: 'walk' | 'ride';
  travel_minutes: 10 | 20 | 30;
  radius_m: number;
  category: string | null;
  max_price_cents: number | null;
  min_discount_pct: number;
  daypart: 'morning' | 'afternoon' | 'evening' | null;
  follow_me: boolean;
  paused: boolean;
  created_at: string;
  last_alert_at: string | null;
  /** Bookable FLEKs the watch would match right now (next 48 hours). */
  matching_now: number;
};
