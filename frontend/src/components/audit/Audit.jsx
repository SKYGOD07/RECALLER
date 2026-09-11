/**
 * "Every decision leaves a trace."
 *
 * The ledger is hash-chained: each event carries the digest of the one before
 * it. Replaying the file against the same policy must reproduce the same
 * decision from the same inputs — and against an amended policy, it shows
 * exactly what a changed cutoff would have done.
 */

import { useState } from 'react'
import { CButton, Panel, Tag } from '@/components/common/ui.jsx'
import { DASH, clockTime, dateTime, duration, fingerprint, num, pct } from '@/lib/format'

const ACTOR_KIND = {
  SYSTEM: 'idle',
  ENGINE: 'engine',
  LLM: 'ai',
  OFFICER: 'refer',
  N8N: 'idle',
}

function Event({ event }) {
  return (
    <li className="event">
      <span className="event__rail" aria-hidden="true">
        <span className="event__dot" />
      </span>
      <div className="event__body">
        <header className="event__head">
          <span className="event__seq mono t4">{String(event.seq).padStart(2, '0')}</span>
          <h4 className="event__stage">{event.stage.replace(/_/g, ' ')}</h4>
          <Tag kind={ACTOR_KIND[event.actor] ?? 'idle'}>{event.actor}</Tag>
          <span className="event__time mono t3">{clockTime(event.at)}</span>
          <span className="event__ms mono t4">{duration(event.durationMs)}</span>
        </header>
        <p className="event__summary">{event.summary}</p>
        <p className="event__digest mono t4">
          {String(event.prev).slice(0, 8)} → <strong>{String(event.digest).slice(0, 12)}</strong>
        </p>
      </div>
    </li>
  )
}

function ReplayRow({ replay }) {
  const d = replay.diff ?? {}
  return (
    <li className={`replay${replay.identical ? ' replay--same' : ''}`}>
      <header className="replay__head">
        <h4>{replay.label}</h4>
        <Tag kind={replay.identical ? 'approve' : 'refer'}>
          {replay.identical ? 'Identical' : 'Diverged'}
        </Tag>
        <span className="mono t3">
          v{replay.policy_version} · {replay.policy_hash}
        </span>
        <span className="t4 mono">{dateTime(replay.ran_at)}</span>
      </header>

      {replay.identical ? (
        <p className="replay__note">
          Same inputs, same policy, same decision — {replay.decision.decision} reproduced exactly.
        </p>
      ) : (
        <div className="replay__diff">
          {d.decision ? (
            <p className="replay__dec">
              Decision {d.decision.from} → <strong>{d.decision.to}</strong>
            </p>
          ) : (
            <p className="replay__dec">Decision unchanged at {replay.decision.decision}</p>
          )}
          {d.metrics?.length ? (
            <ul className="replay__metrics">
              {d.metrics.map((row) => (
                <li key={row.field} className="tnum">
                  <span className="mono">{row.field}</span> {String(row.from)} → {String(row.to)}
                </li>
              ))}
            </ul>
          ) : null}
          {d.reason_codes?.added?.length ? (
            <p className="replay__codes">
              Added <span className="mono">{d.reason_codes.added.join(', ')}</span>
            </p>
          ) : null}
          {d.reason_codes?.removed?.length ? (
            <p className="replay__codes">
              Removed <span className="mono">{d.reason_codes.removed.join(', ')}</span>
            </p>
          ) : null}
        </div>
      )}
    </li>
  )
}

export default function Audit({ record, replays, policy, busy, onReplay, onReplayAmended }) {
  const ledger = record.audit ?? { events: [] }
  const foirRule = policy?.rules?.find((r) => r.code === 'P-FOIR-01')
  const ltvRule = policy?.rules?.find((r) => r.code === 'P-LTV-01')

  const [foir, setFoir] = useState(foirRule?.threshold ?? 0.5)
  const [ltv, setLtv] = useState(ltvRule?.threshold ?? 0.85)

  const amended = foir !== foirRule?.threshold || ltv !== ltvRule?.threshold

  return (
    <>
      <Panel
        title="Decision fingerprint"
        meta={`Trace ${ledger.traceId}`}
        action={
          <CButton variant="ghost" size="sm" disabled={busy} onClick={onReplay}>
            {busy ? 'Replaying…' : 'Replay decision'}
          </CButton>
        }
      >
        <div className="fprint">
          <div className="fprint__main">
            <span className="caps t3">Ledger head · FNV-1a 64-bit chain</span>
            <strong className="fprint__hash mono">{fingerprint(ledger.head, 6)}</strong>
            <p className="fprint__note">Same inputs plus same policy produce the same decision.</p>
          </div>
          <dl className="fprint__facts">
            <div>
              <dt>Calculation inputs</dt>
              <dd className="mono">{record.credit?.input_hash ?? DASH}</dd>
            </div>
            <div>
              <dt>Extraction</dt>
              <dd className="mono">{record.evidence?.extraction_hash ?? DASH}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd className="mono">
                v{record.policy_version} · {record.policy_hash}
              </dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd className="mono">{record.engine_version}</dd>
            </div>
            <div>
              <dt>Workflow</dt>
              <dd className="mono">{record.execution?.workflow_version ?? DASH}</dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd className="tnum">{num(ledger.events.length)}</dd>
            </div>
          </dl>
        </div>
      </Panel>

      <Panel title="Policy without redeployment" meta="Amend a cutoff and judge the same evidence again">
        <div className="amend">
          <label className="amend__ctl">
            <span className="caps t3">FOIR ceiling</span>
            <input
              type="range"
              min="0.3"
              max="0.7"
              step="0.01"
              value={foir}
              onChange={(e) => setFoir(Number(e.target.value))}
            />
            <span className="tnum">
              {pct(foirRule?.threshold, 0)} → <strong>{pct(foir, 0)}</strong>
            </span>
          </label>

          <label className="amend__ctl">
            <span className="caps t3">LTV ceiling</span>
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.01"
              value={ltv}
              onChange={(e) => setLtv(Number(e.target.value))}
            />
            <span className="tnum">
              {pct(ltvRule?.threshold, 0)} → <strong>{pct(ltv, 0)}</strong>
            </span>
          </label>

          <CButton
            disabled={!amended || busy}
            onClick={() => onReplayAmended({ 'P-FOIR-01': foir, 'P-LTV-01': ltv })}
          >
            Replay against amended policy
          </CButton>
        </div>
        <p className="amend__note">
          Thresholds live in the policy document, not in code. The evidence is frozen; only the
          rulebook moves.
        </p>
      </Panel>

      {replays?.length ? (
        <Panel title="Replays" meta={`${num(replays.length)} runs`}>
          <ul className="replays">
            {replays.map((r, i) => (
              <ReplayRow key={`${r.ran_at}-${i}`} replay={r} />
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Execution trace" meta={`${num(ledger.events.length)} hash-chained events`}>
        <ol className="events">
          {ledger.events.map((e) => (
            <Event key={e.seq} event={e} />
          ))}
        </ol>
      </Panel>
    </>
  )
}
