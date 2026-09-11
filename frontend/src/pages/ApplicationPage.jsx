/**
 * The underwriting workspace for one file. Every tab reads the same record;
 * none of them recompute any part of it.
 */

import { useCallback } from 'react'
import Assist from '@/components/assist/Assist.jsx'
import Audit from '@/components/audit/Audit.jsx'
import {
  CButton,
  EmptyState,
  ErrorState,
  Loading,
  Skeleton,
  StatusTag,
} from '@/components/common/ui.jsx'
import BorrowerCard from '@/components/decision/BorrowerCard.jsx'
import ComputePanel from '@/components/decision/ComputePanel.jsx'
import CreditMemo from '@/components/decision/CreditMemo.jsx'
import DecisionHero from '@/components/decision/DecisionHero.jsx'
import PolicyLedger from '@/components/decision/PolicyLedger.jsx'
import RunPanel from '@/components/decision/RunPanel.jsx'
import EvidenceGrid from '@/components/evidence/EvidenceGrid.jsx'
import Reconciliation from '@/components/reconciliation/Reconciliation.jsx'
import WhatIf from '@/components/whatif/WhatIf.jsx'
import { useApplicationDetail } from '@/hooks/console'
import { amendPolicy } from '@/api'
import { applicationPath, Link } from '@/lib/router'
import {
  replay,
  resume,
  selectApplication,
  selectDocuments,
  selectProgress,
  selectRecord,
  selectReplays,
  simulate,
  solveWhatIf,
  underwrite,
} from '@/store/console'
import { toast } from '@/store/toasts'

function NotRun({ id, busy, onStart }) {
  return (
    <EmptyState
      title="This file has not been underwritten yet"
      body="Run the pipeline to produce evidence, reconciliation, metrics and a decision."
      action={
        <CButton onClick={onStart} disabled={busy}>
          {busy ? 'Running…' : `Run underwriting on ${id}`}
        </CButton>
      }
    />
  )
}

