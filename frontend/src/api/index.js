/**
 * RECALLER frontend — the API facade.
 *
 * Every screen talks to the product through this module and nothing else. It
 * selects a transport once, degrades to the in-process engine if a configured
 * backend cannot be reached, and reports which runtime is live so the console
 * can say so out loud rather than pretending.
 */

import { ALLOW_DEGRADE, REQUESTED_TRANSPORT, TRANSPORTS, TRANSPORT_LABELS } from './config.js'
import { createEngineTransport } from './engine.js'
import { createHttpTransport } from './http.js'

let transport = null
let runtime = {
  transport: REQUESTED_TRANSPORT,
  label: TRANSPORT_LABELS[REQUESTED_TRANSPORT],
  status: 'UNKNOWN',
  degraded: false,
  engine_version: null,
  workflow_version: null,
  error: null,
}

export const getRuntime = () => runtime

/**
 * Resolve the transport exactly once. A configured backend is probed first;
 * if it does not answer, the console falls back to the deterministic packages
 * so a failed connection never costs the officer the queue.
 */
async function resolve() {
  if (transport) return transport

  if (REQUESTED_TRANSPORT === TRANSPORTS.HTTP) {
    const http = createHttpTransport()
    try {
      // bootstrap is the probe: if it answers, the backend is genuinely usable,
      // and the versions it reports are the ones the console will display.
      const boot = await http.bootstrap()
      transport = http
      runtime = {
        ...runtime,
        transport: TRANSPORTS.HTTP,
        label: TRANSPORT_LABELS[TRANSPORTS.HTTP],
        status: 'ONLINE',
        engine_version: boot.engine_version,
        workflow_version: boot.workflow_version,
        llm: boot.llm ?? null,
      }
      return transport
    } catch (err) {
      if (!ALLOW_DEGRADE) {
        runtime = { ...runtime, status: 'OFFLINE', error: err.message }
        throw err
      }
      runtime = { ...runtime, degraded: true, error: err.message }
    }
  }

  const engine = createEngineTransport()
  const boot = await engine.bootstrap()
  transport = engine
  runtime = {
    ...runtime,
    transport: TRANSPORTS.ENGINE,
    label: TRANSPORT_LABELS[TRANSPORTS.ENGINE],
    status: 'ONLINE',
    engine_version: boot.engine_version,
    workflow_version: boot.workflow_version,
    llm: boot.llm ?? null,
  }
  return transport
}

const call = (method) => async (...args) => {
  const t = await resolve()
  return t[method](...args)
}

export const api = {
  ready: resolve,
  health: call('health'),
  bootstrap: call('bootstrap'),
  getPolicy: call('getPolicy'),
  getStagePlan: call('getStagePlan'),
  listApplications: call('listApplications'),
  getApplication: call('getApplication'),
  startUnderwriting: call('startUnderwriting'),
  resumeUnderwriting: call('resumeUnderwriting'),
  replayApplication: call('replayApplication'),
  solveWhatIf: call('solveWhatIf'),
  simulateScenario: call('simulateScenario'),
  verifyAudit: call('verifyAudit'),
  resetConsole: call('resetConsole'),
}

/**
 * Build an amended policy for "replay against a changed rulebook" — the officer
 * moves one threshold and the same frozen evidence is judged again. Only the
 * configured number changes; no rule is evaluated here.
 */
export function amendPolicy(policy, overrides) {
  const rules = policy.rules.map((r) =>
    overrides[r.code] === undefined ? r : { ...r, threshold: Number(overrides[r.code]) },
  )
  return {
    ...policy,
    rules,
    version: `${policy.version}+local`,
    effective_date: new Date().toISOString().slice(0, 10),
  }
}

export { TRANSPORTS }
