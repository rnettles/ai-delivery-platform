# ADR-008: Structured LLM Outputs (Schema-Enforced JSON Contracts)

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system uses Large Language Models (LLMs) for:

- Planning (e.g., plans, tasks)
- Transformation (e.g., normalization)
- Analysis (e.g., classification, extraction)

By default, LLMs produce **free-form text**, which introduces problems:

- Outputs are difficult to validate
- Structure is inconsistent
- Parsing is error-prone
- Downstream systems cannot reliably consume outputs
- Violates deterministic execution requirements (ADR-018)

Given the system’s architecture:

- Artifact-driven state (ADR-002)
- Deterministic execution (ADR-018)
- Role-based execution (ADR-005)
- Governance-first logic (ADR-004)

LLM outputs must be **strictly structured, validated, and enforceable**.

---

## Decision

All LLM outputs SHALL be produced as **structured JSON conforming to explicit schemas**.

LLM outputs MUST be validated against JSON schemas before being accepted.

---

## Core Principle

> LLMs do not produce text.  
> LLMs produce structured data.

---

## Output Requirements

All LLM outputs MUST:

- Be valid JSON
- Conform to a predefined schema
- Be parseable without transformation
- Be complete and self-contained
- Be deterministic at the system boundary (after validation)

---

## Schema Enforcement

Each LLM output MUST be associated with:

- A JSON Schema definition
- Versioned schema (recommended)
- Validation rules enforced by the Execution Service (ADR-018)

Validation MUST include:

- Structural validation (required fields, types)
- Additional property constraints
- Domain-specific rules (optional but recommended)

Invalid outputs MUST:
- Be rejected
- Not produce artifacts
- Not affect system state

---

## LLM Output Lifecycle

The system SHALL enforce:

```
Input → Role → LLM → Candidate JSON → Schema Validation → Artifact → State
```

Free-form output paths are PROHIBITED.

---

## Prompting Requirements

All LLM prompts MUST:

- Explicitly instruct the model to return JSON only
- Define the expected schema clearly
- Include examples when necessary
- Avoid ambiguous formatting instructions

The system SHOULD:
- Use structured output modes (if supported by model APIs)
- Enforce strict JSON formatting (no prose, no markdown)

---

## Prohibited Output Formats

LLM outputs MUST NOT be:

- Free-form text
- Markdown documents
- Mixed text + JSON
- Partially structured responses

Any such outputs MUST be treated as invalid.

---

## Relationship to Deterministic Execution (ADR-018)

- JSON schemas define execution contracts
- LLM outputs are treated as untrusted input
- Validation ensures deterministic system behavior

---

## Relationship to Artifact-Driven State (ADR-002)

- Valid JSON outputs become artifacts
- Only validated artifacts contribute to state
- Invalid outputs are excluded

---

## Relationship to Roles (ADR-005)

- Roles define expected input/output schemas
- LLMs operate within role constraints
- Role outputs MUST conform to schemas

---

## Relationship to Governance (ADR-004)

- Schemas MUST be defined in governance artifacts (Git)
- Schema changes MUST be version-controlled
- Runtime systems MUST NOT define schemas dynamically

---

## Relationship to Observability (ADR-019)

The system SHOULD capture:

- Raw LLM output
- Parsed JSON output
- Validation results
- Schema version used

This enables:
- Debugging
- Replay
- Drift detection

---

## Error Handling

If LLM output fails validation:

The system MUST:

- Return structured error (ADR-018)
- Log validation failure
- Prevent artifact creation
- Optionally trigger retry logic (bounded)

The system MUST NOT:
- Attempt silent correction
- Accept partial data
- Infer missing fields

---

## Determinism Constraints

While LLMs are inherently non-deterministic:

- The system boundary MUST be deterministic
- Validation ensures only valid outputs are accepted
- Downstream systems operate on structured data only

---

## Consequences

### Positive

- Strong contract enforcement for LLM outputs
- Enables deterministic execution
- Simplifies parsing and downstream processing
- Improves reliability and debugging
- Aligns with artifact-driven state model
- Enables schema-driven automation

---

### Negative

- Increased complexity in prompt design
- Potential need for retries on invalid outputs
- Requires schema management and versioning
- May increase LLM token usage (due to structure requirements)

---

## Alternatives Considered

### 1. Free-Form Text Outputs (Rejected)

Allow LLMs to produce natural language output.

**Rejected because:**
- Cannot be reliably parsed
- Breaks deterministic execution
- Incompatible with artifact-driven state

---

### 2. Markdown-Based Outputs (Rejected)

Allow structured markdown instead of JSON.

**Rejected because:**
- Ambiguous structure
- Difficult to validate strictly
- Requires parsing heuristics

---

### 3. Partial Structure with Post-Processing (Rejected)

Allow loose structure and fix via parsing.

**Rejected because:**
- Introduces hidden logic and heuristics
- Breaks determinism
- Increases failure modes

---

## Future Considerations

- Schema versioning strategies
- Strong typing integration (e.g., TypeScript generation)
- Automatic schema generation from governance artifacts
- Model-specific structured output capabilities
- Multi-pass validation pipelines
- LLM output repair strategies (explicit and controlled)
- Integration with Canonical Knowledge System (CKS)