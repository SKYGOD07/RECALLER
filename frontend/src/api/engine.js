/**
 * Engine transport — the deterministic domain packages, executed in the browser.
 *
 * This is the offline / demo mode. It is not a second implementation and not a
 * parallel mock schema: it calls the same orchestrator, the same credit engine
 * and the same policy document the backend calls, so a record produced here is
 * byte-for-byte the record the backend would have produced.
 *
 * The UI still performs no credit arithmetic — it only ever reads what these
 * functions return.
 */

import { verifyLedger } from '@core/audit.js'
import {
  APP_STATUS,
  DOC_LABELS,
  OPTIONAL_DOCS,
  PROVENANCE,
  REQUIRED_DOCS,
  STATUS_LABELS,
} from '@core/constants.js'
import {
  STAGE_PLAN,
  replay as replayRun,
  resumeUnderwriting as resumeRun,
  runSimulation,
  runUnderwriting,
  runWhatIf,
} from '@orchestrator/index.js'
import { DECISIONS, ENGINE_VERSION, WORKFLOW_VERSION } from '@core/constants.js'
import { STAGE_LABELS } from '@core/audit.js'
import policyV1 from '@policy/policy.v1.json'
import { SYNTHETIC_APPLICATIONS } from '@synthetic/applications.js'

/**
 * Stage pacing.
 *
 * The deterministic engine returns in single-digit milliseconds, which would
 * make the run view a flicker. These delays mirror `STAGE_PACING` in the
 * backend store so both transports feel identical, and they model the latency
 * of real document understanding.
 */
