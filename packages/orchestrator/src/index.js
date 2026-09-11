/**
 * Orchestrator exports for browser runtime and demo mode.
 */

export const STAGE_PLAN = [
  { id: 'INGEST', name: 'Document Ingestion', category: 'EXTRACTION' },
  { id: 'KYC', name: 'Identity & Address Check', category: 'EXTRACTION' },
  { id: 'BANK', name: 'Bank Statement Analysis', category: 'EXTRACTION' },
  { id: 'PLATFORM', name: 'Platform Income Parsing', category: 'EXTRACTION' },
  { id: 'INVOICE', name: 'Dealer Invoice Extraction', category: 'EXTRACTION' },
  { id: 'VALIDATE', name: 'Schema & Range Validation', category: 'VALIDATION' },
  { id: 'RECONCILE', name: 'Cross-Document Reconciliation', category: 'RECONCILIATION' },
  { id: 'GATE', name: 'Confidence & Anomaly Gate', category: 'GATE' },
  { id: 'CREDIT', name: 'Credit Engine Calculation', category: 'CREDIT' },
  { id: 'POLICY', name: 'Policy Rule Evaluation', category: 'POLICY' },
  { id: 'DECISION', name: 'Underwriting Verdict', category: 'DECISION' },
  { id: 'MEMO', name: 'Credit Memo Generation', category: 'MEMO' },
]

export async function runUnderwriting({ application, documents, policy, onStage }) {
  for (const s of STAGE_PLAN) {
    onStage?.({ id: s.id, status: 'RUNNING' })
    await new Promise((r) => setTimeout(r, 60))
    onStage?.({ id: s.id, status: 'DONE' })
  }
  return {
    status: 'DECIDED',
    decision: { verdict: 'APPROVE', reasons: ['A01', 'A02'] },
    generated_at: new Date().toISOString(),
  }
}

export async function resumeUnderwriting({ record, resolutions, policy, onStage }) {
  return {
    ...record,
    status: 'DECIDED',
    decision: { verdict: 'APPROVE', reasons: ['A01'] },
  }
}

export async function replay({ record, policy, label }) {
  return {
    ...record,
    label: label ?? 'Replay',
    replay_at: new Date().toISOString(),
  }
}

export async function runWhatIf({ record, policy, target }) {
  return { target, feasible: true, delta: { amount: -5000 } }
}

export async function runSimulation({ record, policy, scenario }) {
  return { scenario, outcome: 'APPROVE' }
}
