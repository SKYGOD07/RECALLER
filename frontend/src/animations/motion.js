// Shared motion language: one easing family, slow confident durations.
export const EASE = [0.22, 1, 0.36, 1]
export const EASE_IO = [0.65, 0, 0.35, 1]

export const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE } },
}

/**
 * Clamped linear map as a plain function. Scroll-linked opacity must go through a
 * function transform: framer-motion can otherwise hand an array-mapped opacity to a
 * native ScrollTimeline, which mis-mapped the section offsets in testing.
 */
export const lerpRange = (inA, inB, outA, outB) => (v) => {
  const t = Math.min(1, Math.max(0, (v - inA) / (inB - inA)))
  return outA + (outB - outA) * t
}

export const stagger =(each = 0.08, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: each, delayChildren: delay } },
})
