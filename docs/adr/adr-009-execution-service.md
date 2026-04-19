# ADR-009: Execution Service as Deterministic Runtime Engine

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system architecture consists of:

- Governance artifacts stored in Git (ADR-001, ADR-004)
- Role-based AI execution (ADR-005)
- Structured LLM outputs (ADR-008)
- Artifact-driven state (ADR-002)
- Human-in-the-loop approval (ADR-006)
- n8n as orchestration layer (ADR-007)

An execution mechanism is required to:

- Execute deterministic logic
- Enforce contracts and validation (ADR-018)
- Produce artifacts
- Maintain observability and replayability (ADR-019)

The orchestration layer (n8n) is intentionally constrained:

- It must not contain business logic
- It cannot reliably execute complex scripts
- It lacks deterministic execution guarantees
- It does not provide persistent execution state

Embedding execution logic in:
- n8n workflows
- Code nodes
- Ad hoc runtime scripts

would violate:

- Governance-first architecture (ADR-004)
- Deterministic execution requirements (ADR-018)
- Separation of concerns

---

## Decision

The system SHALL introduce a dedicated **Execution Service** that acts as the **deterministic runtime engine** for all system logic.

All logic execution MUST occur through this service.

---

## Core Principle

> Execution Service is the only place where logic runs.  
> Everything else coordinates, defines, or observes.

---

## Responsibilities of the Execution Service

The Execution Service SHALL:

### 1. Execute Deterministic Logic

- Execute scripts and roles
- Enforce deterministic execution (ADR-018)
- Ensure reproducible behavior

---

### 2. Enforce Contracts

- Validate all inputs against schemas
- Validate all outputs against schemas
- Return:
  - Valid output
  OR
  - Structured error

---

### 3. Integrate with Governance

- Load governance artifacts from Git
- Use schemas, role definitions, and contracts defined in governance
- Execute logic derived from governance artifacts

---

### 4. Produce Artifacts

- Generate validated outputs
- Persist artifacts (directly or via integration)
- Ensure artifacts are attributable and reproducible

---

### 5. Provide Observability

- Record ExecutionRecords (ADR-019)
- Support:
  - Querying execution history
  - Replay of executions
  - Correlation across workflows

---

### 6. Expose Controlled API

The Execution Service SHALL expose a controlled HTTP API:

```
ExecutionRequest → Execution Service → ExecutionResponse
```

All external systems (e.g., n8n) MUST interact via this API.

---

## Execution Model

The Execution Service SHALL implement:

```
Request → Validation → Execution → Output Validation → Artifact → Response
```

---

## Relationship to n8n (ADR-007)

- n8n SHALL act as an orchestration layer only
- n8n MUST NOT execute logic directly
- n8n MUST interact exclusively via the Execution Service API

---

## Relationship to Roles (ADR-005)

- Roles are executed within the Execution Service
- Role definitions are loaded from governance artifacts
- LLM interactions are contained within role execution

---

## Relationship to LLM Outputs (ADR-008)

- LLM outputs are treated as untrusted input
- Must conform to structured JSON schemas
- Must pass validation before becoming artifacts

---

## Relationship to Artifact-Driven State (ADR-002)

- Execution outputs become artifacts
- Only validated artifacts contribute to state
- Execution Service does not directly define state

---

## Relationship to Human-in-the-Loop (ADR-006)

- Execution Service MAY:
  - Produce artifacts requiring approval
  - Respect approval gates before proceeding

- Execution Service MUST NOT:
  - Bypass approval requirements

---

## Relationship to Observability (ADR-019)

The Execution Service SHALL:

- Persist ExecutionRecords
- Support replay capability
- Maintain traceability via correlation_id

---

## Governance Integration

The Execution Service MUST:

- Load schemas and role definitions from Git
- Respect versioning of governance artifacts
- Execute logic based on specific versions of governance

Given:
- A Git commit

The Execution Service SHALL be able to:
- Execute using the exact logic defined at that point in time

---

## Implementation Considerations

The Execution Service MAY be implemented as:

- A containerized service (e.g., Azure Container Apps)
- Supporting multiple languages (e.g., Python, Node.js)
- Scalable across environments

Implementation details MUST NOT affect architectural guarantees.

---

## Prohibited Behavior

The Execution Service MUST NOT:

- Execute logic outside defined schemas and contracts
- Accept or produce unvalidated data
- Allow dynamic logic definition outside governance
- Bypass observability or logging
- Mutate system state directly

---

## Consequences

### Positive

- Centralized execution model
- Strong contract enforcement
- Deterministic and reproducible behavior
- Clear separation of concerns
- Scalable and extensible architecture
- Enables safe AI integration

---

### Negative

- Additional service to deploy and maintain
- Requires API design and versioning discipline
- Introduces latency compared to in-process execution
- Requires governance integration mechanisms

---

## Alternatives Considered

### 1. Execute Logic in n8n (Rejected)

Embed logic in workflows or Code nodes.

**Rejected because:**
- Violates separation of concerns
- Breaks determinism
- Leads to logic drift

---

### 2. Clone Git in n8n Per Workflow (Rejected)

Load governance dynamically inside n8n.

**Rejected because:**
- High performance overhead
- Duplicates logic across workflows
- Breaks centralized execution model

---

### 3. Distributed Execution Without Central Service (Rejected)

Allow multiple systems to execute logic independently.

**Rejected because:**
- Breaks consistency and determinism
- Difficult to enforce contracts
- Reduces observability and traceability

---

## Future Considerations

- Multi-language execution support
- Execution scaling and load balancing
- Execution isolation and sandboxing
- Security and access control
- Integration with Canonical Knowledge System (CKS)
- Advanced scheduling and prioritization