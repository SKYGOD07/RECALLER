import { useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { useSequence } from '../animations/hooks'
import { EASE } from '../animations/motion'
import { FadeIn, RevealLines } from '../components/Reveal'
import { SectionLabel, Status } from '../components/ui'
import './reconciliation.css'

const DOCS = [
  {
    id: 'kyc',
    code: 'D1',
    name: 'KYC',
    meta: 'Aadhaar · PAN',
    fields: [
      ['Name', 'ARJUN MEHRA'],
      ['Address', 'Flat 12, Kothrud, Pune 411038'],
    ],
  },
  {
    id: 'bank',
    code: 'D2',
    name: 'Bank statement',
    meta: '6 months · 14 pages',
    fields: [
      ['Account holder', 'ARJUN S MEHRA'],
      ['Verified credits', '₹18,400 / mo'],
    ],
  },
  {
    id: 'earn',
    code: 'D3',
    name: 'Platform earnings',
    meta: '3 platforms · 26 weeks',
    fields: [
      ['Payee', 'ARJUN MEHRA'],
      ['Weekly average', '₹4,420'],
    ],
  },
  {
    id: 'inv',
    code: 'D4',
    name: 'Dealer invoice',
    meta: 'INV-24-08817',
    fields: [
      ['Buyer address', 'Kothrud, Pune 411038'],
      ['Invoice amount', '₹1,24,000'],
    ],
  },
]

const CHECKS = [
  {
    a: ['D2', 'Account holder', 'ARJUN S MEHRA'],
    b: ['D1', 'Name', 'ARJUN MEHRA'],
    kind: 'match',
    status: 'Matched',
    note: 'Middle initial only · similarity 0.96',
    docs: ['bank', 'kyc'],
  },
  {
    a: ['D4', 'Address', 'Kothrud, Pune 411038'],
    b: ['D1', 'Address', 'Flat 12, Kothrud, Pune 411038'],
    kind: 'advisory',
    status: 'Advisory',
    note: 'Locality and PIN agree · flat number absent',
    docs: ['inv', 'kyc'],
  },
  {
    a: ['APP', 'Declared income', '₹22,000 / mo'],
    b: ['D2', 'Verified credits', '₹18,400 / mo'],
    kind: 'mismatch',
    status: 'Mismatch',
    note: '−16.4% · engine uses the verified figure',
    docs: ['bank', 'earn'],
  },
  {
    a: ['D4', 'Invoice amount', '₹1,24,000'],
    b: ['REF', 'On-road price', '₹1,24,000'],
    kind: 'match',
    status: 'Matched',
    note: 'OEM price list · Δ ₹0',
    docs: ['inv'],
  },
]

const LEGEND = [
  ['match', 'Matched', 14, 'Fields agree within tolerance.'],
  ['advisory', 'Advisory', 3, 'Minor variance, noted in the memo.'],
  ['mismatch', 'Mismatch', 1, 'Material variance, resolved by rule.'],
  ['blocking', 'Blocking', 0, 'Halts the run until an officer resolves it.'],
]

const HOLDS = [900, 800, 800, 800, 800]

export default function Reconciliation() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, amount: 0.35 })
  const reduce = useReducedMotion()
  const [step] = useSequence(inView && !reduce, 5, HOLDS, { loop: false })
  const resolved = reduce ? 5 : step
  const [hover, setHover] = useState(null)
  const linked = hover === null ? [] : CHECKS[hover].docs

  return (
    <section className="recon section" aria-labelledby="recon-title">
      <div className="wrap">
        <div className="sec-head sec-head--split">
          <SectionLabel index="05">Cross-document reconciliation</SectionLabel>
          <RevealLines
            className="display-l"
            lines={[
              'FOUR DOCUMENTS.',
              'ONE VERSION',
              <>
                OF THE TRUTH<span className="acc">.</span>
              </>,
            ]}
          />
          <FadeIn className="lede" delay={0.15}>
            <span id="recon-title" hidden>
              Cross-document reconciliation
            </span>
            Every extracted field is checked against every other source that claims to know it.{' '}
            <strong>Agreement raises confidence. Disagreement becomes a finding</strong> — graded, explained and
            carried into the decision.
          </FadeIn>
        </div>

        <div className="recon__board" ref={ref}>
          <div className="recon__docs">
            {DOCS.map((d, i) => (
              <motion.article
                key={d.id}
                className={`rdoc glass${linked.includes(d.id) ? ' is-linked' : ''}`}
                initial={{ opacity: 0, y: 24 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.9, ease: EASE, delay: i * 0.08 }}
              >
                <header className="rdoc__head">
                  <span className="rdoc__code">{d.code}</span>
                  <span className="rdoc__meta">{d.meta}</span>
                </header>
                <h3 className="rdoc__name">{d.name}</h3>
                <dl className="rdoc__fields">
                  {d.fields.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </motion.article>
            ))}
          </div>

          <div className="recon__ledger glass">
            <div className="panel__head">
              <span>Reconciliation · CR-2291</span>
              <span>{Math.min(resolved, 4)} / 4 shown · 18 checks</span>
            </div>
            <ul>
              {CHECKS.map((c, i) => {
                const done = resolved > i
                return (
                  <li
                    key={i}
                    className={`rrow${done ? ' is-done' : ''}${hover === i ? ' is-hover' : ''}`}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                  >
                    <Field f={c.a} />
                    <div className="rrow__link">
                      <span className="rrow__line" />
                      <span className="rrow__status">
                        {done ? (
                          <Status kind={c.kind}>{c.status}</Status>
                        ) : (
                          <Status pulse>Checking</Status>
                        )}
                      </span>
                    </div>
                    <Field f={c.b} right />
                    <p className="rrow__note">{done ? c.note : '—'}</p>
                  </li>
                )
              })}
            </ul>
            <div className="recon__legend">
              {LEGEND.map(([kind, label, n, text]) => (
                <div key={kind} className={`lg lg--${kind}`}>
                  <span className="lg__n">{n}</span>
                  <Status kind={kind}>{label}</Status>
                  <p className="lg__t">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Field({ f: [src, label, value], right }) {
  return (
    <div className={`rfield${right ? ' rfield--r' : ''}`}>
      <span className="rfield__meta">
        <b>{src}</b> {label}
      </span>
      <span className="rfield__v">{value}</span>
    </div>
  )
}
