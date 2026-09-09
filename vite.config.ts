import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

// A build id the app can show and the service worker can key its cache on. Without it,
// "I still see the old version" is unanswerable.
const buildId = (() => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
  try {
    return `${stamp}-${execSync('git rev-parse --short HEAD').toString().trim()}`;
  } catch {
    return stamp;
  }
})();

export default defineConfig({define:{'import.meta.env.VITE_BUILD_ID':JSON.stringify(buildId)},plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:Number(process.env.PORT)||5173,strictPort:true,watch:{usePolling:true}},build:{rollupOptions:{output:{manualChunks(id){if(id.includes('maplibre-gl'))return 'map';if(id.includes('@js-temporal'))return 'time';}}}}});