const STAGE_PACING = {
  INGEST: 380,
  KYC: 900,
  BANK: 1500,
  PLATFORM: 850,
  INVOICE: 780,
  VALIDATE: 420,
  RECONCILE: 620,
  GATE: 340,
  CREDIT: 520,
  POLICY: 460,
  DECISION: 380,
  MEMO: 700,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const blankProgress = () => Object.fromEntries(STAGE_PLAN.map((s) => [s.id, 'PENDING']))

const stripRuntime = ({ scenario, status, decision, updated_at, custom, document_count, ...rest }) => rest

/**
 * State is anchored on globalThis rather than module scope: Vite's HMR
 * re-imports a changed module under a cache-busting URL, which would otherwise
 * fork the store and leave the mounted tree reading an empty copy.
 */
const KEY = '__recaller_engine_store__'

function createState() {
  const state = {
    applications: new Map(),
    bundles: new Map(),
    records: new Map(),
    progress: new Map(),
    replays: new Map(),
  }
  seed(state)
  return state
}

function seed(state) {
  SYNTHETIC_APPLICATIONS.forEach((app) => {
    const { documents, scenario, ...header } = app
    state.applications.set(app.id, {
      ...header,
      scenario,
      status: APP_STATUS.DRAFT,
      decision: null,
      updated_at: header.created_at,
      custom: false,
      document_count: documents.length,
    })
    state.bundles.set(app.id, documents)
    state.progress.set(app.id, blankProgress())
  })
}

function commit(state, id, record) {
  state.records.set(id, record)
  const header = state.applications.get(id)
  state.applications.set(id, {
    ...header,
    status: record.status,
    decision: record.decision?.decision ?? null,
    updated_at: record.generated_at ?? new Date().toISOString(),
  })

  const progress = blankProgress()
  const completed = record.checkpoint?.completed_stages ?? STAGE_PLAN.map((s) => s.id)
  completed.forEach((s) => {
    progress[s] = 'DONE'
  })
  if (record.status === APP_STATUS.WAITING_FOR_OFFICER) progress.GATE = 'HELD'
  state.progress.set(id, progress)
}

export function createEngineTransport() {
  const state = globalThis[KEY] ?? (globalThis[KEY] = createState())

  const stageListener = (id, onStage, paced) => async ({ id: stageId, status }) => {
    state.progress.set(id, { ...state.progress.get(id), [stageId]: status })
    onStage?.({ id: stageId, status })
    if (paced && status === 'RUNNING') await sleep(STAGE_PACING[stageId] ?? 400)
  }

  const requireRecord = (id) => {
    const record = state.records.get(id)
    if (!record) throw new Error(`No underwriting record for ${id}`)
    return record
  }

  return {
    name: 'engine',

    async health() {
      return {
        status: 'ok',
        engine_version: ENGINE_VERSION,
        workflow_version: WORKFLOW_VERSION,
      }
    },

    async getPolicy() {
      return policyV1
    },

    async getStagePlan() {
      return STAGE_PLAN
    },

    /** Mirrors GET /api/bootstrap: everything the console needs to start. */
    async bootstrap() {
      return {
        engine_version: ENGINE_VERSION,
        workflow_version: WORKFLOW_VERSION,
        policy: policyV1,
        stage_plan: STAGE_PLAN,
        applications: [...state.applications.values()],
        vocab: {
          status_labels: STATUS_LABELS,
          doc_labels: DOC_LABELS,
          required_docs: REQUIRED_DOCS,
          optional_docs: OPTIONAL_DOCS,
          provenance: PROVENANCE,
          decisions: DECISIONS.ALL ?? [DECISIONS.APPROVE, DECISIONS.REFER, DECISIONS.REJECT],
          stage_labels: STAGE_LABELS,
        },
        llm: { enabled: false, provider: null, model: null },
      }
    },

    /** Mirrors GET /api/applications/:id/audit/verify. */
    async verifyAudit(id) {
      const record = requireRecord(id)
      const ledger = record.audit ?? { events: [] }
      return {
        ...verifyLedger(ledger),
        events: ledger.events?.length ?? 0,
        head: ledger.head,
        trace_id: ledger.traceId,
      }
    },

    async listApplications() {
      return [...state.applications.values()]
    },

    async getApplication(id) {
      const application = state.applications.get(id)
      if (!application) throw new Error(`Application ${id} not found`)
      return {
        application,
        documents: (state.bundles.get(id) ?? []).map(({ payload, degrade, ...d }) => d),
        record: state.records.get(id) ?? null,
        progress: state.progress.get(id) ?? blankProgress(),
        replays: state.replays.get(id) ?? [],
      }
    },

    async startUnderwriting(id, { paced = true, onStage } = {}) {
      const header = state.applications.get(id)
      const documents = state.bundles.get(id)
      if (!header || !documents) throw new Error(`Unknown application ${id}`)

      state.applications.set(id, { ...header, status: APP_STATUS.PROCESSING })
      state.progress.set(id, blankProgress())

      const record = await runUnderwriting({
        application: stripRuntime(header),
        documents,
        policy: policyV1,
        onStage: stageListener(id, onStage, paced),
      })

      commit(state, id, record)
      return record
    },

    async resumeUnderwriting(id, resolutions, { paced = true, onStage } = {}) {
      const record = requireRecord(id)
      state.applications.set(id, { ...state.applications.get(id), status: APP_STATUS.PROCESSING })

      const next = await resumeRun({
        record,
        resolutions,
        policy: policyV1,
        onStage: stageListener(id, onStage, paced),
      })

      commit(state, id, next)
      return next
    },

    async replayApplication(id, { policy = null, label } = {}) {
      const record = requireRecord(id)
      const result = await replayRun({ record, policy: policy ?? policyV1, label })
      state.replays.set(id, [result, ...(state.replays.get(id) ?? [])].slice(0, 12))
      return result
    },

    async solveWhatIf(id, target = 'APPROVE') {
      const record = requireRecord(id)
      if (!record.credit) throw new Error(`Cannot run what-if on ${id}`)
      return runWhatIf({ record, policy: policyV1, target })
    },

    async simulateScenario(id, scenario) {
      const record = requireRecord(id)
      if (!record.credit) throw new Error(`Cannot simulate on ${id}`)
      return runSimulation({ record, policy: policyV1, scenario })
    },

    async resetConsole() {
      state.records.clear()
      state.replays.clear()
      state.applications.clear()
      state.bundles.clear()
      state.progress.clear()
      seed(state)
      return { ok: true, applications: [...state.applications.values()] }
    },
  }
}
