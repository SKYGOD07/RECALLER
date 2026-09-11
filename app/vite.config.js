import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const from = (p) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The console is a pure client of the Python backend: it holds no credit
 * logic. In development the Vite server (port 5180) proxies /api to the
 * backend (port 4180), so every call is same-origin and visible in the
 * browser's Network tab. In production the backend serves the built console
 * itself from app/dist.
 *
 *   RECALLER_BACKEND=http://127.0.0.1:4200 npm run dev   # point at another backend
 */
const backend = process.env.RECALLER_BACKEND ?? 'http://127.0.0.1:4180';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': from('./src'),
    },
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/docs': { target: backend },
      '/redoc': { target: backend },
      '/openapi.json': { target: backend },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
