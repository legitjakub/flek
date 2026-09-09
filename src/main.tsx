import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Chybí kořenový element aplikace.');

/**
 * Configuration is checked before the app is imported. The Supabase client throws while its
 * module loads, which happens before React mounts — so a missing key used to render nothing
 * at all: a white page with the reason only in the console.
 */
function MissingConfig() {
  return (
    <main
      style={{
        maxWidth: '32rem',
        margin: '0 auto',
        padding: '3rem 1.25rem',
        fontFamily: "'Instrument Sans Variable', system-ui, sans-serif",
        color: '#22282b',
      }}
    >
      <h1 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>FLEK nemá připojení k databázi.</h1>
      <p style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>
        Chybí nastavení <code>VITE_SUPABASE_URL</code> a <code>VITE_SUPABASE_ANON_KEY</code>. Obě proměnné musí být
        dostupné <strong>při sestavení</strong> — po jejich doplnění je potřeba nasadit znovu.
      </p>
      <p style={{ marginTop: '0.75rem', lineHeight: 1.6, color: '#5d6a68' }}>
        Lokálně je zapíše <code>npm run db:start</code> do <code>.env.local</code>.
      </p>
    </main>
  );
}

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  createRoot(root).render(<MissingConfig />);
} else {
  const { App } = await import('./app/App');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // The worker caches nothing; it exists so the app stays installable and so any cache an
  // earlier version left behind gets deleted on activation.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    // The app is imported dynamically, so "load" has usually already fired by the time this
    // runs — a listener added now would never be called and the worker never registered,
    // which quietly made the app non-installable.
    const register = () =>
      void navigator.serviceWorker
        .register(`/sw.js?v=${import.meta.env.VITE_BUILD_ID ?? 'dev'}`)
        .catch(() => undefined);
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}
