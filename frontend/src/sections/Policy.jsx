import { useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { useSequence } from '../animations/hooks'
import { EASE } from '../animations/motion'
import { Counter } from '../components/Counter'
import { FadeIn, RevealLines } from '../components/Reveal'
import { SectionLabel } from '../components/ui'
import { REQUESTED } from '../data/case'
import './policy.css'

const VERSIONS = [
  { tag: 'v3.2', maxFoir: 50 },
  { tag: 'v3.3', maxFoir: 45 },
]

const PARAMS = [
  ['Max LTV', '85%', 85, 60, 100],
  ['Min verified income', '₹15,000', 15, 5, 40],
  ['Min field confidence', '0.85', 85, 50, 100],
  ['Max tenure', '36 mo', 36, 12, 60],
]

// A stable, illustrative queue of 120 applications — FOIR spread between 20% and 58%.
const QUEUE = (() => {
  let s = 7
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  return Array.from({ length: 120 }, () => 20 + rnd() * 38)
})()

const HOLDS = [3400, 4200]
const pct = (v, lo = 30, hi = 60) => ((v - lo) / (hi - lo)) * 100

export default function Policy() {
  const ref = useRef(null)
  const inView = useInView(ref, { amount: 0.4 })
  const reduce = useReducedMotion()
  const [manual, setManual] = useState(null)
  const [auto] = useSequence(inView && manual === null && !reduce, 2, HOLDS)
  const v = manual ?? (reduce ? 1 : auto)
  const { maxFoir, tag } = VERSIONS[v]
  const passes = REQUESTED.foir <= maxFoir
  const passing = QUEUE.filter((f) => f <= maxFoir).length

  return (
    <section className="policy section" aria-labelledby="policy-title">
      <div className="wrap">
        <div className="sec-head sec-head--split">
          <SectionLabel index="07">Policy as infrastructure</SectionLabel>
          <RevealLines
            className="display-l"
            lines={[
              'POLICY CHANGES.',
              <>
                CODE DOESN’T <span className="t3">HAVE TO.</span>
              </>,
            ]}
          />
          <FadeIn className="lede" delay={0.15}>
            <span id="policy-title" hidden>
              Policy changes. Code doesn’t have to.
            </span>
            Credit policy lives as versioned configuration, not buried logic. Tighten a threshold and{' '}
            <strong>every decision re-evaluates against the new version</strong> — with the version stamped on
            the record.
          </FadeIn>
        </div>

        <div className="policy__board" ref={ref}>
          <div className="pconf glass">
            <div className="panel__head">
              <span>Policy · EV-2W-THINFILE</span>
              <div className="seg" role="group" aria-label="Policy version">
                {VERSIONS.map((ver, i) => (
                  <button
                    key={ver.tag}
                    type="button"
                    className={i === v ? 'is-on' : ''}
                    aria-pressed={i === v}
                    onClick={() => setManual(i)}
                  >
                    {ver.tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="pparam is-edited">
              <div className="pparam__top">
                <span>Max FOIR</span>
                <span className="pparam__val">
                  <Counter value={maxFoir} from={50} duration={1} suffix="%" />
                </span>
              </div>
              <div className="slider">
                <span className="slider__fill" style={{ width: `${pct(maxFoir)}%` }} />
                <span className="slider__knob" style={{ left: `${pct(maxFoir)}%` }} />
              </div>
              <div className="slider__axis">
                <span>30%</span>
                <span>60%</span>
              </div>
            </div>

            {PARAMS.map(([k, label, val, lo, hi]) => (
              <div className="pparam" key={k}>
                <div className="pparam__top">
                  <span>{k}</span>
                  <span className="pparam__val">{label}</span>
                </div>
                <div className="slider">
                  <span className="slider__fill" style={{ width: `${pct(val, lo, hi)}%` }} />
                  <span className="slider__knob" style={{ left: `${pct(val, lo, hi)}%` }} />
                </div>
              </div>
            ))}

            <div className="pdiff" aria-live="polite">
              <p className="pdiff__del">− max_foir: 0.50</p>
              <p className={`pdiff__add${v === 1 ? ' is-on' : ''}`}>+ max_foir: 0.45</p>
              <p className="pdiff__meta">
                {tag} · published by credit-policy · no deployment
              </p>
            </div>
          </div>

          <div className="penv">
            <div className="papp glass">
              <div className="panel__head">
                <span>CR-2291 · requested</span>
                <span>
                  ₹1,00,000 · {REQUESTED.tenure} mo
                </span>
              </div>
              <div className="papp__body">
                <div className="papp__row">
                  <div>
                    <p className="caps t3">Applicant FOIR</p>
                    <p className={`papp__foir${passes ? '' : ' is-fail'}`}>{REQUESTED.foir}%</p>
                  </div>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={passes ? 'a' : 'r'}
                      className={`verdict ${passes ? 'verdict--approve' : 'verdict--reject'}`}
                      initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
                      transition={{ duration: 0.5, ease: EASE }}
                    >
                      {passes ? 'APPROVE' : 'REJECT'}
                    </motion.span>
                  </AnimatePresence>
                </div>

                <div className="scale">
                  <span className="scale__ok" style={{ width: `${pct(maxFoir)}%` }} />
                  <span className="scale__limit" style={{ left: `${pct(maxFoir)}%` }}>
                    <b>limit {maxFoir}%</b>
                  </span>
                  <span className={`scale__me${passes ? '' : ' is-fail'}`} style={{ left: `${pct(REQUESTED.foir)}%` }} />
                </div>
                <div className="slider__axis">
                  <span>30%</span>
                  <span>45%</span>
                  <span>60%</span>
                </div>
                <p className="papp__why mono">
                  {passes
                    ? `R-01 · FOIR ${REQUESTED.foir}% ≤ ${maxFoir}% · policy ${tag}`
                    : `D-03 · FOIR ${REQUESTED.foir}% > ${maxFoir}% · policy ${tag}`}
                </p>
              </div>
            </div>

            <div className="pqueue glass">
              <div className="panel__head">
                <span>Pipeline re-evaluated · illustrative</span>
                <span>
                  <Counter value={passing} from={passing} duration={0.9} className="acc" /> / 120 pass
                </span>
              </div>
              <div className="pqueue__grid" aria-hidden="true">
                {QUEUE.map((f, i) => (
                  <i
                    key={i}
                    className={f <= maxFoir ? 'is-pass' : f <= 50 ? 'is-flip' : ''}
                    style={{ transitionDelay: `${(i % 20) * 12}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
