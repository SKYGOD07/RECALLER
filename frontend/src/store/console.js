/**
 * Console store.
 *
 * Holds what the officer is looking at — the queue, the open file, what is
 * running — and nothing else. Every value in here arrived from `api`; the
 * store never derives a credit figure, it only caches and indexes.
 */

import { api, getRuntime } from '@/api'

const listeners = new Set()

let state = {
  boot: 'IDLE', // IDLE | LOADING | READY | ERROR
  bootError: null,
  runtime: getRuntime(),
  policy: null,
  stagePlan: [],
  applications: [],
  /** id → { application, documents, record, progress, replays } */
  details: {},
  /** id → 'UNDERWRITING' | 'RESUMING' | 'REPLAYING' */
  busy: {},
  /** id → last error message for that file */
  errors: {},
  /** id → live stage map while a run is in flight */
  live: {},
}

let snapshot = state

function set(patch) {
  state = { ...state, ...patch }
  snapshot = state
  listeners.forEach((fn) => fn())
}

export const subscribeConsole = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getConsoleSnapshot = () => snapshot

/* ================================================================== *
 * Read helpers — pure lookups over the snapshot
 * ================================================================== */

export const selectApplication = (s, id) => s.details[id]?.application ?? s.applications.find((a) => a.id === id) ?? null
export const selectRecord = (s, id) => s.details[id]?.record ?? null
export const selectProgress = (s, id) => s.live[id] ?? s.details[id]?.progress ?? null
export const selectDocuments = (s, id) => s.details[id]?.documents ?? []
export const selectReplays = (s, id) => s.details[id]?.replays ?? []

/* ================================================================== *
 * Actions
 * ================================================================== */

let booting = null

export function boot() {
  if (booting) return booting
  set({ boot: 'LOADING', bootError: null })

  booting = (async () => {
    try {
      await api.ready()
      const [policy, stagePlan, applications] = await Promise.all([
        api.getPolicy(),
        api.getStagePlan(),
        api.listApplications(),
      ])
      set({ boot: 'READY', policy, stagePlan, applications, runtime: getRuntime() })
    } catch (err) {
      set({ boot: 'ERROR', bootError: err.message, runtime: getRuntime() })
    } finally {
      booting = null
    }
  })()

  return booting
}

export async function refreshQueue() {
  const applications = await api.listApplications()
  set({ applications })
  return applications
}

export async function loadApplication(id) {
  try {
    const detail = await api.getApplication(id)
    set({
      details: { ...state.details, [id]: detail },
      errors: { ...state.errors, [id]: null },
    })
    return detail
  } catch (err) {
    set({ errors: { ...state.errors, [id]: err.message } })
    throw err
  }
}

function mergeDetail(id, patch) {
  const current = state.details[id] ?? {}
  set({ details: { ...state.details, [id]: { ...current, ...patch } } })
}

function onStageFor(id) {
  return ({ id: stageId, status }) => {
    const current = state.live[id] ?? {}
    set({ live: { ...state.live, [id]: { ...current, [stageId]: status } } })
  }
}

function blankLive(stagePlan) {
  return Object.fromEntries(stagePlan.map((s) => [s.id, 'PENDING']))
}

async function run(id, kind, work) {
  set({
    busy: { ...state.busy, [id]: kind },
    errors: { ...state.errors, [id]: null },
    live: { ...state.live, [id]: blankLive(state.stagePlan) },
  })
  try {
    const record = await work()
    mergeDetail(id, { record })
    await refreshQueue()
    const detail = await api.getApplication(id)
    mergeDetail(id, detail)
    return record
  } catch (err) {
    set({ errors: { ...state.errors, [id]: err.message } })
    throw err
  } finally {
    const { [id]: _busy, ...busy } = state.busy
    const { [id]: _live, ...live } = state.live
    set({ busy, live })
  }
}

export const underwrite = (id) =>
  run(id, 'UNDERWRITING', () => api.startUnderwriting(id, { paced: true, onStage: onStageFor(id) }))

export const resume = (id, resolutions) =>
  run(id, 'RESUMING', () => api.resumeUnderwriting(id, resolutions, { paced: true, onStage: onStageFor(id) }))

export async function replay(id, options) {
  set({ busy: { ...state.busy, [id]: 'REPLAYING' } })
  try {
    const result = await api.replayApplication(id, options)
    const detail = await api.getApplication(id)
    mergeDetail(id, detail)
    return result
  } finally {
    const { [id]: _busy, ...busy } = state.busy
    set({ busy })
  }
}

export const solveWhatIf = (id, target) => api.solveWhatIf(id, target)
export const simulate = (id, scenario) => api.simulateScenario(id, scenario)

export async function resetConsole() {
  const res = await api.resetConsole()
  set({ applications: res.applications ?? state.applications, details: {}, live: {}, errors: {} })
  return res
}
