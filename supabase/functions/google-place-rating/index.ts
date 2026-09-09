import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store, max-age=0',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!request.headers.get('Authorization')?.startsWith('Bearer ')) return reply({ error: 'AUTH_REQUIRED' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const googleKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!supabaseUrl || !serviceKey || !googleKey) return reply({ error: 'SERVICE_NOT_CONFIGURED' }, 503);

  let businessId: string;
  try {
    const body = await request.json();
    businessId = typeof body.business_id === 'string' ? body.business_id : '';
  } catch {
    return reply({ error: 'INVALID_REQUEST' }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(businessId)) return reply({ error: 'INVALID_REQUEST' }, 400);

  // Only IDs registered on approved FLEK businesses may consume the Google quota.
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: business, error } = await admin
    .from('businesses')
    .select('google_place_id')
    .eq('id', businessId)
    .eq('status', 'approved')
    .maybeSingle();
  if (error) return reply({ error: 'LOOKUP_FAILED' }, 502);
  if (!business?.google_place_id) return reply(null);

  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(business.google_place_id)}`);
  url.searchParams.set('languageCode', 'cs');
  url.searchParams.set('regionCode', 'CZ');
  const google = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': googleKey,
      'X-Goog-FieldMask': 'rating,userRatingCount,googleMapsUri',
    },
  });
  if (!google.ok) return reply({ error: 'GOOGLE_PLACES_FAILED' }, 502);

  const place = await google.json();
  if (typeof place.rating !== 'number' || typeof place.userRatingCount !== 'number') return reply(null);
  return reply({
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    googleMapsUri: typeof place.googleMapsUri === 'string' ? place.googleMapsUri : '',
  });
});
