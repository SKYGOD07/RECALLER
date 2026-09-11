/**
 * RECALLER — synthetic application bundles for tests and demo environment.
 *
 * JavaScript port of recaller/synthetic/data.py.
 */

const PAGES = {
  AADHAAR: {
    'applicant.name': 1, 'applicant.dob': 1, 'applicant.gender': 1,
    'applicant.id_number': 1, 'applicant.address': 2, 'applicant.mobile': 2,
  },
  PAN: { 'applicant.pan': 1, 'applicant.pan_name': 1 },
  BANK_STATEMENT: {
    'bank.account_holder_name': 1, 'bank.account_number': 1, 'bank.bank_name': 1,
    'bank.ifsc': 1, 'bank.address': 1, 'bank.period': 1,
    'bank.monthly_credits': 4, 'bank.monthly_cash_deposits': 5,
    'bank.average_monthly_balance': 6, 'bank.bounce_count': 6, 'bank.recurring_debits': 5,
  },
  PLATFORM_EARNINGS: {
    'platform.provider': 1, 'platform.partner_id': 1,
    'platform.monthly_net': 2, 'platform.active_months': 1, 'platform.rating': 1,
  },
  DEALER_INVOICE: {
    'invoice.dealer_name': 1, 'invoice.invoice_number': 1, 'invoice.model': 1,
    'invoice.vehicle_category': 1, 'invoice.chassis_number': 1,
    'invoice.ex_showroom': 1, 'invoice.insurance': 1, 'invoice.registration': 1,
    'invoice.accessories': 1, 'invoice.on_road_price': 1, 'invoice.subsidy': 1,
  },
}

function doc(appId, docType, filename, payload, { pages = 1, degrade = null, sizeKb = 480 } = {}) {
  return {
    id: `${appId}-${docType}`,
    type: docType,
    filename,
    pages,
    size_kb: sizeKb,
    uploaded_at: null,
    payload,
    degrade,
    pageMap: PAGES[docType] || {},
  }
}

function bundle(appId, { kyc, pan, bank, invoice, platform = null, degrade = null }) {
  const deg = degrade || {}
  const docs = [
    doc(appId, 'AADHAAR', 'Aadhaar.pdf', { applicant: kyc }, { pages: 2, degrade: deg.AADHAAR, sizeKb: 612 }),
    doc(appId, 'PAN', 'PAN.pdf', { applicant: pan }, { pages: 1, degrade: deg.PAN, sizeKb: 244 }),
    doc(appId, 'BANK_STATEMENT', 'BankStatement.pdf', { bank }, { pages: 6, degrade: deg.BANK_STATEMENT, sizeKb: 1840 }),
    doc(appId, 'DEALER_INVOICE', 'DealerInvoice.pdf', { invoice }, { pages: 1, degrade: deg.DEALER_INVOICE, sizeKb: 386 }),
  ]
  if (platform) {
    const provider = platform.provider || 'Platform'
    docs.splice(3, 0,
      doc(appId, 'PLATFORM_EARNINGS', `${provider}Earnings.pdf`, { platform }, { pages: 3, degrade: deg.PLATFORM_EARNINGS, sizeKb: 522 })
    )
  }
  return docs
}

// 1 — Rahul Sharma (Clean approval)
const A1 = {
  id: 'RCL-2026-0418', borrower_name: 'Rahul Sharma', segment: 'EV_2W',
  loan_amount: 95000, tenure_months: 36, declared_monthly_income: 32000,
  branch: 'Delhi — Karol Bagh', officer: 'A. Nandini', dealer: 'Volt Mobility, Karol Bagh',
  occupation: 'Ride-hailing driver', created_at: '2026-09-02T09:14:00.000Z',
  scenario: 'Clean file — every rule passes on first run.',
  documents: bundle('RCL-2026-0418', {
    kyc: { name: 'Rahul Sharma', dob: '1994-03-12', gender: 'Male', id_number: 'XXXX XXXX 4172', address: 'H.No 44, Gali No 7, Bapa Nagar, Karol Bagh, New Delhi 110005', mobile: '98XXXXXX21' },
    pan: { pan: 'AXXPS4172K', pan_name: 'RAHUL SHARMA' },
    bank: {
      account_holder_name: 'RAHUL SHARMA', account_number: 'XXXXXXXX8821',
      bank_name: 'State Bank of India', ifsc: 'SBIN0009112',
      address: 'Bapa Nagar, Karol Bagh, New Delhi 110005', period: 'Mar 2026 — Aug 2026',
      monthly_credits: [33200, 35100, 34400, 32800, 35600, 34900],
      monthly_cash_deposits: [5800, 6200, 5400, 6600, 5900, 6100],
      average_monthly_balance: 8500, bounce_count: 0,
      recurring_debits: [{ label: 'Consumer durable EMI — Bajaj Finance', amount: 2400, kind: 'LOAN_EMI', source: 'Recurring debit, 5th of month' }],
    },
    platform: { provider: 'Rapido', partner_id: 'RPD-DL-XXXX-3391', monthly_net: [32800, 34200, 33100, 32200, 34700, 33600], active_months: 22, rating: 4.7 },
    invoice: {
      dealer_name: 'Volt Mobility Pvt Ltd, Karol Bagh', invoice_number: 'VM/26-27/01884',
      model: 'Ather 450S', vehicle_category: 'EV_2W', chassis_number: 'MD9XXXXXXXXXX1884',
      ex_showroom: 99000, insurance: 6500, registration: 4200, accessories: 8300, on_road_price: 118000, subsidy: 10000,
    },
  }),
}

