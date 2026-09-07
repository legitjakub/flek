import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Chybí VITE_SUPABASE_URL nebo VITE_SUPABASE_ANON_KEY. Spusťte `npm run db:start`, který zapíše .env.local.',
  );
}
// Only the public anon key ever reaches the browser; the service-role key stays server side.
if (/service_role/.test(anonKey)) throw new Error('Do prohlížeče nikdy nepatří service-role klíč.');

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});
