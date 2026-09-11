import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { lerpRange } from '../animations/motion'
import { SectionLabel } from '../components/ui'
import './idea.css'

const PHRASES = [
  ['READ', 'THE EVIDENCE.'],
  ['RECONCILE', 'THE SIGNAL.'],
  ['COMPUTE', 'THE RISK.'],
  ['EXPLAIN', 'THE DECISION.'],
]

// Scroll windows (0–1) shared by the copy and the diagram so they light up together.
const AT = [0.06, 0.23, 0.4, 0.57]
const SPAN = 0.07

const SOURCES = [
  ['KYC', 60],
  ['BANK', 180],
  ['EARNINGS', 300],
  ['INVOICE', 420],
]
const EV = { x: 240, y: 300 }
const CHIPS = [
  ['EMI', 70, 262],
  ['FOIR', 70, 338],
  ['LTV', 410, 262],
  ['OBLIG.', 410, 338],
]

export default function Idea() {
  const ref = useRef(null)
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] })

  return (
    <section className="idea" ref={ref} aria-labelledby="idea-title">
      <div className="idea__sticky">
        <div className="wrap idea__grid">
          <div className="idea__copy">
            <SectionLabel index="02">The RECALLER idea</SectionLabel>
            <p className="lede idea__intro">
              Fragmented evidence in. <strong>One defensible credit decision out.</strong>
            </p>
            <h2 id="idea-title" className="idea__lines">
              {PHRASES.map(([verb, rest], i) => (
                <Phrase key={verb} p={p} i={i} verb={verb} rest={rest} />
              ))}
            </h2>
          </div>
          <Convergence p={p} />
        </div>
      </div>
    </section>
  )
}

function Phrase({ p, i, verb, rest }) {
  const opacity = useTransform(p, lerpRange(AT[i], AT[i] + SPAN, 0.12, 1))
  const x = useTransform(p, lerpRange(AT[i], AT[i] + SPAN, -18, 0))
  return (
    <motion.span className="idea__line" style={{ opacity, x }}>
      <span className="idea__num">0{i + 1}</span>
      <span>
        {verb} <span className="t2">{rest}</span>
      </span>
    </motion.span>
  )
}

function useLit(p, at) {
  return useTransform(p, lerpRange(at, at + SPAN, 0.22, 1))
}

function Convergence({ p }) {
  const srcLit = useLit(p, AT[0])
  const wires = useTransform(p, lerpRange(AT[1] - 0.03, AT[1] + SPAN + 0.03, 0, 1))
  const evLit = useLit(p, AT[1] + 0.06)
  const chips = useTransform(p, lerpRange(AT[2], AT[2] + SPAN, 0, 1))
  const decWire = useTransform(p, lerpRange(AT[3] - 0.02, AT[3] + 0.04, 0, 1))
  const decLit = useLit(p, AT[3] + 0.03)
  const caption = useTransform(p, lerpRange(AT[3] + 0.06, AT[3] + 0.13, 0, 1))

  return (
    <div className="convergence" aria-hidden="true">
      <svg viewBox="0 0 480 600" className="convergence__svg">
        {/* source → evidence wires */}
        {SOURCES.map(([label, x]) => {
          const d = `M${x} 92 C ${x} 190, ${EV.x} 170, ${EV.x} ${EV.y - 54}`
          return (
            <g key={label}>
              <path d={d} className="cv-wire-base" />
              <motion.path d={d} className="cv-wire" style={{ pathLength: wires }} />
            </g>
          )
        })}

        {/* sources */}
        <motion.g style={{ opacity: srcLit }}>
          {SOURCES.map(([label, x]) => (
            <g key={label}>
              <rect x={x - 50} y={50} width="100" height="42" rx="10" className="cv-node" />
              <text x={x} y={76} className="cv-text">
                {label}
              </text>
            </g>
          ))}
        </motion.g>

        {/* evidence core */}
        <motion.g style={{ opacity: evLit }}>
          <circle cx={EV.x} cy={EV.y} r="78" className="cv-orbit" />
          <circle cx={EV.x} cy={EV.y} r="54" className="cv-core" />
          <text x={EV.x} y={EV.y - 4} className="cv-text cv-text--lg">
            EVIDENCE
          </text>
          <text x={EV.x} y={EV.y + 16} className="cv-sub">
            23 citations
          </text>
        </motion.g>

        {/* deterministic computations */}
        <motion.g style={{ opacity: chips }}>
          {CHIPS.map(([label, x, y]) => (
            <g key={label}>
              <line x1={x < EV.x ? x + 36 : x - 36} y1={y} x2={x < EV.x ? EV.x - 60 : EV.x + 60} y2={EV.y} className="cv-tick" />
              <rect x={x - 36} y={y - 15} width="72" height="30" rx="8" className="cv-chip" />
              <text x={x} y={y + 4} className="cv-chip-text">
                {label}
              </text>
            </g>
          ))}
        </motion.g>

        {/* decision */}
        <path d={`M${EV.x} ${EV.y + 54} L ${EV.x} 486`} className="cv-wire-base" />
        <motion.path d={`M${EV.x} ${EV.y + 54} L ${EV.x} 486`} className="cv-wire cv-wire--hot" style={{ pathLength: decWire }} />
        <motion.g style={{ opacity: decLit }}>
          <rect x={EV.x - 96} y={486} width="192" height="58" rx="14" className="cv-decision" />
          <text x={EV.x} y={520} className="cv-text cv-text--lg cv-text--acc">
            DECISION
          </text>
        </motion.g>
        <motion.text x={EV.x} y={574} className="cv-sub" style={{ opacity: caption }}>
          APPROVE · reason-coded · explained
        </motion.text>
      </svg>
    </div>
  )
}
