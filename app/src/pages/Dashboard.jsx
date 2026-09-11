/**
 * Screen 1 — Application dashboard.
 *
 * The officer's queue. Everything here answers one question: which file needs
 * me next? Files waiting on a human sort to the top regardless of the chosen
 * ordering, because a suspended execution is the only state where the system
 * cannot proceed without someone.
 */

import { useConsole, useSticky, useMemo, useState, navigate } from '@/hooks/index.js';
import { listApplications, getRecord, startUnderwriting, resetConsole, POLICY } from '@/services/api.js';
import { Card, Icon, PageHead, StatusPill, DecisionPill, Money, Pct, Empty, relativeTime } from '@/components/ui.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'WAITING_FOR_OFFICER', label: 'Needs officer' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REFERRED', label: 'Referred' },
  { id: 'REJECTED', label: 'Rejected' },
];

export default function Dashboard() {
  useConsole();
  const apps = listApplications();
  const [filter, setFilter] = useSticky('dash.filter', 'all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);

  const counts = useMemo(() => {
    const c = { total: apps.length, waiting: 0, approved: 0, referred: 0, rejected: 0, draft: 0 };
    apps.forEach((a) => {
      if (a.status === 'WAITING_FOR_OFFICER') c.waiting += 1;
      else if (a.status === 'APPROVED') c.approved += 1;
      else if (a.status === 'REFERRED') c.referred += 1;
      else if (a.status === 'REJECTED') c.rejected += 1;
      else if (a.status === 'DRAFT') c.draft += 1;
    });
    return c;
  }, [apps]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = apps.filter((a) => {
      if (q && !`${a.id} ${a.borrower_name} ${a.dealer ?? ''} ${a.branch ?? ''}`.toLowerCase().includes(q)) return false;
      if (filter === 'all') return true;
      if (filter === 'open') return ['DRAFT', 'PROCESSING', 'WAITING_FOR_OFFICER'].includes(a.status);
      return a.status === filter;
    });
    // Files blocking on a human always surface first.
    const rank = (a) => (a.status === 'WAITING_FOR_OFFICER' ? 0 : a.status === 'PROCESSING' ? 1 : a.status === 'DRAFT' ? 2 : 3);
    return matched.sort((a, b) => rank(a) - rank(b) || new Date(b.updated_at) - new Date(a.updated_at));
  }, [apps, filter, query]);

  async function run(e, id) {
    e.stopPropagation();
    setBusy(id);
    navigate(`/app/${id}/processing`);
    try {
      await startUnderwriting(id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Underwriting queue"
        title="Applications"
        sub={`${counts.total} files against policy ${POLICY.policy_id} v${POLICY.version}. Files awaiting officer verification are listed first — the workflow is suspended on those until someone answers.`}
        actions={
          <>
            <button type="button" className="btn btn--ghost" onClick={resetConsole} title="Return every demo file to its unprocessed state">
              Reset demo
            </button>
            <button type="button" className="btn btn--primary" onClick={() => navigate('/new')}>
              <Icon name="plus" size={14} />
              New application
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <Tile label="In queue" value={counts.total} sub={`${counts.draft} not yet processed`} />
        <Tile label="Awaiting officer" value={counts.waiting} tone={counts.waiting ? 'warn' : 'neutral'} sub="Execution suspended" />
        <Tile label="Approved" value={counts.approved} tone={counts.approved ? 'good' : 'neutral'} sub="Cleared every binding rule" />
        <Tile
          label="Referred / rejected"
          value={counts.referred + counts.rejected}
          tone={counts.rejected ? 'bad' : counts.referred ? 'warn' : 'neutral'}
          sub={`${counts.referred} referred, ${counts.rejected} rejected`}
        />
      </div>

      <Card
        flush
        tools={
          <>
            <div className="seg">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <input
              className="input"
              style={{ width: 220 }}
              placeholder="Search borrower, dealer, branch…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </>
        }
        title="Files"
      >
        {rows.length === 0 ? (
          <Empty title="No applications match">Adjust the filter or clear the search.</Empty>
        ) : (
          <div className="tablewrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Borrower</th>
                  <th>Asset</th>
                  <th className="right">Requested</th>
                  <th className="right">FOIR</th>
                  <th className="right">LTV</th>
                  <th>Status</th>
                  <th>Decision</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const record = getRecord(a.id);
                  const m = record?.credit?.metrics;
                  return (
                    <tr
                      key={a.id}
                      className="clickable"
                      onClick={() => navigate(`/app/${a.id}/${landingScreen(a, record)}`)}
                    >
                      <td className="mono">{a.id}</td>
                      <td>
                        <div className="t-strong">{a.borrower_name}</div>
                        <div className="dim" style={{ fontSize: 11.5 }}>
                          {a.occupation}
                        </div>
                      </td>
                      <td>
                        <div>{SEGMENT_SHORT[a.segment] ?? a.segment}</div>
                        <div className="dim" style={{ fontSize: 11.5 }}>
                          {a.dealer}
                        </div>
                      </td>
                      <td className="right">
                        <Money value={a.loan_amount} />
                        <div className="dim" style={{ fontSize: 11.5 }}>
                          {a.tenure_months} months
                        </div>
                      </td>
                      <td className="right">{m ? <Pct value={m.foir} /> : <span className="dim">—</span>}</td>
                      <td className="right">{m ? <Pct value={m.ltv} /> : <span className="dim">—</span>}</td>
                      <td>
                        <StatusPill status={a.status} />
                      </td>
                      <td>
                        <DecisionPill decision={a.decision} />
                      </td>
                      <td className="dim mono" style={{ fontSize: 11 }}>
                        {relativeTime(a.updated_at)}
                      </td>
                      <td className="right">
                        {a.status === 'DRAFT' ? (
                          <button
                            type="button"
                            className="btn btn--sm btn--primary"
                            disabled={busy === a.id}
                            onClick={(e) => run(e, a.id)}
                          >
                            {busy === a.id ? 'Starting…' : 'Underwrite'}
                          </button>
                        ) : a.status === 'WAITING_FOR_OFFICER' ? (
                          <button
                            type="button"
                            className="btn btn--sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/app/${a.id}/assist`);
                            }}
                          >
                            Review
                          </button>
                        ) : (
                          <Icon name="chevron" size={13} className="dim" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="sub" style={{ marginTop: 14, maxWidth: '78ch' }}>
        Every file in this console is synthetic. Identifiers are masked and structurally invalid by construction, so
        nothing here can be mistaken for live KYC material.
      </p>
    </div>
  );
}

const SEGMENT_SHORT = {
  EV_2W: 'EV two-wheeler',
  EV_3W_PASSENGER: 'EV three-wheeler · passenger',
  EV_3W_CARGO: 'EV three-wheeler · cargo',
};

function landingScreen(a, record) {
  if (a.status === 'DRAFT') return 'processing';
  if (a.status === 'WAITING_FOR_OFFICER') return 'assist';
  if (record?.decision) return 'decision';
  return 'processing';
}

function Tile({ label, value, sub, tone = 'neutral' }) {
  const colour =
    tone === 'good' ? 'var(--emerald)' : tone === 'warn' ? 'var(--amber)' : tone === 'bad' ? 'var(--red)' : 'var(--text)';
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__value" style={{ color: colour }}>
        {value}
      </div>
      <div className="metric__sub">{sub}</div>
    </div>
  );
}
