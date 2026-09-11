/**
 * Screen 3 — Document processing.
 *
 * A live view of the workflow. Each stage shows which actor performed it: a
 * language model reading documents, the deterministic engine computing, or a
 * human intervening. That distinction is the product's central claim, so the
 * execution view states it on every row rather than burying it in the audit log.
 */

import { useConsole, useState, navigate } from '@/hooks/index.js';
import { getProgress, getDocuments, startUnderwriting, STAGE_PLAN } from '@/services/api.js';
import { Card, Icon, PageHead, ActorTag, Empty, Money } from '@/components/ui.jsx';
import { DOC_LABELS } from '@/lib/vocab.js';

export default function Processing({ application, record }) {
  useConsole();
  const progress = getProgress(application.id);
  const documents = getDocuments(application.id);
  const [busy, setBusy] = useState(false);

  const started = application.status !== 'DRAFT';
  const done = Boolean(record?.decision);
  const held = record?.assist?.required;

  async function run() {
    setBusy(true);
    try {
      await startUnderwriting(application.id);
    } finally {
      setBusy(false);
    }
  }

  // The summary the ledger recorded for each stage, keyed by plan id.
  const summaries = {};
  (record?.audit?.events ?? []).forEach((e) => {
    const plan = STAGE_PLAN.find((p) => p.stage === e.stage);
    if (plan) summaries[plan.id] = e;
  });

  return (
    <div className="page">
      <PageHead
        eyebrow="Execution"
        title={started ? 'Underwriting workflow' : 'Ready to underwrite'}
        sub={
          started
            ? 'Stages execute in order. Extraction is performed by the document-understanding layer; every financial figure is produced by the deterministic engine that follows it.'
            : 'The bundle is attached and validated. Starting the workflow will extract evidence, reconcile it across documents, compute credit metrics and evaluate policy.'
        }
        actions={
          !started ? (
            <button type="button" className="btn btn--primary btn--lg" onClick={run} disabled={busy}>
              {busy ? 'Starting…' : 'Start underwriting'}
            </button>
          ) : done ? (
            <button type="button" className="btn btn--primary" onClick={() => navigate(`/app/${application.id}/decision`)}>
              View decision
              <Icon name="chevron" size={14} />
            </button>
          ) : held ? (
            <button type="button" className="btn btn--primary" onClick={() => navigate(`/app/${application.id}/assist`)}>
              Officer review required
              <Icon name="chevron" size={14} />
            </button>
          ) : null
        }
      />

      <div className="grid grid--sidebar">
        <Card
          title="Workflow"
          eyebrow={
            application.status === 'PROCESSING'
              ? 'Running'
              : held
                ? 'Suspended — awaiting officer'
                : done
                  ? 'Complete'
                  : 'Not started'
          }
          flush
        >
          <div className="flow">
            {STAGE_PLAN.map((stage) => {
              const status = progress[stage.id] ?? 'PENDING';
              const event = summaries[stage.id];
              return (
                <div key={stage.id} className={`stage stage--${status.toLowerCase()}`}>
                  <span className={`stage__node stage__node--${status === 'DONE' ? 'done' : status === 'RUNNING' ? 'running' : status === 'HELD' ? 'held' : 'idle'}`}>
                    {status === 'DONE' ? <Icon name="check" size={11} /> : status === 'HELD' ? '!' : ''}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="stage__name">{stage.label}</div>
                    {event && <div className="stage__summary">{event.summary}</div>}
                    {status === 'RUNNING' && <div className="stage__summary">Executing…</div>}
                    {status === 'HELD' && (
                      <div className="stage__summary" style={{ color: 'var(--amber)' }}>
                        Held — {record.assist.queue.length} field
                        {record.assist.queue.length === 1 ? '' : 's'} below the confidence floor
                      </div>
                    )}
                  </div>
                  <div className="stage__meta">
                    <ActorTag actor={stage.actor} />
                    {event?.durationMs != null && <span>{event.durationMs}ms</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <aside className="stack">
          <Card title="Facility" eyebrow={application.id}>
            <table className="kv">
              <tbody>
                <tr>
                  <td>Borrower</td>
                  <td>{application.borrower_name}</td>
                </tr>
                <tr>
                  <td>Asset</td>
                  <td>{application.segment}</td>
                </tr>
                <tr>
                  <td>Requested</td>
                  <td>
                    <Money value={application.loan_amount} />
                  </td>
                </tr>
                <tr>
                  <td>Tenure</td>
                  <td className="num">{application.tenure_months} months</td>
                </tr>
                <tr>
                  <td>Dealer</td>
                  <td>{application.dealer}</td>
                </tr>
                <tr>
                  <td>Branch</td>
                  <td>{application.branch}</td>
                </tr>
                <tr>
                  <td>Officer</td>
                  <td>{application.officer}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title="Bundle" eyebrow={`${documents.length} documents`} flush>
            {documents.length === 0 ? (
              <Empty title="No documents attached" />
            ) : (
              <div>
                {documents.map((d) => (
                  <div key={d.id} className="stage" style={{ padding: '10px 14px' }}>
                    <span className="dropzone__ico" style={{ width: 26, height: 26 }}>
                      <Icon name="doc" size={13} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}>{d.filename}</div>
                      <div className="dim mono" style={{ fontSize: 10.5 }}>
                        {DOC_LABELS[d.type]} · {d.pages}p · {d.size_kb} KB
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {application.scenario && (
            <Card title="Demo scenario" eyebrow="Synthetic file">
              <p className="sub" style={{ fontSize: 12.5 }}>
                {application.scenario}
              </p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
