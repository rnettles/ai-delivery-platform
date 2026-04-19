# User Flow Runbook
## AI Delivery Platform — Slack-Driven Pipeline

**Audience:** Developers and team leads using the platform day-to-day  
**Last updated:** 2026-04-19

---

## Overview

The platform is operated entirely through Slack slash commands. A human types a command, the AI pipeline runs one or more agent roles (Planner → Sprint Controller → Implementer → Verifier → Fixer), and at each governance gate the human is presented with interactive buttons to approve, take over, or skip. All notifications arrive in the thread where the pipeline was started.

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
| `/plan [description]` | Free text description | Creates a pipeline starting at **Planner** |
| `/sprint [phase-id]` | Phase ID or description | Creates a pipeline starting at **Sprint Controller** |
| `/implement [task-id]` | Task ID or description | Creates a pipeline starting at **Implementer** |
| `/verify [task-id]` | Task ID or description | Creates a pipeline starting at **Verifier** |
| `/approve [pipeline-id]` | Pipeline ID | Approves the current gate — advances the pipeline |
| `/takeover [pipeline-id]` | Pipeline ID | Pauses the pipeline — you own the current step |
| `/handoff [pipeline-id] [artifact-path]` | Pipeline ID + optional artifact | Marks your human step complete — resumes the pipeline |
| `/status [pipeline-id]` | Pipeline ID | Returns current state of the pipeline run |

> **Pipeline IDs** are shown in every notification message, e.g. `pipe-2026-04-19-abc12345`.

---

## Common Flows

### Flow 1 — Full pipeline from scratch

**Scenario:** You want the AI to plan, sprint, implement, and verify a new feature.

```
1. /plan Build JWT authentication with refresh token support
```

The platform:
- Creates a pipeline run (entry point: `planner`)
- Runs the Planner agent → produces `phase_plan.md`
- Posts in the thread:

```
🤖 Planner completed — ready for review
Artifact: artifacts/phase_plan.md

[ ✅ Approve → Continue ]  [ ✋ Take Over ]
```

**Happy path:** Click **Approve → Continue**  
→ Sprint Controller runs → gate message posted  
→ Click **Approve → Continue**  
→ Implementer runs → gate message posted  
→ Click **Approve → Continue**  
→ Verifier runs → completion or failure message posted

---

### Flow 2 — Start from Sprint Controller (plan already exists)

```
2. /sprint PH-AUTH-1
```

Skips Planner. Entry point: `sprint-controller`. Gate flow is identical from that point.

---

### Flow 3 — Single task implementation

```
3. /implement TASK-AUTH-001
```

Runs Implementer for one task. Entry point: `implementer`. Gate → Verifier → done.

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

---

## Notification Reference

Every notification is posted to the thread that started the pipeline.

| Status | Icon | Message | Buttons |
|---|---|---|---|
| `running` | ⚙️ | `{Step} is now running` | None |
| `awaiting_approval` | 🤖 | `{Step} completed — ready for review` | Approve, Take Over |
| `failed` | ⚠️ | `{Step} failed — needs attention` | Take Over Fix, Skip Step |
| `paused_takeover` | ✋ | `Takeover active — use /handoff when complete` | None |
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
| Create a delivery plan | `/plan [description]` | `planner` |
| Break a plan into sprint tasks | `/sprint [phase-id]` | `sprint-controller` |
| Write code for a task | `/implement [task-id]` | `implementer` |
| Check code against requirements | `/verify [task-id]` | `verifier` |

Each entry point picks up from its position in the pipeline. Agents downstream of the entry point run in sequence; agents upstream are skipped.
