import { useRef } from 'react'
import { motion, useInView, useMotionValue, useScroll, useSpring, useTransform } from 'framer-motion'
import { EASE } from '../animations/motion'
import { Counter } from '../components/Counter'
import { CASE, inr } from '../data/case'
import './stage.css'

// Stage geometry lives in a 1200×680 viewBox; HTML layers use the same % coordinates.
const W = 1200
const H = 680
const SRC_X = 294
const CORE = { x: 600, y: 340 }
const DEC_X = 858

const SOURCES = [
  { tag: 'KYC', title: 'Identity verified', row: 'ARJUN MEHRA · PAN ••••K', conf: '0.99', y: 17, depth: 14 },
  { tag: 'BANK', title: 'Statement · 6 months', row: '412 UPI credits · 90 days', conf: '0.97', y: 39, depth: 8 },
  { tag: 'EARNINGS', title: 'Platform payouts', row: '₹4,420 / week · 3 platforms', conf: '0.93', y: 61, depth: 11 },
  { tag: 'INVOICE', title: 'EV dealer invoice', row: 'On-road ₹1,24,000', conf: '0.98', y: 83, depth: 16 },
]

const FRAGMENTS = [
  ['UPI/CR/412209/₹640', 33, 13, 0],
  ['IMPS/CR/₹1,180', 60, 10, 1.4],
  ['FOIR ≤ 0.45', 44, 22, 2.2],
  ['NEFT CR · PLATFORM-A · ₹4,680', 36, 84, 0.8],
  ['GSTIN 27AAB••••1Z5', 58, 90, 2.8],
  ['E-07 · E-09 · E-12', 55, 78, 1.9],
]

const wire = (y) => `M${SRC_X} ${y} C ${SRC_X + 130} ${y} ${CORE.x - 160} ${CORE.y} ${CORE.x - 40} ${CORE.y}`
const OUT = `M${CORE.x + 40} ${CORE.y} L ${DEC_X} ${CORE.y}`

function Layer({ depth, sx, sy, className, style, children }) {
  const x = useTransform(sx, (v) => v * depth)
  const y = useTransform(sy, (v) => v * depth)
  return (
    <motion.div className={className} style={{ ...style, x, y }}>
      {children}
    </motion.div>
  )
}

