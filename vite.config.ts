import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

import { cloudflare } from "@cloudflare/vite-plugin";

// OpenSky's API only allows CORS from its own origin, so the dev/preview
// server proxies it — the app calls /opensky/* same-origin.
const openskyProxy = {
  '/opensky-auth': {
    target: 'https://auth.opensky-network.org',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/opensky-auth/, ''),
  },
  '/opensky': {
    target: 'https://opensky-network.org/api',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/opensky/, ''),
  },
};

export default defineConfig({
  plugins: [react(), cesium(), cloudflare()],
  server: { proxy: openskyProxy },
  preview: { proxy: openskyProxy },
  build: {
    // Cesium ships a large Cesium.js loaded as an external script (copy of
    // Workers/Assets/Widgets into dist/); the airport database is also large
    chunkSizeWarningLimit: 4000,
  },
});