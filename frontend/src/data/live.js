/**
 * RECALLER — the figures the public site is allowed to show.
 *
 * Every number in this file was produced by the deterministic engine, not
 * written by hand. It is the output of running the real pipeline over the real
 * synthetic book in `data/synthetic/applications.js` against
 * `policy/policy.v1.json` v1.4.0.
 *
 * To regenerate after a policy or fixture change, run the pipeline and read the
 * values back — the console at /console shows the same records live:
 *
 *   runUnderwriting({ application, documents, policy })   → decision, metrics, audit
 *   runWhatIf({ record, policy })                         → the recommended lever
 *
 * Rules for this file:
 *   - nothing invented, nothing rounded "to look better"
 *   - ratios stay ratios (0.1915); components format them
 *   - if a figure cannot be produced by the engine, it does not belong here
 */

/** The clean file. Every rule passes on the first run. */
export const APPROVED = {
  id: 'RCL-2026-0418',
  borrower: 'Rahul Sharma',
  occupation: 'Ride-hailing driver',
  branch: 'Delhi — Karol Bagh',
  asset: 'Electric Two-Wheeler',
  vehicle: 'Ather 450S',
  decision: 'APPROVE',
  amount: 95000,
  tenure: 36,
  rate: 16.5,
  emi: 3363.42,
  foir: 0.1915,
  ltv: 0.8051,
  assetValue: 118000, // invoice on-road price; the lower of invoice and valuation
  income: 30090,
  obligations: 2400,
  disposable: 24326.58,
  monthsObserved: 6,
  rulesPassed: 14,
  rulesTotal: 14,
  headline:
    'Affordability holds at 19.2% FOIR against a 50.0% ceiling, with ₹24,327 residual income after the instalment.',
  trace: 'TRC-8C03CE0CD9',
  ledgerHead: 'b71d8a74e438a1ca4c7926127301e264',
  events: 13,
  policyVersion: '1.4.0',
  policyHash: '7418fe02a8df',
}

/** Referred on asset cover, and the smallest change that clears it. */
export const REFERRED = {
  id: 'RCL-2026-0437',
  borrower: 'Sandeep Yadav',
  asset: 'Electric Two-Wheeler',
  decision: 'REFER',
  amount: 118000,
  tenure: 30,
  emi: 4826.8,
  foir: 0.1869,
  ltv: 0.8806,
  income: 34650,
  code: { code: 'F04', text: 'LTV in referral band' },
  whatIf: {
    lever: 'Reduce loan amount',
    text: 'Reduce the sanctioned amount by ₹4,500 to ₹1,13,500',
    from: 118000,
    to: 113500,
    decision: 'APPROVE',
    emi: 4642.73,
    foir: 0.1816,
    ltv: 0.847,
  },
}

/** Four documents that do not agree. The contradiction is the decision. */
export const CONTRADICTED = {
  id: 'RCL-2026-0433',
  borrower: 'Lakshmi Narayanan',
  asset: 'Electric Two-Wheeler',
  decision: 'REJECT',
  amount: 132000,
  emi: 4673.38,
  foir: 0.2744,
  ltv: 0.9041,
  codes: [
    { code: 'R02', text: 'Material cross-document contradiction unresolved' },
    { code: 'R03', text: 'LTV exceeds policy ceiling' },
  ],
  findings: [
    {
      code: 'RC-KYC-01',
      label: 'Applicant name vs bank account holder',
      status: 'BLOCKING',
      left: { field: 'Applicant name', value: 'Lakshmi Narayanan', source: 'Aadhaar.pdf' },
      right: { field: 'Bank account holder', value: 'SURESH KUMAR RAMASAMY', source: 'BankStatement.pdf' },
      similarity: 0.3329,
    },
    {
      code: 'RC-INC-01',
      label: 'Declared income vs verified bank income',
      status: 'BLOCKING',
      left: { field: 'Declared monthly income', value: 47000, source: 'Application form', kind: 'money' },
      right: { field: 'Verified monthly income', value: 17033.33, source: 'BankStatement.pdf', kind: 'money' },
      deltaPct: 0.6376,
    },
    {
      code: 'RC-INC-02',
      label: 'Platform settlements vs bank credits',
      status: 'BLOCKING',
      left: { field: 'Mean platform settlement', value: 45366.67, source: 'SwiggyEarnings.pdf', kind: 'money' },
      right: { field: 'Mean bank credits', value: 21033.33, source: 'BankStatement.pdf', kind: 'money' },
      deltaPct: 0.5364,
    },
    {
      code: 'RC-ADR-01',
      label: 'KYC address vs statement address',
      status: 'BLOCKING',
      left: { field: 'KYC address', value: 'Gandhipuram, Coimbatore 641012', source: 'Aadhaar.pdf' },
      right: { field: 'Statement address', value: 'Perundurai Main Road, Erode 638052', source: 'BankStatement.pdf' },
      similarity: 0.2,
    },
  ],
}

