/*
 * Rezervační kód jen přes RPC (audit 28. 9., nález L1).
 *
 * Přihlášený měl SELECT na celou tabulku `bookings`, takže zákazník přes REST nebo realtime přečetl
 * `reservation_code` i u žádosti, kterou podnik ještě nepotvrdil. Uplatnit ho nešlo, ale pravidlo
 * zní, že nedohodnutá žádost kód nikdy neukáže. Přihlášený teď smí číst všechny sloupce kromě
 * kódu. Kód dál vrací jen RPC (`my_bookings`, `merchant_bookings`, `merchant_booking_detail`),
 * a to jen u dohodnuté rezervace.
 *
 * Aplikace tabulku přímo nečte. Realtime podniku kontroluje RLS dotazem na primární klíč a sloupec
 * bez práva jen vynechá z payloadu, který aplikace stejně nečte. Nový sloupec `bookings`
 * přihlášený neuvidí, dokud mu ho někdo výslovně nepovolí.
 */
do $$
declare cols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols
  from pg_attribute
  where attrelid = 'public.bookings'::regclass and attnum > 0 and not attisdropped and attname <> 'reservation_code';
  revoke select on public.bookings from authenticated;
  execute format('grant select (%s) on public.bookings to authenticated', cols);
end $$;
