import { useEffect, useSyncExternalStore } from 'react'
import {
  boot,
  getConsoleSnapshot,
  loadApplication,
  subscribeConsole,
} from '@/store/console'
import { getToasts, subscribeToasts } from '@/store/toasts'

/** Subscribes the calling component to the console store. */
export function useConsole() {
  return useSyncExternalStore(subscribeConsole, getConsoleSnapshot, getConsoleSnapshot)
}

/** Boots the console once, on first mount of anything that needs data. */
export function useBootedConsole() {
  const state = useConsole()
  useEffect(() => {
    if (state.boot === 'IDLE') boot()
  }, [state.boot])
  return state
}

/** Loads one application's detail bundle when the route points at it. */
export function useApplicationDetail(id) {
  const state = useBootedConsole()
  const loaded = Boolean(state.details[id])

  useEffect(() => {
    if (!id || state.boot !== 'READY' || loaded) return
    loadApplication(id).catch(() => {
      /* the error is recorded on the store and rendered by the screen */
    })
  }, [id, state.boot, loaded])

  return state
}

export function useToasts() {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts)
}
