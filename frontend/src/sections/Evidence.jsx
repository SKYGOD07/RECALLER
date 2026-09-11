import { useReveal } from '../animations/useGsap'
import { SIGNALS } from '../data/live'
import './editorial.css'

const CARDS = [
  { tag: 'KYC', title: 'Identity', value: 'Aadhaar · PAN', note: 'Name, age, address — read, never inferred.' },
  { tag: 'Bank', title: 'Cash flow', value: '6 months', note: 'Qualifying credits, cash deposits, returned debits.' },
  { tag: 'UPI', title: 'Settlements', value: 'Daily', note: 'The rhythm a salary slip would never show.' },
  { tag: 'Platform', title: 'Earnings', value: 'Net of fees', note: 'What the aggregator actually paid out.' },
  { tag: 'Invoice', title: 'Asset value', value: 'On-road', note: 'Ex-showroom, insurance, registration, subsidy.' },
]

/**
 * "Everything you can verify" — the first light section, and the turn from the
 * cinematic hero into the product. The five cards are the document types the
 * pipeline actually reads; the strip beneath names signals, not partners.
 */
export default function Evidence() {
  const scope = useReveal('[data-reveal]', { y: 40, stagger: 0.08 })

  return (
    <section className="ed ed--light" id="how" data-tone="light" ref={scope} aria-labelledby="ed-evidence">
      <div className="wrap">
        <header className="ed__head">
          <p className="eyebrow" data-reveal>
            Evidence
          </p>
          <h2 className="statement" id="ed-evidence" data-reveal>
            Everything you can verify<em>.</em>
          </h2>
          <p className="measure" data-reveal>
            Thin-file borrowers are not invisible — they are simply documented somewhere other than a payslip.
            RECALLER reads the five sources they actually produce, and records where every value came from.
          </p>
        </header>

        <ul className="ecards">
          {CARDS.map((c, i) => (
            <li className="ecard" key={c.tag} data-reveal style={{ '--offset': `${(i % 2) * 26}px` }}>
              <span className="ecard__tag">{c.tag}</span>
              <h3 className="ecard__title">{c.title}</h3>
              <p className="ecard__value">{c.value}</p>
              <p className="ecard__note">{c.note}</p>
            </li>
          ))}
        </ul>

        <div className="signals" data-reveal>
          <p className="signals__lead">Built around the signals lenders already hold</p>
          <ul className="signals__list">
            {SIGNALS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
