import { useRef } from 'react'
import { useInView, useReducedMotion } from 'framer-motion'
import { useSequence } from '../animations/hooks'
import { FadeIn, RevealLines } from '../components/Reveal'
import { IconCheck, SectionLabel } from '../components/ui'
import './orchestration.css'

// Workflow canvas in a 1200×420 space. Execution is a scripted replay, not a live run.
const W = 1200
const H = 420
const NW = 170
const NODES = [
  { id: 'trigger', x: 110, y: 80, label: 'Application in', kind: 'Webhook', ab: 'WH' },
  { id: 'intake', x: 330, y: 80, label: 'Intake', kind: 'Agent', ab: 'AI' },
  { id: 'extract', x: 550, y: 80, label: 'Extract', kind: 'Agent', ab: 'AI' },
  { id: 'recon', x: 770, y: 80, label: 'Reconcile', kind: 'Agent', ab: 'AI' },
  { id: 'gate', x: 990, y: 80, label: 'Confidence gate', kind: 'If · ≥ 0.85', ab: 'IF' },
  { id: 'wait', x: 990, y: 210, label: 'Officer review', kind: 'Wait · human', ab: 'HU' },
  { id: 'engine', x: 990, y: 340, label: 'Credit engine', kind: 'Code', ab: 'ƒx' },
  { id: 'policy', x: 770, y: 340, label: 'Policy v3.3', kind: 'Rules', ab: 'PL' },
  { id: 'memo', x: 550, y: 340, label: 'Credit memo', kind: 'Agent', ab: 'AI' },
  { id: 'record', x: 330, y: 340, label: 'Decision record', kind: 'Store', ab: 'DB' },
  { id: 'notify', x: 110, y: 340, label: 'Notify lender LOS', kind: 'HTTP', ab: '↗' },
]
const ORDER = NODES.map((n) => n.id)
const at = (id) => NODES.find((n) => n.id === id)
const hx = NW / 2

const EDGES = [
  ['trigger', 'intake'],
  ['intake', 'extract'],
  ['extract', 'recon'],
  ['recon', 'gate'],
  ['gate', 'wait', 'false · 1 field'],
  ['wait', 'engine'],
  ['engine', 'policy'],
  ['policy', 'memo'],
  ['memo', 'record'],
  ['record', 'notify'],
]

function edgePath(a, b) {
  const A = at(a)
  const B = at(b)
  if (A.y === B.y) {
    const dir = B.x > A.x ? 1 : -1
    return `M${A.x + dir * hx} ${A.y} L ${B.x - dir * hx} ${B.y}`
  }
  return `M${A.x} ${A.y + 29} L ${B.x} ${B.y - 29}`
}
// The branch this run did not take.
const TRUE_PATH = `M${990 + hx} 80 H 1160 V 340 H ${990 + hx}`

const WAIT_IDX = ORDER.indexOf('wait')
const HOLDS = ORDER.map((id) => (id === 'wait' ? 2800 : 620)).concat(2600)

const CAPS = [
  ['Durable executions', 'Every case is one workflow run with a persistent state.'],
  ['Pause & resume', 'Human steps wait for hours without holding anything open.'],
  ['Retries', 'A failed extraction retries without re-running what succeeded.'],
  ['Replay', 'Any run can be replayed from its log for audit.'],
]

export default function Orchestration() {
  const ref = useRef(null)
  const inView = useInView(ref, { amount: 0.35 })
  const reduce = useReducedMotion()
  const [seq] = useSequence(inView && !reduce, ORDER.length + 1, HOLDS)
  const step = reduce ? ORDER.length : seq
  const complete = step >= ORDER.length
  const current = NODES[step]

  const stateOf = (id) => {
    const i = ORDER.indexOf(id)
    if (i < step) return 'done'
    if (i === step) return id === 'wait' ? 'paused' : 'running'
    return 'idle'
  }

  const status = complete
    ? 'Complete · 3m 46s · 11 nodes'
    : step === WAIT_IDX
      ? 'Paused · awaiting officer'
      : step > WAIT_IDX
        ? `Resumed · ${current.label}`
        : `Running · ${current.label}`

  return (
    <section className="orch section" aria-labelledby="orch-title">
      <div className="wrap">
        <div className="sec-head sec-head--split">
          <SectionLabel index="12">Workflow infrastructure</SectionLabel>
          <RevealLines
            className="display-l"
            lines={[
              'ORCHESTRATED',
              <>
                INTELLIGENCE<span className="acc">.</span>
              </>,
            ]}
          />
          <FadeIn className="lede" delay={0.15}>
            <span id="orch-title" hidden>
              Orchestrated intelligence
            </span>
            Every case runs as a durable workflow — agents, engines and people as steps in one execution. Runs can
            pause for a human, resume hours later, retry a failed step and replay from the log.
            <span className="orch__powered">Workflow runtime built on n8n</span>
          </FadeIn>
        </div>

        <div className="orch__panel glass" ref={ref}>
          <div className="orch__bar">
            <span className="caps">Execution #58213</span>
            <span className={`orch__status${step === WAIT_IDX ? ' is-paused' : ''}${complete ? ' is-done' : ''}`}>
              <i />
              {status}
            </span>
            <span className="orch__keys">
              {['Pause', 'Resume', 'Retry', 'Replay'].map((k) => (
                <span key={k}>{k}</span>
              ))}
            </span>
          </div>

          <div className="orch__canvas" role="img" aria-label="Workflow execution: intake, extraction and reconciliation agents, a confidence gate that pauses for officer review, then credit engine, policy, memo and decision record.">
            <svg className="orch__edges" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              <path d={TRUE_PATH} className="oedge oedge--ghost" />
              {EDGES.map(([a, b]) => {
                const sa = stateOf(a)
                const sb = stateOf(b)
                const cls = sa === 'done' && sb === 'done' ? 'is-done' : sa === 'done' ? 'is-flow' : ''
                return <path key={`${a}-${b}`} d={edgePath(a, b)} className={`oedge ${cls}`} />
              })}
            </svg>
            <span className="oedge-label" style={{ left: `${(1000 / W) * 100}%`, top: `${(145 / H) * 100}%` }}>
              false · 1 field
            </span>
            <span className="oedge-label oedge-label--ghost" style={{ left: `${(1168 / W) * 100}%`, top: `${(205 / H) * 100}%` }}>
              true
            </span>

            {NODES.map((n) => {
              const s = stateOf(n.id)
              return (
                <div
                  key={n.id}
                  className={`onode is-${s}${n.kind === 'Agent' ? ' onode--agent' : ''}`}
                  style={{ left: `${(n.x / W) * 100}%`, top: `${(n.y / H) * 100}%`, width: `${(NW / W) * 100}%` }}
                >
                  <span className="onode__ic">{n.ab}</span>
                  <span className="onode__txt">
                    <span className="onode__label">{n.label}</span>
                    <span className="onode__kind">{n.kind}</span>
                  </span>
                  <span className="onode__st">{s === 'done' ? <IconCheck /> : <i />}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="orch__caps">
          {CAPS.map(([t, d], i) => (
            <FadeIn key={t} className="ocap" delay={i * 0.08}>
              <p className="ocap__t">{t}</p>
              <p className="ocap__d">{d}</p>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}
