"""RECALLER - Extraction Engine."""

from .schema import EVIDENCE_SPEC, SPEC_BY_PATH, field, get_path, set_path, to_values
from .adapters import (
    FixtureAdapter,
    age_from,
    apply_confidence_gate,
    apply_officer_resolutions,
    base_confidence,
    citation_snippet,
    extract_bundle,
    fixture_adapter,
    materialise,
)

__all__ = [
    "EVIDENCE_SPEC",
    "SPEC_BY_PATH",
    "field",
    "get_path",
    "set_path",
    "to_values",
    "FixtureAdapter",
    "fixture_adapter",
    "base_confidence",
    "citation_snippet",
    "extract_bundle",
    "age_from",
    "apply_confidence_gate",
    "apply_officer_resolutions",
    "materialise",
]
