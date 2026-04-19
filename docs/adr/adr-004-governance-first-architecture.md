# ADR-004: Governance-First Architecture

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system is composed of multiple layers, including:

- Governance artifacts (Git-based) (ADR-001)
- Artifact-driven state (ADR-002)
- Deterministic execution systems (ADR-018)
- Observability and replayability (ADR-019)
- AI-assisted components (ADR-003)
- Orchestration systems (e.g., n8n)

Without a clearly defined source of system logic, the system risks:

- Duplication of logic across layers
- Drift between design and runtime behavior
- Inconsistent execution across environments
- Loss of traceability and control
- Increased debugging complexity

In particular, embedding logic in:
- Orchestration workflows (n8n)
- Application code
- Ad hoc scripts

leads to fragmentation and loss of governance.

To maintain consistency, traceability, and control, the system must define a **single authoritative origin for all system logic**.

---

## Decision

The system SHALL adopt a **Governance-First Architecture**, where all system logic originates from governance artifacts stored in Git.

All execution, orchestration, and runtime behavior MUST derive from these governance artifacts.

---

## Core Principle

> Governance defines intent.  
> Execution realizes intent.  
> Runtime reflects results.

---

## Definitions

### Governance System

The governance system consists of:

- Git repositories containing governance artifacts
- Structured documents defining system behavior
- Schemas, contracts, and specifications
- Planning artifacts (plans, tasks, workflows)

This system is:
- Authoritative
- Version-controlled
- Human- and agent-editable

---

### System Logic

System logic includes:

- Business rules
- Workflow definitions
- Execution contracts
- Transformation rules
- Planning logic
- Validation rules

---

## Architecture Model

The system SHALL follow:

```
Governance (Git) → Execution Layer → Artifacts → State → Observability
```

---

## Allowed Flow of Logic

All logic MUST flow in the following direction:

```
Governance Artifacts (Git)
        ↓
Execution Definitions (Scripts / Schemas)
        ↓
Execution Service (ADR-018)
        ↓
Artifacts (ADR-002)
        ↓
Derived State
```

---

## Prohibited Logic Placement

The system MUST NOT define or embed authoritative logic in:

### 1. Orchestration Layer (n8n)

n8n MUST NOT:
- Contain business logic
- Define transformation rules
- Override governance-defined behavior

n8n SHALL:
- Orchestrate execution only
- Pass inputs and receive outputs

---

### 2. Application Code

Application code MUST NOT:
- Hardcode business rules
- Define system behavior outside governance artifacts
- Diverge from Git-defined logic

Code SHALL:
- Execute logic defined in governance artifacts
- Act as an execution engine, not a decision source

---

### 3. Runtime Systems

Runtime systems MUST NOT:
- Mutate logic definitions
- Introduce new logic dynamically outside governance control

---

## Relationship to ADR-001 (Git as Source of Truth)

- ADR-001 defines WHERE governance artifacts reside (Git)
- ADR-004 defines HOW those artifacts control system behavior

Git is the source of truth; governance artifacts are the source of logic.

---

## Relationship to ADR-002 (Artifact-Driven State)

- Governance defines what should happen
- Artifacts represent what actually happened
- State is derived from artifacts

Governance does not directly define state; it defines how artifacts are produced.

---

## Relationship to ADR-003 (Deterministic Over LLM)

- Governance artifacts define constraints on LLM usage
- LLM behavior must conform to governance-defined contracts
- LLMs cannot introduce new logic outside governance

---

## Relationship to ADR-018 (Deterministic Execution)

- Execution Service implements governance-defined logic
- Scripts and schemas originate from governance artifacts
- Execution enforces contracts defined in governance

---

## Relationship to ADR-019 (Observability)

- Observability reflects execution outcomes
- Governance provides context for interpreting execution results
- ExecutionRecords link back to governance definitions

---

## Consistency Requirements

The system SHALL ensure:

- No divergence between governance artifacts and execution behavior
- All logic changes are versioned via Git
- Execution reflects the exact version of governance artifacts used

Given:
- A Git commit

The system SHALL be able to:
- Reconstruct the exact system logic at that point in time

---

## Change Management

All changes to system logic MUST:

- Originate as changes to governance artifacts in Git
- Be version-controlled
- Be reviewable (e.g., pull requests)
- Be traceable

Runtime systems MUST NOT:
- Modify logic outside of Git-based workflows

---

## Enforcement Mechanisms

The system SHOULD enforce this architecture via:

- Schema validation (ADR-018)
- Contract enforcement
- Static analysis of workflows (e.g., n8n validation)
- Runtime guards preventing unauthorized logic execution

---

## Consequences

### Positive

- Single authoritative source of system logic
- Eliminates duplication and drift
- Strong traceability and auditability
- Enables deterministic and reproducible behavior
- Supports agent-driven development safely
- Clear separation of concerns across system layers

---

### Negative

- Requires strict discipline in governance processes
- Increased upfront design effort
- Slower iteration without proper tooling
- Requires tooling to bridge governance → execution

---

## Alternatives Considered

### 1. Embed Logic in Orchestration (n8n) (Rejected)

Define logic directly in workflows.

**Rejected because:**
- Leads to duplication and drift
- Difficult to version and govern
- Breaks separation of concerns

---

### 2. Embed Logic in Application Code (Rejected)

Define logic directly in codebases.

**Rejected because:**
- Harder to audit and trace
- Requires deployments for logic changes
- Diverges from governance system

---

### 3. Hybrid Model Without Clear Authority (Rejected)

Allow multiple layers to define logic.

**Rejected because:**
- Leads to ambiguity and inconsistency
- Breaks determinism and reproducibility
- Increases debugging complexity

---

## Future Considerations

- GitOps-style deployment of governance artifacts
- UI tools for managing governance artifacts
- Automated validation of governance changes
- Integration with Canonical Knowledge System (CKS)
- Policy engines for enforcing governance rules
- Drift detection between governance and execution