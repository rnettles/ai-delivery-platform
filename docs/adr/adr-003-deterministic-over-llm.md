# ADR-003: Deterministic Over LLM

## Status
Accepted

## Context
LLMs introduce variability and unpredictability.

## Decision
Use deterministic scripts wherever possible; limit LLM usage.

## Rationale
Improves reliability and reduces drift.

## Alternatives Considered
- Fully LLM-driven workflows

## Consequences
### Positive
- Predictability
- Easier debugging

### Negative
- More upfront engineering effort
