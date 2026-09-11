/**
 * The workbench frame: a top bar that always says which file is open and which
 * runtime is answering, a compact rail of workspaces, and the scrolling pane.
 */

import { useState } from 'react'
import Toasts from '@/components/common/Toasts.jsx'
import { DecisionTag } from '@/components/common/ui.jsx'
import { Logo } from '@/components/ui'
import { applicationPath, Link, useRoute } from '@/lib/router'

const WORKSPACES = [
  { tab: 'underwriting', label: 'Underwriting', hint: 'Decision and metrics' },
  { tab: 'evidence', label: 'Evidence', hint: 'Extracted fields and citations' },
  { tab: 'reconciliation', label: 'Reconciliation', hint: 'Cross-document checks' },
  { tab: 'what-if', label: 'What-if', hint: 'Paths to a better outcome' },
  { tab: 'assist', label: 'Assist', hint: 'Human verification queue' },
  { tab: 'audit', label: 'Audit', hint: 'Execution trace and replay' },
]

function Health({ runtime, boot }) {
  const online = boot === 'READY' && runtime.status === 'ONLINE'
  const kind = boot === 'ERROR' ? 'reject' : online ? 'approve' : 'busy'
  const label = boot === 'ERROR' ? 'Runtime unavailable' : online ? 'Runtime online' : 'Starting'

  return (
    <div className={`health health--${kind}`} title={runtime.error ?? undefined}>
      <span className="health__dot" aria-hidden="true" />
      <span className="health__label">{label}</span>
      <span className="health__sep" aria-hidden="true" />
      <span className="health__detail caps">
        {runtime.label}
        {runtime.degraded ? ' · fallback' : ''}
      </span>
    </div>
  )
}

export default function ConsoleShell({ state, application, children }) {
  const { route } = useRoute()
  const [railOpen, setRailOpen] = useState(false)
  const id = route.id

  return (
    <div className="console">
      <header className="ctop">
        <div className="ctop__left">
          <Link to="/" className="ctop__brand" aria-label="RECALLER — landing page">
            <Logo size={22} />
            <span>RECALLER</span>
          </Link>
          <span className="ctop__divider" aria-hidden="true" />
          <Link to="/console" className="ctop__crumb">
            Applications
          </Link>
          {application ? (
            <>
              <span className="ctop__chev" aria-hidden="true">
                /
              </span>
              <span className="ctop__file">
                <span className="mono">{application.id}</span>
                <span className="t3"> · {application.borrower_name}</span>
              </span>
              {application.decision ? <DecisionTag decision={application.decision} /> : null}
            </>
          ) : null}
        </div>

        <div className="ctop__right">
          {state.policy ? (
            <span className="ctop__policy caps" title={`Policy ${state.policy.policy_id}`}>
              Policy {state.policy.version}
            </span>
          ) : null}
          <Health runtime={state.runtime} boot={state.boot} />
          <button
            type="button"
            className="ctop__rail-toggle"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((o) => !o)}
          >
            {railOpen ? 'Close' : 'Menu'}
          </button>
        </div>
      </header>

      <div className="cbody">
        <nav className={`crail${railOpen ? ' is-open' : ''}`} aria-label="Workspaces">
          <Link
            to="/console"
            className={`crail__item${route.view === 'queue' ? ' is-active' : ''}`}
            onClick={() => setRailOpen(false)}
          >
            <span className="crail__label">Applications</span>
            <span className="crail__hint">{state.applications.length} in queue</span>
          </Link>

          <span className="crail__rule" aria-hidden="true" />

          {WORKSPACES.map((w) =>
            id ? (
              <Link
                key={w.tab}
                to={applicationPath(id, w.tab)}
                className={`crail__item${route.tab === w.tab ? ' is-active' : ''}`}
                onClick={() => setRailOpen(false)}
              >
                <span className="crail__label">{w.label}</span>
                <span className="crail__hint">{w.hint}</span>
              </Link>
            ) : (
              <span key={w.tab} className="crail__item is-disabled" aria-disabled="true">
                <span className="crail__label">{w.label}</span>
                <span className="crail__hint">Select a file</span>
              </span>
            ),
          )}

          <span className="crail__foot caps t4">
            Engine {state.runtime.engine_version ?? '—'}
          </span>
        </nav>

        <main className="cmain" id="console-main">
          {children}
        </main>
      </div>

      <Toasts />
    </div>
  )
}
