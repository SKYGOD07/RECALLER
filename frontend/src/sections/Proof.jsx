import { useReveal } from '../animations/useGsap'
import { CONTRADICTED } from '../data/live'
import { inr, pct } from '../lib/format'
import './editorial.css'

const side = (s) => (s.kind === 'money' ? inr(s.value, { decimals: 2 }) : String(s.value))

/**
 * The reconciliation proof, set light and large.
 *
 * These are the four blocking findings the engine actually returns for
 * RCL-2026-0433 — including a bank account in someone else's name. The point of
 * the section is that the contradiction *is* the decision, so each row shows
 * both sources and the tolerance that judged them.
 */
export default function Proof() {
  const scope = useReveal('[data-reveal]', { y: 36, stagger: 0.07 })

  return (
    <section className="ed ed--light ed--tight" data-tone="light" ref={scope} aria-labelledby="ed-proof">
      <div className="wrap">
        <header className="ed__head ed__head--split">
          <div>
            <p className="eyebrow" data-reveal>
              Reconciliation
            </p>
            <h2 className="statement" id="ed-proof" data-reveal>
              Four documents. One version of the truth<em>.</em>
            </h2>
          </div>
          <p className="measure measure--tight" data-reveal>
            Cross-document reconciliation catches what single-document underwriting cannot: the same fact,
            stated differently in two places. Every check carries its own tolerance, and a blocking finding
            stops the file before a number is ever produced.
          </p>
        </header>

        <div className="proof" data-reveal>
          <div className="proof__bar">
            <span className="proof__file mono">{CONTRADICTED.id}</span>
            <span className="proof__who">{CONTRADICTED.borrower}</span>
            <span className="proof__verdict">Declined</span>
          </div>

          <ul className="proof__rows">
            {CONTRADICTED.findings.map((f) => (
              <li className="prow" key={f.code}>
                <span className="prow__code mono">{f.code}</span>

                <span className="prow__pair">
                  <span className="prow__side">
                    <span className="prow__k">{f.left.field}</span>
                    <span className="prow__v">{side(f.left)}</span>
                    <span className="prow__src mono">{f.left.source}</span>
                  </span>

                  <span className="prow__link" aria-hidden="true">
                    <i />
                    <em>vs</em>
                    <i />
                  </span>

                  <span className="prow__side">
                    <span className="prow__k">{f.right.field}</span>
                    <span className="prow__v">{side(f.right)}</span>
                    <span className="prow__src mono">{f.right.source}</span>
                  </span>
                </span>

                <span className="prow__verdict">
                  <span className="prow__status">{f.status}</span>
                  <span className="prow__tol mono">
                    {f.similarity !== undefined
                      ? `${pct(f.similarity, 0)} similarity`
                      : `${pct(f.deltaPct, 0)} apart`}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <p className="proof__foot">
            {CONTRADICTED.codes.map((c) => (
              <span key={c.code}>
                <b className="mono">{c.code}</b> {c.text}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  )
}
