# RECALLER workflows (n8n) — Phase 4

This directory will hold the importable n8n workflow definitions. They are not
built yet: the orchestration path today runs in `packages/orchestrator`, which
the console drives directly. This file records the design the workflows must
implement, so that wiring n8n in is an integration job and not a redesign.

## The rule that shapes everything here

**n8n orchestrates. It does not compute.**

No Function node may calculate an EMI, a FOIR, an LTV, an obligation total or a
recognised income figure. There must never be a second copy of the credit
engine inside a workflow. Every deterministic step is an HTTP Request node
calling the RECALLER backend, which calls the same `packages/` code the console
and the test suite use. One implementation, three callers.

## Master flow

```
Webhook  POST /underwrite
    |
    +-- Fetch application + document bundle
    |
    +-- Extraction subflows (parallel, one per document family)
    |     KYC        -> POST /api/extract/kyc
    |     Bank       -> POST /api/extract/bank
    |     Platform   -> POST /api/extract/platform
    |     Invoice    -> POST /api/extract/invoice
    |
    +-- Merge evidence  -> POST /api/evidence/validate
    |
    +-- Reconciliation  -> POST /api/reconcile
    |
    +-- Confidence gate -> POST /api/evidence/gate
    |
    +-- IF held ----------------------------------+
    |        |                                    |
    |     Wait node (resume on webhook)           | not held
    |        |                                    |
    |     Officer answers arrive                  |
    |     POST /api/applications/:id/resume       |
    |        |                                    |
    |        +------------------------------------+
    |                     |
    +-- POST /api/credit        (deterministic metrics)
    +-- POST /api/policy        (rule evaluation)
    +-- POST /api/decision      (verdict + reason codes)
    +-- POST /api/narrate       (credit memo)
    +-- POST /api/audit         (append execution metadata)
    |
    +-- Respond
```

## What n8n contributes that the in-process orchestrator does not

- **Durable waiting.** The Wait node survives a process restart, so a file
  suspended overnight at the confidence gate resumes the next morning rather
  than restarting.
- **Execution history** as an independent record, cross-referenced against
  RECALLER's own hash-chained ledger.
- **Retries and error branches** on extraction, which is the only stage that
  touches anything unreliable.
- **Webhook handling** for the officer's resume, and for dealer-side triggers.

## Audit integration

The record already carries the fields the audit screen renders:

```js
execution: {
  n8n_execution_id: null,             // set by the workflow
  workflow_version: 'recaller-master@1.0.0',
}
```

Today they display as `local (not orchestrated)`. The workflow must pass its
execution id into `POST /api/applications/:id/underwrite` so the trail can be
tied back to the n8n run.

## `n8n-master/`

A vendored source tree, kept separate and unmodified. RECALLER is not moved
inside it, it is not rewritten, and the n8n monorepo is not the application. It
is the source from which the required runtime is selected, nothing more.
