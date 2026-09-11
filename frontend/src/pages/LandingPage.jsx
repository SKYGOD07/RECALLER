import { MotionConfig } from 'framer-motion'
import Nav from '@/components/Nav.jsx'
import Cursor from '@/components/ui/inverted-cursor.tsx'
import Footer from '@/sections/Footer.jsx'
import Hero from '@/sections/Hero.jsx'
import PremiumStories from '@/sections/PremiumStories.jsx'

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
        <PremiumStories />
      </main>
      <Footer />
    </MotionConfig>
  )
}
