import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { EASE, lerpRange } from '../animations/motion'
import { RevealLines } from '../components/Reveal'
import { Button } from '../components/ui'
import HeroStage from './HeroStage'
import './hero.css'

const intro = (delay) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 1.1, ease: EASE, delay },
})

export default function Hero() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 0.5], ['0%', '-12%'])
  const opacity = useTransform(scrollYProgress, lerpRange(0, 0.36, 1, 0))

  return (
    <section id="top" className="hero" ref={ref}>
      <div className="hero__bg" aria-hidden="true">
        <div className="hero__grid" />
        <div className="hero__glow" />
      </div>

      <motion.div className="wrap hero__inner" style={{ y, opacity }}>
        <motion.div className="hero__meta" {...intro(0.1)}>
          <span className="hero__status">
            <span className="dot-live" />
            System online
          </span>
          <span className="hero__meta-mid">Credit intelligence · Build 0.1</span>
          <span className="hero__meta-end">Thin-file · EV · Gig · UPI</span>
        </motion.div>

        <div className="hero__main">
          <motion.p className="hero__eyebrow" {...intro(0.25)}>
            <span className="hero__brand">RECALLER</span>
            <span className="hero__eyebrow-rule" />
            <span>AI-native credit intelligence for thin-file green borrowers</span>
          </motion.p>

          <RevealLines
            as="h1"
            immediate
            delay={0.35}
            stagger={0.1}
            className="display-xl hero__title"
            lines={[
              'AI CREDIT',
              'INTELLIGENCE',
              <>
                FOR THE REAL WORLD<span className="acc">.</span>
              </>,
            ]}
          />

          <div className="hero__foot">
            <motion.p className="lede hero__lede" {...intro(0.9)}>
              Underwriting for borrowers the bureau can’t see —{' '}
              <strong>gig workers, first-time EV buyers, UPI-first earners.</strong> RECALLER reads the evidence
              they do have, and returns a decision that is fast and defensible.
            </motion.p>
            <motion.div className="hero__ctas" {...intro(1.05)}>
              <Button href="#problem">Explore RECALLER</Button>
              <Button href="#download" variant="ghost" icon="download">
                Download RECALLER
              </Button>
            </motion.div>
          </div>
        </div>
      </motion.div>

      <HeroStage />
    </section>
  )
}