/** The run that stops rather than guesses. */
export const HELD = {
  id: 'RCL-2026-0421',
  borrower: 'Meena Devi',
  asset: 'Electric Three-Wheeler (Passenger)',
  status: 'WAITING_FOR_OFFICER',
  amount: 268000,
  tenure: 48,
  fields: [
    { path: 'bank.account_holder_name', label: 'Bank account holder name', value: 'MEENA DEVI', confidence: 0.61, floor: 0.88 },
    { path: 'bank.account_number', label: 'Account number (masked)', value: 'XXXXXXXX4417', confidence: 0.74, floor: 0.88 },
    { path: 'bank.average_monthly_balance', label: 'Average monthly balance', value: 14200, confidence: 0.68, floor: 0.8 },
  ],
}

/** The twelve recorded stages of a run, in order, with who owns each. */
export const PIPELINE = [
  { id: 'INGEST', label: 'Ingest', actor: 'SYSTEM', detail: '5 documents ingested' },
  { id: 'KYC', label: 'KYC extraction', actor: 'LLM', detail: '8 fields from 2 documents' },
  { id: 'BANK', label: 'Bank extraction', actor: 'LLM', detail: '11 fields from 1 document' },
  { id: 'PLATFORM', label: 'Platform earnings', actor: 'LLM', detail: '5 fields from 1 document' },
  { id: 'INVOICE', label: 'Invoice extraction', actor: 'LLM', detail: '11 fields from 1 document' },
  { id: 'VALIDATE', label: 'Evidence validation', actor: 'ENGINE', detail: '37 fields validated' },
  { id: 'RECONCILE', label: 'Reconciliation', actor: 'ENGINE', detail: '8 checks run' },
  { id: 'GATE', label: 'Confidence gate', actor: 'ENGINE', detail: 'Every field above its floor' },
  { id: 'CREDIT', label: 'Credit calculation', actor: 'ENGINE', detail: 'EMI, FOIR, LTV' },
  { id: 'POLICY', label: 'Policy evaluation', actor: 'ENGINE', detail: '14 of 14 rules passed' },
  { id: 'DECISION', label: 'Decision', actor: 'ENGINE', detail: 'APPROVE — A01…A10' },
  { id: 'MEMO', label: 'Credit memo', actor: 'ENGINE', detail: '10 sections written' },
]

/**
 * Evidence strength — RECALLER's own measure, and the one number here that is
 * not about money.
 *
 * FOIR, LTV and the policy rules answer "can this person repay". This answers
 * the question a loan officer asks first: "how much of this file do I actually
 * know?" Four components of 25, every one a fact already extracted, every
 * threshold read from the policy document. It explains a decision's footing and
 * decides nothing itself.
 *
 * Produced by computeEvidenceStrength() in packages/credit-engine — the same
 * function the Python backend runs, verified to produce identical output.
 */
