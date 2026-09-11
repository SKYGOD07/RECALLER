/**
 * RECALLER — GSAP setup.
 *
 * One place registers the plugins and owns the motion language, so every
 * scroll-driven effect on the site eases the same way and stops the same way.
 *
 * Division of labour with framer-motion:
 *   GSAP + ScrollTrigger  — anything tied to scroll position: reveals, parallax,
 *                           pinned scenes, line drawing, counters.
 *   framer-motion         — component state: mount, layout, presence, the
 *                           scripted product demos inside sections.
 *
 * Reduced motion is honoured centrally: `gsap.matchMedia` runs the animated
 * branch only when the user has not asked for less, and every helper below
 * leaves the element in its final state otherwise.
 */

import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/** The site's easing. Matches `--ease` in index.css so CSS and GSAP agree. */
export const EASE_OUT = 'power3.out'
export const EASE_IN_OUT = 'power2.inOut'

gsap.defaults({ ease: EASE_OUT, duration: 0.9 })

/** ScrollTrigger defaults: start a little before the element is fully in view. */
ScrollTrigger.defaults({ start: 'top 82%', toggleActions: 'play none none none' })

export const REDUCED = '(prefers-reduced-motion: reduce)'
export const FULL = '(prefers-reduced-motion: no-preference)'

/** Distances and durations used across sections, so nothing drifts. */
export const MOTION = {
  rise: 34,
  riseSmall: 18,
  stagger: 0.07,
  duration: 0.9,
  slow: 1.2,
}

export { gsap, ScrollTrigger }
