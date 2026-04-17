# Product Requirements Document (PRD)
## Governed AI Software Development Orchestration System

---

## 1. Purpose

Design and implement a **governed orchestration layer** that enables hybrid AI/Human software development while preserving architectural integrity and preventing AI drift.

This system **extends** (not replaces) the existing AI Governance system located in:

```
\ai_dev_stack\ai_guidance
```

---

## 2. Core Principles

- Governance is authoritative and lives in Git
- Orchestration adapts to governance, not vice versa
- State is artifact-driven
- AI operates within bounded roles
- Humans remain approval authorities at key boundaries

---

## 3. System Scope (Phase 1)

### In Scope
- Slack-based request intake
- Planner execution (Phase + Sprint Plan)
- Sprint Controller execution (task staging)
- Artifact-driven validation
- Human approval checkpoints
- Runtime tracking via Postgres

### Out of Scope
- Implementation automation
- Verifier/fixer loops
- Governance redesign

---

## 4. Users

- Product Owner / Architect
- Developers (VSCode-based workflow)
- AI Roles (Planner, Sprint Controller)

---

## 5. Integration with AI Governance System

The system will:

- Load prompts from:
  - `ai_guidance/prompts/`
- Load rules from:
  - `ai_guidance/rules/`
- Load templates from:
  - `ai_guidance/templates/`
- Produce artifacts into:
  - `docs/phases/`
  - `docs/sprints/`
  - `project_tasks/`

---

## 6. Success Criteria

- Planner produces valid Phase + Sprint Plan artifacts
- Sprint Controller produces valid staged task artifacts
- All transitions are governed by artifact validation
- Human/AI execution is interchangeable
- No duplication of governance logic in orchestration layer