export default function HeroStage() {
  const frameRef = useRef(null)
  const stageRef = useRef(null)
  const inView = useInView(stageRef, { once: true, amount: 0.3 })
  const { scrollYProgress } = useScroll({ target: frameRef, offset: ['start end', 'start 0.18'] })
  const rotateX = useTransform(scrollYProgress, [0, 1], [24, 0])
  const scale = useTransform(scrollYProgress, [0, 1], [0.9, 1])

  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const sx = useSpring(mx, { stiffness: 50, damping: 16 })
  const sy = useSpring(my, { stiffness: 50, damping: 16 })

  const onMove = (e) => {
    if (e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }
  const onLeave = () => {
    mx.set(0)
    my.set(0)
  }

  const state = inView ? 'show' : 'hidden'

  return (
    <div className="wrap stage-frame" ref={frameRef}>
      <motion.div
        ref={stageRef}
        className="stage"
        style={{ rotateX, scale }}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        role="img"
        aria-label="Illustration: identity, bank, earnings and invoice evidence converging into a single explained credit decision."
      >
        <span className="stage__horizon" />

        <div className="stage__chrome">
          <div className="stage__chrome-l">
            <span className="dot-live" />
            <span>Decision assembly</span>
            <span className="t4">/</span>
            <span className="t2">{CASE.id}</span>
          </div>
          <span className="stage__trace">{CASE.trace}</span>
        </div>

        <svg className="stage__wires" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="wireGrad" x1="0" x2="1">
              <stop offset="0" stopColor="rgb(198,255,77)" stopOpacity="0.15" />
              <stop offset="1" stopColor="rgb(198,255,77)" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          {SOURCES.map((s, i) => {
            const d = wire((s.y / 100) * H)
            return (
              <g key={s.tag}>
                <path d={d} className="stage__wire-base" />
                <motion.path
                  d={d}
                  className="stage__wire"
                  stroke="url(#wireGrad)"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: inView ? 1 : 0 }}
                  transition={{ duration: 1.2, ease: EASE, delay: 0.8 + i * 0.09 }}
                />
                {inView && (
                  <motion.circle
                    r="2.6"
                    className="stage__pulse"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 2 + i * 0.2 }}
                  >
                    <animateMotion dur={`${2.4 + i * 0.3}s`} repeatCount="indefinite" path={d} />
                  </motion.circle>
                )}
              </g>
            )
          })}
          <path d={OUT} className="stage__wire-base" />
          <motion.path
            d={OUT}
            className="stage__wire stage__wire--out"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: inView ? 1 : 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 2 }}
          />
          {inView && (
            <motion.circle
              r="3"
              className="stage__pulse"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2.8 }}
            >
              <animateMotion dur="1.6s" repeatCount="indefinite" path={OUT} />
            </motion.circle>
          )}
        </svg>

        {FRAGMENTS.map(([text, x, y, d]) => (
          <span
            key={text}
            className="stage-frag"
            style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }}
            aria-hidden="true"
          >
            {text}
          </span>
        ))}

        {SOURCES.map((s, i) => (
          <Layer
            key={s.tag}
            depth={s.depth}
            sx={sx}
            sy={sy}
            className="stage-layer stage-src"
            style={{ top: `${s.y}%` }}
          >
            <motion.div
              className="src-card glass"
              initial={{ opacity: 0, x: -26, filter: 'blur(8px)' }}
              animate={state === 'show' ? { opacity: 1, x: 0, filter: 'blur(0px)' } : {}}
              transition={{ duration: 1, ease: EASE, delay: 0.15 + i * 0.12 }}
            >
              <div className="src-card__top">
                <span className="src-card__tag">{s.tag}</span>
                <span className="src-card__conf">✓ {s.conf}</span>
              </div>
              <p className="src-card__title">{s.title}</p>
              <p className="src-card__row">{s.row}</p>
            </motion.div>
          </Layer>
        ))}

        <Layer depth={5} sx={sx} sy={sy} className="stage-layer stage-core">
          <motion.div
            className="core"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 1.1, ease: EASE, delay: 1.45 }}
          >
            <span className="core__ring core__ring--1" />
            <span className="core__ring core__ring--2" />
            <div className="core__body">
              <span className="core__cap">Evidence graph</span>
              <Counter value={CASE.confidence} decimals={2} duration={2.2} className="core__value" />
              <span className="core__cap">Confidence</span>
            </div>
          </motion.div>
        </Layer>

        <Layer depth={-10} sx={sx} sy={sy} className="stage-layer stage-dec">
          <motion.div
            className="sd glass"
            initial={{ opacity: 0, x: 30, filter: 'blur(10px)' }}
            animate={inView ? { opacity: 1, x: 0, filter: 'blur(0px)' } : {}}
            transition={{ duration: 1.1, ease: EASE, delay: 2.25 }}
          >
            <div className="sd__head">
              <span>Decision</span>
              <span className="t3">{CASE.policy} {CASE.policyVersion}</span>
            </div>
            <p className="sd__verdict">APPROVE</p>
            <p className="sd__terms">
              {inr(CASE.loan)} · {CASE.tenure} mo · {CASE.rate.toFixed(1)}%
            </p>
            <dl className="sd__rows">
              <div>
                <dt>Verified income</dt>
                <dd>{inr(CASE.verifiedIncome)}/mo</dd>
              </div>
              <div>
                <dt>EMI</dt>
                <dd>{inr(CASE.emi, 2)}</dd>
              </div>
              <div>
                <dt>FOIR</dt>
                <dd>
                  {CASE.foir}% <span className="t3">/ {CASE.maxFoir}%</span>
                </dd>
              </div>
              <div>
                <dt>LTV</dt>
                <dd>{CASE.ltv}%</dd>
              </div>
            </dl>
            <div className="sd__codes">
              {CASE.reasons.map((r) => (
                <span key={r.code} className={`code-chip${r.kind === 'advisory' ? ' code-chip--adv' : ''}`}>
                  {r.code}
                </span>
              ))}
            </div>
          </motion.div>
        </Layer>

        <div className="stage__caps" aria-hidden="true">
          <span>Evidence in</span>
          <span>Reconcile · score</span>
          <span>Decision out</span>
        </div>
      </motion.div>
    </div>
  )
}
