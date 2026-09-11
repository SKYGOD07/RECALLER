"""Pydantic contracts for everything an agent hands back to RECALLER.

Every model output crosses into the system through one of these, validated
(Instructor-style) before use. None of them carries a financial figure the
engine would consume.
"""

from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, Field, field_validator

ReviewArea = Literal["KYC", "INCOME", "INVOICE", "RECONCILIATION", "GENERAL"]
Severity = Literal["INFO", "ADVISORY", "CONCERN"]


class ReviewFinding(BaseModel):
    area: ReviewArea
    severity: Severity
    title: str = Field(min_length=3, max_length=120)
    detail: str = Field(min_length=3, max_length=1200)
    evidence_paths: List[str] = Field(default_factory=list, description="Evidence field paths this finding rests on.")


class ChildReview(BaseModel):
    """What one delegated reviewer returns."""

    findings: List[ReviewFinding] = Field(default_factory=list, max_length=12)
    summary: str = Field(max_length=800)


class ReviewSynthesis(BaseModel):
    """The supervisor's roll-up. It may prioritise; it may not change the decision."""

    summary: str = Field(max_length=1500)
    priorities: List[str] = Field(default_factory=list, max_length=6)


class DecisionExplanation(BaseModel):
    headline: str = Field(min_length=10, max_length=300)
    paragraphs: List[str] = Field(min_length=1, max_length=5)
    cited_reason_codes: List[str] = Field(default_factory=list)

    @field_validator("paragraphs", mode="before")
    @classmethod
    def _first_five(cls, v):
        # JSON-schema decoding (Ollama) does not enforce array length, and models
        # often split one idea over several paragraphs. Keep the first five rather
        # than discard a sound explanation over its layout; the numeric guard
        # still checks every paragraph kept.
        if isinstance(v, list):
            v = [p for p in v if str(p).strip()][:5]
        return v
