/**
 * Screen 6 — Assist / officer review.
 *
 * When extraction confidence falls below the policy floor, the system does not
 * guess and does not retry with a second model. It stops, freezes a checkpoint,
 * and asks. This screen is that question.
 *
 * Resuming continues from the frozen checkpoint — the documents are not read
 * again and no model is re-invoked. Only the stages after the confidence gate
 * re-run, with the officer's answers folded into the evidence.
 */

import { useConsole, useState, navigate } from '@/hooks/index.js';
import { resumeUnderwriting, POLICY } from '@/services/api.js';
import { Card, Confidence, Icon, PageHead, Empty, Money } from '@/components/ui.jsx';
import { formatINR } from '@/lib/format.js';

export default function Assist({ application, record }) {
  useConsole();
  const queue = record.assist?.queue ?? [];
  const required = record.assist?.required;

  const [answers, setAnswers] = useState(() => Object.fromEntries(queue.map((h) => [h.path, blankAnswer(h)])));
  const [busy, setBusy] = useState(false);

  if (!required) {
    return (
      <div className="page">
        <PageHead eyebrow="Human in the loop" title="Officer review" />
        <Card>
          <Empty title="No review outstanding">
            {record.resolutions?.length
              ? `${record.resolutions.length} field${record.resolutions.length === 1 ? ' was' : 's were'} verified by an officer before this file was decisioned. The interventions are recorded in the evidence, the memo and the audit trail.`
              : 'Every field in this bundle cleared the confidence floor on the first pass, so the workflow ran end to end without stopping.'}
          </Empty>
          {record.resolutions?.length > 0 && (
            <div className="stack stack--sm" style={{ marginTop: 4 }}>
              {record.resolutions.map((r) => (
                <div key={r.path} className="cmpbox">
                  <div className="cmpbox__field">
                    {r.action} · {r.path}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    {record.evidence.fields[r.path]?.superseded?.value !== undefined && (
                      <>
                        was <b>{String(record.evidence.fields[r.path].superseded.value)}</b> →{' '}
                      </>
                    )}
                    <b>{String(record.evidence.fields[r.path]?.value ?? '—')}</b>
                  </div>
                  <div className="cmpbox__src">
                    {r.by} · {r.note ?? 'no note'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  }

  const answered = queue.filter((h) => answers[h.path]?.action).length;
  const canResume = answered === queue.length;

  async function resume() {
    setBusy(true);
    const resolutions = queue.map((h) => {
      const a = answers[h.path];
      return {
        path: h.path,
        action: a.action,
        value: a.action === 'EDIT' ? a.value : undefined,
        by: application.officer,
        note: a.note || defaultNote(a.action),
      };
    });
    try {
      await resumeUnderwriting(application.id, resolutions);
      navigate(`/app/${application.id}/decision`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Human in the loop"
        title="Officer verification required"
        sub={`${queue.length} field${queue.length === 1 ? '' : 's'} were extracted below the confidence floor. The execution is suspended at the confidence gate — it has not guessed, and it will not proceed until you answer.`}
        actions={
          <button type="button" className="btn btn--primary btn--lg" disabled={!canResume || busy} onClick={resume}>
            {busy ? 'Resuming…' : `Resume underwriting${canResume ? '' : ` (${answered}/${queue.length})`}`}
            <Icon name="chevron" size={14} />
          </button>
        }
      />

      <div className="grid grid--sidebar">
        <div className="assist">
          <header className="assist__head">
            <Icon name="assist" size={15} style={{ color: 'var(--amber)' }} />
            <div style={{ minWidth: 0 }}>
              <div className="h2">Fields requiring verification</div>
              <div className="sub" style={{ fontSize: 12 }}>
                Standard floor {pct(POLICY.confidence.field_threshold)} · critical floor{' '}
                {pct(POLICY.confidence.critical_field_threshold)}
              </div>
            </div>
            <span className="pill pill--warn" style={{ marginLeft: 'auto' }}>
              {answered}/{queue.length} answered
            </span>
          </header>

          {queue.map((held) => (
            <AssistItem
              key={held.path}
              held={held}
              answer={answers[held.path]}
              onChange={(next) => setAnswers((a) => ({ ...a, [held.path]: next }))}
            />
          ))}
        </div>

        <aside className="stack">
          <Card title="What happens on resume" eyebrow="Execution">
            <ol className="stack stack--sm" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              <Step n="1">The frozen checkpoint is rehydrated — extraction does not run again and no model is re-invoked.</Step>
              <Step n="2">Your answers replace the held values and are stamped as officer-provenance evidence.</Step>
              <Step n="3">Reconciliation re-runs, because a corrected name or amount can change a finding.</Step>
              <Step n="4">Credit metrics, policy and the decision are computed from the corrected evidence.</Step>
              <Step n="5">Every intervention is written to the audit trail and named in the credit memo.</Step>
            </ol>
          </Card>

          <Card title="Checkpoint" eyebrow="Frozen state">
            <table className="kv">
              <tbody>
                <tr>
                  <td>Stages completed</td>
                  <td className="num">{record.checkpoint?.completed_stages.length ?? 0}</td>
                </tr>
                <tr>
                  <td>Fields held</td>
                  <td className="num">{queue.length}</td>
                </tr>
                <tr>
                  <td>Checkpoint hash</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.checkpoint?.hash.slice(0, 16)}
                  </td>
                </tr>
                <tr>
                  <td>Audit events so far</td>
                  <td className="num">{record.audit.events.length}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function AssistItem({ held, answer, onChange }) {
  const resolved = Boolean(answer?.action);

  return (
    <div className={`assist__item${resolved ? ' assist__item--resolved' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Field requires verification</div>
          <div className="h2" style={{ marginTop: 3 }}>
            {held.label}
          </div>
          <div className="dim mono" style={{ fontSize: 10.5 }}>
            {held.path}
          </div>
        </div>
        {held.critical && <span className="pill pill--bad">Critical field</span>}
      </div>

      <div className="assist__grid">
        <Box label="Extracted value">
          <span style={{ fontSize: 15, fontWeight: 550 }}>
            {held.type === 'money' ? formatINR(held.value) : String(held.value ?? '—')}
          </span>
        </Box>
        <Box label="Confidence">
          <Confidence value={held.confidence} floor={held.floor} />
          <div className="dim mono" style={{ fontSize: 10.5, marginTop: 3 }}>
            floor {pct(held.floor)}
          </div>
        </Box>
        <Box label="Source">
          <span className="mono" style={{ fontSize: 12.5 }}>
            {held.citation?.document}
          </span>
          <div className="dim mono" style={{ fontSize: 10.5, marginTop: 3 }}>
            page {held.citation?.page}
          </div>
        </Box>
        <Box label="Reason held">
          <span style={{ fontSize: 12.5 }}>{held.reason}</span>
        </Box>
      </div>

      {answer?.action === 'EDIT' && (
        <div style={{ margin: '0 0 11px' }}>
          <label className="field">
            <span className="field__label">Corrected value</span>
            <input
              className={`input${held.type === 'money' || held.type === 'number' ? ' input--mono' : ''}`}
              value={answer.value}
              autoFocus
              onChange={(e) => onChange({ ...answer, value: e.target.value })}
              placeholder="Type the value as it appears on the original document"
            />
          </label>
        </div>
      )}

      {resolved && (
        <div style={{ margin: '0 0 11px' }}>
          <label className="field">
            <span className="field__label">Note for the audit trail</span>
            <input
              className="input"
              value={answer.note}
              onChange={(e) => onChange({ ...answer, note: e.target.value })}
              placeholder={defaultNote(answer.action)}
            />
          </label>
        </div>
      )}

      <div className="assist__actions">
        <button
          type="button"
          className={`btn btn--sm ${answer?.action === 'CONFIRM' ? 'btn--good' : ''}`}
          onClick={() => onChange({ action: 'CONFIRM', value: held.value, note: answer?.note ?? '' })}
        >
          <Icon name="check" size={12} />
          Confirm as read
        </button>
        <button
          type="button"
          className={`btn btn--sm ${answer?.action === 'EDIT' ? 'btn--primary' : ''}`}
          onClick={() => onChange({ action: 'EDIT', value: String(held.value ?? ''), note: answer?.note ?? '' })}
        >
          Edit value
        </button>
        <button
          type="button"
          className={`btn btn--sm ${answer?.action === 'REJECT' ? 'btn--danger' : ''}`}
          onClick={() => onChange({ action: 'REJECT', value: null, note: answer?.note ?? '' })}
        >
          Reject value
        </button>
        {resolved && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange(blankAnswer(held))}>
            Clear
          </button>
        )}
        <span className="spacer" />
        {resolved && (
          <span className="pill pill--good">
            <Icon name="check" size={10} />
            {answer.action}
          </span>
        )}
      </div>
    </div>
  );
}

function Box({ label, children }) {
  return (
    <div className="cmpbox">
      <div className="cmpbox__field">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Step({ n, children }) {
  return (
    <li className="row row--tight" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <span className="stage__node" style={{ width: 18, height: 18, fontSize: 9 }}>
        {n}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </li>
  );
}

function blankAnswer(held) {
  return { action: null, value: String(held.value ?? ''), note: '' };
}

function defaultNote(action) {
  if (action === 'CONFIRM') return 'Verified against the original document at the counter';
  if (action === 'EDIT') return 'Corrected from the original document';
  return 'Value not legible on the original; rejected';
}

function pct(v) {
  return `${Math.round(v * 100)}%`;
}
