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


class ApplicationDraftExtraction(BaseModel):
    borrower_name: str = Field(default="", description="Full name of applicant/borrower/customer")
    segment: str = Field(default="EV_2W", description="EV asset category: EV_2W, EV_3W_PASSENGER, or EV_3W_CARGO")
    loan_amount: float = Field(default=0.0, description="Requested loan amount or on-road vehicle price in INR")
    tenure_months: int = Field(default=36, description="Requested tenure in months, default 36")
    declared_monthly_income: float = Field(default=0.0, description="Monthly income or monthly credit turnover in INR")
    branch: str = Field(default="", description="City or branch location if visible")
    dealer: str = Field(default="", description="Dealer or showroom name if invoice or quotation")
    occupation: str = Field(default="", description="Occupation, driver/gig/business if stated")
    detected_doc_type: str = Field(default="AADHAAR", description="Document type: AADHAAR, PAN, DEALER_INVOICE, BANK_STATEMENT, PLATFORM_EARNINGS, UTILITY_BILL")
    pan: Optional[str] = Field(default=None, description="10-character PAN number if found")
    aadhaar_last4: Optional[str] = Field(default=None, description="Aadhaar last 4 digits if found")
    confidence: float = Field(default=0.88, description="Extraction confidence score from 0.0 to 1.0")
    snippet: str = Field(default="", description="Verbatim text snippet from which the key applicant details were extracted")
