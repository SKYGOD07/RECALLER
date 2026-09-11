/**
 * AI analyst — the configured model (e.g. Nemotron 3 Ultra on Ollama Cloud) over one file.
 *
 *   Review   a supervisor delegates to KYC, income, invoice and reconciliation
 *            reviewers (delegate_task), each with read-only tools
 *   Explain  a plain-language summary, discarded if it cites a figure or reason
 *            code that is not in the record
 *   Ask      a conversation grounded in the record through read-only tools and
 *            the credit-underwriter skill, with the model's reasoning beside
 *            each answer and any figure it invented called out
 *
 * Advisory only. The verdict was made by the policy engine; nothing here changes it.
 */

import { useEffect, useState } from '@/hooks/index.js';
import { Card } from '@/components/ui.jsx';
import { LLM, askAgent, listAgentRuns, startAgentRun } from '@/services/api.js';

const SUGGESTED = [
  'Why did this file get this decision?',
  'Which evidence is weakest, and why?',
  'What should I verify before sanction?',
];

const newest = (runs, kind) => runs.find((r) => r.kind === kind); // the API lists newest first
const tokens = (u) => (u ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) : 0);

function Reasoning({ text }) {
  if (!text) return null;
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="dim" style={{ fontSize: 11, cursor: 'pointer' }}>
        Model reasoning
      </summary>
      <div className="mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap', marginTop: 4, color: 'var(--text-3)' }}>
        {text}
      </div>
    </details>
  );
}

function RunHead({ title, run }) {
  const color = run.status === 'FAILED' ? 'var(--red)' : run.status === 'DONE' ? 'var(--emerald)' : 'var(--text-3)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
      <b style={{ fontSize: 13 }}>{title}</b>
      <span className="mono" style={{ fontSize: 11, color }}>
        {run.status} · {run.model}
      </span>
    </div>
  );
}

