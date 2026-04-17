# Detailed Execution Contracts
## Planner, Sprint Controller, and Core Orchestration Roles

---

# 1. Overview

This document expands the Functional Requirements into **detailed execution contracts** for each role in the governed AI orchestration system.

These contracts define:

- Inputs
- Deterministic responsibilities
- LLM responsibilities
- Outputs
- Validation rules
- State transitions

---

# 2. Core Execution Pattern

State → Role Invocation → Artifact Change → Validation → State Transition

---

# 3. Planner Execution Contract

## Purpose
Transform a request into structured planning artifacts:
- Phase
- Sprint Plan

---

## Inputs

### Deterministic Inputs
- Request text (Slack)
- Governance manifest
- Planner prompt (`ai_guidance/prompts/planner.md`)
- Planner rules (`ai_guidance/rules/planner_rules.md`)
- Templates:
  - Phase template
  - Sprint plan template
- Relevant governance artifacts (architecture, requirements)

---

## Deterministic Responsibilities

- Normalize request
- Load templates
- Build structured prompt
- Define output file paths
- Render final markdown from structured output
- Persist artifacts to Git
- Validate structure

---

## LLM Responsibilities

- Interpret request
- Generate structured JSON:

```
{
  "phase": {...},
  "sprint_plan": {...}
}
```

---

## Outputs

- `/docs/phases/{phase_id}.md`
- `/docs/sprints/{sprint_id}.md`

---

## Validation

### Level 1
- Phase file exists
- Sprint plan file exists
- Required sections present

---

## State Transition

- on_success → `ready_for_staging`
- on_failure → `planning_failed`

---

# 4. Sprint Controller Execution Contract

## Purpose
Convert Sprint Plan into staged task artifacts

---

## Inputs

### Deterministic Inputs
- Sprint Plan artifact
- Governance manifest
- Sprint controller prompt
- Sprint controller rules
- Task templates

---

## Deterministic Responsibilities

- Load Sprint Plan
- Resolve output paths
- Create task files
- Render templates
- Persist artifacts
- Validate outputs

---

## LLM Responsibilities

- Generate structured task definitions:

```
{
  "tasks": [...]
}
```

---

## Outputs

- `/project_tasks/{sprint_id}/{task_id}.md`

---

## Validation

### Level 1
- At least one task exists
- Task files follow structure

---

## State Transition

- on_success → `awaiting_staging_approval`
- on_failure → `staging_failed`

---

# 5. Validation Contract

## Purpose
Ensure artifact integrity before state transitions

---

## Deterministic Responsibilities

- File existence checks
- Section presence validation
- Naming convention validation

---

## Future Extensions

- Rule-based validation
- Schema validation
- Semantic validation

---

# 6. Human Approval Contract

## Purpose
Introduce governance-controlled decision boundary

---

## Inputs
- Staged task artifacts
- Workflow state

---

## Actions

- approve
- reject
- request_revision

---

## Outputs

- Updated workflow state

---

## State Transition

- approve → `approved`
- reject → `rejected`
- revision → `planning` or `staging`

---

# 7. Orchestration Contract (n8n)

## Purpose
Execute governed workflows without embedding logic

---

## Responsibilities

- Load governance manifest
- Resolve role configuration
- Build execution contract
- Invoke LLM
- Call deterministic scripts
- Validate outputs
- Transition state
- Pause for human interaction

---

## Non-Responsibilities

- Defining business logic
- Defining validation rules
- Defining artifact structure

---

# 8. Execution Contract Object

```
{
  "workflow_id": "...",
  "role": "...",
  "context_refs": [...],
  "governance_refs": {...},
  "expected_outputs": [...]
}
```

---

# 9. Key Design Guarantees

- Artifact-driven state
- Deterministic validation
- Governance-first execution
- Human/AI interchangeability
- No duplication of rules

---

# 10. Summary

These execution contracts:

- Translate Functional Requirements into implementable units
- Preserve governance system integrity
- Enable deterministic orchestration
- Bound LLM responsibilities
- Create a scalable foundation for future roles
