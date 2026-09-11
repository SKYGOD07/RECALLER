/**
 * Screen 11 — Audit trail.
 *
 * The complete execution timeline, hash-chained. Each event carries the digest
 * of the one before it, so the screen can do more than list what happened: it
 * verifies that nothing was removed or altered after the fact, and says so.
 */

import { useState, useSticky } from '@/hooks/index.js';
import { Card, ActorTag, Icon, PageHead, CopyButton, formatClock } from '@/components/ui.jsx';
import { STAGE_LABELS } from '@/lib/vocab.js';

export default function AuditTrail({ application, record }) {
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useSticky('audit.filter', 'all');

  const ledger = record.audit;
  // Recomputed server-side on every read (GET /api/applications/:id, and on demand at .../audit/verify).
  const integrity = record.audit_verification ?? { ok: false, brokenAt: null, reason: 'not verified' };

  const events = ledger.events.filter((e) => {
    if (filter === 'engine') return e.actor === 'ENGINE';
    if (filter === 'llm') return e.actor === 'LLM';
    if (filter === 'officer') return e.actor === 'OFFICER';
    return true;
  });

  const totalMs = ledger.events.reduce((a, e) => a + (e.durationMs ?? 0), 0);

  function download() {
    const blob = new Blob([JSON.stringify(ledger, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${application.id}-audit-trail.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Immutable record"
        title="Audit trail"
        sub="Every state transition, in order, with the actor that performed it. Events are hash-chained: each carries the digest of its predecessor, so a removed or edited event breaks verification."
        actions={
          <>
            <div className="seg">
              {[
                ['all', `All ${ledger.events.length}`],
                ['llm', 'Model'],
                ['engine', 'Engine'],
                ['officer', 'Officer'],
              ].map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="btn" onClick={download}>
              <Icon name="download" size={14} />
              Export
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <Tile
          label="Chain integrity"
          value={integrity.ok ? 'VERIFIED' : 'BROKEN'}
          tone={integrity.ok ? 'good' : 'bad'}
          sub={integrity.ok ? `${ledger.events.length} events verified` : `broken at event ${integrity.brokenAt}`}
        />
        <Tile label="Events" value={ledger.events.length} sub={`${totalMs}ms total stage time`} />
        <Tile
          label="Model involvement"
          value={ledger.events.filter((e) => e.actor === 'LLM').length}
          sub="Extraction stages only"
        />
        <Tile
          label="Officer actions"
          value={ledger.events.filter((e) => e.actor === 'OFFICER').length}
          tone={ledger.events.some((e) => e.actor === 'OFFICER') ? 'acc' : 'neutral'}
          sub="Human interventions"
        />
      </div>

      <div className="grid grid--sidebar">
        <Card title="Execution timeline" eyebrow={ledger.traceId} flush>
          <div className="timeline">
            {events.map((e) => {
              const open = expanded === e.seq;
              const hasDetail = e.detail && Object.keys(e.detail).length > 0;
              return (
                <div key={e.seq} className="tl">
                  <div className="tl__time">{formatClock(e.at)}</div>
                  <div className="tl__gut">
                    <span className={`tl__dot tl__dot--${e.actor}`} />
                  </div>
                  <div className="tl__body">
                    <div className="tl__stage">
                      <span className="mono dim" style={{ fontSize: 10.5 }}>
                        {String(e.seq).padStart(2, '0')}
                      </span>
                      {STAGE_LABELS[e.stage] ?? e.stage}
                      <ActorTag actor={e.actor} />
                      {e.durationMs != null && (
                        <span className="mono dim" style={{ fontSize: 10.5 }}>
                          {e.durationMs}ms
                        </span>
                      )}
                    </div>
                    <div className="tl__summary">{e.summary}</div>
                    {hasDetail && (
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        style={{ marginTop: 7 }}
                        onClick={() => setExpanded(open ? null : e.seq)}
                      >
                        {open ? 'Hide' : 'Show'} input / output
                      </button>
                    )}
                    {open && <pre className="tl__detail fade-in">{JSON.stringify(e.detail, null, 2)}</pre>}
                    <div className="tl__digest">
                      digest {e.digest.slice(0, 16)} · prev {e.prev.slice(0, 12)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <aside className="stack">
          <Card title="Trace anchors" eyebrow="Where this came from">
            <table className="kv">
              <tbody>
                <tr>
                  <td>Trace ID</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {ledger.traceId}
                  </td>
                </tr>
                <tr>
                  <td>Ledger head</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {ledger.head.slice(0, 16)}
                  </td>
                </tr>
                <tr>
                  <td>n8n execution</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.execution?.n8n_execution_id ?? 'local (not orchestrated)'}
                  </td>
                </tr>
                <tr>
                  <td>Workflow version</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.execution?.workflow_version ?? '—'}
                  </td>
                </tr>
                <tr>
                  <td>Engine version</td>
                  <td className="mono">{record.engine_version}</td>
                </tr>
                <tr>
                  <td>Policy version</td>
                  <td className="mono">v{record.policy_version}</td>
                </tr>
                <tr>
                  <td>Policy hash</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.policy_hash}
                  </td>
                </tr>
                <tr>
                  <td>Evidence hash</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.evidence.extraction_hash.slice(0, 14)}
                  </td>
                </tr>
                {record.credit && (
                  <tr>
                    <td>Calculation hash</td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      {record.credit.input_hash.slice(0, 14)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="divider" />
            <CopyButton text={ledger.traceId} label="Copy trace ID" />
          </Card>

          <Card title="Actor legend" eyebrow="Who did what">
            <div className="stack stack--sm" style={{ fontSize: 12.5 }}>
              <div className="row row--tight">
                <ActorTag actor="LLM" />
                <span className="sub">Read documents. Never computed a figure.</span>
              </div>
              <div className="row row--tight">
                <ActorTag actor="ENGINE" />
                <span className="sub">Computed every financial metric and applied policy.</span>
              </div>
              <div className="row row--tight">
                <ActorTag actor="OFFICER" />
                <span className="sub">Human intervention on held evidence.</span>
              </div>
              <div className="row row--tight">
                <ActorTag actor="SYSTEM" />
                <span className="sub">Ingestion, suspension and lifecycle events.</span>
              </div>
              <div className="row row--tight">
                <ActorTag actor="N8N" />
                <span className="sub">Workflow orchestration (Phase 4).</span>
              </div>
            </div>
          </Card>

          <Card title="Verification" eyebrow="Chain check">
            <p className="sub" style={{ fontSize: 12.5 }}>
              {integrity.ok
                ? `All ${ledger.events.length} events recompute to their recorded digests and link correctly to their predecessors. The trail has not been altered since it was written.`
                : `Verification failed at event ${integrity.brokenAt}: ${integrity.reason}.`}
            </p>
            <div style={{ marginTop: 11 }}>
              <span className={`pill pill--${integrity.ok ? 'good' : 'bad'}`}>
                <Icon name={integrity.ok ? 'check' : 'assist'} size={10} />
                {integrity.ok ? 'Chain verified' : 'Chain broken'}
              </span>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone = 'neutral' }) {
  const colour =
    tone === 'good' ? 'var(--emerald)' : tone === 'warn' ? 'var(--amber)' : tone === 'bad' ? 'var(--red)' : tone === 'acc' ? 'var(--acc)' : 'var(--text)';
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
