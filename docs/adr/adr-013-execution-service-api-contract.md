# ADR-013: Execution Service API Contract (Canonical Execution Interface)

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system architecture defines:

- Governance-first logic (ADR-004)
- n8n as orchestration layer (ADR-007)
- Execution Service as the deterministic runtime engine (ADR-009)
- Contract enforcement and validation (ADR-018)
- Observability and replayability (ADR-019)
- Role-based AI execution (ADR-005)

Multiple clients (e.g., n8n, UI, CLI, agents) must interact with the Execution Service to:

- Execute governed logic
- Generate artifacts
- Validate outputs
- Access system capabilities

Without a standardized contract:

- Integration becomes inconsistent
- Execution behavior may drift
- Determinism and validation guarantees are weakened
- Observability becomes fragmented

---

## Decision

The Execution Service SHALL expose a **canonical execution contract** that defines all interactions between:

- Orchestration systems (e.g., n8n)
- External clients (UI, CLI, agents)
- The deterministic execution layer

This contract SHALL be the **only interface for invoking execution logic**.

---

## Core Principle

> All execution flows through a single, governed contract boundary.

---

## Canonical Execution Model

All interactions SHALL conform to a standardized execution flow:

```
Execution Request → Execution Service → Execution Response
```

---

## Execution Request Contract

The system SHALL define a canonical execution request envelope that includes:

- A target execution identifier (e.g., script or role)
- An optional version identifier for deterministic execution
- A structured input payload
- Metadata for traceability and observability

This request envelope MUST:

- Support deterministic execution (via versioning)
- Support schema validation (structured input)
- Support observability (correlation_id, request_id)
- Be consistent across all clients

---

## Execution Response Contract

The system SHALL define a standardized execution response that includes:

- A success indicator
- Either:
  - Valid output data
  OR
  - A structured error
- A unique execution identifier

The response MUST:

- Be deterministic (ADR-018)
- Be structured and machine-readable
- Support downstream automation and orchestration

---

## Contract Enforcement Requirements

All interactions with the Execution Service MUST:

- Use structured data (e.g., JSON)
- Conform to defined schemas (ADR-018)
- Produce either valid output or structured error (no undefined states)
- Be observable and traceable (ADR-019)

---

## API Boundary

The Execution Service SHALL expose an HTTP API implementing this contract.

The API MUST:

- Enforce the execution request/response contract
- Serve as the single entry point for execution logic
- Prevent bypass of validation and observability layers

The canonical execution boundary SHOULD be represented as a unified execution endpoint (for example, `POST /execute`) with structured request envelopes that identify target + version.

The exact API structure (e.g., endpoints, payload formats) SHALL be defined in a **separate API specification**, not in this ADR.

---

## Endpoint Design Principles

The API SHALL:

- Use a unified execution endpoint for governed execution
- Minimize proliferation of specialized behavior endpoints
- Support composability through structured input payloads

Supporting endpoints MAY exist (e.g., discovery, health, replay metadata), but MUST:

- Adhere to the same contract principles
- Never bypass the canonical execution model

The system MUST NOT define competing execution endpoints such as action-specific workflow APIs that fragment contract ownership.

---

## Relationship to n8n (ADR-007)

n8n SHALL:

- Invoke execution via the Execution Service API
- Pass structured execution requests
- Route responses without interpreting business logic

n8n MUST NOT:

- Execute logic directly
- Bypass the execution contract
- Introduce alternative execution paths

---

## Relationship to Execution Service (ADR-009)

- The API is the interface to the execution engine
- All logic execution MUST pass through this contract
- The Execution Service enforces:
  - validation
  - determinism
  - observability

---

## Relationship to Roles (ADR-005)

- Roles are invoked through the same execution contract
- Role execution is abstracted behind the execution interface
- Role constraints are enforced internally

---

## Relationship to Structured Outputs (ADR-008)

- All inputs and outputs MUST be structured
- All data MUST conform to schemas
- Free-form text is not permitted at the contract boundary

---

## Relationship to Observability (ADR-019)

Each execution request MUST:

- Generate an ExecutionRecord
- Produce a unique execution identifier
- Include metadata for tracing and correlation

---

## Versioning Requirements

The execution contract MUST support versioning at:

- Execution level (script/role version)
- API level (if breaking changes occur)

The system SHOULD:

- Maintain backward compatibility where feasible
- Explicitly version breaking changes

---

## Error Handling Requirements

All errors MUST:

- Be structured and machine-readable
- Include standardized error codes
- Be deterministic and reproducible

The system MUST NOT:

- Return unstructured errors
- Leak internal implementation details

---

## Security Considerations

The API MUST:

- Authenticate and authorize requests
- Validate all inputs strictly
- Prevent unauthorized execution

Sensitive operations MUST be:

- Auditable
- Controlled via governance and approval (ADR-006)

---

## Prohibited Behavior

The system MUST NOT:

- Allow execution outside the API boundary
- Allow clients to bypass validation
- Allow inconsistent request/response formats
- Allow multiple competing execution interfaces

---

## Consequences

### Positive

- Unified and consistent execution interface
- Strong contract enforcement
- Simplified integration across systems
- Improved observability and debugging
- Enables future extensibility (UI, agents, CLI)

---

### Negative

- Requires strict API governance
- Requires additional API specification and documentation
- Introduces initial design complexity

---

## Alternatives Considered

### 1. Ad-Hoc API Endpoints (Rejected)

**Rejected because:**
- Leads to inconsistency
- Hard to maintain
- Breaks unified contract model

---

### 2. Direct Execution Without API (Rejected)

**Rejected because:**
- Bypasses validation and observability
- Introduces security risks
- Breaks architecture boundaries

---

### 3. Tight Coupling to n8n (Rejected)

**Rejected because:**
- Limits reuse by other clients
- Prevents system extensibility

---

## Future Considerations

- Formal API specification (OpenAPI / JSON Schema)
- SDK generation for clients
- Async and streaming execution models
- Rate limiting and throttling
- API gateway integration