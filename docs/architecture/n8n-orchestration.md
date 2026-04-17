# n8n Orchestration Architecture

**Status:** Draft
**Version:** 0.1
**Date:** 2026-04-15

---

## 1. Purpose and Scope

This document defines the architectural design for an n8n-based orchestration layer that drives
the AI Governance workflow. It covers the full execution chain:

- **Phase → Sprint → Task** (planned sprint work)
- **Intake → Task** (direct fast-track intake)
- **Intake → Side Quest → Task** (bounded improvement work)

The orchestration layer does not replace the AI Governance agents. It coordinates them — managing
state transitions, routing between workflow stages, triggering agent execution, and providing a
structured pause/resume handoff to VS Code manual sessions when human judgment is required.

---

## 2. Design Principles

### 2.1 Artifact-First State

All state is externalized to the repository and GitHub. Neither n8n nor VS Code agents carry state
in session memory. Any executor — n8n, VS Code, or a future runner — can pick up any workflow at
any point by reading the canonical artifacts.

### 2.2 GitHub as the System of Record

GitHub Issues represent task-level work items. GitHub labels encode the state machine. PRs are the
delivery artifact. All state transitions are recorded as label changes, comments, or committed files.

### 2.3 Deterministic Gates

Verification is deterministic: `lint`, `typecheck`, `tests`, `validate_test_results.py`. Gate output
is structured JSON. No LLM opinion determines PASS/FAIL. This is the most critical principle for
reliable unattended execution.

### 2.4 Bidirectional Handoff

n8n can pause and yield to a VS Code session. A VS Code session can commit artifacts and yield back
to n8n. Both read and write to the same canonical artifact paths. The boundary between executors is
a GitHub label transition.

### 2.5 Phased Automation

The system is built incrementally. Each phase delivers standalone value. No phase has an unmet
dependency from a later phase. LLM-executing nodes are introduced only after the state machine and
gate infrastructure are validated.

### 2.6 Explicit Escape Hatches

Every workflow has defined pause states. Max iteration limits, unrecoverable gate failures,
cross-subsystem scope flags, and architecture contract changes are all escape conditions that produce
`needs-human` with a structured handoff artifact — not a silent failure or hung workflow.

---

## 3. Three-Workflow System

The orchestration is composed of three linked n8n workflows. Each is independently triggerable,
observable, and pauseable.

```
┌──────────────────────────────────────────────────────────────┐
│  WORKFLOW 1: Intake Router                                    │
│  Trigger: Push to intake/INT-*/INTAKE.md                     │
│  Routes: → Side Quest  |  → Phase Plan  |  → Reject          │
└────────────────────────────┬─────────────────────────────────┘
                             │ accepted intake → new sprint work
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  WORKFLOW 2: Phase → Sprint Activator                         │
│  Trigger: Phase plan status changes to Active                 │
│  Output: Sprint plan committed + GitHub Issues created        │
└────────────────────────────┬─────────────────────────────────┘
                             │ Issues labeled: ready
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  WORKFLOW 3: Task Execution Engine                            │
│  Trigger: GitHub Issue labeled: ready                         │
│  Loop: sprint-controller → implementer → verifier →          │
│         fixer → documenter                                    │
└──────────────────────────────────────────────────────────────┘
```

**Build priority:** Workflow 3 first (Phases 1–3). Workflows 1 and 2 are Phase 4 targets.

---

## 4. Workflow 3 — Task Execution Engine

### 4.1 State Machine

Each GitHub Issue is a state machine. Label transitions are the only coordination signal between
n8n and external executors.

```
ready
  └─► implementing
        └─► verifying
              ├─► done           (PASS, any iteration)
              ├─► fix-required   (FAIL, iteration < maxIterations)
              │     └─► implementing  (fixer applied, re-entering loop)
              ├─► needs-human    (FAIL, iteration = max, recoverable)
              └─► failed         (FAIL, iteration = max, not recoverable)
```

Label transitions are atomic: remove outgoing label and apply incoming label in a single API call.

### 4.2 Agent Node Map

