/**
 * Screen 5 — Reconciliation.
 *
 * What the documents say about each other. Each finding shows both sides of the
 * comparison with its source, the measured gap, and the tolerance it was graded
 * against — so an officer can see not just that something disagreed, but by how
 * much and against what standard.
 */

import { useSticky } from '@/hooks/index.js';
import { Card, FindingPill, PageHead, Empty, Icon } from '@/components/ui.jsx';
import { formatINR, formatPct } from '@/lib/format.js';

const ORDER = { BLOCKING: 0, MISMATCH: 1, ADVISORY: 2, MATCHED: 3 };

export default function Reconciliation({ record }) {
  const [filter, setFilter] = useSticky('recon.filter', 'all');
  const rec = record.reconciliation;

  const findings = [...rec.findings].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const shown = findings.filter((f) => {
    if (filter === 'issues') return f.status !== 'MATCHED';
    if (filter === 'blocking') return f.status === 'BLOCKING';
    return true;
  });

  return (
    <div className="page">
      <PageHead
        eyebrow="Cross-document checks"
        title="Reconciliation"
        sub="Extraction reads each document in isolation. Reconciliation asks whether they agree — and grades every disagreement against the tolerance the policy sets for that comparison."
        actions={
          <div className="seg">
            {[
              ['all', `All ${rec.total}`],
              ['issues', `Issues ${rec.blocking + rec.advisory || ''}`],
              ['blocking', `Blocking ${rec.blocking || ''}`],
            ].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <Tile label="Checks run" value={rec.total} sub="Across the bundle" />
        <Tile label="Agreed" value={rec.matched} tone="good" sub="Within tolerance" />
        <Tile
          label="Advisory"
          value={rec.advisory}
          tone={rec.advisory ? 'warn' : 'neutral'}
          sub="Needs officer judgement"
        />
        <Tile
          label="Blocking"
          value={rec.blocking}
          tone={rec.blocking ? 'bad' : 'good'}
          sub={rec.blocking ? 'Must clear before sanction' : 'None outstanding'}
        />
      </div>

      <Card flush title="Findings">
        {shown.length === 0 ? (
          <Empty title="Nothing to show">Every comparison in this bundle agreed within tolerance.</Empty>
        ) : (
          shown.map((f) => <Finding key={f.code} finding={f} />)
        )}
      </Card>
    </div>
  );
}

function Finding({ finding: f }) {
  const { left, right } = f.comparison;
  const money = left.kind === 'money';

  return (
    <div className="finding">
      <div className="finding__top">
        <span className="finding__code">{f.code}</span>
        <span className="finding__label">{f.label}</span>
        <FindingPill status={f.status} />
        {/* Severity is only worth showing when it differs from the status —
            a MISMATCH graded ADVISORY, for instance. */}
        {f.severity !== 'INFO' && f.severity !== f.status && (
          <span className="dim mono" style={{ fontSize: 10.5 }}>
            graded {f.severity.toLowerCase()}
          </span>
        )}
      </div>

      <div className="finding__delta">
        {f.similarity !== undefined ? (
          <>
            <div>similarity {formatPct(f.similarity)}</div>
            {f.tolerance && (
              <div className="dim">
                floor {formatPct(f.tolerance.advisory_score, 0)} · block {formatPct(f.tolerance.blocking_score, 0)}
              </div>
            )}
          </>
        ) : f.delta !== undefined ? (
          <>
            <div>
              Δ {money ? formatINR(f.delta) : f.delta} ({formatPct(f.delta_pct)})
            </div>
            {f.tolerance && (
              <div className="dim">
                advisory {formatPct(f.tolerance.advisory_pct, 0)} · block {formatPct(f.tolerance.blocking_pct, 0)}
              </div>
            )}
          </>
        ) : null}
      </div>

      <div className="finding__cmp">
        <Side side={left} money={money} />
        <div className="finding__vs">
          <Icon name="recon" size={14} />
        </div>
        <Side side={right} money={money} />
      </div>

      {f.note && (
        <div className="finding__note">
          {f.note}
          {f.evidence?.length ? (
            <span className="mono dim">
              {'  '}· {f.evidence.join('  ·  ')}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Side({ side, money }) {
  return (
    <div className="cmpbox">
      <div className="cmpbox__field">{side.field}</div>
      <div className="cmpbox__value">
        {side.value === null || side.value === undefined
          ? '—'
          : money
            ? formatINR(side.value)
            : String(side.value)}
      </div>
      <div className="cmpbox__src">{side.source}</div>
    </div>
  );
}

function Tile({ label, value, sub, tone = 'neutral' }) {
  const colour =
    tone === 'good' ? 'var(--emerald)' : tone === 'warn' ? 'var(--amber)' : tone === 'bad' ? 'var(--red)' : 'var(--text)';
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
