# n8n Artifact and State Contract

**Status:** Draft
**Version:** 0.1
**Date:** 2026-04-15

This is the canonical reference for artifact paths, GitHub label schema, state machine rules, and
inter-executor contracts. Both n8n nodes and VS Code agents must read from and write to the
locations defined here. Any deviation creates traceability gaps and breaks handoff compatibility.

Architecture overview: `docs/n8n-orchestration.md`

---

## 1. Canonical Artifact Paths

All paths are relative to the repository root.

### 1.1 Planning Artifacts (created before execution)

| Artifact                  | Canonical Path                                                              | Written By                        | Read By                        |
|---------------------------|-----------------------------------------------------------------------------|-----------------------------------|--------------------------------|
| Phase plan (active)       | `ai_dev_stack/ai_project_tasks/active/phase_plan_{descriptor}.md`          | Operator / Planner                | Workflow 2, VS Code            |
| Sprint plan               | `ai_dev_stack/ai_project_tasks/active/sprint_plan_{sprint-id}.md`          | Planner agent                     | sprint-controller, VS Code     |
| Implementation brief      | `ai_dev_stack/ai_project_tasks/active/brief_{task-id}.md`                  | sprint-controller                 | Implementer, Fixer, VS Code    |
| Coordination ledger       | `ai_dev_stack/ai_project_tasks/next_steps.md`                               | All agents, Workflows 1–2         | All agents                     |

### 1.2 Execution Artifacts (created during execution)

| Artifact                  | Canonical Path                                                              | Written By                        | Read By                        |
|---------------------------|-----------------------------------------------------------------------------|-----------------------------------|--------------------------------|
| Task status               | `ai_dev_stack/ai_state/task_{task-id}_status.json`                         | n8n state nodes                   | All agents, n8n                |
| Verifier output           | `ai_dev_stack/ai_project_tasks/active/test_results.json`                   | Verifier node                     | Fixer node, Decision node      |
| Handoff note              | `ai_dev_stack/ai_state/handoff_{task-id}.md`                               | n8n needs-human node              | Operator, VS Code agents       |
| Implementer output        | Committed as code to PR branch                                              | Implementer node / VS Code        | Verifier node                  |
| Documenter output         | Committed as documentation changes to PR branch                             | Documenter node / VS Code         | Operator PR review             |

### 1.3 Archive Artifacts (created at close-out)

| Artifact                         | Canonical Path                                                | Written By              |
|----------------------------------|---------------------------------------------------------------|-------------------------|
| Completed task history           | `ai_dev_stack/history/task_history/task_{task-id}/`           | close-task node         |
| Archived sprint completion files | Per sprint convention in `ai_dev_stack/ai_project_tasks/archive/` | close-sprint node   |

### 1.4 Path Mapping — Governance Model to n8n Access

| Governance Model Reference                  | Canonical Path                                                              | n8n Access Method                  |
|---------------------------------------------|-----------------------------------------------------------------------------|------------------------------------|
| Active sprint plan                          | `ai_dev_stack/ai_project_tasks/active/sprint_plan_*.md`                    | GitHub API — Get Contents          |
| Active implementation brief                 | `ai_dev_stack/ai_project_tasks/active/brief_{task-id}.md`                  | GitHub API — Get Contents          |
| Test results                                | `ai_dev_stack/ai_project_tasks/active/test_results.json`                   | Execute Command writes; GitHub API reads |
| Task execution state                        | `ai_dev_stack/ai_state/task_{task-id}_status.json`                         | GitHub API — Create/Update File    |
| Handoff note                                | `ai_dev_stack/ai_state/handoff_{task-id}.md`                               | GitHub API — Create File           |
| Task history archive                        | `ai_dev_stack/history/task_history/`                                        | GitHub API — Create File (on close) |
| Coordination ledger                         | `ai_dev_stack/ai_project_tasks/next_steps.md`                               | GitHub API — Get/Update Contents   |

---

## 2. GitHub Issue Schema

### 2.1 Issue Title Format

```
[{task-id}] {task-title}
```

Examples:
- `[SQ-INGEST-003A] Fix pagination in evidence context generator`
- `[SP-UI-E-T04] Wire sidebar component to context API`

### 2.2 Issue Body Metadata Block

Every Issue created by n8n or the governance system must contain a YAML metadata block at the top
of the body. This block is parsed by the Parse Task Metadata node in Workflow 3. Missing or
malformed blocks cause the Issue to transition to `needs-human` with a parse error comment.

