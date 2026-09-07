import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const url=process.env.SUPABASE_URL;
if(!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Real local Supabase required; use npm test.');
const anonKey=process.env.SUPABASE_ANON_KEY!;
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const anon=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
const run=randomUUID().slice(0,8), users:string[]=[], businesses:string[]=[];
type Client=typeof anon;
type Account={id:string;client:Client};
let merchant:Account, other:Account, adminUser:Account, biz:string, otherBiz:string, service:string;
async function user(phone=true):Promise<Account>{
 const email=`test-${run}-${randomUUID().slice(0,8)}@volno.test`, password='VolnoTest2026!';
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{first_name:'Jakub',last_name:'Hrncir'}});
 if(error)throw error; const id=data.user!.id; users.push(id);
 const client=createClient(url!,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const signed=await client.auth.signInWithPassword({email,password}); if(signed.error)throw signed.error;
 expect(signed.data.session?.access_token).toBeTruthy();
 if(phone){const r=await client.rpc('save_profile',{p_first_name:'Jakub',p_last_name:'Hrncir',p_phone:'+420777123456'});if(r.error)throw r.error;}
 return {id,client};
}
async function business(owner:Account,status='approved'){
 const {data,error}=await owner.client.rpc('create_business',{p_data:{display_name:`Test ${run}`,category_slug:'test',phone:'+420777123456',public_email:'test@volno.test',address_line:'Testovací 1',city:'Praha',postal_code:'12000',latitude:50.0755,longitude:14.4378}});
 if(error)throw error; businesses.push(data.id);
 await db.query('update public.businesses set status=$1 where id=$2',[status,data.id]);return data.id as string;
}
async function offer(cap=1,options:{business?:string;start?:number;cutoff?:number;status?:string}={}){
 const b=options.business??biz;
 const s=b===biz?service:(await db.query('insert into public.services(business_id,name,category_slug,duration_minutes,normal_price_cents) values($1,$2,$3,45,65000) returning id',[b,'Testovací střih','test'])).rows[0].id;
 const r=await db.query(`insert into public.offers(business_id,service_id,start_at,end_at,booking_cutoff_at,original_price_cents,deal_price_cents,capacity_total,capacity_remaining,status) values($1,$2,now()+$3*interval '1 minute',now()+($3+45)*interval '1 minute',now()+$4*interval '1 minute',65000,39000,$5,$5,$6) returning *`,[b,s,options.start??180,options.cutoff??150,cap,options.status??'published']);
 return r.rows[0] as {id:string;capacity_remaining:number};
}
async function book(a:Account,o:{id:string}){return a.client.rpc('create_booking',{p_offer_id:o.id});}
async function stored(id:string){return (await db.query('select * from public.offers where id=$1',[id])).rows[0] as {capacity_remaining:number;capacity_total:number};}
function code(error:{message:string}|null,expected:string){expect(error?.message).toContain(expected);}

beforeAll(async()=>{
 await db.query("insert into public.categories values('test','Test','scissors',999) on conflict do nothing");
 merchant=await user();other=await user();adminUser=await user();
 await db.query("insert into public.user_roles values($1,'admin')",[adminUser.id]);
 biz=await business(merchant);otherBiz=await business(other,'pending');
 service=(await db.query("insert into public.services(business_id,name,category_slug,duration_minutes,normal_price_cents) values($1,'Pánský střih','test',45,65000) returning id",[biz])).rows[0].id;
});
afterAll(async()=>{
 await db.query('delete from public.analytics_events where user_id=any($1::uuid[])',[users]);
 await db.query('delete from public.bookings where business_id=any($1::uuid[])',[businesses]);
 await db.query('delete from public.offers where business_id=any($1::uuid[])',[businesses]);
 await db.query('delete from public.services where business_id=any($1::uuid[])',[businesses]);
 await db.query('delete from public.business_members where business_id=any($1::uuid[])',[businesses]);
 await db.query('delete from public.businesses where id=any($1::uuid[])',[businesses]);
 for(const id of users)await admin.auth.admin.deleteUser(id);
 await db.query("delete from public.categories where slug='test'");await db.end();
});

