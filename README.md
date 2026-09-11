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
a recognised income figure. Models read documents and explain results;
`recaller/credit_engine` computes, and it is the only thing that does.

```
            n8n  (workflow orchestration — Phase 4)
             │
      RECALLER backend  (Python · FastAPI)
             │
   ┌─────────┴──────────┐
 Hermes-based agents     Deterministic core
 recaller/ai/hermes      extraction → reconciliation → credit engine → policy → decision → memo → audit
 read · review · explain computes · decides · records
```

## Layout — Python first

```
RECALLER/
├── recaller/                 The product: Python package & FastAPI backend
│   ├── app/                    FastAPI backend: api, service, SQLite, jobs, middleware
│   ├── documents/              upload reading (PyMuPDF), pattern extractor, extraction router
│   ├── ai/hermes/              agent layer built on Hermes Agent patterns (MIT)
│   │   ├── loop.py, registry.py, toolsets.py, delegation.py (delegate_task), providers.py
│   │   ├── adapter.py            grounded evidence agent, multi-agent review, decision explanation
│   │   └── skills/               credit-underwriter (ours) · instructor (from Hermes, MIT)
│   ├── core/  extraction/  reconciliation/  credit_engine/  policy_engine/
│   ├── narration/  whatif/  orchestrator/  synthetic/
│   ├── config.py  cli.py
├── packages/                 Deterministic domain packages (JavaScript / ES modules)
│   ├── core/                   money math, hashing, audit ledger, constants
│   ├── credit-engine/          deterministic EMI, FOIR, LTV, evidence strength
│   ├── reconciliation/         cross-document consistency & similarity
│   ├── policy-engine/          rule evaluator & threshold decision engine
│   ├── extraction/             document pattern extractor
│   ├── narration/              credit memo generation
│   ├── whatif/                 binary search solvers (amount, tenure, co-applicant)
│   └── orchestrator/           12-stage resumable underwriting pipeline
├── frontend/                 Full modern web app: landing site + loan officer console (React + Vite)
├── app/                      Loan officer console client (React)
├── policy/policy.v1.json     Every credit & risk threshold in the system
├── tests/                    pytest: engine, pipeline, agent layer, end-to-end API (72 tests)
├── scripts/                  Windows launcher, standalone build, verification
├── workflows/                n8n workflow definitions               [Phase 4]
├── installer/  winget/       Windows packaging
├── n8n-master/  hermes/      local reference sources — git-ignored, never published
└── docs/                     local notes — git-ignored
```

The frontend console holds no credit logic. Every number on a screen arrived from the
backend or deterministic packages already computed.

## Running it

**Windows, double-click:** `Start RECALLER.cmd`. It creates `.venv`, installs
the package on first run, runs the test suite (a failing engine never starts),
builds the console if needed, serves everything on http://127.0.0.1:4180/ and
opens a browser.

### 1. Start the Backend API (FastAPI)

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -e ".[dev]"

.\.venv\Scripts\python -m recaller.cli serve --host 127.0.0.1 --port 4180
```
- API & Console: `http://127.0.0.1:4180/`
- Interactive Swagger Docs: `http://127.0.0.1:4180/docs`
- Health check: `http://127.0.0.1:4180/api/health`

### 2. Start the Frontend (Vite)

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```
- UI available at `http://localhost:5173/`
- Seamlessly connects to the backend at `http://127.0.0.1:4180`
- Automatically degrades to in-process deterministic execution if backend is offline

### 3. Verification & Testing

```powershell
.\.venv\Scripts\pytest -v          # Python backend test suite (72 passing tests)
npm --prefix frontend run build   # Frontend production bundle compilation
```

**Standalone executable:** `python scripts/build_standalone.py` →
`dist/recaller/recaller.exe` and `dist/recaller-windows-x64.zip`.

## The API

Interactive docs at `/docs` (Swagger) and `/redoc`; the schema at `/openapi.json`.

