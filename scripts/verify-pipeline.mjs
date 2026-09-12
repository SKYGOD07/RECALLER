/**
 * RECALLER — full pipeline verification.
 *
 * Runs every synthetic application through the real orchestrator and checks the
 * properties the product claims: the audit chain is unbroken, a suspended file
 * resumes, a replay reproduces the decision exactly, and a file that cannot be
 * approved has a reachable what-if.
 *
 *   node --import ./scripts/alias.mjs scripts/verify-pipeline.mjs [--verbose]
 */

import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'

import { verifyLedger } from '@core/audit.js'
import { formatInr, formatPct } from '@core/money.js'
import {
  replay,
  resumeUnderwriting,
  runUnderwriting,
  runWhatIf,
} from '@orchestrator/index.js'
import { SYNTHETIC_APPLICATIONS } from '@synthetic/applications.js'

const VERBOSE = process.argv.includes('--verbose')
const POLICY = JSON.parse(
  await readFile(new URL('../policy/policy.v1.json', import.meta.url), 'utf8')
)

let checks = 0
let failures = 0

function check(ok, label, detail) {
  checks += 1
  if (!ok) {
    failures += 1
    console.error(`  FAIL  ${label}`)
    if (detail) console.error(`        ${detail}`)
  } else if (VERBOSE) {
    console.log(`  ok    ${label}`)
  }
}

function headerOf(app) {
  const { documents, scenario, ...rest } = app
  return rest
}

for (const app of SYNTHETIC_APPLICATIONS) {
  const header = headerOf(app)
  console.log(`\n${header.id}  ${header.borrower_name}`)
  console.log(`  ${app.scenario}`)

  let record = await runUnderwriting({
    application: header,
    documents: app.documents,
    policy: POLICY,
    now: header.created_at,
  })

  const suspended = record.status === 'WAITING_FOR_OFFICER'
  if (suspended) {
    check(
      record.decision === null,
      `${header.id}: no verdict exists while the file is held`,
      `decision was ${JSON.stringify(record.decision)}`
    )
    const queue = record.assist.queue
    check(queue.length > 0, `${header.id}: suspended file has a non-empty officer queue`)
    console.log(`  held ${queue.length} field(s) for the officer:`)
    for (const q of queue) {
      console.log(
        `    ${q.path.padEnd(34)} ${String(q.confidence).padEnd(7)} floor ${q.floor}` +
          (q.attested ? '  [attested]' : '')
      )
    }

    record = await resumeUnderwriting({
      record,
      resolutions: queue.map((q) => ({
        path: q.path,
        action: 'CONFIRM',
        by: header.officer,
        at: header.created_at,
        note: 'Verified against the original document at the counter',
      })),
      policy: POLICY,
      now: header.created_at,
    })
    check(
      record.status !== 'WAITING_FOR_OFFICER',
      `${header.id}: resumes after officer input`
    )
    check(
      Boolean(record.reconciliation?.findings?.length),
      `${header.id}: reconciliation re-ran after officer input`
    )
    check(
      Boolean(record.policyEvaluation?.rules?.length),
      `${header.id}: policy re-ran after officer input`
    )
  }

  // 1 — audit chain
  const ledger = verifyLedger(record.audit)
  check(ledger.ok, `${header.id}: audit hash chain intact`, `${ledger.brokenAt}: ${ledger.reason}`)

  // 2 — replay determinism
  const rp = await replay({ record, policy: POLICY })
  check(rp.identical, `${header.id}: replay reproduces the decision`, JSON.stringify(rp.diff))
  check(rp.used_llm === false, `${header.id}: replay used no language model`)

  // 3 — the deterministic figures actually exist
  const m = record.credit?.metrics || {}
  for (const key of ['emi', 'foir', 'ltv', 'obligations', 'verified_monthly_income']) {
    check(m[key] != null, `${header.id}: ${key} was computed`)
  }

  // 4 — an unapproved file must have a reachable what-if
  if (record.decision?.decision !== 'APPROVE') {
    const wi = runWhatIf({ record, policy: POLICY })
    check(Boolean(wi), `${header.id}: what-if produced a result`)
  }

  console.log(
    `  income ${formatInr(m.verified_monthly_income)}  ` +
      `obligations ${formatInr(m.obligations)}  ` +
      `EMI ${formatInr(m.emi)}  FOIR ${formatPct(m.foir)}  LTV ${formatPct(m.ltv)}`
  )

  // 5 — informal credit, where a reference was supplied
  const informal = record.credit?.informal_credit
  if (informal && (informal.applicable || informal.monthly_repayment > 0)) {
    console.log(
      `  informal: ${informal.corroborated ? 'corroborated by bank debit' : 'not in the statement'}` +
        `, added ${formatInr(informal.added)} to obligations`
    )
    check(
      informal.corroborated ? informal.added === 0 : true,
      `${header.id}: a corroborated informal repayment is not double-counted`
    )
  }

  console.log(
    `  ${record.decision?.decision || record.status}  ` +
      `[${(record.decision?.reason_codes || []).map((c) => c.code).join(' ')}]`
  )
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.error(`${failures} FAILED`)
  process.exit(1)
}
