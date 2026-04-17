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
```

---

# 4. Document Responsibilities

## 4.1 PRD
Defines:
- Purpose
- Goals
- Scope
- Users

---

## 4.2 Architecture
Defines:
- System layers
- High-level flows
- Responsibilities of each component

---

## 4.3 Design (Execution Model)
Defines:
- Role contracts (Planner, Sprint Controller)
- State model
- Artifact model
- Validation model
- Execution pattern

---

## 4.4 Functional Requirements
Defines:
- System behaviors as “System SHALL…” statements
- No implementation details
- No architectural duplication

---

## 4.5 Roadmap
Defines:
- Phases
- Deliverables
- Exit criteria

---

## 4.6 ADR (Architecture Decision Records)
Defines:
- Key design decisions
- Rationale
- Tradeoffs

Each ADR should answer:
- What decision was made?
- Why was it made?
- What alternatives were considered?

---

# 5. Governance Manifest

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

# 6. Avoiding Common Problems

## 6.1 Duplication
If you find yourself copying content between documents:
→ STOP and refactor

---

## 6.2 Blurring Layers
Do not mix:
- Architecture with execution details
- Requirements with implementation

---

## 6.3 Hidden Logic
Do not embed logic in:
- n8n workflows
- documentation prose

All logic must exist in:
- governance (Git)
- deterministic scripts

---

# 7. Evolution Strategy

As the system evolves:

- Add new roles to execution_model.md
- Extend governance_manifest.md
- Add ADRs for major decisions
- Update roadmap, not architecture, for sequencing changes

---

# 8. Summary

This documentation system ensures:

- Clear separation of concerns
- Single source of truth
- Strong governance alignment
- Scalable design evolution

---

# 9. Guiding Rule

> Adapt orchestration to governance — never governance to orchestration
