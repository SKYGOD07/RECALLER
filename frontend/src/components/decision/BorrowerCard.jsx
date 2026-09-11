/** Who the file is about, and what they asked for. */

import { Panel } from '@/components/common/ui.jsx'
import { DASH, inr, initials, num } from '@/lib/format'

export default function BorrowerCard({ application, documents, policy, values }) {
  const segment = policy?.segments?.[application.segment]

  return (
    <Panel title="Borrower and facility" meta={application.id}>
      <div className="borrower">
        <span className="borrower__avatar" aria-hidden="true">
          {initials(application.borrower_name)}
        </span>
        <div>
          <h3 className="borrower__name">{application.borrower_name}</h3>
          <p className="borrower__sub">
            {application.occupation} · {application.branch}
          </p>
        </div>
      </div>

      <dl className="kv">
        <div className="kv__row">
          <dt>Asset segment</dt>
          <dd>{segment?.label ?? application.segment}</dd>
        </div>
        <div className="kv__row">
          <dt>Vehicle</dt>
          <dd>{values?.invoice?.model ?? DASH}</dd>
        </div>
        <div className="kv__row">
          <dt>Dealer</dt>
          <dd>{application.dealer}</dd>
        </div>
        <div className="kv__row">
          <dt>Requested</dt>
          <dd className="tnum">
            {inr(application.loan_amount)} · {num(application.tenure_months)} months
          </dd>
        </div>
        <div className="kv__row">
          <dt>Declared income</dt>
          <dd className="tnum">{inr(application.declared_monthly_income)}</dd>
        </div>
        <div className="kv__row">
          <dt>Officer</dt>
          <dd>{application.officer}</dd>
        </div>
        <div className="kv__row">
          <dt>Documents</dt>
          <dd className="tnum">{num(documents?.length ?? application.document_count)}</dd>
        </div>
      </dl>

      {documents?.length ? (
        <ul className="docs">
          {documents.map((d) => (
            <li key={d.id} className="docs__item">
              <span className="docs__type caps">{d.type.replace(/_/g, ' ')}</span>
              <span className="docs__name mono">{d.filename}</span>
              <span className="docs__pages t3 tnum">{num(d.pages)}p</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  )
}
