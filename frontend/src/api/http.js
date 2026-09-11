/**
 * HTTP transport — the RECALLER FastAPI backend.
 *
 *   listApplications   → GET  /api/applications
 *   getApplication     → GET  /api/applications/:id
 *   startUnderwriting  → POST /api/applications/:id/underwrite
 *   resumeUnderwriting → POST /api/applications/:id/resume
 *   replayApplication  → POST /api/applications/:id/replay
 *   solveWhatIf        → POST /api/applications/:id/whatif
 *   simulateScenario   → POST /api/applications/:id/simulate
 *   resetConsole       → POST /api/reset
 *
 * The server paces the pipeline and answers once with the finished record, so
 * stage progress is read from the application's `progress` map while the
 * request is in flight rather than streamed.
 */

import { url } from './config.js'

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
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
    throw new ApiError(detail?.detail ?? `${method} ${path} failed (${res.status})`, res.status)
  }
  return res.status === 204 ? null : res.json()
}

const POLL_MS = 350

/**
 * Reports stage transitions to `onStage` by polling the application's progress
 * map until `work` settles. Progress is the backend's own view of the run.
 */
async function withProgress(id, onStage, work) {
  if (!onStage) return work()
  let live = true
  let seen = {}

  const poll = async () => {
    while (live) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, POLL_MS))
      if (!live) break
      try {
        // eslint-disable-next-line no-await-in-loop
        const snap = await request(`/api/applications/${id}`)
        const progress = snap?.progress ?? {}
        Object.entries(progress).forEach(([stageId, status]) => {
          if (seen[stageId] !== status) onStage({ id: stageId, status })
        })
        seen = { ...progress }
      } catch {
        /* a dropped poll must never fail the run it is only narrating */
      }
    }
  }

  const polling = poll()
  try {
    return await work()
  } finally {
    live = false
    await polling
  }
}

export function createHttpTransport() {
  return {
    name: 'http',

    health: () => request('/api/health'),
    getPolicy: () => request('/api/policy'),
    getStagePlan: () => request('/api/stage-plan'),
    listApplications: () => request('/api/applications'),
    getApplication: (id) => request(`/api/applications/${id}`),

    startUnderwriting: (id, { paced = true, onStage } = {}) =>
      withProgress(id, onStage, () =>
        request(`/api/applications/${id}/underwrite`, { method: 'POST', body: { paced } }),
      ),

    resumeUnderwriting: (id, resolutions, { paced = true, onStage } = {}) =>
      withProgress(id, onStage, () =>
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

    resetConsole: () => request('/api/reset', { method: 'POST' }),
  }
}

export { ApiError }
