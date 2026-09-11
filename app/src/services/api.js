/**
 * RECALLER console — HTTP client for the Python backend.
 *
 * Every screen talks to the application through this module and nothing else,
 * and this module talks to nothing but the backend's /api. The console holds
 * no credit logic: every figure it shows arrived here already computed.
 *
 *   seed                → GET    /api/bootstrap
 *   loadApplication     → GET    /api/applications/:id
 *   createApplication   → POST   /api/applications
 *   uploadDocument      → POST   /api/applications/:id/documents        (multipart)
 *   attachSample        → POST   /api/applications/:id/documents/sample
 *   startUnderwriting   → POST   /api/applications/:id/underwrite       (202 + SSE)
 *   resumeUnderwriting  → POST   /api/applications/:id/resume           (202 + SSE)
 *   replayApplication   → POST   /api/applications/:id/replay
 *   solveWhatIf         → POST   /api/applications/:id/whatif
 *   simulateScenario    → POST   /api/applications/:id/simulate
 *   startAgentRun       → POST   /api/applications/:id/agent/:kind
 *
 * Every request carries an X-Request-ID (ui-…); the backend echoes it, logs it
 * at /api/diagnostics/requests and puts it in every error body, so a failure in
 * the UI can be matched to the exact server-side request.
 */

import { fillVocab } from '@/lib/vocab.js';

export const MODE = 'http';
const BASE = (import.meta.env.VITE_RECALLER_API ?? '').replace(/\/$/, '');

/** Filled from /api/bootstrap before the console renders. */
export const POLICY = {};
export const STAGE_PLAN = [];
export let POLICY_HASH = '';
export let LLM = { enabled: false };
export let LIMITS = { max_upload_mb: 20 };

/* ================================================================== *
 * Transport
 * ================================================================== */

export class ApiError extends Error {
  constructor(status, body, requestId, method, path) {
    super(body?.error?.message ?? `HTTP ${status} on ${method} ${path}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? `HTTP_${status}`;
    this.details = body?.error?.details;
    this.requestId = requestId ?? body?.error?.request_id ?? null;
    this.method = method;
    this.path = path;
  }
}

let seq = 0;
const newRequestId = () => `ui-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** The last 150 requests this browser made, newest first (shown on the System screen). */
export const clientLog = [];

async function request(method, path, { json, form, signal } = {}) {
  const requestId = newRequestId();
  const headers = { Accept: 'application/json', 'X-Request-ID': requestId };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const started = performance.now();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body, signal });
  } catch (err) {
    logCall({ method, path, status: 0, ms: performance.now() - started, requestId, error: 'NETWORK' });
    const e = new ApiError(0, { error: { code: 'NETWORK', message: `Could not reach the RECALLER backend (${err.message}). Is it running?` } }, requestId, method, path);
    throw e;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: { code: 'BAD_RESPONSE', message: text.slice(0, 200) } };
  }
  const serverMs = Number(/dur=([\d.]+)/.exec(res.headers.get('Server-Timing') ?? '')?.[1]);
  logCall({
    method,
    path,
    status: res.status,
    ms: performance.now() - started,
    serverMs: Number.isFinite(serverMs) ? serverMs : null,
    requestId: res.headers.get('X-Request-ID') ?? requestId,
    error: res.ok ? null : data?.error?.code,
  });
  if (!res.ok) throw new ApiError(res.status, data, res.headers.get('X-Request-ID') ?? requestId, method, path);
  return data;
}

function logCall(entry) {
  clientLog.unshift({ at: new Date().toISOString(), ...entry, ms: Math.round(entry.ms) });
  clientLog.length = Math.min(clientLog.length, 150);
}

/* ================================================================== *
 * Store (useSyncExternalStore)
 * ================================================================== */

const STORE_KEY = '__recaller_console_store__';

/**
 * Anchored on globalThis so Vite HMR re-imports never fork the store — a
 * forked store leaves the mounted tree reading one copy while writes land in
 * the other, and the console appears empty.
 */
