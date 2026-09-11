/**
 * Screen 2 — New application.
 *
 * Borrower, asset and facility details, then the document bundle. The primary
 * action stays disabled until every required document is attached, because the
 * workflow has nothing to extract from a partial bundle and failing halfway
 * through is worse than refusing to start.
 *
 * Each slot takes either a real file (PDF, text or image), uploaded to the
 * backend and read by the document service, or a synthetic sample document for
 * demonstration. Uploaded files are read by the pattern extractor, or by the
 * Hermes evidence agent when a model is configured; anything it cannot read is
 * held for the officer at the confidence gate.
 */

import { useMemo, useRef, useState, useAsyncValue, navigate } from '@/hooks/index.js';
import { createApplication, startUnderwriting, uploadDocument, attachSample, getQuote, POLICY, LIMITS, LLM } from '@/services/api.js';
import { Card, Field, Icon, PageHead, Money } from '@/components/ui.jsx';
import { REQUIRED_DOCS, OPTIONAL_DOCS, DOC_LABELS } from '@/lib/vocab.js';
import { formatBytes } from '@/lib/format.js';

const BLANK = {
  borrower_name: '',
  occupation: '',
  branch: 'Delhi — Karol Bagh',
  officer: 'A. Nandini',
  dealer: '',
  segment: 'EV_2W',
  loan_amount: '',
  tenure_months: '36',
  declared_monthly_income: '',
};

const ACCEPT = '.pdf,.txt,.png,.jpg,.jpeg,application/pdf,text/plain,image/png,image/jpeg';

