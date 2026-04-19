# ADR-018: Deterministic Execution Layer with Contract Enforcement and Observability

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

## Context

ADR-017 introduced a dynamic script execution model using a registry-based approach, enabling flexible and extensible execution of scripts via a centralized Execution Service.

While ADR-017 enables dynamic execution, it does not guarantee:
- Deterministic behavior
- Strict contract enforcement
- Reliable error handling
- Execution observability

At present, the system is **implicitly correct**, meaning:
- Input/output expectations are assumed, not enforced
- Failures may result in unstructured errors or undefined behavior
- Execution outcomes may vary under edge conditions
- Observability into execution is limited or inconsistent

This creates significant risks:
- Unpredictable failures in orchestrated workflows (e.g., n8n)
- Difficulty debugging or replaying executions
- Inability to guarantee system integrity at scale
- Tight coupling of orchestration and execution logic

To support reliable automation, agent-driven workflows, and production-scale usage, the Execution Service must evolve into a **deterministic, contract-driven, and observable system**.

---

## Decision

The Execution Service SHALL be transformed into a **Deterministic Execution Layer** with strict contract enforcement, structured error handling, and full observability.

### 1. Execution Contract Enforcement

All scripts MUST define:
- `script_input.schema.json`
- `script_output.schema.json`

Validation SHALL be enforced using Ajv or an equivalent JSON Schema validator.

The system SHALL guarantee that every execution results in exactly one of:

1. A valid output conforming to the declared output schema  
2. A structured error conforming to the ExecutionError contract  

No other outcomes are permitted.

---

### 2. Structured Error Handling

All failures MUST return a structured error object:

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

Error types SHALL include (but are not limited to):
- `INPUT_VALIDATION`
- `OUTPUT_VALIDATION`
- `RUNTIME`
- `TIMEOUT`
- `UNKNOWN_SCRIPT`
- `VERSION_MISMATCH`

The system MUST NOT:
- Throw unhandled exceptions to callers
- Return unstructured errors
- Return partial or malformed outputs

---

### 3. Deterministic Execution Guarantee

Determinism is defined as:

> Given the same:
> - script version  
> - input  
> - execution context  

The system SHALL produce:
- the same output  
OR  
- the same structured error  

The system MUST NOT exhibit undefined or non-repeatable behavior.

---

### 4. Execution Timeout Policy

The system SHALL enforce execution timeouts.

Scripts exceeding the configured duration MUST:
- Be terminated
- Return a structured `TIMEOUT` error

---

### 5. Observability Requirements

All executions MUST be observable.

Each execution SHALL produce structured logs containing:
- `execution_id`
- `script` name
- `script_version`
- `start_timestamp`
- `end_timestamp`
- `status` (success/error)
- `error` (if applicable)

This enables:
- Debugging
- Replayability
- Monitoring
- Auditability

---

### 6. Orchestration Boundary (n8n)

n8n SHALL act strictly as an orchestration layer.

n8n MUST:
- Send `ExecutionRequest`
- Receive `ExecutionResponse`

n8n MUST NOT:
- Contain business logic
- Interpret script behavior
- Modify execution contracts
- Perform schema validation

The Execution Service SHALL be the sole authority for:
- Script execution
- Contract validation
- Error normalization

---

### 7. Failure Testing Requirements

The system SHALL be validated against controlled failure scenarios, including:

- Unknown script
- Invalid input shape
- Script runtime exception
- Long-running execution (timeout)
- Null or empty input
- Version mismatch

All scenarios MUST result in structured error responses.

No crashes, hangs, or undefined states are permitted.

---

### 8. Script Discovery Endpoint

The Execution Service SHALL expose:

```
GET /scripts
```

This endpoint SHALL return:
- Script name
- Version
- Input schema
- Output schema

This enables:
- UI integration
- Debugging tools
- Agent-driven discovery
- Schema-driven automation

---

### 9. Non-Trivial Script Validation Requirement

The system MUST demonstrate capability beyond trivial scripts (e.g., `test.echo`).

At least one script MUST:
- Validate structured input
- Perform transformation logic
- Utilize execution context (e.g., logging, metadata)

This ensures:
- Contract enforcement is real
- Registry supports real workloads
- Execution layer is production-capable

---

## Consequences

### Positive

- Deterministic and reliable execution behavior
- Strong contract guarantees between systems
- Improved debugging and observability
- Safe integration with orchestration systems (e.g., n8n)
- Foundation for agent-driven and automated workflows
- Clear separation of concerns between orchestration and execution

### Negative

- Increased implementation complexity
- Additional overhead for schema definition and validation
- Strict contracts reduce flexibility during rapid prototyping
- Requires versioning strategy for schemas and scripts

---

## Alternatives Considered

### 1. Implicit Contract Model (Rejected)

Allow scripts to define input/output informally without enforced schemas.

**Rejected because:**
- Leads to unpredictable behavior
- Breaks orchestration reliability
- Makes debugging and scaling difficult

---

### 2. Validation Only on Input (Rejected)

Validate input but not output.

**Rejected because:**
- Output may still violate downstream expectations
- Breaks system integrity guarantees

---

### 3. Allow Unstructured Errors (Rejected)

Permit scripts to return arbitrary error formats.

**Rejected because:**
- Breaks automation and orchestration layers
- Prevents consistent error handling

---

### 4. Embed Logic in n8n (Rejected)

Allow n8n workflows to contain business logic and transformations.

**Rejected because:**
- Violates separation of concerns
- Leads to duplication and drift
- Makes system harder to maintain and scale

---

## Relationship to ADR-017

ADR-017 introduced:
- Dynamic script execution
- Registry-based architecture

ADR-018 extends this by:
- Enforcing strict input/output contracts
- Introducing deterministic execution guarantees
- Defining execution boundaries
- Adding structured error handling
- Establishing observability requirements

ADR-018 transforms the Execution Service from a flexible execution mechanism into a **reliable, production-grade execution platform**.

---

## Future Considerations

- Schema versioning strategy
- Execution replay capability
- Distributed tracing integration
- Metrics and performance monitoring
- Script lifecycle management (deploy, deprecate, migrate)
- Role-based access control for script execution