/**
 * Screen 8 — Policy.
 *
 * The active rulebook, and how this file fared against each rule. The frontend
 * evaluates nothing: every outcome shown here was decided by the policy engine
 * and arrived with the record. When opened without an application (from the
 * console rail) the same screen doubles as the policy book.
 */

import { useSticky } from '@/hooks/index.js';
import { Card, OutcomePill, PageHead, Icon, CopyButton } from '@/components/ui.jsx';
import { POLICY } from '@/services/api.js';
import { formatINR, formatPct } from '@core/money.js';
import { shortHash } from '@core/hash.js';

export default function PolicyView({ record, application, standalone = false }) {
  const [filter, setFilter] = useSticky('policy.filter', 'all');
  const evalResult = record?.policyEvaluation ?? null;

  const rows = (evalResult?.rules ?? POLICY.rules.map(asShell)).filter((r) => {
    if (filter === 'binding') return r.severity === 'BLOCKING';
    if (filter === 'issues') return r.outcome === 'FAIL' || r.outcome === 'REFER';
    return true;
  });

  return (
    <div className="page">
      <PageHead
        eyebrow={standalone ? 'Policy book' : 'Applied policy'}
        title={POLICY.description}
        sub={
          standalone
            ? 'The governing rulebook. Thresholds live here and nowhere else — no threshold is hard-coded in the engine, the workflow or the interface.'
            : `This file was judged against ${POLICY.policy_id} v${POLICY.version}, effective ${POLICY.effective_date}. Changing a threshold changes the outcome; the replay screen lets you prove that on frozen evidence.`
        }
        actions={
          <div className="seg">
            {[
              ['all', 'All rules'],
              ['binding', 'Binding only'],
              ...(evalResult ? [['issues', 'Issues']] : []),
            ].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <Tile label="Policy" value={`v${POLICY.version}`} sub={POLICY.policy_id} />
        <Tile label="Effective" value={POLICY.effective_date} sub={`review ${POLICY.review_date}`} />
        <Tile label="Rules" value={POLICY.rules.length} sub={`${POLICY.rules.filter((r) => r.severity === 'BLOCKING').length} binding`} />
        <Tile
          label={evalResult ? 'Outcome' : 'Policy hash'}
          value={evalResult ? `${evalResult.summary.passed}/${evalResult.summary.total}` : shortHash(POLICY)}
          sub={
            evalResult
              ? `${evalResult.summary.failed} failed · ${evalResult.summary.referred} referred · ${evalResult.summary.not_applicable} n/a`
              : 'fingerprint of the rulebook'
          }
          tone={evalResult ? (evalResult.summary.failed ? 'bad' : evalResult.summary.referred ? 'warn' : 'good') : 'neutral'}
        />
      </div>

      <div className="grid grid--sidebar">
        <Card title="Rules" eyebrow={evalResult ? 'Evaluated against this file' : 'Active rulebook'} flush>
          {rows.map((r) => (
            <div key={r.code} className={`rulerow${r.outcome ? ` rulerow--${r.outcome}` : ''}`}>
              <span className="rulerow__code">{r.code}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="rulerow__label">
                  {r.label}
                  {r.severity === 'ADVISORY' && (
                    <span className="dim mono" style={{ fontSize: 10, marginLeft: 8 }}>
                      advisory
                    </span>
                  )}
                </div>
                <div className="rulerow__rationale">{r.rationale}</div>
              </div>
              <span className="rulerow__cmp">{r.detail ?? describeThreshold(r)}</span>
              {r.outcome && <OutcomePill outcome={r.outcome} />}
            </div>
          ))}
        </Card>

        <aside className="stack">
          <Card title="Product bands" eyebrow="By asset segment" flush>
            {Object.entries(POLICY.segments).map(([key, s]) => {
              const active = application?.segment === key;
              return (
                <div key={key} className="rulerow" style={active ? { background: 'rgba(198,255,77,0.05)' } : undefined}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="rulerow__label">
                      {s.label}
                      {active && (
                        <span className="pill pill--acc" style={{ marginLeft: 8 }}>
                          This file
                        </span>
                      )}
                    </div>
                    <div className="rulerow__rationale">
                      {formatINR(s.min_ticket)} – {formatINR(s.max_ticket)} · {s.tenure_months.min}–{s.tenure_months.max} months
                    </div>
                  </div>
                  <span className="rulerow__cmp">{s.rate_annual_pct}%</span>
                </div>
              );
            })}
          </Card>

          <Card title="Income recognition" eyebrow="How income is admitted">
            <table className="kv">
              <tbody>
                <tr>
                  <td>Method</td>
                  <td style={{ fontSize: 11.5 }}>{POLICY.income_recognition.method.replace(/_/g, ' ').toLowerCase()}</td>
                </tr>
                <tr>
                  <td>Observation window</td>
                  <td className="num">{POLICY.income_recognition.observation_window_months} months</td>
                </tr>
                <tr>
                  <td>Platform haircut</td>
                  <td className="num">{formatPct(POLICY.income_recognition.platform_earnings_haircut, 0)}</td>
                </tr>
                <tr>
                  <td>Cash haircut</td>
                  <td className="num">{formatPct(POLICY.income_recognition.cash_deposit_haircut, 0)}</td>
                </tr>
                <tr>
                  <td>Max cash share</td>
                  <td className="num">{formatPct(POLICY.income_recognition.max_cash_share_of_income, 0)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title="Reconciliation tolerances" eyebrow="Grading bands">
            <table className="kv">
              <tbody>
                {Object.entries(POLICY.reconciliation).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ fontSize: 11.5 }}>{k.replace(/_/g, ' ')}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {v.advisory_pct !== undefined
                        ? `${formatPct(v.advisory_pct, 0)} / ${formatPct(v.blocking_pct, 0)}`
                        : `${formatPct(v.advisory_score, 0)} / ${formatPct(v.blocking_score, 0)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Confidence floors" eyebrow="Gate thresholds">
            <table className="kv">
              <tbody>
                <tr>
                  <td>Standard field</td>
                  <td className="num">{formatPct(POLICY.confidence.field_threshold, 0)}</td>
                </tr>
                <tr>
                  <td>Critical field</td>
                  <td className="num">{formatPct(POLICY.confidence.critical_field_threshold, 0)}</td>
                </tr>
                <tr>
                  <td>Critical fields</td>
                  <td className="num">{POLICY.confidence.critical_fields.length}</td>
                </tr>
              </tbody>
            </table>
            <div className="divider" />
            <ul className="stack stack--sm">
              {POLICY.confidence.critical_fields.map((f) => (
                <li key={f} className="mono dim" style={{ fontSize: 11 }}>
                  {f}
                </li>
              ))}
            </ul>
          </Card>

          {evalResult && (
            <Card title="Provenance" eyebrow="This evaluation">
              <table className="kv">
                <tbody>
                  <tr>
                    <td>Policy hash</td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      {evalResult.policy_hash}
                    </td>
                  </tr>
                  <tr>
                    <td>Evaluated hash</td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      {evalResult.evaluated_hash.slice(0, 16)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: 10 }}>
                <CopyButton text={JSON.stringify(evalResult.rules, null, 2)} label="Copy evaluation JSON" />
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function asShell(r) {
  return { ...r, outcome: null, detail: null };
}

function describeThreshold(r) {
  if (r.operator === 'lte') return `≤ ${fmtThreshold(r.metric, r.threshold)}`;
  if (r.operator === 'gte') return `≥ ${fmtThreshold(r.metric, r.threshold)}`;
  if (r.operator === 'within_segment_ticket') return 'within product band';
  if (r.operator === 'within_segment_tenure') return 'within tenure band';
  return '—';
}

function fmtThreshold(metric, value) {
  if (metric === 'foir' || metric === 'ltv' || metric === 'income_volatility') return formatPct(value, 0);
  if (metric === 'verified_monthly_income' || metric === 'average_monthly_balance') return formatINR(value);
  return String(value);
}

function Tile({ label, value, sub, tone = 'neutral' }) {
  const colour =
    tone === 'good' ? 'var(--emerald)' : tone === 'warn' ? 'var(--amber)' : tone === 'bad' ? 'var(--red)' : 'var(--text)';
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__value" style={{ color: colour, fontSize: 20 }}>
        {value}
      </div>
      <div className="metric__sub">{sub}</div>
    </div>
  );
}
