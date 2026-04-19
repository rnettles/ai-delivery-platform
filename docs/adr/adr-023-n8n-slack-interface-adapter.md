# ADR-023: n8n as Slack Interface Adapter

## Status
Accepted

## Date
2026-04-19

## Deciders
- Product Engineering
- Platform Architecture

---

## Context

ADR-021 established that the system shall implement a conversational interface and that Slack shall be treated as an interface client, not an execution environment.

ADR-007 established n8n as the orchestration engine responsible for workflow sequencing and routing.

The practical question is: **where do Slack credentials, event handling, and message formatting live?**

Two options were considered:

**Option A — Execution Service owns Slack**
The Execution Service integrates `@slack/bolt` or `@slack/web-api` directly, handles webhook verification, slash command parsing, and posts notifications to Slack.

**Option B — n8n owns Slack**
n8n holds all Slack credentials and handles all Slack I/O. The Execution Service is notified via HTTP callbacks from n8n and calls back to n8n when pipeline events occur. The Execution Service has no Slack dependency.

---

## Decision

**Option B is adopted.** n8n SHALL be the exclusive Slack interface adapter.

The Execution Service SHALL NOT:
- Hold Slack Bot Tokens or Signing Secrets
- Import Slack SDKs
- Call Slack APIs directly
- Embed message formatting logic

n8n SHALL:
- Register Slack App credentials
- Receive and verify inbound Slack webhooks (slash commands, events, interactive actions)
- Parse and normalize Slack payloads into canonical pipeline requests
- Forward requests to the Execution Service via HTTP
- Receive pipeline status notifications via webhook callback
- Format and post Slack messages (interactive gates, progress updates, completions)

---

## Core Principle

> n8n is the Slack operator.  
> The Execution Service is the intelligence.  
> Neither knows the other's internal structure.

---

## Interface Contract

The boundary between n8n and the Execution Service is defined by two HTTP contracts:

### 1. Slack → n8n → Execution Service (inbound)

n8n receives Slack events and POSTs structured requests to the Execution Service:

```
POST /pipeline       — create a pipeline run
POST /pipeline/:id/approve
POST /pipeline/:id/takeover
POST /pipeline/:id/handoff
POST /pipeline/:id/skip
```

n8n is responsible for mapping Slack slash commands and interactive action payloads to these endpoints. The Execution Service has no knowledge of Slack command syntax.

### 2. Execution Service → n8n → Slack (outbound)

When a pipeline step completes or a gate is reached, the Execution Service POSTs a notification to the configured callback URL:

```
POST {N8N_CALLBACK_URL}/webhook/pipeline-notify
{
  "pipeline_id": "...",
  "step": "planner",
  "status": "complete",
  "gate_required": true,
  "artifact_paths": [...],
  "slack_channel": "...",
  "slack_thread_ts": "..."
}
```

n8n receives this, constructs the appropriate Slack message, and posts it. The Execution Service has no knowledge of Slack message format or channel IDs at callback time — it only passes through the metadata originally provided when the pipeline run was created.

---

## Rationale

**Credential isolation:** Slack Bot Tokens are sensitive long-lived credentials. Keeping them in n8n's credential store (which is purpose-built for secure credential management) is safer than managing them as execution service environment secrets.

**Replaceability:** The Slack interface can be replaced with Teams, Discord, or a web UI by replacing only the n8n workflows. The Execution Service is unchanged.

**Consistency with ADR-007:** n8n is already the orchestration layer. Giving it Slack ownership is consistent with its role as the I/O and routing layer rather than an execution layer.

**Simplicity:** The Execution Service remains a pure HTTP API. It has no runtime Slack dependency, no webhook signature verification complexity, and no message formatting logic.

---

## n8n Workflows

Three n8n workflows implement the Slack adapter:

| Workflow | Trigger | Responsibility |
|---|---|---|
| `slack-ingress` | Slack webhook (events + slash commands) | Parse → forward to Execution Service |
| `pipeline-notifier` | Execution Service callback | Format → post to Slack thread |
| `slack-actions` | Slack interactive action webhook | Route button clicks to Execution Service |

These workflows contain only I/O logic: normalization, HTTP calls, and message formatting. They contain no business logic, governance rules, or LLM calls.

---

## Consequences

### Positive
- Execution Service has zero Slack dependency — fully testable without Slack
- Credential surface area reduced on the Execution Service
- Interface replacement is isolated to n8n workflows
- n8n's built-in Slack credentials and nodes handle auth complexity

### Negative
- Two-hop latency: Slack → n8n → Execution Service (acceptable; < 1s)
- n8n must be operational for Slack interface to function (acceptable; n8n is already a required platform component)
- Callback URL configuration (`N8N_CALLBACK_URL`) must be kept in sync across environments

### Neutral
- The `/pipeline` API is fully usable without Slack (API-first design)
- Future non-Slack interfaces can be added as additional n8n workflows targeting the same pipeline API

---

## Related ADRs
- ADR-007: n8n as Orchestration Engine
- ADR-021: Conversational Interface and Command Model
- ADR-022: Multi-Agent Pipeline Execution Model
- ADR-024: Pipeline Human Override and Takeover Model
