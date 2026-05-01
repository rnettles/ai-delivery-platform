# Governed AI Delivery Platform — UI/UX & System Design (V1)

---

# 1. Overview

This document captures the current design of the Governed AI Delivery Platform as it evolves from a CLI-driven system into a structured UI-based control plane.

The system enables:

- Spec-driven software development
- Governed AI execution pipelines
- Human-in-the-loop control
- Full traceability from intent → execution → artifacts

---

# 2. System Architecture

## 2.1 Core Layers

```
Postgres (State)
    ↓
Execution API (Control + Orchestration)
    ↓
UI Control Plane (Visibility + Interaction)
```

---

## 2.2 Responsibilities by Layer

### Database (Postgres)

Stores:
- Pipeline state
- Execution records
- Project metadata
- Coordination entries

Does NOT handle:
- Business logic
- Workflow decisions
- Derived UI state

---

### API Layer (Execution Service)

Responsibilities:
- Enforce pipeline state machine
- Execute roles (Planner, Sprint Controller, etc.)
- Validate transitions
- Manage artifacts
- Expose HTTP endpoints

Principle:
> API is the single source of execution truth

---

### UI Layer (Control Plane)

Responsibilities:
- Display pipeline state
- Provide control actions (approve, retry, etc.)
- Visualize execution flow
- Surface artifacts and outputs

Constraints:
- No business logic
- No state transitions
- No validation logic

Principle:
> UI is a control surface, not an execution engine

---

# 3. Core Domain Model

## 3.1 Project

Represents execution context.

Fields:
- project_id
- name
- repo_url
- default_branch
- slack_channel_id

Concept:
```
Project = Git Repository + Slack Context + Execution Scope
```

---

## 3.2 Pipeline

Represents a governed execution workflow.

Lifecycle:
- running
- awaiting_approval
- failed
- complete
- paused_takeover
- cancelled

Contains:
- steps (role executions)
- artifacts
- execution references

---

## 3.3 Execution

Represents a single role/script run.

Contains:
- execution_id
- target (role/script)
- input/output
- artifacts
- status
- timing data

---

## 3.4 Artifact

Represents system output.

Examples:
- Phase Plan
- Sprint Plan
- Task definitions
- Verification results

Principle:
> Artifacts are the source of truth

---

# 4. UX Architecture

---

## 4.1 Design Philosophy

The UI is:

- A **control plane**
- A **timeline of execution**
- A **debugging and inspection tool**

NOT:
- A document editor
- A CRUD dashboard
- A replacement for Confluence

---

## 4.2 UX Layers

```
[ External Spec Layer ]
(PRD, ADR, FR, TDN)
        ↓
[ Execution Layer (API) ]
        ↓
[ UI Control Plane ]
```

---

## 4.3 Core UX Surfaces

---

### 1. Project Context

Global selector:

```
[ Project: adp-dryrun ▼ ]
```

Controls:
- active repository
- pipeline scope
- Slack context

---

### 2. Pipeline List

Displays:
- pipelines for current project
- status indicators

Example:

```
pipe-123   running
pipe-124   failed
pipe-125   awaiting_approval
```

---

### 3. Pipeline Detail (Primary View)

The most important UI surface.

---

#### Layout

```
[ Header ]
- Pipeline ID
- Status
- Current Step

--------------------------------

[ LEFT: Timeline ]
- Step Cards (Planner → Sprint → Implementer → Verifier)

[ RIGHT: Detail Panel ]
- Artifacts
- Execution Output
- Logs
- Metadata

--------------------------------

[ Actions ]
- Approve
- Retry
- Skip
- Takeover
- Cancel
```

---

#### Timeline Model

Each step is a structured card:

```
[Planner] ✅ Complete
  → Phase Plan Artifact

[Sprint Controller] ✅ Complete
  → Task Artifacts

[Implementer] 🔄 Running

[Verifier] ⏳ Pending
```

---

### 4. Artifact Viewer

Displays:
- JSON artifacts (formatted)
- Text artifacts
- Plans and outputs

---

# 5. State Model

```ts
type PipelineStatus =
  | "running"
  | "awaiting_approval"
  | "failed"
  | "complete"
  | "paused_takeover"
  | "cancelled";
```

---

## 5.1 State Behavior

### running
- Highlight active step
- Disable actions

### awaiting_approval
- Show Approve CTA
- Enable Takeover / Skip

### failed
- Highlight failed step
- Show error
- Enable Retry

### paused_takeover
- Show manual control indicator
- Disable automation

### complete
- Show success state
- Enable inspection

### cancelled
- Show terminated state
- Disable actions

---

# 6. Data Flow