describe('Concurrency against real Auth JWTs and PostgreSQL',()=>{
 it('capacity=1, 10 parallel users: exactly 1 success, 9 OFFER_UNAVAILABLE',async()=>{
  const o=await offer(), accounts=await Promise.all(Array.from({length:10},()=>user()));
  const r=await Promise.all(accounts.map(a=>book(a,o)));
  expect(r.filter(x=>!x.error)).toHaveLength(1);expect(r.filter(x=>x.error?.message==='OFFER_UNAVAILABLE')).toHaveLength(9);
  expect((await stored(o.id)).capacity_remaining).toBe(0);
  expect((await db.query('select count(*)::int n from public.bookings where offer_id=$1',[o.id])).rows[0].n).toBe(1);
 });
 it('capacity=5, 20 parallel calls: exactly 5 successes, no oversell',async()=>{
  const o=await offer(5),accounts=await Promise.all(Array.from({length:20},()=>user()));
  const r=await Promise.all(accounts.map(a=>book(a,o)));expect(r.filter(x=>!x.error)).toHaveLength(5);expect((await stored(o.id)).capacity_remaining).toBe(0);
 });
 it('same user concurrent double tap: ALREADY_BOOKED and one decrement',async()=>{
  const o=await offer(2),a=await user();const r=await Promise.all([book(a,o),book(a,o)]);
  expect(r.filter(x=>!x.error)).toHaveLength(1);code(r.find(x=>x.error)!.error,'ALREADY_BOOKED');expect((await stored(o.id)).capacity_remaining).toBe(1);
 });
 it('three-booking limit holds across simultaneous different offers',async()=>{
  const a=await user(),offers=await Promise.all(Array.from({length:5},()=>offer()));
  const r=await Promise.all(offers.map(o=>book(a,o)));expect(r.filter(x=>!x.error)).toHaveLength(3);expect(r.filter(x=>x.error?.message==='TOO_MANY_ACTIVE')).toHaveLength(2);
 });
 it('capacity=2 accepts two different customers and refuses a third',async()=>{
  const o=await offer(2),a=await user(),b=await user(),c=await user();
  expect((await book(a,o)).error).toBeNull();expect((await book(b,o)).error).toBeNull();code((await book(c,o)).error,'OFFER_UNAVAILABLE');expect((await stored(o.id)).capacity_remaining).toBe(0);
 });
});
describe('Booking rules',()=>{
 it('booking after cutoff rejected',async()=>code((await book(await user(),await offer(1,{cutoff:-1}))).error,'OFFER_UNAVAILABLE'));
 it('booking after start rejected',async()=>code((await book(await user(),await offer(1,{start:-1,cutoff:-2}))).error,'OFFER_UNAVAILABLE'));
 it.each(['pending','suspended'])('booking at %s business rejected',async status=>{const b=await business(other,status);code((await book(await user(),await offer(1,{business:b}))).error,'OFFER_UNAVAILABLE');});
 it('cancelled offer rejected',async()=>code((await book(await user(),await offer(1,{status:'cancelled'}))).error,'OFFER_UNAVAILABLE'));
 it('missing phone returns PHONE_REQUIRED',async()=>code((await book(await user(false),await offer())).error,'PHONE_REQUIRED'));
 it('4th active booking returns TOO_MANY_ACTIVE',async()=>{const a=await user();for(let i=0;i<3;i++)expect((await book(a,await offer())).error).toBeNull();code((await book(a,await offer())).error,'TOO_MANY_ACTIVE');});
 it('two no shows in 60 days block and admin override unblocks',async()=>{
  const a=await user();for(let i=0;i<2;i++){const r=await book(a,await offer());await db.query("update public.bookings set start_at_snapshot=now()-interval '1 hour' where id=$1",[r.data![0].booking_id]);expect((await merchant.client.rpc('merchant_resolve_booking',{p_booking_id:r.data![0].booking_id,p_outcome:'no_show'})).error).toBeNull();}
  code((await book(a,await offer())).error,'BLOCKED_NO_SHOW');
  await adminUser.client.rpc('admin_set_booking_block',{p_user_id:a.id,p_blocked:false,p_override_no_shows:true});expect((await book(a,await offer())).error).toBeNull();
 });
 it('eligible cancellation restores capacity and discovery immediately',async()=>{
  const a=await user(),o=await offer(),r=await book(a,o);expect((await a.client.rpc('cancel_booking',{p_booking_id:r.data![0].booking_id})).error).toBeNull();expect((await stored(o.id)).capacity_remaining).toBe(1);
  const search=await anon.rpc('search_offers',{p_lat:50.0755,p_lng:14.4378,p_limit:100});expect(search.data?.some((x:{id:string})=>x.id===o.id)).toBe(true);
  await a.client.rpc('cancel_booking',{p_booking_id:r.data![0].booking_id});expect((await stored(o.id)).capacity_remaining).toBe(1);
 });
 it('cancel at T-30 inside grace allowed; outside grace CANCELLATION_CLOSED',async()=>{
  const a=await user(),o=await offer(2,{start:30,cutoff:15}),r=await book(a,o);await db.query("update public.bookings set created_at=now()-interval '11 minutes' where id=$1",[r.data![0].booking_id]);code((await a.client.rpc('cancel_booking',{p_booking_id:r.data![0].booking_id})).error,'CANCELLATION_CLOSED');
  await db.query('update public.bookings set created_at=now() where id=$1',[r.data![0].booking_id]);expect((await a.client.rpc('cancel_booking',{p_booking_id:r.data![0].booking_id})).error).toBeNull();
 });
 it('booking price from database; extra client price argument rejected',async()=>{
  const a=await user(),o=await offer(),bad=await a.client.rpc('create_booking',{p_offer_id:o.id,p_price_cents:100});expect(bad.error).toBeTruthy();const r=await book(a,o);expect((await db.query('select price_cents from public.bookings where id=$1',[r.data![0].booking_id])).rows[0].price_cents).toBe(39000);
 });
});
describe('Authorization and RLS, real JWTs',()=>{
 it('merchant cannot read private foreign business, services or offers, or mutate foreign rows',async()=>{
  const o=await offer(1,{business:otherBiz,status:'draft'});
  for(const table of ['businesses','services','offers']){const r=await merchant.client.from(table).select('*').eq(table==='businesses'?'id':'business_id',otherBiz);expect(r.error).toBeNull();expect(r.data).toHaveLength(0);}
  code((await merchant.client.rpc('update_offer',{p_offer_id:o.id,p_data:{capacity_total:2}})).error,'FORBIDDEN');
  code((await merchant.client.rpc('update_business',{p_business_id:otherBiz,p_data:{display_name:'Hijack'}})).error,'FORBIDDEN');
  code((await merchant.client.rpc('save_service',{p_business_id:otherBiz,p_data:{name:'Hijack'}})).error,'FORBIDDEN');
 });
 it('foreign bookings and reservation codes are not exposed',async()=>{
  const a=await user(),r=await book(a,await offer());const read=await other.client.from('bookings').select('*').eq('id',r.data![0].booking_id);expect(read.data).toHaveLength(0);
  const lookup=await other.client.rpc('merchant_lookup_booking',{p_code:r.data![0].reservation_code});expect(lookup.data).toBeNull();
 });
 it('customer cannot read another profile or bookings, or cancel them',async()=>{
  const a=await user(),b=await user(),r=await book(a,await offer());expect((await b.client.from('profiles').select('*').eq('id',a.id)).data).toHaveLength(0);expect((await b.client.from('bookings').select('*').eq('customer_id',a.id)).data).toHaveLength(0);code((await b.client.rpc('cancel_booking',{p_booking_id:r.data![0].booking_id})).error,'NOT_FOUND');
 });
 it('anonymous cannot read pending businesses, draft offers or bookings',async()=>{
  const o=await offer(1,{status:'draft'});expect((await anon.from('businesses').select('*').eq('id',otherBiz)).data).toHaveLength(0);expect((await anon.from('offers').select('*').eq('id',o.id)).data).toHaveLength(0);expect((await anon.from('bookings').select('*')).error).toBeTruthy();
 });
 it('no client role can directly mutate capacity, insert booking or grant admin',async()=>{
  const o=await offer();for(const client of [anon,merchant.client,other.client,adminUser.client]){
   expect((await client.from('offers').update({capacity_remaining:999}).eq('id',o.id)).error).toBeTruthy();
   expect((await client.from('bookings').insert({offer_id:o.id})).error).toBeTruthy();
   expect((await client.from('user_roles').insert({user_id:merchant.id,role:'admin'})).error).toBeTruthy();
  }
 });
 it('non-admin cannot invoke admin functions or read analytics',async()=>{code((await merchant.client.rpc('admin_set_business_status',{p_business_id:otherBiz,p_status:'approved'})).error,'FORBIDDEN');expect((await merchant.client.from('analytics_events').select('*')).data).toHaveLength(0);});
 it('merchant lists mask identity, detail reveals confirmed own booking only',async()=>{
  const r=await book(await user(),await offer());const list=await merchant.client.rpc('merchant_bookings',{p_business_id:biz});const row=list.data?.find((x:{id:string})=>x.id===r.data![0].booking_id);expect(row.customer_label).toBe('Jakub H.');expect(row.phone).toBeUndefined();const detail=await merchant.client.rpc('merchant_booking_detail',{p_booking_id:row.id});expect(detail.data.phone).toBe('+420777123456');expect(detail.data.email).toBeUndefined();
 });
 it('every application table has RLS enabled',async()=>{const r=await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity and c.relname<>'spatial_ref_sys'");expect(r.rows).toEqual([]);});
});
describe('Domain invariants',()=>{
 it.each([59000,65000,9000])('invalid deal price %i rejected in RPC and table',async price=>{
  code((await merchant.client.rpc('publish_offer',{p_service_id:service,p_start_at:new Date(Date.now()+4*3600000).toISOString(),p_deal_price_cents:price,p_confirm_overlap:true})).error,'INVALID_DISCOUNT');const o=await offer();await expect(db.query('update public.offers set deal_price_cents=$1 where id=$2',[price,o.id])).rejects.toThrow();
 });
 it('end <= start rejected by constraint; beyond seven days rejected by RPC',async()=>{
  const o=await offer();await expect(db.query('update public.offers set end_at=start_at where id=$1',[o.id])).rejects.toThrow();code((await merchant.client.rpc('publish_offer',{p_service_id:service,p_start_at:new Date(Date.now()+8*86400000).toISOString(),p_deal_price_cents:39000})).error,'INVALID_START');
 });
 it('pending business cannot publish',async()=>{const s=(await db.query("insert into public.services(business_id,name,category_slug,duration_minutes,normal_price_cents) values($1,'Pending service','test',45,65000) returning id",[otherBiz])).rows[0].id;code((await other.client.rpc('publish_offer',{p_service_id:s,p_start_at:new Date(Date.now()+3600000).toISOString(),p_deal_price_cents:39000})).error,'BUSINESS_NOT_APPROVED');});
 it('booked offer capacity only increases, snapshots immutable after service edit',async()=>{
  const o=await offer(2),r=await book(await user(),o);
  code((await merchant.client.rpc('update_offer',{p_offer_id:o.id,p_data:{capacity_total:1}})).error,'INVALID_CAPACITY');code((await merchant.client.rpc('update_offer',{p_offer_id:o.id,p_data:{deal_price_cents:40000}})).error,'OFFER_HAS_BOOKINGS');
  expect((await merchant.client.rpc('update_offer',{p_offer_id:o.id,p_data:{capacity_total:3}})).error).toBeNull();expect((await stored(o.id)).capacity_remaining).toBe(2);
  const before=(await db.query('select service_name_snapshot from public.bookings where id=$1',[r.data![0].booking_id])).rows[0];await merchant.client.rpc('save_service',{p_business_id:biz,p_service_id:service,p_data:{name:'Nový název'}});expect((await db.query('select service_name_snapshot from public.bookings where id=$1',[r.data![0].booking_id])).rows[0]).toEqual(before);
 });
 it('no_show before start refused; after start increments counter exactly once',async()=>{
  const a=await user(),r=await book(a,await offer()),id=r.data![0].booking_id;code((await merchant.client.rpc('merchant_resolve_booking',{p_booking_id:id,p_outcome:'no_show'})).error,'TOO_EARLY');await db.query("update public.bookings set start_at_snapshot=now()-interval '1 minute' where id=$1",[id]);expect((await merchant.client.rpc('merchant_resolve_booking',{p_booking_id:id,p_outcome:'no_show'})).error).toBeNull();code((await merchant.client.rpc('merchant_resolve_booking',{p_booking_id:id,p_outcome:'no_show'})).error,'ALREADY_RESOLVED');expect((await db.query('select no_show_count from public.profiles where id=$1',[a.id])).rows[0].no_show_count).toBe(1);
 });
 it('suspension hides inventory and cancels upcoming bookings with reason',async()=>{
  const b=await business(other),o=await offer(2,{business:b}),r=await book(await user(),o);expect((await adminUser.client.rpc('admin_set_business_status',{p_business_id:b,p_status:'suspended',p_reason:'Pozastaveno pro kontrolu.'})).error).toBeNull();expect((await anon.rpc('get_offer_detail',{p_offer_id:o.id})).data).toBeNull();const k=(await db.query('select status,cancellation_reason from public.bookings where id=$1',[r.data![0].booking_id])).rows[0];expect(k.status).toBe('cancelled_by_merchant');expect(k.cancellation_reason).toBe('Pozastaveno pro kontrolu.');
 });
 it('merchant cancellation propagates reason; historical deletion prevented',async()=>{
  const o=await offer(),r=await book(await user(),o);expect((await merchant.client.rpc('merchant_cancel_offer',{p_offer_id:o.id,p_reason:'Technická závada.'})).error).toBeNull();expect((await db.query('select status from public.bookings where id=$1',[r.data![0].booking_id])).rows[0].status).toBe('cancelled_by_merchant');await expect(db.query('delete from public.services where id=$1',[service])).rejects.toThrow();await expect(db.query('delete from public.businesses where id=$1',[biz])).rejects.toThrow();
 });
 it('search excludes unavailable inventory with deterministic score order',async()=>{
  const expired=await offer(1,{start:-5,cutoff:-10}),sold=await offer();await book(await user(),sold);const args={p_lat:50.0755,p_lng:14.4378,p_category:'test',p_limit:100};const a=await anon.rpc('search_offers',args),b=await anon.rpc('search_offers',args);expect(a.error).toBeNull();expect(a.data?.map((x:{id:string})=>x.id)).toEqual(b.data?.map((x:{id:string})=>x.id));expect(a.data?.some((x:{id:string})=>[expired.id,sold.id].includes(x.id))).toBe(false);
 });
 it('overlap warning is server enforced and explicit confirmation permits it',async()=>{
  const args={p_service_id:service,p_start_at:new Date(Date.now()+180*60000).toISOString(),p_deal_price_cents:39000};code((await merchant.client.rpc('publish_offer',args)).error,'OVERLAP_CONFIRMATION_REQUIRED');expect((await merchant.client.rpc('publish_offer',{...args,p_confirm_overlap:true})).error).toBeNull();
 });
 it('reservation code collision retries transparently without losing capacity',async()=>{
  const a=await user(),b=await user(),existing=await book(a,await offer());
  const original=(await db.query("select pg_get_functiondef('public.generate_reservation_code(integer)'::regprocedure) definition")).rows[0].definition as string;
  const suffix=existing.data![0].reservation_code.replace('VOLNO-','');
  try {
   await db.query('create sequence public.test_code_attempt');
   await db.query(`create or replace function public.generate_reservation_code(n integer) returns text language plpgsql volatile set search_path=public as $fn$ begin if nextval('public.test_code_attempt')=1 then return '${suffix}'; end if; return 'ZQXWRT'; end $fn$`);
   const o=await offer(),r=await book(b,o);expect(r.error).toBeNull();expect(r.data![0].reservation_code).toBe('VOLNO-ZQXWRT');expect((await stored(o.id)).capacity_remaining).toBe(0);
  } finally {await db.query(original);await db.query('drop sequence if exists public.test_code_attempt');}
 });
 it('client cannot forge authoritative analytics or edit no-show counter',async()=>{
  expect((await merchant.client.from('analytics_events').insert({name:'booking_completed',session_id:'test',props:{}})).error).toBeTruthy();
  expect((await merchant.client.from('profiles').update({no_show_count:0,booking_blocked:false}).eq('id',merchant.id)).error).toBeTruthy();
 });
 it('database ignores a forged client clock and rejects stale inventory',async()=>{
  const a=await user(),o=await offer(1,{cutoff:-1});code((await book(a,o)).error,'OFFER_UNAVAILABLE');
  expect((await anon.rpc('get_offer_detail',{p_offer_id:o.id})).data.bookable).toBe(false);
 });
 it('offer created with cutoff less than five minutes away is rejected',async()=>{
  code((await merchant.client.rpc('publish_offer',{p_service_id:service,p_start_at:new Date(Date.now()+16*60000).toISOString(),p_deal_price_cents:39000})).error,'INVALID_CUTOFF');
 });
 it('manual booking block is admin-only and enforced by booking RPC',async()=>{
  const a=await user();code((await merchant.client.rpc('admin_set_booking_block',{p_user_id:a.id,p_blocked:true})).error,'FORBIDDEN');
  await adminUser.client.rpc('admin_set_booking_block',{p_user_id:a.id,p_blocked:true});code((await book(a,await offer())).error,'BOOKING_BLOCKED');
 });
});
