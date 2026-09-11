"""Hermes ↔ RECALLER.

Three ways RECALLER uses agents, each behind a hard boundary:

``AgentExtractionAdapter``
    Implements the extraction adapter interface (``extract(document, seed)``).
    The model reads the document's text pages; a value enters the evidence set
    only through ``record_evidence``, which enforces grounding: the field must
    belong to this document type, the snippet must be on the cited page, and
    the value (every number in it) must be in the snippet. Everything recorded
    still goes through the confidence gate.

``review_file``
    Multi-agent review of a finished file. A supervisor fans the work out with
    ``delegate_task`` to isolated KYC, income, invoice and reconciliation
    reviewers, each with read-only tools and a Pydantic output contract, then
    synthesises (Instructor). Findings are advisory and stored beside the
    record; they never touch the decision or the ledger.

``explain_decision``
    A plain-language explanation for the officer (Instructor). Every number and
    reason code it states must already exist in the record, or it is discarded
    and the deterministic headline stands.

``ask_about_file``
    The officer asks, the model answers: a tool loop over every read-only view
    of the record, with the credit-underwriter skill. The answer is returned
    with the model's reasoning, the tools it used, and any figure it stated
    that the record does not contain.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

from ...core.constants import PROVENANCE
from ...documents.normalise import number_list, numbers_in, parse_date, parse_number, squash, value_in_snippet
from ...extraction.schema import EVIDENCE_SPEC, field
from .delegation import delegate_task
from .loop import run_agent
from .providers import structured
from .registry import ToolRegistry
from .schemas import ChildReview, DecisionExplanation, ReviewSynthesis
from .skills import load_skill, skill_prompt
from .tools import build_review_registry, evidence_slice
from .toolsets import resolve_toolset, resolve_toolsets


def _underwriter_prompt(references: Optional[List[str]] = None) -> str:
    return skill_prompt(load_skill("credit-underwriter"), references)


# ---------------------------------------------------------------------------
# Grounded evidence extraction
# ---------------------------------------------------------------------------


class AgentExtractionAdapter:
    name = "hermes-agent"

    def __init__(self, provider: Any, *, max_iterations: int = 24, on_event: Optional[Callable[[Dict], None]] = None):
        self.provider = provider
        self.max_iterations = max_iterations
        self.on_event = on_event
        self.runs: Dict[str, Dict[str, Any]] = {}

    async def extract(self, document: Dict[str, Any], seed: Optional[str] = None) -> Dict[str, Any]:
        pages: List[str] = list(document.get("_pages_text") or [])
        if not any(p.strip() for p in pages):
            return {}
        doc_type = document.get("type")
        specs = [s for s in EVIDENCE_SPEC if s.get("doc") == doc_type and not s.get("derived") and not s.get("declared")]
        by_path = {s["path"]: s for s in specs}
        recorded: Dict[str, Any] = {}
        issues: List[Dict[str, Any]] = []

        def read_document(args: Dict[str, Any]) -> Dict[str, Any]:
            page = int(args.get("page") or 0)
            if not 1 <= page <= len(pages):
                return {"error": f"Page {page} does not exist; the document has {len(pages)}."}
            return {"page": page, "text": pages[page - 1]}

        def record_evidence(args: Dict[str, Any]) -> Dict[str, Any]:
            path, value, confidence = args.get("path"), args.get("value"), args.get("confidence")
            page, snippet = int(args.get("page") or 0), str(args.get("snippet") or "")
            spec = by_path.get(path)
            if spec is None:
                return {"error": f'"{path}" is not a field a {doc_type} document provides. Allowed: {", ".join(by_path)}.'}
            if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
                return {"error": "confidence must be a number between 0 and 1."}
            if not 1 <= page <= len(pages):
                return {"error": f"Page {page} does not exist."}
            if not snippet.strip():
                return {"error": "A verbatim snippet from the page is required."}
            if squash(snippet) not in squash(pages[page - 1]):
                return {"error": "That snippet does not appear on the cited page. Quote the document exactly."}
            typed, err = _ground(spec, value, snippet)
            if err:
                return {"error": err}
            recorded[path] = field(
                path,
                typed,
                confidence=float(confidence),
                provenance=PROVENANCE.EXTRACTED,
                citation={
                    "document": document.get("filename"),
                    "document_id": document.get("id"),
                    "page": page,
                    "snippet": snippet.strip()[:160],
                    "method": "agent",
                },
                raw=snippet.strip(),
            )
            return {"ok": True, "path": path}

        def flag_issue(args: Dict[str, Any]) -> Dict[str, Any]:
            issues.append({"path": args.get("path"), "note": str(args.get("note") or "")})
            return {"ok": True}

        reg = ToolRegistry()
        reg.register(
            "read_document", read_document, toolset="evidence",
            description="Return the text of one page of the document (pages are 1-based).",
            parameters={"type": "object", "properties": {"page": {"type": "integer", "minimum": 1}}, "required": ["page"]},
        )
        reg.register(
            "record_evidence", record_evidence, toolset="evidence",
            description="Record one field read from the document, with a confidence (0-1) and a verbatim snippet from the cited page that contains the value.",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "enum": list(by_path)},
                    "value": {"description": "The value as printed. Lists are arrays of numbers."},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "page": {"type": "integer", "minimum": 1},
                    "snippet": {"type": "string"},
                },
                "required": ["path", "value", "confidence", "page", "snippet"],
            },
        )
        reg.register(
            "flag_issue", flag_issue, toolset="evidence",
            description="Note something an officer should see: an illegible region, an alteration, a missing summary.",
            parameters={"type": "object", "properties": {"note": {"type": "string"}, "path": {"type": "string"}}, "required": ["note"]},
        )

        system = "\n\n".join(
            [
                _underwriter_prompt(["evidence-rules"]),
                f"Document type: {doc_type}. Pages: {len(pages)}.",
                "Fields this document can provide:\n" + "\n".join(f"- {s['path']} ({s['type']}): {s['label']}" for s in specs),
                "Read pages with read_document. Record each field with record_evidence, quoting the snippet that "
                "contains it. If a field is absent or unreadable, do not record it; use flag_issue. Finish with one line.",
            ]
        )
        run = await run_agent(
            provider=self.provider,
            registry=reg,
            tool_names=resolve_toolset("evidence"),
            system=system,
            messages=[{"role": "user", "content": f"Read {document.get('filename')} ({doc_type}) and record every field you can ground."}],
            max_iterations=self.max_iterations,
            on_event=self.on_event,
        )
        self.runs[str(document.get("id"))] = {
            "exit_reason": run.exit_reason,
            "iterations": run.iterations,
            "recorded": sorted(recorded),
            "refused": sum(1 for c in run.tool_calls if c["is_error"]),
            "issues": issues,
            "usage": run.usage,
        }
        return recorded


def _ground(spec: Dict[str, Any], value: Any, snippet: str):
    """Typed value if ``value`` is really in ``snippet``; else (None, reason)."""
    kind = spec.get("type")
    if kind in ("money", "number"):
        n = parse_number(value)
        if n is None:
            return None, f"{spec['path']} must be a number."
        if not value_in_snippet(n, snippet):
            return None, f"The value {value} does not appear in the snippet. Numbers are read, never inferred."
        return n, None
    if kind == "list":
        if not isinstance(value, list):
            return None, f"{spec['path']} must be a list."
        missing = [n for n in number_list(json.dumps(value)) if not value_in_snippet(n, snippet)]
        if missing:
            return None, f"These numbers are not in the snippet: {missing}. Do not add up or derive values."
        return value, None
    if not isinstance(value, str) or not value.strip():
        return None, f"{spec['path']} must be a non-empty string."
    if kind == "date":
        iso = parse_date(value)
        if iso is None:
            return None, f"Could not read {value!r} as a date."
        return iso, None
    if squash(value) not in squash(snippet):
        return None, f'The value "{value}" does not appear in the snippet.'
    return value.strip(), None


# ---------------------------------------------------------------------------
# Numeric guard — the model may only say numbers the record already contains
# ---------------------------------------------------------------------------


def allowed_numbers(record: Dict[str, Any]) -> List[float]:
    parts = [
        (record.get("evidence") or {}).get("values"),
        record.get("credit"),
        record.get("policyEvaluation"),
        record.get("decision"),
        record.get("reconciliation"),
        record.get("application"),
        [s.get("body") for s in (record.get("memo") or {}).get("sections", [])],
    ]
    return numbers_in(json.dumps(parts, default=str, ensure_ascii=False))


def unsupported_numbers(text: str, allowed: List[float]) -> List[float]:
    bad = []
    for token in numbers_in(text):
        if token <= 12 or 1900 <= token <= 2100:  # counts, months, years
            continue
        decimals = len(str(token).split(".")[1]) if "." in str(token) and not token.is_integer() else 0
        ok = any(
            round(a, decimals) == round(token, decimals) or round(a * 100, decimals) == round(token, decimals)
            for a in allowed
        )
        if not ok:
            bad.append(token)
    return bad


# ---------------------------------------------------------------------------
# Multi-agent review
# ---------------------------------------------------------------------------

REVIEW_TASKS = [
    ("KYC", "Review the identity evidence: name, date of birth, ID, PAN and address, and their agreement across documents.", "applicant"),
    ("INCOME", "Review the income evidence: monthly credits, cash deposits, platform settlements, recurring obligations and the engine's income view.", "bank"),
    ("INVOICE", "Review the dealer invoice: price components, vehicle category against the applied segment, chassis number.", "invoice"),
    ("RECONCILIATION", "Review the reconciliation findings: which advisory or blocking items deserve the officer's attention, and why.", None),
]


async def review_file(provider: Any, record: Dict[str, Any]) -> Dict[str, Any]:
    if not record.get("decision"):
        raise ValueError("Review runs on a decided file; this one has no decision yet.")
    sink: List[Dict[str, Any]] = []
    registry = build_review_registry(record, sink)
    tasks = [
        {
            "goal": goal,
            "context": (
                f"Area: {area}. Decision already made by policy: {record['decision']['decision']}. "
                f"Start with read_evidence(group={group!r})." if group else f"Area: {area}. Start with get_reconciliation."
            )
            + " Use flag_issue for anything the officer must see, then return your structured summary.",
        }
        for area, goal, group in REVIEW_TASKS
    ]
    delegated = await delegate_task(
        tasks=tasks,
        provider=provider,
        registry=registry,
        parent={"depth": 0, "tool_names": resolve_toolset("review")},
        output_model=ChildReview,
        system_prefix=_underwriter_prompt(["reconciliation-rules", "reason-codes"]),
    )
    children = delegated.get("results", [])
    known_paths = set(((record.get("evidence") or {}).get("fields") or {}).keys())

    findings: List[Dict[str, Any]] = list(sink)
    for child in children:
        findings.extend((child.get("output") or {}).get("findings", []))
    seen, unique = set(), []
    for f in findings:
        key = (f.get("area"), f.get("title"))
        if key in seen:
            continue
        seen.add(key)
        f["grounded"] = all(p in known_paths for p in f.get("evidence_paths", []))
        unique.append(f)

    allowed = allowed_numbers(record)
    synthesis: Dict[str, Any]
    try:
        syn = await structured(
            provider,
            response_model=ReviewSynthesis,
            system=_underwriter_prompt(["reason-codes"]),
            prompt=(
                "Summarise these reviewer findings for the credit officer and list up to six priorities. "
                "The decision is final; do not recommend changing it.\n\n"
                + json.dumps({"decision": record["decision"], "findings": unique}, default=str)
            ),
        )
        bad = unsupported_numbers(syn.summary + " ".join(syn.priorities), allowed)
        synthesis = {**syn.model_dump(), "accepted": not bad, "unsupported_numbers": bad}
    except Exception as exc:
        synthesis = {"summary": "", "priorities": [], "accepted": False, "error": str(exc)}
    if not synthesis.get("accepted"):
        synthesis["summary"] = f"{len(unique)} reviewer finding(s) across {len(children)} area(s)."

    return {
        "findings": unique,
        "synthesis": synthesis,
        "children": [
            {k: c.get(k) for k in ("task_index", "goal", "status", "exit_reason", "tool_calls", "schema_valid", "schema_errors", "usage")}
            for c in children
        ],
    }


# ---------------------------------------------------------------------------
# Decision explanation
# ---------------------------------------------------------------------------


async def explain_decision(provider: Any, record: Dict[str, Any]) -> Dict[str, Any]:
    if not record.get("decision"):
        raise ValueError("There is no decision to explain yet.")
    decision = record["decision"]
    codes = {c.get("code") for c in decision.get("reason_codes", [])}
    context = {
        "decision": decision,
        "headline": record.get("headline"),
        "metrics": (record.get("credit") or {}).get("metrics"),
        "memo": [{"title": s.get("title"), "body": s.get("body")} for s in (record.get("memo") or {}).get("sections", []) if s.get("body")],
        "officer_changes": [f for f in evidence_slice(record) if f.get("provenance") == PROVENANCE.OFFICER],
    }
    fallback = {
        "headline": record.get("headline") or f"Decision: {decision.get('decision')}",
        "paragraphs": [s["body"] for s in context["memo"][:2]],
        "cited_reason_codes": sorted(codes),
    }
    try:
        exp = await structured(
            provider,
            response_model=DecisionExplanation,
            system=_underwriter_prompt(["reason-codes"]),
            prompt=(
                "Explain this credit decision to the loan officer in plain language: the verdict, the reason codes "
                "that drove it, and anything a human changed. Quote figures exactly as given; introduce none.\n\n"
                + json.dumps(context, default=str, ensure_ascii=False)
            ),
        )
    except Exception as exc:
        return {"explanation": fallback, "source": "deterministic", "rejected_reason": f"model unavailable: {exc}"}

    text = exp.headline + " " + " ".join(exp.paragraphs)
    bad_numbers = unsupported_numbers(text, allowed_numbers(record))
    bad_codes = sorted(set(exp.cited_reason_codes) - codes)
    if bad_numbers or bad_codes:
        return {
            "explanation": fallback,
            "source": "deterministic",
            "rejected_reason": f"model output cited figures or codes not in the record: {bad_numbers or ''} {bad_codes or ''}".strip(),
        }
    return {"explanation": exp.model_dump(), "source": "model"}


# ---------------------------------------------------------------------------
# Conversation — the officer asks, the model answers from the record
# ---------------------------------------------------------------------------

ASK_TOOLSETS = ["review", "narration"]
ASK_HISTORY_TURNS = 12  # earlier exchanges kept in context


async def ask_about_file(
    provider: Any, record: Dict[str, Any], question: str, history: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    question = str(question or "").strip()
    if not question:
        raise ValueError("Ask a question.")
    sink: List[Dict[str, Any]] = []
    registry = build_review_registry(record, sink)
    app = record.get("application") or {}
    decision = (record.get("decision") or {}).get("decision")
    system = "\n\n".join(
        [
            _underwriter_prompt(["evidence-rules", "reason-codes", "reconciliation-rules"]),
            "You are RECALLER's credit analyst, answering the loan officer's questions about one file. Read the "
            "evidence, reconciliation, credit engine output, policy result and memo with your tools before answering. "
            "Quote figures exactly as the tools return them; never compute, estimate or round a new figure. Say where "
            "each fact comes from (field path, document and page, rule code, or memo section). The verdict belongs to "
            "the policy engine" + (f" (here: {decision})" if decision else "; this file has none yet") + ". You explain "
            "it and may record concerns with flag_issue, but you cannot change it. If the record does not hold the "
            "answer, say so plainly.",
            f"File {app.get('id')} · {app.get('borrower_name')} · {app.get('segment')} · status {record.get('status')}.",
        ]
    )
    turns = [
        {"role": t["role"], "content": str(t.get("content") or "")}
        for t in (history or [])
        if t.get("role") in ("user", "assistant") and str(t.get("content") or "").strip()
    ][-2 * ASK_HISTORY_TURNS :]
    run = await run_agent(
        provider=provider,
        registry=registry,
        tool_names=resolve_toolsets(ASK_TOOLSETS),
        system=system,
        messages=[*turns, {"role": "user", "content": question}],
    )
    answer = run.content.strip()
    bad = unsupported_numbers(answer, allowed_numbers(record))
    return {
        "question": question,
        "answer": answer or "(the model returned no answer)",
        "reasoning": "\n\n".join(run.reasoning)[:20000],
        "grounded": not bad,
        "unsupported_numbers": bad,
        "findings": sink,
        "tool_calls": [{"name": c["name"], "arguments": c["arguments"], "is_error": c["is_error"]} for c in run.tool_calls],
        "iterations": run.iterations,
        "exit_reason": run.exit_reason,
        "usage": run.usage,
    }
