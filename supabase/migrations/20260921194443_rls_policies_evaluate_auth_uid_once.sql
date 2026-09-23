/*
 * Pět politik volalo `auth.uid()` pro každý řádek, takže se stejná hodnota počítala znovu a znovu
 * (hlášení `auth_rls_initplan`). `(select auth.uid())` ji vyhodnotí jednou jako poddotaz.
 *
 * Pravidla se nemění: ta samá podmínka, jen jinak zapsaná. `is_admin()` a `is_member_of()`
 * zůstávají beze změny, protože si uživatele zjišťují uvnitř.
 */
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using (id = (select auth.uid()) or public.is_admin());

drop policy members_read on public.business_members;
create policy members_read on public.business_members for select
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy bookings_read on public.bookings;
create policy bookings_read on public.bookings for select
  using (customer_id = (select auth.uid()) or public.is_member_of(business_id) or public.is_admin());

drop policy payments_read on public.payments;
create policy payments_read on public.payments for select
  using (customer_id = (select auth.uid()) or public.is_admin());

drop policy favorites_own on public.favorites;
create policy favorites_own on public.favorites for select
  using (user_id = (select auth.uid()) or public.is_admin());
