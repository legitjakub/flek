-- Demo-only publication and service-search regression; all changes roll back.
begin;
do $$
declare merchant uuid; service public.services; offer public.offers; lat float8; lng float8;
  price integer; queue_before bigint; accented uuid[]; plain uuid[];
begin
  select id into merchant from auth.users where email='demo-merchant@flek.test';
  assert merchant is not null, 'Demo merchant missing';
  select s.* into service from public.services s join public.business_members m on m.business_id=s.business_id
    join public.businesses b on b.id=s.business_id
    where m.user_id=merchant and b.status='approved' and s.is_active
      and s.default_merchant_price_cents is not null order by s.id limit 1;
  assert service.id is not null, 'Active demo service missing';
  select extensions.st_y(location::extensions.geometry),extensions.st_x(location::extensions.geometry)
    into lat,lng from public.businesses where id=service.business_id;
  select count(*) into queue_before from private.content_moderation;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',merchant,'role','authenticated')::text,true);
  offer := public.publish_flek(service.id,now()+interval '3 days',service.default_merchant_price_cents,
    p_confirm_overlap=>true);
  assert offer.status='published', 'Publication must be immediate';
  assert exists(select 1 from public.search_offers(lat,lng,25000,p_from=>offer.start_at,
    p_until=>offer.start_at+interval '1 second',p_limit=>300,p_query=>service.name) where id=offer.id),
    'Published offer must be immediately discoverable';
  assert (select count(*) from private.content_moderation)=queue_before, 'Publishing a term must not queue moderation';

  select array_agg(id order by id) into accented from public.search_offers(lat,lng,25000,p_limit=>300,p_query=>'MASÁŽ');
  select array_agg(id order by id) into plain from public.search_offers(lat,lng,25000,p_limit=>300,p_query=>'masaz');
  assert cardinality(accented)>0 and accented=plain, 'Case and Czech accents must not change results';
  assert not exists(select 1 from public.search_offers(lat,lng,25000,p_query=>'%')), 'Search is literal, not a LIKE pattern';
  assert not exists(select 1 from public.search_offers(lat,lng,25000,p_query=>'no-such-service-e2e')), 'No unrelated fallback';
  begin
    perform public.search_offers(lat,lng,p_query=>repeat('x',81));
    raise exception 'Query limit not enforced';
  exception when others then
    if sqlerrm <> 'VALIDATION_ERROR' then raise; end if;
  end;
end $$;
rollback;
