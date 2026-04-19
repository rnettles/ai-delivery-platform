# ADR-020: Schema and Contract Lifecycle Management

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The platform architecture depends on explicit, enforceable contracts across multiple layers:

- Execution contracts for scripts and roles (ADR-017, ADR-018)
- Structured LLM outputs (ADR-008)
- Canonical execution interface (ADR-013)
- Coordination and execution context persistence (ADR-014)
- Application-owned database schema lifecycle (ADR-015)
- Observability and replayability (ADR-019)

As the system evolves, schemas and contracts will change over time. Without a defined lifecycle model, the platform risks:

- Version mismatches between scripts, roles, and schemas
- Replay failures due to contract drift
- Breaking orchestration and API integrations
- Inconsistent LLM output expectations
- Database and execution schema divergence
- Loss of reproducibility and auditability

The system therefore requires a formal model for how schemas and contracts are:

- Versioned
- Bound to execution units
- Validated
- Evolved
- Deprecated

---

## Decision

The system SHALL adopt a **Schema and Contract Lifecycle Management Model** governing all structured contracts used by the platform.

This model SHALL define:

- How contracts are versioned
- How contracts are bound to execution units
- How compatibility is determined
- How breaking changes are introduced
- How historical executions remain reproducible

---

## Core Principle

> Execution depends on contracts.  
> Contracts must evolve without breaking truth.

---

## Scope

This ADR applies to all structured contracts, including:

- Script input contracts
- Script output contracts
- Role input/output contracts
- Execution request/response contracts
- LLM output schemas
- Coordination data schemas
- Database schemas where relevant to execution and persistence

---

## Contract Ownership

All contracts SHALL be:

- Defined as governed artifacts
- Version-controlled in Git (ADR-001, ADR-004)
- Owned by the application or governance layer, not runtime systems

Runtime systems MUST NOT define or mutate authoritative contracts dynamically.

---

## Versioning Model

All contracts MUST have an explicit version.

Version identifiers MAY use semantic versioning or an equivalent governed scheme, provided the system can distinguish:

- backward-compatible changes
- breaking changes

At minimum, the system MUST distinguish between:

- compatible revisions
- incompatible revisions

---

## Contract Binding

Every executable unit SHALL be bound to explicit contract versions.

This includes:

- script identifier + script version
- input contract version
- output contract version

The system SHALL support bindings conceptually equivalent to:

```text
script@version
  → input_contract@version
  → output_contract@version
```

Roles (ADR-005) MUST resolve to execution units with explicit contract bindings.

---

## Determinism Requirement

For deterministic execution (ADR-018), the system MUST be able to identify, for any execution:

- the exact script or role version
- the exact input contract version
- the exact output contract version
- the exact execution request/response contract in effect

Replay and audit MUST NOT depend on ambiguous or implicit contract resolution.

---

## Compatibility Rules

The system SHALL classify contract changes as either:

### 1. Compatible Changes

Changes that do not break existing consumers or replay behavior.

Examples MAY include:

- adding an optional field
- tightening descriptive metadata without changing structure
- adding non-required enum values where allowed by policy

### 2. Breaking Changes

Changes that invalidate prior assumptions or consumers.

Examples include:

- removing a field
- renaming a field
- changing field type
- changing required/optional status in a breaking direction
- changing semantic interpretation of a field without version change

Breaking changes MUST require a new contract version.

---

## Contract Change Policy

The system MUST NOT introduce breaking contract changes in place.

Breaking changes MUST:

- create a new version
- preserve prior versions for replay and compatibility where required
- be traceable through source control and governance workflows

Compatible changes MAY remain within the same compatibility line, subject to governance policy.

---

## Version Resolution Rules

Execution MUST resolve contracts deterministically.

The system MUST NOT rely on:

- implicit “latest” contract resolution without traceability
- runtime guessing of compatible schemas
- silent fallback to alternate contract versions

If aliases such as `latest` or `stable` are used, they MUST:

- resolve to a concrete contract version at execution time
- be recorded in the ExecutionRecord (ADR-019)

---

## Validation Requirements

All contract validation MUST be centralized and enforced at system boundaries (ADR-018, ADR-013).

Validation MUST:

- use the bound contract version
- occur before acceptance of input
- occur before acceptance of output
- fail explicitly and structurally on mismatch

The system MUST NOT:

- silently coerce incompatible data
- infer missing required fields
- accept partially valid payloads as success

---

## Historical Reproducibility

The system SHALL preserve sufficient contract history to support:

