import { motion, useScroll, useTransform } from 'framer-motion'
import { useRef } from 'react'
import { Button } from '../components/ui'
import './hero.css'

export default function Hero() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.965])
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])
  return <section id="top" className="hero" ref={ref}>
    <motion.div className="hero__image" style={{ scale }} aria-hidden="true" /><div className="hero__veil" aria-hidden="true" />
    <motion.div className="wrap hero__inner" style={{ opacity }}>
      <motion.p className="hero__eyebrow" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}><span className="hero__signal" /> AI credit intelligence <i /> MUJ HACKX 4.0 / FINTECH PS #1</motion.p>
      <motion.div className="hero__copy" initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.14 }}>
        <p className="hero__kicker">RECALLER / EVIDENCE-FIRST UNDERWRITING</p><h1>CREDIT DECISIONS<br />BUILT ON EVIDENCE<span>.</span></h1>
        <p>AI-assisted underwriting for thin-file green borrowers, built around reconciled evidence and deterministic policy.</p>
        <div className="hero__ctas"><Button to="/console">Open console</Button><Button href="#how" variant="ghost">See how it works</Button></div>
      </motion.div>
      <div className="hero__product" aria-label="Illustrative RECALLER application decision"><div className="hero__product-head"><span>RECALLER / LIVE CASE</span><span className="hero__verified">● VERIFIED</span></div><div className="hero__product-body"><div><small>APPLICATION</small><strong>APP-2003</strong><em>EV TWO-WHEELER</em></div><div className="hero__outcome"><small>WHAT-IF / 36 MONTHS</small><b>APPROVE</b><span>FOIR 46%</span></div></div></div>
    </motion.div>
  </section>
}
