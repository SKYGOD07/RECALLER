/**
 * The credit memo.
 *
 * Left: the structured decision object the engine produced. Right: the memo
 * written from it. The arrow between them only ever points one way — narration
 * describes a decision that already exists.
 */

import { Panel, Tag } from '@/components/common/ui.jsx'
import { pct } from '@/lib/format'

const STATUS_KIND = { MATCHED: 'approve', ADVISORY: 'refer', MISMATCH: 'refer', BLOCKING: 'reject' }
const OUTCOME_KIND = { PASS: 'approve', REFER: 'refer', FAIL: 'reject', NOT_APPLICABLE: 'idle' }

function Section({ section }) {
  const { kind, title, body, rows, items, note } = section

  return (
    <section className="memo__section">
      <h4 className="memo__h">{title}</h4>
      {body ? <p className="memo__body">{body}</p> : null}

      {(kind === 'table' || kind === 'metrics') && rows ? (
        <dl className="memo__rows">
          {rows.map(([k, v]) => (
            <div key={k} className="memo__row">
              <dt>{k}</dt>
              <dd className="tnum">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {kind === 'findings' && items?.length ? (
        <ul className="memo__list">
          {items.map((f) => (
            <li key={f.code}>
              <Tag kind={STATUS_KIND[f.status] ?? 'idle'}>{f.status}</Tag>
              <span>
                <strong>{f.label}</strong> — {f.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {kind === 'policy' && items?.length ? (
        <ul className="memo__list">
          {items.map((r) => (
            <li key={r.code}>
              <Tag kind={OUTCOME_KIND[r.outcome] ?? 'idle'}>{r.outcome}</Tag>
              <span>
                <strong>{r.label}</strong> — <span className="mono tnum">{r.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {kind === 'codes' && items?.length ? (
        <ul className="memo__codes">
          {items.map((c) => (
            <li key={c.code}>
              <span className="mono">{c.code}</span> {c.text}
            </li>
          ))}
        </ul>
      ) : null}

      {kind === 'interventions' && items?.length ? (
        <ul className="memo__list">
          {items.map((i) => (
            <li key={i.path}>
              <Tag kind="refer">{i.action}</Tag>
              <span>
                <strong>{i.label}</strong> — {String(i.from ?? '—')} → {String(i.to ?? '—')}
                {i.note ? ` · ${i.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {kind === 'citations' && items?.length ? (
        <ul className="memo__cites">
          {items.map((c, idx) => (
            <li key={`${c.label}-${idx}`}>
              <span className="memo__cite-label">{c.label}</span>
              <span className="memo__cite-value tnum">{c.value}</span>
              <span className="memo__cite-src mono t3">
                {c.document} p{c.page} · {pct(c.confidence, 0)} · {c.provenance}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {note ? <p className="memo__note">{note}</p> : null}
    </section>
  )
}

export default function CreditMemo({ record }) {
  const memo = record.memo
  if (!memo) return null
  const m = record.credit.metrics

  return (
    <Panel title="Credit memo" meta="Narration from a finished decision">
      <div className="memo">
        <aside className="memo__structured">
          <p className="caps t3">Structured decision</p>
          <pre className="memo__json mono">
            {JSON.stringify(
              {
                decision: record.decision.decision,
                reason_codes: record.decision.reason_codes.map((c) => c.code),
                foir: m.foir,
                ltv: m.ltv,
                emi: m.emi,
                policy_version: record.policyEvaluation.policy_version,
                input_hash: record.credit.input_hash,
              },
              null,
              2,
            )}
          </pre>
          <p className="memo__arrow" aria-hidden="true">
            ↓
          </p>
          <p className="memo__caption">
            The memo below is written from this object. It restates the decision; it cannot change it,
            and any figure it moved would be discarded.
          </p>
        </aside>

        <article className="memo__doc">
          {memo.sections.map((s) => (
            <Section key={s.id} section={s} />
          ))}
        </article>
      </div>
    </Panel>
  )
}
