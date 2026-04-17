# ADR-002: Artifact-Driven State

## Status
Accepted

## Context
State tracking can drift from actual system outputs.

## Decision
System state is derived from artifacts, not actions.

## Rationale
Artifacts provide verifiable evidence of progress.

## Alternatives Considered
- Action-based state
- Event-based state

## Consequences
### Positive
- Reliable state
- Reproducibility

### Negative
- Requires validation layer
