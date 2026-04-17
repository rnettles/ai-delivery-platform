# ADR-011: Execution Service Owns Git Operations

## Status
Accepted

## Context

The system relies on Git as the source of truth for:

- Governance (ai_dev_stack)
- Project artifacts
- Documentation

There are multiple options for where Git operations should occur:

- n8n workflows
- Execution Service
- External CI/CD pipelines

## Decision

All Git operations (clone, pull, future push) are handled exclusively by the **Execution Service**.

n8n will not interact with Git directly.

Execution Service responsibilities:

- Clone repository on startup (if missing)
- Pull latest changes periodically or on request
- Provide access to current governance state

## Consequences

### Positive

- Centralized Git logic
- Cleaner n8n workflows
- Reduced duplication
- Easier debugging and observability

### Negative

- Execution service must manage Git credentials securely
- Slight complexity in service implementation

## Alternatives Considered

### 1. Git operations in n8n
Rejected due to:
- Complexity
- Security concerns
- Violation of separation of concerns

### 2. Manual repo sync
Rejected due to:
- Lack of automation
- Drift risk

## Notes

This decision enforces:

> "n8n consumes governance; it does not manage governance."