| Agent            | Automation Phase | Type            | Notes                                     |
|------------------|------------------|-----------------|-------------------------------------------|
| sprint-controller | Phase 4         | LLM (headless)  | After Workflow 2 is stable                |
| implementer      | Phase 5          | LLM (headless)  | Evaluate per project; highest-risk node   |
| verifier         | Phase 2          | Shell commands  | Priority automation target; no LLM        |
| fixer            | Phase 3          | LLM (headless)  | After verifier is stable                  |
| documenter       | Phase 3          | LLM (headless)  | Lower risk; good first LLM node           |

In Phase 1, all agent nodes are replaced with notification-only nodes. n8n manages label
transitions and sends operator alerts; humans run agents in VS Code.

### 4.3 Fixer Loop Controls

- `maxIterations`: default 5, configurable per Issue via metadata block in Issue body
- On FAIL at `maxIterations`:
  - `recoverable: true` → transition to `needs-human`, write handoff artifact, post Issue comment,
    halt
  - `recoverable: false` → transition to `failed`, post failure summary comment, halt
- `recoverable` is determined from the structured verifier output

### 4.4 Fast Track Variant

When an Issue carries the `fast-track` label, additional controls apply per `AI_RUNTIME_GATES.md`:

- A **Checkpoint Commit** node is injected between the Implementer and Verifier nodes
- Checkpoint commits trigger at every 300–400 changed lines or at each logical boundary
- `validate_test_results.py` is a mandatory gate (not optional)
- The sprint plan must include a bundle map before the Issue can enter the `ready` state

### 4.5 Execution Entry Gate

Before the sprint-controller node runs, the execution engine validates:

1. Issue carries `type:task` or `type:side-quest` label (prevents intake Issues from entering the loop)
2. `human-in-progress` label is absent (mutex check)
3. `architecture_contract_change` flag in Issue body — if `true`, escalate to `needs-human`
   immediately without executing any agent

---

## 5. Workflow 1 — Intake Router

### 5.1 Trigger

GitHub webhook → push event → path filter: `ai_dev_stack/ai_project_tasks/intake/INT-*/INTAKE.md`

### 5.2 Routing Logic

Mirrors the routing decision table in `AI_INTAKE_PROCESS.md`:

| Condition                                         | Route                                                          |
|---------------------------------------------------|----------------------------------------------------------------|
| Scope ≤ 3 slices, no FR change required           | Create Side Quest spec, queue in `next_steps.md`              |
| Requires new or amended FR                        | Open intake triage; notify operator for approval              |
| Requires architecture doc change                  | Open intake triage; notify operator for approval              |
| P0/P1 reconciliation pattern                      | Open RC-* intake; notify operator                             |
| No propagation warranted                          | Write rejection rationale; close intake item                  |

### 5.3 Human Gate

All routing decisions in Workflow 1 are **advisory** — the workflow routes, notifies, and waits for
explicit operator confirmation before propagating downstream changes. Full automation of routing
decisions is Phase 5+ and requires deliberate operator enablement.

---

## 6. Workflow 2 — Phase → Sprint Activator

### 6.1 Trigger

GitHub webhook → push event → path filter: `ai_dev_stack/ai_project_tasks/active/phase_plan_*.md`
Condition: file contains `Status: Active`

### 6.2 Actions

1. Parse phase plan — extract sprint list and task checklist
2. For each sprint in planned sequence: invoke Planner agent (headless) to derive sprint plan file
3. Commit sprint plan file to `ai_dev_stack/ai_project_tasks/active/`
4. For each task in sprint plan: create GitHub Issue with `type:task` and `ready` labels
5. Update `next_steps.md` with new sprint queue entries

---

## 7. Hybrid Execution Model

### 7.1 n8n → VS Code Handoff

1. n8n applies `needs-human` label; removes current state label
2. n8n writes `ai_dev_stack/ai_state/handoff_{task-id}.md` (schema in Artifact Contract)
3. n8n posts a GitHub Issue comment summarizing the handoff context
4. Operator opens VS Code, reads handoff note, runs the appropriate agent in chat
5. Operator applies `human-in-progress` label (disables n8n trigger for this Issue)
6. Operator commits agent output to canonical artifact paths
7. Operator removes `human-in-progress` and `needs-human`; applies next state label (e.g., `verifying`)
8. n8n fires on the new label and resumes from the appropriate node

### 7.2 VS Code → n8n Handoff

