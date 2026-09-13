/*
 * Runs private.flek_maintenance() every 15 minutes: bookings nobody marked "Nedorazil" are
 * completed 24 h after their end, and payments that were paid but never became a booking are
 * refunded after 30 minutes.
 *
 * Kept apart from the pricing migration on purpose: pg_cron is an extension of the hosted
 * database, and if it cannot be enabled here the pricing model must not be held back by it.
 * cron.schedule upserts by job name, so re-running this is harmless.
 */
create extension if not exists pg_cron;

select cron.schedule('flek-maintenance', '*/15 * * * *', $$select private.flek_maintenance()$$);
