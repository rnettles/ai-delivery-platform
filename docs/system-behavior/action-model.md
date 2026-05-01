# Phase 1D — Action Model

## Goal

Define the canonical **action model** that governs how external actors (UI, Slack, CLI) 
can interact with the pipeline system.

This model defines:
- What actions exist
- Who can perform them
- When they are valid
- What they trigger (state transitions + events)

---

## Core Alignment Statement

Actions are the **only mechanism** by which external actors influence pipeline execution.

- Actions do not directly change state
- Actions request intent from the API
- The API validates actions against the state machine
- Valid actions produce state transitions and events

---

## Action Model Overview

```text
Actor → Action → API Validation → State Transition → Event(s)
```

---

## Action Structure

```json
{
  "action_type": "string",
  "pipeline_id": "uuid",
  "actor": {
    "type": "user | system | ai | external",
    "id": "optional"
  },
  "payload": {},
  "timestamp": "ISO-8601"
}
```

---

## Core Action Types

### 1. Execution Control Actions

- start_pipeline
- pause_pipeline
- resume_pipeline
- cancel_pipeline

---

### 2. Gate Actions

- approve_gate
- reject_gate
- request_changes
- resolve_validation

---

### 3. Human Takeover Actions

- start_takeover
- end_takeover

---

### 4. Step Control Actions (Optional / Advanced)

- retry_step
- skip_step

---

## Action → State Mapping

| Action | Current State | Resulting State |
|--------|--------------|----------------|
| start_pipeline | created | running |
| pause_pipeline | running | paused |
| resume_pipeline | paused | running |
| cancel_pipeline | any active | cancelled |
| approve_gate | awaiting_approval | running |
| reject_gate | awaiting_approval | cancelled or running |
| start_takeover | running | paused_takeover |
| end_takeover | paused_takeover | running |

---

## Validation Rules

1. Actions must be validated by the API
2. Invalid actions must be rejected
3. UI must not assume action validity
4. API must return allowed actions per state

---

## Allowed Actions Contract

The API should return:

```json
{
  "pipeline_id": "uuid",
  "state": "running",
  "allowed_actions": [
    "pause_pipeline",
    "cancel_pipeline",
    "start_takeover"
  ]
}
```

Rules:
- UI renders only allowed actions
- UI must not hardcode action availability
- API remains authoritative

---

## Event Emission

Every successful action must result in events.

Examples:

- start_pipeline → pipeline_started
- approve_gate → gate_approved
- pause_pipeline → pipeline_paused
- start_takeover → human_takeover_started

---

## UI Responsibilities

- Display allowed actions
- Submit actions to API
- Reflect results via timeline events
- Never execute logic locally

---

## API Responsibilities

- Validate actions against state machine
- Enforce gate rules
- Emit events
- Update pipeline state
- Return allowed actions

---

## Open Questions

- Should actions be idempotent?
- Should actions include versioning?
- Should failed actions produce events?

---

## Exit Criteria

- Action types defined
- Action → state mapping defined
- API contract includes allowed_actions
- UI can operate entirely from allowed actions

---

## Completion Statement

The Action Model defines how external intent interacts with the governed execution system.

It ensures:
- Deterministic behavior
- Safe interaction boundaries
- Clear UI ↔ API contract
