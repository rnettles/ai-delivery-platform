# Phase 1C — Pipeline State Machine

## Goal

Define the authoritative **state machine** governing pipeline execution.

This model defines:
- Valid pipeline states
- Allowed transitions
- Interaction with gates
- Deterministic execution behavior

---

## Core Alignment Statement

The pipeline state machine is the **single source of truth for execution validity**.

- It defines what *can happen*
- It constrains all transitions
- It must align with:
  - Timeline Event Model
  - Gate Behavior Model

The API enforces this state machine.

---

## State Model

### Core Pipeline States

- created
- running
- awaiting_approval
- paused
- paused_takeover
- failed
- cancelled
- completed

---

## State Definitions

### created
Pipeline exists but has not started execution.

### running
Pipeline is actively executing steps.

### awaiting_approval
Execution is blocked on a human approval gate.

### paused
Execution is paused by system or user (non-gate).

### paused_takeover
Execution is paused due to human takeover.

### failed
Execution terminated due to failure.

### cancelled
Execution manually terminated.

### completed
Execution successfully finished.

---

## State Transition Rules

```text
created → running

running → awaiting_approval
running → paused
running → failed
running → completed

awaiting_approval → running
awaiting_approval → cancelled

paused → running
paused → cancelled

paused_takeover → running
paused_takeover → cancelled

running → cancelled
```

---

## Gate Interaction

- Gates can force transition into:
  - awaiting_approval
  - paused_takeover

- Gate resolution triggers:
  - awaiting_approval → running
  - paused_takeover → running

- No implicit transitions allowed

---

## Transition Principles

1. All transitions must be explicit
2. No hidden or inferred transitions
3. Every transition must produce an event
4. Invalid transitions must be rejected by API
5. UI must not assume transitions

---

## Event Alignment

Each transition must emit corresponding events:

- running → awaiting_approval → gate_waiting
- awaiting_approval → running → gate_approved
- running → failed → step_failed or pipeline_failed
- running → completed → pipeline_completed

---

## UI Responsibilities

- Display current state
- Display transition history via events
- Render allowed actions based on API
- Never compute or infer state

---

## API Responsibilities

- Enforce valid transitions
- Reject invalid transitions
- Emit events for all transitions
- Maintain state consistency

---

## Open Questions

- Should we separate step-level vs pipeline-level states?
- Should retries create new state transitions or reuse existing?
- Should we support partial completion states?

---

## Exit Criteria

- All states defined
- All transitions defined
- Gate interactions defined
- Event alignment defined
- API contract enforceable

---

## Completion Statement

The pipeline state machine defines the deterministic execution boundaries of the system.

All execution must adhere to these rules to ensure:
- Predictability
- Observability
- Auditability
