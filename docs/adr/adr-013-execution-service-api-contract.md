# ADR-013: Introduce Execution Service API Contract

## Status
Accepted

## Context

n8n requires a consistent way to invoke:

- Script execution
- Governance loading
- Path resolution
- Artifact rendering

Without a defined contract, API drift and inconsistencies would occur.

## Decision

Define a standard HTTP API contract for the Execution Service.

Initial endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/load-project-config` | POST | Load and return project configuration |
| `/resolve-paths` | POST | Resolve canonical paths for artifacts and state |
| `/build-execution-contract` | POST | Construct the execution contract for a task |
| `/render-template` | POST | Render a governance or artifact template |
| `/validate-artifacts` | POST | Validate generated artifacts against governance rules |

All endpoints:

- Accept structured JSON
- Return standardized response envelopes

## Consequences

### Positive

- Predictable integration with n8n
- Easier testing and debugging
- Enables future service evolution

### Negative

- Requires API versioning discipline
- Additional documentation overhead

## Alternatives Considered

### 1. Ad-hoc endpoints
Rejected due to:
- Inconsistency
- Hard to maintain

### 2. Direct script invocation via SSH/exec
Rejected due to:
- Security concerns
- Lack of structure

## Notes

This decision formalizes the **contract boundary between orchestration and execution**.
