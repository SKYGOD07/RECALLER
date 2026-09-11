import { useState } from 'react'
import { EASE_OUT, FULL, gsap } from '../animations/gsap'
import { useGsapScope } from '../animations/useGsap'
import { STRENGTH } from '../data/live'
import './strength.css'

const CASES = [
  { key: 'clean', label: 'Clean file', hint: 'Everything agrees' },
  { key: 'contradicted', label: 'Contradicted', hint: 'Four documents disagree' },
  { key: 'held', label: 'Held at the gate', hint: 'Read too uncertainly' },
]

/**
 * Evidence strength, computed in front of you.
 *
 * The four components arrive one at a time — the inputs, then the bar, then the
 * points, then the running total — because that is the order the engine
 * evaluates them in, and watching it is the only way to see that the score is
 * assembled from facts rather than asserted.
 *
 * Nothing here is computed by React. Every figure is `computeEvidenceStrength()`
 * output carried in `data/live.js`; the animation controls *when* a number is
 * revealed, never what it is. Switching case restarts the sequence against a
 * different engine result.
 */
export default function Strength() {
  const [caseKey, setCaseKey] = useState('clean')
  const result = STRENGTH[caseKey]

  const scope = useGsapScope(
    ({ mm, scope: root }) => {
      const q = gsap.utils.selector(root)

      mm.add(FULL, () => {
        // Resting state is the finished state, so a tab that never animates
        // still shows the real score.
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

        const total = { value: 0 }
        const readout = root.querySelector('[data-total]')
        const rows = q('[data-row]')

        const tl = gsap.timeline({
          defaults: { ease: EASE_OUT },
          scrollTrigger: { trigger: root, start: 'top 68%' },
        })

        tl.from(q('[data-meter]'), { scaleX: 0, transformOrigin: 'left center', duration: 0.5 }, 0)

        rows.forEach((row, i) => {
          const at = i * 0.42
          const points = Number(row.dataset.points) || 0
          const fill = row.querySelector('[data-fill]')
          const value = row.querySelector('[data-points]')
          const running = { value: 0 }

          tl.from(row, { opacity: 0, y: 16, duration: 0.45 }, at)
            .from(row.querySelector('[data-inputs]'), { opacity: 0, duration: 0.35 }, at + 0.08)
            .fromTo(
              fill,
              { scaleX: 0 },
              { scaleX: points / 25, duration: 0.7, transformOrigin: 'left center' },
              at + 0.16,
            )
            // The points tick up to the engine's figure, then snap to the exact
            // string so nothing is left rounded by the animation.
            .to(
              running,
              {
                value: points,
                duration: 0.7,
                onUpdate: () => {
                  value.textContent = running.value.toFixed(running.value % 1 === 0 ? 0 : 2)
                },
                onComplete: () => {
                  value.textContent = String(points)
                },
              },
              at + 0.16,
            )
            .to(
              total,
              {
                value: `+=${points}`,
                duration: 0.7,
                onUpdate: () => {
                  if (readout) readout.textContent = String(Math.round(total.value))
                },
              },
              at + 0.16,
            )
        })

        tl.from(q('[data-band]'), { opacity: 0, y: 10, duration: 0.5 }, rows.length * 0.42 + 0.1)
      })
    },
    [caseKey],
  )

  return (
    <section className="ed ed--dark st" data-tone="dark" ref={scope} aria-labelledby="ed-strength">
      <div className="wrap">
        <header className="ed__head ed__head--split">
          <div>
            <p className="eyebrow">Evidence strength</p>
            <h2 className="statement" id="ed-strength">
              How much of this file do we actually know<em>?</em>
            </h2>
          </div>
          <p className="measure measure--tight">
            FOIR and LTV answer whether the borrower can repay. Nothing answers the question an officer
            asks first — so we built one. Four components of twenty-five, every one a fact already
            extracted, every threshold read from the policy document. It explains a decision. It never
            makes one.
          </p>
        </header>

        <div className="st__grid">
          <div className="st__panel">
            <div className="st__bar">
              <span className="st__file mono">{result.id}</span>
              <div className="st__cases" role="tablist" aria-label="Evidence case">
                {CASES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="tab"
                    aria-selected={caseKey === c.key}
                    className={`st__case${caseKey === c.key ? ' is-active' : ''}`}
                    onClick={() => setCaseKey(c.key)}
                  >
                    {c.label}
                    <span>{c.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <ul className="st__rows">
              {result.components.map((c) => (
                <li className="strow" key={c.key} data-row data-points={c.points}>
                  <span className="strow__label">{c.label}</span>
                  <span className="strow__track">
                    {/* Resting state is the true proportion, so a bar that is
                        never animated still tells the truth. GSAP animates from
                        zero and lands on exactly this value. */}
                    <span
                      className="strow__fill"
                      data-fill
                      style={{ transform: `scaleX(${c.points / c.max})` }}
                    />
                  </span>
                  <span className="strow__points tnum">
                    <b data-points>{c.points}</b>
                    <i>/{c.max}</i>
                  </span>
                  <span className="strow__detail" data-inputs>
                    {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <aside className="st__score">
            <span className="st__meter" data-meter aria-hidden="true" />
            <span className="caps t3">Evidence strength</span>
            <strong className="st__total tnum">
              <span data-total>{result.score}</span>
              <i>/100</i>
            </strong>
            <span className={`st__band st__band--${result.band.toLowerCase()}`} data-band>
              {result.band}
            </span>
            {result.afterAssist ? (
              <p className="st__lift">
                Confirming the held fields in Assist takes this file to{' '}
                <b className="tnum">{result.afterAssist.score}</b> — the officer's answer is itself
                evidence.
              </p>
            ) : null}

            <p className="st__note">
              Not a credit score. It scores the file, not the borrower, and no policy rule reads it —
              a weak file is a reason to look harder, not a reason to decline.
            </p>
          </aside>
        </div>
      </div>
    </section>
  )
}
