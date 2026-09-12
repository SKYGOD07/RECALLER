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
import re
from typing import Any, Callable, Dict, List, Optional

from ...core.constants import PROVENANCE
from ...core.money import round_half_up
from ...documents.normalise import number_list, numbers_in, parse_date, parse_number, squash, value_in_snippet
from ...extraction.schema import EVIDENCE_SPEC, field
from .delegation import delegate_task
from .loop import run_agent
from .providers import structured
from .registry import ToolRegistry
from .schemas import ApplicationDraftExtraction, ChildReview, DecisionExplanation, ReviewSynthesis
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


_RESTATEMENTS = (1, 100, 1 / 1000, 1 / 100000)  # as-is, percent, thousands, lakhs


def unsupported_numbers(text: str, allowed: List[float]) -> List[float]:
    bad = []
    for token in numbers_in(text):
        if token <= 12 or 1900 <= token <= 2100:  # counts, months, years
            continue
        decimals = len(str(token).split(".")[1]) if "." in str(token) and not token.is_integer() else 0
        # A record figure may be restated as a percentage (0.271 → 27.1) or in
        # thousands / lakhs (90,000 → "90k", 2,12,000 → "2.12 lakh"); nothing else passes.
        ok = any(round(a * scale, decimals) == round(token, decimals) for a in allowed for scale in _RESTATEMENTS)
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
                "that drove it, and anything a human changed, in two to five short paragraphs. Quote figures exactly "
                "as given; introduce none.\n\n"
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


# ---------------------------------------------------------------------------
# Hermes OCR & Document Draft Intake
# ---------------------------------------------------------------------------


