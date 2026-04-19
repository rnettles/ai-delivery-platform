# ADR-011: Execution Service Owns Git Operations and Governance Synchronization

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system relies on Git as the authoritative source of truth for:

- Governance artifacts (ADR-001, ADR-004)
- Schemas and contracts (ADR-008)
- Role definitions (ADR-005)
- Documentation and planning artifacts

Runtime components (Execution Service, n8n) require access to these artifacts in order to:

- Execute governed logic
- Validate contracts
- Produce artifacts
- Maintain deterministic behavior

Git operations may be performed in multiple locations:

- n8n workflows
- Execution Service
- External CI/CD pipelines

Without a clear ownership model, risks include:

- Inconsistent repository state across components
- Drift between execution and governance
- Security exposure (credentials spread across systems)
- Non-deterministic execution due to uncontrolled updates

---

## Decision

All Git operations SHALL be handled exclusively by the **Execution Service**.

The Execution Service SHALL act as the **single authority for accessing and synchronizing governance artifacts from Git**.

All other components (including n8n) MUST NOT interact with Git directly.

---

## Core Principle

> Git is the source of truth.  
> Execution Service is the gateway to truth.

---

## Responsibilities of the Execution Service

The Execution Service SHALL:

### 1. Clone Governance Repositories

- Clone required repositories into the workspace (ADR-010)
- Ensure repositories are available for execution

---

### 2. Synchronize Repository State

- Pull updates from remote repositories
- Support:
  - On-demand synchronization
  - Controlled periodic updates

---

### 3. Provide Consistent Access

- Expose the current governance state to execution logic
- Ensure all execution uses a consistent repository snapshot

---

### 4. Manage Repository State Deterministically

The Execution Service MUST:

- Track repository version (e.g., commit hash)
- Associate executions with specific Git versions
- Ensure reproducibility of execution based on Git state

---

## Deterministic Git Usage

The system SHALL distinguish between:

### 1. Pinned Execution (Preferred)

Execution uses a specific commit hash:

```
Execution → Git Commit (immutable)
```

This guarantees:
- Reproducibility
- Determinism
- Auditability

---

### 2. Latest Execution (Controlled)

Execution uses the latest repository state:

```
Execution → Latest (mutable)
```

This MUST be:
- Explicitly requested
- Logged and traceable
- Used only where appropriate

---

## Relationship to Execution Service (ADR-009)

- Git access is part of the Execution Service responsibility
- Execution logic depends on governance artifacts loaded from Git
- Execution Service ensures alignment between:
  - governance
  - execution
  - artifacts

---

## Relationship to Workspace (ADR-010)

- Git repositories are cloned into the workspace
- Workspace provides local access to repository contents
- Execution Service manages synchronization between:
  - Git (remote)
  - Workspace (local)

Workspace MUST NOT:
- Independently modify governance artifacts
- Become a divergent source of truth

---

## Relationship to n8n (ADR-007)

n8n MUST NOT:

- Clone repositories
- Pull or push changes
- Access Git credentials
- Manage repository state

n8n SHALL:
- Consume execution results only
- Rely on Execution Service for governance access

---

## Relationship to Governance (ADR-004)

- Governance artifacts originate in Git
- Execution Service retrieves and applies governance
- Governance changes MUST flow through Git, not runtime systems

---

## Relationship to Observability (ADR-019)

ExecutionRecords SHOULD include:

- Git repository reference
- Commit hash used
- Timestamp of synchronization

This enables:
- Full reproducibility
- Debugging based on governance version
- Traceability of system behavior

---

## Security Requirements

The Execution Service MUST:

- Securely manage Git credentials
- Restrict access to authorized repositories
- Prevent credential exposure to other components

Other systems MUST NOT:
- Store or access Git credentials

---

## Write Operations (Future Consideration)

If Git write operations are introduced (e.g., commit, push):

They MUST:

- Be controlled and authenticated
- Be traceable to user or system action
- Be subject to governance and approval policies (ADR-006)

The system MUST NOT:
- Allow uncontrolled mutation of governance artifacts

---

## Prohibited Behavior

The system MUST NOT:

- Allow n8n to perform Git operations
- Allow roles to access Git directly
- Execute logic against unknown or inconsistent repository state
- Allow execution without associating a Git version
- Allow runtime systems to override Git as source of truth

---

## Consequences

### Positive

- Centralized Git access and control
- Consistent and deterministic execution environment
- Improved security and credential management
- Strong traceability and reproducibility
- Reduced duplication of Git logic

---

### Negative

- Additional responsibility within Execution Service
- Requires secure credential management
- Introduces dependency on Git availability
- Requires synchronization strategy

---

## Alternatives Considered

### 1. Git Operations in n8n (Rejected)

**Rejected because:**
- Violates separation of concerns (ADR-007)
- Introduces security risks
- Leads to duplication and inconsistency

---

### 2. External CI/CD-Only Synchronization (Rejected)

**Rejected because:**
- Limits runtime flexibility
- Cannot support dynamic execution needs
- Introduces lag between governance and execution

---

### 3. Manual Repository Management (Rejected)

**Rejected because:**
- Not scalable
- High risk of drift
- No automation or traceability

---

## Future Considerations

- Git version pinning strategies per execution
- Multi-repository support
- Caching and performance optimization
- GitOps integration for automated deployment
- Audit logging for all Git operations
- Integration with approval workflows for write operations