const state =
  globalThis[STORE_KEY] ??
  (globalThis[STORE_KEY] = {
    applications: new Map(),
    bundles: new Map(),
    records: new Map(),
    progress: new Map(),
    replays: new Map(),
    jobs: new Map(),
    agentRuns: new Map(),
    loaded: new Set(),
    streams: new Map(),
    listeners: new Set(),
    snapshotToken: 0,
    snapshot: null,
    seeded: false,
    lastError: null,
  });

function emit() {
  state.snapshotToken += 1;
  state.snapshot = null;
  state.listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function getSnapshot() {
  if (state.snapshot === null) {
    state.snapshot = {
      token: state.snapshotToken,
      applications: [...state.applications.values()],
      records: state.records,
      progress: state.progress,
      replays: state.replays,
      lastError: state.lastError,
    };
  }
  return state.snapshot;
}

/** Surface a failure in the console's error banner (with its request id). */
export function reportError(err) {
  state.lastError = {
    message: err?.message ?? String(err),
    code: err?.code ?? null,
    requestId: err?.requestId ?? null,
    at: new Date().toISOString(),
  };
  console.error('[recaller]', err);
  emit();
}

export function clearError() {
  state.lastError = null;
  emit();
}

function blankProgress() {
  return Object.fromEntries(STAGE_PLAN.map((s) => [s.id, 'PENDING']));
}

/* ================================================================== *
 * Bootstrap and reads
 * ================================================================== */

export async function seed() {
  if (state.seeded) return;
  const boot = await request('GET', '/api/bootstrap');
  Object.keys(POLICY).forEach((k) => delete POLICY[k]);
  Object.assign(POLICY, boot.policy);
  STAGE_PLAN.splice(0, STAGE_PLAN.length, ...boot.stage_plan);
  POLICY_HASH = boot.policy_hash;
  LLM = boot.llm;
  LIMITS = boot.limits;
  fillVocab(boot);
  state.applications = new Map(boot.applications.map((a) => [a.id, a]));
  state.seeded = true;
  emit();
}

export async function refreshApplications() {
  const list = await request('GET', '/api/applications');
  state.applications = new Map(list.map((a) => [a.id, a]));
  emit();
  return list;
}

function applyDetail(detail) {
  const id = detail.application.id;
  state.applications.set(id, detail.application);
  state.bundles.set(id, detail.documents);
  if (detail.record) state.records.set(id, detail.record);
  else state.records.delete(id);
  state.progress.set(id, detail.progress);
  state.replays.set(id, detail.replays);
  state.jobs.set(id, detail.job);
  state.agentRuns.set(id, detail.agent_runs ?? []);
  state.loaded.add(id);
}

export async function loadApplication(id) {
  const detail = await request('GET', `/api/applications/${encodeURIComponent(id)}`);
  applyDetail(detail);
  emit();
  if (detail.job?.status === 'RUNNING') followJob(id);
  return detail;
}

/** Load a file's full state the first time a screen needs it. */
export function ensureApplication(id) {
  if (!id || state.loaded.has(id)) return Promise.resolve();
  state.loaded.add(id);
  return loadApplication(id).catch((err) => {
    state.loaded.delete(id);
    if (err.status !== 404) reportError(err);
  });
}

export const listApplications = () => getSnapshot().applications;
export const getApplication = (id) => state.applications.get(id) ?? null;
export const getDocuments = (id) => state.bundles.get(id) ?? [];
export const getRecord = (id) => state.records.get(id) ?? null;
export const getProgress = (id) => state.progress.get(id) ?? blankProgress();
export const getReplays = (id) => state.replays.get(id) ?? [];
export const getJob = (id) => state.jobs.get(id) ?? null;
export const getAgentRuns = (id) => state.agentRuns.get(id) ?? [];

/* ================================================================== *
 * Runs — 202 Accepted, then follow the job over Server-Sent Events
 * ================================================================== */

/**
 * Follow the application's running job. Resolves with the finished record.
 * `once=true` makes the server close the stream after the job ends (or at once
 * if it already has), so EventSource never reconnects into a finished job.
 */
function followJob(id) {
  if (state.streams.has(id)) return state.streams.get(id);
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    const es = new EventSource(`${BASE}/api/applications/${encodeURIComponent(id)}/events?once=true`);

    const finish = async (endEvent) => {
      if (settled) return;
      settled = true;
      es.close();
      state.streams.delete(id);
      try {
        const detail = await loadApplication(id);
        if (endEvent?.status === 'FAILED') {
          const err = new ApiError(500, { error: { code: 'RUN_FAILED', message: endEvent.error ?? 'The run failed.' } }, null, 'JOB', id);
          reportError(err);
          reject(err);
        } else {
          resolve(detail.record);
        }
      } catch (err) {
        reject(err);
      }
    };

    es.addEventListener('snapshot', (e) => {
      const data = JSON.parse(e.data);
      state.progress.set(id, data.progress);
      emit();
    });
    es.addEventListener('stage', (e) => {
      const data = JSON.parse(e.data);
      state.progress.set(id, { ...getProgress(id), [data.id]: data.status });
      emit();
    });
    es.addEventListener('end', (e) => finish(JSON.parse(e.data)));
    es.onerror = () => {
      // EventSource retries on its own; if the stream is gone for good, fall back to polling.
      if (es.readyState === EventSource.CLOSED && !settled) pollUntilIdle(id).then(() => finish(null), reject);
    };
  });
  state.streams.set(id, promise);
  return promise;
}

