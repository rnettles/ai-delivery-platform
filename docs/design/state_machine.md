# State Machine Specification
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the **authoritative state machine** for the system.

It governs:

- Allowed states
- Valid transitions
- Transition triggers
- Failure handling

This prevents:
- Drift
- Invalid execution paths
- Inconsistent state

---

# 2. Core Principle

> State is controlled, not inferred.

---

# 3. States

```text
intake → planning → staging → active → validation → completed
```

---

# 4. State Definitions

## intake
- Feature/request captured
- No planning performed

## planning
- Planner generating phase/sprint artifacts

## staging
- Artifacts created but not yet executed

## active
- Tasks are being executed

## validation
- Artifacts and outputs being validated

## completed
- Work finished and validated

---

# 5. Allowed Transitions

| From | To | Allowed |
|------|----|--------|
| intake | planning | ✅ |
| planning | staging | ✅ |
| staging | active | ✅ |
| active | validation | ✅ |
| validation | completed | ✅ |

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
| intake → planning | Planner invoked |
| planning → staging | Artifacts generated |
| staging → active | Sprint execution starts |
| active → validation | Execution completes |
| validation → completed | Validation passes |

---

# 8. Failure Handling

## Rule

Failures do NOT advance state.

---

## Failure Paths

| State | Failure Action |
|------|--------------|
| planning | stay in planning |
| staging | stay in staging |
| active | remain active |
| validation | remain validation |

---

# 9. State Storage

State is stored in:

```text
project_workspace/state/
```

Files:

```text
current_state.json
current_phase.json
current_sprint.json
```

---

# 10. Example State File

```json
{
  "state": "planning",
  "phase_id": "PHASE-001",
  "updated_at": "2026-01-01T00:00:00Z"
}
```

---

# 11. Enforcement Rules

- Execution Service MUST validate transitions
- Invalid transitions MUST return error
- State changes MUST be atomic

---

# 12. Guiding Principle

> If the state machine is violated, the system is broken.
