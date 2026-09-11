import { MotionConfig } from 'framer-motion'
import Nav from '@/components/Nav.jsx'
import Agents from '@/sections/Agents.jsx'
import Audit from '@/sections/Audit.jsx'
import Decision from '@/sections/Decision.jsx'
import Deterministic from '@/sections/Deterministic.jsx'
import Download from '@/sections/Download.jsx'
import Evidence from '@/sections/Evidence.jsx'
import Facts from '@/sections/Facts.jsx'
import Footer from '@/sections/Footer.jsx'
import Hero from '@/sections/Hero.jsx'
import HumanLoop from '@/sections/HumanLoop.jsx'
import Movement from '@/sections/Movement.jsx'
import Policy from '@/sections/Policy.jsx'
import Problem from '@/sections/Problem.jsx'
import Proof from '@/sections/Proof.jsx'
import Showcase from '@/sections/Showcase.jsx'
import Strength from '@/sections/Strength.jsx'

/**
 * The public site.
 *
 * Order is the argument: the problem, the evidence that answers it, the
 * contradictions that evidence exposes, the product, the arithmetic, the
 * policy, the decision, the human, the alternative, the trace.
 *
 * Tone alternates deliberately — dark for the cinematic and operational
 * passages, light for the ones that ask the reader to study a table. A light
 * section declares `data-tone="light"` and every token beneath it flips; no
 * component needs a second variant.
 *
 *   dark   Hero          cinematic opening
 *   dark   Problem       the salary slip disappears
 *   light  Evidence      what RECALLER reads instead
 *   light  Proof         four documents, one version of the truth
 *   dark   Showcase      the console itself
 *   light  Deterministic the model never calculates the money
 *   dark   Strength      how much of this file do we know
 *   dark   Policy        change the policy, not the code
 *   dark   Decision      one accountable decision
 *   dark   HumanLoop     when confidence drops, RECALLER stops
 *   light  Movement      what-if: find the path
 *   dark   Audit         every decision leaves a trace
 *   dark   Facts         explainable by design
 *   dark   Download      final call
 */
export default function LandingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <a className="skip-link" href="#problem">
        Skip to content
      </a>
      <div className="guides" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Evidence />
        <Proof />
        <Showcase />
        <Deterministic />
        <Strength />
        <Policy />
        <Decision />
        <HumanLoop />
        <Movement />
        <Audit />
        <Facts />
        <Download />
      </main>
      <Footer />
    </MotionConfig>
  )
}
