/*
 * What the checkout screen needs to say before anything is charged: which provider takes the
 * payment and whether it is Stripe's test mode (then the sheet shows the test card to use).
 */
insert into private.settings (key, value) values ('stripe_test_mode', 'true') on conflict (key) do nothing;

create function public.payments_mode() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'provider', coalesce(private.setting('payments_provider'), 'demo'),
    'test', coalesce(private.setting('stripe_test_mode'), 'true') = 'true')
$$;
grant execute on function public.payments_mode() to anon, authenticated;
