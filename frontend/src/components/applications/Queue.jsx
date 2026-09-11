/** The application queue — the console's front door. */

import { EmptyState, StatusTag, Tag, decisionKind } from '@/components/common/ui.jsx'
import { inr, initials, num } from '@/lib/format'
import { applicationPath, Link } from '@/lib/router'

const FILTERS = [
  { id: 'ALL', label: 'All files' },
  { id: 'OPEN', label: 'Not decided' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REFERRED', label: 'Referred' },
  { id: 'REJECTED', label: 'Declined' },
]

const matches = (app, filter) => {
  if (filter === 'ALL') return true
  if (filter === 'OPEN') return app.status === 'DRAFT' || app.status === 'WAITING_FOR_OFFICER'
  return app.status === filter
}

function Row({ app, segmentLabel }) {
  const kind = app.decision ? decisionKind(app.decision) : 'idle'

  return (
    <Link to={applicationPath(app.id)} className={`qrow qrow--${kind}`}>
      <span className="qrow__avatar" aria-hidden="true">
        {initials(app.borrower_name)}
      </span>

      <span className="qrow__who">
        <span className="qrow__id mono">{app.id}</span>
        <strong className="qrow__name">{app.borrower_name}</strong>
        <span className="qrow__sub">
          {app.occupation} · {app.branch}
        </span>
      </span>

      <span className="qrow__cell">
        <span className="qrow__k caps">Asset</span>
        <span className="qrow__v">{segmentLabel}</span>
      </span>

      <span className="qrow__cell">
        <span className="qrow__k caps">Requested</span>
        <span className="qrow__v tnum">{inr(app.loan_amount)}</span>
        <span className="qrow__vsub tnum">{num(app.tenure_months)} months</span>
      </span>

      <span className="qrow__cell">
        <span className="qrow__k caps">Evidence</span>
        <span className="qrow__v tnum">{num(app.document_count)} documents</span>
      </span>

      <span className="qrow__status">
        <StatusTag status={app.status} />
      </span>

      <span className="qrow__go" aria-hidden="true">
        →
      </span>
    </Link>
  )
}

export default function Queue({ applications, policy, filter, onFilter }) {
  const segmentLabel = (seg) => policy?.segments?.[seg]?.label ?? seg
  const visible = applications.filter((a) => matches(a, filter))

  const counts = {
    total: applications.length,
    decided: applications.filter((a) => a.decision).length,
    waiting: applications.filter((a) => a.status === 'WAITING_FOR_OFFICER').length,
  }

  return (
    <>
      <header className="qhead">
        <div>
          <p className="caps t3">Loan officer console</p>
          <h1 className="qhead__title">Applications</h1>
          <p className="qhead__sub">
            {num(counts.total)} files · {num(counts.decided)} decided · {num(counts.waiting)} awaiting
            verification
          </p>
        </div>

        <div className="qhead__filters" role="tablist" aria-label="Filter applications">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`qfilter${filter === f.id ? ' is-active' : ''}`}
              onClick={() => onFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {visible.length ? (
        <div className="qlist">
          {visible.map((app) => (
            <Row key={app.id} app={app} segmentLabel={segmentLabel(app.segment)} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No files in this view"
          body="Change the filter to see the rest of the queue."
        />
      )}

      <p className="qhint">
        <Tag kind="idle">Tip</Tag>
        Select an application to begin underwriting. Every figure you will see is produced by the
        deterministic engine, never by this interface.
      </p>
    </>
  )
}
