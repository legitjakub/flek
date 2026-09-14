import { message, processRefunds, serviceClient, stripeClient } from '../_shared/stripe.ts';

/**
 * Works through refunds the database has asked for (a cancelled booking, a paid seat that went to
 * someone else). The database calls it after such a change commits and a cron job calls it every
 * few minutes as a safety net. It takes no input and returns only counts (refunded, still pending,
 * failed), so calling it from anywhere can do nothing but process the queue that already exists.
 */
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const stripe = stripeClient();
  if (!stripe) return new Response('Payments are not configured', { status: 503 });
  try {
    return Response.json(await processRefunds(serviceClient(), stripe, 20));
  } catch (error) {
    console.error('stripe-refunds', message(error));
    return new Response('Processing failed', { status: 500 });
  }
});
