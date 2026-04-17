# ADR-012: Project Workspace as File-Based State Source of Truth

## Status
Accepted

## Context

The system needs to track:

- Current execution state
- Phase and sprint progress
- Generated artifacts

Two options exist:

1. Database-first state
2. File-based artifact-driven state

The system design emphasizes:

- Transparency
- Traceability
- Git versioning

## Decision

Use **file-based state in project_workspace** as the **source of truth**.

State files:

```
project_workspace/state/
├── current_state.json
├── current_phase.json
└── current_sprint.json
```

PostgreSQL will be used as a **derived state layer**, not authoritative.

## Consequences

### Positive

- Full auditability via Git
- Easy debugging
- Aligns with artifact-driven architecture
- Human-readable state

### Negative

- Requires synchronization logic for Postgres
- Slightly more complex than DB-only systems

## Alternatives Considered

### 1. Postgres as source of truth
Rejected due to:
- Reduced transparency
- Harder debugging
- Loss of Git history

### 2. Hybrid without clear ownership
Rejected due to:
- Inconsistency
- Drift risk

## Notes

This reinforces:

> "Artifacts prove state; databases summarize state."