1. Operator runs an agent in VS Code and commits output to canonical artifact paths
2. Operator applies the target state label to the GitHub Issue (e.g., `verifying`)
3. n8n trigger fires on the label change and continues from that node forward

### 7.3 Mutex Protocol

The `human-in-progress` label prevents n8n from acting on any label change for a given Issue while
a human session is active. All n8n trigger filters must explicitly exclude Issues carrying this label.

---

## 8. Label Schema

### Type Labels (Issue Classification)

| Label           | Meaning                    |
|-----------------|----------------------------|
| `type:task`     | Regular sprint task        |
| `type:side-quest` | Side quest slice         |
| `type:intake`   | Intake item                |
| `type:phase`    | Phase plan tracking issue  |

### State Labels (State Machine)

| Label                | State                                                   |
|----------------------|---------------------------------------------------------|
| `ready`              | Staged for execution, awaiting sprint-controller        |
| `implementing`       | sprint-controller or implementer running                |
| `verifying`          | Verifier gates running                                  |
| `fix-required`       | Gates failed; fixer queued                              |
| `done`               | All gates passed; PR merged; Issue closed               |
| `failed`             | Max iterations exceeded; unrecoverable                  |
| `needs-human`        | Paused; awaiting human intervention                     |
| `human-in-progress`  | Human session active; n8n suppressed (mutex)            |

### Modifier Labels

| Label        | Meaning                              |
|--------------|--------------------------------------|
| `fast-track` | Fast Track sprint controls apply     |

---

## 9. Referenced Documents

| Document                                 | Purpose                                                       |
|------------------------------------------|---------------------------------------------------------------|
| `docs/n8n-process-flows.md`              | Detailed process flows with node-by-node step logic           |
| `docs/n8n-artifact-state-contract.md`    | Canonical artifact paths, label schema, artifact schemas      |
| `docs/n8n-implementation-phase-plan.md`  | Phased rollout plan with acceptance criteria per phase        |
| `ai_dev_stack/ai_guidance/AI_INTAKE_PROCESS.md`        | Intake routing rules                          |
| `ai_dev_stack/ai_guidance/AI_PHASE_PROCESS.md`         | Phase plan lifecycle                          |
| `ai_dev_stack/ai_guidance/AI_RUNTIME_GATES.md`         | Verifier gate commands                        |
| `ai_dev_stack/ai_guidance/AI_TASK_FLAGS_CONTRACT.md`   | Task flag schema                              |
| `ai_dev_stack/agent-architecture.md`                   | Agent role definitions                        |
# n8n Workflow Design: Autonomous Sprint Execution Loop

## Overview

This document defines a production-grade n8n workflow to orchestrate the following agent loop:

sprint-controller → implementer → verifier → fixer → repeat

The workflow operates as a deterministic state machine using GitHub as the system of record and Node/Python scripts (or API calls) as agent executors.

---

# 1. Core Concepts

## 1.1 Task as State Machine

Each task is represented as:

- GitHub Issue (primary state)
- Repo folder: /tasks/{task-id}/

State is stored in:
- GitHub labels
- status.json file

### Labels

- ready
- in-progress
- implementing
- verifying
- fix-required
- done
- failed

---

## 1.2 Agent Execution Contract

Each agent is invoked as:

input → deterministic output → persisted artifacts

Artifacts written to:
- /tasks/{task-id}/outputs/{agent}.md
- status.json updated

---

# 2. n8n Workflow Structure

## Workflow Name

"Sprint Task Execution Engine"

---

# 3. Node-by-Node Configuration

---

## 3.1 Trigger Node

### Node Type
GitHub Trigger

### Configuration
- Resource: Issue
- Operation: Updated
- Events:
  - labeled
  - opened

### Filter Logic
Only proceed if:
- label == "ready"

---

## 3.2 Fetch Issue Details

### Node Type
GitHub

### Operation
Get Issue

### Output
- issue_number
- title
- body
- labels

---

## 3.3 Parse Task Metadata

### Node Type
Function

### Purpose
Extract structured task info

### Code

const issue = items[0].json;

return [{
  json: {
    taskId: issue.number,
    title: issue.title,
    description: issue.body,
    labels: issue.labels.map(l => l.name)
  }
}];

