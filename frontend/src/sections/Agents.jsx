import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useInView, useMotionValueEvent, useScroll, useTransform } from 'framer-motion'
import { useMediaQuery } from '../animations/hooks'
import { FadeIn, RevealLines } from '../components/Reveal'
import { IconCheck, IconDoc, SectionLabel, Status } from '../components/ui'
import './agents.css'

const KIND = { agent: 'AI agent', gate: 'Gate', engine: 'Deterministic' }

export default function Agents() {
  const vertical = useMediaQuery('(max-width: 900px)')
  return (
    <section id="how" className="agents" aria-labelledby="agents-title">
      <div className="wrap agents__head">
        <div className="sec-head sec-head--split">
          <SectionLabel index="03">Agentic intelligence</SectionLabel>
          <RevealLines
            className="display-l"
            lines={[
              'SEVEN STAGES.',
              'ONE ACCOUNTABLE',
              <>
                DECISION<span className="acc">.</span>
              </>,
            ]}
          />
          <FadeIn className="lede" delay={0.15}>
            <span id="agents-title" hidden>
              Agentic intelligence: seven stages, one accountable decision.
            </span>
            Specialised agents do the reading. Deterministic services do the money.{' '}
            <strong>Every hand-off is typed, scored and logged</strong> — so the system can be trusted without being
            taken on faith.
          </FadeIn>
        </div>
      </div>
      {vertical ? <VerticalPipeline /> : <HorizontalPipeline />}
    </section>
  )
}

function HorizontalPipeline() {
  const sectionRef = useRef(null)
  const trackRef = useRef(null)
  const [dist, setDist] = useState(0)
  const [active, setActive] = useState(0)

  useLayoutEffect(() => {
    const measure = () => {
      if (!trackRef.current) return
      setDist(Math.max(0, trackRef.current.scrollWidth - document.documentElement.clientWidth))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(trackRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] })
  const x = useTransform(scrollYProgress, (v) => -v * dist)
  useMotionValueEvent(scrollYProgress, 'change', (v) => setActive(Math.min(7, Math.floor(v * 8))))

  return (
    <div className="pipeline" ref={sectionRef} style={{ height: `calc(${dist}px + 100svh)` }}>
      <div className="pipeline__sticky">
        <div className="wrap pipeline__bar">
          <span className="caps t3">Pipeline · CR-2291</span>
          <span className="pipeline__rail">
            <motion.span style={{ scaleX: scrollYProgress }} />
          </span>
          <span className="caps">
            <span className="acc">{String(Math.min(active + 1, 7)).padStart(2, '0')}</span>
            <span className="t3"> / 07</span>
          </span>
        </div>
        <motion.div className="track" ref={trackRef} style={{ x }}>
          <span className="track__wire">
            <motion.span style={{ scaleX: scrollYProgress }} />
          </span>
          {STAGES.map((s, i) => (
            <Module key={s.n} s={s} state={i < active ? 'done' : i === active ? 'running' : 'queued'} />
          ))}
        </motion.div>
      </div>
    </div>
  )
}

function VerticalPipeline() {
  return (
    <div className="wrap vpipe">
      {STAGES.map((s) => (
        <InViewModule key={s.n} s={s} />
      ))}
    </div>
  )
}

function InViewModule({ s }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, amount: 0.45 })
  return (
    <div ref={ref}>
      <Module s={s} state={inView ? 'done' : 'queued'} />
    </div>
  )
}

function Module({ s, state }) {
  const Viz = s.Viz
  return (
    <article className={`mod mod--${s.kind} is-${state}`}>
      <span className="mod__dot" aria-hidden="true" />
      <header className="mod__head">
        <span className="mod__n">{s.n}</span>
        <span className="mod__kind">{KIND[s.kind]}</span>
      </header>
      <h3 className="mod__title">{s.stage}</h3>
      <p className="mod__agent">{s.agent}</p>
      <div className="mod__viz" aria-hidden="true">
        <Viz />
      </div>
      <dl className="mod__io">
        <div>
          <dt>In</dt>
          <dd>{s.io[0]}</dd>
        </div>
        <div>
          <dt>Out</dt>
          <dd>{s.io[1]}</dd>
        </div>
      </dl>
      <footer className="mod__foot">
        <span className="mod__state">
          <i />
          {state === 'done' ? 'Complete' : state === 'running' ? 'Running' : 'Queued'}
        </span>
        <span>{s.time}</span>
      </footer>
    </article>
  )
}

/* ---------- stage micro-visuals ---------- */

const FILES = [
  ['kyc_aadhaar.pdf', '2p', 'KYC'],
  ['statement_apr-sep.pdf', '14p', 'BANK'],
  ['payouts_q2.csv', '3 src', 'EARN'],
  ['invoice_ev.jpg', '1p', 'INV'],
]
function DocsViz() {
  return (
    <ul className="vz-files">
      {FILES.map(([f, p, t], i) => (
        <li key={f} style={{ '--d': `${i * 0.1}s` }}>
          <IconDoc />
          <span className="vz-files__name">{f}</span>
          <span className="t3">{p}</span>
          <span className="vz-tag">{t}</span>
        </li>
      ))}
    </ul>
  )
}