export default function AgentPanel({ appId }) {
  const [runs, setRuns] = useState([]);
  const [chat, setChat] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState({});
  const [error, setError] = useState(null);
  const enabled = Boolean(LLM?.enabled);

  useEffect(() => {
    let live = true;
    listAgentRuns(appId)
      .then((all) => {
        if (!live) return;
        setRuns(all);
        setChat(
          all
            .filter((r) => r.kind === 'ask' && r.status === 'DONE' && r.output)
            .reverse()
            .flatMap((r) => [
              { role: 'user', content: r.output.question },
              { role: 'assistant', content: r.output.answer, run: r },
            ]),
        );
      })
      .catch((err) => live && setError(err));
    return () => {
      live = false;
    };
  }, [appId]);

  const start = async (kind) => {
    setBusy((b) => ({ ...b, [kind]: true }));
    setError(null);
    try {
      await startAgentRun(appId, kind);
      setRuns(await listAgentRuns(appId));
    } catch (err) {
      setError(err);
    }
    setBusy((b) => ({ ...b, [kind]: false }));
  };

  const ask = async (question) => {
    const q = question.trim();
    if (!q || busy.ask) return;
    const history = chat.slice(-40).map(({ role, content }) => ({ role, content: String(content).slice(0, 20000) }));
    setChat((c) => [...c, { role: 'user', content: q }]);
    setDraft('');
    setBusy((b) => ({ ...b, ask: true }));
    setError(null);
    try {
      const run = await askAgent(appId, q, history);
      setChat((c) => [...c, { role: 'assistant', content: run.output.answer, run }]);
    } catch (err) {
      setError(err);
      setChat((c) => c.slice(0, -1));
      setDraft(q);
    }
    setBusy((b) => ({ ...b, ask: false }));
  };

  const review = newest(runs, 'review');
  const explain = newest(runs, 'explain');
  const rout = review?.output;
  const eout = explain?.output;

  return (
    <Card title="AI analyst" eyebrow={enabled ? `${LLM.provider} · ${LLM.model} · advisory` : 'no model configured'}>
      <div className="sub" style={{ fontSize: 12, marginBottom: 10 }}>
        {enabled ? (
          <>
            The model reads this file through read-only tools and the credit-underwriter skill. It explains and flags; the
            verdict was made by the policy engine and cannot be changed here.
          </>
        ) : (
          <>
            Add the model settings to <span className="mono">.env</span> (see <span className="mono">.env.example</span>)
            and restart the backend.
          </>
        )}
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 12, marginBottom: 10 }}>
          <b style={{ color: 'var(--red)' }}>{error.code}</b> {error.message}
          {error.requestId && <span className="mono dim"> · {error.requestId}</span>}
        </div>
      )}

      <div className="grid grid--2" style={{ gap: 16 }}>
        <div className="stack stack--sm">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--sm"
              disabled={!enabled || busy.review}
              onClick={() => start('review')}
              data-testid="agent-review"
            >
              {busy.review ? 'Reviewers working…' : 'Run multi-agent review'}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              disabled={!enabled || busy.explain}
              onClick={() => start('explain')}
              data-testid="agent-explain"
            >
              {busy.explain ? 'Explaining…' : 'Explain decision'}
            </button>
          </div>

          {review && (
            <div data-testid="agent-review-result">
              <RunHead title="Multi-agent review" run={review} />
              {review.error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{review.error}</div>}
              {rout && (
                <>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{rout.synthesis?.summary}</div>
                  {rout.synthesis?.priorities?.length > 0 && (
                    <ol style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 18 }}>
                      {rout.synthesis.priorities.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ol>
                  )}
                  {(rout.findings ?? []).map((f, i) => (
                    <div key={i} style={{ fontSize: 12, marginTop: 6 }}>
                      <span
                        className="mono"
                        style={{ fontSize: 10.5, color: f.severity === 'CONCERN' ? 'var(--red)' : 'var(--text-3)' }}
                      >
                        {f.area} · {f.severity}
                      </span>{' '}
                      <b>{f.title}</b> — {f.detail}
                      {f.grounded === false && <span className="dim"> (cites a path not in the record)</span>}
                    </div>
                  ))}
                  <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6 }}>
                    {(rout.children ?? []).length} reviewers · {(rout.children ?? []).reduce((n, c) => n + tokens(c.usage), 0)} tokens
                  </div>
                </>
              )}
            </div>
          )}

          {explain && (
            <div data-testid="agent-explain-result">
              <RunHead title="Explanation" run={explain} />
              {explain.error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{explain.error}</div>}
              {eout && (
                <>
                  <div className="mono dim" style={{ fontSize: 10.5 }}>
                    source: {eout.source}
                    {eout.rejected_reason ? ` — ${eout.rejected_reason}` : ''}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 550, marginTop: 4 }}>{eout.explanation?.headline}</div>
                  {(eout.explanation?.paragraphs ?? []).map((p, i) => (
                    <p key={i} style={{ fontSize: 12.5, margin: '6px 0 0' }}>
                      {p}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div className="stack stack--sm">
          <b style={{ fontSize: 13 }}>Ask about this file</b>
          <div
            style={{ maxHeight: 440, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}
            data-testid="agent-chat"
          >
            {chat.length === 0 && !busy.ask && (
              <div className="sub" style={{ fontSize: 12 }}>
                No questions yet.
              </div>
            )}
            {chat.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  fontSize: 12.5,
                  whiteSpace: 'pre-wrap',
                  background: m.role === 'user' ? 'rgba(190, 255, 60, 0.12)' : 'rgba(127, 127, 127, 0.12)',
                }}
              >
                {m.content}
                {m.run?.output && (
                  <>
                    <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6 }}>
                      {m.run.model} · tools: {[...new Set((m.run.output.tool_calls ?? []).map((c) => c.name))].join(', ') || 'none'} ·{' '}
                      {tokens(m.run.output.usage)} tokens{m.run.output.grounded ? ' · figures grounded' : ''}
                    </div>
                    {m.run.output.grounded === false && (
                      <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
                        Figures not in the record: {(m.run.output.unsupported_numbers ?? []).join(', ')}
                      </div>
                    )}
                    <Reasoning text={m.run.output.reasoning} />
                  </>
                )}
              </div>
            ))}
            {busy.ask && (
              <div className="sub" style={{ fontSize: 12 }}>
                {LLM.model} is reading the file…
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SUGGESTED.map((s) => (
              <button key={s} type="button" className="btn btn--sm" disabled={!enabled || busy.ask} onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask anything about this file…"
              disabled={!enabled}
              maxLength={4000}
              aria-label="Question for the model"
              data-testid="agent-question"
              style={{
                flex: 1,
                minWidth: 0,
                font: 'inherit',
                fontSize: 13,
                padding: '7px 10px',
                borderRadius: 6,
                border: '1px solid rgba(127, 127, 127, 0.35)',
                background: 'transparent',
                color: 'inherit',
              }}
            />
            <button type="submit" className="btn btn--primary btn--sm" disabled={!enabled || busy.ask || !draft.trim()}>
              Ask
            </button>
          </form>
        </div>
      </div>
    </Card>
  );
}
