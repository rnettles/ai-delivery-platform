# Phase 1 — Timeline Event Model

## Goal

Define a canonical, event-driven model for representing pipeline execution over time.

This model becomes the single behavioral foundation for:
- UI timeline rendering
- API responses
- Execution observability
- Debugging
- Auditability

---

## Core Alignment Statement

A pipeline is represented as a time-ordered sequence of events.

The timeline is not inferred.  
It is explicitly recorded and returned by the API.

The UI renders the timeline.  
The API defines it.

---

## Event Model Overview

Pipeline
  └── Timeline (ordered)
        ├── Event
        ├── Event
        ├── Event
        └── Event

Each event represents a discrete, immutable fact that occurred during execution.

---

## Event Principles

1. Events are immutable
   - Once created, events are never modified
   - Corrections are new events

2. Events are append-only
   - Timeline grows over time
   - No deletion or reordering

3. Events are source of execution history
   - Timeline is the ground truth of what happened
   - Logs are secondary

4. Events drive UI
   - UI renders events directly
   - No reconstruction or inference

---

## Event Structure

{
  "event_id": "uuid",
  "pipeline_id": "uuid",
  "timestamp": "ISO-8601",
  "type": "event_type",
  "actor": {
    "type": "system | user | ai | external",
    "id": "optional"
  },
  "step": {
    "name": "planner | sprint | implementer | verifier",
    "iteration": 1
  },
  "status": "started | completed | failed | waiting | skipped",
  "metadata": {},
  "artifact_refs": [],
  "message": "optional summary"
}

---

## Event Categories

### Pipeline Lifecycle Events
- pipeline_created
- pipeline_started
- pipeline_paused
- pipeline_resumed
- pipeline_cancelled
- pipeline_completed

### Step Execution Events
- step_started
- step_completed
- step_failed
- step_retried
- step_skipped

### Gate Events
- gate_opened
- gate_waiting
- gate_approved
- gate_rejected

### Artifact Events
- artifact_created
- artifact_updated
- artifact_linked

### Human Interaction Events
- human_takeover_started
- human_takeover_ended
- manual_action_triggered

---

## Timeline Ordering Rules

- Events are strictly ordered by timestamp
- No retroactive insertion
- Parallel steps must still produce ordered events
- UI must render in API-provided order

---

## UI Rendering Rules

- Timeline is the primary UI
- Each event is a row/card
- Events grouped by step
- Status reflected visually
- Artifacts attached to events
- Human actions clearly distinguished

---

## API Responsibilities

- Generate all events
- Ensure ordering consistency
- Attach artifact references
- Provide full timeline per pipeline
- Never rely on frontend reconstruction

---

## Open Questions

- Should events include a sequence number in addition to timestamp?
- Should artifacts be embedded or referenced?
- How verbose should event messages be?

---

## Exit Criteria

- Event model fully defined
- Event types agreed upon
- API contract updated to return timeline
- UI can render full pipeline from events alone

---

## Completion Statement

The Timeline Event Model defines the canonical representation of execution.

All system layers must align to this model before further UX or frontend work proceeds.
