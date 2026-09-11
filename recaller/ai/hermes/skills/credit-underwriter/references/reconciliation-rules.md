# Reconciliation rules

Reconciliation (`recaller/reconciliation/reconcile.py`) compares what different
documents claim about the same fact. Its tolerances live in
`policy/policy.v1.json` (`reconciliation`). **It grades; you explain.** Never
re-grade a finding, and never call a MATCHED item a problem without new
evidence you can cite.

## Statuses

| Status | Meaning | Effect |
| --- | --- | --- |
| MATCHED | Sources agree within tolerance | none |
| ADVISORY | Minor variance | may refer; noted in the memo |
| MISMATCH | Material variance, resolved by rule | counted with advisory |
| BLOCKING | Contradiction that halts sanction | fails P-REC-01, so REJECT |

## Checks

- **Applicant name vs bank account holder.** Name similarity. A third-party
  account holder is a classic blocking contradiction.
- **Applicant name vs name on PAN.** Name similarity.
- **KYC address vs statement address.** Address similarity; advisory at worst.
- **Declared vs verified income.** A large gap is advisory. Remember the engine
  always uses the verified figure, never the declared one.
- **Bank credits vs platform settlements.** Two independent income views should
  corroborate each other.
- **Invoice ex-showroom vs on-road price.** The components must be consistent.
- **On-road price against the requested amount.** Feeds LTV.
- **Invoiced vehicle category vs applied segment.** Must agree: pricing and caps
  are segment-specific.

## What good review looks like

- Tie every concern to evidence paths (for example `bank.account_holder_name`)
  and cite the page snippet.
- Name what would resolve it: a document, a confirmation, a waiver by an
  authorised officer.
- Say plainly when everything agrees. "No concerns" is a valid review.
