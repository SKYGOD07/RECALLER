/**
 * Screen 2 — New application.
 *
 * Borrower, asset and facility details, then the document bundle. The primary
 * action stays disabled until every required document is attached, because the
 * workflow has nothing to extract from a partial bundle and failing halfway
 * through is worse than refusing to start.
 *
 * In this build the uploader attaches a synthetic bundle rather than parsing a
 * real PDF: the extraction adapter is swappable (see packages/extraction), and
 * the file picker here feeds the same adapter interface the LLM adapter uses.
 */

import { useMemo, useState, navigate } from '@/hooks/index.js';
import { createApplication, startUnderwriting, POLICY } from '@/services/api.js';
import { SYNTHETIC_APPLICATIONS } from '@synthetic/applications.js';
import { Card, Field, Icon, PageHead, Money } from '@/components/ui.jsx';
import { REQUIRED_DOCS, OPTIONAL_DOCS, DOC_LABELS } from '@core/constants.js';
import { calculateEMI } from '@credit-engine/index.js';

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

export default function NewApplication() {
  const [form, setForm] = useState(BLANK);
  const [docs, setDocs] = useState({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const segment = POLICY.segments[form.segment];

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const errors = useMemo(() => validate(form, segment), [form, segment]);
  const missing = REQUIRED_DOCS.filter((d) => !docs[d]);
  const canStart = Object.keys(errors).length === 0 && missing.length === 0;

  /**
   * Attaching a document binds a synthetic payload to the slot. The donor is
   * chosen by asset segment so the bundle stays internally coherent — an EV
   * two-wheeler application does not end up with a cargo invoice.
   */
  function attach(type) {
    const donor =
      SYNTHETIC_APPLICATIONS.find((a) => a.segment === form.segment && a.documents.some((d) => d.type === type)) ??
      SYNTHETIC_APPLICATIONS.find((a) => a.documents.some((d) => d.type === type));
    const source = donor.documents.find((d) => d.type === type);
    setDocs((prev) => ({
      ...prev,
      [type]: { ...source, id: `NEW-${type}`, uploaded_at: new Date().toISOString() },
    }));
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
    const bundle = Object.values(docs);
    const id = createApplication(form, bundle);
    navigate(`/app/${id}/processing`);
    startUnderwriting(id).finally(() => setBusy(false));
  }

  const emi =
    form.loan_amount && form.tenure_months
      ? calculateEMI(Number(form.loan_amount), segment.rate_annual_pct, Number(form.tenure_months))
      : null;

  return (
    <form className="page" onSubmit={submit} noValidate>
      <PageHead
        eyebrow="Origination"
        title="New application"
        sub="Capture the borrower, the asset and the facility, then attach the document bundle. Underwriting will not start until every required document is present."
        actions={
          <button type="submit" className="btn btn--primary btn--lg" disabled={!canStart || busy}>
            {busy ? 'Starting…' : 'Start underwriting'}
            <Icon name="chevron" size={14} />
          </button>
        }
      />

      <div className="grid grid--sidebar">
        <div className="stack">
          <Card title="Borrower">
            <div className="grid grid--2">
              <Field label="Full name (as per KYC)" error={touched && errors.borrower_name}>
                <input
                  className={`input${touched && errors.borrower_name ? ' input--err' : ''}`}
                  value={form.borrower_name}
                  onChange={set('borrower_name')}
                  placeholder="e.g. Rahul Sharma"
                />
              </Field>
              <Field label="Occupation" hint="How the borrower earns — drives which evidence we expect">
                <input className="input" value={form.occupation} onChange={set('occupation')} placeholder="e.g. Ride-hailing driver" />
              </Field>
              <Field label="Declared monthly income" hint="Stated by the applicant; reconciled against bank evidence" error={touched && errors.declared_monthly_income}>
                <input
                  className={`input input--mono${touched && errors.declared_monthly_income ? ' input--err' : ''}`}
                  value={form.declared_monthly_income}
                  onChange={set('declared_monthly_income')}
                  inputMode="numeric"
                  placeholder="32000"
                />
              </Field>
              <Field label="Branch">
                <input className="input" value={form.branch} onChange={set('branch')} />
              </Field>
            </div>
          </Card>

          <Card title="Asset and facility">
            <div className="grid grid--2">
              <Field label="Asset segment" hint={`${segment.label} · ${segment.rate_annual_pct}% p.a.`}>
                <select className="select" value={form.segment} onChange={set('segment')}>
                  {Object.entries(POLICY.segments).map(([k, s]) => (
                    <option key={k} value={k}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Dealer">
                <input className="input" value={form.dealer} onChange={set('dealer')} placeholder="e.g. Volt Mobility, Karol Bagh" />
              </Field>
              <Field
                label="Requested amount"
                hint={`Product band ${fmt(segment.min_ticket)} – ${fmt(segment.max_ticket)}`}
                error={touched && errors.loan_amount}
              >
                <input
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
            eyebrow={`${Object.keys(docs).length} of ${REQUIRED_DOCS.length} required attached`}
            note="Attaching a document here binds a synthetic bundle to the slot. The extraction adapter is the same one the LLM path uses — see packages/extraction."
          >
            <div className="stack stack--sm">
              <div className="eyebrow" style={{ marginBottom: 2 }}>
                Required
              </div>
              {REQUIRED_DOCS.map((type) => (
                <DocSlot key={type} type={type} doc={docs[type]} required onAttach={attach} onDetach={detach} />
              ))}
              <div className="eyebrow" style={{ margin: '10px 0 2px' }}>
                Optional — strengthens the file
              </div>
              {OPTIONAL_DOCS.map((type) => (
                <DocSlot key={type} type={type} doc={docs[type]} onAttach={attach} onDetach={detach} />
              ))}
            </div>
          </Card>
        </div>

        <aside className="stack">
          <Card title="Indicative instalment" eyebrow="Deterministic">
            {emi ? (
              <>
                <div className="metric__value" style={{ fontSize: 28 }}>
                  <Money value={emi} decimals={2} />
                </div>
                <div className="sub" style={{ marginTop: 4 }}>
                  per month over {form.tenure_months} months at {segment.rate_annual_pct}% p.a. reducing balance
                </div>
                <div className="divider" />
                <p className="sub" style={{ fontSize: 12 }}>
                  Computed by the RECALLER calculation engine from the figures above. It is indicative only — the binding
                  instalment is recomputed after evidence has been extracted and gated.
                </p>
              </>
            ) : (
              <p className="sub">Enter an amount and tenure to see the instalment.</p>
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

function DocSlot({ type, doc, required, onAttach, onDetach }) {
  return (
    <div className={`dropzone${doc ? ' dropzone--filled' : required ? ' dropzone--required' : ''}`}>
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
          {doc ? `${doc.filename} · ${doc.pages} page${doc.pages === 1 ? '' : 's'} · ${doc.size_kb} KB` : 'Not attached'}
        </div>
      </div>
      {doc ? (
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => onDetach(type)}>
          Remove
        </button>
      ) : (
        <button type="button" className="btn btn--sm" onClick={() => onAttach(type)}>
          Attach
        </button>
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
