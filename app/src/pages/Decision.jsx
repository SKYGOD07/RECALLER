/**
 * Screen 9 — Decision.
 *
 * The verdict, and everything that produced it, on one screen: reason codes,
 * the metrics that drove them, the rules that fired, the findings that matter,
 * and the evidence behind those. Exactly three verdicts exist — APPROVE, REFER,
 * REJECT — and no alternative wording for them appears anywhere in the product.
 */

import { navigate } from '@/hooks/index.js';
import {
  Card,
  DecisionPill,
  FindingPill,
  Icon,
  Metric,
  OutcomePill,
  PageHead,
  ceilingTone,
  Money,
} from '@/components/ui.jsx';
import AgentPanel from '@/components/AgentPanel.jsx';
import { POLICY } from '@/services/api.js';
import { formatINR, formatPct } from '@/lib/format.js';
import { PROVENANCE } from '@/lib/vocab.js';

const NEXT_STEP = {
  APPROVE: 'Issue the sanction letter and release the invoice to the dealer.',
  REFER: 'A credit officer must clear the items below before this file can be sanctioned or declined.',
  REJECT: 'Communicate the decline with the reason codes. The what-if sandbox shows whether any change would help.',
};

export default function Decision({ application, record }) {
  const d = record.decision.decision;
  const codes = record.decision.reason_codes;
  const m = record.credit.metrics;
  const evalResult = record.policyEvaluation;

  const decisive = evalResult.rules.filter((r) =>
    d === 'APPROVE' ? r.outcome === 'PASS' && r.reason : r.outcome === 'FAIL' || r.outcome === 'REFER',
  );
  const criticalFindings = record.reconciliation.findings.filter((f) => f.status !== 'MATCHED');
  const interventions = Object.values(record.evidence.fields).filter((f) => f.provenance === PROVENANCE.OFFICER);

  const foirRule = POLICY.rules.find((r) => r.code === 'P-FOIR-01');
  const ltvRule = POLICY.rules.find((r) => r.code === 'P-LTV-01');

  return (
    <div className="page">
      <PageHead
        eyebrow="Underwriting outcome"
        title="Decision"
        actions={
          <>
            {d !== 'APPROVE' && (
              <button type="button" className="btn" onClick={() => navigate(`/app/${application.id}/whatif`)}>
                <Icon name="whatif" size={14} />
                What-if
              </button>
            )}
            <button type="button" className="btn btn--primary" onClick={() => navigate(`/app/${application.id}/memo`)}>
              <Icon name="memo" size={14} />
              Credit memo
            </button>
          </>
        }
      />

      <div className={`verdict verdict--${d}`} style={{ marginBottom: 16 }}>
        <span className="verdict__word">{d}</span>
        <div className="verdict__body">
          <div style={{ fontSize: 14, fontWeight: 550 }}>
            {application.borrower_name} · {formatINR(application.loan_amount)} over {application.tenure_months} months
          </div>
          <div className="verdict__line">{record.headline}</div>
          <div className="verdict__line" style={{ color: 'var(--text-3)' }}>
            {NEXT_STEP[d]}
          </div>
        </div>
      </div>

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <Metric
          label="Monthly instalment"
          value={formatINR(m.emi, { decimals: 0 })}
          sub={`${m.tenure_months} months at ${record.credit.inputs.rate_annual_pct}%`}
        />
        <Metric
          label="FOIR"
          value={formatPct(m.foir)}
          sub={`ceiling ${formatPct(foirRule.threshold, 0)}`}
          tone={ceilingTone(m.foir, foirRule.threshold, foirRule.refer_band)}
          fill={m.foir / 1.0}
          cap={foirRule.threshold}
        />
        <Metric
          label="LTV"
          value={formatPct(m.ltv)}
          sub={`ceiling ${formatPct(ltvRule.threshold, 0)}`}
          tone={ceilingTone(m.ltv, ltvRule.threshold, ltvRule.refer_band)}
          fill={m.ltv / 1.1}
          cap={ltvRule.threshold / 1.1}
        />
        <Metric
          label="Verified income"
          value={formatINR(m.verified_monthly_income, { decimals: 0 })}
          sub={`${m.income_months_observed} months observed`}
        />
      </div>

      <div className="grid grid--sidebar">
        <div className="stack">
          <Card title="Reason codes" eyebrow={`${codes.length} codes`}>
            <div className="codelist">
              {codes.map((c) => (
                <div key={c.code} className={`codeitem codeitem--${c.code[0]}`}>
                  <span className="codeitem__code">{c.code}</span>
                  <span className="codeitem__text">{c.text}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title={d === 'APPROVE' ? 'Rules satisfied' : 'Rules that decided this'}
            eyebrow={`${decisive.length} of ${evalResult.summary.total}`}
            flush
          >
            {decisive.map((r) => (
              <div key={r.code} className={`rulerow rulerow--${r.outcome}`}>
                <span className="rulerow__code">{r.code}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="rulerow__label">{r.label}</div>
                  <div className="rulerow__rationale">{r.rationale}</div>
                </div>
                <span className="rulerow__cmp">{r.detail}</span>
                <OutcomePill outcome={r.outcome} />
              </div>
            ))}
          </Card>

          {criticalFindings.length > 0 && (
            <Card title="Critical findings" eyebrow="Cross-document" flush>
              {criticalFindings.map((f) => (
                <div key={f.code} className="rulerow">
                  <span className="rulerow__code">{f.code}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="rulerow__label">{f.label}</div>
                    <div className="rulerow__rationale">
                      {String(f.comparison.left.value)} · {f.comparison.left.source} — vs —{' '}
                      {String(f.comparison.right.value)} · {f.comparison.right.source}
                    </div>
                  </div>
                  <FindingPill status={f.status} />
                </div>
              ))}
            </Card>
          )}
        </div>

        <aside className="stack">
          <Card title="Facility" eyebrow={application.id}>
            <table className="kv">
              <tbody>
                <tr>
                  <td>Decision</td>
                  <td>
                    <DecisionPill decision={d} />
                  </td>
                </tr>
                <tr>
                  <td>Borrower</td>
                  <td>{record.evidence.values.applicant?.name ?? application.borrower_name}</td>
                </tr>
                <tr>
                  <td>Asset</td>
                  <td>{record.evidence.values.invoice?.model}</td>
                </tr>
                <tr>
                  <td>On-road price</td>
                  <td>
                    <Money value={record.credit.inputs.invoice_on_road_price} />
                  </td>
                </tr>
                <tr>
                  <td>Requested</td>
                  <td>
                    <Money value={application.loan_amount} />
                  </td>
                </tr>
                <tr>
                  <td>Obligations</td>
                  <td>
                    <Money value={m.obligations} />
                  </td>
                </tr>
                <tr>
                  <td>Residual income</td>
                  <td>
                    <Money value={m.disposable_income} />
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title="Evidence summary" eyebrow="What this rests on">
            <table className="kv">
              <tbody>
                <tr>
                  <td>Documents</td>
                  <td className="num">{Object.keys(record.evidence.byDocument).length}</td>
                </tr>
                <tr>
                  <td>Fields extracted</td>
                  <td className="num">{Object.keys(record.evidence.fields).length}</td>
                </tr>
                <tr>
                  <td>Mean confidence</td>
                  <td className="num">{(record.evidence.stats.mean_confidence * 100).toFixed(1)}%</td>
                </tr>
                <tr>
                  <td>Officer interventions</td>
                  <td className="num" style={{ color: interventions.length ? 'var(--acc)' : undefined }}>
                    {interventions.length}
                  </td>
                </tr>
                <tr>
                  <td>Checks run</td>
                  <td className="num">{record.reconciliation.total}</td>
                </tr>
                <tr>
                  <td>Blocking findings</td>
                  <td className="num" style={{ color: record.reconciliation.blocking ? 'var(--red)' : undefined }}>
                    {record.reconciliation.blocking}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="divider" />
            <button
              type="button"
              className="btn btn--sm btn--block"
              onClick={() => navigate(`/app/${application.id}/evidence`)}
            >
              Inspect evidence
            </button>
          </Card>

          <Card title="Provenance" eyebrow="Audit anchors">
            <table className="kv">
              <tbody>
                <tr>
                  <td>Policy</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    v{evalResult.policy_version}
                  </td>
                </tr>
                <tr>
                  <td>Policy hash</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {evalResult.policy_hash}
                  </td>
                </tr>
                <tr>
                  <td>Engine</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {record.credit.engine_version}
                  </td>
                </tr>
                <tr>
                  <td>Input hash</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.credit.input_hash.slice(0, 14)}
                  </td>
                </tr>
                <tr>
                  <td>Trace</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.audit.traceId}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="divider" />
            <button
              type="button"
              className="btn btn--sm btn--block"
              onClick={() => navigate(`/app/${application.id}/audit`)}
            >
              <Icon name="audit" size={12} />
              Open audit trail
            </button>
          </Card>
        </aside>
      </div>

      <div style={{ marginTop: 16 }}>
        <AgentPanel appId={application.id} />
      </div>
    </div>
  );
}
