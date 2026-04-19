# ADR-005: Role-Based Execution Model

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system incorporates AI-driven components (LLMs) for tasks such as:

- Planning
- Transformation
- Analysis
- Workflow coordination

Without structure, AI-driven execution introduces risks:

- Unbounded behavior
- Inconsistent outputs
- Drift from intended system logic
- Lack of reproducibility
- Difficulty enforcing constraints (ADR-003)

Additionally, the system architecture requires:

- Deterministic execution (ADR-018)
- Artifact-driven state (ADR-002)
- Governance-first logic definition (ADR-004)
- Observability and replayability (ADR-019)

To safely integrate AI into this system, AI behavior must be:

- Bounded
- Structured
- Governed
- Reproducible

---

## Decision

All AI-driven actions SHALL occur through **defined, governed roles**.

Roles SHALL act as **controlled execution interfaces** for AI behavior.

---

## Core Principle

> Roles constrain intelligence.  
> Execution enforces truth.

---

## Definitions

### Role

A role is a **governed, versioned definition of AI behavior**, including:

- Purpose (what the role does)
- Input contract
- Output contract
- Allowed actions
- Constraints and rules
- Prompt or instruction set (if LLM-based)

Roles are:

- Defined in governance artifacts (Git) (ADR-001, ADR-004)
- Versioned
- Explicitly scoped
- Enforced at execution time

---

### Role Execution

Role execution is the process of:

```
Input → Role → (LLM or logic) → Candidate Output → Validation → Artifact
```

---

## Role Characteristics

All roles MUST:

- Define explicit input and output schemas
- Operate within deterministic execution boundaries (ADR-018)
- Produce outputs that are validated before acceptance
- Be versioned and traceable
- Be reproducible

Roles MUST NOT:

- Directly mutate system state
- Bypass validation
- Execute arbitrary or undefined actions
- Introduce logic outside governance artifacts

---

## Role as an Execution Abstraction

Roles SHALL act as an abstraction layer between:

```
AI Behavior ↔ Execution System
```

This ensures:

- AI logic is encapsulated
- Execution remains deterministic
- Outputs are validated and observable

---

## Relationship to LLM Usage (ADR-003)

- Roles are the ONLY allowed interface for LLM interaction
- LLMs MUST operate within role constraints
- LLM outputs MUST be treated as untrusted input
- Validation is required before outputs are accepted

Free-form LLM execution is PROHIBITED.

---

## Relationship to Execution System (ADR-018)

- Roles SHALL be executed via the Execution Service
- Role inputs/outputs MUST conform to schemas
- Role execution MUST result in:
  - Valid output
  OR
  - Structured error

Roles do not bypass execution contracts.

---

## Relationship to Artifact-Driven State (ADR-002)

- Role outputs become artifacts (after validation)
- Only validated role outputs contribute to state
- Roles do not directly define or mutate state

---

## Relationship to Governance (ADR-004)

- Roles MUST be defined in governance artifacts (Git)
- Role definitions MUST be version-controlled
- Role behavior MUST originate from governance

Runtime systems MUST NOT define or modify roles dynamically.

---

## Role Types

The system MAY define multiple role categories, including:

### 1. Planning Roles
- Example: Planner, Sprint Controller
- Purpose: Generate structured plans and tasks

### 2. Transformation Roles
- Purpose: Normalize or transform data

### 3. Analysis Roles
- Purpose: Interpret or classify inputs

### 4. Execution Coordination Roles
- Purpose: Determine execution sequencing or orchestration inputs

All role types MUST adhere to the same constraints.

---

## Role Registry

The system SHOULD maintain a Role Registry containing:

- Role name
- Version
- Input schema
- Output schema
- Description
- Constraints

This enables:
- Discoverability
- Debugging
- Agent-driven interaction

---

## Observability Requirements (ADR-019)

Each role execution MUST be observable.

ExecutionRecords SHOULD include:

- role name
- role version
- input
- output
- validation results
- underlying LLM interaction (if applicable)

---

## Determinism Constraints

While roles MAY use LLMs internally:

- Role outputs MUST be validated
- Accepted outputs MUST be deterministic at the system level
- Non-determinism MUST be contained within the role

---

## Failure Handling

Role execution failures MUST:

- Return structured errors (ADR-018)
- Produce no artifacts (if invalid)
- Not affect system state

The system MUST NOT:
- Accept partial or invalid role outputs
- Mask role execution failures

---

## Prohibited Models

The system MUST NOT:

- Allow free-form AI execution outside roles
- Allow roles to define new behavior at runtime
- Allow roles to bypass execution or validation layers
- Allow roles to directly mutate state

---

## Consequences

### Positive

- Strong control over AI behavior
- Predictable and reproducible outputs
- Clear boundaries for AI execution
- Improved debugging and observability
- Safe integration of LLM capabilities
- Enables scalable multi-role systems

---

### Negative

- Requires upfront role definition effort
- Adds abstraction layer to AI interactions
- May slow rapid experimentation without tooling
- Requires schema and contract management

---

## Alternatives Considered

### 1. Free-Form AI Execution (Rejected)

Allow AI to execute tasks without role constraints.

**Rejected because:**
- Unbounded and unpredictable behavior
- No enforceable contracts
- Breaks determinism and observability

---

### 2. Role-Like Prompts Without Enforcement (Rejected)

Use roles conceptually but without strict contracts.

**Rejected because:**
- Roles become informal and inconsistent
- No guarantee of behavior
- Difficult to debug and validate

---

### 3. Hardcoded AI Behavior in Code (Rejected)

Embed role logic directly in application code.

**Rejected because:**
- Violates governance-first architecture (ADR-004)
- Reduces flexibility and traceability
- Requires deployment for behavior changes

---

## Future Considerations

- Role versioning strategies
- Role composition (roles invoking other roles)
- Role capability permissions and constraints
- Role performance monitoring
- Role-level A/B testing
- Integration with Canonical Knowledge System (CKS)
- Dynamic role selection based on context (within governance constraints)