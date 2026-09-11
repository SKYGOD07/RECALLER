import { useCountUp, useReveal } from '../animations/useGsap'
import { FACTS } from '../data/live'
import './editorial.css'

/**
 * The closing statistics.
 *
 * Every figure here describes the system, not its traction: rules in the policy
 * document, stages in the ledger, cases in the book. There are no customers, no
 * funding and no accuracy claims, because none of those exist to claim.
 *
 * The true value is written in the DOM and `data-count` drives the roll-up, so
 * a reduced-motion reader still sees the real number.
 */
export default function Facts() {
  const reveal = useReveal('[data-reveal]', { y: 30, stagger: 0.07 })
  useCountUp('[data-count]')

  return (
    <section className="ed ed--dark ed--facts" data-tone="dark" ref={reveal} aria-labelledby="ed-facts">
      <div className="wrap">
        <header className="ed__head ed__head--split">
          <div>
            <p className="eyebrow" data-reveal>
              By the system
            </p>
            <h2 className="statement" id="ed-facts" data-reveal>
              Explainable by design<em>.</em>
            </h2>
          </div>
          <p className="measure measure--tight" data-reveal>
            Numbers come from code. Every decision references the evidence behind it. Any decision can be
            reconstructed from frozen material, months later, by someone who was not there.
          </p>
        </header>

        <ul className="facts">
          {FACTS.map((f) => (
            <li className="fact" key={f.label} data-reveal>
              <strong className="fact__value tnum" data-count={f.value}>
                {f.value}
              </strong>
              <span className="fact__label">{f.label}</span>
              <span className="fact__detail">{f.detail}</span>
            </li>
          ))}
        </ul>

        <figure className="voice" data-reveal>
          <blockquote>
            “I can see what changed the decision — not just the decision itself.”
          </blockquote>
          <figcaption>
            <span className="voice__who">The loan officer view</span>
            <span className="voice__tag">Product demo · not a customer quote</span>
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
