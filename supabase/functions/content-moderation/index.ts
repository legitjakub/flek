import { createClient } from 'jsr:@supabase/supabase-js@2';

type ModerationJob = {
  id: string;
  lease: string;
  author_id: string;
  business_id: string | null;
  entity_type: 'service' | 'business' | 'review';
  entity_id: string;
  payload: Record<string, unknown>;
  image_paths: Record<string, string>;
  admin_override: boolean;
  attempts: number;
};

type InputPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** This endpoint is called only by pg_net with the database-held worker secret. */
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authorized, error: authError } = await db.rpc('notification_worker_authorized', { p_secret: token });
  if (authError) return Response.json({ error: 'AUTH_CHECK_FAILED' }, { status: 500 });
  if (authorized !== true) return new Response('Unauthorized', { status: 401 });

  const { data, error } = await db.rpc('claim_content_moderation');
  if (error) return Response.json({ error: 'CLAIM_FAILED' }, { status: 500 });
  const key = Deno.env.get('OPENAI_API_KEY');
  const counts = { approved: 0, manual_review: 0, retrying: 0, stale: 0 };

  for (const job of (data ?? []) as ModerationJob[]) {
    const images: Array<{ key: string; path: string; blob: Blob }> = [];
    let permanentProblem: string | null = null;
    try {
      for (const [imageKey, path] of Object.entries(job.image_paths ?? {})) {
        if (!path || !job.business_id || path.split('/')[0] !== job.business_id) {
          permanentProblem = 'INVALID_IMAGE_PATH';
          break;
        }
        const downloaded = await db.storage.from('moderation-pending').download(path);
        if (downloaded.error || !downloaded.data) {
          permanentProblem = 'IMAGE_NOT_FOUND';
          break;
        }
        const blob = downloaded.data;
        if (!ALLOWED_IMAGES.has(blob.type) || blob.size === 0 || blob.size > MAX_IMAGE_BYTES) {
          permanentProblem = 'INVALID_IMAGE_FILE';
          break;
        }
        images.push({ key: imageKey, path, blob });
      }

      if (permanentProblem) {
        await finish(db, job, 'manual_review', null, permanentProblem);
        counts.manual_review += 1;
        continue;
      }

      let provider: Record<string, unknown> = { admin_override: job.admin_override };
      if (!job.admin_override) {
        if (!key) {
          await finish(db, job, 'retry', null, 'OPENAI_NOT_CONFIGURED');
          counts.retrying += 1;
          continue;
        }
        const input: InputPart[] = [];
        const text = publicText(job);
        if (text) input.push({ type: 'text', text });
        for (const image of images) {
          input.push({
            type: 'image_url',
            image_url: { url: `data:${image.blob.type};base64,${await blobBase64(image.blob)}` },
          });
        }
        if (!input.length) {
          await finish(db, job, 'manual_review', null, 'EMPTY_SUBMISSION');
          counts.manual_review += 1;
          continue;
        }

        const response = await fetch('https://api.openai.com/v1/moderations', {
          method: 'POST',
          signal: AbortSignal.timeout(25_000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'omni-moderation-latest', input }),
        });
        const reply = await response.json().catch(() => null) as {
          id?: string;
          model?: string;
          results?: Array<{ flagged?: boolean; categories?: Record<string, boolean>; category_scores?: Record<string, number> }>;
          error?: { type?: string };
        } | null;
        if (!response.ok || !reply?.results?.length) {
          const retry = response.status === 429 || response.status >= 500;
          await finish(db, job, retry ? 'retry' : 'manual_review', null, `OPENAI_HTTP_${response.status}`);
          counts[retry ? 'retrying' : 'manual_review'] += 1;
          continue;
        }
        const result = reply.results[0];
        provider = {
          id: reply.id,
          model: reply.model,
          flagged: result.flagged === true,
          categories: result.categories,
          category_scores: result.category_scores,
        };
        if (result.flagged) {
          await finish(db, job, 'manual_review', provider, 'CONTENT_FLAGGED');
          counts.manual_review += 1;
          continue;
        }
      }

      const publicImages: Record<string, string> = {};
      for (const image of images) {
        const bucket = image.key === 'logo' ? 'logos' : 'covers';
        const extension = image.blob.type === 'image/png' ? 'png' : image.blob.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `${job.business_id}/moderated/${job.entity_type}-${job.entity_id}-${image.key}.${extension}`;
        const uploaded = await db.storage.from(bucket).upload(path, image.blob, {
          contentType: image.blob.type,
          cacheControl: '31536000',
          upsert: true,
        });
        if (uploaded.error) throw new Error('PUBLIC_IMAGE_UPLOAD_FAILED');
        publicImages[image.key] = db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      }

      const result = await finish(db, job, 'approved', provider, null, publicImages);
      if (result === 'stale') {
        counts.stale += 1;
        continue;
      }
      counts.approved += 1;
      for (const image of images) await db.storage.from('moderation-pending').remove([image.path]);
    } catch (error) {
      await finish(db, job, 'retry', null, error instanceof Error ? error.message : 'MODERATION_TEMPORARILY_UNAVAILABLE');
      counts.retrying += 1;
    }
  }

  const cleaned = await cleanupTerminalUploads(db);

  return Response.json({ processed: (data ?? []).length, cleaned, ...counts });
});

function publicText(job: ModerationJob): string {
  // Contact, billing, address and price fields are deliberately never sent to OpenAI.
  if (job.entity_type === 'review') return clean(job.payload.body);
  if (job.entity_type === 'business') {
    return [clean(job.payload.display_name), clean(job.payload.description)].filter(Boolean).join('\n\n');
  }
  return [clean(job.payload.name), clean(job.payload.description)].filter(Boolean).join('\n\n');
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function finish(
  db: ReturnType<typeof createClient>,
  job: ModerationJob,
  outcome: 'approved' | 'manual_review' | 'retry',
  provider: Record<string, unknown> | null,
  error: string | null,
  publicImages: Record<string, string> = {},
): Promise<string> {
  const result = await db.rpc('finish_content_moderation', {
    p_id: job.id,
    p_lease: job.lease,
    p_outcome: outcome,
    p_provider: provider,
    p_error: error,
    p_public_images: publicImages,
  });
  if (result.error) throw result.error;
  return result.data as string;
}

async function cleanupTerminalUploads(db: ReturnType<typeof createClient>): Promise<number> {
  const queue = await db.rpc('content_moderation_cleanup');
  if (queue.error) return 0;
  let cleaned = 0;
  for (const row of (queue.data ?? []) as Array<{ id: string; image_paths: Record<string, string> }>) {
    const paths = Object.values(row.image_paths ?? {}).filter(Boolean);
    if (paths.length) {
      const removed = await db.storage.from('moderation-pending').remove(paths);
      if (removed.error) continue;
    }
    const finished = await db.rpc('finish_content_moderation_cleanup', { p_id: row.id });
    if (!finished.error) cleaned += 1;
  }
  return cleaned;
}
