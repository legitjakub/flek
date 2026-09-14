-- Privileged regression test for refund states: every fixture and side effect is rolled back.
-- Run against a migrated demo database (with demo-customer and at least one offer).
begin;
do $$
declare
 customer uuid; offer uuid; queued uuid; external uuid; outcome text; raised boolean := false;
 pay public.payments;
begin
 select id into customer from auth.users where email='demo-customer@flek.test';
 select id into offer from public.offers order by created_at desc limit 1;
 assert customer is not null and offer is not null, 'Demo fixtures missing';

 -- A refund FLEK asked for (a cancelled booking): paid, in the refund queue.
 insert into public.payments(customer_id,offer_id,amount_cents,status,provider,paid_at,payment_intent_id,refund_requested_at)
 values(customer,offer,78800,'paid','stripe',now()-interval '1 hour','pi_qa_queued',now()) returning id into queued;

 -- Accepted is not refunded: pending and requires_action keep the payment paid and in the queue.
 outcome := public.stripe_refund_update(queued,'re_qa_1','pending');
 select * into pay from public.payments where id=queued;
 assert outcome='pending' and pay.status='paid' and pay.refund_id='re_qa_1' and pay.refund_status='pending'
  and pay.refunded_at is null and pay.refund_attempts=0, 'Pending refund treated as done';
 outcome := public.stripe_refund_update(queued,'re_qa_1','requires_action');
 select * into pay from public.payments where id=queued;
 assert outcome='pending' and pay.status='paid' and pay.refund_status='requires_action', 'requires_action treated as done';

 -- Only succeeded makes the payment refunded.
 outcome := public.stripe_refund_update(queued,'re_qa_1','succeeded');
 select * into pay from public.payments where id=queued;
 assert outcome='refunded' and pay.status='refunded' and pay.refunded_at is not null and pay.refund_status='succeeded', 'Succeeded refund not recorded';

 -- A refund that fails after it looked done is money not returned: paid again, with the reason,
 -- and out of the automatic queue for a person to handle.
 outcome := public.stripe_refund_update(queued,'re_qa_1','failed','expired_or_canceled_card');
 select * into pay from public.payments where id=queued;
 assert outcome='failed' and pay.status='paid' and pay.refunded_at is null and pay.refund_attempts=0
  and pay.refund_status='failed' and pay.refund_error='expired_or_canceled_card', 'Late refund failure not recorded';
 assert exists (select 1 from public.analytics_events where name='refund_failed' and props->>'payment_id'=queued::text), 'Refund failure not logged';
 assert not exists (select 1 from public.payments where id=queued and provider='stripe' and status='paid' and refund_requested_at is not null
  and refund_attempts<8 and coalesce(refund_status,'') not in ('failed','canceled')), 'Failed refund still in the automatic queue';

 -- Stripe never revives a failed refund: repeated or out-of-order news about it changes nothing.
 outcome := public.stripe_refund_update(queued,'re_qa_1','failed','expired_or_canceled_card');
 assert outcome='failed' and (select refund_status='failed' from public.payments where id=queued), 'Repeated failure changed the payment';
 outcome := public.stripe_refund_update(queued,'re_qa_1','succeeded');
 assert outcome='failed' and (select status='paid' from public.payments where id=queued), 'Failed refund revived as refunded';

 -- A new refund made by a person replaces the failed one; news about the old one no longer counts.
 outcome := public.stripe_refund_update(queued,'re_qa_2','pending');
 assert outcome='pending' and (select refund_id='re_qa_2' and refund_status='pending' from public.payments where id=queued), 'New refund not recorded';
 outcome := public.stripe_refund_update(queued,'re_qa_1','failed','late news');
 select * into pay from public.payments where id=queued;
 assert outcome='stale' and pay.refund_id='re_qa_2' and pay.refund_status='pending', 'Old refund overwrote the new one';
 outcome := public.stripe_refund_update(queued,'re_qa_2','succeeded');
 outcome := public.stripe_refund_update(queued,'re_qa_1','succeeded');
 select * into pay from public.payments where id=queued;
 assert outcome='stale' and pay.status='refunded' and pay.refund_id='re_qa_2', 'Stale success accepted';

 -- A refund FLEK did not ask for (made in the Stripe dashboard) is recorded without queuing anything.
 insert into public.payments(customer_id,offer_id,amount_cents,status,provider,paid_at,payment_intent_id)
 values(customer,offer,78800,'paid','stripe',now()-interval '1 hour','pi_qa_external') returning id into external;
 outcome := public.stripe_refund_update(external,'re_qa_x','canceled');
 select * into pay from public.payments where id=external;
 assert outcome='failed' and pay.status='paid' and pay.refund_requested_at is null and pay.refund_error='REFUND_CANCELED', 'External refund failure queued a new refund';

 assert public.stripe_refund_update(gen_random_uuid(),'re_qa_y','succeeded')='unknown_payment', 'Unknown payment not reported';
 begin
  perform public.stripe_refund_update(queued,'re_qa_2','done');
 exception when others then raised := sqlerrm='INVALID_REFUND_STATUS';
 end;
 assert raised, 'Unknown refund status accepted';

 assert to_regprocedure('public.stripe_refund_done(uuid,text)') is null, 'Blind refund call still exists';
 assert not has_function_privilege('anon','public.stripe_refund_update(uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.stripe_refund_update(uuid,text,text,text)','EXECUTE'), 'Clients can change refund state';
end $$;
rollback;
select 'PASS: refund states pending, requires_action, succeeded, late failure to a person, final failure, stale news, external refund and grants; all fixtures rolled back' as result;