| | |
|---|---|
| `GET /api/bootstrap` | policy, vocabulary, stage plan, queue — everything the console needs to start |
| `POST /api/applications` | create an application |
| `POST /api/applications/{id}/documents` | upload a PDF / text / image (multipart: `type`, `file`) |
| `POST /api/applications/{id}/documents/sample` | attach a synthetic sample document |
| `POST /api/applications/{id}/underwrite` | run the pipeline; waits and returns the record — or `?async=true` → `202` + job |
| `GET /api/applications/{id}/events` | Server-Sent Events: `snapshot`, `stage`, `end`, `agent` |
| `POST /api/applications/{id}/resume` | officer resolutions for held fields (same sync/async modes) |
| `POST /api/applications/{id}/replay` · `whatif` · `simulate` | reproducibility and scenario analysis |
| `GET /api/applications/{id}/audit/verify` | recompute the audit hash chain |
| `POST /api/applications/{id}/agent/review` · `explain` | Hermes-based review and explanation (advisory; needs a model) |
| `GET /api/health` · `/api/diagnostics/{requests,jobs,config}` | health and debugging |

**Debugging a request.** Every response carries `X-Request-ID` (echoed if you
send one — the console sends `ui-…` ids), `Server-Timing` (shown in DevTools'
Timing tab) and `X-Response-Time`. Every error has one shape:

```json
{ "error": { "code": "MISSING_DOCUMENTS", "message": "…", "request_id": "ui-…", "details": { } }, "detail": "…" }
```

The console's **System & diagnostics** screen shows backend health, the model
provider, shipped skills, running jobs, the server's request log and this
browser's own calls with client- and server-side timings side by side.

```bash
curl -s localhost:4180/api/health
curl -s -X POST "localhost:4180/api/applications/RCL-2026-0418/underwrite?async=true" -H "Content-Type: application/json" -d '{"paced":false}'
curl -N "localhost:4180/api/applications/RCL-2026-0418/events?once=true"
```

## Documents and extraction

Uploaded files are stored under `var/uploads/` and read with PyMuPDF (OCR via
Tesseract when installed). Each document is routed:

| Document | Reader |
|---|---|
| synthetic sample | fixture adapter (deterministic demo data) |
| upload, model configured | Hermes evidence agent, gaps filled by the pattern extractor |
| upload, no model | pattern extractor (labelled lines, e.g. `On-Road Price: Rs 1,16,000`) |
| scanned, no OCR | nothing read |

Whatever the route, a required field that was not read becomes a
zero-confidence placeholder, so the **confidence gate stops the run and asks the
officer** instead of letting the engine run on absent evidence.

## The agent layer (Hermes)

`recaller/ai/hermes` takes what a credit system needs from
[Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT; see
`recaller/ai/hermes/THIRD_PARTY_NOTICES.md`): the tool loop, least-privilege
toolsets, `delegate_task` for isolated child agents, the skill format, and
Instructor-validated structured output.

- **Evidence agent** — reads a document's pages. A value enters evidence only
  through `record_evidence`, which requires a verbatim snippet from the cited
  page and the value inside that snippet. Numbers are read, never inferred.
- **Multi-agent review** — a supervisor delegates to KYC, income, invoice and
  reconciliation reviewers (read-only tools, Pydantic output contracts), then
  synthesises. Findings are advisory and stored beside the record.
- **Explanation** — plain-language decision summary; any number or reason code
  not already in the record gets it rejected in favour of the deterministic text.
- **The boundary** — the tool registry refuses any tool that decides or computes
  (`approve_*`, `compute_*`, `*_emi`, `set_policy`…), and a test asserts the agent
  package imports neither the credit engine nor the policy engine.

### Evidence strength

FOIR, EMI and LTV answer whether the borrower can repay. `computeEvidenceStrength`
answers the question a loan officer asks first: **how much of this file do we
actually know?** Four components of 25, scored 0–100:

| Component | What it measures |
| --- | --- |
| Corroboration | Independent income sources, and whether they agree inside the policy's own tolerance |
| Confidence | How far the critical fields sit above the policy's confidence floor |
| Consistency | What cross-document reconciliation found |
| Coverage | Which required document types produced fields, and how many months they carry |

Every threshold is read from `policy/policy.v1.json`, so moving a cutoff moves
the score. It is not a credit score, it scores the file rather than the borrower,
and **no policy rule reads it** — a weak file is a reason to look harder, not a
reason to decline. It is computed for held files too, which is where it matters
most: confirming the three held fields on `RCL-2026-0421` lifts it from 60 to 78,
because the officer's answer is itself evidence.

### Configuration

