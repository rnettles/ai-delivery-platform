# Slack Interface Design
## Governed AI Software Development Orchestration Platform

---

## 1. Purpose

This document defines the design of the Slack interface layer for the platform — how humans interact with the governed AI development pipeline through Slack, how that interaction maps to execution contracts, and how results flow back to the conversation.

---

## 2. Architectural Position

Slack is a **pure interface layer**. It receives human input and displays execution output. It never executes logic, evaluates governance rules, or makes routing decisions.

```
Human (Slack)
      │
      │  slash command or message event
      ▼
 n8n Slack Ingress Workflow
      │
      │  POST /pipeline  (execution contract envelope)
      ▼
 Execution Service  ──── runs agent role ──── produces artifact
      │
      │  POST {N8N_CALLBACK_URL}/pipeline-notify  (webhook callback)
      ▼
 n8n Pipeline Notifier Workflow
      │
      │  chat.postMessage to Slack thread
      ▼
 Human (Slack thread — action buttons)
      │
      │  button click (approve / take over)
      ▼
 n8n Action Handler Workflow
      │
      │  POST /pipeline/:id/approve  or  /takeover
      ▼
 Execution Service  ──── advances pipeline
```

**Responsibilities by layer:**

| Layer | Owns | Never Does |
|---|---|---|
| Slack | Human input, notifications, action buttons | Logic, routing, governance |
| n8n | Slack credentials, event parsing, HTTP dispatch, thread tracking | Business logic, LLM calls |
| Execution Service | Pipeline state, agent execution, governance enforcement | Slack API calls, credential management |

---

## 3. n8n Owns Slack

Slack credentials (Bot Token, Signing Secret) are stored exclusively in n8n. The Execution Service has no Slack dependency and no Slack SDK. This maintains clean separation and allows the interface layer to be replaced without touching the execution core.

---

## 4. Slash Commands

Slash commands are the primary human entry points. They are registered in the Slack App and delivered to the n8n Slack Ingress webhook.

### 4.1 Command Definitions

| Command | Description | Pipeline Entry Point |
|---|---|---|
| `/plan [mode] [description]` | Start from Planner. Mode defaults to `next` when omitted. | `planner` |
| `/sprint [mode] [phase-id]` | Start from Sprint Controller for a known phase. | `sprint-controller` |
| `/implement [mode] [task-id]` | Execute from Implementer. | `implementer` |
| `/verify [mode] [task-id]` | Run Verifier against existing implementation. | `verifier` |
| `/status` | Show current pipeline run state for this channel | — |
| `/approve` | Approve the current gate — advance pipeline | — |
| `/takeover` | Pause pipeline — human takes current step | — |
| `/handoff` | Mark human step complete — resume pipeline | — |

### 4.2 Command to Execution Contract Mapping

Each command that creates a pipeline run maps to a `POST /pipeline` request:

```json
{
  "entry_point": "planner",
  "execution_mode": "next",
  "input": {
    "description": "Build the authentication module"
  },
  "metadata": {
    "slack_channel": "C0ATR1V0HHP",
    "slack_user": "U0ATA2VKYKY",
    "slack_thread_ts": "1776378304.943649",
    "source": "slack"
  }
}
```

The first token in command text may be `next`, `next-flow`, or `full-sprint`. It is parsed into `execution_mode`; the remaining text becomes `input.description`.

The `slack_channel` and `slack_thread_ts` in `metadata` are stored on the pipeline run so n8n can post all subsequent notifications to the correct thread.

---

## 5. Interactive Messages and Gates

At each human approval gate, the Execution Service posts a callback to n8n which then sends a structured interactive message to the Slack thread.

### 5.1 Gate Message Format

```
🤖 *Planner completed* — Phase Plan ready for review.

Phase: PH-AUTH-1  |  Pipeline: pipe-2026-0419-001
Artifact: project_work/ai_project_tasks/active/phase_plan_auth.md

[ 📄 View Artifact ]  [ ✅ Approve → Continue ]  [ ✋ Take Over ]
```

- **View Artifact** — links to the artifact file path (or Azure Files URL)
- **Approve → Continue** — n8n calls `POST /pipeline/:id/approve`
- **Take Over** — n8n calls `POST /pipeline/:id/takeover`; pipeline pauses and posts a follow-up: "You have taken over this step. Use `/handoff` when complete."

### 5.2 Failure Gate Message Format

When Verifier produces a FAIL result:

```
⚠️ *Verifier found issues* — Task TASK-001 did not pass.

Findings: 3 issues  |  Pipeline: pipe-2026-0419-001
Artifact: project_work/ai_project_tasks/active/verification_result.json

[ 📄 View Findings ]  [ ✋ Take Over Fix ]  [ ⏭ Skip to Close ]
```

### 5.3 Completion Message Format

```
✅ *Pipeline complete* — Sprint task TASK-001 closed.

Commit: abc1234  |  Duration: 4m 12s
Artifacts: phase_plan.md, sprint_plan.md, verification_result.json

[ 📋 View Summary ]
```

---

## 6. n8n Workflow Designs

### 6.1 Workflow: `slack-ingress`

Handles all incoming Slack events and slash commands.

