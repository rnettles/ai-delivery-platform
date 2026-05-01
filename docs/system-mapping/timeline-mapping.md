# Phase 2 — Timeline Mapping Model

## Goal

Define how the **Timeline Event Model (system-behavior)** is transformed into a **UI representation**.

This document acts as the bridge between:
- system-behavior (truth)
- ux (experience)
- frontend (implementation)

---

## Core Alignment Statement

The timeline mapping layer translates **raw execution events** into **structured UI-ready data**.

- No business logic is introduced
- No state transitions are inferred
- Only transformation and grouping occurs

---

## Mapping Overview

```text
API Timeline Events
        ↓
Mapping Layer (transform + group)
        ↓
UI Timeline Model
        ↓
Rendered Components
```

---

## Input: Raw Event Model

Events come from API as:

{
  "event_id": "uuid",
  "timestamp": "ISO-8601",
  "type": "event_type",
  "step": { "name": "planner", "iteration": 1 },
  "status": "started | completed | failed",
  "artifact_refs": [],
  "message": ""
}

---

## Output: UI Timeline Model

```json
{
  "steps": [
    {
      "step_name": "planner",
      "iteration": 1,
      "status": "completed",
      "events": [],
      "artifacts": [],
      "gates": []
    }
  ]
}
```

---

## Mapping Responsibilities

### 1. Event → Step Grouping

- Group events by:
  - step.name
  - step.iteration

Rules:
- Order must match API timeline
- No reordering allowed

---

### 2. Step Status Derivation

Derived from latest event in group:

| Event Status | Step Status |
|--------------|------------|
| started | in_progress |
| completed | completed |
| failed | failed |
| waiting | blocked |

---

### 3. Gate Mapping

Events with type `gate_*` become:

```json
{
  "gate": {
    "type": "approval",
    "status": "waiting",
    "required_action": "approve_gate"
  }
}
```

Rules:
- Gates must be visually distinct
- Only one active gate per step

---

### 4. Artifact Mapping

From `artifact_refs`:

- Attach artifacts to:
  - event
  - step summary (optional aggregation)

Rules:
- Do not fetch artifact content here
- Only map references

---

### 5. Human Action Mapping

Events:
- human_takeover_started
- manual_action_triggered

Mapped to:
- timeline markers
- action indicators

---

## UI Model Structure

```json
{
  "pipeline": {
    "id": "uuid",
    "state": "running"
  },
  "timeline": {
    "steps": [],
    "current_step": {},
    "active_gate": {}
  }
}
```

---

## Constraints

- Mapping must be deterministic
- No hidden logic
- No mutation of original data
- No inference of missing events
- All UI state must be explainable via events

---

## Anti-Patterns (Do Not Do)

- Inferring step completion without event
- Reordering events for UX preference
- Combining unrelated steps
- Injecting synthetic events

---

## API Dependencies

The mapping layer assumes:

- Ordered event list
- Complete event history
- Artifact references present
- Gate events explicitly defined

---

## UI Responsibilities (Post-Mapping)

- Render timeline
- Render step cards
- Render gate states
- Render artifacts
- Display allowed actions (from API)

---

## Open Questions

- Should mapping live server-side or client-side?
- Should step summaries be precomputed by API?
- How to handle very large timelines?

---

## Exit Criteria

- Mapping rules fully defined
- UI can render timeline from mapped data
- No UI logic required beyond rendering
- All behavior traceable to system-behavior layer

---

## Completion Statement

The Timeline Mapping Model ensures a clean separation between:
- system truth
- UI representation

It enables a deterministic, scalable UI without duplicating logic from the backend.
