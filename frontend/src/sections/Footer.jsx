import { Logo } from '../components/ui'
import { SITE } from '../data/site'
import './footer.css'

const LINKS = [
  ['Product', '#product'],
  ['Trust', '#trust'],
  ['Download', '#download'],
  ['GitHub', SITE.github],
]

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer__top">
        <a href="#top" className="footer__brand" aria-label="RECALLER — back to top">
          <Logo size={30} />
          <span>RECALLER</span>
        </a>
        <p className="footer__statement">
          AI credit intelligence.
          <br />
          <span className="t3">Built for evidence.</span>
          <br />
          <span className="t3">Built for decisions.</span>
        </p>
        <nav className="footer__links" aria-label="Footer">
          {LINKS.map(([label, href]) => {
            const external = href.startsWith('http')
            return (
              <a key={label} href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                {label}
                {external && <span aria-hidden="true"> ↗</span>}
              </a>
            )
          })}
        </nav>
      </div>
      <div className="wrap footer__bottom">
        <span>© 2026 RECALLER</span>
        <span>All applicants, documents and figures shown are illustrative.</span>
        <a href="#top">Back to top ↑</a>
      </div>
      <div className="footer__giant" aria-hidden="true">
        RECALLER
      </div>
    </footer>
  )
}