// 2 — Meena Devi (Human-in-the-loop)
const A2 = {
  id: 'RCL-2026-0421', borrower_name: 'Meena Devi', segment: 'EV_3W_PASSENGER',
  loan_amount: 268000, tenure_months: 48, declared_monthly_income: 41000,
  branch: 'Patna — Kankarbagh', officer: 'S. Prakash', dealer: 'Ganga Auto, Kankarbagh',
  occupation: 'E-rickshaw operator', created_at: '2026-09-03T11:02:00.000Z',
  scenario: 'Low-confidence bank fields — execution suspends for officer verification.',
  documents: bundle('RCL-2026-0421', {
    kyc: { name: 'Meena Devi', dob: '1988-07-24', gender: 'Female', id_number: 'XXXX XXXX 7730', address: 'Ward 12, Hanuman Nagar, Kankarbagh, Patna 800020', mobile: '93XXXXXX08' },
    pan: { pan: 'BXXPD7730L', pan_name: 'MEENA DEVI' },
    bank: {
      account_holder_name: 'MEENA DEVI', account_number: 'XXXXXXXX4417',
      bank_name: 'Punjab National Bank', ifsc: 'PUNB0223100',
      address: 'Hanuman Nagar, Kankarbagh, Patna 800020', period: 'Mar 2026 — Aug 2026',
      monthly_credits: [46200, 48100, 45400, 47800, 46900, 48600],
      monthly_cash_deposits: [11200, 12400, 10800, 11900, 12100, 11600],
      average_monthly_balance: 14200, bounce_count: 1,
      recurring_debits: [{ label: 'Self-help group instalment', amount: 1800, kind: 'GROUP_LOAN', source: 'Recurring debit, 10th of month' }],
    },
    invoice: {
      dealer_name: 'Ganga Auto Sales, Kankarbagh', invoice_number: 'GA/26-27/00412',
      model: 'Mahindra Treo Zor', vehicle_category: 'EV_3W_PASSENGER', chassis_number: 'MA1XXXXXXXXXX0412',
      ex_showroom: 289000, insurance: 14800, registration: 9400, accessories: 6800, on_road_price: 320000, subsidy: 0,
    },
    degrade: { BANK_STATEMENT: { 'bank.account_holder_name': 0.61, 'bank.account_number': 0.74, 'bank.average_monthly_balance': 0.68 } },
  }),
}

