# Hermes Agent in RECALLER

Status: **plan, not implemented.** Nothing from Hermes is in the repo yet.

## The three layers

```
n8n        workflow execution   start, pause for review, resume, retry, replay
Hermes     AI reasoning         read evidence, flag inconsistencies, ask, explain
RECALLER   credit truth         EMI, FOIR, LTV, obligations, policy, reason codes, decision
```

Runtime flow:

```
n8n → Hermes sub-agents (KYC, income, invoice) → RECALLER evidence layer
    → reconciliation → deterministic engine → policy engine → decision
    → Hermes narrator → credit memo
```

## The hard boundary

Hermes **may** interpret documents, identify evidence, flag inconsistencies, request
missing information and explain results.

Hermes **may not** produce a financial figure, calculate EMI/FOIR/LTV, override policy,
create evidence, or change a decision.

In practice:

- The agent never gets a tool whose arguments decide money (no `approve_loan(amount, …)`).
- It can call only backend-owned operations: `calculate_credit(input)` and
  `evaluate_policy(result)`. It receives their output and narrates it.
- Toolsets are allow-listed per agent (least privilege). No shell, browser, web, file-write
  or memory tools in the credit path.
- Every model output passes a Pydantic schema (Instructor) before RECALLER accepts it.
  Schema validation only checks shape and ranges, not truth. Evidence reconciliation and
  the deterministic engine are still what make a value trustworthy.

## What to take from Hermes

Checked against `NousResearch/hermes-agent@main` on 2026-09-11. Licence: **MIT** (keep the
copyright notice on anything copied).

| Component | Verified | Use in RECALLER |
| --- | --- | --- |
| `run_agent.py` (`AIAgent` facade) | 1,556 lines | Reference for the model → tool → result → continue loop. Don't copy wholesale. |
| `agent/conversation_loop.py` | 1,677 lines | Core loop (model calls, tool dispatch, retries). Study, extract only what's needed. |
| `agent/` overall | 280 files | Much larger than the loop alone. Selective reuse only. |
| `tools/delegate_tool.py` | 745 lines | `delegate_task`: isolated child agents that return a summary. Basis for the KYC / income / invoice / reconciliation / narration agents. |
| `toolsets.py`, `model_tools.py` | present | Tool registration and restriction. Use to enforce least privilege. |
| Skills system (`SKILL.md` + `references/` + `scripts/`) | present | Write a `credit-underwriter` skill holding the rules above, policy references and reason codes. |
| `optional-skills/mlops/instructor` | present | Pydantic-validated structured output. Strongly recommended. |
| `skills/productivity/pdf` | present | PDF text/page extraction via PyMuPDF (`extract_pymupdf.py`, `pdf_read.py`, `pdf_page_image.py`). Feeds raw content into RECALLER's own typed evidence schema. |
| `optional-skills/mlops/guidance` | present | Constrained generation. Defer; only if schema validation proves insufficient. |
| `hermes_state.py` | present | Persistent agent state. Maybe later. |
| `gateway/`, desktop, TUI, memory, cron, browser | present | Don't use. |

Corrections to the original plan:

- `run_agent.py` is about 1.6k lines, not about 8.3k.
- There is no `skills/productivity/ocr-and-documents` skill any more. PDF extraction is in
  `skills/productivity/pdf`. Its docs page (`website/docs/.../productivity-ocr-and-documents.md`)
  is stale. No Marker PDF integration was found.
- The plan refers to an existing `packages/extraction`. RECALLER has no `packages/` yet.

## Planned layout

```
RECALLER/
├── ai/
│   ├── hermes/          adapter, agent, delegation, tools, config
│   ├── skills/credit-underwriter/{SKILL.md, references/, scripts/}
│   ├── extraction-agent/
│   ├── reconciliation-agent/
│   └── narration-agent/
├── packages/            extraction, reconciliation, policy-engine (deterministic)
├── workflows/n8n/
├── hermes-agent/        isolated upstream checkout, git-ignored like n8n-master/
└── n8n-master/
```

Hermes runs as an internal agent service behind n8n. It is never the public-facing backend.

## Open decisions

- Vendor code from Hermes into `ai/hermes/`, or depend on a pinned `hermes-agent` install?
- Which model provider(s) the agents use.
- Where the confidence threshold (0.85 in the presentation) and the policy versions live.
