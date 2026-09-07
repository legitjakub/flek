import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Chybí kořenový element aplikace.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Shell-only caching. Offer and booking responses must never be served from a cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