async function pollUntilIdle(id) {
  for (;;) {
    const detail = await request('GET', `/api/applications/${encodeURIComponent(id)}`);
    if (detail.job?.status !== 'RUNNING') return detail;
    await new Promise((r) => setTimeout(r, 800));
  }
}

function markProcessing(id) {
  const header = state.applications.get(id);
  if (header) state.applications.set(id, { ...header, status: 'PROCESSING' });
  state.progress.set(id, blankProgress());
  emit();
}

export async function startUnderwriting(id, { paced = true } = {}) {
  markProcessing(id);
  try {
    await request('POST', `/api/applications/${encodeURIComponent(id)}/underwrite?async=true`, { json: { paced } });
    return await followJob(id);
  } catch (err) {
    await loadApplication(id).catch(() => {});
    reportError(err);
    throw err;
  }
}

export async function resumeUnderwriting(id, resolutions, { paced = true } = {}) {
  const header = state.applications.get(id);
  if (header) state.applications.set(id, { ...header, status: 'PROCESSING' });
  emit();
  try {
    await request('POST', `/api/applications/${encodeURIComponent(id)}/resume?async=true`, { json: { resolutions, paced } });
    return await followJob(id);
  } catch (err) {
    await loadApplication(id).catch(() => {});
    reportError(err);
    throw err;
  }
}

export async function replayApplication(id, { policy = POLICY, label } = {}) {
  const result = await request('POST', `/api/applications/${encodeURIComponent(id)}/replay`, { json: { policy, label } });
  state.replays.set(id, [result, ...getReplays(id)].slice(0, 12));
  emit();
  return result;
}

export function solveWhatIf(id, target = 'APPROVE') {
  return request('POST', `/api/applications/${encodeURIComponent(id)}/whatif`, { json: { target } });
}

export function simulateScenario(id, scenario) {
  return request('POST', `/api/applications/${encodeURIComponent(id)}/simulate`, { json: { scenario } });
}

export function verifyAudit(id) {
  return request('GET', `/api/applications/${encodeURIComponent(id)}/audit/verify`);
}

/* ================================================================== *
 * Origination
 * ================================================================== */