const FIELDS = [
  ['applicant_name', 'ARJUN MEHRA', 0.99],
  ['pan', 'ABKPM••••K', 0.98],
  ['monthly_credits', '₹18,400', 0.93],
  ['payout_wk29', '₹4,?60', 0.62],
  ['on_road_price', '₹1,24,000', 0.97],
]
function ExtractViz() {
  return (
    <ul className="vz-fields">
      {FIELDS.map(([k, v, c], i) => (
        <li key={k} className={c < 0.85 ? 'is-low' : ''} style={{ '--d': `${i * 0.1}s` }}>
          <span className="vz-fields__k">{k}</span>
          <span className="vz-fields__v">{v}</span>
          <span className="vz-fields__bar">
            <i style={{ width: `${c * 100}%` }} />
          </span>
          <span className="vz-fields__c">{c.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  )
}

const PAIRS = [
  ['name ↔ holder', 'match', 'Matched'],
  ['address ↔ kyc', 'advisory', 'Advisory'],
  ['income ↔ credits', 'mismatch', 'Mismatch'],
  ['invoice ↔ quote', 'match', 'Matched'],
]
function ReconViz() {
  return (
    <ul className="vz-pairs">
      {PAIRS.map(([k, kind, label]) => (
        <li key={k}>
          <span>{k}</span>
          <Status kind={kind}>{label}</Status>
        </li>
      ))}
    </ul>
  )
}

const DOTS = [0.99, 0.98, 0.97, 0.96, 0.95, 0.93, 0.93, 0.91, 0.9, 0.88, 0.97, 0.62]
function ConfViz() {
  const pos = (c) => ((c - 0.5) / 0.5) * 100
  return (
    <div className="vz-conf">
      <div className="vz-conf__scale">
        <span className="vz-conf__zone" style={{ left: `${pos(0.85)}%` }} />
        <span className="vz-conf__th" style={{ left: `${pos(0.85)}%` }}>
          <b>0.85</b>
        </span>
        {DOTS.map((c, i) => (
          <i
            key={i}
            className={c < 0.85 ? 'is-low' : ''}
            style={{ left: `${pos(c)}%`, top: `${30 + ((i * 37) % 44)}%` }}
          />
        ))}
      </div>
      <div className="vz-conf__axis">
        <span>0.50</span>
        <span>0.75</span>
        <span>1.00</span>
      </div>
      <p className="vz-conf__note">
        <span className="vz-amber">payout_wk29 · 0.62</span> → officer review
      </p>
    </div>
  )
}

function EngineViz() {
  return (
    <div className="vz-engine">
      {[
        ['EMI', '₹3,417.76'],
        ['FOIR', '38.14%'],
        ['LTV', '80.65%'],
        ['OBLIGATIONS', '₹3,600'],
      ].map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
      <p className="vz-engine__note">No model in this path · reproducible</p>
    </div>
  )
}

const RULES = ['FOIR ≤ 45%', 'LTV ≤ 85%', 'Verified income ≥ ₹15,000', 'Field confidence ≥ 0.85', 'Tenure ≤ 36 months']
function PolicyViz() {
  return (
    <div className="vz-rules">
      <ul>
        {RULES.map((r) => (
          <li key={r}>
            <span className="vz-rules__ok">
              <IconCheck />
            </span>
            {r}
          </li>
        ))}
      </ul>
      <p className="vz-rules__out">
        <span className="t3">12 / 12 pass →</span> <b>APPROVE</b>
      </p>
    </div>
  )
}

function MemoViz() {
  return (
    <p className="vz-memo">
      Verified income of <b>₹18,400/mo</b> across three delivery platforms <cite>E-07</cite>
      <cite>E-09</cite>. Declared income exceeds verified by 16.4% <cite>E-03</cite>; the engine used verified
      figures. At 36 months FOIR is <b>38.1%</b> against a 45% limit <cite>C-02</cite>.
    </p>
  )
}

const STAGES = [
  { n: '01', stage: 'Documents', agent: 'Intake agent', kind: 'agent', io: ['4 files · 18 pages', 'Classified, de-duplicated'], time: '0.8s', Viz: DocsViz },
  { n: '02', stage: 'Extraction', agent: 'Extraction agent', kind: 'agent', io: ['18 pages', '38 typed fields'], time: '2.6s', Viz: ExtractViz },
  { n: '03', stage: 'Reconciliation', agent: 'Reconciliation agent', kind: 'agent', io: ['38 fields · 4 sources', '18 cross-checks'], time: '1.3s', Viz: ReconViz },
  { n: '04', stage: 'Confidence', agent: 'Confidence gate', kind: 'gate', io: ['38 scored fields', '1 routed to officer'], time: '0.1s', Viz: ConfViz },
  { n: '05', stage: 'Credit analysis', agent: 'Credit engine', kind: 'engine', io: ['Verified facts only', 'EMI · FOIR · LTV'], time: '0.03s', Viz: EngineViz },
  { n: '06', stage: 'Decision', agent: 'Policy engine', kind: 'engine', io: ['Policy v3.3 · 12 rules', 'Decision + reason codes'], time: '0.01s', Viz: PolicyViz },
  { n: '07', stage: 'Explanation', agent: 'Memo agent', kind: 'agent', io: ['Decision + evidence', 'Credit memo · 23 citations'], time: '3.1s', Viz: MemoViz },
]