```
Slack Webhook (POST /webhook/slack-events)
    │
    ├── URL verification challenge? → respond immediately
    │
    ▼
Normalize and Guard (Code Node)
    - Extract: user, channel, thread_ts, text or command, payload
    - Filter: discard bot messages (bot_id present)
    - Filter: discard empty text
    │
    ▼
Parse Command (Code Node)
    - Detect slash command or message keyword
    - Extract entry_point, input, params
    │
    ▼
HTTP Request → POST /pipeline
  - Body: { entry_point, execution_mode, input, metadata: { slack_channel, slack_user, slack_thread_ts } }
    │
    ▼
Slack: Post acknowledgement to thread
    "⏳ Starting pipeline run `{pipeline_id}`..."
```

**Notes:**
- The workflow never calls Azure OpenAI or makes execution decisions
- All routing is determined by the slash command — no keyword inference
- `slack_thread_ts` is captured on the first message so all replies stay in-thread

### 6.2 Workflow: `pipeline-notifier`

Called by the Execution Service via webhook callback when a pipeline step completes or reaches a gate.

```
Webhook Trigger (POST /webhook/pipeline-notify)
    │
    ▼
Parse Notification (Code Node)
    - Extract: pipeline_id, step, status, gate_type, artifact_path, slack_channel, slack_thread_ts
    │
    ▼
Switch on notification type
    ├── step_complete + gate_required  → Post gate interactive message (Section 5.1)
    ├── step_complete + no_gate       → Post progress update (informational)
    ├── verifier_fail                 → Post failure gate message (Section 5.2)
    └── pipeline_complete             → Post completion message (Section 5.3)
    │
    ▼
Slack: chat.postMessage (to channel + thread_ts)
```

### 6.3 Workflow: `slack-actions`

Handles Slack interactive component payloads (button clicks from gate messages).

```
Slack Action Webhook (POST /webhook/slack-actions)
    │
    ▼
Parse Action Payload (Code Node)
    - Extract: action_id, pipeline_id, user
    │
    ▼
Switch on action_id
    ├── approve  → POST /pipeline/{pipeline_id}/approve
    ├── takeover → POST /pipeline/{pipeline_id}/takeover
    │              Post: "✋ You have taken over. Use /handoff when done."
    └── skip     → POST /pipeline/{pipeline_id}/skip  { step, justification }
    │
    ▼
Respond 200 to Slack (immediate — Slack requires < 3s response)
```

---

## 7. Execution Service Pipeline API Contract

The Execution Service exposes the following pipeline-specific endpoints (in addition to existing `/executions`, `/coordination` routes):

### POST /pipeline
Create a new pipeline run.

**Request:**
```json
{
  "entry_point": "planner | sprint-controller | implementer | verifier",
  "execution_mode": "next | next-flow | full-sprint",
  "input": { ... },
  "metadata": {
    "slack_channel": "C0ATR1V0HHP",
    "slack_user": "U0ATA2VKYKY",
    "slack_thread_ts": "1776378304.943649",
    "source": "slack | api"
  }
}
```

**Response:**
```json
{
  "pipeline_id": "pipe-2026-0419-001",
  "status": "running",
  "current_step": "planner",
  "created_at": "2026-04-19T14:30:00Z"
}
```

### GET /pipeline/:id
Get current pipeline run state.

### POST /pipeline/:id/approve
Advance past the current gate.

### POST /pipeline/:id/takeover
Pause pipeline; record human as active owner of current step.

### POST /pipeline/:id/handoff
Resume pipeline from current step; human signals step is complete.
**Body:** `{ "artifact_path": "..." }` (optional — human-produced artifact reference)

### POST /pipeline/:id/skip
Advance past current step without completing it.
**Body:** `{ "step": "...", "justification": "..." }`

---

## 8. Correlation and Thread Tracking

Every pipeline run stores `slack_channel` and `slack_thread_ts` from the originating command. All n8n notifications post to that exact thread, creating a persistent, in-thread history of the pipeline run visible to the whole team.

If a pipeline run is created via API (not Slack), the callback still fires to `N8N_CALLBACK_URL` but no Slack post is made (n8n detects absence of `slack_channel` in metadata).

---

## 9. Signing Secret Verification

The n8n Slack Ingress workflow must verify the `X-Slack-Signature` header on all inbound requests using the Signing Secret. This prevents unauthorized requests from triggering pipeline runs.

n8n supports this via the webhook node's credential configuration. The Signing Secret is stored in n8n credentials — never in environment variables on the Execution Service.

---

## 10. Environment Variables

### Execution Service (Azure Container App)
| Variable | Description |
|---|---|
| `N8N_CALLBACK_URL` | Base URL of n8n instance for pipeline notifications |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint for agent role LLM calls |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name (e.g., `gpt-4.1`) |

### n8n (managed in n8n credentials, not env vars)
| Credential | Description |
|---|---|
| `slackApi` | Slack Bot Token (already provisioned, id: `JazA00WJJZbm0w6V`) |
| Slack Signing Secret | Used for webhook verification |
| `azureOpenAiApi` | Azure OpenAI credentials (already provisioned, id: `tPGCvKIB9UzCyiOW`) |

---

## 11. Security Considerations

- Slack Signing Secret validation is mandatory on all inbound Slack webhooks
- Pipeline IDs in Slack action payloads must be validated as existing runs before `approve`/`takeover` actions are accepted
- `slack_user` is recorded on all pipeline operations for audit purposes
- n8n webhook URLs should not be publicly guessable (use UUIDs as webhook path tokens)
- The Execution Service callback endpoint (`/pipeline-notify`) should require a shared secret header verified by n8n before posting
