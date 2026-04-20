# User Flow Runbook
## AI Delivery Platform — Slack-Driven Pipeline

**Audience:** Developers and team leads using the platform day-to-day  
**Last updated:** 2026-04-20

---

## Overview

The platform is operated through Slack slash commands. A human types a command, the AI pipeline runs one or more agent roles (Planner → Sprint Controller → Implementer → Verifier), and posts progress to the originating thread.

```
Human (Slack)
    │  slash command
    ▼
n8n Slack Ingress  →  POST /pipeline  →  Execution Service
                                              │  agent runs
                                              │  POST /pipeline-notify  →  n8n Notifier
                                              ▼
                                         Slack thread (gate buttons)
    │  button click
    ▼
n8n Action Handler  →  POST /pipeline/:id/{approve|takeover|skip}  →  Execution Service
```

---

## Slash Command Reference

| Command | Arguments | What it does |
|---|---|---|
| `/plan [mode] [description]` | Optional mode + free text description | Creates a pipeline starting at **Planner** |
| `/sprint [mode] [phase-id]` | Optional mode + phase ID or description | Creates a pipeline starting at **Sprint Controller** |
| `/implement [mode] [task-id]` | Optional mode + task ID or description | Creates a pipeline starting at **Implementer** |
| `/verify [mode] [task-id]` | Optional mode + task ID or description | Creates a pipeline starting at **Verifier** |
| `/approve [pipeline-id]` | Pipeline ID | Approves the current gate — advances the pipeline |
| `/takeover [pipeline-id]` | Pipeline ID | Pauses the pipeline — you own the current step |
| `/handoff [pipeline-id] [artifact-path]` | Pipeline ID + optional artifact | Marks your human step complete — resumes the pipeline |
| `/status [pipeline-id]` | Optional pipeline ID | Returns current state for that pipeline ID, or the latest pipeline for your channel when omitted |

`mode` values:
- `next` (default): run only the entry role, then stop
- `next-flow`: continue downstream flow; non-planner entry points stop on Verifier PASS
- `full-sprint`: full sprint flow — chains all the way through Verifier PASS to Sprint Controller close-out (PR), regardless of entry point

> **Pipeline IDs** are shown in every notification message, e.g. `pipe-2026-04-19-abc12345`.

---

## Common Flows

### Flow 1 — Full pipeline from scratch

**Scenario:** You want the AI to plan, sprint, implement, and verify a new feature.

```
1. /plan next-flow Build JWT authentication with refresh token support
```

The platform:
- Creates a pipeline run (entry point: `planner`, mode: `next-flow`)
- Runs Planner → Sprint Controller → Implementer → Verifier
- Posts progress in the thread as each step starts/completes

If you omit mode (`/plan ...`), mode defaults to `next` and only Planner runs.

```
🤖 Planner completed
Artifact: artifacts/phase_plan.md
```

---

### Flow 2 — Start from Sprint Controller (plan already exists)

```
2. /sprint next-flow PH-AUTH-1
```

Skips Planner. Entry point: `sprint-controller`. Continues through downstream flow and stops on Verifier PASS.

---

### Flow 3 — Single task implementation

```
3. /implement next-flow TASK-AUTH-001
```

Runs Implementer for one task. Entry point: `implementer`. Continues to Verifier and stops on PASS.

During this flow, Implementer commits and pushes incrementally to the task feature branch associated with the sprint.

---

### Flow 4 — Approving a gate via button

When a gate message appears in the thread, click **✅ Approve → Continue**.  
n8n sends `POST /pipeline/pipe-2026-04-19-abc12345/approve` and the next step begins.

Alternatively, use the slash command if the button is no longer visible:
```
/approve pipe-2026-04-19-abc12345
```

---

### Flow 5 — Taking over a step manually

At any gate message, click **✋ Take Over** (or type `/takeover [pipeline-id]`).

The pipeline pauses and the thread posts:
```
✋ Takeover active — A human owns the Implementer step on pipeline pipe-2026-04-19-abc12345.
Use /handoff pipe-2026-04-19-abc12345 when complete.
```

You do the work yourself (write code, edit artifacts, commit). When done:
```
/handoff pipe-2026-04-19-abc12345 artifacts/implementation_result.md
```
The pipeline resumes from where it paused.

---

### Flow 6 — Handling a failure

If Verifier or another agent fails, the thread posts:
```
⚠️ Verifier failed — pipe-2026-04-19-abc12345 needs attention.

[ ✋ Take Over Fix ]  [ ⏭ Skip Step ]
```

**Option A — Take Over Fix:** Click the button (or `/takeover pipe-2026-04-19-abc12345`).  
Fix the issue manually. Then `/handoff` to resume.

**Option B — Skip Step:** Click **⏭ Skip Step** to move past the failed step.  
Use this when the failure is a known fluke and does not block delivery.

---

### Flow 7 — Checking pipeline status

```
/status pipe-2026-04-19-abc12345
```

Returns the current status (`running`, `awaiting_approval`, `failed`, `complete`, `paused_takeover`) and the active step.

For sprint close-out flows, status may also be `awaiting_pr_review`.

You can also omit the ID:

```
/status
```

When omitted, the platform returns the latest pipeline for your Slack channel. This is useful when a `next` mode run completes quickly and is no longer in an active state.

---

## Notification Reference

Every notification is posted to the thread that started the pipeline.

