/** Small notification store. One list, one subscriber set, no dependencies. */

let items = []
const listeners = new Set()

const emit = () => {
  listeners.forEach((fn) => fn())
}

export const subscribeToasts = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getToasts = () => items

let seq = 0

export function toast(message, { kind = 'info', ttl = 4200 } = {}) {
  const id = ++seq
  items = [...items, { id, message, kind }]
  emit()
  if (ttl) setTimeout(() => dismissToast(id), ttl)
  return id
}

export function dismissToast(id) {
  items = items.filter((t) => t.id !== id)
  emit()
}
