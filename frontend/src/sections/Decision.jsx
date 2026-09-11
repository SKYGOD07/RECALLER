import { useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useMotionValueEvent, useScroll } from 'framer-motion'
import { useMediaQuery, useSequence } from '../animations/hooks'
import { EASE } from '../animations/motion'
import { SectionLabel } from '../components/ui'
import './decision.css'

const WORDS = [
  ['APPROVE', 'Selected · 12 / 12 rules'],
  ['REFER', 'Not required'],
  ['REJECT', 'No limit breached'],
]

const DOSSIER = [
  {
    k: 'Reason codes',
    rows: [
      ['R-01', 'FOIR 38.1% ≤ 45.0%'],
      ['R-04', 'Income · 3 sources'],
      ['A-02', 'Declared −16.4%'],
    ],
  },
  { k: 'Evidence', big: '23', unit: 'citations', rows: [['Documents', '4'], ['Pages', '18']] },
  {
    k: 'Calculations',
    rows: [
      ['EMI', '₹3,417.76'],
      ['FOIR', '38.14%'],
      ['LTV', '80.65%'],
    ],
  },
  { k: 'Policy', big: 'v3.3', unit: 'EV-2W-THINFILE', rows: [['Rules', '12 / 12 pass']] },
  {
    k: 'Trace',
    rows: [
      ['ID', 'trc_7f3a91c2'],
      ['Events', '10'],
      ['Hash', 'e41b…09'],
    ],
  },
]

// stage: 0 idle · 1 evaluating REJECT · 2 evaluating REFER · 3 APPROVE settles · 4 dossier
const toStage = (v) => (v < 0.14 ? 0 : v < 0.28 ? 1 : v < 0.42 ? 2 : v < 0.56 ? 3 : 4)
const LIT = [-1, 2, 1, 0, 0]
const SEQ = [500, 900, 900, 1000, 1000]

export default function Decision() {
  const compact = useMediaQuery('(max-width: 900px)')
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [scrollStage, setScrollStage] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (v) => setScrollStage(toStage(v)))
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const [seqStage] = useSequence(compact && inView, 5, SEQ, { loop: false })

  const stage = compact ? seqStage : scrollStage
  const lit = LIT[stage]
  const settled = stage >= 3

  return (
    <section className="dec" ref={ref} aria-labelledby="dec-title">
      <div className="dec__sticky">
        <div className="wrap dec__inner">
          <div className="dec__top">
            <SectionLabel index="08">The decision</SectionLabel>
            <span className="caps t3">CR-2291 · policy v3.3</span>
          </div>
          <h2 id="dec-title" className="dec__words">
            <span className="sr-only">Decision: approve. </span>
            {WORDS.map(([w, note], i) => {
              const win = settled && i === 0
              const out = settled && i !== 0
              return (
                <span
                  key={w}
                  className={`dword${lit === i ? ' is-lit' : ''}${win ? ' is-win' : ''}${out ? ' is-out' : ''}`}
                  aria-hidden="true"
                >
                  <span className="dword__idx">0{i + 1}</span>
                  <span className="dword__w">{w}</span>
                  <span className="dword__note">{lit === i && !settled ? 'Evaluating…' : settled ? note : ''}</span>
                  <span className="dword__scan" />
                </span>
              )
            })}
          </h2>

          <AnimatePresence>
            {stage >= 4 && (
              <motion.div
                className="dec__dossier"
                initial="hidden"
                animate="show"
                exit="hidden"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
              >
                {DOSSIER.map((d) => (
                  <motion.div
                    key={d.k}
                    className="dcard glass"
                    variants={{
                      hidden: { opacity: 0, y: 24, transition: { duration: 0.3 } },
                      show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
                    }}
                  >
                    <p className="dcard__k">{d.k}</p>
                    {d.big && (
                      <p className="dcard__big">
                        {d.big} <span>{d.unit}</span>
                      </p>
                    )}
                    <dl className="dcard__rows">
                      {d.rows.map(([a, b]) => (
                        <div key={a}>
                          <dt>{a}</dt>
                          <dd>{b}</dd>
                        </div>
                      ))}
                    </dl>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}
