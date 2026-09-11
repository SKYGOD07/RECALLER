import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/**
 * Steps through `count` states while `active`, holding each for durations[i] ms
 * (or a single number). Used for the scripted, presentation-only demos.
 */
export function useSequence(active, count, durations, { loop = true } = {}) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!active) return
    if (!loop && step >= count - 1) return
    const hold = Array.isArray(durations) ? durations[step] : durations
    const t = setTimeout(() => setStep((s) => (s + 1) % count), hold)
    return () => clearTimeout(t)
  }, [active, step, count, durations, loop])
  return [step, setStep]
}
