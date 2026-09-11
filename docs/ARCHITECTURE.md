# RECALLER — architecture

## The invariant

Everything in this system exists to keep one boundary intact:

```
  documents ──► [ extraction: a model reads ] ──► evidence + confidence
                                                        │
                                            confidence gate ──► human, if held
                                                        │
                        [ credit engine: pure functions ] ──► EMI, FOIR, LTV
                                                        │
                        [ policy engine: configured rules ] ──► verdict + codes
                                                        │
                                                    audit ledger
```

A model reads. Code computes. Configuration decides where the lines are. The
ledger records all of it. Nothing crosses those boundaries.

### How the invariant is enforced, not merely intended

- `packages/credit-engine` takes plain values and returns numbers. It has no
  network access, no model client, no clock and no random source. Its output is
  a pure function of its input, which is what makes `input_hash` meaningful.
- Evidence carries provenance on every field: `EXTRACTED`, `OFFICER`,
  `COMPUTED`, `POLICY` or `DECLARED`. The console renders it, so nobody
  mistakes a model's reading for a computation or a borrower's claim for a
  verified figure.
- The narrator (`packages/narration`) interpolates finished figures into prose.
  If an optional LLM stylist is attached, its rewrite is accepted only when the
  numeric tokens are byte-identical to the deterministic text; otherwise the
  deterministic text stands.
- Every audit event names its actor. `LLM` appears only on extraction stages.

## Package boundaries

| Package | Owns | Never does |
|---|---|---|
| `core` | Integer-paise money math, stable hashing, seeded PRNG, hash-chained ledger, shared enums | Anything domain-specific |
| `extraction` | Document → `EvidenceField{value, confidence, citation}`; the confidence gate; folding in officer answers | Arithmetic on money |
| `reconciliation` | Cross-document comparison, name/address similarity, grading against tolerances | Deciding anything |
| `credit-engine` | EMI, FOIR, LTV, obligations, income recognition, amortisation | Reading documents; knowing thresholds |
| `policy-engine` | Walking the rule set, verdict precedence, reason codes | Holding a threshold of its own |
| `narration` | Credit memo assembly, decision headline | Computing a figure |
| `whatif` | Exact minimum-change solving over a supplied evaluator | Knowing how the pipeline works |
| `orchestrator` | Stage order, checkpointing, resume, replay, audit emission | Domain logic |

The orchestrator is the only module that knows the order of operations, so the
console, the future backend and the future n8n workflow all execute an
identical path.

## Money arithmetic

All monetary values are carried in **integer paise**. `0.1 + 0.2` is a
liability in a credit system; `toPaise` scales, rounds half-up away from zero,
and every sum is performed on integers before being returned to rupees.

Ratios (FOIR, LTV, volatility) are rounded to the decimal places the policy
declares, so that a threshold comparison cannot swing on a float artefact.

The amortisation schedule's final instalment absorbs the rounding residue, so
the schedule closes at exactly zero and repaid principal equals the advance to
the paisa. `scripts/test-engine.mjs` asserts both.

## Income recognition

Thin-file borrowers are the whole point, so income is built from two
independent views and the more conservative one is taken:

- **Bank view** — mean monthly qualifying credits. Cash deposits take a haircut
  (50%) and are then *capped* as a share of recognised income (30%), which
  binds harder than the haircut for cash-heavy files.
- **Platform view** — mean monthly settlement, less a churn haircut (10%).

`verified_monthly_income = min(bank_view, platform_view)`. When no platform
statement is supplied the bank view stands alone, and the memo says so.

Every constant above lives in `policy.income_recognition`, not in the engine.

## The confidence gate

Extraction assigns each field a confidence. The policy sets two floors: 80% for
ordinary fields, 88% for the critical ones it names (applicant name, bank
account holder, account number, on-road price, chassis number, and so on).

A field below its floor is **held**. The system does not guess, does not retry
with a second model and does not proceed. `runUnderwriting` returns with
`status: WAITING_FOR_OFFICER` and a frozen `checkpoint`:

```js
checkpoint: {
  completed_stages, fields, extraction_stats, extraction_hash,
  byDocument, reconciliation, ledger, seed, hash
}
```

