/**
 * Runs every synthetic bundle through the full pipeline and prints the outcome.
 * Used to keep the demo data honest: if a policy threshold moves, this shows
 * immediately which borrowers change verdict.
 *
 *   node scripts/verify-pipeline.mjs [--verbose]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SYNTHETIC_APPLICATIONS } from '../data/synthetic/applications.js';
import { runUnderwriting, resumeUnderwriting, replay, runWhatIf } from '../packages/orchestrator/src/index.js';
import { formatINR, formatPct } from '../packages/core/src/money.js';
import { verifyLedger } from '../packages/core/src/audit.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(join(root, 'policy/policy.v1.json'), 'utf8'));
const verbose = process.argv.includes('--verbose');

const pad = (s, n) => String(s).padEnd(n);

console.log(`\nPolicy ${policy.policy_id} v${policy.version}  —  ${policy.rules.length} rules\n`);
console.log(pad('APPLICATION', 16), pad('BORROWER', 22), pad('VERDICT', 10), pad('EMI', 12), pad('FOIR', 8), pad('LTV', 8), 'CODES');
console.log('-'.repeat(120));

let failures = 0;

for (const app of SYNTHETIC_APPLICATIONS) {
  const { documents, scenario, ...header } = app;
  let record = await runUnderwriting({ application: header, documents, policy, now: header.created_at });

  let note = '';
  if (record.status === 'WAITING_FOR_OFFICER') {
    note = `  [suspended: ${record.assist.queue.length} field(s) held]`;
    if (verbose) {
      record.assist.queue.forEach((h) =>
        console.log(`      hold ${pad(h.path, 32)} conf ${h.confidence.toFixed(3)} < ${h.floor}  ${h.critical ? 'CRITICAL' : ''}`),
      );
    }
    // Simulate the officer confirming every held field, then resume.
    const resolutions = record.assist.queue.map((h) => ({
      path: h.path,
      action: 'CONFIRM',
      by: header.officer,
      at: header.created_at,
      note: 'Verified against original document at counter',
    }));
    record = await resumeUnderwriting({ record, resolutions, policy, now: header.created_at });
    note += ` -> resumed -> ${record.decision.decision}`;
  }

  const m = record.credit.metrics;
  const codes = record.decision.reason_codes.map((c) => c.code).join(',');
  console.log(
    pad(header.id, 16),
    pad(header.borrower_name, 22),
    pad(record.decision.decision, 10),
    pad(formatINR(m.emi, { decimals: 0 }), 12),
    pad(formatPct(m.foir), 8),
    pad(formatPct(m.ltv), 8),
    codes,
  );
  if (note) console.log(`    ${scenario}${note}`);
  else console.log(`    ${scenario}`);

  if (verbose) {
    console.log(`    income  verified ${formatINR(m.verified_monthly_income)}  bank ${formatINR(record.credit.income_breakdown.bank_view)}  platform ${record.credit.income_breakdown.platform_view === null ? 'n/a' : formatINR(record.credit.income_breakdown.platform_view)}  vol ${formatPct(m.income_volatility)}  months ${m.income_months_observed}`);
    console.log(`    oblig   ${formatINR(m.obligations)}  amb ${formatINR(m.average_monthly_balance)}  bounces ${m.bounce_count}  age ${m.applicant_age} -> ${m.age_at_maturity}`);
    console.log(`    recon   ${record.reconciliation.blocking} blocking / ${record.reconciliation.advisory} advisory / ${record.reconciliation.matched} matched`);
    record.policyEvaluation.rules
      .filter((r) => r.outcome === 'FAIL' || r.outcome === 'REFER')
      .forEach((r) => console.log(`      ${r.outcome === 'FAIL' ? 'FAIL ' : 'REFER'} ${pad(r.code, 12)} ${pad(r.label, 42)} ${r.detail}`));
    record.reconciliation.findings
      .filter((f) => f.status !== 'MATCHED')
      .forEach((f) => console.log(`      ${pad(f.status, 9)} ${pad(f.code, 10)} ${f.label}`));
  }

  /* --- integrity checks ------------------------------------------- */
  const ledgerCheck = verifyLedger(record.audit);
  if (!ledgerCheck.ok) {
    failures += 1;
    console.log(`    !! AUDIT CHAIN BROKEN at ${ledgerCheck.brokenAt}: ${ledgerCheck.reason}`);
  }

  const rp = await replay({ record, policy });
  if (!rp.identical) {
    failures += 1;
    console.log('    !! REPLAY DIVERGED', JSON.stringify(rp.diff));
  }

  if (record.decision.decision !== 'APPROVE') {
    const wi = runWhatIf({ record, policy });
    if (wi.recommended) {
      console.log(`    what-if  ${wi.recommended.change_text} -> ${wi.recommended.result.decision}`);
    } else {
      console.log('    what-if  no single lever reaches APPROVE');
    }
  }
  console.log('');
}

console.log(failures ? `\n${failures} integrity failure(s).\n` : '\nAll audit chains verified and all replays reproduced exactly.\n');
process.exit(failures ? 1 : 0);
