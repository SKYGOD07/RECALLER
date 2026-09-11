// One illustrative applicant threads through every section, so every figure
// on the site agrees with every other. Values are presentation data only.
//   EMI  = P·r·(1+r)^n / ((1+r)^n − 1),  r = 14% / 12
//   FOIR = (EMI + obligations) / verified income
//   LTV  = loan / on-road price

export const CASE = {
  id: 'CR-2291',
  applicant: 'Arjun Mehra',
  initials: 'AM',
  profile: 'Delivery rider · 3 platforms · Pune',
  vehicle: 'Electric scooter · 3.0 kWh',
  exShowroom: 109500,
  onRoad: 124000,
  loan: 100000,
  tenure: 36,
  rate: 14,
  declaredIncome: 22000,
  verifiedIncome: 18400,
  incomeMonths: [
    ['APR', 17900],
    ['MAY', 18600],
    ['JUN', 18100],
    ['JUL', 19200],
    ['AUG', 18000],
    ['SEP', 18600],
  ],
  obligations: 3600,
  emi: 3417.76,
  foir: 38.14,
  ltv: 80.65,
  confidence: 0.94,
  policy: 'EV-2W-THINFILE',
  policyVersion: 'v3.3',
  maxFoir: 45,
  trace: 'trc_7f3a91c2',
  reasons: [
    { code: 'R-01', text: 'FOIR 38.1% within 45.0% limit', kind: 'match' },
    { code: 'R-04', text: 'Income verified across 3 sources', kind: 'match' },
    { code: 'A-02', text: 'Declared vs verified income −16.4%', kind: 'advisory' },
  ],
}

// The same applicant at the originally requested 24-month tenure.
export const REQUESTED = { loan: 100000, tenure: 24, emi: 4801.29, foir: 45.66 }

export const inr = (n, decimals = 0) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
