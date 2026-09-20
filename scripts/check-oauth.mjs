// Is signing in with Google and Apple actually switched on, and would the return trip work?
//
//   npm run check:oauth            (project and anon key from .env.local)
//   SITE=https://www.app-flek.eu npm run check:oauth
//
// Only the public anon key and public endpoints, nothing that changes anything. Two settings
// have to be right and they fail in ways that look the same to a customer ("přihlášení se
// nedokončilo"), so the script tells them apart:
//
//   1. the provider itself, in Supabase → Authentication → Sign In / Providers,
//   2. the return address, in Supabase → Authentication → URL Configuration → Redirect URLs.
//
// The app returns to /prihlaseni with a query (`?oauth=google&returnTo=…`), and Supabase matches
// the whole URL — path and query — against that list, where `.` and `/` are separators. A bare
// `https://www.app-flek.eu/prihlaseni` therefore does not cover the return trip; add
// `https://www.app-flek.eu/**`.
import { readFileSync } from 'node:fs';

function fromEnvFile(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
        })
        .filter(([key]) => key),
    );
  } catch {
    return {};
  }
}

const file = { ...fromEnvFile('.env'), ...fromEnvFile('.env.local') };
const URL_ = process.env.SUPABASE_URL || file.SUPABASE_URL || file.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || file.SUPABASE_ANON_KEY || file.VITE_SUPABASE_ANON_KEY;
const SITE = process.env.SITE || 'https://www.app-flek.eu';
if (!URL_ || !ANON) {
  throw new Error('Chybí VITE_SUPABASE_URL nebo VITE_SUPABASE_ANON_KEY — doplňte je do .env.local.');
}

/** The exact address the app asks Supabase to come back to, query and all. */
function returnUrl(provider) {
  return `${SITE}/prihlaseni?${new URLSearchParams({ oauth: provider, returnTo: '/nabidka/ukazka' })}`;
}

const settings = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: ANON } });
if (!settings.ok) throw new Error(`/auth/v1/settings odpovědělo ${settings.status}`);
const external = (await settings.json()).external ?? {};

console.log(`Projekt: ${URL_}`);
console.log(`Web:     ${SITE}\n`);

let allReady = true;
for (const provider of ['google', 'apple']) {
  const name = provider === 'google' ? 'Google' : 'Apple';
  if (external[provider] !== true) {
    allReady = false;
    console.log(`${name}: VYPNUTÝ v Supabase → Authentication → Sign In / Providers. Tlačítko se v aplikaci neukáže.`);
    continue;
  }
  // A permitted return address sends the browser on to the provider; a refused one comes back
  // to the site with an error about redirect_to, which is the difference we are after.
  const authorize = `${URL_}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(returnUrl(provider))}`;
  const response = await fetch(authorize, { redirect: 'manual', headers: { apikey: ANON } });
  const location = response.headers.get('location') ?? '';
  const refused = /error|redirect_to/i.test(location) && !/accounts\.google\.com|appleid\.apple\.com/.test(location);
  if (refused) {
    allReady = false;
    console.log(`${name}: zapnutý, ale návratová adresa není povolená.`);
    console.log(`  Přidejte do Authentication → URL Configuration → Redirect URLs: ${new URL(SITE).origin}/**`);
    console.log(`  Supabase odpověděla: ${location.slice(0, 200)}`);
  } else {
    console.log(`${name}: zapnutý a návrat na ${new URL(SITE).host} povolený.`);
  }
}

console.log(allReady ? '\nHotovo: obě tlačítka se v aplikaci ukážou.' : '\nZbývá dodělat kroky výše (docs/NOTION.md, „Na tahu je Jakub“).');
