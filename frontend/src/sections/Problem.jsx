import { useRef, useState } from 'react'
import { motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion'
import { EASE } from '../animations/motion'
import { Counter } from '../components/Counter'
import { FadeIn, RevealLines } from '../components/Reveal'
import { SectionLabel } from '../components/ui'
import './problem.css'

const PERSONAS = ['First-time borrowers', 'Gig workers', 'EV drivers', 'Small fleet owners', 'UPI-first earners', 'New to credit']

const STATS = [
  { value: 0, label: 'Salary slips', note: 'No employer. No payroll.' },
  { value: 1, label: 'Bureau tradeline', note: 'A phone EMI, eleven months old.' },
  { value: 412, label: 'UPI credits · 90 days', note: 'Small, frequent, verifiable.', acc: true },
  { value: 3, label: 'Earning platforms', note: 'Weekly payouts. Uneven weeks.' },
]

const STEPS = [
  { k: 'Salary slip', body: 'Employer, designation, gross pay. The document credit expects — and for this borrower, it does not exist.' },
  { k: 'UPI settlements', body: 'Hundreds of small credits: customer tips, cash-on-delivery top-ups, transfers. Each one timestamped.' },
  { k: 'Platform earnings', body: 'Weekly payouts from three delivery platforms. Uneven week to week, stable month to month.' },
  { k: 'Bank transactions', body: 'Where everything settles. The statement confirms what actually arrived, net of fees.' },
  { k: 'Vehicle invoice', body: 'An electric scooter — the tool of the trade, the source of the income, and the collateral.' },
]

export default function Problem() {
  return (
    <section id="problem" className="problem" aria-labelledby="problem-title">
      <div className="wrap section problem__intro">
        <div className="sec-head sec-head--split">
          <SectionLabel index="01">The borrower</SectionLabel>
          <RevealLines
            className="display-l"
            lines={[
              'TRADITIONAL CREDIT',
              'WASN’T BUILT FOR',
              <>
                THIS BORROWER<span className="acc">.</span>
              </>,
            ]}
          />
          <FadeIn className="lede" delay={0.2}>
            <span id="problem-title" hidden>
              Traditional credit wasn’t built for this borrower.
            </span>
            Bureau scores reward long histories and salary slips. The fastest-growing borrowers in EV mobility
            have neither — <strong>yet they leave a richer evidence trail than most salaried applicants.</strong>
          </FadeIn>
        </div>
      </div>

      <div className="marquee" aria-hidden="true">
        <div className="marquee__track">
          {[0, 1].map((copy) =>
            PERSONAS.map((p, i) => (
              <span key={`${copy}-${p}`} className={`marquee__item${i % 2 ? ' is-outline' : ''}`}>
                {p}
                <i className="marquee__sep">✦</i>
              </span>
            )),
          )}
        </div>
      </div>

      <div className="wrap problem__stats">
        <FadeIn className="problem__file caps">
          <span className="t3">Illustrative applicant file</span>
          <span className="t2">CR-2291 · EV two-wheeler · Delivery rider</span>
        </FadeIn>
        <div className="stats">
          {STATS.map((s, i) => (
            <FadeIn key={s.label} className="stat" delay={i * 0.08}>
              <Counter value={s.value} duration={1.8} className={`stat__num${s.acc ? ' acc' : ''}`} />
              <p className="stat__label caps">{s.label}</p>
              <p className="stat__note">{s.note}</p>
            </FadeIn>
          ))}
        </div>
      </div>

      <Trail />
    </section>
  )
}

function Trail() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [step, setStep] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (v) => setStep(Math.min(4, Math.floor(v * 5))))

  return (
    <div className="trail" ref={ref}>
      <div className="trail__sticky">
        <div className="wrap trail__grid">
          <div className="trail__copy">
            <p className="caps t3">The evidence trail</p>
            <h3 className="display-m trail__title">
              The salary slip disappears.
              <br />
              <span className="t3">The evidence doesn’t.</span>
            </h3>
            <div className="trail__dots" aria-hidden="true">
              {STEPS.map((s, i) => (
                <span key={s.k} className={i <= step ? 'is-on' : ''} />
              ))}
            </div>
            <ol className="trail__steps">
              {STEPS.map((s, i) => (
                <li
                  key={s.k}
                  className={`trail__step${i === step ? ' is-active' : ''}${i < step ? ' is-past' : ''}`}
                >
                  <span className="trail__num">0{i}</span>
                  <div>
                    <p className="trail__k">{s.k}</p>
                    <p className="trail__body">{s.body}</p>
                  </div>
                  <StepBar progress={scrollYProgress} i={i} />
                </li>
              ))}
            </ol>
          </div>

          <div className="deck" aria-hidden="true">
            {[SalarySlip, UpiCard, EarningsCard, BankCard, InvoiceCard].map((Card, i) => (
              <motion.div
                key={i}
                className={`deck__card${i === 0 && step > 0 ? ' is-void' : ''}`}
                style={{ zIndex: i }}
                initial={false}
                animate={pose(i, step)}
                transition={{ duration: 0.9, ease: EASE }}
              >
                <Card />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepBar({ progress, i }) {
  const scaleX = useTransform(progress, [i / 5, (i + 1) / 5], [0, 1])
  return <motion.span className="trail__bar" style={{ scaleX }} />
}

function pose(i, step) {
  if (i === 0 && step > 0) return { y: -44 - step * 12, scale: 0.86, opacity: 0.1, filter: 'blur(3px)' }
  if (i === step) return { y: 0, scale: 1, opacity: 1, filter: 'blur(0px)' }
  if (i < step) {
    const d = step - i
    return { y: -d * 28, scale: 1 - d * 0.05, opacity: Math.max(0.2, 0.62 - d * 0.14), filter: 'blur(0px)' }
  }
  return { y: 70, scale: 0.97, opacity: 0, filter: 'blur(0px)' }
}

/* ---------- evidence cards ---------- */

function SalarySlip() {
  return (
    <div className="ev glass">
      <div className="ev__head">
        <span>Salary slip</span>
        <span className="t4">Payroll · Form 16</span>
      </div>
      <dl className="slip">
        {['Employer', 'Designation', 'Gross pay', 'Deductions', 'Net pay'].map((k) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <span className="slip__blank" />
            </dd>
          </div>
        ))}
      </dl>
      <span className="slip__stamp">Not on file</span>
    </div>
  )
}

const UPI = [
  ['09:14', 'q•••@ybl', '+₹120'],
  ['11:02', 'r•••@okaxis', '+₹340'],
  ['13:47', 'CUST-TIP', '+₹60'],
  ['16:20', 's•••@paytm', '+₹1,180'],
  ['19:05', 'COD-TOPUP', '+₹640'],
  ['21:38', 'a•••@ibl', '+₹90'],
]

function UpiCard() {
  return (
    <div className="ev glass">
      <div className="ev__head">
        <span className="acc">UPI settlements</span>
        <span className="t3">22 Jul · 6 of 412</span>
      </div>
      <ul className="rc-ledger">
        {UPI.map(([t, who, amt]) => (
          <li key={t}>
            <span className="t3">{t}</span>
            <span>{who}</span>
            <span className="acc">{amt}</span>
          </li>
        ))}
      </ul>
      <div className="ev__foot">
        <span>412 credits</span>
        <span className="t3">last 90 days</span>
      </div>
    </div>
  )
}

const WEEKS = [4100, 4680, 3900, 4420, 4860, 4210, 3980, 4520, 4680, 4300, 4760, 4630]

function EarningsCard() {
  const max = Math.max(...WEEKS)
  return (
    <div className="ev glass">
      <div className="ev__head">
        <span className="acc">Platform earnings</span>
        <span className="t3">12 weeks · 3 platforms</span>
      </div>
      <div className="bars">
        {WEEKS.map((w, i) => (
          <span key={i} className="bars__bar" style={{ height: `${(w / max) * 100}%` }}>
            <i style={{ height: `${28 + (i % 3) * 9}%` }} />
          </span>
        ))}
      </div>
      <div className="ev__foot">
        <span>
          Avg <b className="acc">₹4,420</b> / week
        </span>
        <span className="t3">Platform A · B · C</span>
      </div>
    </div>
  )
}

const BANK = [
  ['22 JUL', 'NEFT CR · PLATFORM-A PAYOUT', '4,680.00', true],
  ['22 JUL', 'UPI DR · CHARGING HUB', '−186.00', false],
  ['24 JUL', 'NEFT CR · PLATFORM-B PAYOUT', '2,915.00', true],
  ['25 JUL', 'ACH DR · PHONE EMI', '−3,600.00', false],
  ['26 JUL', 'NEFT CR · PLATFORM-C PAYOUT', '1,460.00', true],
]

function BankCard() {
  return (
    <div className="ev glass">
      <div className="ev__head">
        <span className="acc">Bank statement</span>
        <span className="t3">Apr – Sep · 14 pages</span>
      </div>
      <ul className="stmt">
        {BANK.map(([d, n, a, cr], i) => (
          <li key={i} className={cr ? 'is-cr' : ''}>
            <span className="t3">{d}</span>
            <span className="stmt__n">{n}</span>
            <span>{a}</span>
          </li>
        ))}
      </ul>
      <div className="ev__foot">
        <span>
          Verified <b className="acc">₹18,400</b> / month
        </span>
        <span className="t3">6-month mean</span>
      </div>
    </div>
  )
}

function InvoiceCard() {
  return (
    <div className="ev glass">
      <div className="ev__head">
        <span className="acc">Tax invoice · EV dealer</span>
        <span className="t3">INV-24-08817</span>
      </div>
      <p className="inv__vehicle">Electric scooter · 3.0 kWh</p>
      <dl className="inv">
        <div>
          <dt>Ex-showroom</dt>
          <dd>₹1,09,500</dd>
        </div>
        <div>
          <dt>Registration & insurance</dt>
          <dd>₹14,500</dd>
        </div>
        <div className="inv__total">
          <dt>On-road price</dt>
          <dd className="acc">₹1,24,000</dd>
        </div>
      </dl>
      <div className="ev__foot">
        <span>Chassis MD9•••••••4471</span>
        <span className="t3">GSTIN verified</span>
      </div>
    </div>
  )
}