export async function createApplication(form) {
  const header = await request('POST', '/api/applications', {
    json: {
      borrower_name: form.borrower_name,
      segment: form.segment,
      loan_amount: Number(form.loan_amount),
      tenure_months: Number(form.tenure_months),
      declared_monthly_income: Number(form.declared_monthly_income),
      branch: form.branch ?? '',
      officer: form.officer ?? '',
      dealer: form.dealer ?? '',
      occupation: form.occupation ?? '',
    },
  });
  state.applications.set(header.id, header);
  state.bundles.set(header.id, []);
  state.progress.set(header.id, blankProgress());
  emit();
  return header.id;
}

async function afterDocumentChange(id) {
  await loadApplication(id);
}

export async function uploadDocument(id, type, file) {
  const form = new FormData();
  form.append('type', type);
  form.append('file', file, file.name);
  const doc = await request('POST', `/api/applications/${encodeURIComponent(id)}/documents`, { form });
  await afterDocumentChange(id);
  return doc;
}

export async function attachSample(id, type) {
  const doc = await request('POST', `/api/applications/${encodeURIComponent(id)}/documents/sample`, { json: { type } });
  await afterDocumentChange(id);
  return doc;
}

export async function removeDocument(id, docId) {
  await request('DELETE', `/api/applications/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}`);
  await afterDocumentChange(id);
}

export function getDocumentDetail(docId) {
  return request('GET', `/api/documents/${encodeURIComponent(docId)}`);
}

export function getQuote(segment, amount, tenure) {
  const q = new URLSearchParams({ segment, amount: String(amount), tenure: String(tenure) });
  return request('GET', `/api/quote?${q}`);
}

/* ================================================================== *
 * Agents (advisory; need a configured model)
 * ================================================================== */

export async function startAgentRun(id, kind) {
  const run = await request('POST', `/api/applications/${encodeURIComponent(id)}/agent/${kind}`);
  state.agentRuns.set(id, [run, ...getAgentRuns(id)]);
  emit();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const runs = await request('GET', `/api/applications/${encodeURIComponent(id)}/agent-runs`);
    state.agentRuns.set(id, runs);
    emit();
    const mine = runs.find((r) => r.id === run.id);
    if (!mine || mine.status !== 'RUNNING') return mine;
  }
}

/* ================================================================== *
 * Policy helpers, reset
 * ================================================================== */

/**
 * Build an amended policy for "replay with current policy" — the officer edits
 * a threshold and the same frozen evidence is judged against the new rulebook.
 * The backend evaluates it; this only assembles the document.
 */
export function amendPolicy(overrides) {
  const rules = POLICY.rules.map((r) => (overrides[r.code] === undefined ? r : { ...r, threshold: Number(overrides[r.code]) }));
  return { ...POLICY, rules, version: `${POLICY.version}+local`, effective_date: new Date().toISOString().slice(0, 10) };
}

export async function resetConsole() {
  try {
    const out = await request('POST', '/api/reset');
    ['records', 'replays', 'bundles', 'progress', 'jobs', 'agentRuns'].forEach((k) => state[k].clear());
    state.loaded.clear();
    state.applications = new Map(out.applications.map((a) => [a.id, a]));
    emit();
  } catch (err) {
    reportError(err);
  }
}

/* ================================================================== *
 * Diagnostics (System screen)
 * ================================================================== */

export const diagnostics = {
  health: () => request('GET', '/api/health'),
  config: () => request('GET', '/api/diagnostics/config'),
  requests: (limit = 100) => request('GET', `/api/diagnostics/requests?limit=${limit}`),
  clearRequests: () => request('DELETE', '/api/diagnostics/requests'),
  jobs: () => request('GET', '/api/diagnostics/jobs'),
  skills: () => request('GET', '/api/skills'),
  async probe() {
    const targets = ['/api/health', '/api/bootstrap', '/api/applications', '/api/samples', '/api/skills'];
    const out = [];
    for (const path of targets) {
      const t = performance.now();
      try {
        await request('GET', path);
        out.push({ path, ok: true, ms: Math.round(performance.now() - t) });
      } catch (err) {
        out.push({ path, ok: false, ms: Math.round(performance.now() - t), error: err.code });
      }
    }
    return out;
  },
};
