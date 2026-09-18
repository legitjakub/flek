import { caller, json, preflight, serviceClient } from '../_shared/stripe.ts';
import { aresUrl, parseAres, validIco } from '../_shared/ares.ts';

/**
 * Looks a business up in ARES by its IČO. The venue form fills in the official name and seat from
 * it, and for a venue the caller belongs to the result is stored next to the billing details, so an
 * admin approving the venue sees that the IČO exists and whom it belongs to.
 */
Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const who = await caller(request);
  if (!who) return json(request, { error: 'AUTH_REQUIRED' }, 401);

  let ico = '';
  let businessId: string | null = null;
  try {
    const body = await request.json();
    ico = String(body.ico ?? '').replace(/\s/g, '');
    businessId = typeof body.business_id === 'string' ? body.business_id : null;
  } catch {
    return json(request, { error: 'INVALID_REQUEST' }, 400);
  }
  if (!validIco(ico)) return json(request, { error: 'INVALID_ICO' }, 400);

  let response: Response;
  try {
    response = await fetch(aresUrl(ico), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch {
    return json(request, { error: 'ARES_UNAVAILABLE' }, 502);
  }
  if (response.status === 404) return json(request, { found: false });
  if (!response.ok) return json(request, { error: 'ARES_UNAVAILABLE' }, 502);
  const subject = parseAres(await response.json().catch(() => null));
  if (!subject) return json(request, { found: false });

  if (businessId) {
    const { data: member } = await who.client.rpc('is_member_of', { p_business_id: businessId });
    if (member === true) {
      const { error } = await serviceClient().from('business_billing').upsert({
        business_id: businessId,
        ico,
        ares_name: subject.name.slice(0, 300),
        ares_address: subject.address.slice(0, 300),
        ares_checked_at: new Date().toISOString(),
      }, { onConflict: 'business_id' });
      if (error) return json(request, { error: 'SAVE_FAILED' }, 500);
    }
  }
  return json(request, { found: true, ...subject });
});
