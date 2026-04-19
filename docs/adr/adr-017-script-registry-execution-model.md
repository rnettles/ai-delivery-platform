# ADR-017: Script Registry & Execution Model

## Status
Accepted

## Date
2026-04-18

---

## Context

The platform requires a **deterministic, contract-driven execution model** to support:

- AI-driven workflows (planner → implementer → verifier)
- Orchestration systems (ADR-007)
- Role-based execution (ADR-005)
- Multi-tenant SaaS evolution
- Dynamic feature expansion without redeployment

Execution must align with:

- Deterministic execution (ADR-018)
- Structured contracts (ADR-013)
- Artifact-driven state (ADR-002)
- Observability (ADR-019)

---

## Decision

The system SHALL implement a **Script Registry & Execution Model** as the foundational execution mechanism.

Scripts SHALL be the **atomic units of deterministic execution**, resolved dynamically at runtime via a registry.

---

## Core Principle

> Scripts execute logic.  
> Registry resolves logic.  
> Execution Service enforces truth.

---

## Execution Model

All execution SHALL follow:

```
Execution Request
      ↓
Execution Service
      ↓
Script Registry (resolve name + version)
      ↓
Schema Validation (input)
      ↓
Script Execution
      ↓
Schema Validation (output)
      ↓
Execution Response
```

---

## Script Definition (Conceptual)

A script is a **versioned unit of execution logic** that:

- Accepts structured input
- Produces structured output
- Executes deterministically
- Does not own validation
- Does not mutate system state

Scripts MUST:

- Be versioned
- Be pure relative to inputs + context
- Be observable

---

## Script Responsibilities

Scripts MAY:

- Transform data
- Invoke external systems
- Generate artifacts

Scripts MUST NOT:

- Perform schema validation (handled by Execution Service)
- Define business logic outside governance artifacts
- Mutate authoritative state
- Bypass execution contracts

---

## Script Context

Scripts receive a standardized execution context that includes:

- execution identifier
- logging interface
- correlation metadata

Context MAY include:

- coordination data (ADR-014)

Context MUST NOT include:

- authoritative state
- mutable system truth

---

## Script Registry

The Script Registry SHALL:

- Store scripts as `name@version`
- Resolve scripts deterministically
- Support multiple concurrent versions

---

## Version Resolution Rules

### REQUIRED

Execution MUST specify an explicit immutable version at request time.

---

### PROHIBITED

- Implicit or explicit floating aliases (for example: `latest`, `stable`, unpinned major tags)
- Any runtime behavior that does not bind to an immutable resolved version

---

## Relationship to Roles (ADR-005)

Roles SHALL resolve to scripts.

```
Role → Script + Version → Execution
```

This ensures:

- roles remain governed abstractions
- execution remains deterministic

---

## Contract Enforcement (ADR-018)

The Execution Service SHALL:

- Validate input against schema
- Validate output against schema
- Reject invalid execution

Scripts MUST NOT perform validation internally.

Any script-local checks are advisory only and MUST NOT replace or redefine contract/schema validation owned by the Execution Service.

---

## Execution Contract

All scripts SHALL execute within the canonical execution contract (ADR-013).

They MUST:

- Accept structured input
- Produce structured output
- Return deterministic results

---

## Error Handling

Errors MUST:

- Be normalized
- Be structured
- Be deterministic

Error types include:

- SCRIPT_NOT_FOUND
- VALIDATION_ERROR
- EXECUTION_ERROR
- TIMEOUT_ERROR (future)

---

## Observability (ADR-019)

Execution MUST:

- Produce ExecutionRecords
- Include execution_id
- Capture script name + version
- Capture inputs, outputs, and errors

---

## Determinism Requirements

Given:

- script name
- version
- input

The system MUST produce:

- identical output OR identical error

---

## Prohibited Behavior

The system MUST NOT:

- Execute scripts without version resolution
- Allow scripts to bypass validation
- Allow scripts to mutate authoritative state
- Allow multiple execution paths outside the registry

---

## Consequences

### Positive

- Strong execution determinism
- Versioned evolution of logic
- Clean separation of orchestration and execution
- Enables scalable AI-driven workflows

---

### Negative

- Requires strict version discipline
- Adds registry management complexity
- Requires schema governance

---

## Alternatives Considered

### Hardcoded Execution Logic
Rejected: Not scalable, no versioning

### Orchestration-Driven Logic
Rejected: Violates ADR-007

### Direct Function Invocation
Rejected: Breaks contract and observability model

---

## Future Enhancements

- Distributed registry
- Script manifests with schema binding
- Execution isolation (sandboxing)
- Rate limiting and quotas
- Retry and idempotency support

---

## Summary

ADR-017 defines the **deterministic execution backbone** of the platform.

It ensures:

- All logic is versioned
- All execution is contract-driven
- All behavior is reproducible
- All orchestration remains decoupled from execution

This ADR is a **core architectural boundary** and must be strictly enforced.