export default function NewApplication() {
  const [form, setForm] = useState(BLANK);
  const [docs, setDocs] = useState({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const segment = POLICY.segments[form.segment];

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const errors = useMemo(() => validate(form, segment), [form, segment]);
  const missing = REQUIRED_DOCS.filter((d) => !docs[d]);
  const canStart = Object.keys(errors).length === 0 && missing.length === 0;

  function pickFile(type, file) {
    if (!file) return;
    if (file.size > LIMITS.max_upload_mb * 1024 * 1024) {
      setError({ message: `${file.name} is larger than ${LIMITS.max_upload_mb} MB.` });
      return;
    }
    setError(null);
    setDocs((prev) => ({ ...prev, [type]: { kind: 'file', file } }));
  }

  function chooseSample(type) {
    setDocs((prev) => ({ ...prev, [type]: { kind: 'sample' } }));
  }

  function detach(type) {
    setDocs((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (!canStart) return;
    setBusy(true);
    setError(null);
    try {
      setStage('Creating application…');
      const id = await createApplication(form);
      for (const [type, d] of Object.entries(docs)) {
        setStage(`${d.kind === 'file' ? 'Uploading' : 'Attaching sample'} ${DOC_LABELS[type]}…`);
        // eslint-disable-next-line no-await-in-loop
        if (d.kind === 'file') await uploadDocument(id, type, d.file);
        // eslint-disable-next-line no-await-in-loop
        else await attachSample(id, type);
      }
      navigate(`/app/${id}/processing`);
      startUnderwriting(id)
        .catch(() => {}) // surfaced by the console's error banner
        .finally(() => setBusy(false));
    } catch (err) {
      setError(err);
      setBusy(false);
      setStage('');
    }
  }

  const amount = Number(form.loan_amount);
  const tenure = Number(form.tenure_months);
  const quote = useAsyncValue(
    () => (amount > 0 && tenure > 0 ? getQuote(form.segment, amount, tenure) : null),
    [form.segment, amount, tenure],
    { debounce: 250 },
  );
  const emi = amount > 0 && tenure > 0 ? quote.value?.emi : null;

  return (
    <form className="page" onSubmit={submit} noValidate data-testid="new-application-form">
      <PageHead
        eyebrow="Origination"
        title="New application"
        sub="Capture the borrower, the asset and the facility, then attach the document bundle. Underwriting will not start until every required document is present."
        actions={
          <button type="submit" className="btn btn--primary btn--lg" disabled={!canStart || busy} data-testid="start-underwriting">
            {busy ? stage || 'Starting…' : 'Start underwriting'}
            <Icon name="chevron" size={14} />
          </button>
        }
      />

      {error && (
        <div role="alert" className="card" style={{ marginBottom: 14, padding: '10px 14px', borderColor: 'rgba(255,90,95,0.4)' }}>
          <b style={{ color: 'var(--red)' }}>{error.code ?? 'Could not submit'}</b> {error.message}
          {error.requestId && (
            <span className="mono dim" style={{ marginLeft: 8, fontSize: 11 }}>
              request {error.requestId}
            </span>
          )}
          {error.details && (
            <pre className="mono dim" style={{ fontSize: 11, marginTop: 6, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(error.details, null, 2)}
            </pre>
          )}
        </div>
      )}

      <div className="grid grid--sidebar">
        <div className="stack">
          <Card title="Borrower">
            <div className="grid grid--2">
              <Field label="Full name (as per KYC)" error={touched && errors.borrower_name}>
                <input
                  name="borrower_name"
                  className={`input${touched && errors.borrower_name ? ' input--err' : ''}`}
                  value={form.borrower_name}
                  onChange={set('borrower_name')}
                  placeholder="e.g. Rahul Sharma"
                />
              </Field>
              <Field label="Occupation" hint="How the borrower earns — drives which evidence we expect">
                <input name="occupation" className="input" value={form.occupation} onChange={set('occupation')} placeholder="e.g. Ride-hailing driver" />
              </Field>
              <Field
                label="Declared monthly income"
                hint="Stated by the applicant; reconciled against bank evidence"
                error={touched && errors.declared_monthly_income}
              >
                <input
                  name="declared_monthly_income"
                  className={`input input--mono${touched && errors.declared_monthly_income ? ' input--err' : ''}`}
                  value={form.declared_monthly_income}
                  onChange={set('declared_monthly_income')}
                  inputMode="numeric"
                  placeholder="32000"
                />
              </Field>
              <Field label="Branch">
                <input name="branch" className="input" value={form.branch} onChange={set('branch')} />
              </Field>
            </div>
          </Card>

          <Card title="Asset and facility">
            <div className="grid grid--2">
              <Field label="Asset segment" hint={`${segment.label} · ${segment.rate_annual_pct}% p.a.`}>
                <select name="segment" className="select" value={form.segment} onChange={set('segment')}>
                  {Object.entries(POLICY.segments).map(([k, s]) => (
                    <option key={k} value={k}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Dealer">
                <input name="dealer" className="input" value={form.dealer} onChange={set('dealer')} placeholder="e.g. Volt Mobility, Karol Bagh" />
              </Field>
              <Field
                label="Requested amount"
                hint={`Product band ${fmt(segment.min_ticket)} – ${fmt(segment.max_ticket)}`}
                error={touched && errors.loan_amount}
              >
                <input
                  name="loan_amount"
                  className={`input input--mono${touched && errors.loan_amount ? ' input--err' : ''}`}
                  value={form.loan_amount}
                  onChange={set('loan_amount')}
                  inputMode="numeric"
                  placeholder="95000"
                />
              </Field>
              <Field
                label="Tenure (months)"
                hint={`Product band ${segment.tenure_months.min} – ${segment.tenure_months.max} months`}
                error={touched && errors.tenure_months}
              >
                <input
                  name="tenure_months"
                  className={`input input--mono${touched && errors.tenure_months ? ' input--err' : ''}`}
                  value={form.tenure_months}
                  onChange={set('tenure_months')}
                  inputMode="numeric"
                />
              </Field>
            </div>
          </Card>

          <Card
            title="Document bundle"
            eyebrow={`${REQUIRED_DOCS.filter((d) => docs[d]).length} of ${REQUIRED_DOCS.length} required attached`}
            note={`Upload a PDF, text or image (max ${LIMITS.max_upload_mb} MB), or use a synthetic sample. Uploaded files are read ${
              LLM?.enabled ? `by the Hermes evidence agent (${LLM.model}) with pattern fallback` : 'by the deterministic pattern extractor'
            }; anything unreadable is held for the officer.`}
          >
            <div className="stack stack--sm">
              <div className="eyebrow" style={{ marginBottom: 2 }}>
                Required
              </div>
              {REQUIRED_DOCS.map((type) => (
                <DocSlot key={type} type={type} doc={docs[type]} required onFile={pickFile} onSample={chooseSample} onDetach={detach} disabled={busy} />
              ))}
              <div className="eyebrow" style={{ margin: '10px 0 2px' }}>
                Optional — strengthens the file
              </div>
              {OPTIONAL_DOCS.map((type) => (
                <DocSlot key={type} type={type} doc={docs[type]} onFile={pickFile} onSample={chooseSample} onDetach={detach} disabled={busy} />
              ))}
            </div>
          </Card>
        </div>

        <aside className="stack">
          <Card title="Indicative instalment" eyebrow="Deterministic · server">
            {emi ? (
              <>
                <div className="metric__value" style={{ fontSize: 28 }} data-testid="indicative-emi">
                  <Money value={emi} decimals={2} />
                </div>
                <div className="sub" style={{ marginTop: 4 }}>
                  per month over {form.tenure_months} months at {segment.rate_annual_pct}% p.a. reducing balance
                </div>
                <div className="divider" />
                <p className="sub" style={{ fontSize: 12 }}>
                  Computed by the RECALLER credit engine (GET /api/quote). It is indicative only — the binding instalment is
                  recomputed after evidence has been extracted and gated.
                </p>
              </>
            ) : (
              <p className="sub">{quote.error ? quote.error.message : 'Enter an amount and tenure to see the instalment.'}</p>
            )}
          </Card>

          <Card title="Before you start" eyebrow="Checklist">
            <ul className="stack stack--sm" style={{ fontSize: 13 }}>
              <Check ok={!errors.borrower_name && form.borrower_name}>Borrower named as per KYC</Check>
              <Check ok={!errors.loan_amount}>Amount inside the product band</Check>
              <Check ok={!errors.tenure_months}>Tenure inside the product band</Check>
              <Check ok={missing.length === 0}>
                {missing.length === 0
                  ? 'All required documents attached'
                  : `${missing.length} required document${missing.length === 1 ? '' : 's'} missing`}
              </Check>
              <Check ok={Boolean(docs.PLATFORM_EARNINGS)} optional>
                Platform earnings attached (optional)
              </Check>
            </ul>
          </Card>
        </aside>
      </div>
    </form>
  );
}

function DocSlot({ type, doc, required, onFile, onSample, onDetach, disabled }) {
  const input = useRef(null);
  return (
    <div className={`dropzone${doc ? ' dropzone--filled' : required ? ' dropzone--required' : ''}`} data-testid={`doc-slot-${type}`}>
      <span className="dropzone__ico">
        <Icon name={doc ? 'check' : 'doc'} size={15} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {DOC_LABELS[type]}
          {required && !doc && (
            <span className="pill pill--warn" style={{ marginLeft: 8 }}>
              Required
            </span>
          )}
        </div>
        <div className="dim mono" style={{ fontSize: 11 }}>
          {!doc
            ? 'Not attached'
            : doc.kind === 'file'
              ? `${doc.file.name} · ${formatBytes(doc.file.size / 1024)} · upload`
              : 'Synthetic sample document'}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid={`doc-input-${type}`}
        onChange={(e) => {
          onFile(type, e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {doc ? (
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => onDetach(type)} disabled={disabled}>
          Remove
        </button>
      ) : (
        <span className="row row--tight">
          <button type="button" className="btn btn--sm" onClick={() => input.current?.click()} disabled={disabled}>
            Upload
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onSample(type)} disabled={disabled}>
            Sample
          </button>
        </span>
      )}
    </div>
  );
}

function Check({ ok, optional, children }) {
  return (
    <li className="row row--tight" style={{ color: ok ? 'var(--text-2)' : optional ? 'var(--text-3)' : 'var(--amber)' }}>
      <Icon name={ok ? 'check' : 'assist'} size={13} />
      <span>{children}</span>
    </li>
  );
}

function validate(form, segment) {
  const e = {};
  if (!form.borrower_name.trim()) e.borrower_name = 'Required';
  const amount = Number(form.loan_amount);
  if (!form.loan_amount || !Number.isFinite(amount)) e.loan_amount = 'Enter an amount';
  else if (amount < segment.min_ticket || amount > segment.max_ticket)
    e.loan_amount = `Outside the product band (${fmt(segment.min_ticket)} – ${fmt(segment.max_ticket)})`;
  const tenure = Number(form.tenure_months);
  if (!Number.isFinite(tenure) || tenure < segment.tenure_months.min || tenure > segment.tenure_months.max)
    e.tenure_months = `Must be ${segment.tenure_months.min} – ${segment.tenure_months.max} months`;
  const income = Number(form.declared_monthly_income);
  if (!form.declared_monthly_income || !Number.isFinite(income) || income <= 0) e.declared_monthly_income = 'Enter declared income';
  return e;
}

function fmt(n) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}
