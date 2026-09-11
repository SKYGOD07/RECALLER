import { MotionConfig } from 'framer-motion'
import Nav from '@/components/Nav.jsx'
import Cursor from '@/components/ui/inverted-cursor.tsx'
import Agents from '@/sections/Agents.jsx'
import Audit from '@/sections/Audit.jsx'
import Decision from '@/sections/Decision.jsx'
import Download from '@/sections/Download.jsx'
import Footer from '@/sections/Footer.jsx'
import Hero from '@/sections/Hero.jsx'
import HumanLoop from '@/sections/HumanLoop.jsx'
import Idea from '@/sections/Idea.jsx'
import Orchestration from '@/sections/Orchestration.jsx'
import Policy from '@/sections/Policy.jsx'
import Problem from '@/sections/Problem.jsx'
import Reconciliation from '@/sections/Reconciliation.jsx'
import Showcase from '@/sections/Showcase.jsx'
import Trust from '@/sections/Trust.jsx'
import WhatIf from '@/sections/WhatIf.jsx'

export default function LandingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <Cursor size={42} />
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
        <Idea />
        <Agents />
        <Trust />
        <Reconciliation />
        <HumanLoop />
        <Policy />
        <Decision />
        <Audit />
        <WhatIf />
        <Showcase />
        <Orchestration />
        <Download />
      </main>
      <Footer />
    </MotionConfig>
  )
}