// 3 — Imran Qureshi (Affordability failure)
const A3 = {
  id: 'RCL-2026-0426', borrower_name: 'Imran Qureshi', segment: 'EV_3W_CARGO',
  loan_amount: 385000, tenure_months: 36, declared_monthly_income: 58000,
  branch: 'Hyderabad — Malakpet', officer: 'R. Kulkarni', dealer: 'Deccan EV, Malakpet',
  occupation: 'Last-mile delivery contractor', created_at: '2026-09-04T08:41:00.000Z',
  scenario: 'FOIR breach — existing obligations leave no room for the instalment.',
  documents: bundle('RCL-2026-0426', {
    kyc: { name: 'Imran Qureshi', dob: '1986-11-05', gender: 'Male', id_number: 'XXXX XXXX 2264', address: '8-3-214, Nalgonda X Roads, Malakpet, Hyderabad 500036', mobile: '99XXXXXX47' },
    pan: { pan: 'CXXPQ2264M', pan_name: 'IMRAN QURESHI' },
    bank: {
      account_holder_name: 'IMRAN QURESHI', account_number: 'XXXXXXXX1190',
      bank_name: 'HDFC Bank', ifsc: 'HDFC0001190', address: 'Malakpet, Hyderabad 500036', period: 'Mar 2026 — Aug 2026',
      monthly_credits: [54200, 51800, 55600, 52900, 53400, 54100],
      monthly_cash_deposits: [4200, 3800, 4600, 3900, 4100, 4400],
      average_monthly_balance: 11800, bounce_count: 1,
      recurring_debits: [
        { label: 'Commercial vehicle loan — Shriram Finance', amount: 14200, kind: 'LOAN_EMI', source: 'Recurring debit, 7th of month' },
        { label: 'Two-wheeler loan — TVS Credit', amount: 3800, kind: 'LOAN_EMI', source: 'Recurring debit, 12th of month' },
        { label: 'Personal loan — Fibe', amount: 6400, kind: 'LOAN_EMI', source: 'Recurring debit, 2nd of month' },
      ],
    },
    platform: { provider: 'Porter', partner_id: 'PTR-HYD-XXXX-8871', monthly_net: [53800, 51200, 54900, 52400, 53100, 53700], active_months: 31, rating: 4.5 },
    invoice: {
      dealer_name: 'Deccan EV Motors, Malakpet', invoice_number: 'DEV/26-27/02219',
      model: 'Euler HiLoad EV', vehicle_category: 'EV_3W_CARGO', chassis_number: 'MB2XXXXXXXXXX2219',
      ex_showroom: 398000, insurance: 21400, registration: 12600, accessories: 9000, on_road_price: 441000, subsidy: 0,
    },
  }),
}

// 4 — Lakshmi Narayanan (Contradiction)
const A4 = {
  id: 'RCL-2026-0433', borrower_name: 'Lakshmi Narayanan', segment: 'EV_2W',
  loan_amount: 132000, tenure_months: 36, declared_monthly_income: 47000,
  branch: 'Coimbatore — Gandhipuram', officer: 'K. Vasanth', dealer: 'Kovai Electric, Gandhipuram',
  occupation: 'Food delivery partner', created_at: '2026-09-05T14:26:00.000Z',
  scenario: 'Blocking contradiction — undisclosed settlement account and a third-party bank holder.',
  documents: bundle('RCL-2026-0433', {
    kyc: { name: 'Lakshmi Narayanan', dob: '1996-01-30', gender: 'Female', id_number: 'XXXX XXXX 5518', address: '22/4 Cross Cut Road, Gandhipuram, Coimbatore 641012', mobile: '90XXXXXX63' },
    pan: { pan: 'DXXPN5518N', pan_name: 'LAKSHMI NARAYANAN' },
    bank: {
      account_holder_name: 'SURESH KUMAR RAMASAMY', account_number: 'XXXXXXXX3302',
      bank_name: 'Indian Bank', ifsc: 'IDIB000G112', address: 'No 5, Perundurai Main Road, Erode 638052', period: 'Mar 2026 — Aug 2026',
      monthly_credits: [21400, 19800, 22600, 20100, 21900, 20400],
      monthly_cash_deposits: [8200, 7600, 8900, 7400, 8100, 7800],
      average_monthly_balance: 4100, bounce_count: 0, recurring_debits: [],
    },
    platform: { provider: 'Swiggy', partner_id: 'SWG-CBE-XXXX-2204', monthly_net: [44800, 46200, 45100, 43900, 46800, 45400], active_months: 14, rating: 4.6 },
    invoice: {
      dealer_name: 'Kovai Electric Vehicles, Gandhipuram', invoice_number: 'KEV/26-27/00967',
      model: 'TVS iQube S', vehicle_category: 'EV_2W', chassis_number: 'MD6XXXXXXXXXX0967',
      ex_showroom: 128000, insurance: 8100, registration: 5400, accessories: 4500, on_road_price: 146000, subsidy: 5000,
    },
  }),
}

