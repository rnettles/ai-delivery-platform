# ADR-002: Artifact-Driven State

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system requires a reliable, reproducible, and verifiable representation of state across planning, execution, and system evolution.

Traditional state management approaches often rely on:
- Actions (e.g., "task completed")
- Events (e.g., "event occurred")

These approaches introduce risks:
- State drift from actual system outputs
- Inconsistency between recorded intent and actual results
- Difficulty verifying correctness
- Challenges in replaying or reconstructing system state

Given the system’s reliance on:
- AI-generated outputs
- Execution services (ADR-018)
- Observability and replayability (ADR-019)
- Git-based governance artifacts (ADR-001)

State must be grounded in **verifiable outputs**, not inferred from actions or events.

---

## Decision

System state SHALL be **derived exclusively from artifacts**, not from actions or events.

Artifacts SHALL be the **authoritative representation of system state**.

---

## Definitions

### Artifact

An artifact is any **persisted, verifiable output** produced by the system.

Artifacts include (but are not limited to):
- Generated plans (phase plans, sprint plans)
- Task definitions
- Execution outputs
- Structured data outputs from scripts
- Schema-derived outputs
- Extracted knowledge (CKS outputs)

Artifacts MUST:
- Be persisted
- Be versioned (directly or indirectly via Git or execution records)
- Be attributable to a source (script, process, or user)
- Be reproducible

---

### State

State is defined as:

> The current, computed representation of the system based on the latest valid artifacts.

State is NOT:
- A stored mutable object
- A direct result of actions
- A direct result of events

State is ALWAYS:
- Derived
- Computed
- Reconstructable

---

## Core Principle

> Artifacts are facts.  
> State is a function of facts.

---

## Artifact-Driven State Model

The system SHALL operate under the following model:

```
Artifacts → State Derivation → System State
```

Actions and events MAY exist, but:

```
Actions/Events → (Optional Logging) → NOT State
```

---

## Prohibited Models

The system MUST NOT:

- Treat actions as authoritative state
- Treat events as authoritative state
- Store mutable state that is not derivable from artifacts
- Allow state transitions without corresponding artifact creation

---

## Relationship to Execution System

### ADR-018 (Deterministic Execution)

- Script outputs are artifacts
- Output validity is enforced via schema validation
- Only valid outputs may contribute to state

---

### ADR-019 (Execution Observability)

- ExecutionRecords are artifacts or artifact containers
- State MAY be derived from execution outputs stored in ExecutionRecords
- Replayability ensures artifact reproducibility

---

## Relationship to Git (ADR-001)

- Governance artifacts originate in Git
- Derived artifacts may be:
  - Stored in runtime systems
  - Optionally committed back to Git

Git provides:
- Versioned definitions
- Input to artifact generation

Artifacts provide:
- Output-based truth

---

## State Derivation Requirements

State derivation logic MUST:

- Be deterministic
- Be reproducible
- Be based only on valid artifacts
- Be independent of execution order where possible

Given:
- A set of artifacts

The system SHALL be able to compute:
- The exact system state

---

## Validation Requirements

Artifacts MUST be validated before contributing to state.

Validation MAY include:
- Schema validation (ADR-018)
- Structural validation
- Domain-specific validation rules

Invalid artifacts MUST:
- Be rejected
OR
- Be excluded from state derivation

---

## Conflict Resolution

Conflicts between artifacts MAY occur (e.g., competing outputs).

The system MUST define resolution strategies, such as:
- Latest valid artifact wins
- Version precedence
- Authority weighting (future: CKS-based reasoning)

Conflict resolution MUST be:
- Deterministic
- Transparent
- Reproducible

---

## Observability and Debugging

Because state is derived from artifacts:

The system SHALL enable:
- Inspection of artifacts contributing to state
- Reconstruction of state at any point in time
- Traceability from state back to artifacts

---

## Consequences

### Positive

- Strong alignment between outputs and system state
- High reproducibility and determinism
- Easier debugging via artifact inspection
- Eliminates drift between intent and reality
- Enables auditability and traceability
- Supports AI-driven and automated systems safely

---

### Negative

- Requires robust artifact validation
- Increased storage requirements
- Additional complexity in state derivation logic
- Potential latency in computing derived state

---

## Alternatives Considered

### 1. Action-Based State (Rejected)

State derived from recorded actions (e.g., "task completed").

**Rejected because:**
- Actions may not reflect actual outcomes
- Leads to drift and inconsistency
- Difficult to verify correctness

---

### 2. Event-Sourced State (Rejected as Primary Model)

State derived from event streams.

**Rejected because:**
- Events represent intent, not guaranteed outcomes
- Requires complex reconciliation logic
- Still requires artifact validation layer

---

### 3. Hybrid Model Without Clear Authority (Rejected)

Combine artifacts, actions, and events as equal sources of truth.

**Rejected because:**
- Leads to ambiguity and conflict
- Breaks determinism
- Hard to debug and reason about

---

## Future Considerations

- Advanced conflict resolution via CKS reasoning
- Artifact lineage tracking
- Incremental state computation
- Performance optimization for large artifact sets
- Visualization of artifact → state relationships
- Integration with ontology-driven systems