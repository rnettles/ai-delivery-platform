# Planner + Sprint Controller Execution Contract

## Overview
This document defines the execution contract for the Planner and Sprint Controller roles within the governed AI orchestration system.

---

## Core Principle
- Governance rules live in Git (`ai_guidance`)
- n8n orchestrates execution
- Postgres tracks runtime state
- LLM performs bounded reasoning only

---

## Execution Pattern
State → Role Invocation → Artifact Change → Validation → State Transition

---

# Planner Contract

## Responsibility
- Interpret request
- Produce Phase artifact
- Produce Sprint Plan artifact

## Inputs
- Request text
- Governance prompts
- Rulesets
- Templates

## Outputs
- Phase artifact
- Sprint Plan artifact

## LLM Role
- Fill structured JSON for Phase and Sprint Plan

## Deterministic Responsibilities
- Load templates
- Render artifacts
- Validate structure
- Persist to Git

---

# Sprint Controller Contract

## Responsibility
- Consume Sprint Plan
- Stage tasks according to governance

## Inputs
- Sprint Plan artifact
- Task templates
- Governance rules

## Outputs
- Staged task artifacts

## LLM Role
- Generate structured task definitions

## Deterministic Responsibilities
- Render task templates
- Validate artifacts
- Persist to Git

---

# Validation Strategy

## Level 1 (Phase 1)
- File existence
- Required sections present

## Level 2 (Future)
- Governance rule validation

## Level 3 (Future)
- Semantic validation

---

# State Transitions

## Planner
received → planning → phase_created → sprint_plan_created

## Sprint Controller
ready_for_staging → tasks_staged → awaiting_staging_approval

---

# Execution Contract Object

```json
{
  "workflow_id": "...",
  "role": "planner | sprint_controller",
  "context_refs": {},
  "governance_refs": {},
  "expected_outputs": []
}
```

---

# Key Design Rules

- Git is source of truth
- Postgres is runtime only
- n8n does not define logic
- Validation gates transitions
- Artifacts drive state

---

# Summary

This contract ensures:
- No duplication of governance logic
- Strong anti-drift protection
- Hybrid human/AI execution
- Deterministic orchestration