- replay of historical executions
- auditability of prior outcomes
- inspection of past behavior under prior contract definitions

A historical execution MUST remain interpretable using the contract versions that were active at the time of execution.

---

## Relationship to Execution Service (ADR-009)

The Execution Service SHALL be responsible for enforcing contract bindings at runtime.

It MUST:

- resolve execution units to explicit contract versions
- validate inputs and outputs against those versions
- record version information in execution history

---

## Relationship to Execution Contract Interface (ADR-013)

The canonical execution interface MUST support version-aware contract handling.

The API MUST be able to:

- identify execution unit version
- identify or imply bound contract versions deterministically
- reject incompatible requests clearly

Breaking API contract changes MUST be versioned explicitly.

---

## Relationship to Structured LLM Outputs (ADR-008)

LLM outputs MUST be validated against explicit schema versions.

Prompts, role definitions, or execution units using LLMs SHOULD reference the expected output contract version.

The system MUST NOT:

- accept LLM outputs against ambiguous schema versions
- silently reinterpret old outputs using new schemas

---

## Relationship to Observability and Replayability (ADR-019)

ExecutionRecords MUST capture enough contract metadata to support replay and audit.

This SHOULD include:

- script or role version
- input contract version
- output contract version
- request/response contract version where applicable

Replay MUST use the original contract versions unless an explicit migration workflow is invoked.

---

## Relationship to Database Schema Lifecycle (ADR-015)

Database schema lifecycle and execution contract lifecycle are related but distinct.

The system SHALL recognize:

- execution and API contracts govern runtime interaction
- database schemas govern persistence structure

Changes across these layers MUST be coordinated where data crosses the boundary.

The system MUST NOT assume that database schema version alone defines execution contract version.

---

## Contract Deprecation

Contracts MAY be deprecated, but deprecation MUST be explicit.

Deprecation policy SHOULD include:

- deprecation marker or status
- replacement contract reference
- last supported date or policy trigger
- replay support expectations

Deprecated contracts MUST remain available as long as needed for:

- replay
- audit
- supported clients

---

## Migration Strategy

When contracts evolve, the system MAY support migration mechanisms, including:

- contract adapters
- artifact upgrade workflows
- database migrations
- explicit re-rendering or regeneration of derived outputs

Migration MUST be:

- explicit
- traceable
- version-aware

The system MUST NOT silently migrate historical execution records or artifacts in place.

---

## Governance Requirements

Contract changes MUST:

- be reviewed through governance workflows
- be committed to source control
- be traceable to a decision or implementation change
- include compatibility assessment

High-impact contract changes SHOULD include:

- migration notes
- replay implications
- downstream consumer impact assessment

---

## Prohibited Behavior

The system MUST NOT:

- allow unversioned contracts
- allow breaking changes without new version identifiers
- silently reinterpret historical data with new contracts
- rely on implicit “latest” without traceability
- allow runtime systems to redefine authoritative contracts
- bypass centralized validation

---

## Consequences

### Positive

- Safe evolution of execution and API contracts
- Preserves determinism and replayability
- Reduces integration breakage
- Improves auditability and debugging
- Aligns LLM, API, execution, and persistence boundaries

### Negative

- Requires stronger schema governance discipline
- Increases version management overhead
- Adds complexity to tooling and developer workflows
- May require parallel support for multiple contract versions

---

## Alternatives Considered

### 1. Unversioned Contracts (Rejected)

**Rejected because:**
- breaks replayability
- causes contract drift
- makes integrations fragile

### 2. “Latest Only” Contract Resolution (Rejected)

**Rejected because:**
- breaks determinism
- prevents reliable replay
- makes behavior time-dependent

### 3. Database Schema as Sole Contract Authority (Rejected)

**Rejected because:**
- persistence schema is not sufficient to define execution behavior
- execution, API, and LLM contracts require independent governance

### 4. Ad Hoc Compatibility Decisions (Rejected)

**Rejected because:**
- produces inconsistency
- makes migrations unpredictable
- breaks trust in contract guarantees

---

## Future Considerations

- automated compatibility checking
- schema diff tooling
- contract registries and discovery
- SDK generation from contracts
- policy-driven deprecation enforcement
- contract lineage visualization
- explicit migration ADRs for major contract families

---

## Summary

ADR-020 establishes the rules by which contracts evolve without breaking determinism, replayability, or architectural integrity.

It ensures that:

- every execution is bound to explicit contract versions
- contract changes are governed and traceable
- historical behavior remains reproducible
- schema evolution does not undermine system truth