# ADR-035: Pipeline-Scoped Task Artifacts for Concurrent Pipeline Support

## Status
Accepted

## Date
2026-05-01

## Deciders
- Platform Architecture
- Product Engineering

## Supersedes
- The `ai_project_tasks/active/` artifact placement introduced during ADR-033 implementation
  (that placement was a regression; this ADR corrects it permanently)

---

## Context

### Original design

Task artifacts (`AI_IMPLEMENTATION_BRIEF.md`, `current_task.json`, `test_results.json`,
`verification_result.json`, and related execution files) were originally written to
`/runtime/artifacts/{pipeline_id}/` via `artifactService.write(pipelineId, filename, ...)`.
This made task artifacts **pipeline-scoped**: each pipeline run had its own isolated artifact
namespace on Azure Files (ADR-010).

### The regression

During the ADR-033 implementation (Deterministic Artifact Contracts, 2026-04-30), the Sprint
Controller script was modified to additionally write `AI_IMPLEMENTATION_BRIEF.md` and
`current_task.json` into the project repo at `project_work/ai_project_tasks/active/`.  The
intent was to make the brief discoverable by the implementing agent via a canonical, stable
path in the repo.

A side-effect was that `loadOpenActiveTaskPackage()` in the Sprint Controller began scanning
`active/` as its primary source of truth for the "is a task already in flight?" check.
Because `active/` is a shared location within the project repo — a single git working tree
cloned once per project — this made task state **project-scoped**, not pipeline-scoped.

### Why that breaks concurrent pipelines

Phases and Sprints are not shared across pipelines. A new pipeline picks up the next staged
sprint from `staged_sprints/`, which is independent. But the `active/` directory is one
location per project. If two pipelines attempt to run for the same project simultaneously:

- The second Sprint Controller finds the first pipeline's task package in `active/` and
  either re-uses it (wrong task), or blocks (wrong behavior).
- The Implementer and Verifier read from `active/` and see whichever pipeline last wrote
  there, regardless of which pipeline they belong to.

This unintentionally introduced a **project-scoped single-pipeline constraint** — only one
pipeline per project can execute a task at a time.

### The target use case

The primary concurrent pipeline use case is:

> **One pipeline executes the current sprint while a second pipeline runs the Planner to
> develop the next phase or sprint plan.**

The Planner role does not read from `active/`, so Planner pipelines are unaffected today.
However, the constraint prevents future task-level concurrency and creates a hidden coupling
that is not expressed anywhere in the architecture documentation.

### What must stay in the repo

The brief and current task *do* need to be accessible to the implementing agent's LLM context.
The agent clones the repo and reads files from the working tree. However, this requirement
is satisfied by the artifact service path (`/runtime/artifacts/{pipeline_id}/`), which is
mounted on Azure Files and accessible alongside the repo clone — the agent scripts already
read from the artifact service path for pipeline-scoped files.

The `active/` directory in the repo serves a **human-legibility** purpose (operators can
`git log` or browse GitHub to see what task is in flight) but is not required for machine
correctness. That purpose can be preserved at lower cost by keeping a lightweight
`active/sprint_state.json` pointer in the repo rather than writing the full brief there.

---

## Decision

**Task artifacts SHALL be pipeline-scoped, stored exclusively under
`/runtime/artifacts/{pipeline_id}/` via the artifact service.**

The `active/` directory in the project repo SHALL NOT be the primary write target or read
source for task execution artifacts (`AI_IMPLEMENTATION_BRIEF.md`, `current_task.json`,
`test_results.json`, `verification_result.json`, `progress.json`, `fix_state.json`).

### Specific rules

| Artifact | Storage location | Writer | Readers |
|---|---|---|---|
| `AI_IMPLEMENTATION_BRIEF.md` | `/runtime/artifacts/{pipeline_id}/` | Sprint Controller (script) | Implementer script |
| `current_task.json` | `/runtime/artifacts/{pipeline_id}/` | Sprint Controller (script) | Implementer, Verifier scripts |
| `test_results.json` | `/runtime/artifacts/{pipeline_id}/` | Implementer script | Verifier, Sprint Controller scripts |
| `verification_result.json` | `/runtime/artifacts/{pipeline_id}/` | Verifier script | Implementer (retry), Sprint Controller scripts |
| `sprint_state.json` | `/runtime/artifacts/{pipeline_id}/` | Sprint Controller (script) | Pipeline status summary |
| `progress.json` | `/runtime/artifacts/{pipeline_id}/` | Implementer script | Implementer (retry context) |
| `fix_state.json` | `/runtime/artifacts/{pipeline_id}/` | Implementer script | Implementer (retry context) |

