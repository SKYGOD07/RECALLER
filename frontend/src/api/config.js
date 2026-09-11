/**
 * RECALLER frontend — one place that knows where the product's data comes from.
 *
 * Nothing else in the application may name a host, a port or an endpoint.
 * Two transports are supported and both return the identical response shape:
 *
 *   http    — the RECALLER FastAPI backend (`VITE_RECALLER_API`)
 *   engine  — the deterministic domain packages executed in the browser
 *
 * `engine` is what makes the console work with no server at all — the demo
 * mode — and it is not a parallel mock schema: it runs the same orchestrator
 * the backend runs, so every field, every reason code and every hash matches.
 */

const env = import.meta.env ?? {}

const raw = (env.VITE_RECALLER_API ?? '').trim()

/** Base URL for the backend. '' means same-origin (the installer serves both). */
export const API_BASE = raw === 'same-origin' || raw === '/' ? '' : raw.replace(/\/+$/, '')

export const TRANSPORTS = { HTTP: 'http', ENGINE: 'engine' }

/**
 * Requested transport. `VITE_RECALLER_MODE` wins; otherwise the presence of a
 * backend URL decides. A build with neither runs entirely in the browser.
 */
export const REQUESTED_TRANSPORT =
  (env.VITE_RECALLER_MODE ?? '').trim() || (raw ? TRANSPORTS.HTTP : TRANSPORTS.ENGINE)

/** An http transport that cannot reach its backend degrades to the engine. */
export const ALLOW_DEGRADE = (env.VITE_RECALLER_STRICT ?? '') !== 'true'

export const TRANSPORT_LABELS = {
  [TRANSPORTS.HTTP]: 'Backend runtime',
  [TRANSPORTS.ENGINE]: 'In-process engine',
}

export const url = (path) => `${API_BASE}${path}`
