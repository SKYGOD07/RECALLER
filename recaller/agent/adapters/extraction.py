"""RECALLER agent extraction adapter."""

import re
from typing import Any, Callable, Dict, List, Optional
from ...core.constants import PROVENANCE
from ...extraction.schema import EVIDENCE_SPEC, field
from ..loop import run_agent
from ..registry import create_registry
from ..toolsets import resolve_toolset


def squash(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "").lower()).strip()


def numbers_in(text: str) -> List[float]:
    matches = re.findall(r"\d[\d,]*(?:\.\d+)?", str(text))
    return [float(n.replace(",", "")) for n in matches]


def coerce_val(spec: Dict[str, Any], value: Any, snippet: str) -> Dict[str, Any]:
    printed = numbers_in(snippet)
    grounded = lambda n: any(abs(p - n) < 1e-9 for p in printed)

    val_type = spec.get("type")
    if val_type in ("money", "number"):
        try:
            n = float(value) if isinstance(value, (int, float)) else float(re.sub(r"[,\s₹]", "", str(value)))
        except Exception:
            return {"error": f"{spec['path']} must be a number."}
        if not grounded(n):
            return {"error": f"The value {value} does not appear in the snippet. Numbers are read, never inferred."}
        return {"value": n}

    if val_type == "list":
        if not isinstance(value, list):
            return {"error": f"{spec['path']} must be a list."}
        missing = [n for n in numbers_in(str(value)) if not grounded(n)]
        if missing:
            return {
                "error": f"These numbers do not appear in the snippet: {', '.join(str(m) for m in missing)}. Do not add up or derive values."
            }
        return {"value": value}

    val_str = str(value or "").strip()
    if not val_str:
        return {"error": f"{spec['path']} must be a non-empty string."}
    if val_type != "date" and squash(val_str) not in squash(snippet):
        return {"error": f'The value "{val_str}" does not appear in the snippet.'}
    return {"value": val_str}


def create_agent_extraction_adapter(
    model: Callable[..., Any],
    skill_prompt: str = "",
    max_iterations: int = 24,
    on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
):
    """Factory creating an LLM/agent-backed extraction adapter."""
    if not callable(model):
        raise TypeError("create_agent_extraction_adapter needs a model function.")

    class AgentExtractionAdapter:
        name = "agent"

        async def extract(self, document: Dict[str, Any], seed: Optional[str] = None) -> Dict[str, Any]:
            pages = document.get("pages")
            if not pages and isinstance(document.get("text"), str) and document["text"].strip():
                pages = document["text"].split("\f")
            if not pages or not isinstance(pages, list):
                raise ValueError(
                    f"Document {document.get('id', '(unnamed)')} has no text. The agent adapter reads text pages; run OCR before extraction."
                )

            pages_str = [str(p) for p in pages]
            doc_type = document.get("type")
            specs = [
                s
                for s in EVIDENCE_SPEC
                if s.get("doc") == doc_type and not s.get("derived") and not s.get("declared")
            ]
            recorded = {}
            issues = []

            reg = create_registry()

            reg.register(
                name="read_document",
                toolset="evidence",
                description="Return the text of one page of the document (pages are 1-based).",
                parameters={"type": "object", "properties": {"page": {"type": "integer", "minimum": 1}}, "required": ["page"]},
                handler=lambda args: (
                    {"error": f"Page {args.get('page')} does not exist; the document has {len(pages_str)}."}
                    if int(args.get("page", 1)) - 1 < 0 or int(args.get("page", 1)) - 1 >= len(pages_str)
                    else {"page": int(args.get("page", 1)), "text": pages_str[int(args.get("page", 1)) - 1]}
                ),
            )

            def handle_record(args: Dict[str, Any]) -> Dict[str, Any]:
                p = args.get("path")
                val = args.get("value")
                conf = args.get("confidence")
                pg = args.get("page", 1)
                snippet = args.get("snippet", "")

                spec = next((s for s in specs if s["path"] == p), None)
                if not spec:
                    allowed_str = ", ".join(s["path"] for s in specs)
                    return {"error": f'"{p}" is not a field a {doc_type} document provides. Allowed: {allowed_str}.'}

                try:
                    conf_float = float(conf)
                    if not (0.0 <= conf_float <= 1.0):
                        return {"error": "confidence must be a number between 0 and 1."}
                except Exception:
                    return {"error": "confidence must be a number between 0 and 1."}

                if pg - 1 < 0 or pg - 1 >= len(pages_str):
                    return {"error": f"Page {pg} does not exist."}

                page_text = pages_str[pg - 1]
                if not isinstance(snippet, str) or not snippet.strip():
                    return {"error": "A verbatim snippet from the page is required."}

                if squash(snippet) not in squash(page_text):
                    return {"error": "That snippet does not appear on the cited page. Quote the document exactly."}

                coerced = coerce_val(spec, val, snippet)
                if "error" in coerced:
                    return {"error": coerced["error"]}

                recorded[p] = field(
                    path=p,
                    value=coerced["value"],
                    confidence=conf_float,
                    provenance=PROVENANCE.EXTRACTED,
                    citation={
                        "document": document.get("filename", ""),
                        "document_id": document.get("id"),
                        "page": pg,
                        "snippet": snippet.strip()[:160],
                    },
                    raw=snippet.strip(),
                )
                return {"ok": True, "path": p}

            reg.register(
                name="record_evidence",
                toolset="evidence",
                description="Record one field read from the document, with confidence and verbatim snippet.",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "enum": [s["path"] for s in specs]},
                        "value": {"description": "The value exactly as printed."},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "page": {"type": "integer", "minimum": 1},
                        "snippet": {"type": "string"},
                    },
                    "required": ["path", "value", "confidence", "page", "snippet"],
                },
                handler=handle_record,
            )

            reg.register(
                name="flag_issue",
                toolset="evidence",
                description="Note an issue an officer should see.",
                parameters={
                    "type": "object",
                    "properties": {"note": {"type": "string"}, "path": {"type": "string"}},
                    "required": ["note"],
                },
                handler=lambda args: issues.append({"document_id": document.get("id"), "path": args.get("path"), "note": str(args.get("note", ""))}) or {"ok": True},
            )

            prompt_lines = [
                skill_prompt.strip(),
                f"Document type: {doc_type}. Pages: {len(pages_str)}.",
                f"Fields this document can provide:\n" + "\n".join(f"- {s['path']} ({s['type']}): {s['label']}" for s in specs),
                "Read pages with read_document. Record each field with record_evidence, quoting the snippet that contains it. "
                "If a field is absent or you cannot read it, do not record it; use flag_issue instead. Finish with a one-line summary.",
            ]
            system_prompt = "\n\n".join(p for p in prompt_lines if p)

            run = await run_agent(
                model=model,
                registry=reg,
                tool_names=resolve_toolset("evidence"),
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": f"Read {document.get('filename') or document.get('id')} ({doc_type}, {len(pages_str)} page{'s' if len(pages_str) != 1 else ''}) and record every field you can ground in it.",
                    }
                ],
                max_iterations=max_iterations,
                on_event=on_event,
            )

            if callable(on_event):
                on_event(
                    {
                        "type": "extraction_done",
                        "document_id": document.get("id"),
                        "exit_reason": run["exitReason"],
                        "recorded": list(recorded.keys()),
                        "issues": issues,
                    }
                )

            return recorded

    return AgentExtractionAdapter()