// 5 — Sandeep Yadav (Over-funded asset)
const A5 = {
  id: 'RCL-2026-0437', borrower_name: 'Sandeep Yadav', segment: 'EV_2W',
  loan_amount: 118000, tenure_months: 30, declared_monthly_income: 38000,
  branch: 'Jaipur — Vaishali Nagar', officer: 'A. Nandini', dealer: 'Pink City EV, Vaishali Nagar',
  occupation: 'Courier partner', created_at: '2026-09-06T10:18:00.000Z',
  scenario: 'LTV in the referral band — affordability fine, asset cover thin.',
  documents: bundle('RCL-2026-0437', {
    kyc: { name: 'Sandeep Yadav', dob: '1992-09-17', gender: 'Male', id_number: 'XXXX XXXX 9043', address: 'Plot 118, Sector 4, Vaishali Nagar, Jaipur 302021', mobile: '82XXXXXX55' },
    pan: { pan: 'EXXPY9043P', pan_name: 'SANDEEP YADAV' },
    bank: {
      account_holder_name: 'SANDEEP YADAV', account_number: 'XXXXXXXX7756',
      bank_name: 'Bank of Baroda', ifsc: 'BARB0VJVAIS', address: 'Vaishali Nagar, Jaipur 302021', period: 'Mar 2026 — Aug 2026',
      monthly_credits: [39400, 38100, 40200, 37800, 39900, 38600],
      monthly_cash_deposits: [4800, 5200, 4400, 5600, 4900, 5100],
      average_monthly_balance: 9300, bounce_count: 0,
      recurring_debits: [{ label: 'Mobile handset EMI — Home Credit', amount: 1650, kind: 'LOAN_EMI', source: 'Recurring debit, 18th of month' }],
    },
    platform: { provider: 'Zomato', partner_id: 'ZMT-JAI-XXXX-6612', monthly_net: [38900, 37600, 39800, 37200, 39400, 38100], active_months: 19, rating: 4.4 },
    invoice: {
      dealer_name: 'Pink City EV, Vaishali Nagar', invoice_number: 'PCE/26-27/01330',
      model: 'Ola S1 Air', vehicle_category: 'EV_2W', chassis_number: 'MD8XXXXXXXXXX1330',
      ex_showroom: 118000, insurance: 7400, registration: 4900, accessories: 3700, on_road_price: 134000, subsidy: 8000,
    },
  }),
}

// 6 — Farida Begum (Thin file)
const A6 = {
  id: 'RCL-2026-0441', borrower_name: 'Farida Begum', segment: 'EV_2W',
  loan_amount: 88000, tenure_months: 36, declared_monthly_income: 27000,
  branch: 'Lucknow — Aminabad', officer: 'S. Prakash', dealer: 'Awadh EV, Aminabad',
  occupation: 'Tailoring unit owner', created_at: '2026-09-07T13:55:00.000Z',
  scenario: 'Thin file — only four months of observable income history.',
  documents: bundle('RCL-2026-0441', {
    kyc: { name: 'Farida Begum', dob: '1998-05-08', gender: 'Female', id_number: 'XXXX XXXX 3387', address: '19/221 Nazirabad Road, Aminabad, Lucknow 226018', mobile: '70XXXXXX14' },
    pan: { pan: 'FXXPB3387Q', pan_name: 'FARIDA BEGUM' },
    bank: {
      account_holder_name: 'FARIDA BEGUM', account_number: 'XXXXXXXX2298',
      bank_name: 'Canara Bank', ifsc: 'CNRB0002298', address: 'Aminabad, Lucknow 226018', period: 'May 2026 — Aug 2026',
      monthly_credits: [28400, 26900, 29600, 27800],
      monthly_cash_deposits: [6400, 5900, 6800, 6200],
      average_monthly_balance: 5200, bounce_count: 0, recurring_debits: [],
    },
    invoice: {
      dealer_name: 'Awadh EV Showroom, Aminabad', invoice_number: 'AEV/26-27/00558',
      model: 'Hero Vida V1 Plus', vehicle_category: 'EV_2W', chassis_number: 'MD3XXXXXXXXXX0558',
      ex_showroom: 96000, insurance: 5800, registration: 3900, accessories: 2300, on_road_price: 108000, subsidy: 6000,
    },
  }),
}

