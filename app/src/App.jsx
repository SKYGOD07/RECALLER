import { useEffect, useRef, useState } from 'react';

import { useRoute, useConsole, navigate, useScrollReset } from '@/hooks/index.js';
import { seed, getApplication, getRecord, getProgress, MODE, POLICY } from '@/services/api.js';
import { Icon, StatusPill } from '@/components/ui.jsx';
import { ENGINE_VERSION } from '@core/constants.js';

import Dashboard from '@/pages/Dashboard.jsx';
import NewApplication from '@/pages/NewApplication.jsx';
import Processing from '@/pages/Processing.jsx';
import Evidence from '@/pages/Evidence.jsx';
import Reconciliation from '@/pages/Reconciliation.jsx';
import Assist from '@/pages/Assist.jsx';
import CreditAnalysis from '@/pages/CreditAnalysis.jsx';
import PolicyView from '@/pages/PolicyView.jsx';
import Decision from '@/pages/Decision.jsx';
import CreditMemo from '@/pages/CreditMemo.jsx';
import AuditTrail from '@/pages/AuditTrail.jsx';
import Replay from '@/pages/Replay.jsx';
import WhatIf from '@/pages/WhatIf.jsx';

/** Workspace screens, in the order the file moves through them. */
const WORKSPACE = [
  { id: 'processing', label: 'Processing', icon: 'flow', Page: Processing },
  { id: 'evidence', label: 'Evidence', icon: 'evidence', Page: Evidence, needsRecord: true },
  { id: 'reconciliation', label: 'Reconciliation', icon: 'recon', Page: Reconciliation, needsRecord: true },
  { id: 'assist', label: 'Assist', icon: 'assist', Page: Assist, needsRecord: true },
  { id: 'credit', label: 'Credit analysis', icon: 'credit', Page: CreditAnalysis, needsDecision: true },
  { id: 'policy', label: 'Policy', icon: 'policy', Page: PolicyView, needsDecision: true },
  { id: 'decision', label: 'Decision', icon: 'decision', Page: Decision, needsDecision: true },
  { id: 'memo', label: 'Credit memo', icon: 'memo', Page: CreditMemo, needsDecision: true },
  { id: 'audit', label: 'Audit trail', icon: 'audit', Page: AuditTrail, needsRecord: true },
  { id: 'replay', label: 'Replay', icon: 'replay', Page: Replay, needsDecision: true },
  { id: 'whatif', label: 'What-if', icon: 'whatif', Page: WhatIf, needsDecision: true },
];

