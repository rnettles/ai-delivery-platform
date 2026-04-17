# ADR-008: Structured LLM Outputs (JSON)

## Status
Accepted

## Context
Free-form text is difficult to validate.

## Decision
Require LLM to return structured JSON.

## Rationale
Enables deterministic rendering and validation.

## Alternatives Considered
- Markdown generation directly

## Consequences
### Positive
- Easier validation

### Negative
- Slightly more complex prompting
