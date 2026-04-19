# ADR-007: n8n as Orchestration Engine (Logic-Free Orchestration)

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system requires workflow orchestration to coordinate:

- Role execution (ADR-005)
- Script execution via the Execution Service (ADR-018)
- Artifact generation and approval flows (ADR-002, ADR-006)
- Multi-step processes across system boundaries

An orchestration engine is required to:
- Trigger and sequence execution
- Manage workflow progression
- Integrate with external systems

However, embedding logic within orchestration introduces risks:

- Duplication of business logic (violates ADR-004)
- Drift between governance and runtime behavior
- Loss of determinism and reproducibility (ADR-018)
- Increased debugging complexity
- Tight coupling between orchestration and execution

---

## Decision

The system SHALL use **n8n as the orchestration engine**, with strict enforcement that:

> n8n is a **logic-free orchestration layer**.

n8n SHALL coordinate execution but MUST NOT define system logic.

---

## Core Principle

> n8n orchestrates flow.  
> Execution Service enforces logic.  
> Governance defines behavior.

---

## Responsibilities of n8n

n8n SHALL be responsible for:

- Triggering workflows (e.g., API, Slack, scheduled events)
- Routing execution requests
- Sequencing steps in a workflow
- Passing inputs to the Execution Service
- Receiving execution responses
- Managing control flow (e.g., branching based on status)
- Integrating with external systems

---

## Prohibited Responsibilities

n8n MUST NOT:

### 1. Define Business Logic

- No transformation rules
- No domain logic
- No decision-making beyond simple routing

---

### 2. Modify Execution Contracts

- Must not alter input/output schemas
- Must not reshape payloads beyond minimal transport formatting

---

### 3. Perform Data Transformation

- No complex data manipulation
- No schema validation logic
- No computation that affects system behavior

All transformations MUST occur in:
- Scripts (ADR-018)
- Roles (ADR-005)

---

### 4. Store or Define State

- Must not act as a source of truth
- Must not persist authoritative system state
- Must not track state outside execution metadata

State is defined via artifacts (ADR-002) and ExecutionRecords (ADR-019)

---

### 5. Execute AI Logic

- Must not call LLMs directly
- Must not embed prompts or AI reasoning

All AI interactions MUST occur through roles (ADR-005)

---

## Allowed Control Logic

n8n MAY perform **minimal orchestration logic**, including:

- Conditional branching based on execution status
- Retry policies (bounded and controlled)
- Workflow sequencing
- Error routing

This logic MUST NOT:
- Replace business logic
- Introduce new system behavior

---

## Interaction Model

n8n SHALL interact with the Execution Service via:

```
ExecutionRequest → Execution Service → ExecutionResponse
```

n8n MUST:
- Send valid ExecutionRequests
- Receive and propagate ExecutionResponses
- Not interpret execution results beyond routing decisions

---

## Metadata and Traceability (ADR-019)

n8n MUST include metadata in all requests:

```json
{
  "metadata": {
    "source": "n8n",
    "correlation_id": "<workflow_run_id>"
  }
}
```

This enables:
- End-to-end tracing
- Execution correlation
- Workflow debugging

---

## Relationship to Governance (ADR-004)

- Workflow definitions MAY be stored in Git as governance artifacts
- n8n workflows SHOULD be generated or validated against governance definitions
- n8n MUST not introduce logic outside governance

---

## Relationship to Execution System (ADR-018)

- All logic execution MUST occur via the Execution Service
- n8n MUST not bypass execution contracts
- n8n MUST not execute scripts directly

---

## Relationship to Roles (ADR-005)

- n8n triggers role execution via the Execution Service
- n8n does not implement role behavior
- Role logic remains encapsulated and governed

---

## Relationship to Artifact-Driven State (ADR-002)

- n8n does not define or mutate state
- n8n triggers processes that produce artifacts
- State is derived from artifacts, not workflows

---

## Relationship to Human-in-the-Loop (ADR-006)

- n8n MAY pause workflows awaiting approval
- n8n MAY route approval requests
- n8n MUST respect approval gates

n8n MUST NOT:
- Bypass approval requirements
- Auto-approve artifacts

---

## Enforcement Mechanisms

The system SHOULD enforce this ADR via:

- Static validation of n8n workflows
- Restricted node usage (e.g., no direct LLM calls)
- Contract validation at Execution Service boundaries
- Monitoring for logic leakage

---

## Consequences

### Positive

- Clear separation of orchestration and execution
- Prevents logic duplication and drift
- Maintains determinism and reproducibility
- Simplifies debugging and observability
- Enables scalable workflow management

---

### Negative

- Requires discipline in workflow design
- Limits flexibility within n8n
- Requires additional execution layer implementation
- Potential learning curve for proper usage

---

## Alternatives Considered

### 1. Custom Orchestration Engine (Rejected)

Build a custom workflow engine.

**Rejected because:**
- Higher development and maintenance cost
- Reinvents existing capabilities
- Slower time to value

---

### 2. Logic-Heavy n8n Workflows (Rejected)

Allow logic to be embedded in workflows.

**Rejected because:**
- Violates governance-first architecture (ADR-004)
- Breaks determinism (ADR-018)
- Leads to drift and inconsistency

---

### 3. Direct Execution Without Orchestration (Rejected)

Eliminate orchestration layer.

**Rejected because:**
- Cannot manage multi-step workflows
- Limits integration capabilities
- Reduces flexibility

---

## Future Considerations

- Automated validation of n8n workflows against governance rules
- Generation of n8n workflows from governance artifacts
- Workflow versioning and deployment via Git
- Monitoring and alerting for orchestration issues
- Replacement or augmentation of n8n if scaling demands change