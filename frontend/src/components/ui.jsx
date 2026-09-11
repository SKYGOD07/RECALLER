export function SectionLabel({ index, children }) {
  return (
    <div className="label">
      <span className="label__idx">{index}</span>
      <span className="label__rule" />
      <span>{children}</span>
    </div>
  )
}

export function Status({ kind = 'neutral', pulse = false, children }) {
  return (
    <span className={`pill pill--${kind}${pulse ? ' pill--pulse' : ''}`}>
      <i className="pill__dot" />
      {children}
    </span>
  )
}

export function Button({ href, children, variant = 'primary', icon = 'arrow', size, className = '', ...rest }) {
  return (
    <a
      href={href}
      className={`btn btn--${variant}${size ? ` btn--${size}` : ''} ${className}`}
      {...rest}
    >
      <span className="btn__label">{children}</span>
      <span className={`btn__icon btn__icon--${icon}`} aria-hidden="true">
        {icon === 'download' ? <IconDownload /> : <IconArrow />}
      </span>
    </a>
  )
}

export function Logo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="6.5" stroke="currentColor" strokeOpacity="0.28" />
      <path
        d="M7.5 17.5v-11h5a3.4 3.4 0 0 1 0 6.8h-5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.6 13.3 17 17.5" stroke="var(--acc)" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function IconArrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconDownload() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5v8M4 7l4 4 4-4M3 13.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconCheck() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconDoc() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 1.75h5.5L12.5 4.8v9.45H4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.25 1.9V5h3.1M6 8h4.5M6 10.5h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