// 7 — Vikram Singh Rathore (Small fleet owner)
const A7 = {
  id: 'RCL-2026-0445', borrower_name: 'Vikram Singh Rathore', segment: 'EV_3W_CARGO',
  loan_amount: 340000, tenure_months: 48, declared_monthly_income: 96000,
  branch: 'Pune — Hadapsar', officer: 'R. Kulkarni', dealer: 'Sahyadri EV, Hadapsar',
  occupation: 'Small fleet operator (4 vehicles)', created_at: '2026-09-08T09:33:00.000Z',
  scenario: 'Established operator — large ticket, comfortable on every rule.',
  documents: bundle('RCL-2026-0445', {
    kyc: { name: 'Vikram Singh Rathore', dob: '1983-02-19', gender: 'Male', id_number: 'XXXX XXXX 6604', address: 'Survey 88/2, Magarpatta Road, Hadapsar, Pune 411028', mobile: '96XXXXXX30' },
    pan: { pan: 'GXXPR6604R', pan_name: 'VIKRAM SINGH RATHORE' },
    bank: {
      account_holder_name: 'VIKRAM SINGH RATHORE', account_number: 'XXXXXXXX5541',
      bank_name: 'ICICI Bank', ifsc: 'ICIC0000445', address: 'Hadapsar, Pune 411028', period: 'Mar 2026 — Aug 2026',
      monthly_credits: [102400, 98600, 105200, 99800, 103600, 101200],
      monthly_cash_deposits: [7200, 6800, 7600, 6400, 7100, 6900],
      average_monthly_balance: 38400, bounce_count: 0,
      recurring_debits: [{ label: 'Fleet loan — Tata Capital', amount: 18600, kind: 'LOAN_EMI', source: 'Recurring debit, 5th of month' }],
    },
    platform: { provider: 'Porter', partner_id: 'PTR-PNQ-XXXX-1177', monthly_net: [101800, 97900, 104600, 99100, 102900, 100400], active_months: 44, rating: 4.8 },
    invoice: {
      dealer_name: 'Sahyadri EV Commercial, Hadapsar', invoice_number: 'SEV/26-27/03104',
      model: 'Piaggio Ape E-Xtra FX', vehicle_category: 'EV_3W_CARGO', chassis_number: 'MB9XXXXXXXXXX3104',
      ex_showroom: 362000, insurance: 19800, registration: 11400, accessories: 8800, on_road_price: 402000, subsidy: 0,
    },
  }),
}

// 8 — Anjali Pawar (Volatile earnings)
const A8 = {
  id: 'RCL-2026-0449', borrower_name: 'Anjali Pawar', segment: 'EV_3W_PASSENGER',
  loan_amount: 212000, tenure_months: 42, declared_monthly_income: 35000,
  branch: 'Nagpur — Sitabuldi', officer: 'K. Vasanth', dealer: 'Orange City EV, Sitabuldi',
  occupation: 'Tourist auto operator', created_at: '2026-09-09T15:47:00.000Z',
  scenario: 'Seasonal income — mean clears the floor but dispersion and conduct do not.',
  documents: bundle('RCL-2026-0449', {
    kyc: { name: 'Anjali Pawar', dob: '1991-12-02', gender: 'Female', id_number: 'XXXX XXXX 8125', address: 'Flat 3, Shivaji Nagar, Sitabuldi, Nagpur 440012', mobile: '75XXXXXX92' },
    pan: { pan: 'HXXPP8125S', pan_name: 'ANJALI PAWAR' },
    bank: {
      account_holder_name: 'ANJALI PAWAR', account_number: 'XXXXXXXX6673',
      bank_name: 'Union Bank of India', ifsc: 'UBIN0806673', address: 'Sitabuldi, Nagpur 440012', period: 'Mar 2026 — Aug 2026',
      monthly_credits: [52400, 48900, 21600, 18400, 44200, 51800],
      monthly_cash_deposits: [9400, 8800, 4200, 3600, 8100, 9200],
      average_monthly_balance: 2400, bounce_count: 2,
      recurring_debits: [{ label: 'Gold loan interest — Muthoot', amount: 2900, kind: 'LOAN_EMI', source: 'Recurring debit, 20th of month' }],
    },
    invoice: {
      dealer_name: 'Orange City EV, Sitabuldi', invoice_number: 'OCE/26-27/01745',
      model: 'Bajaj RE E-TEC 9.0', vehicle_category: 'EV_3W_PASSENGER', chassis_number: 'MC4XXXXXXXXXX1745',
      ex_showroom: 238000, insurance: 13200, registration: 8600, accessories: 5200, on_road_price: 265000, subsidy: 0,
    },
  }),
}

export const SYNTHETIC_APPLICATIONS = [A1, A2, A3, A4, A5, A6, A7, A8]
