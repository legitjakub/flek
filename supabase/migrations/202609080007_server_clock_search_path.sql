-- server_clock was the one function left with a role-mutable search_path.
-- Caught by the Supabase database linter after the migrations were applied for real.
create or replace function public.server_clock() returns timestamptz
language sql stable set search_path=public as $$ select now(); $$;
revoke execute on function public.server_clock() from public,anon,authenticated;
grant execute on function public.server_clock() to anon,authenticated,service_role;
