/**
 * GSAP hooks.
 *
 * Every hook builds its animations inside a `gsap.context` bound to a ref, so a
 * single `revert()` on unmount kills the tweens, the ScrollTriggers and any
 * inline styles they wrote. Nothing leaks between routes.
 *
 * Each hook is also reduced-motion safe: the animated branch is registered
 * through `matchMedia`, and the element's resting state is its final state, so
 * doing nothing is always correct.
 */

import { useLayoutEffect, useRef } from 'react'
import { EASE_OUT, FULL, MOTION, ScrollTrigger, gsap } from './gsap'

/**
 * Run `build(ctx, self)` inside a scoped gsap.context.
 * @param {Function} build receives ({ gsap, mm }) and the scope element
 * @param {Array} deps re-runs the context when these change
 * @returns {import('react').RefObject} attach to the scope element
 */
export function useGsapScope(build, deps = []) {
  const scope = useRef(null)

  useLayoutEffect(() => {
    if (!scope.current) return undefined
    const ctx = gsap.context((self) => {
      const mm = gsap.matchMedia()
      build({ gsap, mm, self, scope: scope.current })
    }, scope)
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return scope
}

/**
 * Reveal direct matches of `selector` as they enter, in order.
 * The elements are visible without JS; GSAP only animates the entrance.
 */
export function useReveal(selector = '[data-reveal]', options = {}) {
  const { y = MOTION.rise, stagger = MOTION.stagger, duration = MOTION.duration, start, once = true } = options

  return useGsapScope(({ mm, scope }) => {
    mm.add(FULL, () => {
      const targets = gsap.utils.toArray(selector, scope)
      if (!targets.length) return
      gsap.from(targets, {
        opacity: 0,
        y,
        duration,
        stagger,
        ease: EASE_OUT,
        scrollTrigger: {
          trigger: scope,
          start: start ?? 'top 78%',
          toggleActions: once ? 'play none none none' : 'play none none reverse',
        },
      })
    })
  }, [selector])
}

/**
 * Move an element against the scroll. `strength` is the total travel in pixels
 * across the section — keep it small; this is depth, not a ride.
 */
export function useParallax(selector, strength = 60, options = {}) {
  const { scale = null } = options

  return useGsapScope(({ mm, scope }) => {
    mm.add(FULL, () => {
      const targets = gsap.utils.toArray(selector, scope)
      if (!targets.length) return
      gsap.to(targets, {
        yPercent: 0,
        y: strength,
        ...(scale ? { scale } : {}),
        ease: 'none',
        scrollTrigger: { trigger: scope, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
      })
    })
  }, [selector, strength, scale])
}

/**
 * The hero hand-off: as the hero leaves, it settles back and fades, so the
 * section beneath arrives rather than merely scrolling up.
 */
export function useHeroExit(selector, options = {}) {
  const { scale = 0.96, opacity = 0.35, blur = 6 } = options

  return useGsapScope(({ mm, scope }) => {
    mm.add(FULL, () => {
      const target = scope.querySelector(selector)
      if (!target) return
      gsap.to(target, {
        scale,
        opacity,
        filter: `blur(${blur}px)`,
        ease: 'none',
        scrollTrigger: { trigger: scope, start: 'top top', end: 'bottom top', scrub: 0.5 },
      })
    })
  }, [selector, scale, opacity, blur])
}

/**
 * Draw SVG paths on scroll. Used for the evidence map and the audit spine —
 * the line arriving is the point, so it is never instant.
 */
export function useDrawLines(selector = 'path[data-draw]', options = {}) {
  const { stagger = 0.12, duration = 1.1 } = options

  return useGsapScope(({ mm, scope }) => {
    mm.add(FULL, () => {
      const paths = gsap.utils.toArray(selector, scope)
      if (!paths.length) return
      paths.forEach((path) => {
        const length = typeof path.getTotalLength === 'function' ? path.getTotalLength() : 0
        if (!length) return
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length })
      })
      gsap.to(paths, {
        strokeDashoffset: 0,
        duration,
        stagger,
        ease: EASE_OUT,
        scrollTrigger: { trigger: scope, start: 'top 72%' },
      })
    })
  }, [selector, stagger, duration])
}

/**
 * Count an element up to the number already written in its `data-count`.
 *
 * The DOM keeps the true value, so a reduced-motion visitor and a crawler both
 * read the real figure. Only metrics that describe the system are animated —
 * nothing here invents a number.
 */
export function useCountUp(selector = '[data-count]') {
  return useGsapScope(({ mm, scope }) => {
    mm.add(FULL, () => {
      gsap.utils.toArray(selector, scope).forEach((el) => {
        const target = Number(el.dataset.count)
        if (!Number.isFinite(target)) return
        const suffix = el.dataset.countSuffix ?? ''
        const box = { value: 0 }
        gsap.to(box, {
          value: target,
          duration: 1.4,
          ease: EASE_OUT,
          scrollTrigger: { trigger: el, start: 'top 88%' },
          onUpdate: () => {
            el.textContent = Math.round(box.value).toLocaleString('en-IN') + suffix
          },
        })
      })
    })
  }, [selector])
}

/** Refresh ScrollTrigger after layout-affecting changes (route swap, font load). */
export function refreshScrollTriggers() {
  ScrollTrigger.refresh()
}
