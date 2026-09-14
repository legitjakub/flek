-- Commit enum additions before the following migration uses them.
alter type public.booking_status add value if not exists 'pending_payment';
alter type public.booking_status add value if not exists 'pending_merchant';
alter type public.booking_status add value if not exists 'capturing';
alter type public.booking_status add value if not exists 'expired';
alter type public.booking_status add value if not exists 'rejected';
alter type public.booking_status add value if not exists 'payment_failed';
