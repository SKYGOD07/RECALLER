/**
 * Minimal history router.
 *
 * The site has two modes on one origin — the landing page and the console —
 * so routes are real paths rather than hashes. Vite's dev server and the
 * backend's SPA fallback both serve index.html for unknown paths.
 *
 *   /                                        landing
 *   /console                                 application queue
 *   /console/application/:id                 underwriting workspace
 *   /console/application/:id/:tab            evidence | reconciliation |
 *                                            what-if | assist | audit | memo
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const RouterContext = createContext(null)

const read = () => window.location.pathname.replace(/\/+$/, '') || '/'

export function navigate(to, { replace = false } = {}) {
  const path = to.startsWith('/') ? to : `/${to}`
  if (path === read()) return
  if (replace) window.history.replaceState({}, '', path)
  else window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function RouterProvider({ children }) {
  const [path, setPath] = useState(read)

  useEffect(() => {
    const onPop = () => setPath(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const value = useMemo(() => ({ path, route: parse(path) }), [path])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

/** `/console/application/RCL-2026-0418/audit` → { view, id, tab } */
export function parse(path) {
  const parts = path.split('/').filter(Boolean)
  if (parts[0] !== 'console') return { view: 'landing', id: null, tab: null }
  if (parts[1] !== 'application' || !parts[2]) return { view: 'queue', id: null, tab: null }
  return { view: 'application', id: parts[2], tab: parts[3] ?? 'underwriting' }
}

export function useRoute() {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRoute must be used inside <RouterProvider>')
  return ctx
}

/** Anchor that routes in-app but stays a real link for middle-click and a11y. */
export function Link({ to, children, onClick, ...rest }) {
  const handle = useCallback(
    (e) => {
      onClick?.(e)
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      navigate(to)
      window.scrollTo({ top: 0 })
    },
    [to, onClick],
  )
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  )
}

export const applicationPath = (id, tab) =>
  tab && tab !== 'underwriting' ? `/console/application/${id}/${tab}` : `/console/application/${id}`
