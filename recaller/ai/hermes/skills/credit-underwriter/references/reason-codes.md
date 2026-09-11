# Reason codes

The source of truth is `policy/policy.v1.json` (`reason_codes`, `rules`). Quote
codes exactly; never invent one, and never cite a code the decision record does
not contain.

## Verdict precedence (policy engine)

1. Any BLOCKING rule failing with a reject code → **REJECT**
2. Any unresolved low-confidence field → **REFER**
3. Any rule in its referral band, or an advisory failure → **REFER**
4. Otherwise → **APPROVE**

An advisory rule can refer, but never reject.

## Approve (A)

| Code | Meaning |
| --- | --- |
| A01 | Verified monthly income meets policy floor |
| A02 | FOIR within policy ceiling |
| A03 | LTV within policy ceiling |
| A04 | No blocking reconciliation finding |
| A05 | Sufficient income history observed |
| A06 | Income volatility within tolerance |
| A07 | Average monthly balance adequate |
| A08 | Repayment conduct clean in observation window |
| A09 | Age at maturity within policy |
| A10 | All critical evidence above confidence floor |

## Reject (R)

| Code | Meaning |
| --- | --- |
| R01 | FOIR exceeds policy ceiling |
| R02 | Material cross-document contradiction unresolved |
| R03 | LTV exceeds policy ceiling |
| R04 | Verified income below policy floor |
| R05 | Insufficient income history |
| R06 | Income volatility beyond tolerance |
| R07 | Adverse repayment conduct - returned debits |
| R08 | Age at maturity exceeds policy |
| R09 | Applicant below minimum age |
| R10 | Requested amount outside product band |
| R11 | Requested tenure outside product band |

## Refer (F)

| Code | Meaning |
| --- | --- |
| F01 | Low-confidence evidence requires officer verification |
| F02 | Officer verification required |
| F03 | FOIR in referral band |
| F04 | LTV in referral band |
| F05 | Verified income in referral band |
| F06 | Income history in referral band |
| F07 | Income volatility in referral band |
| F08 | Average monthly balance in referral band |
| F09 | Returned debits in referral band |
| F10 | Multiple advisory reconciliation findings |

## Rules

P-FOIR-01 FOIR · P-LTV-01 LTV · P-INC-01 minimum income · P-INC-02 income
stability · P-INC-03 income volatility (advisory) · P-BAL-01 average balance
(advisory) · P-BNC-01 returned debits · P-AGE-01 age at maturity · P-AGE-02
minimum age · P-TKT-01 ticket size · P-TEN-01 tenure · P-REC-01 no blocking
reconciliation finding · P-REC-02 advisory reconciliation findings (advisory) ·
P-CNF-01 critical evidence above the confidence floor.
