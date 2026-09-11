# Evidence Extraction Rules

## Reference: evidence-rules

1. **Grounding**:
   Every piece of recorded evidence must include a verbatim `snippet` from the document and the corresponding `page` number.

2. **Confidence Thresholds**:
   Confidence scores must range between 0.0 and 1.0. Any score below the policy confidence floor (0.85) will cause the application to suspend for human officer review.

3. **Field Normalization**:
   - Currency amounts should be converted to numeric paise/rupees without formatting symbols.
   - Dates should follow ISO 8601 `YYYY-MM-DD`.
   - Names should be extracted in uppercase or canonical casing.