| Status | Icon | Message | Buttons |
|---|---|---|---|
| `running` | ⚙️ | `{Step} is now running` | None |
| `awaiting_approval` | 🤖 | `{Step} completed — ready for review` | Approve, Take Over |
| `failed` | ⚠️ | `{Step} failed — needs attention` | Take Over Fix, Skip Step |
| `paused_takeover` | ✋ | `Takeover active — use /handoff when complete` | None |
| `awaiting_pr_review` | 🔎 | `Sprint PR opened — waiting for review/merge` | None |
| `complete` | ✅ | `Pipeline complete` with artifact list | None |

---

## Error Conditions

### "I don't see any buttons"

Slack interactive buttons expire after a period. Use the slash command equivalent instead (e.g. `/approve [pipeline-id]`).

### Pipeline stuck in `running`

The agent may have errored silently. Check:
1. `/status [pipeline-id]` — confirm the state
2. Check the n8n execution log for the `pipeline-notifier` workflow
3. If stuck, use `/takeover [pipeline-id]` to assume control

### "Unknown command" response in Slack

The command was not recognised. Check the **Slash Command Reference** table above for supported commands. Ensure you are typing the command (starting with `/`) not prose text.

### Callback not arriving in Slack thread

The Execution Service may not have the correct `N8N_CALLBACK_URL`. Verify the `N8N_CALLBACK_URL` environment variable on the execution service container in Azure (see `DevOps/terraform/environments/ai-orchestrator/dev/variables.tf`).

---

## Architecture Quick Reference

| Component | What it does | Where |
|---|---|---|
| n8n `slack-ingress` workflow | Receives slash commands → calls `/pipeline` API | `platform/workflow/slack-ingress.json` |
| n8n `pipeline-notifier` workflow | Receives execution callbacks → posts to Slack | `platform/workflow/pipeline-notifier.json` |
| n8n `slack-action-handler` workflow | Handles button clicks → calls `/pipeline/:id/{action}` | `platform/workflow/slack-action-handler.json` |
| Execution Service `/pipeline` API | Creates and advances pipeline runs | `platform/backend-api/src/` |
| Pipeline state machine | Governs transitions (`running` → `awaiting_approval` → ...) | `platform/backend-api/src/pipeline.service.ts` |

---

## Entry Points by Role

| You want the AI to... | Command | Entry point |
|---|---|---|
| Create a delivery plan | `/plan [mode] [description]` | `planner` |
| Break a plan into sprint tasks | `/sprint [mode] [phase-id]` | `sprint-controller` |
| Write code for a task | `/implement [mode] [task-id]` | `implementer` |
| Check code against requirements | `/verify [mode] [task-id]` | `verifier` |

Each entry point picks up from its position in the pipeline. Agents downstream of the entry point run in sequence; agents upstream are skipped.

---

## Role Command Mode Matrix

The execution mode controls how far downstream a pipeline propagates after the entry role completes.

| Entry point | `next` | `next-flow` | `full-sprint` |
|---|---|---|---|
| `planner` | Planner only → stop | Planner → Sprint Controller → Implementer → Verifier → stop | Planner → Sprint Controller → Implementer → Verifier → Sprint close-out (PR) |
| `sprint-controller` | Sprint Controller only → stop | Sprint Controller → Implementer → Verifier → stop | Sprint Controller → Implementer → Verifier → Sprint close-out (PR) |
| `implementer` | Implementer only → stop | Implementer → Verifier → stop | Implementer → Verifier → Sprint close-out (PR) |
| `verifier` | Verifier only → stop | Verifier → stop on PASS | Verifier → Sprint close-out (PR) on PASS |

**Verifier FAIL** always routes back to Implementer for a retry, regardless of mode, up to 3 total attempts before cancellation.

**Sprint close-out** = Sprint Controller opens a PR on the feature branch and transitions the pipeline to `awaiting_pr_review`.

---

## Reporting Lifecycle

Every pipeline run uses a **hybrid async reporting model**: immediate acknowledgement, rolling progress updates, and a single terminal summary.

```
1. Immediate ACK (synchronous, < 1s)
   ─────────────────────────────────
   POST /pipeline → 202 Accepted  (pipeline_id + status: running)
   Slack n8n ingress relays this back to the user before any agent work begins.

2. Progress Updates (asynchronous, during execution)
   ─────────────────────────────────────────────────
   Each agent role may emit progress events via context.notify().
   These POST to /webhook/pipeline-notify in n8n, which posts context blocks
   to the Slack thread (no buttons).

   Examples:
   ⚙️ Breaking phase plan into sprint tasks...
   🎯 First task identified: TASK-AUTH-001 — Add JWT refresh token support
   🌿 Branch feature/task-auth-001-sprint-s01 created and ready
   📝 Writing src/auth/refresh.service.ts

3. Terminal Summary (on pipeline reaching a terminal state)
   ─────────────────────────────────────────────────────────
   Triggered when pipeline status becomes:
     complete, awaiting_approval, awaiting_pr_review, failed, cancelled

   The summary includes:
   - Status icon and human-readable status
   - Current step and artifact list (where applicable)
   - Action buttons (Approve, Take Over, Skip) for interactive states
   - Sprint PR link for awaiting_pr_review
```

**Thread continuity**: all notifications post to `slack_thread_ts` captured from the originating command. This ensures all progress for a pipeline appears as a single collapsible thread, not a flood of top-level messages.
