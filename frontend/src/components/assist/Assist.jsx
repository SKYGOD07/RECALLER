/**
 * "When confidence drops, RECALLER stops."
 *
 * The execution is suspended at a checkpoint. Each held field shows what was
 * read, how sure the extraction was, and where it came from; the officer
 * confirms, corrects or drops it, and the pipeline resumes from the checkpoint
 * with the human answer stamped into the evidence.
 */

import { useState } from 'react'
import { CButton, EmptyState, LimitBar, Panel, Tag } from '@/components/common/ui.jsx'
import { DASH, evidenceValue, num, pct } from '@/lib/format'

const ACTIONS = [
  { id: 'CONFIRM', label: 'Confirm' },
  { id: 'EDIT', label: 'Correct' },
  { id: 'REJECT', label: 'Drop' },
]

function HeldField({ field, resolution, onChange }) {
  const action = resolution?.action ?? null

  return (
    <li className={`held${action ? ' is-resolved' : ''}`}>
      <header className="held__head">
        <div>
          <h4 className="held__label">
            {field.label}
            {field.critical ? <span className="efield__crit caps">critical</span> : null}
          </h4>
          <p className="held__path mono t3">{field.path}</p>
        </div>
        <Tag kind={action ? 'approve' : 'refer'} pulse={!action}>
          {action ? 'Resolved' : 'Verification required'}
        </Tag>
      </header>

      <div className="held__read">
        <span className="caps t3">Extracted value</span>
        <span className="held__value tnum">{evidenceValue(field.value, field.type)}</span>
      </div>

      <div className="held__conf">
        <LimitBar
          value={field.confidence}
          limit={field.floor}
          kind="reject"
          label={`Confidence ${pct(field.confidence, 0)} against a floor of ${pct(field.floor, 0)}`}
        />
        <span className="held__conf-text tnum">
          Confidence {pct(field.confidence, 0)} · floor {pct(field.floor, 0)}
        </span>
      </div>

      <p className="held__reason">{field.reason}</p>
      {field.citation ? (
        <p className="held__cite mono t3">
          {field.citation.document} · page {num(field.citation.page)} · {field.citation.snippet}
        </p>
      ) : null}

      <div className="held__actions" role="group" aria-label={`Resolve ${field.label}`}>
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`held__action${action === a.id ? ' is-active' : ''}`}
            onClick={() => onChange(a.id === action ? null : { action: a.id, value: field.value })}
          >
            {a.label}
          </button>
        ))}
      </div>

      {action === 'EDIT' ? (
        <label className="held__edit">
          <span className="caps t3">Officer value</span>
          <input
            type="text"
            value={resolution.value ?? ''}
            onChange={(e) => onChange({ action: 'EDIT', value: e.target.value })}
            placeholder={String(field.value ?? '')}
          />
        </label>
      ) : null}
    </li>
  )
}

/**
 * Held fields no longer share one floor: attested evidence answers to its own,
 * lower bar. Quoting a single number here would contradict the floor printed on
 * each card, so the header names the range that is actually in play.
 */
function floorSummary(queue) {
  const count = `${num(queue.length)} field${queue.length === 1 ? '' : 's'} held`
  const floors = [...new Set(queue.map((q) => q.floor))].filter((f) => f != null).sort((a, b) => a - b)
  if (!floors.length) return count
  if (floors.length === 1) return `${count} · floor ${pct(floors[0], 0)}`
  return `${count} · floors ${pct(floors[0], 0)}–${pct(floors[floors.length - 1], 0)}`
}

export default function Assist({ record, busy, onResume }) {
  const assist = record.assist ?? {}
  const queue = assist.queue ?? []
  const [resolutions, setResolutions] = useState({})

  if (!assist.required) {
    const resolved = assist.resolved ?? []
    return (
      <Panel title="Assist" meta={`${num(resolved.length)} officer interventions`}>
        {resolved.length ? (
          <ul className="resolved">
            {resolved.map((r) => (
              <li key={r.path} className="resolved__row">
                <Tag kind="approve">{r.action}</Tag>
                <span className="mono">{r.path}</span>
                <span className="resolved__value tnum">{String(r.value ?? DASH)}</span>
                {r.note ? <span className="t3">{r.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No human verification was needed"
            body="Every extracted field cleared its confidence floor, so the pipeline ran end to end without stopping."
          />
        )}
      </Panel>
    )
  }

  const pending = queue.filter((f) => !resolutions[f.path])
  const ready = pending.length === 0

  const submit = () => {
    const payload = queue.map((f) => ({
      path: f.path,
      action: resolutions[f.path].action,
      value: resolutions[f.path].value,
      by: record.application.officer ?? 'officer',
      note: 'Verified against source document in assist mode',
    }))
    onResume(payload)
  }

  return (
    <Panel
      title="Execution suspended"
      meta={floorSummary(queue)}
      action={
        <CButton onClick={submit} disabled={!ready || busy}>
          {busy ? 'Resuming…' : `Confirm and resume (${num(queue.length - pending.length)}/${num(queue.length)})`}
        </CButton>
      }
    >
      <p className="assist__lead">
        The workflow stopped before any credit figure was produced. RECALLER does not guess a field it
        could not read with enough certainty — it asks, then resumes from the checkpoint.
      </p>

      <ul className="helds">
        {queue.map((f) => (
          <HeldField
            key={f.path}
            field={f}
            resolution={resolutions[f.path]}
            onChange={(next) =>
              setResolutions((r) => {
                if (next === null) {
                  const { [f.path]: _drop, ...rest } = r
                  return rest
                }
                return { ...r, [f.path]: next }
              })
            }
          />
        ))}
      </ul>
    </Panel>
  )
}
