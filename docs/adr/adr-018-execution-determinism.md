# ADR-018: Deterministic Execution Layer with Contract Enforcement and Observability

## Status
Accepted

## Date
2026-04-18

---

## Context

ADR-017 introduced a dynamic, registry-based execution model.

However, dynamic execution alone does not guarantee:

- Deterministic behavior
- Strict contract enforcement
- Reliable error handling
- Full observability

Without these guarantees, the system risks:

- Non-reproducible execution outcomes
- Unstructured failures
- Orchestration instability (e.g., n8n)
- Debugging and replay limitations

To support production-grade automation and AI-driven workflows, execution must be:

- Deterministic
- Contract-driven
- Observable

---

## Decision

The Execution Service SHALL operate as a **Deterministic Execution Layer**, enforcing:

- Strict input/output contracts
- Structured error handling
- Reproducible execution behavior
- Full observability

---

## Core Principle

> Execution is not "best effort."  
> Execution is guaranteed, validated, and observable.

---

## Execution Contract Guarantee

Every execution MUST result in exactly one of:

1. A valid output conforming to the declared output contract  
2. A structured error conforming to the error contract  

No other outcomes are permitted.

---

## Contract Enforcement

### Requirements

- All scripts MUST define:
  - an input contract
  - an output contract

- The Execution Service MUST:
  - validate input before execution
  - validate output after execution

- Validation MUST be:
  - centralized
  - deterministic
  - consistent across all executions

---

### Constraint

Validation MUST NOT be performed inside scripts.

---

### Implementation Note

Validation tooling (e.g., JSON Schema validators) is an implementation concern and not part of this ADR.

---

## Deterministic Execution Guarantee

Determinism is defined as:

> Given the same:
> - script identifier
> - script version  
> - input  
> - execution context  

The system SHALL produce:

- the same output  
OR  
- the same structured error  

---

## Execution Context Constraints

Execution context MUST be:

- deterministic
- controlled
- explicitly defined

Execution context MUST NOT include:

- mutable global state
- non-deterministic inputs (e.g., current time, random values) unless explicitly injected
- external data without versioning or traceability

---

## Versioning Requirement

All executions MUST resolve to a specific script version.

The system MUST NOT:

- execute against an implicit or untracked version
- rely on “latest” without traceability

---

## Structured Error Handling

All failures MUST return a structured error:

```json
{
  "status": "error",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

---

### Error Requirements

Errors MUST:

- be machine-readable
- be deterministic
- include standardized error codes

---

### Prohibited Behavior

The system MUST NOT:

- return unstructured errors
- leak internal exceptions
- return partial or malformed outputs

---

## Execution Timeout Policy

The system SHALL enforce execution time limits.

Scripts exceeding the limit MUST:

- be terminated
- return a structured TIMEOUT error

---

## Observability Requirements

Observability is a **core part of the execution contract**.

Each execution MUST produce:

- execution identifier
- script identifier
- script version
- start timestamp
- end timestamp
- status (success/error)
- error details (if applicable)

---

### Observability Guarantees

The system SHALL support:

- execution tracing
- debugging
- replayability
- auditability

---

## Orchestration Boundary (ADR-007)

n8n (or any orchestrator) SHALL:

- send execution requests
- receive execution responses

n8n MUST NOT:

- perform validation
- interpret script logic
- modify execution contracts
- contain business logic

---

## Failure Handling Requirements

The system MUST handle failure scenarios deterministically, including:

- unknown script
- version mismatch
- invalid input
- runtime exception
- timeout
- null or malformed input

All failures MUST:

- return structured errors
- not crash the system
- not hang execution

---

## Script Discovery

The Execution Service SHALL expose script discovery capabilities.

This MUST include:

- script identifier
- version
- input contract
- output contract

---

## Non-Trivial Execution Requirement

The system MUST support scripts that:

- validate structured input
- perform meaningful transformation
- use execution context
- produce contract-compliant output

---

## Relationship to ADR-017

ADR-017 defines:

- execution model
- script registry

ADR-018 enforces:

- determinism
- contract guarantees
- observability
- execution boundaries

---

## Consequences

### Positive

- Fully deterministic execution behavior
- Strong contract guarantees
- Reliable orchestration
- Improved debugging and replayability
- Safe AI integration

---

### Negative

- Increased implementation complexity
- Requires strict schema discipline
- Reduces flexibility during rapid prototyping

---

## Alternatives Considered

### Implicit Contracts (Rejected)
Leads to unpredictable behavior and fragile systems

### Input-Only Validation (Rejected)
Output integrity cannot be guaranteed

### Unstructured Errors (Rejected)
Breaks automation and orchestration

### Logic in Orchestration (Rejected)
Violates separation of concerns (ADR-007)

---

## Future Considerations

- Schema versioning strategy
- Execution replay capabilities
- Distributed tracing
- Metrics and performance monitoring
- Script lifecycle management