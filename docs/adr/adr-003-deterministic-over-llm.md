# ADR-003: Deterministic Systems Over Direct LLM Execution

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system incorporates Large Language Models (LLMs) to enable:
- Planning
- Transformation
- Knowledge extraction
- Intelligent reasoning

However, LLMs introduce fundamental challenges:

- Non-deterministic outputs
- Variability across identical inputs
- Lack of strict contract adherence
- Difficulty in debugging and reproducibility
- Susceptibility to prompt drift and context sensitivity

Given the system’s requirements for:
- Deterministic execution (ADR-018)
- Observability and replayability (ADR-019)
- Artifact-driven state (ADR-002)
- Governance via Git (ADR-001)

Uncontrolled use of LLMs would undermine:
- System reliability
- Reproducibility
- State correctness
- Debugging capability

---

## Decision

The system SHALL prioritize **deterministic execution systems over direct LLM-driven workflows**.

LLMs SHALL be used only within **controlled, bounded, and validated contexts**.

---

## Core Principle

> LLMs generate possibilities.  
> Deterministic systems establish truth.

---

## Allowed LLM Usage

LLMs MAY be used for:

- Generating artifacts (e.g., plans, structured outputs)
- Assisting in transformations where deterministic logic is impractical
- Producing candidate outputs subject to validation
- Supporting reasoning workflows (e.g., classification, summarization)

However, LLM outputs MUST:

- Be treated as **untrusted input**
- Be validated before acceptance
- Be persisted as artifacts (ADR-002)
- Conform to defined schemas (ADR-018)

---

## Prohibited LLM Usage

LLMs MUST NOT:

- Directly define system state
- Bypass schema validation
- Execute business logic without validation
- Produce outputs that are accepted without verification
- Be used as the sole source of truth

---

## LLM Containment Model

All LLM interactions SHALL be contained within deterministic execution boundaries:

```
Input → LLM → Candidate Output → Validation → Artifact → State
```

LLMs MUST NOT directly influence:

```
LLM → State (PROHIBITED)
LLM → Execution Output (without validation) (PROHIBITED)
```

---

## Deterministic Execution Priority

Wherever feasible, deterministic scripts SHALL replace LLM logic.

Examples:

| Use Case | Preferred Approach |
|--------|------------------|
| Data transformation | Deterministic script |
| Schema validation | Deterministic logic |
| Business rules | Deterministic logic |
| Planning generation | LLM (validated) |
| Natural language interpretation | LLM (validated) |

---

## Relationship to Execution System (ADR-018)

- LLM outputs MUST pass input/output schema validation
- LLMs are executed within scripts, not outside them
- Execution Service enforces contract boundaries

---

## Relationship to Observability (ADR-019)

- LLM interactions MUST be observable
- Prompts and responses SHOULD be captured as part of ExecutionRecords
- Replay MUST include identical LLM inputs

---

## Relationship to Artifact-Driven State (ADR-002)

- LLM outputs become artifacts only after validation
- Only validated artifacts contribute to state
- Invalid or rejected outputs MUST NOT affect state

---

## Determinism Constraints

The system SHALL ensure that:

- Non-deterministic LLM behavior is isolated
- Downstream systems operate deterministically
- Final system outputs are reproducible

If strict determinism cannot be achieved at the LLM layer, it MUST be enforced at:

- Validation
- Artifact acceptance
- State derivation

---

## Validation Requirements for LLM Outputs

LLM outputs MUST be validated via:

- Schema validation (required)
- Structural validation (required)
- Domain-specific validation (optional but recommended)

Invalid outputs MUST:
- Be rejected
OR
- Be flagged and excluded from state

---

## Observability Requirements

For each LLM interaction, the system SHOULD capture:

- Prompt
- Model identifier
- Input context
- Output response
- Validation results

This enables:
- Debugging
- Replay analysis
- Drift detection

---

## Failure Handling

LLM-related failures MUST result in:

- Structured errors (ADR-018)
- No impact on system state
- Optional retry mechanisms (bounded and controlled)

The system MUST NOT:
- Accept degraded or partial outputs silently
- Mask LLM failures

---

## Consequences

### Positive

- Strong system reliability and predictability
- Improved debugging and observability
- Reduced impact of LLM variability
- Clear separation between intelligence and execution
- Safer integration of AI capabilities

---

### Negative

- Increased engineering effort to build deterministic systems
- Additional validation layers required
- Potential performance overhead
- Reduced flexibility for rapid experimentation

---

## Alternatives Considered

### 1. Fully LLM-Driven Workflows (Rejected)

Allow LLMs to directly drive system behavior and state.

**Rejected because:**
- Non-deterministic and unpredictable
- Difficult to debug and reproduce
- High risk of drift and inconsistency

---

### 2. Partial Validation Model (Rejected)

Allow some LLM outputs to bypass validation.

**Rejected because:**
- Breaks contract guarantees (ADR-018)
- Introduces inconsistency in system behavior

---

### 3. LLM as Source of Truth (Rejected)

Treat LLM outputs as authoritative without verification.

**Rejected because:**
- Violates artifact-driven state (ADR-002)
- Breaks determinism and reproducibility

---

## Future Considerations

- LLM output confidence scoring
- Multi-pass validation pipelines
- Ensemble or consensus-based validation
- Fine-tuned models for deterministic behavior
- Integration with Canonical Knowledge System (CKS)
- Drift detection and monitoring
- Prompt versioning and governance (Git-backed)