```yaml
---
task_id: SQ-INGEST-003A
sprint_id: SP-UI-E-01
phase_id: PH-UI-E
fr_ids_in_scope: ["FR-INS-007", "FR-INS-008"]
architecture_contract_change: false
ui_evidence_required: false
incident_tier: none
fast_track: false
max_iterations: 5
---
```

Human-authored Issue body content follows below the closing `---`.

---

## 3. Task Status File Schema

**Path:** `ai_dev_stack/ai_state/task_{task-id}_status.json`

Written by n8n state nodes at each label transition. Read by both n8n and VS Code agents to
determine current execution position.

```json
{
  "task_id": "SQ-INGEST-003A",
  "status": "verifying",
  "iteration": 2,
  "max_iterations": 5,
  "fast_track": false,
  "executor": "n8n",
  "last_updated": "2026-04-15T14:32:00Z",
  "agents_completed": ["sprint-controller", "implementer"],
  "current_agent": "verifier"
}
```

**`executor` values:** `n8n` | `vscode` | `human`
Updated whenever the active executor changes (e.g., when writing a handoff note, set to `human`).

---

## 4. Verifier Output Schema

**Path:** `ai_dev_stack/ai_project_tasks/active/test_results.json`

Written by the Verifier node after every gate run. Matches the existing schema expected by
`validate_test_results.py` and VS Code agents. Read by the fixer and the PASS/FAIL Decision node.

```json
{
  "task_id": "SQ-INGEST-003A",
  "status": "FAIL",
  "iteration": 2,
  "recoverable": true,
  "timestamp": "2026-04-15T14:35:00Z",
  "gates": {
    "lint": {
      "status": "PASS",
      "exit_code": 0,
      "command": "python -m flake8 --max-line-length=120 src/ingest/paginator.py",
      "output": ""
    },
    "typecheck": {
      "status": "FAIL",
      "exit_code": 1,
      "command": "python -m mypy src/ingest/paginator.py --ignore-missing-imports",
      "output": "error: Argument 1 to \"paginate\" has incompatible type \"str\"; expected \"int\""
    },
    "tests": {
      "status": "PASS",
      "exit_code": 0,
      "command": "python -m pytest tests/test_ingest.py -x",
      "output": "5 passed in 0.43s"
    },
    "validate": {
      "status": "PASS",
      "exit_code": 0,
      "command": "python ai_dev_stack/scripts/validate_test_results.py",
      "output": "Validation passed"
    }
  },
  "failures": [
    "typecheck: Argument 1 to 'paginate' has incompatible type \"str\"; expected \"int\""
  ]
}
```

**`recoverable` flag:** Set by the fixer agent's assessment. For Phase 1–2 (no fixer node), default
to `true` for all non-fatal gate failures. Set to `false` only when test infrastructure itself is
broken (e.g., corrupted test environment, import errors preventing any test from running).

---

## 5. Handoff Note Schema

**Path:** `ai_dev_stack/ai_state/handoff_{task-id}.md`

Written by the Needs-Human node when n8n pauses for human intervention. Committed to the repo
via GitHub API so it is accessible from any VS Code session. Ephemeral — archive after task closes.

```markdown
# Handoff Note — {task-id}

**Created:** {ISO 8601 timestamp}
**Triggered by:** n8n Task Execution Engine
**Reason:** {reason — e.g., "Max iterations (5) reached on verifier gates", "architecture_contract_change flag set"}

---

## Task Context

- **Task ID:** {task-id}
- **Sprint:** {sprint-id}
- **Phase:** {phase-id}
- **Current iteration:** {n} of {max}
- **Last agent completed:** {agent-name}
- **Status file:** `ai_dev_stack/ai_state/task_{task-id}_status.json`

## Current Failures

{paste failures[] array from test_results.json, formatted as a list}

## Last Verifier Output

`ai_dev_stack/ai_project_tasks/active/test_results.json` — committed at {timestamp}

## Recommended Next Action

{e.g., "Run fixer-v5 in VS Code with test_results.json loaded as context. Review mypy type
mismatch on paginate() argument. After fix, apply verifying label to hand back to n8n."}

## Resume Instructions

1. Apply label `human-in-progress` to the GitHub Issue to suppress n8n
2. Run the appropriate VS Code agent (see Recommended Next Action above)
3. Commit agent output to canonical artifact paths
4. Remove labels `human-in-progress` and `needs-human`
5. Apply `verifying` label to resume n8n from the Verifier node

---

*This file is ephemeral. Move to `ai_dev_stack/history/task_history/task_{task-id}/` on close.*
```

---

## 6. GitHub Label Schema

### 6.1 Required Labels

All labels must be created in the GitHub repository before Phase 1 begins.

