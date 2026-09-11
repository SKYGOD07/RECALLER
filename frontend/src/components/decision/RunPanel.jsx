/**
 * The execution view: the twelve stages of the pipeline, who owns each one,
 * and what the run is doing right now. Stage status is reported by the runtime,
 * never guessed here.
 */

import { CButton, Tag } from '@/components/common/ui.jsx'

const ACTOR_LABEL = {
  SYSTEM: 'System',
  ENGINE: 'Engine',
  LLM: 'AI extraction',
  OFFICER: 'Officer',
  N8N: 'Workflow',
}

const ACTOR_KIND = {
  LLM: 'ai',
  ENGINE: 'engine',
  OFFICER: 'refer',
  SYSTEM: 'idle',
  N8N: 'idle',
}

export default function RunPanel({ stagePlan, progress, busy, onStart, error, onRetry }) {
  const done = stagePlan.filter((s) => progress?.[s.id] === 'DONE').length
  const running = stagePlan.find((s) => progress?.[s.id] === 'RUNNING')

  return (
    <section className="run">
      <header className="run__head">
        <div>
          <p className="caps t3">Execution</p>
          <h2 className="run__title">
            {busy ? (running ? running.label : 'Starting the pipeline') : 'Underwriting pipeline'}
          </h2>
          <p className="run__sub">
            {busy
              ? `${done} of ${stagePlan.length} stages complete`
              : 'Twelve stages, each one recorded in the audit ledger.'}
          </p>
        </div>
        {!busy && onStart ? (
          <CButton onClick={onStart}>Run underwriting</CButton>
        ) : null}
      </header>

      {error ? (
        <p className="run__error" role="alert">
          {error}
          {onRetry ? (
            <button type="button" className="linkish" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </p>
      ) : null}

      <ol className="stages">
        {stagePlan.map((stage) => {
          const status = progress?.[stage.id] ?? 'PENDING'
          return (
            <li key={stage.id} className={`stage stage--${status.toLowerCase()}`}>
              <span className="stage__marker" aria-hidden="true" />
              <span className="stage__body">
                <span className="stage__label">{stage.label}</span>
                <span className={`stage__actor stage__actor--${ACTOR_KIND[stage.actor] ?? 'idle'}`}>
                  {ACTOR_LABEL[stage.actor] ?? stage.actor}
                </span>
              </span>
              <span className="stage__status caps">
                {status === 'HELD' ? 'Held' : status === 'DONE' ? 'Done' : status === 'RUNNING' ? 'Running' : 'Pending'}
              </span>
            </li>
          )
        })}
      </ol>

      <p className="run__note">
        <Tag kind="ai">AI</Tag> reads the documents. <Tag kind="engine">Engine</Tag> computes every
        figure. The two never swap jobs.
      </p>
    </section>
  )
}
