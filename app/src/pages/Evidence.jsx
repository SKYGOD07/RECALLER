/**
 * Screen 4 — Evidence.
 *
 * Every field the extraction layer produced, with its confidence, the document
 * it came from and the page it was read on. Confidence is never hidden and
 * never rounded away: a field that scraped through at 0.81 looks different
 * from one that read cleanly at 0.97, because the officer's attention should
 * go to the first.
 */

import { useMemo, useState, useSticky } from '@/hooks/index.js';
import { Card, Confidence, Icon, PageHead, Money, Empty } from '@/components/ui.jsx';
import { POLICY } from '@/services/api.js';
import { formatINR } from '@core/money.js';
import { PROVENANCE } from '@core/constants.js';

const GROUPS = [
  { id: 'applicant', label: 'Applicant & KYC' },
  { id: 'bank', label: 'Bank statement' },
  { id: 'platform', label: 'Platform earnings' },
  { id: 'invoice', label: 'Dealer invoice' },
];

export default function Evidence({ application, record }) {
  const [filter, setFilter] = useSticky('evidence.filter', 'all');
  const [open, setOpen] = useState(null);

  const fields = useMemo(() => Object.values(record.evidence.fields), [record]);
  const stats = record.evidence.stats;

  const lowCount = fields.filter((f) => isLow(f)).length;
  const officerCount = fields.filter((f) => f.provenance === PROVENANCE.OFFICER).length;

  const shown = fields.filter((f) => {
    if (filter === 'low') return isLow(f);
    if (filter === 'officer') return f.provenance === PROVENANCE.OFFICER;
    if (filter === 'critical') return f.critical || POLICY.confidence.critical_fields.includes(f.path);
    return true;
  });

  return (
    <div className="page">
      <PageHead
        eyebrow="Extracted evidence"
        title="Evidence"
        sub={`${fields.length} fields read from ${Object.keys(record.evidence.byDocument).length} documents by the ${stats.adapter} extraction adapter. Confidence below the policy floor is flagged, not resolved silently.`}
        actions={
          <div className="seg">
            {[
              ['all', `All ${fields.length}`],
              ['critical', 'Critical'],
              ['low', `Low confidence ${lowCount ? `· ${lowCount}` : ''}`],
              ['officer', `Officer ${officerCount ? `· ${officerCount}` : ''}`],
            ].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <Stat label="Fields extracted" value={fields.length} sub={`adapter: ${stats.adapter}`} />
        <Stat
          label="Mean confidence"
          value={`${(stats.mean_confidence * 100).toFixed(1)}%`}
          sub={`lowest ${(stats.min_confidence * 100).toFixed(1)}%`}
          tone={stats.mean_confidence > 0.9 ? 'good' : 'warn'}
        />
        <Stat
          label="Below floor"
          value={lowCount}
          tone={lowCount ? 'bad' : 'good'}
          sub={`floor ${POLICY.confidence.field_threshold * 100}% · critical ${POLICY.confidence.critical_field_threshold * 100}%`}
        />
        <Stat
          label="Officer-confirmed"
          value={officerCount}
          tone={officerCount ? 'acc' : 'neutral'}
          sub={officerCount ? 'Human-verified values' : 'No intervention needed'}
        />
      </div>

      <div className="stack">
        {GROUPS.map((group) => {
          const rows = shown.filter((f) => f.path.startsWith(`${group.id}.`));
          if (!rows.length) return null;
          const doc = rows.find((r) => r.citation?.document)?.citation?.document;
          return (
            <Card key={group.id} title={group.label} eyebrow={doc} flush>
              <div className="tablewrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Value</th>
                      <th>Confidence</th>
                      <th>Source</th>
                      <th>Citation</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => {
                      const low = isLow(f);
                      const expanded = open === f.path;
                      return (
                        <FieldRow
                          key={f.path}
                          field={f}
                          low={low}
                          expanded={expanded}
                          onToggle={() => setOpen(expanded ? null : f.path)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
        {shown.length === 0 && (
          <Card>
            <Empty title="Nothing matches this filter">Every field in this bundle cleared the confidence floor.</Empty>
          </Card>
        )}
      </div>
    </div>
  );
}

function FieldRow({ field: f, low, expanded, onToggle }) {
  const floor = f.critical || POLICY.confidence.critical_fields.includes(f.path)
    ? POLICY.confidence.critical_field_threshold
    : POLICY.confidence.field_threshold;

  const rowClass = low ? 'row--low' : f.provenance === PROVENANCE.OFFICER ? 'row--officer' : '';

  return (
    <>
      <tr className={`clickable ${rowClass}`} onClick={onToggle}>
        <td>
          <div className="t-strong">{f.label}</div>
          <div className="dim mono" style={{ fontSize: 10.5 }}>
            {f.path}
            {f.critical && <span style={{ color: 'var(--amber)' }}> · critical</span>}
          </div>
        </td>
        <td style={{ maxWidth: 320 }}>{renderValue(f)}</td>
        <td>
          {f.provenance === PROVENANCE.OFFICER ? (
            <span className="pill pill--acc">Officer</span>
          ) : f.provenance === PROVENANCE.DECLARED ? (
            <span className="pill pill--neutral">Declared</span>
          ) : (
            <Confidence value={f.confidence} floor={floor} />
          )}
        </td>
        <td className="mono" style={{ fontSize: 11.5 }}>
          {f.citation?.document ?? '—'}
        </td>
        <td className="dim mono" style={{ fontSize: 11 }}>
          {f.citation?.page ? `p.${f.citation.page}` : '—'}
        </td>
        <td className="right">
          <Icon name="chevron" size={12} className="dim" />
        </td>
      </tr>
      {expanded && (
        <tr className="fade-in">
          <td colSpan={6} style={{ background: 'var(--surface-2)', padding: 16 }}>
            <div className="grid grid--2">
              <div>
                <div className="eyebrow" style={{ marginBottom: 7 }}>
                  Extraction detail
                </div>
                <table className="kv kv--left">
                  <tbody>
                    <tr>
                      <td>Provenance</td>
                      <td>{f.provenance}</td>
                    </tr>
                    <tr>
                      <td>Type</td>
                      <td>{f.type}</td>
                    </tr>
                    <tr>
                      <td>Confidence</td>
                      <td>{(f.confidence * 100).toFixed(2)}%</td>
                    </tr>
                    <tr>
                      <td>Policy floor</td>
                      <td>{(floor * 100).toFixed(0)}%</td>
                    </tr>
                    {f.raw && (
                      <tr>
                        <td>Raw text</td>
                        <td className="mono">{f.raw}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 7 }}>
                  Citation
                </div>
                <div className="cmpbox">
                  <div className="cmpbox__field">
                    {f.citation?.document} · page {f.citation?.page}
                  </div>
                  <div style={{ fontSize: 13 }}>{f.citation?.snippet ?? '—'}</div>
                </div>
                {f.superseded && (
                  <div className="cmpbox" style={{ marginTop: 10, borderColor: 'rgba(198,255,77,0.3)' }}>
                    <div className="cmpbox__field">Officer intervention · {f.officer?.action}</div>
                    <div style={{ fontSize: 13 }}>
                      was <b>{String(f.superseded.value)}</b> at {(f.superseded.confidence * 100).toFixed(1)}% →{' '}
                      <b>{String(f.value)}</b>
                    </div>
                    {f.officer?.note && <div className="cmpbox__src">{f.officer.note}</div>}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function renderValue(f) {
  if (f.value === null || f.value === undefined) return <span className="dim">— rejected by officer</span>;
  if (Array.isArray(f.value)) {
    if (!f.value.length) return <span className="dim">none</span>;
    if (typeof f.value[0] === 'object') {
      return (
        <div className="stack stack--sm">
          {f.value.map((v, i) => (
            <div key={i} style={{ fontSize: 12.5 }}>
              {v.label} — <span className="num">{formatINR(v.amount, { decimals: 0 })}</span>
            </div>
          ))}
        </div>
      );
    }
    return (
      <span className="num" style={{ fontSize: 12.5 }}>
        {f.value.map((v) => formatINR(v, { decimals: 0, symbol: false })).join('  ·  ')}
      </span>
    );
  }
  if (f.type === 'money') return <Money value={f.value} decimals={0} />;
  if (f.type === 'id' || f.type === 'date') return <span className="mono">{String(f.value)}</span>;
  return <span>{String(f.value)}</span>;
}

function isLow(f) {
  if (f.provenance === PROVENANCE.OFFICER || f.provenance === PROVENANCE.DECLARED) return false;
  const floor = f.critical || POLICY.confidence.critical_fields.includes(f.path)
    ? POLICY.confidence.critical_field_threshold
    : POLICY.confidence.field_threshold;
  return f.confidence < floor;
}

function Stat({ label, value, sub, tone = 'neutral' }) {
  const colour =
    tone === 'good' ? 'var(--emerald)' : tone === 'warn' ? 'var(--amber)' : tone === 'bad' ? 'var(--red)' : tone === 'acc' ? 'var(--acc)' : 'var(--text)';
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__value" style={{ color: colour }}>
        {value}
      </div>
      <div className="metric__sub">{sub}</div>
    </div>
  );
}