`resumeUnderwriting` rehydrates that checkpoint. Extraction does not run again.
Reconciliation *does* re-run, because a corrected name or amount can change a
finding. The officer's answers become evidence with `provenance: OFFICER`, and
the value they superseded is preserved on the field so the memo and audit trail
can show exactly what a human changed.

## Verdict precedence

Exactly three verdicts exist. `policy-engine` resolves them in this order:

1. Any **BLOCKING** rule failing with a reject code → **REJECT**
2. Any unresolved low-confidence field → **REFER**
3. Any rule inside its referral band, or an advisory failure → **REFER**
4. Otherwise → **APPROVE**

An ADVISORY rule can refer but can never reject; the test suite asserts this,
and the policy document is checked for advisory rules carrying reject codes.

## Determinism and replay

Three fingerprints anchor a decision:

- `extraction_hash` — the evidence, values and confidences
- `input_hash` — exactly what the credit engine was handed
- `policy_hash` — the rulebook as it stood

Replay recomputes from stored evidence with the extraction adapter out of the
path. If `input_hash` and every metric match and the verdict is unchanged, the
replay reports *reproduced exactly*. `scripts/verify-pipeline.mjs` asserts this
for all eight synthetic files on every run.

Replay-with-amended-policy changes the rulebook deliberately and reports the
diff — which metrics moved (none, if only thresholds changed), which reason
codes were added and removed, and whether the verdict flipped. The original
decision is never overwritten.

## The audit ledger

Append-only and hash-chained: each event carries `prev`, the digest of its
predecessor, and its own `digest` over the event body. `verifyLedger` recomputes
the chain and reports the first index where it breaks. Editing an event or
dropping one both fail verification, and the console surfaces the result rather
than assuming it passed.

Stage durations recorded in the ledger are real engine time. The console paces
the progress view by holding stages open through an awaited `onStage` callback,
and the timer starts *after* that callback returns, so presentation delay never
contaminates the record.

## Phases 2 and 4 — backend and n8n

The console talks to `app/src/services/api.js` and nothing else. No screen
performs credit arithmetic or evaluates a policy rule; when a number appears, it
arrived already computed. Each function in that module maps one-to-one onto an
endpoint:

| Service function | Endpoint |
|---|---|
| `listApplications` | `GET /api/applications` |
| `getApplication` | `GET /api/applications/:id` |
| `createApplication` | `POST /api/applications` |
| `startUnderwriting` | `POST /api/applications/:id/underwrite` |
| `resumeUnderwriting` | `POST /api/applications/:id/resume` |
| `replayApplication` | `POST /api/applications/:id/replay` |
| `solveWhatIf` | `POST /api/applications/:id/whatif` |
| `simulateScenario` | `POST /api/applications/:id/simulate` |

`MODE` already switches on `VITE_RECALLER_API`. Moving to HTTP is a change
inside that one file.

For n8n, the master flow calls the backend over HTTP Request nodes rather than
reimplementing anything:

```
Webhook -> Extraction subflows -> Validation -> Reconciliation
  -> Confidence gate -> Wait (resumed by the officer's webhook)
  -> POST /credit -> POST /policy -> Decision -> Narration -> Memo -> Audit
```

n8n owns orchestration, branching, waiting, resume and execution history. It
must not own financial logic, and there must never be a second copy of the
credit engine inside a Function node. The record already carries
`execution.n8n_execution_id` and `execution.workflow_version` for the audit
screen to display; today they read `local (not orchestrated)`.

`n8n-master/` is a vendored source tree. It is not rewritten, RECALLER is not
moved inside it, and the monorepo is not the application.

## Known limits of this build

- **Extraction is the fixture adapter.** It replays structured payloads bound to
  synthetic documents with deterministic confidence jitter shaped by field type
  and document quality. The LLM adapter implements the same interface but is not
  wired up; `packages/extraction/src/index.js` is where it plugs in.
- **Persistence is `localStorage`, and it stores intent, not output** — the
  application header, which documents were attached, and what the officer
  decided. Records are regenerated by re-running the pipeline, which is safe
  precisely because the pipeline is deterministic, and keeps stored state small.
- **Stage pacing in the console is presentational** and modelled on real
  document-understanding latency. Genuine n8n execution timings replace it in
  Phase 4. The audit trail already records real engine time, not paced time.
