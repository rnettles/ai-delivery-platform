# Phase 4 — Frontend Component Architecture

## Goal

Define the **frontend architecture** for implementing the Pipeline Control Plane UI.

This document translates:
- UX specifications
- System mapping models

into:
- Component structure
- Data flow
- State management patterns

---

## Core Alignment Statement

The frontend is a **thin rendering layer** over API-driven state.

- No business logic
- No state transitions
- No duplicated rules

The frontend:
- Fetches data
- Maps data (lightly)
- Renders UI
- Sends actions

---

## Technology Stack

- Framework: Next.js (App Router)
- Data Fetching: React Query
- Styling: Tailwind (or equivalent)
- State: Server state only (minimal client state)

---

## Architecture Overview

```text
Pages (routes)
  ↓
Screens (feature containers)
  ↓
Components (UI building blocks)
  ↓
Hooks (data + API)
  ↓
API Proxy (Next.js)
  ↓
Backend API
```

---

## Folder Structure

```plaintext
/frontend
  /app
    /pipelines/[id]/page.tsx
    /api/pipelines/[id]/route.ts   ← Next.js proxy; client never calls backend directly

  /components
    /pipeline
      PipelineHeader.tsx           ← pipeline id, state, mode, last updated
      ActionBar.tsx                ← renders allowed_actions[] as buttons only
      PipelineTimeline.tsx         ← primary component
      StepGroup.tsx                ← groups events by step.name + iteration
      StepCard.tsx                 ← step header, event list, artifact badges
      EventItem.tsx                ← single event row
      GateCard.tsx                 ← first-class gate display (not nested in EventItem)
      ArtifactBadge.tsx            ← inline artifact indicator; click → SidePanel
      SidePanel.tsx                ← lazy container for artifact/event detail
      ArtifactViewer.tsx           ← content renderer inside SidePanel (md, json, text)

    /shared
      Button.tsx
      Badge.tsx

  /hooks
    usePipeline.ts                 ← fetch pipeline + full event list (combined)
    useActions.ts                  ← submit actions, reflect response

  /lib
    apiClient.ts
    queryClient.ts
    timeline-mapper.ts             ← raw events → UI timeline model (see timeline-mapping.md)

  /types
    pipeline.ts
    event.ts
    timeline.ts                    ← mapped UI model, distinct from raw event types
```

---

## Core Components

### 1. PipelineHeader

Displays:
- Pipeline ID
- State
- Lifecycle stage

Props:
```ts
{
  pipeline: Pipeline
}
```

---

### 2. ActionBar

Displays allowed actions. Renders only what `allowed_actions[]` returns — no hardcoding.

Props:
```ts
{
  actions: string[],
  onAction: (action: string) => void
}
```

---

### 3. PipelineTimeline

Primary component.

Props:
```ts
{
  steps: Step[]
}
```

---

### 4. StepGroup

Represents a step iteration.

Props:
```ts
{
  step: Step
}
```

---

### 5. StepCard

Displays step summary + children.

---

### 6. EventItem

Displays single event.

---

### 7. GateCard

Displays gate state and actions.

---

### 8. ArtifactBadge

Inline artifact indicator attached to events/steps. Click triggers SidePanel open.

---

### 9. SidePanel

Lazy container for artifact and event detail. Renders only on selection — never eagerly.

---

### 10. ArtifactViewer

Renders artifact content inside SidePanel. Type-based: Markdown, JSON, plain text.

---

## Data Flow

```text
usePipeline(id)
    ↓
React Query fetch
    ↓
API Proxy
    ↓
Backend API
    ↓
Mapped Timeline
    ↓
Components render
```

---

## Hooks

### usePipeline

Fetch pipeline including full ordered event list. Events are part of the pipeline response — no separate events endpoint. Applies `timeline-mapper.ts` before returning.

---

### useActions

Submit actions to API. Invalidates `usePipeline` query on success so timeline reflects returned events.

> **Note:** `useTimeline` was considered but removed. The event list is not a separate fetch — it is returned with the pipeline. A separate hook would imply an endpoint that does not exist.

---

## API Proxy Pattern

All frontend calls go through:

```plaintext
/api/pipelines/[id]
```

Benefits:
- Security
- Token management
- Centralized API handling

---

## State Management Rules

- Use React Query for server state
- Avoid global client state
- UI state only for:
  - selection
  - panel open/close
  - local UI interaction

---

## Action Handling

```text
User clicks action
    ↓
Call API
    ↓
Invalidate query
    ↓
Refetch timeline
    ↓
UI updates
```

---

## Loading & Error Handling

- Skeletons for loading
- Inline error states
- Retry mechanisms via React Query

---

## Constraints

- No business logic in components
- No direct API calls from components
- No hardcoded actions
- All rendering must trace to API data

---

## Anti-Patterns

- Storing pipeline state locally
- Mutating API data in UI
- Computing allowed actions in frontend
- Complex global state (Redux, etc.)

---

## Dependencies

- pipeline-detail-view.md
- timeline-mapping.md
- action-model.md

---

## Exit Criteria

- Components defined
- Data flow defined
- Hooks defined
- API proxy defined
- No business logic leakage

---

## Completion Statement

The frontend architecture ensures a clean separation between:

- system behavior
- mapping
- UX
- implementation

It enables a scalable, maintainable control plane UI.
