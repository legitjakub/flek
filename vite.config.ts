import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({plugins:[react(),tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./',import.meta.url))}},server:{host:'127.0.0.1',port:5173,strictPort:true,watch:{usePolling:true}},build:{rollupOptions:{output:{manualChunks(id){if(id.includes('maplibre-gl'))return 'map';if(id.includes('@js-temporal'))return 'time';}}}}});
