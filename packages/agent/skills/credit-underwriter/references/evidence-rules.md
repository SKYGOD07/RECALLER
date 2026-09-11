# Evidence rules by document

The field paths come from `packages/extraction/src/schema.js`. The confidence
floors are in `policy/policy.v1.json` (`confidence`).

## Aadhaar / PAN (KYC)

- `applicant.name`: exactly as printed, including initials. Do not correct
  spelling or expand initials.
- `applicant.id_number`: record the masked form as printed (for example
  `XXXX XXXX 1234`). Never record or reconstruct an unmasked number.
- `applicant.dob`: record as printed; the date format may differ from ISO.
  Age is derived downstream and never recorded.

## Bank statement

- `bank.account_holder_name`: the holder shown on the statement header, not the
  applicant's name from KYC. A difference is a finding for reconciliation;
  record what is printed.
- `bank.monthly_credits` and `bank.monthly_cash_deposits`: one value per month,
  as printed in the statement's own monthly summary. If the statement has no
  summary, **do not add up transactions**. Flag the missing summary instead.
- `bank.recurring_debits`: only debits the statement shows repeating (EMIs,
  ACH mandates), with amounts as printed.

## Platform earnings statement

- `platform.monthly_net`: net settlement per month as printed. If only weekly
  figures are printed, flag it; weekly-to-monthly conversion is not yours to do.

## Dealer invoice

- `invoice.on_road_price` and its components: each as printed on the invoice.
  Never compute the on-road price from its parts, even if they obviously sum.
- `invoice.chassis_number`: exactly as printed. It is a critical field, so
  anything less than a clean read should carry low confidence.