| Label                | Color (hex) | Description                                               |
|----------------------|-------------|-----------------------------------------------------------|
| `type:task`          | `#0075ca`   | Regular sprint task                                       |
| `type:side-quest`    | `#e4e669`   | Side quest slice                                          |
| `type:intake`        | `#d93f0b`   | Intake triage item                                        |
| `type:phase`         | `#bfd4f2`   | Phase plan tracking issue                                 |
| `ready`              | `#0e8a16`   | Staged for execution                                      |
| `implementing`       | `#fbca04`   | Agent implementing                                        |
| `verifying`          | `#1d76db`   | Gate suite running                                        |
| `fix-required`       | `#e11d48`   | Gates failed; fixer queued                                |
| `done`               `#0e8a16`   | All gates passed; closed                                 |
| `failed`             | `#b60205`   | Permanently failed                                        |
| `needs-human`        | `#f9d0c4`   | Paused; awaiting operator                                 |
| `human-in-progress`  | `#fef2c0`   | Human session active; n8n suppressed                      |
| `fast-track`         | `#c5def5`   | Fast Track controls apply                                 |

### 6.2 Label Exclusivity Rules

The following label combinations must never coexist on the same Issue:

| Forbidden Combination              | Reason                                            |
|------------------------------------|---------------------------------------------------|
| `ready` + any other state label    | `ready` is entry state; must be exclusive         |
| `implementing` + `verifying`       | Sequential states; cannot overlap                 |
| `done` + any state label           | Terminal state; no further processing             |
| `failed` + any state label         | Terminal state; no further processing             |
| `needs-human` + `human-in-progress` | Human is active; remove `needs-human` on takeover |
| `human-in-progress` + `done`       | Cannot be active and closed simultaneously        |

---

## 7. Mutex Protocol — Detailed Rules

The `human-in-progress` label is the concurrency mutex between n8n and VS Code sessions.

1. **n8n must never act** on any Issue carrying `human-in-progress`, regardless of what other
   labels are present. This check occurs at both the Trigger node (filter) and the Entry Gate node
   (explicit validation).

2. **The operator must apply** `human-in-progress` before starting any VS Code session on a task
   that n8n has touched or may touch.

3. **The operator must remove** `human-in-progress` before applying any state label that n8n
   monitors. The sequence is: remove mutex → apply state label (not the reverse).

4. **`human-in-progress` must never appear** alongside `done`, `failed`, or `ready`. These are
   terminal or entry states where no session overlap should exist.

5. **If n8n crashes mid-execution** with an Issue stuck in a state label (not `needs-human`), the
   operator must apply `human-in-progress` before performing any manual recovery to prevent n8n
   from resuming on a partial state.

---

## 8. `run-agent.js` Contract (Phase 3+)

When LLM-executing nodes are introduced, the agent runner must satisfy this input/output contract
to ensure compatibility with both n8n invocation and VS Code manual invocation.

### Input

```json
{
  "taskId": "SQ-INGEST-003A",
  "agentName": "fixer | documenter | sprint-controller | implementer",
  "contextPaths": [
    "ai_dev_stack/ai_project_tasks/active/brief_SQ-INGEST-003A.md",
    "ai_dev_stack/ai_project_tasks/active/test_results.json"
  ]
}
```

### Execution Steps

1. Load each artifact in `contextPaths` via GitHub API or local filesystem
2. Resolve task flags from the Issue body metadata block
3. Apply conditional context loading per `AI_RUNTIME_LOADING_RULES.md`
4. Build agent-specific prompt using the resolved context
5. Call LLM API (OpenAI or Anthropic — configurable)
6. Write output to the canonical path for the agent
7. Commit changed files to the PR branch if agent produces code or doc changes
8. Return structured result JSON

### Output

```json
{
  "agent": "fixer",
  "status": "success | error",
  "artifacts_written": ["src/ingest/paginator.py"],
  "commit_sha": "abc123def456",
  "summary": "Fixed mypy type mismatch: changed paginate() argument from str to int"
}
```

If `status` is `error`, n8n treats it as FAIL with `recoverable: true` and increments the
iteration counter. The error message is included in the handoff note if max iterations is reached.

### Context Loading Priority (simplified for Phase 3)

Phase 3 implements a simplified subset of `AI_RUNTIME_LOADING_RULES.md`:

1. Always load: task brief (`brief_{task-id}.md`)
2. Always load: verifier output (`test_results.json`) for fixer agent
3. Conditionally load based on flags:
   - `ui_evidence_required: true` → load UI spec document
   - `architecture_contract_change: true` → escalate to `needs-human` (do not run)
4. Full `AI_RUNTIME_LOADING_RULES.md` conditional loading: Phase 4+
