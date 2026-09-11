/**
 * System & diagnostics.
 *
 * Everything needed to debug the console against its backend without leaving
 * it: backend health and effective configuration, the model provider, shipped
 * agent skills, running and recent jobs, the server's request log (with the
 * request ids the browser sent) and this browser's own call log with
 * client-side and server-side timings. The raw API is one click away at /docs.
 */

import { useEffect, useState, useCallback } from '@/hooks/index.js';
import { diagnostics, clientLog } from '@/services/api.js';
import { Card, PageHead, Empty, Icon } from '@/components/ui.jsx';

export default function System() {
  const [health, setHealth] = useState(null);
  const [config, setConfig] = useState(null);
  const [skills, setSkills] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [requests, setRequests] = useState([]);
  const [probe, setProbe] = useState(null);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(true);
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [h, c, s, j, r] = await Promise.all([
        diagnostics.health(),
        diagnostics.config(),
        diagnostics.skills(),
        diagnostics.jobs(),
        diagnostics.requests(80),
      ]);
      setHealth(h);
      setConfig(c);
      setSkills(s);
      setJobs(j);
      setRequests(r);
      setError(null);
    } catch (err) {
      setError(err);
    }
    tick((n) => n + 1);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(async () => {
      try {
        setJobs(await diagnostics.jobs());
        setRequests(await diagnostics.requests(80));
      } catch (err) {
        setError(err);
      }
      tick((n) => n + 1);
    }, 2500);
    return () => clearInterval(t);
  }, [live]);

  return (
    <div className="page" data-testid="system-page">
      <PageHead
        eyebrow="Operations"
        title="System & diagnostics"
        sub="Live state of the Python backend this console is talking to. Every API call carries an X-Request-ID; failures show the same id in the console banner, in the request log below, and in the server's response headers."
        actions={
          <>
            <button type="button" className="btn" onClick={refresh}>
              <Icon name="replay" size={14} />
              Refresh
            </button>
            <button type="button" className="btn" aria-pressed={live} onClick={() => setLive((v) => !v)}>
              {live ? 'Live: on' : 'Live: off'}
            </button>
            <a className="btn btn--primary" href="/docs" target="_blank" rel="noreferrer">
              API docs
            </a>
          </>
        }
      />

      {error && (
        <div role="alert" className="card" style={{ marginBottom: 14, padding: '10px 14px' }}>
          <b style={{ color: 'var(--red)' }}>{error.code}</b> {error.message}
        </div>
      )}

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <Stat label="Backend" value={health?.status === 'ok' ? 'HEALTHY' : '—'} tone={health?.status === 'ok' ? 'good' : 'bad'} sub={health ? `up ${Math.round(health.uptime_s)}s` : ''} testid="stat-backend" />
        <Stat
          label="Model"
          value={health?.llm?.enabled ? 'ENABLED' : 'OFF'}
          tone={health?.llm?.enabled ? 'acc' : 'neutral'}
          sub={health?.llm?.enabled ? `${health.llm.provider} · ${health.llm.model}` : 'deterministic only'}
          testid="stat-llm"
        />
        <Stat
          label="Documents"
          value={health?.documents?.engine ?? '—'}
          sub={health ? `v${health.documents.version} · OCR ${health.documents.ocr ? 'on' : 'off'}` : ''}
          testid="stat-docs"
        />
        <Stat label="Jobs running" value={health?.jobs?.running ?? '—'} sub={health ? `${health.jobs.subscribers} stream(s) open` : ''} testid="stat-jobs" />
      </div>

      <div className="grid grid--2" style={{ marginBottom: 16 }}>
        <Card title="Configuration" eyebrow="No secrets">
          {config ? (
            <table className="kv">
              <tbody>
                {Object.entries(config.settings).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                      {String(v)}
                    </td>
                  </tr>
                ))}
                {Object.entries(config.db.counts).map(([k, v]) => (
                  <tr key={k}>
                    <td>rows · {k}</td>
                    <td className="mono">{v}</td>
                  </tr>
                ))}
                <tr>
                  <td>llm mode</td>
                  <td className="mono">{config.llm?.mode ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <Empty title="Loading…" />
          )}
        </Card>

        <Card title="Agent skills" eyebrow="recaller/ai/hermes/skills">
          {skills.length === 0 ? (
            <Empty title="No skills" />
          ) : (
            <div className="stack stack--sm">
              {skills.map((s) => (
                <div key={s.name} data-testid={`skill-${s.name}`}>
                  <div style={{ fontWeight: 550, fontSize: 13 }}>
                    {s.name} <span className="mono dim" style={{ fontSize: 11 }}>v{s.version ?? '—'} · {s.license ?? '—'}</span>
                  </div>
                  <div className="sub" style={{ fontSize: 12 }}>
                    {s.description}
                  </div>
                  {s.references.length > 0 && (
                    <div className="mono dim" style={{ fontSize: 11 }}>
                      references: {s.references.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="divider" />
          <button
            type="button"
            className="btn btn--sm"
            onClick={async () => setProbe(await diagnostics.probe())}
            data-testid="probe-endpoints"
          >
            Probe endpoints
          </button>
          {probe && (
            <table className="kv" style={{ marginTop: 10 }}>
              <tbody>
                {probe.map((p) => (
                  <tr key={p.path}>
                    <td className="mono">{p.path}</td>
                    <td className="mono" style={{ color: p.ok ? 'var(--emerald)' : 'var(--red)' }}>
                      {p.ok ? 'ok' : p.error} · {p.ms}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Jobs" eyebrow="GET /api/diagnostics/jobs" flush style={{ marginBottom: 16 }}>
        <LogTable
          empty="No jobs yet — start underwriting a file."
          rows={jobs}
          cols={[
            ['id', (j) => j.id],
            ['application', (j) => j.app_id],
            ['kind', (j) => j.kind],
            ['status', (j) => <Status ok={j.status !== 'FAILED'} text={j.status} />],
            ['result', (j) => j.result_status ?? '—'],
            ['started', (j) => j.started_at?.slice(11, 23)],
            ['events', (j) => j.events],
            ['error', (j) => j.error ?? ''],
          ]}
        />
      </Card>

      <div className="grid grid--2">
        <Card title="Server request log" eyebrow="GET /api/diagnostics/requests" flush>
          <LogTable
            empty="No requests logged."
            rows={requests}
            cols={[
              ['at', (r) => r.at.slice(11, 23)],
              ['method', (r) => r.method],
              ['path', (r) => r.path + (r.query ? `?${r.query}` : '')],
              ['status', (r) => <Status ok={r.status < 400} text={r.status} />],
              ['ms', (r) => r.ms],
              ['request id', (r) => r.request_id],
              ['error', (r) => r.error_code ?? (r.stream ? 'stream' : '')],
            ]}
          />
        </Card>
        <Card title="This browser" eyebrow="client timing vs Server-Timing" flush>
          <LogTable
            empty="No calls yet."
            rows={clientLog.slice(0, 80)}
            cols={[
              ['at', (r) => r.at.slice(11, 23)],
              ['method', (r) => r.method],
              ['path', (r) => r.path],
              ['status', (r) => <Status ok={r.status > 0 && r.status < 400} text={r.status || 'net'} />],
              ['total ms', (r) => r.ms],
              ['server ms', (r) => r.serverMs ?? '—'],
              ['request id', (r) => r.requestId],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone = 'neutral', testid }) {
  const colour = tone === 'good' ? 'var(--emerald)' : tone === 'bad' ? 'var(--red)' : tone === 'acc' ? 'var(--acc)' : 'var(--text)';
  return (
    <div className="metric" data-testid={testid}>
      <div className="metric__label">{label}</div>
      <div className="metric__value" style={{ color: colour, fontSize: 20 }}>
        {value}
      </div>
      <div className="metric__sub">{sub}</div>
    </div>
  );
}

function Status({ ok, text }) {
  return <span style={{ color: ok ? 'var(--emerald)' : 'var(--red)' }}>{text}</span>;
}

function LogTable({ rows, cols, empty }) {
  if (!rows.length) {
    return (
      <div style={{ padding: 16 }}>
        <Empty title={empty} />
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto', maxHeight: 420 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }} className="mono">
        <thead>
          <tr>
            {cols.map(([h]) => (
              <th key={h} style={{ textAlign: 'left', padding: '7px 10px', borderBottom: '1px solid var(--line)', color: 'var(--text-3)', fontWeight: 500, position: 'sticky', top: 0, background: 'var(--surface)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.request_id ?? row.requestId ?? row.id ?? i}>
              {cols.map(([h, get]) => (
                <td key={h} style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>
                  {get(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
