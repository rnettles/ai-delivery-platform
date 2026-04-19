# Execution Model
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the **execution model** for the governed AI orchestration system.

It specifies:

- How work flows through the system
- How roles operate
- How artifacts drive state
- How validation enforces governance
- How human and AI execution interoperate

This is the **authoritative behavioral design document**.

---

# 2. Core Execution Principle

> State → Role Invocation → Artifact Change → Validation → State Transition

---

# 3. System Execution Layers

## 3.1 Governance Layer (Git)

Source of truth for:
- Prompts
- Rules
- Templates
- Artifact definitions
- Role responsibilities

---

## 3.2 Orchestration Layer (n8n)

Responsible for:
- Workflow execution
- Role invocation
- State transitions
- Coordination

NOT responsible for:
- Business logic
- Governance rules

---

## 3.3 Runtime State Layer (Postgres)

Stores:
- Workflow instances
- Current state
- Execution logs
- Artifact references

---

## 3.4 Reasoning Layer (LLM)

Responsible for:
- Interpretation
- Content generation
- Structured outputs

Bounded by governance.

---

# 4. State Model

## 4.1 State Definition

States represent **verified system conditions**, not actions.

---

## 4.2 Core States (Phase 1)

- received
- planning
- phase_created
- sprint_plan_created
- ready_for_staging
- tasks_staged
- awaiting_staging_approval
- approved
- rejected
- failed

---

## 4.3 State Rules

- State must be derivable from artifacts
- State transitions require validation
- State cannot advance without evidence

---

# 5. Artifact Model

## 5.1 Artifact Types

- Phase
- Sprint Plan
- Task

---

## 5.2 Artifact Properties

- Stored in Git
- Version-controlled
- Structured via templates
- Referenced by Postgres

---

## 5.3 Artifact Locations

- Phase: docs/phases/
- Sprint Plan: docs/sprints/
- Tasks: project_tasks/

---

# 6. Role Execution Model

---

## 6.1 Planner Role

### Purpose
Convert request into structured planning artifacts.

---

### Inputs
- Request
- Governance rules
- Templates
- Context artifacts

---

### Outputs
- Phase artifact
- Sprint Plan artifact

---

### LLM Responsibilities
- Interpret request
- Generate structured JSON

---

### Deterministic Responsibilities
- Render templates
- Validate structure
- Persist artifacts

---

### Validation
- Phase exists
- Sprint Plan exists
- Required sections present

---

### Transition
- success → ready_for_staging
- failure → failed

---

## 6.2 Sprint Controller Role

### Purpose
Convert Sprint Plan into executable tasks.

---

### Inputs
- Sprint Plan
- Governance rules
- Templates

---

### Outputs
- Task artifacts

---

### LLM Responsibilities
- Generate structured task definitions

---

### Deterministic Responsibilities
- Render task templates
- Persist artifacts
- Validate outputs

---

### Validation
- Tasks exist
- Tasks follow structure

---

### Transition
- success → awaiting_staging_approval
- failure → failed

---

# 7. Validation Model

---

## 7.1 Levels

### Level 1 (Phase 1)
- File existence
- Required sections

---

### Level 2 (Future)
- Governance rule enforcement

---

### Level 3 (Future)
- Semantic validation

---

## 7.2 Validation Rule

> No state transition without validation success

---

# 8. Execution Contract

Each role execution uses a structured contract:

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

# 9. Human Interaction Model

---

## 9.1 Approval Points

- After task staging

---

## 9.2 Actions

- approve
- reject
- request_revision

---

## 9.3 Rule

> Human approval is required before execution proceeds beyond staging

---

# 10. Hybrid Execution Model

---

## 10.1 AI Execution

n8n submits canonical execution request → Execution Service runs governed role/script (including any internal LLM usage) → artifacts created → validated

---

## 10.2 Human Execution

Human modifies artifacts → commits → system validates → state advances

---

## 10.3 Key Rule

> Execution source does not matter. Only validated outcomes matter.

---

# 11. Error Handling

---

## 11.1 Failure Conditions

- Missing artifacts
- Validation failure
- LLM output invalid

---

## 11.2 Behavior

- Pause workflow
- Log error
- Require intervention or retry

---

# 12. Deterministic vs LLM Responsibilities

---

## Deterministic
- Templates
- Validation
- State transitions
- File operations

---

## LLM
- Interpretation
- Content generation

---

# 13. Key Design Guarantees

- No duplication of governance logic
- Artifact-driven execution
- Deterministic validation
- Human/AI interchangeability
- Reproducible workflows

---

# 14. Summary

This execution model ensures:

- Governance is always enforced
- AI is bounded and controlled
- System state is reliable and auditable
- Workflows are scalable and extensible

---

# 15. Guiding Principle

> The system does not trust actions — it trusts validated state.
