import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]!);
}

function emailHtml(title: string, body: string, href: string): string {
  return `<!doctype html><html lang="cs"><body style="margin:0;background:#f7f8f3;color:#11130e;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:24px;padding:32px"><tr><td style="font-size:34px;font-weight:800;letter-spacing:-1.5px">flek<span style="color:#7a8450">′</span></td></tr><tr><td style="padding-top:28px;font-size:24px;font-weight:800">${escapeHtml(title)}</td></tr><tr><td style="padding-top:12px;font-size:16px;line-height:1.55;color:#5c6055">${escapeHtml(body)}</td></tr><tr><td style="padding-top:24px"><a href="https://www.app-flek.eu${href}" style="display:block;border-radius:14px;background:#4c2e05;padding:15px 20px;color:#fff;text-align:center;font-size:16px;font-weight:700;text-decoration:none">Otevřít rezervace</a></td></tr></table></td></tr></table></body></html>`;
}

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
  if (!channels.length) return Response.json({ error: 'DELIVERY_NOT_CONFIGURED' }, { status: 503 });
  const { data: jobs, error } = await db.rpc('claim_notification_deliveries', { p_channels: channels });
  if (error) return Response.json({ error: 'CLAIM_FAILED' }, { status: 500 });
  let sent = 0;
  for (const job of jobs ?? []) {
    let status = 'sent'; let failure: string | null = null;
    try {
      if (!job.allowed) status = 'skipped';
      else if (job.channel === 'email') {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json', 'Idempotency-Key': `flek-${job.id}` },
          body: JSON.stringify({
            from,
            to: [job.target],
            subject: `${job.title} — FLEK`,
            text: `${job.title}\n\n${job.body}\n\nOtevřít rezervace: https://www.app-flek.eu${job.href}\n\nFLEK`,
            html: emailHtml(job.title, job.body, job.href),
          }),
        });
        if (!response.ok) { status = response.status === 429 || response.status >= 500 ? 'pending' : 'failed'; failure = `EMAIL_HTTP_${response.status}`; }
      } else if (!job.subscription) status = 'skipped';
      else {
        await webpush.sendNotification(job.subscription, JSON.stringify({ url: job.href, id: job.notification_id }), { TTL: 3600, timeout: 15000 });
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
  return Response.json({ processed: jobs?.length ?? 0, sent });
});
