import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { FadeIn, RevealLines } from '../components/Reveal'
import { Button, SectionLabel } from '../components/ui'
import { SITE } from '../data/site'
import './download.css'

const SPEC = [
  ['Windows', SITE.download.platform],
  ['Version', SITE.download.version],
  ['Package', SITE.download.package],
]

export default function Download() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] })
  const scale = useTransform(scrollYProgress, [0, 1], [0.86, 1])
  const ringRotate = useTransform(scrollYProgress, [0, 1], [-40, 0])

  return (
    <section id="download" className="dl" ref={ref} aria-labelledby="dl-title">
      <div className="dl__bg" aria-hidden="true">
        <motion.div className="dl__ring" style={{ rotate: ringRotate }}>
          <span />
          <span />
          <span />
        </motion.div>
        <div className="dl__glow" />
      </div>

      <div className="wrap dl__inner">
        <SectionLabel index="13">Download</SectionLabel>
        <motion.div style={{ scale }} className="dl__title-wrap">
          <RevealLines
            as="h2"
            className="dl__title"
            stagger={0.12}
            lines={[
              'RUN',
              <>
                RECALLER<span className="acc">.</span>
              </>,
            ]}
          />
          <span id="dl-title" hidden>
            Run RECALLER.
          </span>
        </motion.div>

        <div className="dl__grid">
          <FadeIn className="lede dl__lede">
            <strong>A local, deployable credit-intelligence experience.</strong> Install it on a Windows workstation,
            open a case, and watch a decision assemble — evidence, calculation, policy and trail.
          </FadeIn>

          <FadeIn as="dl" className="dl__spec" delay={0.1}>
            {SPEC.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </FadeIn>

          <FadeIn className="dl__ctas" delay={0.2}>
            <Button href={SITE.download.href} size="lg" icon="download" download>
              Download RECALLER
            </Button>
            <Button href="#product" variant="ghost" size="lg">
              View system
            </Button>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}
