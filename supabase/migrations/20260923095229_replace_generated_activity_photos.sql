-- Replace only exact, previously shipped illustrative URLs. Merchant Storage URLs are untouched.
-- Source, author, licence and visual-check notes: docs/assets/activity-photo-sources.json.
-- Niche activities use the neutral brand fallback instead of an unrelated photo.
create or replace function private.is_allowed_picture(p_url text) returns boolean
language sql immutable set search_path = public as $$
  select p_url is null
    or p_url = '/images/flek-placeholder.svg'
    or p_url ~ '^/images/(services|activities)/[a-z0-9/_-]+\.(jpg|jpeg|png|webp)$'
    or p_url ~ '^https://images\.unsplash\.com/photo-[A-Za-z0-9-]+(\?[A-Za-z0-9=&%._-]*)?$'
    or p_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/(logos|covers|avatars)/'
    or p_url ~ '^http://127\.0\.0\.1:54321/storage/v1/object/public/(logos|covers|avatars)/'
$$;
revoke all on function private.is_allowed_picture(text) from public, anon, authenticated;

create temporary table flek_photo_replacements (
  slug text not null,
  old_url text not null,
  new_url text not null,
  primary key (slug, old_url)
) on commit drop;
insert into flek_photo_replacements (slug, old_url, new_url) values
  ('vlasy-pansky-strih', 'https://images.unsplash.com/photo-1600948836101-f9ffda59d250?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-pansky-strih', 'https://images.unsplash.com/photo-1781455793310-8427c96454c7?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1536520002442-39764a41e987?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-uprava-vousu', '/images/activities/vlasy-uprava-vousu-1.jpg', 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-uprava-vousu', '/images/activities/vlasy-uprava-vousu-2.jpg', 'https://images.unsplash.com/photo-1596362601603-b74f6ef166e4?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-damsky-strih', '/images/activities/vlasy-damsky-strih-1.jpg', 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-damsky-strih', '/images/activities/vlasy-damsky-strih-2.jpg', 'https://images.unsplash.com/photo-1626379499242-52863d313084?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-barveni', '/images/activities/vlasy-barveni-1.jpg', 'https://images.unsplash.com/photo-1605980625982-b128a7e7fde2?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-barveni', '/images/activities/vlasy-barveni-2.jpg', 'https://images.unsplash.com/photo-1785456411888-c2e842552820?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-myti-foukana', '/images/activities/vlasy-myti-foukana-1.jpg', 'https://images.unsplash.com/photo-1637777269308-6a072f24e8a4?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-myti-foukana', '/images/activities/vlasy-myti-foukana-2.jpg', 'https://images.unsplash.com/photo-1616105996583-f9e3c00bb31f?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-detsky-strih', '/images/activities/vlasy-detsky-strih-1.jpg', 'https://images.unsplash.com/photo-1599387737838-660b75526801?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-detsky-strih', '/images/activities/vlasy-detsky-strih-2.jpg', 'https://images.unsplash.com/photo-1584921425698-bc4b12745d60?w=800&q=70&auto=format&fit=crop'),
  ('masaze-relaxacni', '/images/activities/masaze-relaxacni-1.jpg', 'https://images.unsplash.com/photo-1630835425197-50feeba99ecd?w=800&q=70&auto=format&fit=crop'),
  ('masaze-relaxacni', '/images/activities/masaze-relaxacni-2.jpg', 'https://images.unsplash.com/photo-1630835474626-b4de96a25186?w=800&q=70&auto=format&fit=crop'),
  ('masaze-thajska', '/images/activities/masaze-thajska-1.jpg', 'https://images.unsplash.com/photo-1639162906614-0603b0ae95fd?w=800&q=70&auto=format&fit=crop'),
  ('masaze-thajska', '/images/activities/masaze-thajska-2.jpg', 'https://images.unsplash.com/photo-1611073615452-4889cb93422e?w=800&q=70&auto=format&fit=crop'),
  ('masaze-zada-sije', '/images/activities/masaze-zada-sije-1.jpg', 'https://images.unsplash.com/photo-1630835425197-50feeba99ecd?w=800&q=70&auto=format&fit=crop'),
  ('masaze-zada-sije', '/images/activities/masaze-zada-sije-2.jpg', 'https://images.unsplash.com/photo-1700142360825-d21edc53c8db?w=800&q=70&auto=format&fit=crop'),
  ('masaze-sportovni', '/images/activities/masaze-sportovni-1.jpg', 'https://images.unsplash.com/photo-1741522509438-a120c0bb5e88?w=800&q=70&auto=format&fit=crop'),
  ('masaze-sportovni', '/images/activities/masaze-sportovni-2.jpg', 'https://images.unsplash.com/photo-1712638932314-e2b185ca0930?w=800&q=70&auto=format&fit=crop'),
  ('masaze-chodidla', '/images/activities/masaze-chodidla-1.jpg', 'https://images.unsplash.com/photo-1728497872660-cc6b16238c3a?w=800&q=70&auto=format&fit=crop'),
  ('masaze-chodidla', '/images/activities/masaze-chodidla-2.jpg', 'https://images.unsplash.com/photo-1577117633143-a2437fb9bdda?w=800&q=70&auto=format&fit=crop'),
  ('masaze-lavove-kameny', '/images/activities/masaze-lavove-kameny-1.jpg', 'https://images.unsplash.com/photo-1696841212541-449ca29397cc?w=800&q=70&auto=format&fit=crop'),
  ('masaze-lavove-kameny', '/images/activities/masaze-lavove-kameny-2.jpg', 'https://images.unsplash.com/photo-1610402601271-5b4bd5b3eba4?w=800&q=70&auto=format&fit=crop'),
  ('krasa-manikura', 'https://images.unsplash.com/photo-1599948128020-9a44505b0d1b?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1660505102581-85cffa4e6550?w=800&q=70&auto=format&fit=crop'),
  ('krasa-manikura', 'https://images.unsplash.com/photo-1602585578130-c9076e09330d?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1779636198585-658170ee0283?w=800&q=70&auto=format&fit=crop'),
  ('krasa-gel-lak', '/images/activities/krasa-gel-lak-1.jpg', 'https://images.unsplash.com/photo-1602585578130-c9076e09330d?w=800&q=70&auto=format&fit=crop'),
  ('krasa-gel-lak', '/images/activities/krasa-gel-lak-2.jpg', 'https://images.unsplash.com/photo-1636019411401-82485711b6ba?w=800&q=70&auto=format&fit=crop'),
  ('krasa-pedikura', '/images/activities/krasa-pedikura-1.jpg', 'https://images.unsplash.com/photo-1519415510236-718bdfcd89c8?w=800&q=70&auto=format&fit=crop'),
  ('krasa-pedikura', '/images/activities/krasa-pedikura-2.jpg', 'https://images.unsplash.com/photo-1596740926849-2d473dee8d60?w=800&q=70&auto=format&fit=crop'),
  ('krasa-kosmeticke-osetreni', '/images/activities/krasa-kosmeticke-osetreni-1.jpg', 'https://images.unsplash.com/photo-1595871151608-bc7abd1caca3?w=800&q=70&auto=format&fit=crop'),
  ('krasa-kosmeticke-osetreni', '/images/activities/krasa-kosmeticke-osetreni-2.jpg', 'https://images.unsplash.com/photo-1630835425197-50feeba99ecd?w=800&q=70&auto=format&fit=crop'),
  ('krasa-oboci', '/images/activities/krasa-oboci-1.jpg', 'https://images.unsplash.com/photo-1620531940052-d0d9aff03c32?w=800&q=70&auto=format&fit=crop'),
  ('krasa-oboci', '/images/activities/krasa-oboci-2.jpg', 'https://images.unsplash.com/photo-1636934432265-7b770c648a4e?w=800&q=70&auto=format&fit=crop'),
  ('krasa-rasy', '/images/activities/krasa-rasy-1.jpg', 'https://images.unsplash.com/photo-1589710751893-f9a6770ad71b?w=800&q=70&auto=format&fit=crop'),
  ('krasa-rasy', '/images/activities/krasa-rasy-2.jpg', 'https://images.unsplash.com/photo-1735151225764-eac694642dbf?w=800&q=70&auto=format&fit=crop'),
  ('sport-padel', 'https://images.unsplash.com/photo-1658723826297-fe4d1b1e6600?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1658491830143-72808ca237e3?w=800&q=70&auto=format&fit=crop'),
  ('sport-padel', 'https://images.unsplash.com/photo-1657704358775-ed705c7388d2?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1709587823868-735f9375ae74?w=800&q=70&auto=format&fit=crop'),
  ('sport-tenis', 'https://images.unsplash.com/photo-1685880423505-3a9a5515efd9?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1620742820748-87c09249a72a?w=800&q=70&auto=format&fit=crop'),
  ('sport-tenis', 'https://images.unsplash.com/photo-1774532665451-eff4bcd879e0?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1567220720374-a67f33b2a6b9?w=800&q=70&auto=format&fit=crop'),
  ('sport-squash', '/images/activities/sport-squash-1.jpg', 'https://images.unsplash.com/photo-1711294545092-303f7161017c?w=800&q=70&auto=format&fit=crop'),
  ('sport-squash', '/images/activities/sport-squash-2.jpg', '/images/flek-placeholder.svg'),
  ('sport-badminton', '/images/activities/sport-badminton-1.jpg', 'https://images.unsplash.com/photo-1617696618050-b0fef0c666af?w=800&q=70&auto=format&fit=crop'),
  ('sport-badminton', '/images/activities/sport-badminton-2.jpg', 'https://images.unsplash.com/photo-1775993167393-f2add1f8eec2?w=800&q=70&auto=format&fit=crop'),
  ('sport-osobni-trenink', 'https://images.unsplash.com/photo-1712220403561-bcf3f59d5927?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1637430308606-86576d8fef3c?w=800&q=70&auto=format&fit=crop'),
  ('sport-osobni-trenink', 'https://images.unsplash.com/photo-1639906188555-935e08bbcdf0?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1623874106686-5be2b325c8f1?w=800&q=70&auto=format&fit=crop'),
  ('sport-skupinova-lekce', '/images/activities/sport-skupinova-lekce-1.jpg', 'https://images.unsplash.com/photo-1786788191523-26efefeadc81?w=800&q=70&auto=format&fit=crop'),
  ('sport-skupinova-lekce', '/images/activities/sport-skupinova-lekce-2.jpg', 'https://images.unsplash.com/photo-1787647089626-e76f1d0275d1?w=800&q=70&auto=format&fit=crop'),
  ('sport-pujceni-kola', 'https://images.unsplash.com/photo-1745947454393-74bc35250ffa?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1561840884-9dda41ed54e4?w=800&q=70&auto=format&fit=crop'),
  ('sport-pujceni-kola', 'https://images.unsplash.com/photo-1682737789112-badb2cf078b5?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1670528148728-7ac7f5dc1123?w=800&q=70&auto=format&fit=crop'),
  ('joga-vinyasa', '/images/activities/joga-vinyasa-1.jpg', 'https://images.unsplash.com/photo-1761971975962-9cc397e2ba2a?w=800&q=70&auto=format&fit=crop'),
  ('joga-vinyasa', '/images/activities/joga-vinyasa-2.jpg', 'https://images.unsplash.com/photo-1734640817404-a0e4e0cc24c2?w=800&q=70&auto=format&fit=crop'),
  ('joga-jemna', '/images/activities/joga-jemna-1.jpg', 'https://images.unsplash.com/photo-1687783615494-b4a1f1af8b58?w=800&q=70&auto=format&fit=crop'),
  ('joga-jemna', '/images/activities/joga-jemna-2.jpg', 'https://images.unsplash.com/photo-1687783615476-f4c12358ca9d?w=800&q=70&auto=format&fit=crop'),
  ('joga-power', '/images/activities/joga-power-1.jpg', 'https://images.unsplash.com/photo-1591291621164-2c6367723315?w=800&q=70&auto=format&fit=crop'),
  ('joga-power', '/images/activities/joga-power-2.jpg', 'https://images.unsplash.com/photo-1687783615476-f4c12358ca9d?w=800&q=70&auto=format&fit=crop'),
  ('joga-rani-protazeni', 'https://images.unsplash.com/photo-1646239646963-b0b9be56d6b5?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1637157216470-d92cd2edb2e8?w=800&q=70&auto=format&fit=crop'),
  ('joga-rani-protazeni', 'https://images.unsplash.com/photo-1763004871583-4183d64096b1?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1687783615494-b4a1f1af8b58?w=800&q=70&auto=format&fit=crop'),
  ('joga-zacatecnici', '/images/activities/joga-zacatecnici-1.jpg', 'https://images.unsplash.com/photo-1687783615494-b4a1f1af8b58?w=800&q=70&auto=format&fit=crop'),
  ('joga-zacatecnici', '/images/activities/joga-zacatecnici-2.jpg', 'https://images.unsplash.com/photo-1687783615476-f4c12358ca9d?w=800&q=70&auto=format&fit=crop'),
  ('joga-meditace', '/images/activities/joga-meditace-1.jpg', 'https://images.unsplash.com/photo-1767605565789-5b18cdbbf6ae?w=800&q=70&auto=format&fit=crop'),
  ('joga-meditace', '/images/activities/joga-meditace-2.jpg', '/images/flek-placeholder.svg'),
  ('wellness-privatni-sauna', '/images/activities/wellness-privatni-sauna-1.jpg', 'https://images.unsplash.com/photo-1717356495389-6ab1e5ff9d84?w=800&q=70&auto=format&fit=crop'),
  ('wellness-privatni-sauna', '/images/activities/wellness-privatni-sauna-2.jpg', 'https://images.unsplash.com/photo-1712659604528-b179a3634560?w=800&q=70&auto=format&fit=crop'),
  ('wellness-finska-sauna', '/images/activities/wellness-finska-sauna-1.jpg', 'https://images.unsplash.com/photo-1759300031446-88e81c8a26c9?w=800&q=70&auto=format&fit=crop'),
  ('wellness-finska-sauna', '/images/activities/wellness-finska-sauna-2.jpg', 'https://images.unsplash.com/photo-1757940556610-a114be4733bf?w=800&q=70&auto=format&fit=crop'),
  ('wellness-solna-jeskyne', '/images/activities/wellness-solna-jeskyne-1.jpg', '/images/flek-placeholder.svg'),
  ('wellness-solna-jeskyne', '/images/activities/wellness-solna-jeskyne-2.jpg', '/images/flek-placeholder.svg'),
  ('wellness-virivka', '/images/activities/wellness-virivka-1.jpg', 'https://images.unsplash.com/photo-1773423386572-4ad451dc6c26?w=800&q=70&auto=format&fit=crop'),
  ('wellness-virivka', '/images/activities/wellness-virivka-2.jpg', 'https://images.unsplash.com/photo-1781455495578-944c2dcbd2de?w=800&q=70&auto=format&fit=crop'),
  ('wellness-parni-lazen', '/images/activities/wellness-parni-lazen-1.jpg', 'https://images.unsplash.com/photo-1761470575018-135c213340eb?w=800&q=70&auto=format&fit=crop'),
  ('wellness-parni-lazen', '/images/activities/wellness-parni-lazen-2.jpg', '/images/flek-placeholder.svg'),
  ('wellness-odpocinek', 'https://images.unsplash.com/photo-1773924093206-9a433a14bb44?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1773924093206-9a433a14bb44?w=800&q=70&auto=format&fit=crop'),
  ('wellness-odpocinek', 'https://images.unsplash.com/photo-1761470575018-135c213340eb?w=800&q=70&auto=format&fit=crop', 'https://images.unsplash.com/photo-1776763019081-dd0b07a19846?w=800&q=70&auto=format&fit=crop'),
  ('sport-padel', '/images/services/padel-prague.jpg', 'https://images.unsplash.com/photo-1658491830143-72808ca237e3?w=800&q=70&auto=format&fit=crop'),
  ('sport-tenis', '/images/services/tennis-prague.jpg', 'https://images.unsplash.com/photo-1620742820748-87c09249a72a?w=800&q=70&auto=format&fit=crop'),
  ('sport-squash', '/images/services/squash-prague.jpg', 'https://images.unsplash.com/photo-1711294545092-303f7161017c?w=800&q=70&auto=format&fit=crop'),
  ('sport-badminton', '/images/services/badminton-prague.jpg', 'https://images.unsplash.com/photo-1617696618050-b0fef0c666af?w=800&q=70&auto=format&fit=crop'),
  ('sport-osobni-trenink', '/images/services/personal-training-prague.jpg', 'https://images.unsplash.com/photo-1637430308606-86576d8fef3c?w=800&q=70&auto=format&fit=crop'),
  ('sport-skupinova-lekce', '/images/services/group-class-prague.jpg', 'https://images.unsplash.com/photo-1786788191523-26efefeadc81?w=800&q=70&auto=format&fit=crop'),
  ('joga-vinyasa', '/images/services/yoga-prague.jpg', 'https://images.unsplash.com/photo-1761971975962-9cc397e2ba2a?w=800&q=70&auto=format&fit=crop'),
  ('wellness-privatni-sauna', '/images/services/sauna-prague.jpg', 'https://images.unsplash.com/photo-1717356495389-6ab1e5ff9d84?w=800&q=70&auto=format&fit=crop');

update public.service_photos p
set image_url = r.new_url
from flek_photo_replacements r
where p.slug = r.slug and p.image_url = r.old_url;

update public.services s
set image_url = nullif(r.new_url, '/images/flek-placeholder.svg'), updated_at = now()
from flek_photo_replacements r
where s.image_url = r.old_url
  and (s.template_slug is null or s.template_slug = r.slug);

update public.businesses b
set cover_url = nullif(r.new_url, '/images/flek-placeholder.svg'), updated_at = now()
from flek_photo_replacements r
where b.cover_url = r.old_url;