export default function ApplicationPage({ id, tab }) {
  const state = useApplicationDetail(id)
  const application = selectApplication(state, id)
  const record = selectRecord(state, id)
  const documents = selectDocuments(state, id)
  const progress = selectProgress(state, id)
  const replays = selectReplays(state, id)
  const busy = state.busy[id] ?? null
  const error = state.errors[id] ?? null

  const start = useCallback(async () => {
    try {
      const next = await underwrite(id)
      toast(
        next.status === 'WAITING_FOR_OFFICER'
          ? 'Execution suspended — officer verification required'
          : `Underwriting complete — ${next.decision.decision}`,
        { kind: next.status === 'WAITING_FOR_OFFICER' ? 'warn' : 'success' },
      )
    } catch (err) {
      toast(err.message, { kind: 'error' })
    }
  }, [id])

  const doResume = useCallback(
    async (resolutions) => {
      try {
        const next = await resume(id, resolutions)
        toast(`Execution resumed — ${next.decision.decision}`, { kind: 'success' })
      } catch (err) {
        toast(err.message, { kind: 'error' })
      }
    },
    [id],
  )

  const doReplay = useCallback(async () => {
    try {
      const res = await replay(id, {})
      toast(res.identical ? 'Replay reproduced the decision exactly' : 'Replay diverged from the original', {
        kind: res.identical ? 'success' : 'warn',
      })
    } catch (err) {
      toast(err.message, { kind: 'error' })
    }
  }, [id])

  const doReplayAmended = useCallback(
    async (overrides) => {
      try {
        const res = await replay(id, {
          policy: amendPolicy(state.policy, overrides),
          label: 'Replay against amended policy',
        })
        toast(
          res.diff?.decision
            ? `Amended policy would decide ${res.diff.decision.to}`
            : 'Amended policy reaches the same decision',
          { kind: 'info' },
        )
      } catch (err) {
        toast(err.message, { kind: 'error' })
      }
    },
    [id, state.policy],
  )

  const onSolve = useCallback(() => solveWhatIf(id, 'APPROVE'), [id])
  const onSimulate = useCallback((scenario) => simulate(id, scenario), [id])

  if (state.boot === 'ERROR') {
    return <ErrorState title="RECALLER runtime unavailable" body={state.bootError} />
  }

  if (!application) {
    return error ? (
      <ErrorState title={`Could not open ${id}`} body={error} />
    ) : (
      <Skeleton lines={5} className="skel--page" />
    )
  }

  const running = busy === 'UNDERWRITING' || busy === 'RESUMING'
  const suspended = record?.status === 'WAITING_FOR_OFFICER'

  const header = (
    <header className="wshead">
      <div>
        <p className="caps t3">
          <Link to="/console" className="linkish">
            Applications
          </Link>{' '}
          / <span className="mono">{application.id}</span>
        </p>
        <h1 className="wshead__title">{application.borrower_name}</h1>
        <p className="wshead__sub">{application.scenario}</p>
      </div>
      <div className="wshead__right">
        <StatusTag status={application.status} />
        {record && !running ? (
          <CButton variant="ghost" size="sm" onClick={start}>
            Re-run
          </CButton>
        ) : null}
      </div>
    </header>
  )

  const gate = (node, requirement = 'a completed run') => {
    if (running) return <Loading message="Underwriting in progress" />
    if (!record) return <NotRun id={id} busy={running} onStart={start} />
    if (!node)
      return (
        <EmptyState
          title={`This view needs ${requirement}`}
          body={
            suspended
              ? 'The execution is suspended at the confidence gate. Resolve the held fields in Assist to continue.'
              : 'Run the pipeline to populate this workspace.'
          }
          action={
            suspended ? (
              <Link className="cbtn cbtn--primary" to={applicationPath(id, 'assist')}>
                Open Assist
              </Link>
            ) : null
          }
        />
      )
    return node
  }

  let body = null

  if (tab === 'evidence') {
    body = gate(
      record?.evidence ? (
        <EvidenceGrid
          evidence={record.evidence}
          thresholds={record.assist?.thresholds ?? state.policy?.confidence ?? {}}
        />
      ) : null,
    )
  } else if (tab === 'reconciliation') {
    body = gate(record?.reconciliation ? <Reconciliation reconciliation={record.reconciliation} /> : null)
  } else if (tab === 'what-if') {
    body = gate(
      record?.credit ? (
        <WhatIf record={record} policy={state.policy} onSolve={onSolve} onSimulate={onSimulate} />
      ) : null,
      'a decided file',
    )
  } else if (tab === 'assist') {
    body = gate(record ? <Assist record={record} busy={busy === 'RESUMING'} onResume={doResume} /> : null)
  } else if (tab === 'audit') {
    body = gate(
      record?.audit ? (
        <Audit
          record={record}
          replays={replays}
          policy={state.policy}
          busy={busy === 'REPLAYING'}
          onReplay={doReplay}
          onReplayAmended={doReplayAmended}
        />
      ) : null,
    )
  } else {
    body = (
      <div className="ws">
        <div className="ws__main">
          {record?.decision ? (
            <>
              <DecisionHero record={record} policy={state.policy} />
              <ComputePanel credit={record.credit} policy={state.policy} />
              <PolicyLedger evaluation={record.policyEvaluation} />
              <CreditMemo record={record} />
            </>
          ) : (
            <RunPanel
              stagePlan={state.stagePlan}
              progress={progress}
              busy={running}
              onStart={record ? null : start}
              error={error}
              onRetry={start}
            />
          )}

          {suspended ? (
            <div className="ws__suspended">
              <p>
                Execution suspended at the confidence gate. {record.assist.queue.length} field
                {record.assist.queue.length === 1 ? '' : 's'} need a human answer before any credit figure
                is produced.
              </p>
              <Link className="cbtn cbtn--primary" to={applicationPath(id, 'assist')}>
                Open Assist
              </Link>
            </div>
          ) : null}
        </div>

        <aside className="ws__side">
          <BorrowerCard
            application={application}
            documents={documents}
            policy={state.policy}
            values={record?.evidence?.values}
          />
          {record?.decision ? (
            <RunPanel stagePlan={state.stagePlan} progress={progress} busy={running} onStart={null} />
          ) : null}
        </aside>
      </div>
    )
  }

  return (
    <>
      {header}
      {body}
    </>
  )
}
