# ADR-009: Introduce Execution Service for Deterministic Script Execution

## Status
Accepted

## Context

The system currently uses n8n as the orchestration layer, but n8n does not have:

- Direct access to the Git repository
- Capability to execute Python-based helper scripts
- A persistent filesystem for managing artifacts

Attempting to embed logic into n8n workflows or Code nodes would violate the architecture principles of:

- Separation of concerns
- Deterministic execution
- Governance-first design

## Decision

Introduce a dedicated **Execution Service** deployed as an Azure Container App.

This service will:

- Execute deterministic helper scripts
- Load governance from Git (ai_dev_stack)
- Read/write project state and artifacts
- Expose a controlled HTTP API to n8n

n8n will interact with the system exclusively through this service.

## Consequences

### Positive

- Maintains strict separation of orchestration and execution
- Enables reuse of existing Python scripts
- Keeps governance logic out of n8n
- Supports future scalability and multi-project orchestration

### Negative

- Adds an additional service to deploy and manage
- Requires API design and versioning discipline

## Alternatives Considered

### 1. Execute scripts directly in n8n
Rejected due to:
- Lack of Python runtime
- Poor maintainability
- Violation of architecture principles

### 2. Clone Git repo inside n8n per workflow
Rejected due to:
- Performance overhead
- Complexity
- Duplication of logic

### 3. Embed governance logic in n8n workflows
Rejected due to:
- Drift risk
- Loss of canonical source of truth

## Notes

This decision establishes the Execution Service as the **primary runtime engine** of the system.
