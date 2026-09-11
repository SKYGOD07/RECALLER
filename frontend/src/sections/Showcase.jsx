import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { FadeIn, RevealLines } from '../components/Reveal'
import { IconCheck, SectionLabel, Status } from '../components/ui'
import { CASE, inr } from '../data/case'
import './showcase.css'

const DOCS = [
  ['KYC · Aadhaar, PAN', '2p'],
  ['Bank statement', '14p'],
  ['Platform payouts', '3 src'],
  ['Dealer invoice', '1p'],
]

const RECON = [
  ['Name ↔ account holder', 'match', 'Matched'],
  ['Address ↔ KYC', 'advisory', 'Advisory'],
  ['Declared ↔ verified income', 'mismatch', 'Mismatch'],
  ['Invoice ↔ on-road price', 'match', 'Matched'],
]

const TRAIL = [
  ['14:05:56.311', 'CALCULATION', 'engine 1.3.0'],
  ['14:05:56.319', 'POLICY', 'v3.3 · 12/12'],
  ['14:05:56.402', 'DECISION', 'APPROVE'],
  ['14:05:57.960', 'CREDIT MEMO', 'signed'],
]

const RAIL = ['cases', 'review', 'policy', 'audit', 'settings']

export default function Showcase() {
  const stageRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: stageRef, offset: ['start end', 'end start'] })
  const rotateX = useTransform(scrollYProgress, [0, 0.42], [18, 0])
  const scale = useTransform(scrollYProgress, [0, 0.42], [0.9, 1])
  const floatA = useTransform(scrollYProgress, [0.1, 0.9], [90, -90])
  const floatB = useTransform(scrollYProgress, [0.1, 0.9], [160, -60])

  const maxMonth = 24000

  return (
    <section id="product" className="showcase section" aria-labelledby="showcase-title">
      <div className="wrap">
        <div className="sec-head sec-head--split">
          <SectionLabel index="11">The console</SectionLabel>
          <RevealLines
            className="display-l"
            lines={[
              'ONE CASE.',
              'EVERY SIGNAL.',
              <>
                ONE SCREEN<span className="acc">.</span>
              </>,
            ]}
          />
          <FadeIn className="lede" delay={0.15}>
            <span id="showcase-title" hidden>
              The RECALLER console
            </span>
            The officer’s view of a finished case: applicant, asset, verified income, the engine’s figures, every
            reconciliation finding and the trail — <strong>on one surface, with nothing hidden behind a tab.</strong>
          </FadeIn>
        </div>
      </div>

      <div className="wrap showcase__stage" ref={stageRef}>
        <div className="showcase__glow" aria-hidden="true" />
        <motion.div
          className="console glass"
          style={{ rotateX, scale }}
          role="img"
          aria-label="Simulated RECALLER console showing case CR-2291 approved, with income, metrics, reconciliation and audit trail."
        >
          <div className="console__top">
            <span className="console__lights">
              <i />
              <i />
              <i />
            </span>
            <span className="console__crumb">
              RECALLER <span className="t4">/</span> Cases <span className="t4">/</span>{' '}
              <span className="t2">{CASE.id}</span>
            </span>
            <span className="console__search">Search cases, fields, citations</span>
            <span className="console__run">
              <span className="dot-live" /> Run 58213 · complete
            </span>
            <span className="console__user">O-112</span>
          </div>

          <div className="console__body">
            <aside className="console__rail">
              {RAIL.map((r, i) => (
                <span key={r} className={`rail-i${i === 0 ? ' is-on' : ''}`} title={r} />
              ))}
            </aside>

            <div className="cgrid">
              <div className="cp cp--app">
                <div className="cp__head">
                  <span>Applicant</span>
                  <span>{CASE.id}</span>
                </div>
                <div className="app">
                  <span className="app__avatar">{CASE.initials}</span>
                  <div>
                    <p className="app__name">{CASE.applicant}</p>
                    <p className="app__meta">{CASE.profile}</p>
                  </div>
                </div>
                <div className="app__tags">
                  <span>Thin-file</span>
                  <span>New to credit</span>
                  <span>EV · 2W</span>
                </div>
                <dl className="kv">
                  <div>
                    <dt>Bureau</dt>
                    <dd>1 tradeline</dd>
                  </div>
                  <div>
                    <dt>Vintage</dt>
                    <dd>11 mo</dd>
                  </div>
                  <div>
                    <dt>Platforms</dt>
                    <dd>3</dd>
                  </div>
                </dl>
              </div>

              <div className="cp cp--veh">
                <div className="cp__head">
                  <span>Vehicle</span>
                  <span>INV-24-08817</span>
                </div>
                <div className="veh">
                  <div>
                    <p className="veh__name">{CASE.vehicle}</p>
                    <dl className="kv kv--stack">
                      <div>
                        <dt>On-road</dt>
                        <dd>{inr(CASE.onRoad)}</dd>
                      </div>
                      <div>
                        <dt>Loan</dt>
                        <dd>{inr(CASE.loan)}</dd>
                      </div>
                    </dl>
                  </div>
                  <svg className="ring" viewBox="0 0 80 80" aria-hidden="true">
                    <circle cx="40" cy="40" r="32" className="ring__bg" />
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      className="ring__fg"
                      strokeDasharray={`${(CASE.ltv / 100) * 201} 201`}
                    />
                    <text x="40" y="39" className="ring__v">
                      {CASE.ltv}%
                    </text>
                    <text x="40" y="52" className="ring__k">
                      LTV
                    </text>
                  </svg>
                </div>
              </div>

              <div className="cp cp--dec">
                <div className="cp__head">
                  <span>Decision</span>
                  <span>
                    {CASE.policy} {CASE.policyVersion}
                  </span>
                </div>
                <p className="dec-v">APPROVE</p>
                <p className="dec-terms">
                  {inr(CASE.loan)} · {CASE.tenure} mo · {CASE.rate.toFixed(1)}% p.a.
                </p>
                <div className="dec-meta">
                  <span>
                    Confidence <b>{CASE.confidence}</b>
                  </span>
                  <Status kind="advisory">1 field attested</Status>
                </div>
              </div>

              <div className="cp cp--inc">
                <div className="cp__head">
                  <span>Verified income</span>
                  <span>6 months · bank + platforms</span>
                </div>
                <div className="inc">
                  <p className="inc__v">
                    {inr(CASE.verifiedIncome)}
                    <span> / mo</span>
                  </p>
                  <div className="inc__chart">
                    <span className="inc__line inc__line--decl" style={{ bottom: `${(CASE.declaredIncome / maxMonth) * 100}%` }}>
                      <b>declared ₹22,000</b>
                    </span>
                    <span className="inc__line" style={{ bottom: `${(CASE.verifiedIncome / maxMonth) * 100}%` }} />
                    {CASE.incomeMonths.map(([m, v]) => (
                      <div key={m} className="inc__col">
                        <span className="inc__bar" style={{ height: `${(v / maxMonth) * 100}%` }} />
                        <span className="inc__m">{m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="cp cp--met">
                <div className="cp__head">
                  <span>Engine</span>
                  <span>deterministic</span>
                </div>
                <div className="met">
                  <div>
                    <span className="met__k">EMI</span>
                    <span className="met__v">{inr(CASE.emi, 2)}</span>
                  </div>
                  <div>
                    <span className="met__k">FOIR</span>
                    <span className="met__v acc">{CASE.foir}%</span>
                    <span className="met__bar">
                      <i style={{ width: `${(CASE.foir / 60) * 100}%` }} />
                      <b style={{ left: `${(45 / 60) * 100}%` }} />
                    </span>
                  </div>
                  <div>
                    <span className="met__k">LTV</span>
                    <span className="met__v">{CASE.ltv}%</span>
                    <span className="met__bar">
                      <i style={{ width: `${CASE.ltv}%` }} />
                      <b style={{ left: '85%' }} />
                    </span>
                  </div>
                </div>
              </div>

              <div className="cp cp--docs">
                <div className="cp__head">
                  <span>Documents</span>
                  <span>4 / 4</span>
                </div>
                <ul className="docs">
                  {DOCS.map(([d, p]) => (
                    <li key={d}>
                      <span className="docs__ok">
                        <IconCheck />
                      </span>
                      <span>{d}</span>
                      <span className="t4">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="cp cp--rec">
                <div className="cp__head">
                  <span>Reconciliation</span>
                  <span>14 · 3 · 1 · 0</span>
                </div>
                <ul className="crec">
                  {RECON.map(([k, kind, label]) => (
                    <li key={k}>
                      <span>{k}</span>
                      <Status kind={kind}>{label}</Status>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="cp cp--aud">
                <div className="cp__head">
                  <span>Audit trail</span>
                  <span>{CASE.trace}</span>
                </div>
                <ul className="caud">
                  {TRAIL.map(([t, s, r]) => (
                    <li key={t}>
                      <span className="t4">{t}</span>
                      <span>{s}</span>
                      <span className="caud__r">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div className="float float--memo glass" style={{ y: floatA }} aria-hidden="true">
          <p className="float__k">Credit memo · excerpt</p>
          <p className="float__memo">
            Verified income of <b>₹18,400/mo</b> across three platforms <cite>E-07</cite>
            <cite>E-09</cite>. FOIR <b>38.1%</b> at 36 months against a 45% limit <cite>C-02</cite>.
          </p>
        </motion.div>

        <motion.div className="float float--codes glass" style={{ y: floatB }} aria-hidden="true">
          <p className="float__k">Reason codes</p>
          {CASE.reasons.map((r) => (
            <p key={r.code} className="float__code">
              <span className={`code-chip${r.kind === 'advisory' ? ' code-chip--adv' : ''}`}>{r.code}</span>
              {r.text}
            </p>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
