# ADR-034: Native Slack Integration (Deprecation of n8n as Slack Adapter)

## Status
Accepted

## Date
2026-05-01

## Deciders
- Product Engineering
- Platform Architecture

## Supersedes
- ADR-023 (n8n as Slack Interface Adapter)

---

## Context

ADR-023 established n8n as the exclusive Slack interface adapter. n8n held all
Slack credentials, handled webhook verification, parsed slash commands, and
posted messages to Slack. The Execution Service had no Slack dependency.

This architecture introduced operational overhead:

- A separate n8n process must be kept running and maintained.
- Two-hop latency: Slack → n8n → Execution Service and back.
- Slack credentials and signing secrets are stored in n8n's credential store,
  separate from the Execution Service's configuration surface.
- n8n Code node logic (parsing, message building) must be kept in sync with the
  canonical TypeScript source in the Execution Service.
- Deployment complexity: both n8n and the Execution Service must be configured,
  versioned, and deployed as a pair.

The Execution Service already contains the canonical implementations of all
three n8n workflow Code nodes:

| n8n Workflow | Canonical Source |
|---|---|
| `slack-ingress` Guard & Parse | `src/workflow-logic/slack-ingress.logic.ts` |
| `pipeline-notifier` Build Slack Message | `src/workflow-logic/pipeline-notifier.logic.ts` |
| `slack-action-handler` Parse Slack Payload | `src/workflow-logic/slack-action.logic.ts` |

These files were the tested reference implementations. The n8n Code nodes were
copies of their logic. With the logic already inside the Execution Service,
n8n's only remaining role was to hold Slack credentials and make HTTP calls.

---

## Decision

**n8n is deprecated as the Slack interface adapter.**

The Execution Service SHALL own Slack directly:

- Register and verify inbound Slack webhooks (`/slack/events`, `/slack/actions`)
- Hold `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` as environment variables
- Post pipeline notifications directly to Slack via `chat.postMessage`
- Handle slash commands and interactive button actions natively

---

## Architecture

```
Human (Slack)
      │
      │  slash command or button click
      ▼
Execution Service  POST /slack/events  or  POST /slack/actions
      │  (verify X-Slack-Signature, parse command / action)
      │
      ├── Create pipeline  →  pipelineService.create()
      ├── Approve / Takeover / Skip / Handoff  →  pipelineService.<action>()
      └── Status  →  pipelineService.getCurrentStatusSummary()
      │
      │  pipeline step completes
      │
      ▼
PipelineNotifierService.notify()
      │  builds Slack message via buildSlackMessage()
      │
      ▼
SlackService.postMessage()
      │  POST https://slack.com/api/chat.postMessage
      ▼
Human (Slack thread — action buttons)
```

---

## New Endpoint Contract

### POST /slack/events

Receives Slack Event API callbacks and slash commands.

- Content-Type: `application/json` (Event API) or `application/x-www-form-urlencoded` (slash commands)
- Authenticated via `X-Slack-Signature` HMAC-SHA256 verification
- URL verification challenge is handled synchronously
- Slash commands return `200 {}` immediately; pipeline creation is fire-and-forget
- `/status` is synchronous (read-only)

### POST /slack/actions

Receives Slack interactive component payloads (button clicks on gate messages).

- Content-Type: `application/x-www-form-urlencoded` with JSON `payload` key
- Authenticated via `X-Slack-Signature` HMAC-SHA256 verification
- Returns `200 {}` immediately; action is executed asynchronously

---

## Environment Variables

### Execution Service

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth token (`xoxb-...`) for posting messages via `chat.postMessage` |
| `SLACK_SIGNING_SECRET` | From Slack App → Basic Information → App Credentials — used to verify inbound webhook signatures |
| `N8N_CALLBACK_URL` | **Deprecated** — kept for backward compatibility during migration; remove when n8n is decommissioned |

### Security

- `SLACK_SIGNING_SECRET` is used to compute `HMAC-SHA256(secret, "v0:{timestamp}:{raw_body}")` and compare with `X-Slack-Signature`.
- Requests older than 5 minutes are rejected to prevent replay attacks.
- Slack routes are mounted before the `apiKeyMiddleware`; they authenticate exclusively via the Slack signing secret.

---

## Migration Strategy

Both transports can coexist:

1. **Native Slack (SLACK_BOT_TOKEN)** — posts directly to Slack Web API.
2. **n8n callback (N8N_CALLBACK_URL)** — forwards notifications to n8n (legacy).

When `SLACK_BOT_TOKEN` is configured, the Execution Service posts to Slack directly.
When `N8N_CALLBACK_URL` is also present, both transports run concurrently.
When n8n is fully decommissioned, remove `N8N_CALLBACK_URL` from configuration.

---

## Consequences

### Positive

- Eliminates n8n as a runtime dependency for Slack
- Reduces two-hop latency to a single hop
- Consolidates Slack credentials into the Execution Service configuration
- Removes the Code node sync requirement — logic is used directly
- Simpler deployment topology
- The `/pipeline` API remains fully usable without Slack (API-first design)

### Negative

- The Execution Service now holds Slack credentials (Bot Token, Signing Secret)
  — these must be stored as Azure secrets in production
- Future non-Slack interfaces must be implemented directly in the Execution Service
  or via a dedicated adapter service, not n8n

### Neutral

- n8n can still be retained for other workflow automation purposes if needed
- Existing `workflow-logic/*.ts` files remain as the canonical Slack logic source

---

## Related ADRs

- ADR-009 — Execution Service
- ADR-013 — Execution Service API Contract
- ADR-021 — Conversational Interface
- ADR-023 — n8n as Slack Interface Adapter (superseded by this ADR)
