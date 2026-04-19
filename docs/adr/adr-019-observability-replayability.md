# ADR-019: Execution Observability and Replayability

## Status
Accepted

## Date
2026-04-18

---

## Context

ADR-018 established the Execution Service as a deterministic, contract-enforced execution layer.

However, correctness alone is insufficient without:

- Visibility into execution behavior
- Traceability across systems
- Ability to inspect and debug historical executions
- Replay capability for validation and recovery

Without observability:

- Failures cannot be investigated reliably
- Execution cannot be audited
- Determinism cannot be verified
- Orchestrated workflows cannot be traced end-to-end

---

## Decision

The system SHALL implement **Execution Observability and Replayability**, ensuring that all executions are:

- Persisted
- Queryable
- Replayable
- Traceable across systems

---

## Core Principle

> If an execution is not recorded, it did not happen.

---

## Execution Record Model (Conceptual)

Each execution MUST produce a persistent **ExecutionRecord** containing:

- execution identifier
- script identifier
- script version
- input (structured)
- output (if successful, structured and schema-valid)
- error (if failure, structured)
- execution status
- timing information (start, end, duration)
- metadata (e.g., correlation_id, source, user)

---

## Execution Record Requirements

ExecutionRecords MUST:

- Be immutable once written
- Represent the exact outcome of execution
- Be consistent with execution contract (ADR-018)
- Be reproducible

ExecutionRecords MUST NOT:

- Be modified after creation
- Contain partial or unvalidated data

---

## Persistence Requirements

ExecutionRecords MUST be persisted in a durable, queryable data store.

The system MUST:

- Ensure durability across restarts
- Support querying and filtering
- Maintain consistency with execution outcomes

Implementation choice of storage is not part of this ADR.

---

## Relationship to Artifact-Driven State (ADR-002)

ExecutionRecords are:

- authoritative records of execution behavior
- inputs to debugging and replay

ExecutionRecords are NOT:

- the source of system state
- a replacement for artifacts

Artifacts remain the source of truth.

---

## Execution Query Capability

The system SHALL expose query capabilities for execution history.

Clients MUST be able to:

- retrieve execution summaries
- retrieve full execution details by identifier

Returned data MUST include:

- input
- output or error
- metadata
- timing information

---

## Replay Capability

The system SHALL support deterministic replay of executions.

Replay MUST:

- use the same script identifier
- use the same script version
- use the same input
- use the same execution context definition

---

### Replay Guarantee

Replay MUST produce:

- the same output  
OR  
- the same structured error  

---

### Replay Constraints

Replay MUST:

- create a new ExecutionRecord
- reference the original execution
- not mutate historical records

---

## Execution Context Consideration

ExecutionRecords SHOULD capture sufficient context to ensure replay determinism.

This MAY include:

- environment identifiers
- dependency versions (future)
- configuration references

---

## Observability Requirements

Observability is a **core execution guarantee**.

Each execution MUST:

- generate structured logs
- include execution identifier in all logs
- include script and version
- include status and timing

---

## Lifecycle Events

The system SHALL emit structured lifecycle events:

- execution.started
- execution.completed
- execution.failed

These events MUST:

- include execution identifier
- be correlated with ExecutionRecords
- support tracing and monitoring

---

## Correlation and Traceability

The system SHALL support cross-system tracing via metadata.

ExecutionRequests MAY include:

- correlation_id
- source identifier

The Execution Service MUST:

- persist this metadata
- propagate it through logs and events

---

## Orchestration Integration (ADR-007)

Orchestration systems (e.g., n8n) SHALL:

- provide correlation metadata
- rely on Execution Service for observability

They MUST NOT:

- maintain separate execution truth
- replace ExecutionRecords

---

## Data Lifecycle

ExecutionRecords SHOULD support:

- retention policies
- archival strategies
- indexing and querying

---

## Prohibited Behavior

The system MUST NOT:

- execute without recording
- mutate ExecutionRecords
- allow replay without traceability
- treat logs as the primary source of execution truth

---

## Consequences

### Positive

- Complete execution visibility
- Deterministic debugging and validation
- Strong auditability
- Enables replay and recovery workflows
- Supports agent reasoning and automation

---

### Negative

- Increased storage requirements
- Additional system complexity
- Performance overhead for persistence

---

## Alternatives Considered

### Log-Only Observability (Rejected)
Logs are insufficient for structured analysis and replay

### Partial Recording (Rejected)
Breaks traceability and determinism validation

### External Observability Only (Rejected)
Execution Service must own its execution history

### Replay Without Persistence (Rejected)
Breaks reproducibility and auditability

---

## Relationship to ADR-018

ADR-018 ensures:
- execution correctness
- contract enforcement

ADR-019 ensures:
- execution visibility
- traceability
- replayability

Together, they define a **complete execution model**:

```
Deterministic Execution + Persistent Observability = Reproducible System
```

---

## Future Considerations

- distributed tracing integration
- execution visualization tooling
- metrics and alerting
- role-based access to execution data
- privacy and data redaction
- batch and workflow-level replay