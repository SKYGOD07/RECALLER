# RECALLER

**AI agentic credit underwriter for thin-file green borrowers.**

EV two- and three-wheeler finance for gig drivers, small fleet owners and
first-time borrowers — people whose income arrives through UPI and platform
settlements rather than payslips, and who have little or no bureau history. The
lender needs a fast, defensible, auditable decision at a dealership counter.

## The architecture in one line

> **AI understands evidence. Deterministic code computes money. Policy
> configuration governs thresholds. The audit layer records what happened.**

No language model ever produces an EMI, a FOIR, an LTV, an obligation total or
a recognised income figure. Models read documents; `packages/credit-engine`
computes, and it is the only thing that does. This is enforced structurally —
the engine's inputs are already-extracted, already-confidence-gated field
values, and its functions are pure.

## Two separate products

| | |
|---|---|
| `frontend/` | The **public presentation site** — what RECALLER is, and where to download it. |
| `app/` | The **loan officer console** — the working underwriting application. |

They are not merged and must not be. The first sells the product; the second is
the product.

```
RECALLER/
├── frontend/            Public presentation / download website
├── app/                 Loan officer console (the working application)
├── app-backend/         HTTP API for the console            [Phase 2 - not yet built]
├── packages/            Deterministic domain logic
│   ├── core/              money, hashing, audit ledger, shared vocabulary
│   ├── extraction/        document -> confidence-scored evidence
│   ├── reconciliation/    cross-document contradiction detection
│   ├── credit-engine/     EMI, FOIR, LTV, obligations, income recognition
│   ├── policy-engine/     rule evaluation -> verdict + reason codes
│   ├── narration/         credit memo assembly
│   ├── whatif/            exact minimum-change solver
│   └── orchestrator/      stage sequencing, pause/resume, replay
├── policy/              policy.v1.json - every threshold in the system
├── data/synthetic/      Eight borrower bundles covering every decision path
├── workflows/           n8n workflow definitions                [Phase 4]
├── installer/           Windows packaging
├── scripts/             Launcher, tests, pipeline verification
└── n8n-master/          Vendored n8n source - separate, untouched
```

## Running it

**Windows, double-click:** `Start RECALLER.cmd`

It checks for Node.js 20+, installs dependencies on first run, verifies the
credit engine, builds the console and opens a browser. There are no absolute
paths and no machine-specific configuration; the folder can live anywhere.

**From a terminal:**

```bash
npm run install:all     # once
npm run app             # dev server on http://127.0.0.1:4180
npm run check           # engine tests + full pipeline verification
```

## The workflow

```
New application -> Upload documents -> Extraction -> Validation -> Reconciliation
   -> Confidence gate -> [Officer review if held] -> Credit calculation
   -> Policy evaluation -> Decision -> Reason codes -> Credit memo -> Audit trail
```

Thirteen screens follow that path: dashboard, new application, processing,
evidence, reconciliation, assist, credit analysis, policy, decision, memo,
audit trail, replay, what-if.

### What makes it defensible

**The confidence gate does not guess.** When extraction confidence falls below
the policy floor, the run stops, freezes a checkpoint and asks a human. Resume
rehydrates the checkpoint — documents are not re-read and no model is
re-invoked. Only the stages after the gate re-run, with the officer's answers
folded in as officer-provenance evidence.

**The audit trail is hash-chained.** Each event carries the digest of its
predecessor, so the console can verify that nothing was removed or edited after
the fact, and shows the result.

**Replay proves reproducibility.** A decided file is re-executed from its own
frozen evidence with the extraction adapter out of the path entirely. A model
that has since changed its weights cannot change a historical decision. The
second mode changes the policy on purpose: same evidence, a different rulebook,
so a committee can test a cut-off against the back book.

**What-if is exact, not interpolated.** The solver re-runs the complete
pipeline for every candidate and reports the true edge of the feasible region —
binary search where a lever is monotone, exhaustive evaluation for tenure,
where a longer term lowers the instalment but raises age at maturity.

## The synthetic book

Eight borrowers, each exercising a different path. `npm run verify` runs all of
them and prints what happened:

| File | Borrower | Verdict | Exercises |
|---|---|---|---|
| RCL-2026-0418 | Rahul Sharma | APPROVE | Clean file, every rule passes first time |
| RCL-2026-0421 | Meena Devi | APPROVE after resume | Three fields held; suspend, officer verify, resume |
| RCL-2026-0426 | Imran Qureshi | REJECT | FOIR breach; no single lever can rescue it |
| RCL-2026-0433 | Lakshmi Narayanan | REJECT | Third-party bank holder, undisclosed settlement account |
| RCL-2026-0437 | Sandeep Yadav | REFER | LTV in the referral band; what-if finds the exact fix |
| RCL-2026-0441 | Farida Begum | REFER | Thin file, four months of history |
| RCL-2026-0445 | Vikram Singh Rathore | APPROVE | Established fleet operator, large ticket |
| RCL-2026-0449 | Anjali Pawar | REFER | Seasonal income, volatility and conduct |

Every identifier is masked and structurally invalid by construction. Nothing
here can be mistaken for live KYC material.

## Status

| Phase | | |
|---|---|---|
| 1 | Console shell and all thirteen screens | **done** |
| 3 | Deterministic domain packages wired in | **done** |
| 5 | Wait / resume human-in-the-loop | **done** |
| 6 | Audit trail and replay | **done** |
| 7 | Exact minimum-change what-if | **done** |
| 8 | Windows launcher and self-check | **done** |
| 2 | Backend HTTP API | next |
| 4 | n8n as the workflow orchestrator | next |

Phases 2 and 4 are a transport change, not a rewrite: every screen already
talks to `app/src/services/api.js` and nothing else, and each function there
maps one-to-one onto its future endpoint. See `docs/ARCHITECTURE.md`.
