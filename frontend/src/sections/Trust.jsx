import { motion } from 'framer-motion'
import { EASE } from '../animations/motion'
import { Scramble } from '../components/Counter'
import { FadeIn, RevealLines } from '../components/Reveal'
import { SectionLabel } from '../components/ui'
import './trust.css'

const MODEL = [
  ['Understands evidence', 'Reads statements, invoices and payout reports the way an analyst would.'],
  ['Extracts context', 'Turns “NEFT CR · PLATFORM-A” into a typed, cited income fact.'],
  ['Explains findings', 'Writes the credit memo — every claim pinned to a source span.'],
]

const ENGINE = [
  ['EMI', '₹3,417.76', 'P · r · (1+r)ⁿ ⁄ ((1+r)ⁿ − 1)'],
  ['FOIR', '38.14%', '(EMI + obligations) ⁄ verified income'],
  ['LTV', '80.65%', 'loan ⁄ on-road price'],
  ['OBLIGATIONS', '₹3,600', 'Σ bureau EMIs + recurring ACH debits'],
]

const FACTS = [
  ['0', 'financial figures written by the model'],
  ['1 : 1', 'identical inputs, identical outputs'],
  ['Every', 'number traceable to a formula and a source'],
]

export default function Trust() {
  return (
    <section id="trust" className="trust section" aria-labelledby="trust-title">
      <div className="trust__bg" aria-hidden="true" />
      <div className="wrap">
        <SectionLabel index="04">Deterministic credit</SectionLabel>

        {/* The heading owns the in-view trigger: the masked line can't observe itself. */}
        <motion.h2
          id="trust-title"
          className="trust__title"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.5 }}
        >
          <motion.span
            className="trust__soft"
            variants={{
              hidden: { opacity: 0, filter: 'blur(18px)' },
              show: { opacity: 1, filter: 'blur(0px)', transition: { duration: 1.6, ease: EASE } },
            }}
          >
            THE MODEL REASONS.
          </motion.span>
          <span className="mask-line">
            <motion.span
              className="mask-line__inner trust__hard"
              variants={{
                hidden: { y: '108%' },
                show: { y: '0%', transition: { duration: 1.1, ease: EASE, delay: 0.5 } },
              }}
            >
              THE ENGINE CALCULATES<span className="acc">.</span>
            </motion.span>
          </span>
        </motion.h2>

        <div className="trust__split">
          <FadeIn className="tcol tcol--model">
            <div className="tcol__head">
              <span className="tcol__tag">Model</span>
              <span className="caps t3">Probabilistic · reads &amp; explains</span>
            </div>

            <div className="excerpt" aria-hidden="true">
              <span className="excerpt__scan" />
              <p>
                <span className="t4">22 JUL</span>{' '}
                <span className="anno">
                  NEFT CR · PLATFORM-A · WKLY SETTLEMENT
                  <em>income stream · weekly</em>
                </span>{' '}
                <span className="anno anno--amt">
                  4,680.00<em>E-07</em>
                </span>
              </p>
              <p className="t3">
                <span className="t4">22 JUL</span> UPI DR · CHARGING HUB · 186.00
              </p>
              <p>
                <span className="t4">25 JUL</span>{' '}
                <span className="anno">
                  ACH DR · PHONE EMI
                  <em>obligation · recurring</em>
                </span>{' '}
                <span className="anno anno--amt">
                  3,600.00<em>E-11</em>
                </span>
              </p>
            </div>

            <ul className="tcol__list">
              {MODEL.map(([verb, note]) => (
                <li key={verb}>
                  <p className="tcol__verb">{verb}</p>
                  <p className="tcol__note">{note}</p>
                </li>
              ))}
            </ul>
          </FadeIn>

          <div className="boundary" aria-hidden="true">
            <span className="boundary__line" />
            <span className="boundary__tag">Typed hand-off · schema-validated facts</span>
            <span className="boundary__flow">
              <i />
            </span>
          </div>

          <FadeIn className="tcol tcol--engine" delay={0.15}>
            <div className="tcol__head">
              <span className="tcol__tag tcol__tag--acc">Engine</span>
              <span className="caps t3">Deterministic · computes</span>
            </div>
            <dl className="calc">
              {ENGINE.map(([k, v, f], i) => (
                <div className="calc__row" key={k}>
                  <dt>{k}</dt>
                  <dd>
                    <Scramble text={v} className="calc__v" delay={i * 180} />
                    <span className="calc__f">{f}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="calc__run">engine 1.3.0 · run 0x9f2c…e1 · reproducible</p>
          </FadeIn>
        </div>

        <div className="trust__law">
          <RevealLines
            className="display-m"
            lines={[
              'AI DOES NOT INVENT',
              <>
                FINANCIAL NUMBERS<span className="acc">.</span>
              </>,
            ]}
          />
          <div className="trust__facts">
            {FACTS.map(([n, l], i) => (
              <FadeIn key={l} className="fact" delay={i * 0.1}>
                <span className="fact__n">{n}</span>
                <span className="fact__l">{l}</span>
              </FadeIn>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
