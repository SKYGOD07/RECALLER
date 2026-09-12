/**
 * RECALLER — agent-facing contract tests.
 *
 *   node --import ./scripts/alias.mjs --test scripts/test-agent.mjs
 *
 * The console and the reasoning agents read the same decision record. This
 * pins down what that record must always carry, and — more importantly — the
 * boundary: no agent-visible surface may be a route into a credit number.
 *
 * The agent runtime itself (Hermes: tool registry, toolsets, delegation) lives
 * on the Python side and is covered by tests/test_hermes.py. What is checked
 * here is the contract the JavaScript half publishes to it.
 */

import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { test } from 'node:test'
import { URL, fileURLToPath } from 'node:url'

import { STAGES } from '@core/audit.js'
import { STAGE_PLAN, replay, resumeUnderwriting, runUnderwriting } from '@orchestrator/index.js'
import { SYNTHETIC_APPLICATIONS } from '@synthetic/applications.js'

const ROOT = new URL('../', import.meta.url)
const POLICY = JSON.parse(await readFile(new URL('policy/policy.v1.json', ROOT), 'utf8'))

function headerOf(app) {
  const { documents, scenario, ...rest } = app
  return rest
}

async function settled(appId) {
  const app = SYNTHETIC_APPLICATIONS.find((a) => a.id === appId)
  const header = headerOf(app)
  let record = await runUnderwriting({
    application: header,
    documents: app.documents,
    policy: POLICY,
    now: header.created_at,
  })
  if (record.status === 'WAITING_FOR_OFFICER') {
    record = await resumeUnderwriting({
      record,
      resolutions: record.assist.queue.map((q) => ({
        path: q.path,
        action: 'CONFIRM',
        by: header.officer,
        at: header.created_at,
      })),
      policy: POLICY,
      now: header.created_at,
    })
  }
  return record
}

/* ------------------------------------------------------ skills on disk */

test('shipped agent skills are present and non-empty', async () => {
  const dir = new URL('packages/agent/skills/', ROOT)
  const entries = await readdir(dir)
  assert.ok(entries.length > 0, 'no agent skills shipped')
  for (const name of entries) {
    const skill = new URL(`packages/agent/skills/${name}/SKILL.md`, ROOT)
    const info = await stat(skill)
    assert.ok(info.size > 0, `${name}/SKILL.md is empty`)
  }
})

test('no skill instructs an agent to compute a credit figure', async () => {
  const dir = new URL('packages/agent/skills/', ROOT)
  const forbidden = /\b(compute|calculate|work out)\s+(the\s+)?(emi|foir|ltv)\b/i
  for (const name of await readdir(dir)) {
    const text = await readFile(new URL(`packages/agent/skills/${name}/SKILL.md`, ROOT), 'utf8')
    assert.equal(
      forbidden.test(text),
      false,
      `${name}/SKILL.md appears to ask an agent for a credit calculation`
    )
  }
})

/* -------------------------------------------------- the published record */

test('the decision record carries everything the console and an agent need', async () => {
  const record = await settled('RCL-2026-0418')

  for (const key of [
    'application',
    'documents',
    'evidence',
    'reconciliation',
    'credit',
    'policyEvaluation',
    'decision',
    'memo',
    'audit',
    'assist',
    'policy_version',
    'policy_hash',
    'engine_version',
    'stage_plan',
    'evidence_strength',
  ]) {
    assert.ok(record[key] != null, `record.${key} is missing`)
  }

  assert.ok(Array.isArray(record.decision.reason_codes))
  assert.ok(record.decision.reason_codes.length > 0)
  assert.ok(record.credit.input_hash, 'no deterministic fingerprint on the credit result')
  assert.equal(record.policy_version, POLICY.version)
})

test('every evidence field publishes confidence and provenance', async () => {
  const record = await settled('RCL-2026-0418')
  const fields = Object.values(record.evidence.fields)
  assert.ok(fields.length > 20)
  for (const f of fields) {
    assert.equal(typeof f.confidence, 'number', `${f.path} has no confidence`)
    assert.ok(f.confidence >= 0 && f.confidence <= 1, `${f.path} confidence out of range`)
    assert.ok(f.provenance, `${f.path} has no provenance`)
    assert.ok(f.type, `${f.path} has no type`)
    // Declared and computed values have no document behind them; anything the
    // system read or was told must say where it came from.
    if (f.provenance === 'EXTRACTED' || f.provenance === 'INFORMANT') {
      assert.ok(f.citation, `${f.path} has no citation`)
      assert.ok(f.citation.document, `${f.path} citation has no document`)
    }
  }
})

