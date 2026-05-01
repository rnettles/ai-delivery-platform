# System Alignment — Phase 0

## Purpose

Establish a shared, unambiguous understanding of what the UI represents across all system layers.

This document defines **system boundaries, authority, and responsibilities**.  
It is not a design specification.

---

## Core Alignment Statement

The UI is a **control plane for governed AI execution pipelines**.

- It **visualizes** execution state.
- It **exposes** available actions.
- It **submits** user intent.

The UI does **not**:
- Define execution logic
- Own state transitions
- Act as a source of truth

The API is the authoritative system boundary.

---

## System Boundary Model

External Clients
  ├── Slack / Conversational Interface
  ├── CLI
  └── UI Control Plane

        ↓

API / Execution Service
  ├── Pipeline state (authoritative)
  ├── Execution logic
  ├── Allowed actions
  ├── Lifecycle derivation
  ├── Artifact access
  └── Event history

        ↓

Persistence Layer
  ├── Pipelines
  ├── Executions
  ├── Timeline events
  ├── Artifacts
  └── State history

---

## Separation of Concepts

### 1. Pipeline Operational State (Authoritative)

Represents the **actual execution state** of a pipeline.

Examples:
- `created`
- `running`
- `awaiting_approval`
- `paused`
- `paused_takeover`
- `failed`
- `cancelled`
- `completed`

Rules:
- Owned by the API
- Persisted in the backend
- Displayed by the UI
- Drives allowed actions and system behavior
- Must not be computed or inferred by the frontend

---

### 2. Lifecycle Stage (Derived, Non-Authoritative)

Represents a **human-friendly classification** of pipeline progress.

Examples:
- `planning`
- `executing`
- `verifying`
- `awaiting_human_input`
- `complete`

Rules:
- Derived by the API or provided explicitly
- Used for grouping, filtering, and navigation
- Must not control execution logic
- Must not determine allowed actions

---

### 3. Conversational Interface (External Client)

Includes:
- Slack
- Chat-based workflows

Rules:
- Can initiate actions through the API
- Can display summarized state
- Does not own or define system state
- Is not a source of truth
- May appear in the timeline if events are persisted

---

## Source of Truth Rules

| Concern | Source of Truth | UI Responsibility |
|--------|----------------|------------------|
| Pipeline state | API | Display only |
| Valid actions | API | Render and submit |
| State transitions | API | Trigger via requests |
| Lifecycle stage | API (derived) | Display/group |
| Artifacts | API / storage | Fetch and render |
| Timeline events | API | Display chronologically |
| Logs | API | Display if exposed |
| Human approvals | API | Submit intent |
| Slack messages | External / API events | Display if persisted |
| Spec documents | External (Git/Confluence) | Reference only |

---

## Artifact Authority

Artifacts are the **primary outputs of execution**.

Examples:
- Plans (phase, sprint, task)
- Verification reports
- ADR drafts
- Generated documentation

Rules:
- Artifacts represent what the system produced
- UI must prioritize artifacts over logs
- Artifacts must be rendered based on type (Markdown, JSON, text)
- UI must not mutate artifacts
- Any editing must be governed by backend workflows

---

## UI Responsibility Boundaries

### The UI May:

- Display pipeline state and lifecycle stage
- Display timeline events
- Display artifacts and metadata
- Display available actions from the API
- Submit user actions
- Show loading, error, and stale states
- Support inspection and debugging

---

### The UI Must Not:

- Define or infer state transitions
- Compute business logic
- Determine valid actions independently
- Modify artifacts outside governed workflows
- Treat Slack as a source of truth
- Duplicate backend rules
- Resolve conflicting state locally
- Act as a spec authoring system

---

## System Principles

1. API is the single source of truth  
2. Artifacts are authoritative outputs  
3. UI is a projection layer  
4. Operational state ≠ lifecycle stage  
5. Conversation is not governance  
6. Frontend simplicity is intentional  

---

## Decisions

- UI represents execution, not logic
- API owns all state and transitions
- Artifacts are first-class and authoritative
- UI is thin and stateless in terms of business logic
- Lifecycle stage is derived and non-authoritative
- Slack is an external client
- Valid actions must come from the API
- Spec authoring remains external

---

## Open Questions

- Should lifecycle stage be explicitly returned by the API in V1?
- Should available actions be returned as an API field?
- Should Slack-originated events be part of the timeline?
- What artifact types must be supported in V1?
- Should logs be included in V1 or deferred?

---

## Exit Criteria

Phase 0 is complete when:

- UI is clearly defined as a projection layer
- API is accepted as the single source of truth
- Artifacts are recognized as authoritative outputs
- Operational state and lifecycle stage are clearly separated
- Slack is understood as an external client
- UI boundaries are agreed upon
- No stakeholder expects UI to contain business logic

---

## Completion Statement

Phase 0 establishes system alignment across all layers.

The UI will operate strictly as a control plane over governed execution pipelines, relying on the API for all authoritative state, transitions, and outputs.

All subsequent design and implementation must adhere to these boundaries.
