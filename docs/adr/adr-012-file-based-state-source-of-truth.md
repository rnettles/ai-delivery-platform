# ADR-012: Artifact-Derived Snapshot Views in Workspace

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

Note: the filename is retained for historical link compatibility. The decision text in this ADR is authoritative.

The system must represent:

- Execution outputs
- Planning progress (phases, sprints)
- Project state over time

Two approaches were considered:

1. Storing mutable state directly (e.g., current_state.json)
2. Deriving state from artifacts (ADR-002)

The system architecture already establishes:

- Artifact-driven state (ADR-002)
- Deterministic execution (ADR-018)
- Observability via ExecutionRecords (ADR-019)
- Governance-first logic (ADR-004)

Therefore, state must remain **derived and reproducible**, not stored as mutable truth.

---

## Decision

The system SHALL use **file-based artifacts as the source of truth**, and MAY use **file-based state snapshots as derived, non-authoritative views**.

The project workspace SHALL store:

- Artifacts (authoritative)
- Derived state snapshots (non-authoritative)

---

## Core Principle

> Artifacts are truth.  
> State is a view of truth.

---

## Artifact Model (Authoritative)

Artifacts SHALL:

- Be produced by execution (ADR-009)
- Be validated (ADR-018)
- Be stored in the workspace (ADR-010)
- Be immutable once created (preferred)

Examples:

- Plans (phase_plan.json)
- Sprint definitions
- Task outputs
- Execution results

Artifacts are the **only source of truth for state derivation**.

---

## Derived State Snapshots (Non-Authoritative)

The system MAY maintain files such as:

```
project_workspace/state/
├── current_state.json
├── current_phase.json
├── current_sprint.json
```

These files:

- Are derived from artifacts
- Represent a convenience view
- MAY be overwritten at any time
- MUST NOT be treated as authoritative

---

## Critical Constraint

> State snapshot files MUST be fully reconstructable from artifacts.

If reconstruction is not possible, the system is invalid.

---

## Prohibited Behavior

The system MUST NOT:

- Treat state snapshot files as the source of truth
- Allow manual edits to state files to affect system behavior
- Allow state transitions without corresponding artifacts
- Use state files as input to execution logic

---

## Relationship to Artifact-Driven State (ADR-002)

- Artifacts define truth
- State is computed from artifacts
- State files are optional projections, not authoritative

---

## Relationship to Execution Service (ADR-009)

- Execution produces artifacts
- Execution MUST NOT directly modify state snapshots
- State snapshots MAY be regenerated after execution

---

## Relationship to Observability (ADR-019)

- ExecutionRecords are the authoritative execution history
- Artifacts are traceable to execution_id
- State snapshots MUST be explainable via execution + artifacts

---

## Relationship to Git (ADR-001)

- Governance artifacts originate in Git
- Generated artifacts MAY optionally be committed to Git
- State snapshots MAY be committed for visibility, but are not authoritative

---

## Relationship to Workspace (ADR-010)

- Artifacts are stored in the workspace
- State snapshots are stored in the workspace
- Artifact files are authoritative for derivation
- Snapshot files are convenience projections only

---

## Relationship to Database (Derived Layer)

Databases (e.g., PostgreSQL) SHALL:

- Store derived state for querying and performance
- Be considered non-authoritative
- Be reconstructable from artifacts

---

## State Derivation Model

The system SHALL support:

```
Artifacts → State Derivation → State Snapshot
```

State derivation MUST be:

- Deterministic
- Reproducible
- Independent of manual mutation

---

## Synchronization Requirements

If state snapshots or databases are used:

- They MUST be synchronized from artifacts
- They MUST NOT introduce new state independently

---

## Consequences

### Positive

- Maintains strict alignment with artifact-driven architecture
- Eliminates state drift
- Enables full reproducibility
- Supports debugging via artifact inspection
- Allows convenient state views without compromising integrity

---

### Negative

- Requires state derivation logic
- Introduces additional computation for state reconstruction
- State snapshots must be carefully managed to avoid misuse

---

## Alternatives Considered

### 1. File-Based State as Source of Truth (Rejected)

**Rejected because:**
- Introduces mutable state
- Breaks artifact-driven model (ADR-002)
- Leads to drift and inconsistency

---

### 2. Database as Source of Truth (Rejected)

**Rejected because:**
- Reduces transparency
- Breaks reproducibility
- Conflicts with artifact-first design

---

### 3. Hybrid Without Clear Ownership (Rejected)

**Rejected because:**
- Creates ambiguity
- Leads to inconsistency and drift

---

## Future Considerations

- Incremental state computation
- State caching strategies
- Visualization of artifact → state relationships
- Event-based optimization (without becoming event-sourced)
- Integration with Canonical Knowledge System (CKS)