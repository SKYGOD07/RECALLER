import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const from = (p) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The console imports the deterministic domain packages directly from the
 * monorepo rather than through a copy, so there is exactly one implementation
 * of the credit engine in the repository. `fs.allow` lets the dev server read
 * them from outside the app root.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@core': from('../packages/core/src'),
      '@extraction': from('../packages/extraction/src'),
      '@reconciliation': from('../packages/reconciliation/src'),
      '@credit-engine': from('../packages/credit-engine/src'),
      '@policy-engine': from('../packages/policy-engine/src'),
      '@narration': from('../packages/narration/src'),
      '@whatif': from('../packages/whatif/src'),
      '@orchestrator': from('../packages/orchestrator/src'),
      '@policy': from('../policy'),
      '@synthetic': from('../data/synthetic'),
      '@': from('./src'),
    },
  },
  server: {
    port: 4180,
    host: '127.0.0.1',
    fs: { allow: [from('..')] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
