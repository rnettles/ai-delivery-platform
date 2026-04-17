# ADR-001: Git as Source of Truth

## Status
Accepted

## Context
System requires strong governance, traceability, and version control.

## Decision
All governance artifacts and outputs reside in Git.

## Rationale
Git provides versioning, auditability, and consistency.

## Alternatives Considered
- Store in database
- Store in filesystem only

## Consequences
### Positive
- Strong traceability
- Easy rollback

### Negative
- Requires Git integration in workflows