test('the execution trace is real, ordered, and hash-chained', async () => {
  const record = await settled('RCL-2026-0418')
  const events = record.audit.events
  assert.ok(events.length >= STAGE_PLAN.length)

  // Every stage that claims to have run must carry a measured duration.
  const timed = events.filter((e) => e.durationMs != null)
  assert.ok(timed.length >= 10, 'stages are not being timed')
  for (const e of timed) {
    assert.equal(typeof e.durationMs, 'number')
    assert.ok(e.durationMs >= 0)
  }

  // Each event names who did it, is sequenced, and links to the one before it.
  let prev = '0'.repeat(32)
  events.forEach((e, i) => {
    assert.ok(e.actor, 'event with no actor')
    assert.ok(e.stage, 'event with no stage')
    assert.ok(e.digest, 'event with no digest')
    assert.equal(e.seq, i + 1, 'events are out of sequence')
    assert.equal(e.prev, prev, `chain broken at event ${i}`)
    prev = e.digest
  })
  assert.equal(record.audit.head, prev, 'ledger head does not match the last event')

  // The informant stage is a declared stage, not an ad-hoc string.
  assert.ok(STAGES.includes('INFORMANT_ATTESTATION'))
  assert.ok(events.some((e) => e.stage === 'INFORMANT_ATTESTATION'))
})

test('a held file publishes its officer queue and no verdict', async () => {
  const app = SYNTHETIC_APPLICATIONS.find((a) => a.id === 'RCL-2026-0421')
  const header = headerOf(app)
  const record = await runUnderwriting({
    application: header,
    documents: app.documents,
    policy: POLICY,
    now: header.created_at,
  })
  assert.equal(record.status, 'WAITING_FOR_OFFICER')
  assert.equal(record.decision, null)
  assert.equal(record.credit, null)
  assert.equal(record.assist.required, true)
  for (const q of record.assist.queue) {
    assert.ok(q.path && q.label && q.reason)
    assert.ok(q.confidence < q.floor, `${q.path} is queued but above its floor`)
  }
  assert.ok(record.assist.thresholds.field_threshold)
  assert.ok(record.assist.thresholds.attested_field_threshold)
})

/* ------------------------------------------------- deterministic boundary */

test('narration is downstream of the decision, never upstream', async () => {
  const record = await settled('RCL-2026-0418')
  const memo = record.memo

  // The memo is built from the record; dropping it must not disturb a figure.
  const { memo: _dropped, headline: _h, ...withoutMemo } = record
  const rp = await replay({ record: withoutMemo, policy: POLICY })
  assert.equal(rp.identical, true, 'the decision depends on the memo')
  assert.ok(memo.sections.length > 0)
})

test('replay is a pure function of evidence and policy', async () => {
  for (const id of ['RCL-2026-0418', 'RCL-2026-0426', 'RCL-2026-0441']) {
    const record = await settled(id)
    const a = await replay({ record, policy: POLICY })
    const b = await replay({ record, policy: POLICY })
    assert.equal(a.identical, true, `${id} did not reproduce`)
    assert.equal(a.credit.input_hash, b.credit.input_hash, `${id} is not stable`)
    assert.equal(a.decision.decision, b.decision.decision)
    assert.equal(a.used_llm, false)
  }
})

test('an amended policy changes the decision, and says so', async () => {
  const record = await settled('RCL-2026-0418')
  const tightened = JSON.parse(JSON.stringify(POLICY))
  tightened.version = `${POLICY.version}-test`
  for (const r of tightened.rules) if (r.code === 'P-FOIR-01') { r.threshold = 0.01; r.refer_band = null }

  const rp = await replay({ record, policy: tightened, label: 'Tightened FOIR' })
  assert.equal(rp.identical, false)
  assert.equal(rp.decision.decision, 'REJECT')
  assert.notEqual(rp.policy_version, POLICY.version)
})
