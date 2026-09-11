"""Extraction routing — which reader handles which document.

  synthetic document (has a payload)   → fixture adapter (deterministic demo data)
  uploaded, text layer, model enabled  → Hermes evidence agent, gaps filled by patterns
  uploaded, text layer, no model       → pattern extractor
  uploaded, no text (scanned, no OCR)  → nothing read

In every case, required fields that were not read become zero-confidence
placeholders, so the confidence gate stops the run and asks the officer instead
of letting the engine run on absent evidence. ``routes`` records what happened
per document; the service stores it on the record for the console and audit.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ..extraction.adapters import fixture_adapter
from .patterns import extract_patterns, placeholders


class RoutedExtractionAdapter:
    def __init__(self, agent: Optional[Any] = None, segments: Optional[Dict[str, Any]] = None) -> None:
        self.agent = agent
        self.segments = segments or {}
        self.routes: Dict[str, Dict[str, Any]] = {}
        self.name = "routed"

    async def extract(self, document: Dict[str, Any], seed: Optional[str] = None) -> Dict[str, Any]:
        doc_id = str(document.get("id"))
        info: Dict[str, Any] = {"document": document.get("filename"), "type": document.get("type")}

        if document.get("payload") is not None:
            out = fixture_adapter.extract(document, seed or "")
            info["route"] = "fixture"
        else:
            pages = document.get("_pages_text") or []
            has_text = any(str(p).strip() for p in pages)
            out: Dict[str, Any] = {}
            if has_text and self.agent is not None:
                try:
                    out = await self.agent.extract(document, seed)
                    info["route"] = "agent"
                    info["agent"] = getattr(self.agent, "runs", {}).get(doc_id)
                except Exception as exc:  # a model outage degrades to deterministic reading, loudly
                    info["route"] = "pattern"
                    info["agent_error"] = f"{type(exc).__name__}: {exc}"
                filled = {k: v for k, v in extract_patterns(document, self.segments).items() if k not in out}
                if filled and info["route"] == "agent":
                    info["route"] = "agent+pattern"
                out = {**filled, **out}
            elif has_text:
                out = extract_patterns(document, self.segments)
                info["route"] = "pattern"
            else:
                info["route"] = "none"
                info["reason"] = "no text layer (scanned document and OCR unavailable)"
            gaps = placeholders(document, out)
            info["held_missing"] = sorted(gaps)
            out = {**gaps, **out}

        info["fields"] = sorted(out)
        self.routes[doc_id] = info
        self.name = "+".join(sorted({r["route"] for r in self.routes.values()}))
        return out
