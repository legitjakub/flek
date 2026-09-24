import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { TEMPLATE_SECRETS, templateMessage, type TemplateJob } from '../_shared/whatsapp.ts';
import { composeEmail, type Contract, type Operator } from '../_shared/email.ts';

// Called only by the database (booking trigger and cron via pg_net) with the worker secret it keeps
// in private.notification_config. The check runs against that one copy, so it cannot drift.
Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authorized, error: authError } = await db.rpc('notification_worker_authorized', { p_secret: token });
  if (authError) return Response.json({ error: 'AUTH_CHECK_FAILED' }, { status: 500 });
  if (authorized !== true) return new Response('Unauthorized', { status: 401 });
  const resend = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('NOTIFICATION_FROM');
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const channels: string[] = [];
  if (resend && from) channels.push('email');
  if (vapidPublic && vapidPrivate) {
    webpush.setVapidDetails('https://www.app-flek.eu', vapidPublic, vapidPrivate);
    channels.push('push');
  }
  // WhatsApp runs on its own claim, so a missing mail or push setup never holds it back, and the other way round.
  const whatsapp = await deliverWhatsApp(db);
  if (!channels.length) return Response.json({ error: 'DELIVERY_NOT_CONFIGURED', whatsapp }, { status: 503 });
  const { data: jobs, error } = await db.rpc('claim_notification_deliveries', { p_channels: channels });
  if (error) return Response.json({ error: 'CLAIM_FAILED', whatsapp }, { status: 500 });
  // Who runs FLEK, for the footer of every e-mail; the claim carries it too once the database sends it.
  let operator: Operator | null = null;
  if ((jobs ?? []).some((job: { channel: string }) => job.channel === 'email')) {
    const { data: legal } = await db.rpc('legal_info');
    operator = (legal as { operator?: Operator } | null)?.operator ?? null;
  }
  let sent = 0;
  for (const job of jobs ?? []) {
    let status = 'sent'; let failure: string | null = null;
    try {
      if (!job.allowed) status = 'skipped';
      else if (job.channel === 'email') {
        const email = composeEmail(
          { title: job.title, body: job.body, href: job.href, contract: (job.contract ?? null) as Contract | null },
          (job.operator as Operator | undefined) ?? operator,
        );
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json', 'Idempotency-Key': `flek-${job.id}` },
          body: JSON.stringify({
            from,
            to: [job.target],
            subject: email.subject,
            text: email.text,
            html: email.html,
          }),
        });
        if (!response.ok) { status = response.status === 429 || response.status >= 500 ? 'pending' : 'failed'; failure = `EMAIL_HTTP_${response.status}`; }
      } else if (!job.subscription) status = 'skipped';
      else {
        // Only the kind rides along, never booking details: a request needs the venue now, so the
        // service worker keeps it on screen until someone taps it.
        const kind = job.event === 'requested' && !job.customer ? { kind: 'request' } : {};
        await webpush.sendNotification(job.subscription, JSON.stringify({ url: job.href, id: job.notification_id, ...kind }), { TTL: 3600, timeout: 15000 });
      }
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      status = code === 404 || code === 410 ? 'skipped' : 'pending';
      failure = code ? `PUSH_HTTP_${code}` : 'DELIVERY_TEMPORARILY_UNAVAILABLE';
    }
    const result = await db.rpc('finish_notification_delivery', { p_id: job.id, p_lease: job.lease, p_status: status, p_error: failure });
    if (result.error) return Response.json({ error: 'ACK_FAILED' }, { status: 500 });
    if (status === 'sent') sent++;
  }
  return Response.json({ processed: jobs?.length ?? 0, sent, whatsapp });
});

type WhatsAppJob = TemplateJob & { id: string; lease: string; allowed: boolean; already_sent: boolean; message_id: string | null };

/**
 * Sends each claimed WhatsApp as its approved template: the venue's request with buttons, confirmed
 * and cancelled bookings for venues and customers. Without Meta credentials, or without the template
 * of that message, the delivery is closed as skipped, never left to pile up, and e-mail and push go
 * on. A message that stopped being true meanwhile (answered, cancelled, switched off, number no
 * longer verified) is skipped too; the claim says so.
 */
async function deliverWhatsApp(db: SupabaseClient) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const language = Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'cs';
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v25.0';
  const { data, error } = await db.rpc('claim_whatsapp_deliveries');
  if (error) return { error: 'CLAIM_FAILED' };
  const counts = { sent: 0, skipped: 0, retrying: 0, failed: 0 };
  for (const job of (data ?? []) as WhatsAppJob[]) {
    let status: 'sent' | 'pending' | 'failed' | 'skipped' = 'sent';
    let failure: string | null = null;
    const template = job.template in TEMPLATE_SECRETS ? Deno.env.get(TEMPLATE_SECRETS[job.template]) : undefined;
    try {
      if (job.already_sent) status = 'sent';
      else if (!token || !phoneNumberId) { status = 'skipped'; failure = 'WHATSAPP_NOT_CONFIGURED'; }
      else if (!job.allowed || !job.message_id) status = 'skipped';
      else if (!template) { status = 'skipped'; failure = 'WHATSAPP_TEMPLATE_MISSING'; }
      else {
        const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(templateMessage(job, template, language)),
        });
        const reply = await response.json().catch(() => null) as { messages?: { id?: string }[]; error?: { code?: number } } | null;
        const wamid = reply?.messages?.[0]?.id;
        if (response.ok && wamid) {
          const recorded = await db.rpc('whatsapp_message_sent', { p_message_id: job.message_id, p_wamid: wamid });
          if (recorded.error) failure = 'WHATSAPP_RECORD_FAILED';
        } else {
          // Rate limits and Meta's own errors are retried while the message still holds; the rest (a bad number, a template
          // that is not approved, an expired token) will not get better by sending again.
          status = response.status === 429 || response.status >= 500 ? 'pending' : 'failed';
          failure = `WHATSAPP_HTTP_${response.status}${reply?.error?.code ? `_${reply.error.code}` : ''}`;
        }
      }
    } catch {
      status = 'pending';
      failure = 'WHATSAPP_TEMPORARILY_UNAVAILABLE';
    }
    const finished = await db.rpc('finish_notification_delivery', { p_id: job.id, p_lease: job.lease, p_status: status, p_error: failure });
    if (finished.error) return { ...counts, error: 'ACK_FAILED' };
    counts[status === 'pending' ? 'retrying' : status] += 1;
  }
  return counts;
}
