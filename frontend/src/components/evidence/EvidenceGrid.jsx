/**
 * Evidence, grouped by the source that produced it. Every field carries the
 * document it was read from, the page, and the confidence the extraction layer
 * assigned — so an officer can always ask "says who?".
 */

import { useState } from 'react'
import { LimitBar, Panel, Tag } from '@/components/common/ui.jsx'
import { DASH, evidenceValue, num, pct } from '@/lib/format'

const GROUPS = [
  { prefix: 'applicant', label: 'KYC', hint: 'Aadhaar · PAN · licence' },
  { prefix: 'bank', label: 'Bank', hint: 'Statement' },
  { prefix: 'platform', label: 'Platform', hint: 'Settlement earnings' },
  { prefix: 'invoice', label: 'Invoice', hint: 'Dealer' },
  { prefix: 'informant', label: 'Informant', hint: 'Informal-lender reference' },
]

const PROVENANCE_KIND = {
  EXTRACTED: 'ai',
  OFFICER: 'refer',
  COMPUTED: 'engine',
  POLICY: 'idle',
  DECLARED: 'idle',
  INFORMANT: 'refer',
}

/**
 * Attested evidence answers to its own floors. Scoring it against the
 * extraction floors would paint every sound informal-lender reference red,
 * because a signed statement is capped below those floors by construction —
 * the officer would learn to ignore the colour.
 */
function floorFor(f, thresholds) {
  const attested = f.provenance === 'INFORMANT' || f.attested
  if (attested) {
    return f.critical
      ? (thresholds.attested_critical_field_threshold ?? 0.66)
      : (thresholds.attested_field_threshold ?? 0.5)
  }
  return f.critical ? thresholds.critical_field_threshold : thresholds.field_threshold
}

function confidenceKind(f, thresholds) {
  if (f.provenance === 'OFFICER') return 'approve'
  const floor = floorFor(f, thresholds)
  return f.confidence < floor ? 'reject' : f.confidence < floor + 0.08 ? 'refer' : 'approve'
}

function FieldRow({ field, thresholds }) {
  const [open, setOpen] = useState(false)
  const kind = confidenceKind(field, thresholds)

  return (
    <li className={`efield efield--${kind}`}>
      <button
        type="button"
        className="efield__main"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="efield__label">
          {field.label}
          {field.critical ? <span className="efield__crit caps">critical</span> : null}
        </span>
        <span className="efield__value tnum">{evidenceValue(field.value, field.type)}</span>
        <span className="efield__conf">
          <LimitBar value={field.confidence} kind={kind} label={`Confidence ${pct(field.confidence, 0)}`} />
          <span className="efield__pct tnum">{pct(field.confidence, 0)}</span>
        </span>
      </button>

      {open ? (
        <div className="efield__detail">
          <Tag kind={PROVENANCE_KIND[field.provenance] ?? 'idle'}>{field.provenance}</Tag>
          <span className="mono t3">{field.path}</span>
          {field.citation ? (
            <span className="efield__cite">
              {field.citation.document} · page {num(field.citation.page)} ·{' '}
              <em>{field.citation.snippet}</em>
            </span>
          ) : (
            <span className="efield__cite t3">No citation — value was supplied, not read.</span>
          )}
        </div>
      ) : null}
    </li>
  )
}

export default function EvidenceGrid({ evidence, thresholds }) {
  const fields = Object.values(evidence.fields ?? {})
  const stats = evidence.stats ?? {}

  return (
    <Panel
      title="Evidence"
      meta={`${num(fields.length)} fields · mean confidence ${pct(stats.mean_confidence, 0)} · ${evidence.extraction_hash ?? DASH}`}
    >
      <div className="egrid">
        {GROUPS.map((g) => {
          const group = fields.filter((f) => f.path.startsWith(`${g.prefix}.`))
          return (
            <section key={g.prefix} className="egroup">
              <header className="egroup__head">
                <h4 className="egroup__title">{g.label}</h4>
                <p className="egroup__hint caps t4">{g.hint}</p>
              </header>
              {group.length ? (
                <ul className="egroup__list">
                  {group.map((f) => (
                    <FieldRow key={f.path} field={f} thresholds={thresholds} />
                  ))}
                </ul>
              ) : (
                <p className="egroup__empty">
                  {g.prefix === 'informant'
                    ? 'No informal-lender reference was recorded for this borrower.'
                    : 'No document of this type was supplied.'}
                </p>
              )}
            </section>
          )
        })}
      </div>
    </Panel>
  )
}
