import { useReveal } from '../animations/useGsap'
import { APPROVED, POLICY } from '../data/live'
import { inr, pct } from '../lib/format'
import './editorial.css'

/**
 * "The model never calculates the money."
 *
 * Three modules, each showing input → rule → output for the file in the hero.
 * The figures are the engine's; the section exists so a reader can see exactly
 * where a number came from without being shown a formula.
 */
export default function Deterministic() {
  const scope = useReveal('[data-reveal]', { y: 36, stagger: 0.08 })

  const modules = [
    {
      key: 'FOIR',
      result: pct(APPROVED.foir),
      rule: `Ceiling ${pct(POLICY.foirCap, 0)}`,
      inputs: [
        ['Verified income', inr(APPROVED.income)],
        ['Existing obligations', inr(APPROVED.obligations)],
        ['Proposed EMI', inr(APPROVED.emi, { decimals: 2 })],
      ],
    },
    {
      key: 'EMI',
      result: inr(APPROVED.emi, { decimals: 2 }),
      rule: `${APPROVED.rate}% p.a. reducing`,
      inputs: [
        ['Sanctioned amount', inr(APPROVED.amount)],
        ['Tenure', `${APPROVED.tenure} months`],
        ['Residual after EMI', inr(APPROVED.disposable, { decimals: 2 })],
      ],
    },
    {
      key: 'LTV',
      result: pct(APPROVED.ltv),
      rule: `Ceiling ${pct(POLICY.ltvCap, 0)}`,
      inputs: [
        ['Sanctioned amount', inr(APPROVED.amount)],
        ['Asset value used', inr(APPROVED.assetValue)],
        ['Basis', 'Lower of invoice and valuation'],
      ],
    },
  ]

  return (
    <section className="ed ed--light" data-tone="light" ref={scope} aria-labelledby="ed-det">
      <div className="wrap">
        <header className="ed__head">
          <p className="eyebrow" data-reveal>
            Deterministic computation
          </p>
          <h2 className="statement" id="ed-det" data-reveal>
            The model never calculates the money<em>.</em>
          </h2>
          <p className="measure" data-reveal>
            FOIR, EMI and LTV come from policy code, given evidence that has already cleared a confidence
            floor. The model reads documents and writes the memo. It never produces a figure, and it cannot
            reach the engine that does.
          </p>
        </header>

        <div className="mods">
          {modules.map((m) => (
            <article className="mod" key={m.key} data-reveal>
              <header className="mod__head">
                <span className="mod__key">{m.key}</span>
                <span className="mod__rule">{m.rule}</span>
              </header>
              <strong className="mod__result tnum">{m.result}</strong>
              <dl className="mod__inputs">
                {m.inputs.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd className="tnum">{v}</dd>
                  </div>
                ))}
              </dl>
              <span className="mod__stamp">Computed</span>
            </article>
          ))}
        </div>

        <p className="ed__aside" data-reveal>
          <b className="mono">{POLICY.rules}</b> rules, versioned as <b className="mono">{POLICY.id} v{POLICY.version}</b>.
          Change a cutoff and the same frozen evidence is judged again — no redeploy, no code change.
        </p>
      </div>
    </section>
  )
}
