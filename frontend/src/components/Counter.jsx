import { useEffect, useMemo, useRef, useState } from 'react'
import { animate, useInView, useReducedMotion } from 'framer-motion'
import { EASE } from '../animations/motion'

/**
 * Animated numeral. Counts up when first seen, then tweens between values
 * whenever `value` changes (used by the policy and what-if demos).
 * Writes straight to the DOM so re-renders never fight the tween.
 */
export function Counter({ value, from = 0, decimals = 0, prefix = '', suffix = '', duration = 1.6, className }) {
  const ref = useRef(null)
  const current = useRef(from)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduce = useReducedMotion()
  const fmt = useMemo(
    () => new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    [decimals],
  )
  const [initial] = useState(() => `${prefix}${fmt.format(from)}${suffix}`)

  useEffect(() => {
    if (!inView || !ref.current) return
    const node = ref.current
    const controls = animate(current.current, value, {
      duration: reduce ? 0 : duration,
      ease: EASE,
      onUpdate: (v) => {
        current.current = v
        node.textContent = `${prefix}${fmt.format(v)}${suffix}`
      },
    })
    return () => controls.stop()
  }, [inView, value, duration, prefix, suffix, fmt, reduce])

  return (
    <span ref={ref} className={className}>
      {initial}
    </span>
  )
}

/** Digits resolve left-to-right out of noise — the engine "settling" on a figure. */
export function Scramble({ text, className, duration = 1300, delay = 0 }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const reduce = useReducedMotion()
  const [initial] = useState(() => text.replace(/\d/g, '0'))

  useEffect(() => {
    if (!inView || !ref.current) return
    const node = ref.current
    if (reduce) {
      node.textContent = text
      return
    }
    let raf
    let last = 0
    const start = performance.now() + delay
    const tick = (now) => {
      const t = now - start
      if (t >= duration) {
        node.textContent = text
        return
      }
      if (t > 0 && now - last > 45) {
        last = now
        const settled = Math.floor((t / duration) * text.length)
        node.textContent = text
          .split('')
          .map((c, i) => (i < settled || !/\d/.test(c) ? c : String((Math.random() * 10) | 0)))
          .join('')
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, text, duration, delay, reduce])

  return (
    <span ref={ref} className={className}>
      {initial}
    </span>
  )
}
