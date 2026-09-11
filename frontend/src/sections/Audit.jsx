import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { EASE } from '../animations/motion'
import { FadeIn, RevealLines } from '../components/Reveal'
import { IconCheck, SectionLabel } from '../components/ui'
import './audit.css'

const EVENTS = [
  ['14:02:11.204', 'DOCUMENT', '4 files received · 18 pages', 'doc:kyc-01…inv-01'],
  ['14:02:13.880', 'EXTRACTION', '38 fields · mean confidence 0.93', 'ext:v2.4'],
  ['14:02:14.102', 'EVIDENCE', '23 citations bound to source spans', 'E-01…E-23'],
  ['14:02:15.417', 'RECONCILIATION', '14 matched · 3 advisory · 1 mismatch', 'rec:1.8'],
  ['14:02:15.418', 'REVIEW', 'payout_wk29 0.62 < 0.85 · run paused', 'hitl:#4471', 'amber'],
  ['14:05:56.030', 'REVIEW', 'attested ₹4,680.00 · run resumed', 'officer:O-112', 'amber'],
  ['14:05:56.311', 'CALCULATION', 'EMI 3,417.76 · FOIR 0.3814 · LTV 0.8065', 'engine:1.3.0'],
  ['14:05:56.319', 'POLICY', 'EV-2W-THINFILE v3.3 · 12 / 12 pass', 'pol:v3.3'],
  ['14:05:56.402', 'DECISION', 'APPROVE · R-01 R-04 A-02', 'dr-2291', 'acc'],
  ['14:05:57.960', 'CREDIT MEMO', 'memo signed · 23 citations', 'sha256:e41b…09'],
]

const META = [
  ['Trace ID', 'trc_7f3a91c2'],
  ['Evidence citation', 'E-07 → statement p.9 · row 14'],
  ['Policy version', 'EV-2W-THINFILE v3.3'],
  ['Decision record', 'dr-2291 · sha256 e41b…09'],
]

export default function Audit() {
  const logRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: logRef, offset: ['start 0.8', 'end 0.6'] })
  const scaleY = useTransform(scrollYProgress, [0, 1], [0, 1])

  return (
    <section className="audit section" aria-labelledby="audit-title">
      <div className="wrap audit__grid">
        <div className="audit__copy">
          <SectionLabel index="09">Auditability</SectionLabel>
          <RevealLines
            className="display-l audit__title"
            lines={[
              'EVERY DECISION',
              <>
                LEAVES A TRAIL<span className="acc">.</span>
              </>,
            ]}
          />
          <span id="audit-title" hidden>
            Every decision leaves a trail.
          </span>
          <FadeIn className="lede audit__lede" delay={0.15}>
            Each step writes an immutable event: what went in, what came out, which version decided. An auditor
            can replay any decision from its first document to its signed memo.
          </FadeIn>
          <FadeIn as="dl" className="audit__meta" delay={0.25}>
            {META.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </FadeIn>
        </div>

        <div className="log glass" ref={logRef}>
          <div className="log__head">
            <span className="log__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>trace · trc_7f3a91c2</span>
            <span className="t4">10 events · append-only</span>
          </div>
          <motion.ol
            className="log__rows"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.25 }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.11 } } }}
          >
            <motion.span className="log__spine" style={{ scaleY }} aria-hidden="true" />
            {EVENTS.map(([t, stage, msg, ref, tone], i) => (
              <motion.li
                key={i}
                className={`lrow${tone ? ` lrow--${tone}` : ''}`}
                variants={{
                  hidden: { opacity: 0, x: -12 },
                  show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE } },
                }}
              >
                <span className="lrow__dot" />
                <span className="lrow__t">{t}</span>
                <span className="lrow__s">{stage}</span>
                <span className="lrow__m">{msg}</span>
                <span className="lrow__r">{ref}</span>
              </motion.li>
            ))}
          </motion.ol>
          <div className="log__foot">
            <span className="log__ok">
              <IconCheck /> Hash chain verified
            </span>
            <span className="t3">Export · credit memo (PDF) · decision record (JSON)</span>
          </div>
        </div>
      </div>
    </section>
  )
}
