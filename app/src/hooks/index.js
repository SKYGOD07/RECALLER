import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { subscribe, getSnapshot } from '@/services/api.js';

/** Subscribes the calling component to the console store. */
export function useConsole() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* ------------------------------------------------------------------ *
 * Hash router.
 *
 * Hash routing rather than history routing so the built console works when
 * opened from the filesystem or served from a nested path by the Windows
 * installer, with no server rewrite rules to configure.
 *
 *   #/                          dashboard
 *   #/new                       new application
 *   #/app/:id/:screen           application workspace
 *   #/policy                    policy book
 * ------------------------------------------------------------------ */

function read() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { path, parts, query: new URLSearchParams(query ?? '') };
}

export function navigate(to, { replace = false } = {}) {
  const url = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (replace) window.location.replace(url);
  else window.location.hash = url;
}

export function useRoute() {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Scrolls the main pane back to the top whenever the route changes. */
export function useScrollReset(dep, ref) {
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [dep, ref]);
}

/** Number that eases toward its target — used only on decision metrics. */
export function useCountUp(target, duration = 620) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (typeof target !== 'number' || !Number.isFinite(target)) {
      setValue(target);
      return undefined;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    const origin = from.current ?? 0;
    let frame;
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setValue(origin + (target - origin) * eased);
      if (p < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

/** Local component state that survives a reload, for filters and sort order. */
export function useSticky(key, initial) {
  const storageKey = `recaller.ui.${key}`;
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        try {
          localStorage.setItem(storageKey, JSON.stringify(resolved));
        } catch {
          /* ignore */
        }
        return resolved;
      });
    },
    [storageKey],
  );
  return [value, set];
}

/**
 * Resolve an async value (usually an API call) and keep the last good value
 * while a new one loads. `debounce` (ms) coalesces rapid changes such as slider drags.
 */
export function useAsyncValue(fn, deps, { debounce = 0 } = {}) {
  const [state, setState] = useState({ value: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      Promise.resolve()
        .then(fn)
        .then(
          (value) => alive && setState({ value, error: null, loading: false }),
          (error) => alive && setState((s) => ({ ...s, error, loading: false })),
        );
    }, debounce);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export { useMemo, useState, useEffect, useCallback, useRef };
