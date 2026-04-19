# ADR-015: Application-Owned Schema Lifecycle and Migration Model

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system introduces a persistent coordination and execution context layer (ADR-014), backed by PostgreSQL, to support:

- Execution tracking (ADR-019)
- Coordination state for workflows and agents
- Cross-system interaction (n8n, local dev, Execution Service)

The architecture requires:

- Deterministic execution (ADR-018)
- Artifact-driven state (ADR-002)
- Governance-first design (ADR-004)
- Controlled API boundaries (ADR-013)

A consistent model is required for:

- Defining database schemas
- Managing schema evolution
- Ensuring reproducibility and traceability
- Preventing uncontrolled schema mutation

---

## Decision

The system SHALL adopt an **application-owned schema lifecycle model**, where:

- Schema definitions are owned by the application layer
- Schema changes are versioned and controlled
- Migrations are required for all schema evolution

---

## Core Principle

> Infrastructure provisions databases.  
> Applications define and evolve schemas.

---

## Schema Ownership Model

### Application-Owned Schema

Schema definitions MUST:

- Reside in the application repository
- Be version-controlled
- Be defined in a structured, declarative format
- Be tightly coupled with application logic

---

### Infrastructure-Owned Database

Infrastructure (e.g., Terraform) SHALL:

- Provision database servers and instances
- Manage networking and access
- NOT define or manage schema structure

---

## Migration Requirements

All schema changes MUST:

- Be defined as versioned migrations
- Be committed to source control
- Be applied through controlled processes

The system MUST NOT:

- Allow ad-hoc or manual schema changes
- Allow schema drift between environments
- Allow schema mutation outside migration workflows

---

## Determinism and Reproducibility

The system SHALL ensure:

- Schema state is reproducible from source control
- Migrations are applied in a deterministic order
- Application code and schema remain aligned

Given:
- A code version

The system SHALL be able to:
- Reconstruct the exact database schema

---

## Relationship to Coordination Layer (ADR-014)

- Database stores coordination and execution context
- Database is NOT the source of truth for system state
- Data stored MUST be treated as:
  - transient (coordination)
  - derived (non-authoritative)

---

## Relationship to Execution Service (ADR-009)

- Execution Service interacts with database via application layer
- Execution logic MUST NOT bypass schema constraints
- Schema validation MUST align with execution contracts

---

## Relationship to Governance (ADR-004)

- Schema definitions are governed artifacts
- Changes MUST follow governance workflows (e.g., PRs)
- Schema evolution MUST be auditable

---

## Implementation Strategy

The system SHALL use a **schema definition + migration toolchain** that supports:

- Declarative schema definition
- Migration generation
- Version control integration
- Type-safe interaction (preferred)

---

### Initial Implementation

The system SHALL use:

- **Drizzle ORM + Drizzle Kit**

for:

- Schema definition
- Migration generation
- Type-safe database interaction

---

### Implementation Constraint

The chosen tool MUST:

- Support explicit schema control (no hidden abstraction)
- Align with TypeScript-first architecture
- Enable deterministic migrations
- Allow inspection of generated SQL

---

## Prohibited Behavior

The system MUST NOT:

- Define schema in infrastructure (Terraform)
- Allow direct manual schema changes in production
- Allow runtime systems (n8n, agents) to mutate schema
- Introduce schema changes without versioning

---

## Consequences

### Positive

- Strong schema governance
- Reproducible environments
- Alignment between code and data
- Safe schema evolution
- Supports agent-driven workflows safely

---

### Negative

- Requires migration discipline
- Additional tooling and setup
- Increased initial complexity

---

## Alternatives Considered

### 1. Infrastructure-Managed Schema (Rejected)

**Rejected because:**
- Not suited for iterative evolution
- Poor developer experience
- No application-level versioning

---

### 2. Manual SQL / No Migrations (Rejected)

**Rejected because:**
- No version control
- High risk of drift
- No rollback capability

---

### 3. Database as Source of Truth (Rejected)

**Rejected because:**
- Violates artifact-driven architecture (ADR-002)
- Reduces transparency and reproducibility

---

### 4. Alternative ORMs (Prisma, TypeORM)

**Not selected (implementation-level)**

- Heavier abstraction layers
- Less control over SQL
- May not align with explicit schema control requirements

---

## Future Considerations

- Schema versioning metadata
- Migration automation in CI/CD
- Multi-service schema sharing
- Schema evolution strategies for CKS integration
- Backward compatibility and migration safety policies

---

## Summary

This decision establishes:

```
Infrastructure (Terraform) → database lifecycle
Application (Schema + Migrations) → schema lifecycle
```

ensuring:

- clear ownership boundaries
- deterministic schema evolution
- alignment with execution and coordination layers