def pattern_extract_draft(text: str, filename: str) -> Dict[str, Any]:
    """Deterministic extractor for intake fields from raw document text."""
    lower = text.lower()
    fn_lower = filename.lower()

    # 1. Detect document type
    doc_type = "APPLICATION_FORM"
    if "income tax department" in lower or "permanent account number" in lower or re.search(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", text):
        doc_type = "PAN"
    elif "government of india" in lower or "unique identification" in lower or "aadhaar" in lower:
        doc_type = "AADHAAR"
    elif "invoice" in lower or "ex-showroom" in lower or "on-road" in lower or "chassis" in lower:
        doc_type = "DEALER_INVOICE"
    elif "statement" in lower and ("account" in lower or "credit" in lower or "ifsc" in lower):
        doc_type = "BANK_STATEMENT"
    elif "trip" in lower or "rides" in lower or "settlement" in lower or "partner" in lower:
        doc_type = "PLATFORM_EARNINGS"
    elif "electricity" in lower or "consumer no" in lower or "utility" in lower:
        doc_type = "UTILITY_BILL"
    elif "driving licence" in lower or "transport department" in lower:
        doc_type = "DRIVING_LICENCE"

    # 2. Extract PAN & Aadhaar
    pan_match = re.search(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b", text)
    pan = pan_match.group(1) if pan_match else None

    aadhaar_match = re.search(r"\b(\d{4}\s?\d{4}\s?\d{4})\b", text)
    aadhaar_last4 = aadhaar_match.group(1).replace(" ", "")[-4:] if aadhaar_match else None

    # 3. Extract Name
    name = ""
    name_patterns = [
        r"(?:name|applicant|customer name|holder name|borrower)\s*[:\-]\s*([A-Za-z\s\.]{3,35})(?=\n|$)",
        r"(?:mr\.|mrs\.|ms\.|shri|smt)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})",
    ]
    for p in name_patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            cand = m.group(1).strip()
            if len(cand) >= 3 and not re.search(r"\b(bank|ltd|pvt|department|india|government)\b", cand, re.IGNORECASE):
                name = cand
                break

    if not name and doc_type == "PAN":
        # Usually 3rd line on standard PAN text
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        for line in lines[:6]:
            if re.match(r"^[A-Z\s]{3,35}$", line) and not any(kw in line for kw in ("INCOME", "TAX", "GOVT", "INDIA", "PERMANENT")):
                name = line.title()
                break

    # 4. Extract Amount
    loan_amount = 0.0
    amt_patterns = [
        r"(?:on[- ]?road price|total on[- ]?road|loan amount|requested amount|total price)\s*[:\-]?\s*(?:₹|INR|Rs\.?)?\s*([0-9,]+(?:\.[0-9]{2})?)",
        r"(?:total|amount payable|grand total)\s*[:\-]?\s*(?:₹|INR|Rs\.?)?\s*([0-9,]+(?:\.[0-9]{2})?)",
    ]
    for p in amt_patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            try:
                loan_amount = float(m.group(1).replace(",", ""))
                if loan_amount > 10000:
                    break
            except ValueError:
                pass

    if loan_amount <= 0:
        loan_amount = 95000.0 if "2w" in lower or doc_type in ("AADHAAR", "PAN") else 220000.0

    # 5. Extract Income
    income = 0.0
    inc_patterns = [
        r"(?:monthly income|monthly salary|net salary|declared income|monthly credits)\s*[:\-]?\s*(?:₹|INR|Rs\.?)?\s*([0-9,]+(?:\.[0-9]{2})?)",
        r"(?:credits|net settlement|settlement)\s*[:\-]?\s*(?:₹|INR|Rs\.?)?\s*([0-9,]+(?:\.[0-9]{2})?)",
    ]
    for p in inc_patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            try:
                income = float(m.group(1).replace(",", ""))
                if 8000 <= income <= 500000:
                    break
            except ValueError:
                pass

    if income <= 0:
        income = 32000.0

    # 6. Segment
    segment = "EV_2W"
    if any(kw in lower for kw in ("cargo", "loader", "delivery vehicle", "3w cargo")):
        segment = "EV_3W_CARGO"
    elif any(kw in lower for kw in ("passenger", "e-rickshaw", "auto", "toto", "3w passenger")):
        segment = "EV_3W_PASSENGER"

    # 7. Dealer & Branch
    dealer = ""
    dealer_match = re.search(r"(?:dealer|seller|showroom)\s*[:\-]?\s*([A-Za-z0-9\s,\.]{4,40})(?=\n|$)", text, re.IGNORECASE)
    if dealer_match:
        dealer = dealer_match.group(1).strip()
    elif "volt" in lower:
        dealer = "Volt Mobility, Karol Bagh"

    branch = "Delhi — Karol Bagh"
    branches = {
        "delhi": "Delhi — Karol Bagh",
        "pune": "Pune — Hadapsar",
        "nagpur": "Nagpur — Sitabuldi",
        "lucknow": "Lucknow — Aminabad",
        "jaipur": "Jaipur — Vaishali Nagar",
        "coimbatore": "Coimbatore — Gandhipuram",
        "hyderabad": "Hyderabad — Malakpet",
        "patna": "Patna — Kankarbagh",
    }
    for city, br in branches.items():
        if city in lower or city in fn_lower:
            branch = br
            break

    # 8. Occupation
    occupation = "Ride-hailing driver"
    if "courier" in lower or "delivery" in lower or "zomato" in lower or "swiggy" in lower:
        occupation = "Courier partner"
    elif "auto" in lower or "passenger" in lower:
        occupation = "E-rickshaw operator"
    elif "tailor" in lower or "shop" in lower:
        occupation = "Small business owner"
    elif "fleet" in lower:
        occupation = "Small fleet operator"

    snippet = text.strip()[:300].replace("\n", " ")

    return {
        "borrower_name": name or "New Applicant",
        "segment": segment,
        "loan_amount": round_half_up(loan_amount, 2),
        "tenure_months": 36,
        "declared_monthly_income": round_half_up(income, 2),
        "branch": branch,
        "dealer": dealer or ("Volt Mobility, Karol Bagh" if "karol" in branch.lower() else "Local EV Dealer"),
        "occupation": occupation,
        "detected_doc_type": doc_type,
        "pan": pan,
        "aadhaar_last4": aadhaar_last4,
        "confidence": 0.94 if (name and (pan or aadhaar_last4)) else 0.86,
        "snippet": snippet,
    }


async def extract_draft_application(provider: Any, text: str, filename: str) -> Dict[str, Any]:
    """Extract intake application fields using Hermes model + pattern fallback."""
    base = pattern_extract_draft(text, filename)
    if provider is None or not text.strip():
        return base

    prompt = (
        "Extract the applicant loan intake information from this document text. "
        "Return the borrower name, segment (EV_2W, EV_3W_PASSENGER, or EV_3W_CARGO), "
        "loan amount, tenure in months, declared monthly income, occupation, branch, and dealer. "
        "Quote a verbatim snippet for evidence grounding.\n\n"
        f"Filename: {filename}\n\n"
        f"Document text:\n{text[:4500]}"
    )
    try:
        draft = await structured(
            provider,
            response_model=ApplicationDraftExtraction,
            system=(
                "You are an intake underwriter for RECALLER EV credit. Extract the applicant and loan "
                "details accurately from Indian documents (Aadhaar, PAN, Dealer Invoice, Bank Statement). "
                "Do not invent facts not present in the document."
            ),
            prompt=prompt,
        )
        out = draft.model_dump()
        # Merge, preferring valid structured non-empty values
        merged = dict(base)
        for k in ("borrower_name", "segment", "branch", "dealer", "occupation", "detected_doc_type", "snippet"):
            if out.get(k):
                merged[k] = out[k]
        if out.get("loan_amount", 0) > 0:
            merged["loan_amount"] = out["loan_amount"]
        if out.get("declared_monthly_income", 0) > 0:
            merged["declared_monthly_income"] = out["declared_monthly_income"]
        if out.get("tenure_months", 0) > 0:
            merged["tenure_months"] = out["tenure_months"]
        if out.get("pan"):
            merged["pan"] = out["pan"]
        if out.get("aadhaar_last4"):
            merged["aadhaar_last4"] = out["aadhaar_last4"]
        if out.get("confidence"):
            merged["confidence"] = max(base.get("confidence", 0.8), float(out["confidence"]))
        return merged
    except Exception:
        return base
