# ADR-007: n8n as Orchestration Engine

## Status
Accepted

## Context
Need workflow orchestration without embedding logic.

## Decision
Use n8n strictly as orchestration layer.

## Rationale
Separates execution from governance.

## Alternatives Considered
- Custom orchestration engine

## Consequences
### Positive
- Faster implementation

### Negative
- Requires discipline to avoid logic leakage
