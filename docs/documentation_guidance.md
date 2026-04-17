# Documentation Guidance
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines how documentation should be structured, maintained, and evolved for the AI-driven orchestration system.

The goal is to ensure:
- Clarity of ownership
- No duplication of concepts
- Strong alignment with governance
- Long-term maintainability

---

# 2. Core Principles

## 2.1 One Concept = One Document
Each concept should have a single authoritative document.

Avoid:
- Re-explaining architecture in multiple places
- Duplicating execution logic across documents

---

## 2.2 Separate Concerns

| Layer | Purpose |
|------|--------|
| PRD | Why we are building the system |
| Architecture | How the system is structured |
| Design | How the system behaves internally |
| Functional Requirements | What the system must do |
| Roadmap | How the system will be built |
| ADR | Why decisions were made |
| Features | How the system evolves |

---

## 2.3 Governance is Source of Truth

- All rules, prompts, templates live in Git (`ai_guidance`)
- Documentation must reference governance, not redefine it
- n8n and Postgres should never duplicate governance logic

---

## 2.4 Deterministic First

Documentation should reflect:
- deterministic execution where possible
- LLM usage only where reasoning is required

---

# 3. Recommended Documentation Structure

```
docs/
├── prd/
│   └── prd.md
│
├── architecture/
│   └── system_overview.md
│
├── design/
│   ├── execution_model.md
│   └── governance_manifest.md
│
├── functional_requirements/
│   └── functional_requirements.md
│
├── roadmap/
│   └── implementation_plan.md
│
├── adr/
│   ├── adr-001-git-as-source-of-truth.md
│   ├── adr-002-artifact-driven-state.md
│   ├── adr-003-deterministic-over-llm.md
│   └── adr-004-governance-first-architecture.md
│
├── features/
│   ├── feature-<name>.md
│   └── index.md
```

---

# 4. Document Responsibilities

## 4.1 PRD
“The business intent and value promise of the system”

Defines:
- Purpose
- Goals
- Scope
- Users

---

## 4.2 Architecture
“The rules of the system’s shape and boundaries”

Defines:
- System layers
- High-level flows
- Responsibilities of each component

---

## 4.3 Design (Execution Model)
“How the system moves and behaves over time”

Defines:
- Role contracts (Planner, Sprint Controller)
- State model
- Artifact model
- Validation model
- Execution pattern

---

## 4.4 Functional Requirements
“The non-negotiable capabilities the system must satisfy”

Defines:
- System behaviors as “System SHALL…” statements
- No implementation details
- No architectural duplication

---

## 4.5 Roadmap
“The order in which the system becomes real”

Defines:
- Phases
- Deliverables
- Exit criteria

---

## 4.6 ADR (Architecture Decision Records)
“The memory of why the system is the way it is”

Defines:
- Key design decisions
- Rationale
- Tradeoffs

Each ADR should answer:
- What decision was made?
- Why was it made?
- What alternatives were considered?

---

## 4.7 Features
“A coordinated change across multiple system truths”

Defines:
- A specific system enhancement or capability
- The areas of the system impacted
- The required updates across documentation layers

Features DO NOT:
- Redefine architecture
- Duplicate requirements
- Introduce new system truths independently

Instead, features:
- Reference existing documents
- Identify required changes
- Coordinate updates across layers

---

# 5. Governance Manifest
“The runtime contract that binds orchestration to governance”

The Governance Manifest is a **contract document**, not an explanation document.

It defines:
- Role configurations
- Prompts
- Templates
- Validation rules
- State transitions

It must:
- Be version-controlled
- Be loaded at runtime
- Not be duplicated elsewhere

---

# 6. Feature Documentation Model

## 6.1 Purpose of Feature Documents

Feature documents act as **coordination artifacts**, not sources of truth.

They exist to:
- Track system evolution
- Identify impacted areas
- Guide consistent updates across layers

---

## 6.2 Feature Structure

Each feature should follow this structure:

```
# Feature: <Feature Name>

## Summary
Brief description of the feature

---

## Impacted Areas

### PRD
- <what changes>

### Architecture
- <what changes>

### Design (Execution Model)
- <what changes>

### Governance Manifest
- <what changes>

### Functional Requirements
- <what changes>

### Roadmap
- <phase or sequencing impact>

### ADR
- <new or updated decision>

---

## Dependencies
- <required prior capabilities>

---

## Notes
- Constraints, assumptions, or considerations
```

---

## 6.3 Feature Lifecycle

1. Create Feature Document
2. Identify impacted layers
3. Update authoritative documents:
   - PRD
   - Architecture
   - Execution Model
   - Governance Manifest
   - Functional Requirements
4. Add ADR if needed
5. Update Roadmap
6. Implement

---

## 6.4 Source of Truth Rule

> Feature documents are NOT the source of truth.  
> System documents are the source of truth.

---

# 7. Avoiding Common Problems

## 7.1 Duplication
If you find yourself copying content between documents:
→ STOP and refactor

---

## 7.2 Blurring Layers
Do not mix:
- Architecture with execution details
- Requirements with implementation

---

## 7.3 Hidden Logic
Do not embed logic in:
- n8n workflows
- documentation prose

All logic must exist in:
- governance (Git)
- deterministic scripts

---

## 7.4 Feature Drift
Do not allow features to become:
- standalone design documents
- alternate sources of truth

Features must always:
- point to system documents
- update system documents

---

# 8. Evolution Strategy

As the system evolves:

- Add new roles to execution_model.md
- Extend governance_manifest.md
- Add ADRs for major decisions
- Update roadmap, not architecture, for sequencing changes
- Use feature documents to coordinate all cross-layer changes

---

# 9. Summary

This documentation system ensures:

- Clear separation of concerns
- Single source of truth
- Strong governance alignment
- Controlled system evolution
- Feature-driven development without architectural drift

---

# 10. Guiding Rule

> Adapt orchestration to governance — never governance to orchestration

> Features describe change — system documents define truth
