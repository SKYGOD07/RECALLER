import { useToasts } from '@/hooks/console'
import { dismissToast } from '@/store/toasts'

export default function Toasts() {
  const items = useToasts()
  if (!items.length) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          <i className="toast__dot" aria-hidden="true" />
          <span className="toast__text">{t.message}</span>
          <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
