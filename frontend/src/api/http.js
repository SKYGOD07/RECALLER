/**
 * HTTP transport — the RECALLER FastAPI backend.
 *
 *   bootstrap          → GET  /api/bootstrap        (policy, stage plan, queue, vocab)
 *   health             → GET  /api/health
 *   listApplications   → GET  /api/applications
 *   getApplication     → GET  /api/applications/:id
 *   startUnderwriting  → POST /api/applications/:id/underwrite
 *   resumeUnderwriting → POST /api/applications/:id/resume
 *   replayApplication  → POST /api/applications/:id/replay
 *   solveWhatIf        → POST /api/applications/:id/whatif
 *   simulateScenario   → POST /api/applications/:id/simulate
 *   verifyAudit        → GET  /api/applications/:id/audit/verify
 *   resetConsole       → POST /api/reset
 *
 * A run POSTs synchronously and answers with the finished record; while it is
 * in flight the server streams stage transitions over Server-Sent Events at
 * /applications/:id/events, which is where the progress view gets its truth.
 */

import { url } from './config.js'

class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res
  try {
    res = await fetch(url(path), {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    throw new ApiError(`RECALLER runtime unreachable (${err.message})`, 0)
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    const message =
      detail?.detail?.message ?? detail?.message ?? detail?.detail ?? `${method} ${path} failed (${res.status})`
    throw new ApiError(typeof message === 'string' ? message : JSON.stringify(message), res.status, detail?.code)
  }
  return res.status === 204 ? null : res.json()
}

/**
 * Subscribe to a run while `work` is in flight.
 *
 * The stream carries `snapshot`, `stage` and `end` events; only stage
 * transitions matter to the progress view. The subscription is torn down in a
 * `finally` so a failed run cannot leave a stream open.
 */
async function withStream(id, onStage, work) {
  if (!onStage || typeof EventSource === 'undefined') return work()

  const source = new EventSource(url(`/api/applications/${id}/events?once=true`))

  const apply = (payload) => {
    const progress = payload?.progress
    if (progress) {
      Object.entries(progress).forEach(([stageId, status]) => onStage({ id: stageId, status }))
    } else if (payload?.id) {
      onStage({ id: payload.id, status: payload.status })
    }
  }

  const read = (event) => {
    try {
      apply(JSON.parse(event.data))
    } catch {
      /* a malformed frame must never fail the run it is only narrating */
    }
  }

  source.addEventListener('snapshot', read)
  source.addEventListener('stage', read)

  try {
    return await work()
  } finally {
    source.close()
  }
}

export function createHttpTransport() {
  return {
    name: 'http',

    health: () => request('/api/health'),
    bootstrap: () => request('/api/bootstrap'),
    getPolicy: () => request('/api/policy'),
    getStagePlan: () => request('/api/stage-plan'),
    listApplications: () => request('/api/applications'),
    getApplication: (id) => request(`/api/applications/${id}`),

    startUnderwriting: (id, { paced = true, onStage } = {}) =>
      withStream(id, onStage, () =>
        request(`/api/applications/${id}/underwrite`, { method: 'POST', body: { paced } }),
      ),

    resumeUnderwriting: (id, resolutions, { paced = true, onStage } = {}) =>
      withStream(id, onStage, () =>
        request(`/api/applications/${id}/resume`, { method: 'POST', body: { resolutions, paced } }),
      ),

    replayApplication: (id, { policy = null, label } = {}) =>
      request(`/api/applications/${id}/replay`, {
        method: 'POST',
        body: { policy, label: label ?? 'Replay with original policy' },
      }),

    solveWhatIf: (id, target = 'APPROVE') =>
      request(`/api/applications/${id}/whatif`, { method: 'POST', body: { target } }),

    simulateScenario: (id, scenario) =>
      request(`/api/applications/${id}/simulate`, { method: 'POST', body: { scenario } }),

    verifyAudit: (id) => request(`/api/applications/${id}/audit/verify`),

    resetConsole: () => request('/api/reset', { method: 'POST' }),
  }
}

export { ApiError }
