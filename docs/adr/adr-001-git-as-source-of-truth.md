# ADR-001: Git as Source of Truth for Governance Artifacts

## Status
Accepted

## Date
2026-04-18

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The system requires strong governance, traceability, version control, and reproducibility across all artifacts that define system behavior, planning, and structure.

These artifacts include (but are not limited to):
- Architecture Decision Records (ADRs)
- Functional requirements
- Design documents
- Planning artifacts (phase plans, sprint plans, tasks)
- Schema definitions
- Workflow definitions (e.g., n8n)
- Script contracts and metadata

Without a centralized and authoritative source of truth:
- Artifacts may drift across systems
- Changes may become untraceable
- System behavior may become non-reproducible
- Governance becomes fragmented

The system must ensure that all governance artifacts are:
- Versioned
- Auditable
- Reproducible
- Accessible to both humans and automation

---

## Decision

Git SHALL be the **authoritative source of truth** for all governance artifacts.

All governance artifacts MUST:
- Be stored in a Git repository
- Be version-controlled
- Be immutable per commit
- Be accessible via standard Git operations

Git SHALL define the **canonical state** of governance artifacts.

---

## Definitions

### Governance Artifacts

Governance artifacts include any artifact that:
- Defines system behavior
- Guides execution or planning
- Is required for reproducibility
- Is consumed by agents, workflows, or developers

This includes:
- ADRs
- Requirements documents
- Design specifications
- Planning outputs
- Schemas
- Script metadata and contracts

---

## Scope Boundaries

### Git SHALL Contain

- All governance artifacts
- All versioned definitions of system behavior
- All planning and design outputs
- All schema and contract definitions

---

### Git SHALL NOT Contain

- Runtime execution state (see ADR-019)
- Transient or ephemeral data
- High-volume telemetry or logs
- Derived or cacheable data that can be reconstructed

---

## Runtime vs Source-of-Truth Model

The system SHALL distinguish between:

### 1. Source-of-Truth Layer (Git)
- Authoritative
- Versioned
- Human-editable
- Immutable per commit

### 2. Runtime Layer (System State)
- Derived from Git
- Mutable
- Execution-oriented

---

### Rule

> Git defines WHAT the system should be.  
> Runtime systems define WHAT is currently happening.

---

## Synchronization Model

The system SHALL support synchronization between Git and runtime systems.

### Requirements

- Runtime systems MAY cache or materialize artifacts from Git
- Runtime systems MUST NOT override Git as source of truth
- Changes to governance artifacts MUST originate from Git commits

### Optional (Future)

- Automated sync pipelines
- Git-driven deployment of artifacts
- Change detection and propagation

---

## Determinism and Reproducibility

All governance artifacts MUST be reproducible from Git.

Given:
- A repository
- A commit hash

The system SHALL be able to reconstruct:
- The exact governance state
- The exact configuration of the system at that point in time

---

## Integration with Execution System

### Relationship to ADR-017

- Scripts and execution definitions may be stored in Git
- Registry definitions may originate from Git-backed artifacts

### Relationship to ADR-018

- Script input/output schemas SHOULD be stored in Git
- Contract definitions MUST be versioned

### Relationship to ADR-019

- ExecutionRecords are NOT stored in Git
- Git provides context for execution (schemas, definitions)
- Execution history remains in runtime persistence

---

## Conflict and Change Management

Changes to governance artifacts MUST:
- Be performed via Git commits
- Be reviewable (e.g., pull requests)
- Maintain full history

The system MUST NOT:
- Allow silent mutation of governance artifacts outside Git
- Allow runtime systems to overwrite Git-defined artifacts

---

## Consequences

### Positive

- Strong traceability and auditability
- Full version history of system governance
- Reproducible system state via commit hashes
- Alignment with developer workflows
- Enables automation via Git-driven processes
- Supports collaboration and review

---

### Negative

- Requires Git integration across workflows
- Introduces friction for non-technical users
- Requires synchronization mechanisms with runtime systems
- Potential latency between commit and runtime availability

---

## Alternatives Considered

### 1. Database as Source of Truth (Rejected)

Store governance artifacts in a database.

**Rejected because:**
- Weak versioning compared to Git
- Limited auditability
- Harder to integrate with developer workflows

---

### 2. Filesystem-Based Storage (Rejected)

Store artifacts in local or shared filesystem.

**Rejected because:**
- Lacks version control
- No built-in history or traceability
- Poor collaboration support

---

### 3. Hybrid Model Without Clear Authority (Rejected)

Allow both Git and runtime systems to modify artifacts.

**Rejected because:**
- Leads to drift and inconsistency
- Breaks determinism and reproducibility
- Creates conflicting sources of truth

---

## Future Considerations

- GitOps-style automation for artifact deployment
- UI layer for non-technical artifact editing (backed by Git)
- Fine-grained access control over artifacts
- Schema validation enforcement at commit time
- Integration with Canonical Knowledge System (CKS)
- Automated lineage tracking across artifact versions