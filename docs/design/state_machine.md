# Lifecycle Model Specification
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the lifecycle progression model used by orchestration and execution.

It governs:

- Allowed lifecycle stages
- Valid stage transitions
- Transition triggers
- Failure handling

This prevents invalid execution paths and ambiguity in derived status views.

---

# 2. Core Principle

> Lifecycle status is derived from authoritative artifacts and execution records.

---

# 3. Lifecycle Stages

```text
intake -> planning -> staging -> active -> validation -> completed
```

---

# 4. Stage Definitions

## intake
- Feature/request captured
- No planning artifacts finalized

## planning
- Planner generating phase/sprint artifacts

## staging
- Artifacts exist and are ready for execution

## active
- Tasks are being executed

## validation
- Outputs and artifacts are under validation

## completed
- Work is finished and validated

---

# 5. Allowed Transitions

| From | To | Allowed |
|------|----|--------|
| intake | planning | Yes |
| planning | staging | Yes |
| staging | active | Yes |
| active | validation | Yes |
| validation | completed | Yes |

---

# 6. Invalid Transitions

| From | To | Reason |
|------|----|-------|
| intake | active | Skips planning |
| planning | completed | Skips execution |
| active | planning | Regression not allowed |
| validation | intake | Invalid reset |

---

# 7. Transition Triggers

| Transition | Trigger |
|-----------|--------|
| intake -> planning | Planner execution accepted |
| planning -> staging | Required planning artifacts validated |
| staging -> active | Sprint/task execution starts |
| active -> validation | Execution completes |
| validation -> completed | Validation passes |

---

# 8. Failure Handling

Rule:

Failures do not advance lifecycle stage.

| Stage | Failure Action |
|------|--------------|
| planning | stay in planning |
| staging | stay in staging |
| active | remain active |
| validation | remain validation |

---

# 9. Derivation Sources

Lifecycle stage must be derived from:

- Artifact set and validation status
- ExecutionRecords and terminal outcomes

Non-authoritative snapshot files may exist for convenience, but they must be reconstructable from authoritative sources.

---

# 10. Example Derived Snapshot (Optional)

```json
{
  "stage": "planning",
  "phase_id": "PHASE-001",
  "updated_at": "2026-01-01T00:00:00Z",
  "derived_from": {
    "artifacts": ["/project_workspace/artifacts/phases/PHASE-001.md"],
    "execution_ids": ["exec-001"]
  }
}
```

---

# 11. Enforcement Rules

- Execution Service must validate transition eligibility before finalizing stage-changing artifacts
- Invalid transitions must return structured errors
- Derived lifecycle projections must be reproducible from artifacts and records

---

# 12. Guiding Principle

> If lifecycle progression cannot be reproduced from artifacts and records, the system is invalid.