### Repo `active/` directory: pointer-only

The Sprint Controller MAY write a minimal pointer file to `project_work/ai_project_tasks/active/`
for human-legibility only:

```jsonc
// active/sprint_state.json — human-readable pointer, NOT an execution source of truth
{
  "pipeline_id": "pipe-2026-05-01-abc12345",
  "sprint_id": "S01",
  "task_id": "S01-001",
  "artifact_path": "artifacts/pipe-2026-05-01-abc12345/",
  "started_at": "2026-05-01T12:00:00Z"
}
```

This file SHALL NOT be read by any script as a source of task content. It is informational only.

### Concurrency constraint is lifted

With task artifacts pipeline-scoped, the `loadOpenActiveTaskPackage()` check in the Sprint
Controller SHALL be changed to scan only the pipeline's own artifact path, not `active/`.  Two
Sprint Controllers running for the same project simultaneously will each operate in their own
artifact namespace and will not interfere.

The **per-project git mutex** (ADR-028, `ProjectGitService.withLock`) continues to serialize
git operations (clone, pull, branch, commit, push) across concurrent pipelines for the same
project. This is the correct and sufficient serialization point for git; it does not prevent
concurrent task execution.

### Pipeline creation: no active-pipeline guard

The `pipelineService.create()` method SHALL NOT reject a create request on the basis that
another pipeline is already running for the same project. The pipeline status summary endpoints
(`/pipeline/status-summary/current`, `/pipeline/status-summary/by-channel`) remain available
for operators to observe concurrent runs.

---

## Consequences

### Positive

- Two pipelines may run concurrently for the same project without artifact collision.
- The primary concurrent use case (executor + planner) is enabled without new infrastructure.
- Task artifact isolation is now enforced at the storage layer, not by convention.
- The accidental single-pipeline constraint is removed and cannot be reintroduced silently.

### Negative / Mitigations

- **Agent script reads**: Implementer and Verifier scripts that currently fall back to reading
  from `active/` must be updated to read exclusively from the pipeline artifact path. The
  fallback reads were a symptom of the regression and are not correct behavior.
- **Brief discovery**: The agent LLM receives the artifact path in `enrichedInput.previous_artifacts`
  (set in `executeCurrentStep`). Scripts already use this to locate pipeline-scoped files;
  no new discovery mechanism is needed.
- **Human legibility**: Partially reduced — the full brief is no longer in the repo. Mitigated
  by the pointer file and by the `/pipeline/{id}/artifact?path=...` API endpoint, which
  operators can use to inspect any pipeline artifact.

---

## Implementation Guidance

When implementing this decision:

1. **Sprint Controller**: Remove the `fs.writeFile` calls that write to `active/` for
   `AI_IMPLEMENTATION_BRIEF.md` and `current_task.json`. Keep or convert to the pointer-only
   `sprint_state.json` write. Update `loadOpenActiveTaskPackage()` to read from the pipeline
   artifact path rather than `active/`.

2. **Implementer script**: Remove the fallback `active/` read path. The primary artifact path
   from `previous_artifacts` is the only valid source.

3. **Verifier script**: Same as implementer — remove any `active/` fallback reads.

4. **Tests**: Update fixtures that reference `project_work/ai_project_tasks/active/
   AI_IMPLEMENTATION_BRIEF.md` or `active/current_task.json` to use pipeline artifact paths.

5. **One-pipeline-per-project guard**: Do not add such a guard. If an operator wants to prevent
   concurrency for a specific project, that is an operator-level concern (e.g., not invoking a
   second pipeline), not a platform-level constraint.

---

## Related ADRs

- ADR-002: Artifact-Driven State — task artifacts are state; they must be scoped to the run
  that produced them.
- ADR-010: Azure Files Persistent Storage — `/runtime/artifacts/` is the artifact mount point.
- ADR-022: Pipeline Execution Model — pipeline_id is the correlation key for a run.
- ADR-028: Project-Scoped Git Repository Lifecycle — git mutex is the correct concurrency
  boundary for git operations; task artifact scope is separate.
- ADR-030: Autonomous Sprint Execution — concurrent planner + executor pipeline use case.
- ADR-033: Deterministic Artifact Contracts — introduced the regression this ADR corrects.
