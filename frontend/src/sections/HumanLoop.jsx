import { useRef } from 'react'
import { useInView, useReducedMotion } from 'framer-motion'
import { useSequence } from '../animations/hooks'
import { FadeIn, RevealLines } from '../components/Reveal'
import { IconCheck, SectionLabel, Status } from '../components/ui'
import './human.css'

// flag → review → attest → resume
const PHASES = ['flag', 'review', 'attest', 'resume']
const HOLDS = [2600, 3000, 1900, 3200]

const FLOW = [
  ['Low-confidence field', 'payout_wk29 scored 0.62 against a 0.85 threshold. The run pauses — nothing downstream sees the value.'],
  ['Human review', 'A credit officer sees the source crop, the candidates and the cross-references, and decides.'],
  ['Resume', 'The attested value is signed into the trail and the run continues exactly where it stopped.'],
]

export default function HumanLoop() {
  const ref = useRef(null)
  const inView = useInView(ref, { amount: 0.4 })
  const reduce = useReducedMotion()
  const [step] = useSequence(inView && !reduce, 4, HOLDS)
  const phase = reduce ? 'resume' : PHASES[step]
  const flowIdx = { flag: 0, review: 1, attest: 1, resume: 2 }[phase]
  const picked = phase !== 'flag'
  const signed = phase === 'attest' || phase === 'resume'

  return (
    <section className="human section" aria-labelledby="human-title">
      <div className="wrap">
        <div className="sec-head sec-head--split">
          <SectionLabel index="06">Human + AI</SectionLabel>
          <RevealLines
            as="h2"
            className="display-l"
            lines={[
              'WHEN CONFIDENCE',
              'DROPS,',
              <>
                RECALLER <span className="acc">ASKS.</span>
              </>,
            ]}
          />
          <FadeIn className="lede" delay={0.15}>
            <span id="human-title" hidden>
              When confidence drops, RECALLER asks.
            </span>
            Automation is not abdication. <strong>Any field below threshold pauses the run</strong> and routes
            to a credit officer with everything needed to decide — then resumes on their signed answer.
          </FadeIn>
        </div>

        <ol className="hflow">
          {FLOW.map(([t, d], i) => (
            <li key={t} className={`hflow__step${i === flowIdx ? ' is-active' : ''}${i < flowIdx ? ' is-past' : ''}`}>
              <span className="hflow__n">0{i + 1}</span>
              <p className="hflow__t">{t}</p>
              <p className="hflow__d">{d}</p>
            </li>
          ))}
        </ol>

        <div ref={ref} className={`review glass is-${phase}`} aria-label="Simulated officer review console" role="img">
          <header className="review__head">
            <div className="review__title">
              <span className="caps">Review required</span>
              <span className="caps t3">CR-2291 · stage 04 · confidence gate</span>
            </div>
            {phase === 'resume' ? (
              <Status kind="match">Resumed · 00:03:41</Status>
            ) : (
              <Status kind="advisory" pulse>
                Run paused
              </Status>
            )}
          </header>

          <div className="review__body">
            <figure className="crop">
              <figcaption className="caps t3">statement_apr-sep.pdf · p.9 · row 14</figcaption>
              <div className="crop__doc">
                <p className="t4">21 JUL · UPI CR · r•••@okaxis · 340.00</p>
                <p className="crop__hit">
                  22 JUL · NEFT CR · PLATFORM-A PAYOUT · <span className="crop__amt">4,?60.00</span>
                  <span className="crop__box" />
                </p>
                <p className="t4">22 JUL · UPI DR · CHARGING HUB · 186.00</p>
                <p className="t4">23 JUL · UPI CR · q•••@ybl · 120.00</p>
              </div>
              <div className="crop__meter">
                <span className="caps t3">Extraction confidence</span>
                <span className="crop__bar">
                  <i style={{ width: '62%' }} />
                  <b style={{ left: '85%' }} />
                </span>
                <span className="mono crop__val">0.62 / 0.85</span>
              </div>
            </figure>

            <div className="decide">
              <p className="caps t3">Field · payout_wk29</p>
              <ul className="cands">
                <li className={!picked ? 'is-lead' : ''}>
                  <span className="cands__radio" />
                  <span className="mono">₹4,860.00</span>
                  <span className="t3 mono">OCR · 0.62</span>
                </li>
                <li className={picked ? 'is-picked' : ''}>
                  <span className="cands__radio" />
                  <span className="mono">₹4,680.00</span>
                  <span className="t3 mono">OCR · 0.31</span>
                </li>
              </ul>
              <div className="xref">
                <span className="caps">Cross-reference</span>
                <p className="mono">
                  Bank credit 22 JUL · NEFT ₹4,680.00 <cite>E-07</cite>
                </p>
              </div>
              <div className="note">
                <span className="caps t3">Officer note</span>
                <p className="mono">
                  <span className="note__text">Matches bank credit on 22 Jul (E-07).</span>
                  <span className="note__caret" />
                </p>
              </div>
              <div className="review__actions">
                <span className={`rbtn rbtn--primary${signed ? ' is-pressed' : ''}`}>
                  {signed ? (
                    <>
                      <IconCheck /> Attested · O-112
                    </>
                  ) : (
                    'Confirm & resume'
                  )}
                </span>
                <span className="rbtn">Escalate</span>
              </div>
            </div>
          </div>

          <footer className="review__foot">
            <span className="review__track">
              {['Extraction', 'Reconciliation', 'Confidence', 'Credit analysis', 'Decision'].map((s, i) => (
                <span key={s} className={`rt${i < 2 || (i === 2 && phase === 'resume') ? ' is-done' : ''}${i === 2 && phase !== 'resume' ? ' is-hold' : ''}${i === 3 && phase === 'resume' ? ' is-run' : ''}`}>
                  {s}
                </span>
              ))}
            </span>
          </footer>
        </div>
      </div>
    </section>
  )
}