---

## 3.4 Initialize Task State

### Node Type
Function

### Purpose
Set initial execution context

### Output

{
  taskId,
  iteration: 0,
  maxIterations: 5,
  status: "implementing"
}

---

# 4. MAIN LOOP

---

## 4.1 Sprint Controller Node

### Node Type
Execute Command

### Command

node run-agent.js sprint-controller {{$json.taskId}}

### Expected Output
- task brief
- flags
- scope

### Post Step
Write output to repo via GitHub commit

---

## 4.2 Implementer Node

### Node Type
Execute Command

### Command

node run-agent.js implementer {{$json.taskId}}

### Responsibilities
- read task.md
- generate code
- commit changes
- open/update PR

---

## 4.3 Verifier Node

### Node Type
Execute Command

### Command

node run-agent.js verifier {{$json.taskId}}

### Responsibilities
- run tests
- run lint
- run LLM checklist validation

### Output

{
  status: "PASS" | "FAIL",
  failures: [...]
}

---

## 4.4 Decision Node

### Node Type
IF

### Condition

{{$json.status}} == "PASS"

---

# 5. PASS BRANCH

---

## 5.1 Close Task

### Node Type
GitHub

### Operation
Update Issue

### Actions
- Add label: done
- Remove labels: implementing, verifying, fix-required
- Close issue

---

## 5.2 Merge PR

### Node Type
Execute Command

### Command

gh pr merge {{$json.taskId}} --auto --squash

---

## 5.3 Notify / Log

### Node Type
NoOp or Slack/Log

---

# 6. FAIL BRANCH

---

## 6.1 Increment Iteration

### Node Type
Function

### Code

item.json.iteration += 1;
return item;

---

## 6.2 Check Max Iterations

### Node Type
IF

### Condition

{{$json.iteration}} < {{$json.maxIterations}}

---

## 6.3 Fixer Node

### Node Type
Execute Command

### Command

node run-agent.js fixer {{$json.taskId}}

### Responsibilities
- read verifier output
- apply minimal fix
- commit changes

---

## 6.4 Loop Back to Verifier

### Node Type
Merge (Wait/Loop)

### Behavior
Reconnect to Verifier Node

---

## 6.5 Max Iterations Exceeded

### Node Type
GitHub

### Operation
Update Issue

### Actions
- Add label: failed
- Comment with failure summary

---

# 7. DOCUMENTATION STEP (Post PASS)

---

## 7.1 Documenter Node

### Node Type
Execute Command

### Command

node run-agent.js documenter {{$json.taskId}}

### Responsibilities
- sync docs
- update markdown files
- commit changes

---

# 8. OPTIONAL: STATE PERSISTENCE

---

## 8.1 Save status.json

### Node Type
Execute Command

### Command

node update-status.js {{$json.taskId}} {{$json.status}}

---

# 9. OPTIONAL: RETRY + DELAY

---

## Add Wait Node (Optional)

### Node Type
Wait

### Config
- Delay: 5 seconds

Used between:
- Fixer → Verifier

---

# 10. ERROR HANDLING

---

## Global Error Trigger

### Node Type
Error Trigger

### Actions
- log error
- comment on GitHub issue
- set label: failed

---

# 11. FILE STRUCTURE

---

/tasks/{task-id}/
  task.md
  status.json
  outputs/
    sprint-controller.md
    implementer.md
    verifier.json
    fixer.md
    documenter.md

---

# 12. AGENT SCRIPT CONTRACT

---

## run-agent.js

Input:
- taskId
- agentName

Steps:
1. Load task context
2. Build prompt
3. Call LLM
4. Write output
5. Apply changes (if implementer/fixer)
6. Return structured JSON

---

# 13. SCALING NOTES

---

## Parallel Execution

- Use SplitInBatches node
- Process multiple tasks

---

## Rate Limiting

- Add Wait nodes
- Control concurrency in n8n settings

---

## Observability

- Enable execution logs
- Tag runs with taskId

---

# 14. SUMMARY

---

This workflow:

- externalizes all state
- removes dependency on chat context
- enables deterministic looping
- supports retries and failure handling
- integrates cleanly with GitHub and local scripts

It transforms your agent model into a true CI/CD-like execution engine.