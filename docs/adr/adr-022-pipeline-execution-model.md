# ADR-022: Multi-Agent Pipeline Execution Model

## Status
Accepted

## Date
2026-04-19

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

The platform currently supports individual governed executions via the canonical execution contract (ADR-013, ADR-017). A single execution resolves a target role or script, runs it, and returns a result.

However, software delivery is not a single execution. It is a sequenced pipeline of specialized roles:

```
Planner → Sprint Controller → Implementer → Verifier → Fixer → Sprint Controller (close)
```

Each role:
- Consumes artifacts produced by the prior role
- Produces artifacts consumed by the next role
- May require human approval before the next role begins
- May fail, requiring re-execution or escalation to a repair role (Fixer)

Without a first-class pipeline model, this sequencing would need to be managed entirely in n8n — embedding execution logic in the orchestration layer in violation of ADR-007. State would live only in n8n workflow variables, which are transient, not auditable, and not replayable.

Additionally, the system must support:
- **Variable entry points** — humans may start work at Implementer for a single task, or at Verifier to re-check existing work, without re-running the full pipeline from Planner
- **Human override at any step** — the human must be able to claim ownership of any step, perform it manually, and return control to the pipeline
- **Pipeline state persistence** — a pipeline run must be recoverable after failure, restart, or human intervention without data loss

---

## Decision

The Execution Service SHALL implement a **Pipeline Execution Model** as a first-class concern.

A **Pipeline Run** is a stateful, sequenced execution of governed roles that:
- Has a unique, persistent identifier (`pipeline_id`)
- Tracks the current step, status, and history
- Stores artifact references produced at each step
- Supports configurable entry points (any role may be the first step)
- Supports human gate outcomes (approve, takeover, handoff, skip)
- Produces an immutable log of all transitions

---

## Pipeline Definition

### Roles and Sequence

```
Roles (in default order):
  1. planner
  2. sprint-controller (setup)
  3. implementer
  4. verifier
  5. fixer              (conditional — triggered by verifier FAIL only)
  6. sprint-controller  (close-out)
```

The sequence is governed by role definitions in the registry. A role definition specifies:
- `on_success`: the next role to invoke (or `terminal`)
- `on_fail`: the role to invoke on execution failure (or `halt`)
- `gate`: whether human approval is required before advancing

### Entry Points

Any role may be the starting point of a pipeline run. The `entry_point` field in `POST /pipeline` specifies which role begins execution.

Valid entry points: `planner`, `sprint-controller`, `implementer`, `verifier`, `fixer`

When `entry_point` is `implementer`, the pipeline begins at step 3 and flows forward through `verifier` and `fixer` as normal.

### Pipeline Run States

| State | Description |
|---|---|
| `running` | Pipeline is actively executing the current step |
| `awaiting_approval` | Step completed; waiting for human gate decision |
| `paused_takeover` | Human has claimed the current step |
| `failed` | Step execution failed; awaiting intervention |
| `complete` | All steps completed successfully |
| `cancelled` | Pipeline terminated by human action |

---

## Pipeline Run Record

```json
{
  "pipeline_id": "pipe-2026-0419-001",
  "entry_point": "planner",
  "current_step": "sprint-controller",
  "status": "awaiting_approval",
  "steps": [
    {
      "role": "planner",
      "execution_id": "exec-abc123",
      "status": "complete",
      "gate_outcome": "approved",
      "artifact_paths": ["ai_dev_stack/ai_project_tasks/active/phase_plan_auth.md"],
      "started_at": "2026-04-19T14:30:00Z",
      "completed_at": "2026-04-19T14:34:12Z",
      "actor": "system"
    }
  ],
  "metadata": {
    "slack_channel": "C0ATR1V0HHP",
    "slack_user": "U0ATA2VKYKY",
    "slack_thread_ts": "1776378304.943649",
    "source": "slack"
  },
  "created_at": "2026-04-19T14:30:00Z",
  "updated_at": "2026-04-19T14:34:12Z"
}
```

---

## Pipeline Notifications

When a pipeline step completes or reaches a gate, the Execution Service SHALL emit a structured notification to the configured callback URL (`N8N_CALLBACK_URL`). The orchestration layer (n8n) is responsible for translating this notification into interface-appropriate output (e.g., Slack interactive message).

This keeps the Execution Service decoupled from Slack while enabling real-time human interaction.

---

## Consequences

### Positive
- Pipeline state is persistent, auditable, and recoverable
- Entry points allow fine-grained human control over pipeline scope
- Human override is a first-class capability, not a workaround
- Orchestration layer remains thin — n8n routes but does not decide
- All pipeline history is queryable and replayable

### Negative
- Adds a `pipeline_runs` table and associated state management to the Execution Service
- Pipeline role sequence is currently defined in code; future governance-driven pipeline definitions will require a schema and migration

### Neutral
- Individual governed executions (`POST /executions`) continue to work unchanged — the pipeline model is additive

---

## Related ADRs
- ADR-005: Role-Based Execution Model
- ADR-006: Human-in-the-Loop Approval Model
- ADR-007: n8n as Orchestration Engine
- ADR-013: Execution Service API Contract
- ADR-019: Observability and Replayability
- ADR-021: Conversational Interface and Command Model
- ADR-023: n8n as Slack Interface Adapter
- ADR-024: Pipeline Human Override and Takeover Model
