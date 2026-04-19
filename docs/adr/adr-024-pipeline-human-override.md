# ADR-024: Pipeline Human Override and Takeover Model

## Status
Accepted

## Date
2026-04-19

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

ADR-006 established the Human-in-the-Loop approval model with the principle: "Automation proposes. Humans approve. Execution enforces."

ADR-022 introduced the multi-agent pipeline execution model with approval gates at each role boundary.

The original ADR-006 model covers binary approval: approve or reject an artifact. It does not address the richer set of human interactions that a live delivery pipeline requires:

- A human may want to **perform a step themselves** rather than approve AI output (e.g., write the implementation manually while keeping the surrounding pipeline intact)
- A human may want to **approve and continue** without any intervention
- A human may need to **skip a step** with a recorded justification (e.g., sprint controller is already done manually)
- A human may start pipeline execution **at any step** rather than always from the Planner
- A human who has taken over a step must have a clear mechanism to **return control to the pipeline**

Without a defined model for these interactions, the system would require workarounds: cancelling pipeline runs, creating new ones at different entry points, or manually updating state — all of which break auditability.

---

## Decision

The Execution Service SHALL implement a **Pipeline Human Override and Takeover Model** with the following first-class human actions:

### 1. Approve
Human confirms the output of the current step and authorizes the pipeline to proceed to the next step.

- Pipeline status transitions: `awaiting_approval` → `running` (next step)
- Gate outcome recorded: `approved`
- Actor recorded: human user identifier

### 2. Take Over
Human claims the current step. The pipeline pauses. The AI will not attempt the current step.

- Pipeline status transitions: `awaiting_approval` or `running` → `paused_takeover`
- Current step actor becomes: human
- System notifies the interface: "You have taken over [step]. Use /handoff when complete."

### 3. Hand Off
Human signals that they have completed their claimed step. Provides an optional artifact reference. Pipeline resumes at the next step.

- Pipeline status transitions: `paused_takeover` → `running` (next step)
- Gate outcome recorded: `human_complete`
- Optional `artifact_path` recorded as step output

### 4. Skip
Human advances the pipeline past the current step without either AI or human performing it. A justification is required and recorded.

- Pipeline status transitions: any non-terminal → `running` (next step)
- Gate outcome recorded: `skipped`
- Justification and actor recorded in step history

### 5. Variable Entry Point
Any role may be specified as the starting point when creating a pipeline run. This is not an override — it is an intentional scoped execution from the start.

- `POST /pipeline { entry_point: "implementer", input: { task_id: "TASK-001" } }`
- Pipeline run begins at the specified role and flows forward from there
- All prior steps are recorded as `not_applicable` in the step history

---

## Core Principle

> Any step can be human-performed, AI-performed, or skipped.  
> The pipeline state machine records who did what.  
> No human action breaks auditability.

---

## State Transitions

```
Created
  │
  ▼
Running (AI executing current step)
  │
  ├─ Step completes (gate = false) ──────────────────► Running (next step)
  │
  ├─ Step completes (gate = true) ──────────────────► Awaiting Approval
  │                                                       │
  │                                             ┌─────────┼──────────┐
  │                                             │         │          │
  │                                           Approve  Takeover    Skip
  │                                             │         │          │
  │                                             │         ▼          │
  │                                             │   Paused Takeover  │
  │                                             │         │          │
  │                                             │      Handoff       │
  │                                             │         │          │
  │                                             └────►  Running ◄────┘
  │                                                  (next step)
  │
  ├─ Step fails ────────────────────────────────► Failed
  │
  └─ All steps complete ────────────────────────► Complete
```

---

## Auditability Requirements

Every human action SHALL be recorded in the pipeline run's step history with:
- `actor`: human user identifier (from Slack user ID or API caller)
- `action`: `approved` | `taken_over` | `handed_off` | `skipped`
- `timestamp`: ISO 8601
- `artifact_path`: (for handoff, if provided)
- `justification`: (for skip, required)

These records are immutable. A pipeline run's complete history of AI executions and human overrides SHALL be queryable via `GET /pipeline/:id`.

---

## Rationale

This model is derived from observed real-world hybrid AI/human workflow patterns:

- **Approve** is the default happy path — human trusts the AI output
- **Take Over** is used when AI output quality is low or the step is sensitive enough to require human execution this time
- **Hand Off** closes the takeover loop cleanly without abandoning the pipeline
- **Skip** is used for steps already completed out-of-band (e.g., the architect already wrote the phase plan in a planning session)
- **Variable entry points** support ad-hoc execution without creating phantom pipeline history

The model does not introduce binary stop/start mechanics. The pipeline is always in a defined, recoverable state regardless of which human action occurs.

---

## Consequences

### Positive
- Human agency is a first-class concern — not bolted on after the fact
- No human action creates an irrecoverable state
- Full override history is available for governance review
- Pipeline runs are resumable after any interruption

### Negative
- `pipeline_runs` state machine has non-trivial transition logic that must be carefully tested
- Concurrent human actions on the same pipeline run (e.g., two people pressing approve simultaneously) require idempotency protection

### Neutral
- The model is interface-agnostic — the same actions are available via Slack buttons, API calls, or future web UI interactions

---

## Related ADRs
- ADR-005: Role-Based Execution Model
- ADR-006: Human-in-the-Loop Approval Model
- ADR-022: Multi-Agent Pipeline Execution Model
- ADR-023: n8n as Slack Interface Adapter
