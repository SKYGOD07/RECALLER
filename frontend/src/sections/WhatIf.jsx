import { useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { useSequence } from '../animations/hooks'
import { EASE } from '../animations/motion'
import { Counter } from '../components/Counter'
import { FadeIn, RevealLines } from '../components/Reveal'
import { IconArrow, SectionLabel } from '../components/ui'
import { REQUESTED } from '../data/case'
import './whatif.css'

const LIMIT = 45

// Precomputed outcomes for the illustrative case — the page does not calculate anything.
const LEVERS = [
  { id: 'loan', label: 'Loan size', from: '₹1,00,000', to: '₹97,000', delta: '−3% principal', emi: 4657.25, foir: 44.88, tag: 'Smallest change' },
  { id: 'tenure', label: 'Tenure', from: '24 months', to: '36 months', delta: '+12 months', emi: 3417.76, foir: 38.14, tag: 'Applicant’s choice' },
  { id: 'coapp', label: 'Co-applicant', from: 'None', to: '+₹9,000 / mo', delta: 'Income ₹27,400', emi: 4801.29, foir: 30.66, tag: 'Alternative' },
]

const HOLDS = [3600, 3600, 3600]
const pct = (v) => ((v - 25) / 35) * 100

export default function WhatIf() {
  const ref = useRef(null)
  const inView = useInView(ref, { amount: 0.4 })
  const reduce = useReducedMotion()
  const [manual, setManual] = useState(null)
  const [auto] = useSequence(inView && manual === null && !reduce, 3, HOLDS)
  const idx = manual ?? auto
  const lever = LEVERS[idx]

  return (
    <section className="whatif section" aria-labelledby="whatif-title">
      <div className="wrap">
        <div className="sec-head sec-head--split">
          <SectionLabel index="10">What-if</SectionLabel>
          <RevealLines
            className="display-l"
            lines={[
              'THE SMALLEST',
              'CHANGE THAT',
              <>
                CHANGES THE ANSWER<span className="acc">.</span>
              </>,
            ]}
          />
          <FadeIn className="lede" delay={0.15}>
            <span id="whatif-title" hidden>
              What-if: the smallest change that changes the answer.
            </span>
            A rejection shouldn’t be a dead end. RECALLER searches the policy boundary for the{' '}
            <strong>minimum adjustment that turns the decision</strong> — and shows the working for each option.
          </FadeIn>
        </div>

        <div className="wi glass" ref={ref}>
          <div className="wi__cols">
            <div className="wi__card wi__card--base">
              <p className="caps t3">Requested</p>
              <p className="wi__verdict wi__verdict--reject">REJECT</p>
              <dl className="wi__rows">
                <div>
                  <dt>Loan · tenure</dt>
                  <dd>₹1,00,000 · 24 mo</dd>
                </div>
                <div>
                  <dt>EMI</dt>
                  <dd>₹4,801.29</dd>
                </div>
                <div>
                  <dt>FOIR</dt>
                  <dd className="wi__bad">{REQUESTED.foir}%</dd>
                </div>
              </dl>
              <p className="wi__why">D-03 · FOIR above {LIMIT}% limit</p>
            </div>

            <div className="wi__levers">
              <div className="wi__tabs" role="tablist" aria-label="Adjustment">
                {LEVERS.map((l, i) => (
                  <button
                    key={l.id}
                    type="button"
                    role="tab"
                    aria-selected={i === idx}
                    className={i === idx ? 'is-on' : ''}
                    onClick={() => setManual(i)}
                  >
                    {l.label}
                    {i === idx && manual === null && !reduce && <motion.span className="wi__timer" key={`t-${idx}`} />}
                  </button>
                ))}
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={lever.id}
                  className="wi__change"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.45, ease: EASE }}
                >
                  <span className="wi__tag">{lever.tag}</span>
                  <p className="wi__from">{lever.from}</p>
                  <span className="wi__arrow">
                    <IconArrow />
                  </span>
                  <p className="wi__to">{lever.to}</p>
                  <p className="wi__delta">{lever.delta}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="wi__card wi__card--out">
              <p className="caps t3">Adjusted</p>
              <AnimatePresence mode="wait">
                <motion.p
                  key={lever.id}
                  className="wi__verdict wi__verdict--approve"
                  initial={{ opacity: 0, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, filter: 'blur(8px)' }}
                  transition={{ duration: 0.5, ease: EASE, delay: 0.15 }}
                >
                  APPROVE
                </motion.p>
              </AnimatePresence>
              <dl className="wi__rows">
                <div>
                  <dt>Change</dt>
                  <dd>{lever.to}</dd>
                </div>
                <div>
                  <dt>EMI</dt>
                  <dd>
                    <Counter value={lever.emi} from={4801.29} decimals={2} prefix="₹" duration={0.9} />
                  </dd>
                </div>
                <div>
                  <dt>FOIR</dt>
                  <dd className="acc">
                    <Counter value={lever.foir} from={REQUESTED.foir} decimals={2} suffix="%" duration={0.9} />
                  </dd>
                </div>
              </dl>
              <p className="wi__why">R-01 · FOIR within {LIMIT}% limit</p>
            </div>
          </div>

          <div className="wi__scale">
            <div className="wi__track">
              <span className="wi__ok" style={{ width: `${pct(LIMIT)}%` }} />
              <span className="wi__limit" style={{ left: `${pct(LIMIT)}%` }}>
                <b>limit {LIMIT}%</b>
              </span>
              <span className="wi__pt wi__pt--base" style={{ left: `${pct(REQUESTED.foir)}%` }} />
              <span className="wi__pt wi__pt--new" style={{ left: `${pct(lever.foir)}%` }} />
              <span
                className="wi__span"
                style={{ left: `${pct(lever.foir)}%`, width: `${pct(REQUESTED.foir) - pct(lever.foir)}%` }}
              />
            </div>
            <div className="wi__axis">
              <span>FOIR 25%</span>
              <span>60%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