```
UI Component
    ↓
API Hook
    ↓
Next.js API Route (proxy)
    ↓
Execution Service
    ↓
Postgres
```

---

# 7. Security Model

- UI NEVER calls Execution Service directly
- All requests go through server-side proxy
- API keys remain server-side

---

# 8. Current Workflow (Pre-UI)

```
CLI → pipeline-create
    ↓
Execution Service
    ↓
Slack notifications
```

Limitations:
- poor visibility
- unstructured logs
- no control surface
- difficult debugging

---

# 9. UI Goal (V1)

Replace:

> Slack timeline + CLI friction

With:

> Structured pipeline timeline + control interface

---

# 10. Out of Scope (V1)

The UI will NOT:

- author PRDs or ADRs
- manage Confluence
- parse documents
- replace ChatGPT workflows

---

# 11. Future Direction

---

## 11.1 Spec Integration (Future)

Eventually:

```
PRD → Structured Input → Pipeline Execution
```

UI may support:
- spec browsing
- execution mapping
- validation readiness

---

## 11.2 Real-Time Updates

Future:
- WebSockets (Azure SignalR)

Current:
- polling

---

## 11.3 Expanded Capabilities

- execution debugging tools
- drift detection
- traceability visualization
- multi-project dashboards

---

# 12. Guiding Principles

---

### 1. API Owns Logic
UI reflects, never decides.

---

### 2. Artifacts Are Truth
Everything derives from artifacts.

---

### 3. Timeline Over Logs
Structure replaces noise.

---

### 4. Human Control Is Explicit
Approvals and interventions are visible and actionable.

---

### 5. Simplicity First
Single DB + API + UI.

---

## 13. Documentation Structure Overview

This project organizes design and implementation knowledge into clearly defined layers. Each folder serves a distinct role in translating system intent into a working application.

The structure enforces strict separation between:
- **System behavior (what happens)**
- **UX representation (how it is experienced)**
- **Frontend implementation (how it is built)**

---

### `/system-behavior` → defines how it works

Defines the **authoritative behavioral model of the system**.

This layer captures:
- Pipeline state machine (operational states)
- Lifecycle progression rules (derived state)
- Timeline event model (execution + human actions)
- Gate behavior (approval, takeover, skip, handoff)
- Retry and failure loops (e.g., Implementer ↔ Verifier)
- Execution modes (`next`, `next-flow`, `full-sprint`)

Focus:
- What actually happens in the system
- Deterministic execution rules
- Single source of truth for behavior

Constraint:
- MUST NOT include UI concerns or visual representation

---

### `/system-mapping` → connects it

Bridges the gap between **backend systems and system behavior / UI inputs**.

This layer maps:
- API endpoints → system behavior models
- API responses → UI data structures
- Pipeline states → UI-consumable state
- Artifacts → typed representations

Focus:
- Ensuring alignment between backend contracts and frontend behavior
- Preventing drift between API and UI
- Translating external data into internal models

Constraint:
- MUST NOT redefine behavior (only map it)

---

### `/ux` → expresses it

Defines the **user experience layer**.

This is where system behavior is translated into:
- Views (screens and layouts)
- Flows (user and system interactions)
- Visual states (UI representation of system state)
- Components (UI contracts and composition)

Focus:
- How the system behaves from the user’s perspective
- How pipeline execution is visualized and controlled
- How artifacts and events are presented to the user

Constraint:
- MUST NOT define system logic or state transitions

---

### `/frontend` → builds it

Defines the **implementation strategy** for the UI.

This includes:
- Next.js architecture
- API proxy layer (server-side security)
- Data fetching patterns (e.g., React Query)
- Component structure and layering
- State synchronization strategies (polling, caching)

Focus:
- How the UX is realized in code
- Performance, scalability, and maintainability
- Security (no client-side API exposure)

Constraint:
- MUST NOT introduce business logic or execution rules

---

### `/roadmap` → evolves it

Captures **future direction and intentional change**.

This includes:
- UI evolution phases (V1 → V2 → future)
- Known technical debt
- Planned improvements and enhancements
- Deferred decisions and trade-offs

Focus:
- Guiding system growth over time
- Maintaining long-term architectural coherence
- Documenting why decisions are staged or delayed

---

## Guiding Principle

> Behavior is defined once.  
> Mapping translates it.  
> UX expresses it.  
> Frontend implements it.

If a rule or behavior exists in more than one layer, the system is at risk of drift.


---

## Summary


# 14. Summary

This system is:

> A governed execution engine  
> with a structured human control interface

Where:

- Documents define intent
- Pipelines execute intent
- UI provides visibility and control
- Artifacts capture truth

---



# End of Document
