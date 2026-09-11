/**
 * Screen 10 — Credit memo.
 *
 * The document a credit officer or an auditor reads. It is assembled by the
 * narration package from the finished record, so every figure in the prose is
 * the same figure the engine computed — the narrator interpolates, it does not
 * calculate.
 */

import { Card, DecisionPill, FindingPill, Icon, PageHead, CopyButton, Confidence, formatClock } from '@/components/ui.jsx';

export default function CreditMemo({ application, record }) {
  const memo = record.memo;

  function download() {
    const blob = new Blob([JSON.stringify(memo, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${application.id}-credit-memo.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Deliverable"
        title="Credit memorandum"
        sub="Generated from the completed record. Readable by a credit officer or an auditor without access to this console."
        actions={
          <>
            <button type="button" className="btn" onClick={download}>
              <Icon name="download" size={14} />
              Export JSON
            </button>
            <button type="button" className="btn btn--primary" onClick={() => window.print()}>
              <Icon name="print" size={14} />
              Print
            </button>
          </>
        }
      />

      <article className="memo">
        <header className="memo__head">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow">Credit memorandum</div>
              <h2 className="memo__title" style={{ marginTop: 5 }}>
                {record.evidence.values.applicant?.name ?? application.borrower_name}
              </h2>
              <div className="sub mono" style={{ fontSize: 12, marginTop: 4 }}>
                {application.id} · generated {formatClock(memo.generated_at)}
              </div>
            </div>
            <DecisionPill decision={memo.decision} />
          </div>
        </header>

        {memo.sections.map((s) => (
          <section key={s.id} className="memo__section">
            <h3 className="memo__h">{s.title}</h3>
            <SectionBody section={s} record={record} />
            {s.note && (
              <p className="sub" style={{ fontSize: 11.5, marginTop: 11, color: 'var(--text-3)' }}>
                {s.note}
              </p>
            )}
          </section>
        ))}
      </article>

      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <CopyButton text={record.audit.traceId} label={`Trace ${record.audit.traceId}`} />
      </div>
    </div>
  );
}

function SectionBody({ section: s, record }) {
  switch (s.kind) {
    case 'verdict':
      return (
        <div className={`verdict verdict--${record.decision.decision}`} style={{ padding: 16 }}>
          <span className="verdict__word" style={{ fontSize: 22 }}>
            {record.decision.decision}
          </span>
          <div className="verdict__body">
            <p className="memo__p" style={{ color: 'var(--text)' }}>
              {s.body}
            </p>
          </div>
        </div>
      );

    case 'prose':
      return <p className="memo__p">{s.body}</p>;

    case 'table':
    case 'metrics':
      return (
        <div className="grid grid--2">
          <table className="kv">
            <tbody>
              {s.rows.slice(0, Math.ceil(s.rows.length / 2)).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className={typeof v === 'string' && v.startsWith('₹') ? 'num' : ''}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="kv">
            <tbody>
              {s.rows.slice(Math.ceil(s.rows.length / 2)).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className={typeof v === 'string' && v.startsWith('₹') ? 'num' : ''}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'findings':
      return (
        <>
          <p className="memo__p" style={{ marginBottom: 12 }}>
            {s.body}
          </p>
          <div className="stack stack--sm">
            {s.items.map((it) => (
              <div key={it.code} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 11 }}>
                <FindingPill status={it.status} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    <span className="mono dim" style={{ fontSize: 10.5, marginRight: 7 }}>
                      {it.code}
                    </span>
                    {it.label}
                  </div>
                  <div className="sub" style={{ fontSize: 12 }}>
                    {it.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      );

    case 'policy':
      return (
        <>
          <p className="memo__p" style={{ marginBottom: 12 }}>
            {s.body}
          </p>
          <div className="tablewrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Test</th>
                  <th>Measured</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((it) => (
                  <tr key={it.code}>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {it.code}
                    </td>
                    <td>{it.label}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {it.detail}
                    </td>
                    <td>
                      <span
                        className={`pill pill--${it.outcome === 'PASS' ? 'good' : it.outcome === 'REFER' ? 'warn' : 'bad'}`}
                      >
                        {it.outcome}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );

    case 'codes':
      return (
        <div className="codelist">
          {s.items.map((c) => (
            <div key={c.code} className={`codeitem codeitem--${c.code[0]}`}>
              <span className="codeitem__code">{c.code}</span>
              <span className="codeitem__text">{c.text}</span>
            </div>
          ))}
        </div>
      );

    case 'interventions':
      return (
        <>
          <p className="memo__p" style={{ marginBottom: s.items.length ? 12 : 0 }}>
            {s.body}
          </p>
          {s.items.length > 0 && (
            <div className="tablewrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Action</th>
                    <th>Extracted</th>
                    <th>Confirmed</th>
                    <th>Confidence</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {s.items.map((it) => (
                    <tr key={it.path} className="row--officer">
                      <td>
                        <div>{it.label}</div>
                        <div className="mono dim" style={{ fontSize: 10.5 }}>
                          {it.path}
                        </div>
                      </td>
                      <td>
                        <span className="pill pill--acc">{it.action}</span>
                      </td>
                      <td className="dim">{String(it.from ?? '—')}</td>
                      <td className="t-strong">{String(it.to ?? '—')}</td>
                      <td>
                        <Confidence value={it.original_confidence} floor={1} />
                      </td>
                      <td>
                        <div>{it.by}</div>
                        <div className="dim" style={{ fontSize: 11 }}>
                          {it.note}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      );

    case 'citations':
      return (
        <div className="tablewrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
                <th>Confidence</th>
                <th>Document</th>
                <th>Page</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((it, i) => (
                <tr key={`${it.label}-${i}`}>
                  <td>{it.label}</td>
                  <td>{it.value}</td>
                  <td>
                    {it.provenance === 'OFFICER' ? (
                      <span className="pill pill--acc">Officer</span>
                    ) : it.provenance === 'DECLARED' ? (
                      <span className="pill pill--neutral">Declared</span>
                    ) : (
                      <Confidence value={it.confidence} />
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {it.document}
                  </td>
                  <td className="mono dim">{it.page}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return <p className="memo__p">{s.body}</p>;
  }
}