export const STRENGTH = {
  // RCL-2026-0418, the file in the hero.
  clean: {
    id: 'RCL-2026-0418',
    score: 88,
    band: 'STRONG',
    components: [
      { key: 'corroboration', label: 'Corroboration', points: 25, max: 25, detail: '2 independent income sources, 2.6% apart' },
      { key: 'confidence', label: 'Confidence', points: 12.92, max: 25, detail: '6 critical fields, mean 94.2% against a 88.0% floor' },
      { key: 'consistency', label: 'Consistency', points: 25, max: 25, detail: 'All 8 cross-document checks agreed' },
      { key: 'coverage', label: 'Coverage', points: 25, max: 25, detail: '3/3 required document types, 6 of 6 months observed' },
    ],
  },

  // RCL-2026-0433 — four contradictions empty the consistency component.
  contradicted: {
    id: 'RCL-2026-0433',
    score: 54,
    band: 'THIN',
    components: [
      { key: 'corroboration', label: 'Corroboration', points: 20, max: 25, detail: '2 independent income sources, 53.6% apart' },
      { key: 'confidence', label: 'Confidence', points: 9.33, max: 25, detail: '6 critical fields, mean 92.5% against a 88.0% floor' },
      { key: 'consistency', label: 'Consistency', points: 0, max: 25, detail: '4 blocking contradictions' },
      { key: 'coverage', label: 'Coverage', points: 25, max: 25, detail: '3/3 required document types, 6 of 6 months observed' },
    ],
  },

  // RCL-2026-0421 — held at the gate, so confidence earns nothing. Confirming
  // the three held fields in Assist lifts the mean to 96.5% and the score to 78:
  // the officer's answer is itself evidence, and the file measurably improves.
  held: {
    id: 'RCL-2026-0421',
    score: 60,
    band: 'ADEQUATE',
    afterAssist: { score: 78, band: 'ADEQUATE', confidence: 17.67 },
    components: [
      { key: 'corroboration', label: 'Corroboration', points: 10, max: 25, detail: 'A single income source' },
      { key: 'confidence', label: 'Confidence', points: 0, max: 25, detail: '6 critical fields, mean 85.7% against a 88.0% floor' },
      { key: 'consistency', label: 'Consistency', points: 25, max: 25, detail: 'All 7 cross-document checks agreed' },
      { key: 'coverage', label: 'Coverage', points: 25, max: 25, detail: '3/3 required document types, 6 of 6 months observed' },
    ],
  },
}

/** The policy the site quotes. Read from policy/policy.v1.json. */
export const POLICY = {
  id: 'RCL-EV-RETAIL',
  version: '1.4.0',
  effective: '2026-07-01',
  foirCap: 0.5,
  ltvCap: 0.85,
  maxTicket: 180000,
  minIncome: 14000,
  rules: 14,
  confidenceFloor: 0.8,
  criticalFloor: 0.88,
}

/** The signals RECALLER reads. Not partnerships — document types. */
export const SIGNALS = ['KYC', 'BANK STATEMENT', 'UPI SETTLEMENTS', 'PLATFORM EARNINGS', 'DEALER INVOICE', 'POLICY', 'AUDIT']

/**
 * Facts about the system itself. No traction, no customers, no funding —
 * these are things you can verify by reading the repository.
 */
export const FACTS = [
  { value: 14, label: 'Policy rules', detail: 'Every one versioned, hashed and evaluated per file.' },
  { value: 12, label: 'Recorded stages', detail: 'Each appended to a hash-chained ledger.' },
  { value: 8, label: 'Synthetic cases', detail: 'Approve, refer, decline, contradiction and held.' },
  { value: 4, label: 'Evidence components', detail: 'Corroboration, confidence, consistency, coverage — scored 0–100.' },
  { value: 0, label: 'Figures from a model', detail: 'EMI, FOIR and LTV come only from policy code.' },
]
