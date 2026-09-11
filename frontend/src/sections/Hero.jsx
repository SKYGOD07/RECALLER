import { useRef } from 'react'
import { EASE_OUT, gsap } from '../animations/gsap'
import { useGsapScope } from '../animations/useGsap'
import { FULL } from '../animations/gsap'
import { Link } from '../lib/router'
import { APPROVED } from '../data/live'
import { inr, pct } from '../lib/format'
import './hero.css'

/**
 * The cinematic hero.
 *
 * The landscape is composed entirely in CSS — layered gradients, haze and
 * vignette — so nothing here depends on a licensed photograph, and the whole
 * scene stays crisp at any width. The workstation sits in the middle distance
 * with the real console on its screen: the figures are the engine's output for
 * RCL-2026-0418, not decoration.
 */
export default function Hero() {
  const laptop = useRef(null)

  const scope = useGsapScope(({ mm, scope: root }) => {
    const q = gsap.utils.selector(root)

    mm.add(FULL, () => {
      // Entrance: the world settles, then the words, then the product, then the ask.
      const intro = gsap.timeline({ defaults: { ease: EASE_OUT } })
      intro
        .from(q('[data-layer]'), { scale: 1.06, opacity: 0, duration: 1.6, stagger: 0.06 })
        .from(q('.hero__eyebrow'), { opacity: 0, y: 14, duration: 0.8 }, 0.35)
        .from(q('.hero__line span'), { yPercent: 112, duration: 1.05, stagger: 0.09 }, 0.45)
        .from(q('.hero__lede'), { opacity: 0, y: 18, duration: 0.9 }, 0.95)
        .from(q('.hero__rig'), { opacity: 0, y: 46, scale: 0.97, duration: 1.25 }, 0.8)
        .from(q('.hero__ctas > *'), { opacity: 0, y: 14, duration: 0.7, stagger: 0.08 }, 1.15)
        .from(q('.hero__foot > *'), { opacity: 0, duration: 0.8, stagger: 0.08 }, 1.3)

      // Depth: the ridges drift at different rates while the hero is on screen.
      gsap.to(q('[data-depth="far"]'), {
        y: 40,
        ease: 'none',
        scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: 0.8 },
      })
      gsap.to(q('[data-depth="near"]'), {
        y: 110,
        ease: 'none',
        scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: 0.8 },
      })

      // Hand-off: the hero settles back rather than simply scrolling away.
      gsap.to(q('.hero__inner'), {
        scale: 0.96,
        opacity: 0,
        filter: 'blur(7px)',
        ease: 'none',
        scrollTrigger: { trigger: root, start: '35% top', end: 'bottom top', scrub: 0.5 },
      })
    })
  }, [])

  return (
    <section id="top" className="hero" data-tone="dark" ref={scope}>
      <div className="hero__world" aria-hidden="true">
        <span className="hero__layer hero__layer--sky" data-layer />
        <span className="hero__layer hero__layer--glow" data-layer />
        <span className="hero__layer hero__layer--ridge-far" data-layer data-depth="far" />
        <span className="hero__layer hero__layer--haze" data-layer />
        <span className="hero__layer hero__layer--ridge-near" data-layer data-depth="near" />
        <span className="hero__layer hero__layer--ground" data-layer />
        <span className="hero__layer hero__layer--vignette" />
      </div>

      <div className="hero__inner">
        <div className="wrap hero__copy">
          <p className="hero__eyebrow eyebrow eyebrow--plain">AI Credit Intelligence</p>

          <h1 className="hero__title">
            <span className="hero__line">
              <span>Credit decisions</span>
            </span>
            <span className="hero__line">
              <span>
                built on evidence<i className="hero__stop">.</i>
              </span>
            </span>
          </h1>

          <p className="hero__lede">
            Underwriting for thin-file green borrowers — without asking the model to invent the math.
          </p>

          <div className="hero__ctas">
            <Link to="/console" className="pillbtn pillbtn--primary pillbtn--lg">
              Open console
            </Link>
            <a href="#problem" className="pillbtn pillbtn--ghost pillbtn--lg">
              See how it works
            </a>
          </div>
        </div>

        <Workstation ref={laptop} />

        <div className="wrap hero__foot">
          <span className="meta">
            Policy <strong>v{APPROVED.policyVersion}</strong>
          </span>
          <span className="meta">
            Decision <strong>deterministic</strong>
          </span>
          <span className="meta">MUJ HackX 4.0 · Fintech PS #1</span>
        </div>
      </div>
    </section>
  )
}

/**
 * The workstation. A screen, a lid edge and a reflection — enough to read as a
 * physical object without pretending to be a photograph.
 */
function Workstation() {
  return (
    <div className="hero__rig">
      <div className="rig">
        <div className="rig__screen">
          <div className="rig__chrome">
            <span className="rig__mark">RECALLER</span>
            <span className="rig__crumb mono">{APPROVED.id}</span>
            <span className="rig__live">
              <i />
              Runtime online
            </span>
          </div>

          <div className="rig__body">
            <div className="rig__decision">
              <span className="rig__tag">Approve</span>
              <strong className="rig__amount tnum">{inr(APPROVED.amount)}</strong>
              <span className="rig__terms tnum">
                {APPROVED.tenure} months · {APPROVED.rate}% p.a. · {inr(APPROVED.emi, { decimals: 2 })} / month
              </span>
            </div>

            <dl className="rig__metrics">
              <div>
                <dt>FOIR</dt>
                <dd className="tnum">{pct(APPROVED.foir)}</dd>
              </div>
              <div>
                <dt>LTV</dt>
                <dd className="tnum">{pct(APPROVED.ltv)}</dd>
              </div>
              <div>
                <dt>Income</dt>
                <dd className="tnum">{inr(APPROVED.income)}</dd>
              </div>
              <div>
                <dt>Rules</dt>
                <dd className="tnum">
                  {APPROVED.rulesPassed}/{APPROVED.rulesTotal}
                </dd>
              </div>
            </dl>

            <div className="rig__trace mono">
              <span>trace {APPROVED.trace}</span>
              <span>{APPROVED.events} events</span>
            </div>
          </div>
        </div>

        <span className="rig__base" aria-hidden="true" />
        <span className="rig__cast" aria-hidden="true" />
      </div>
    </div>
  )
}
