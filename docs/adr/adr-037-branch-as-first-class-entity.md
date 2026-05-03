# ADR-037: Branch as First-Class Entity

**Status:** Accepted  
**Date:** 2026-05-03  
**Supersedes:** —  
**Related:** ADR-001 (Git as Source of Truth), ADR-030 (Autonomous Sprint Execution), ADR-035 (Pipeline-Scoped Task Artifacts), ADR-036 (Governance Artifact Source of Truth)

---

## Context

The platform's pipeline model associates a `sprint_branch` with a pipeline run as an attribute. Under the original design, at most one pipeline was active per project at a time — any second active pipeline was treated as a "data issue" (`MultiPipelineWarning` in the UI).

Two use cases expose that this model is too narrow:

### UC1 — Concurrent Executor Pipelines

The Planner role produces phase plans and sprint plans; Sprint Controller, Implementer, and Verifier execute those plans. ADR-036 constrains concurrent Planners to one per project (due to FR-claiming race conditions). However, multiple executor pipelines (sprint-controller → implementer → verifier) running simultaneously on **different feature branches** is both safe and desirable — each branch works on a different task, reads a different `current_task.json`, and writes to a different feature branch. The only constraint is that a given branch can have at most one active pipeline at a time.

### UC2 — Failure Recovery via Branch Resumption

When a pipeline fails mid-execution, the branch retains all execution state: committed files, the `current_task.json`, and the pipeline artifact store. Currently there is no mechanism to resume from that state — the user must start a new pipeline from the beginning, losing the prior context and potentially re-doing work.

The natural recovery unit is the **branch**: resume execution on the same branch, from the same step, with access to all prior artifacts.

---

## Decision

**The sprint branch is the primary unit of delivery work. Pipeline runs are the execution history of a branch.**

### 1. Branch Lifecycle

- A branch in an **active** state (`running`, `awaiting_approval`, `awaiting_pr_review`, `paused_takeover`) may have at most one pipeline at a time. Attempting to create a second pipeline against an already-active branch returns `409 BRANCH_ALREADY_ACTIVE`.
- A branch in a **failed** state may receive a continuation pipeline. The continuation pipeline inherits the failed pipeline's `sprint_branch` and artifact paths.
- A branch in a **complete** state is closed; new work on the same named branch would be a new independent pipeline.

### 2. UC1 — Concurrent Executor Pipelines

Multiple executor pipelines may run simultaneously within a single project, subject to:
- Each pipeline operates on a **distinct** feature branch
- The single-Planner constraint from ADR-036 applies: at most one planner pipeline per project
- The `BRANCH_ALREADY_ACTIVE` guard enforces branch-level uniqueness at creation time

The frontend project page replaces the binary `activePipeline ? <ActivePipelinePanel> : <StartRunPanel>` pattern with a multi-section layout: active branch cards (one per active pipeline), failed branch cards (resumable), and a start-new-run panel that is always available.

`MultiPipelineWarning` is removed: multiple active pipelines on different branches is correct behavior, not a data issue.

### 3. UC2 — Failure Recovery

Pipeline creation accepts an optional `prior_pipeline_id` field in the request body's `input` object:

```json
POST /pipeline
{
  "entry_point": "sprint-controller",
  "execution_mode": "next",
  "input": { "prior_pipeline_id": "pipe-2026-05-03-abc12345" },
  "metadata": { "source": "api", "slack_channel": "C123" }
}
```

The server:
1. Fetches the prior pipeline and copies its `sprint_branch` onto the new pipeline (unless the caller explicitly overrides it)
2. Stores `prior_pipeline_id` in the new pipeline's `input` record
3. During `executeCurrentStep`, appends all of the prior pipeline's step `artifact_paths` to `previousArtifacts` so roles can read prior-run outputs without re-execution

The `sprint_branch` inheritance ensures the git clone checks out the correct branch, giving the Sprint Controller (or Implementer) access to `current_task.json` and other work-in-progress files.

### 4. Branch Query API

A new endpoint `GET /projects/:projectId/branches` returns `ProjectBranchSummary[]` — one entry per distinct `sprint_branch`, reflecting the most recent pipeline on that branch:

```ts
interface ProjectBranchSummary {
  sprint_branch: string;
  latest_pipeline_id: string;
  status: PipelineStatus;
  current_step: PipelineRole | "complete";
  updated_at: string;
}
```

### 5. Frontend Layout

The project detail page is restructured into three independent sections:

| Section | Condition | Purpose |
|---|---|---|
| Active branch cards | `status` in active set | Show status, step, actions (Approve/Cancel/Retry) per branch |
| Failed branch cards | `status === "failed"` | Show last step + Resume button (pre-fills start form) |
| Start new run panel | Always visible | Entry point, mode, description, sprint branch (advanced); Planner 409 surfaces as error |

---

## Consequences

**Positive**
- Multiple executor pipelines can run in parallel on separate feature branches, improving throughput
- Failed branches are recoverable without discarding prior work
- The branch is the natural narrative unit for tracking delivery progress
- Frontend no longer treats valid concurrent pipelines as an error

**Negative / Tradeoffs**
- Continuation pipelines accumulate artifact paths from the prior run — the `previousArtifacts` list grows with each continuation. Role scripts must tolerate duplicate or stale artifact references (they already do via `findFirst` semantics).
- The UI grows more complex; the project page must handle 0–N active branch cards rather than a single binary state.

**Out of scope**
- Branch deletion / cleanup workflows
- PR-linked branch state transitions
- Multi-task continuation within a single branch (extending a branch past one task's lifetime)
- Slack-initiated branch resumption (future: UC3)