Nothing operational is hard-coded in the backend. Every tunable (host, port,
CORS origins, upload cap, stage pacing, application id format, pattern-extractor
confidence, agent limits, model, host, timeouts) is listed once in `DEFAULTS` in
`recaller/config.py` and overridden from the environment or a git-ignored `.env`
at the repository root. `.env.example` documents every key.
`GET /api/diagnostics/config` and the System screen show each effective value
and whether it was set or defaulted. Keys are never reported back.

Data is not configuration. The synthetic book (`recaller/synthetic`) and the
credit policy (`policy/policy.v1.json`) load exactly as they are.

### Configuring a model

Two providers, one interface. Without either, RECALLER runs fully deterministic
and the agent endpoints answer `503 LLM_NOT_CONFIGURED`.

**Ollama Cloud: NVIDIA Nemotron 3 Ultra.** Create a key at
https://ollama.com/settings/keys, then put this in `.env`:

```bash
RECALLER_LLM_PROVIDER=ollama
RECALLER_LLM_MODEL=nemotron-3-ultra
OLLAMA_HOST=https://ollama.com
OLLAMA_API_KEY=<your key>
```

Cloud's API names models without the `:cloud` suffix the local daemon uses.
`nemotron-3-ultra:cloud` is accepted and renamed, and `/api/health` says so.
With a key and no `OLLAMA_HOST`, the host defaults to Ollama Cloud.

**Ollama, local.** `ollama serve`, `ollama pull <model>`, then
`RECALLER_LLM_PROVIDER=ollama` and `RECALLER_LLM_MODEL=<model>`. No key is needed.

**Claude.** Set `ANTHROPIC_API_KEY`, or `RECALLER_LLM_PROVIDER=anthropic` with an
`ant auth login` profile. The model defaults to `claude-opus-5`.

**Check it is live** before trusting the agents with a file:

```powershell
.venv\Scripts\python -m recaller.cli check-llm      # prints the config (no key) and the model's own reply
curl -s -X POST localhost:4180/api/diagnostics/llm  # the same over HTTP; "Send test prompt" on the System screen
```

Ollama runs through `/api/chat` with the same tool loop, and uses Ollama's
JSON-schema `format` for structured output, so extraction stays validated.
Temperature defaults to `0` — reading a field off a document should give the
same answer twice. Reasoning models' thinking is kept out of the answer, and
`RECALLER_OLLAMA_THINK` turns it on, off or sets a level.
`RECALLER_OLLAMA_NUM_CTX` raises the context window for long statements.

An explanation reports `"source": "model"` when the model's own text was used,
and `"deterministic"` (with `rejected_reason`) when it cited a figure or reason
code that is not in the record and was replaced.

On `RECALLER_LLM_PROVIDER=auto` (the default) Claude wins if its key is present,
then Ollama if `OLLAMA_HOST` or `OLLAMA_API_KEY` is set, else no model at all.
`GET /api/health` reports which one is live.

Neither provider can reach the credit engine, the policy engine or the what-if
solver. Whatever the model, the money is computed by code.

## What makes it defensible

**The confidence gate does not guess.** Below the policy floor the run stops,
freezes a checkpoint and asks a human. Resume rehydrates the checkpoint; the
officer's answers become `OFFICER`-provenance evidence, and the value they
replaced is kept.

**The audit trail is hash-chained.** Each event carries its predecessor's digest;
the backend re-verifies the chain on every read.

**Replay proves reproducibility.** A decided file is re-executed from frozen
evidence with extraction out of the path. A second mode changes the policy on
purpose, to test a cut-off against the back book.

**What-if is exact.** The solver re-runs the complete pipeline for every
candidate and reports the true edge of the feasible region.

## The synthetic book

Eight borrowers are seeded into the database on first start (`POST /api/reset`
restores them):

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

Every identifier is masked and structurally invalid by construction.

## Status

| Phase | | |
|---|---|---|
| 1 | Console and all thirteen screens | **done** |
| 2 | Python backend: SQLite, uploads, background jobs, SSE, diagnostics | **done** |
| 3 | Deterministic domain core (Python) | **done** |
| 5 | Wait / resume human-in-the-loop | **done** |
| 6 | Audit trail and replay | **done** |
| 7 | Exact minimum-change what-if | **done** |
| 8 | Windows launcher and self-check | **done** |
| 9 | Hermes-based agents: grounded extraction, delegated review, explanation | **done** (needs a model key to run live) |
| 4 | n8n as the workflow orchestrator | next |
