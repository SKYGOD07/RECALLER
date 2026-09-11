import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const from = (p) => fileURLToPath(new URL(p, import.meta.url))

/**
 * The console imports the deterministic domain packages straight from the
 * monorepo rather than through a copy, so there is exactly one implementation
 * of the credit engine in the repository. `fs.allow` lets the dev server read
 * them from outside the app root.
 */
export default defineConfig({
  plugins: [react()],
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
    fs: { allow: [from('..')] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:4180', changeOrigin: true },
      '/docs': { target: 'http://127.0.0.1:4180' },
      '/openapi.json': { target: 'http://127.0.0.1:4180' },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
})