export default function App() {
  const route = useRoute();
  const snapshot = useConsole();
  const [ready, setReady] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    seed().then(() => setReady(true));
  }, []);

  useScrollReset(route.path, scrollRef);

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <div className="stack" style={{ alignItems: 'center', gap: 10 }}>
          <div className="rail__mark" style={{ width: 30, height: 30, fontSize: 15 }}>
            R
          </div>
          <div className="eyebrow">Loading underwriting console…</div>
        </div>
      </div>
    );
  }

  const [head, appId, screenId] = route.parts;
  const inWorkspace = head === 'app' && appId;
  const application = inWorkspace ? getApplication(appId) : null;
  const record = inWorkspace ? getRecord(appId) : null;
  const screen = screenId ?? 'processing';

  return (
    <div className="shell">
      <Rail
        route={route}
        application={application}
        record={record}
        screen={screen}
        snapshot={snapshot}
      />
      <main className="main">
        <Topbar route={route} application={application} record={record} screen={screen} />
        <div className="scroll" ref={scrollRef}>
          <Router route={route} application={application} record={record} screen={screen} />
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Router({ route, application, record, screen }) {
  const [head, appId] = route.parts;

  if (!head) return <Dashboard />;
  if (head === 'new') return <NewApplication />;
  if (head === 'policy') return <PolicyView standalone />;

  if (head === 'app') {
    if (!application) {
      return (
        <div className="page">
          <div className="empty">
            <div className="empty__title">Application not found</div>
            <div className="sub">
              {appId} is not in this console.{' '}
              <button type="button" className="btn btn--sm" onClick={() => navigate('/')}>
                Back to dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }
    const entry = WORKSPACE.find((w) => w.id === screen) ?? WORKSPACE[0];
    const locked = (entry.needsRecord && !record) || (entry.needsDecision && !record?.decision);
    if (locked) {
      return (
        <div className="page">
          <div className="empty">
            <div className="empty__title">Not available yet</div>
            <div className="sub">
              {entry.needsDecision && record
                ? 'This screen becomes available once the file has been decisioned. The execution is currently suspended for officer verification.'
                : 'Run the underwriting workflow first.'}
            </div>
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => navigate(`/app/${application.id}/${record ? 'assist' : 'processing'}`)}
              >
                {record ? 'Go to officer review' : 'Go to processing'}
              </button>
            </div>
          </div>
        </div>
      );
    }
    const { Page } = entry;
    return <Page application={application} record={record} />;
  }

  return <Dashboard />;
}

/* ------------------------------------------------------------------ */

function Rail({ route, application, record, screen, snapshot }) {
  const [head] = route.parts;
  const waiting = snapshot.applications.filter((a) => a.status === 'WAITING_FOR_OFFICER').length;

  return (
    <nav className="rail">
      <div className="rail__brand">
        <span className="rail__mark">R</span>
        <span className="rail__name">RECALLER</span>
        <span className="rail__tag">v{ENGINE_VERSION}</span>
      </div>

      <div className="rail__section">
        <div className="rail__label">Console</div>
        <NavItem
          icon="dashboard"
          label="Applications"
          on={!head}
          badge={waiting ? String(waiting) : null}
          onClick={() => navigate('/')}
        />
        <NavItem icon="plus" label="New application" on={head === 'new'} onClick={() => navigate('/new')} />
        <NavItem
          icon="policy"
          label="Policy book"
          on={head === 'policy'}
          onClick={() => navigate('/policy')}
        />
      </div>

      {application && (
        <div className="rail__section">
          <div className="rail__label">{application.id}</div>
          <div style={{ padding: '0 9px 9px' }}>
            <div style={{ fontSize: 13, fontWeight: 550 }}>{application.borrower_name}</div>
            <div style={{ marginTop: 5 }}>
              <StatusPill status={application.status} />
            </div>
          </div>
          {WORKSPACE.map((w) => {
            const locked = (w.needsRecord && !record) || (w.needsDecision && !record?.decision);
            const held = w.id === 'assist' && record?.assist?.required;
            return (
              <NavItem
                key={w.id}
                icon={w.icon}
                label={w.label}
                on={screen === w.id}
                disabled={locked}
                badge={held ? String(record.assist.queue.length) : null}
                onClick={() => navigate(`/app/${application.id}/${w.id}`)}
              />
            );
          })}
        </div>
      )}

      <div className="rail__foot">
        <div>
          engine <b>{ENGINE_VERSION}</b>
        </div>
        <div>
          policy <b>v{POLICY.version}</b>
        </div>
        <div>
          transport <b>{MODE}</b>
        </div>
      </div>
    </nav>
  );
}

function NavItem({ icon, label, on, disabled, badge, onClick }) {
  return (
    <button
      type="button"
      className={`navitem${on ? ' navitem--on' : ''}${disabled ? ' navitem--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-current={on ? 'page' : undefined}
    >
      <Icon name={icon} className="navitem__ico" />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {badge && <span className={`navitem__badge${on ? ' navitem__badge--acc' : ''}`}>{badge}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */

const SCREEN_LABEL = Object.fromEntries(WORKSPACE.map((w) => [w.id, w.label]));

function Topbar({ route, application, record, screen }) {
  const [head] = route.parts;

  return (
    <header className="topbar">
      {application ? (
        <>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => navigate('/')}>
            <Icon name="back" size={13} />
          </button>
          <div className="crumbs">
            <span className="mono">{application.id}</span>
            <span className="crumbs__sep">/</span>
            <b>{application.borrower_name}</b>
            <span className="crumbs__sep">/</span>
            <span>{SCREEN_LABEL[screen] ?? screen}</span>
          </div>
          <div className="topbar__right">
            {record?.decision && (
              <span className="mono dim" title="Deterministic calculation input fingerprint">
                {record.credit.input_hash.slice(0, 10)}
              </span>
            )}
            <StatusPill status={application.status} />
          </div>
        </>
      ) : (
        <>
          <div className="crumbs">
            <b>{head === 'new' ? 'New application' : head === 'policy' ? 'Policy book' : 'Applications'}</b>
          </div>
          <div className="topbar__right">
            <span className="mono dim">
              {POLICY.policy_id} v{POLICY.version}
            </span>
          </div>
        </>
      )}
    </header>
  );
}
