/*
 * Indexy na cizí klíče, které hlásil výkonnostní poradce Supabase 21. 9. Bez nich musí Postgres
 * u každého čtení podle rodiče projít celou tabulku — a hlavně kontrola cizího klíče při mazání
 * rodiče (smazání účtu, podniku, nabídky) čte potomky sekvenčně.
 *
 * Fronta kontroly obsahu (`private.content_moderation`) je už pokrytá migrací 20260921132349.
 */
create index if not exists services_business on public.services (business_id);
create index if not exists services_category on public.services (category_slug);
create index if not exists businesses_category on public.businesses (category_slug);
create index if not exists favorites_business on public.favorites (business_id);
create index if not exists notifications_business on public.notifications (business_id) where business_id is not null;
create index if not exists notifications_booking on public.notifications (booking_id) where booking_id is not null;
create index if not exists bookings_offer_business on public.bookings (offer_id, business_id);
create index if not exists bookings_decided_by on public.bookings (merchant_decided_by) where merchant_decided_by is not null;
create index if not exists offers_service_business on public.offers (service_id, business_id);
create index if not exists content_reports_business on public.content_reports (business_id) where business_id is not null;
create index if not exists content_reports_offer on public.content_reports (offer_id) where offer_id is not null;
create index if not exists content_reports_resolver on public.content_reports (resolved_by) where resolved_by is not null;
create index if not exists analytics_events_user on public.analytics_events (user_id) where user_id is not null;
create index if not exists push_subscriptions_user on private.push_subscriptions (user_id);
create index if not exists whatsapp_messages_business on private.whatsapp_messages (business_id) where business_id is not null;
create index if not exists whatsapp_contacts_consent_by on private.whatsapp_contacts (consent_by) where consent_by is not null;
create index if not exists legal_acceptances_document on private.legal_acceptances (kind, version);
