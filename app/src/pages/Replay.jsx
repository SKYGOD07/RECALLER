/**
 * Screen 12 — Replay.
 *
 * Re-executes a decided file from frozen material: frozen evidence, frozen
 * officer answers, frozen calculation inputs. The extraction adapter is never
 * called and no model is re-invoked — that is the point. If the replay produces
 * a different number, the system is not deterministic and the audit trail is
 * worth nothing.
 *
 * The second mode changes one thing on purpose: the policy. Same evidence, a
 * different rulebook, so a committee can see exactly what moving a cut-off
 * would have done to a file that was already decided.
 */

import { useConsole, useState } from '@/hooks/index.js';
import { replayApplication, getReplays, amendPolicy, POLICY } from '@/services/api.js';
import { Card, DecisionPill, Icon, PageHead, Empty, formatClock } from '@/components/ui.jsx';
import { formatINR, formatPct } from '@core/money.js';

const TUNABLE = ['P-FOIR-01', 'P-LTV-01', 'P-INC-01', 'P-INC-02', 'P-INC-03', 'P-BAL-01', 'P-BNC-01'];

export default function Replay({ application, record }) {
  useConsole();
  const replays = getReplays(application.id);
  const [busy, setBusy] = useState(false);
  const [overrides, setOverrides] = useState({});

  const amended = Object.keys(overrides).length > 0;

  async function runOriginal() {
    setBusy(true);
    try {
      await replayApplication(application.id, { policy: POLICY, label: 'Replay with original policy' });
    } finally {
      setBusy(false);
    }
  }

  async function runAmended() {
    setBusy(true);
    try {
      const policy = amendPolicy(overrides);
      const changed = Object.entries(overrides)
        .map(([code, v]) => `${code}→${v}`)
        .join(', ');
      await replayApplication(application.id, { policy, label: `Replay with amended policy (${changed})` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Reproducibility"
        title="Replay"
        sub="Re-run this decision against its own frozen evidence. No document is re-read and no model is re-invoked — a replay that diverges would mean the decision was never reproducible."
        actions={
          <button type="button" className="btn btn--primary" onClick={runOriginal} disabled={busy}>
            <Icon name="replay" size={14} />
            {busy ? 'Replaying…' : 'Replay with original policy'}
          </button>
        }
      />

      <div className="grid grid--sidebar">
        <div className="stack">
          <Card title="Replay history" eyebrow={`${replays.length} runs this session`} flush>
            {replays.length === 0 ? (
              <Empty title="No replay run yet">
                Run a replay to prove that the frozen evidence still produces the recorded decision.
              </Empty>
            ) : (
              replays.map((r, i) => <ReplayRow key={`${r.ran_at}-${i}`} replay={r} record={record} />)
            )}
          </Card>

          <Card
            title="Replay with amended policy"
            eyebrow="Same evidence, different rulebook"
            note="The original decision is never overwritten. An amended replay is a what-would-have-happened exercise recorded alongside it."
          >
            <p className="sub" style={{ marginBottom: 14 }}>
              Move a cut-off and re-judge this file on the evidence it was originally decided on. This is how a credit
              committee tests a policy change against the back book before adopting it.
            </p>
            <div className="grid grid--2">
              {TUNABLE.map((code) => {
                const rule = POLICY.rules.find((r) => r.code === code);
                const value = overrides[code] ?? rule.threshold;
                const isRatio = ['foir', 'ltv', 'income_volatility'].includes(rule.metric);
                return (
                  <div key={code} className="field">
                    <span className="field__label">
                      {rule.label}
                      <span className="dim"> · {code}</span>
                    </span>
                    <div className="row row--tight" style={{ flexWrap: 'nowrap' }}>
                      <input
                        className="input input--mono"
                        style={{ width: 110 }}
                        value={value}
                        onChange={(e) => setOverrides((o) => ({ ...o, [code]: e.target.value }))}
                      />
                      <span className="dim mono" style={{ fontSize: 11 }}>
                        was {isRatio ? formatPct(rule.threshold, 0) : rule.threshold}
                      </span>
                      {overrides[code] !== undefined && (
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() =>
                            setOverrides((o) => {
                              const next = { ...o };
                              delete next[code];
                              return next;
                            })
                          }
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="divider" />
            <button type="button" className="btn btn--primary" onClick={runAmended} disabled={!amended || busy}>
              <Icon name="replay" size={14} />
              Replay with amended policy
              {amended ? ` (${Object.keys(overrides).length} changed)` : ''}
            </button>
          </Card>
        </div>

        <aside className="stack">
          <Card title="Frozen material" eyebrow="What a replay uses">
            <table className="kv">
              <tbody>
                <tr>
                  <td>Evidence fields</td>
                  <td className="num">{Object.keys(record.evidence.fields).length}</td>
                </tr>
                <tr>
                  <td>Officer answers</td>
                  <td className="num">{record.resolutions?.length ?? 0}</td>
                </tr>
                <tr>
                  <td>Evidence hash</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.evidence.extraction_hash.slice(0, 14)}
                  </td>
                </tr>
                <tr>
                  <td>Calculation hash</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.credit.input_hash.slice(0, 14)}
                  </td>
                </tr>
                <tr>
                  <td>Original policy</td>
                  <td className="mono">v{record.policy_version}</td>
                </tr>
                <tr>
                  <td>Original decision</td>
                  <td>
                    <DecisionPill decision={record.decision.decision} />
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="divider" />
            <p className="sub" style={{ fontSize: 12 }}>
              The extraction adapter is not in the replay path at all. A replay reads the stored evidence directly, so a
              model that has since changed its weights cannot change a historical decision.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ReplayRow({ replay: r, record }) {
  const [open, setOpen] = useState(false);
  const changedDecision = r.diff.decision;

  return (
    <div className="finding" style={{ gridTemplateColumns: '1fr auto' }}>
      <div className="finding__top">
        <span className={`pill pill--${r.identical ? 'good' : changedDecision ? 'warn' : 'info'}`}>
          <Icon name={r.identical ? 'check' : 'replay'} size={10} />
          {r.identical ? 'Reproduced exactly' : changedDecision ? 'Decision changed' : 'Metrics changed'}
        </span>
        <span className="finding__label">{r.label}</span>
        <span className="dim mono" style={{ fontSize: 10.5 }}>
          policy v{r.policy_version} · {formatClock(r.ran_at)}
        </span>
      </div>

      <div className="finding__delta">
        <div className="row row--tight" style={{ justifyContent: 'flex-end' }}>
          <DecisionPill decision={record.decision.decision} />
          <Icon name="chevron" size={12} className="dim" />
          <DecisionPill decision={r.decision.decision} />
        </div>
        <div className="dim" style={{ marginTop: 4 }}>
          {r.used_llm ? 'model re-invoked' : 'no model invoked'}
        </div>
      </div>

      <div className="finding__cmp" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <Cmp label="EMI" from={record.credit.metrics.emi} to={r.credit.metrics.emi} money />
        <Cmp label="FOIR" from={record.credit.metrics.foir} to={r.credit.metrics.foir} pct />
        <Cmp label="LTV" from={record.credit.metrics.ltv} to={r.credit.metrics.ltv} pct />
        <Cmp
          label="Rules passed"
          from={record.policyEvaluation.summary.passed}
          to={r.policyEvaluation.summary.passed}
        />
      </div>

      {(r.diff.reason_codes.added.length > 0 || r.diff.reason_codes.removed.length > 0) && (
        <div className="finding__note">
          {r.diff.reason_codes.added.length > 0 && (
            <>
              <span style={{ color: 'var(--amber)' }}>added</span> {r.diff.reason_codes.added.join(', ')}{' '}
            </>
          )}
          {r.diff.reason_codes.removed.length > 0 && (
            <>
              <span style={{ color: 'var(--text-3)' }}>removed</span> {r.diff.reason_codes.removed.join(', ')}
            </>
          )}
        </div>
      )}

      <div className="finding__note">
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'} reason codes
        </button>
        {open && (
          <div className="codelist fade-in" style={{ marginTop: 10 }}>
            {r.decision.reason_codes.map((c) => (
              <div key={c.code} className={`codeitem codeitem--${c.code[0]}`}>
                <span className="codeitem__code">{c.code}</span>
                <span className="codeitem__text">{c.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Cmp({ label, from, to, money, pct }) {
  const same = from === to;
  const fmt = (v) => (v === null || v === undefined ? '—' : money ? formatINR(v) : pct ? formatPct(v) : String(v));
  return (
    <div className="cmpbox">
      <div className="cmpbox__field">{label}</div>
      <div className="cmpbox__value" style={{ fontSize: 13 }}>
        {same ? (
          fmt(to)
        ) : (
          <>
            <span className="dim" style={{ textDecoration: 'line-through' }}>
              {fmt(from)}
            </span>{' '}
            <span style={{ color: 'var(--amber)' }}>{fmt(to)}</span>
          </>
        )}
      </div>
      <div className="cmpbox__src">{same ? 'unchanged' : 'changed'}</div>
    </div>
  );
}
