import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE } from '../animations/motion'
import { useReveal } from '../animations/useGsap'
import { REFERRED } from '../data/live'
import { inr, pct } from '../lib/format'
import './editorial.css'

/**
 * "What if the decision could move?"
 *
 * The baseline and the solved scenario are both engine output for
 * RCL-2026-0437: referred on asset cover, and the smallest change that clears
 * it. Moving the control re-reads the second set of figures — it does not
 * compute them. Framer handles the number swap; GSAP handles the entrance.
 */
export default function Movement() {
  const [solved, setSolved] = useState(false)
  const scope = useReveal('[data-reveal]', { y: 36, stagger: 0.08 })
  const w = REFERRED.whatIf

  const view = solved
    ? { decision: w.decision, amount: w.to, emi: w.emi, foir: w.foir, ltv: w.ltv }
    : { decision: REFERRED.decision, amount: REFERRED.amount, emi: REFERRED.emi, foir: REFERRED.foir, ltv: REFERRED.ltv }

  const rows = [
    ['Sanctioned', inr(view.amount)],
    ['EMI', inr(view.emi, { decimals: 2 })],
    ['FOIR', pct(view.foir)],
    ['LTV', pct(view.ltv)],
  ]

  return (
    <section className="ed ed--light" data-tone="light" ref={scope} aria-labelledby="ed-move">
      <div className="wrap">
        <header className="ed__head ed__head--split">
          <div>
            <p className="eyebrow" data-reveal>
              What-if
            </p>
            <h2 className="statement" id="ed-move" data-reveal>
              Do not just decline. Find the path<em>.</em>
            </h2>
          </div>
          <p className="measure measure--tight" data-reveal>
            A referral is not an answer. The solver asks the engine for the smallest change that reaches
            approval, and reports the one that disturbs the borrower least — or says plainly that no single
            change is enough.
          </p>
        </header>

        <div className="move" data-reveal>
          <div className="move__panel">
            <div className="move__bar">
              <span className="mono">{REFERRED.id}</span>
              <span>{REFERRED.borrower}</span>
              <span className="mono">{REFERRED.asset}</span>
            </div>

            <div className={`move__verdict move__verdict--${view.decision.toLowerCase()}`}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.strong
                  key={view.decision}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.45, ease: EASE }}
                >
                  {view.decision}
                </motion.strong>
              </AnimatePresence>
              <span className="move__reason">
                {solved ? 'Within policy on every rule' : `${REFERRED.code.code} · ${REFERRED.code.text}`}
              </span>
            </div>

            <dl className="move__metrics">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.dd
                      key={`${k}-${v}`}
                      className="tnum"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.35, ease: EASE }}
                    >
                      {v}
                    </motion.dd>
                  </AnimatePresence>
                </div>
              ))}
            </dl>
          </div>

          <div className="move__control">
            <p className="move__lever">{w.lever}</p>
            <p className="move__text">{w.text}</p>

            <div className="move__track" role="group" aria-label="Scenario">
              <button
                type="button"
                className={`move__step${solved ? '' : ' is-active'}`}
                aria-pressed={!solved}
                onClick={() => setSolved(false)}
              >
                <span className="tnum">{inr(w.from)}</span>
                As requested
              </button>
              <span className="move__rail" aria-hidden="true" />
              <button
                type="button"
                className={`move__step${solved ? ' is-active' : ''}`}
                aria-pressed={solved}
                onClick={() => setSolved(true)}
              >
                <span className="tnum">{inr(w.to)}</span>
                Solver result
              </button>
            </div>

            <p className="move__note">
              Both states are engine output. The console runs this live against the same policy.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
