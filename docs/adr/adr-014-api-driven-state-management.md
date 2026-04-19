# ADR-014: API-Driven Coordination and Execution Context Layer

## Status
Proposed

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system supports:

- Local human/AI-assisted development (VSCode, Copilot)
- n8n-based orchestration workflows (ADR-007)
- Deterministic execution via Execution Service (ADR-009)
- Artifact-driven state (ADR-002)
- Observability via ExecutionRecords (ADR-019)

A shared runtime layer is required to:

- Coordinate multi-step workflows
- Support agent collaboration and handoffs
- Track execution context across systems
- Enable debugging and replay

However:

The system MUST NOT introduce a mutable, authoritative state layer, as this would violate:

- Artifact-driven state (ADR-002)
- Deterministic execution (ADR-018)
- Governance-first architecture (ADR-004)

---

## Decision

Introduce an **API-driven Coordination and Execution Context Layer**, exposed via the Execution Service (or a closely related service).

This layer SHALL provide:

- Shared, transient coordination data
- Execution context tracking
- Agent interaction memory

This layer SHALL NOT be treated as the source of truth for system state.

---

## Core Principle

> Artifacts define truth.  
> Coordination state enables interaction.

---

## Coordination State Model

The system SHALL define three categories of runtime data:

---

### 1. Execution Context (Short-Lived)

- execution_id
- status
- timestamps
- logs
- correlation_id

Source of truth:
- ExecutionRecords (ADR-019)

---

### 2. Coordination State (Medium-Lived)

Used for:

- Workflow progression
- Agent coordination
- Intermediate results
- Temporary decision context

Examples:

- current step in workflow
- partial outputs
- agent-to-agent handoff data

---

### 3. Canonical Artifacts (Long-Lived)

Examples:

- plans
- schemas
- architecture documents

Source of truth:
- Git (ADR-001)

---

## Critical Constraint

> Coordination state MUST NOT be treated as authoritative system state.

---

## API Model

The system SHALL expose an API for managing coordination state.

### Capabilities

- Create coordination entries
- Retrieve coordination context
- Query coordination data
- Update coordination data
- Archive or expire entries

---

## API Contract Principles

The API MUST:

- Accept structured data (JSON)
- Be fully observable (ADR-019)
- Be deterministic in behavior
- Be accessible to all clients (n8n, local tools, agents)

The exact endpoint structure is defined in API specification, not this ADR.

---

## Backing Storage

Primary storage:

- PostgreSQL (JSONB-based storage)

Used for:

- Flexible coordination data
- Queryable execution context
- Agent interaction memory

This storage MUST:

- Be accessed only via API
- Not be directly accessed by n8n or clients

---

## Relationship to Artifact-Driven State (ADR-002)

- Coordination state is NOT authoritative
- Artifacts remain the source of truth
- State derivation MUST ignore coordination data

---

## Relationship to Execution Service (ADR-009)

- Execution Service MAY:
  - read coordination context
  - write intermediate results

- Execution Service MUST:
  - produce artifacts for authoritative outputs
  - not rely on coordination state for final truth

---

## Relationship to Observability (ADR-019)

- Coordination entries SHOULD be linked to:
  - execution_id
  - correlation_id

- Enables:
  - tracing workflows
  - debugging multi-step processes
  - replay analysis

---

## Relationship to n8n (ADR-007)

n8n SHALL:

- Use API for coordination state
- Store workflow context via API

n8n MUST NOT:

- Store authoritative state
- Access database directly

---

## Relationship to Git (ADR-001)

- Coordination state is transient
- Canonical artifacts are promoted to Git
- Git remains the authoritative source of long-term truth

---

## Data Lifecycle

Coordination state SHOULD:

- Be time-bound
- Support expiration or archival
- Be reconstructable or discardable

---

## Prohibited Behavior

The system MUST NOT:

- Treat coordination state as source of truth
- Use coordination data as input to final state derivation
- Allow direct database access from clients
- Allow coordination state to bypass validation or approval

---

## Consequences

### Positive

- Enables multi-agent coordination
- Supports complex workflow execution
- Improves debugging and traceability
- Decouples orchestration from persistence
- Enables flexible runtime interaction

---

### Negative

- Adds complexity to system architecture
- Requires discipline to prevent misuse
- Risk of “state creep” if boundaries are not enforced

---

## Alternatives Considered

### 1. Direct Postgres Access (Rejected)

**Rejected because:**
- Tight coupling
- Security risks
- Breaks abstraction

---

### 2. Git as Runtime State (Rejected)

**Rejected because:**
- Too slow
- Not suitable for transient data
- High friction

---

### 3. Tool-Local State (Rejected)

**Rejected because:**
- Fragmentation
- No shared coordination
- Breaks agent workflows

---

## Implementation Considerations

The system SHOULD:

- Enforce schema discipline for coordination data
- Provide indexing and query capabilities
- Link coordination entries to execution metadata

---

## Future Considerations

- State lineage tracking
- Coordination schema standardization
- TTL-based cleanup strategies
- Integration with Canonical Knowledge System (CKS)
- Advanced agent coordination patterns