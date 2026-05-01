# Phase 3 — Pipeline Detail View (UX Specification)

## Goal

Define the primary user interface for interacting with a single pipeline.

This view is the **central control plane surface**, enabling:
- Execution visibility
- Timeline inspection
- Artifact exploration
- Action triggering

---

## Core Alignment Statement

The Pipeline Detail View is a **projection of a single pipeline's execution state and timeline**.

- It reflects API state
- It renders mapped timeline data
- It exposes allowed actions
- It does not implement business logic

---

## View Overview

```text
Pipeline Detail View
  ├── Header (pipeline metadata + state)
  ├── Action Bar (allowed actions)
  ├── Timeline (primary focus)
  │     ├── Step Groups
  │     │     ├── Step Card
  │     │     │     ├── Events
  │     │     │     ├── Artifacts
  │     │     │     └── Gates
  └── Side Panel (artifact viewer / event details)
```

---

## Layout Structure

### 1. Header

Displays:

- Pipeline ID / Name
- Current State (authoritative)
- Lifecycle Stage (derived)
- Last Updated Timestamp

---

### 2. Action Bar

Displays:

- Allowed actions from API
- Contextual buttons:
  - Start
  - Pause
  - Resume
  - Cancel
  - Approve / Reject (gate)
  - Takeover

Rules:
- Must only render actions from `allowed_actions`
- No hardcoding

---

### 3. Timeline (Primary Component)

The timeline is the **core UX element**.

#### Structure

```text
Timeline
  ├── Step Group (Planner)
  ├── Step Group (Sprint)
  ├── Step Group (Implementer)
  ├── Step Group (Verifier)
```

---

### Step Group

Displays:

- Step name
- Iteration
- Status (derived from mapping)
- Expandable details

---

### Step Card

Each step includes:

- Step header (name, status)
- Event list (chronological)
- Artifact indicators
- Gate indicators

---

### Event Display

Each event shows:

- Timestamp
- Event type
- Message (if present)
- Actor (optional)

---

### Gate Display

Gates must be visually distinct:

- Blocking indicator (e.g., highlighted)
- Required action
- Status (waiting, approved, rejected)

---

### Artifact Indicators

- Icons or badges per event/step
- Click opens artifact viewer

---

## 4. Side Panel (Detail Viewer)

Displays:

- Artifact content (Markdown, JSON, text)
- Event details
- Metadata

Rules:
- Lazy-loaded
- Independent of timeline rendering

---

## Interaction Model

### Selection

- Clicking event → shows event detail
- Clicking artifact → opens viewer
- Clicking step → expand/collapse

---

### Actions

- Triggered from Action Bar or Gate UI
- Sent to API
- UI updates based on returned events

---

### State Handling

- Loading → skeleton UI
- Error → visible error state
- Stale data → refresh indicator

---

## UX Principles

1. Timeline-first design  
2. Artifacts over logs  
3. No hidden state  
4. Explicit system feedback  
5. Minimal cognitive load  

---

## Anti-Patterns

- Hiding events
- Combining steps artificially
- Inferring missing data
- Showing actions not allowed by API

---

## Dependencies

- timeline-event-model.md
- gate-behavior.md
- pipeline-state-machine.md
- action-model.md
- timeline-mapping.md

---

## Open Questions

- Should steps be collapsible by default?
- Should timeline auto-scroll to current step?
- How to handle large timelines?

---

## Exit Criteria

- Full pipeline visible from events
- Actions correctly rendered
- Gates clearly represented
- Artifacts accessible
- No UI logic beyond rendering/mapping

---

## Completion Statement

The Pipeline Detail View is the primary interface for interacting with governed execution.

It provides complete visibility and control while preserving strict separation from system logic.



