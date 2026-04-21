# Local Execution Environment Runbook
## AI Delivery Platform — Local Development and Debug Guide

**Audience:** Developers running and debugging the execution service outside containers  
**Last updated:** 2026-04-21  
**See also:** [governance-operator-runbook.md](governance-operator-runbook.md) | [user-flow-runbook.md](user-flow-runbook.md)

---

## Overview

This runbook describes how to run the AI Delivery Platform locally without Docker for day-to-day debugging and observation.

Two local modes are supported:

| Mode | What runs locally | Best for |
|---|---|---|
| **Backend-only** | Execution service + Postgres | API development, role script debugging, execution record inspection |
| **Full local orchestration** | Backend + local n8n, optional Slack | End-to-end pipeline flow testing without Azure |

The repository already supports local execution through `npm run dev`, dotenv loading, and explicit local-dev defaults built into the config. n8n callbacks and git sync are gracefully skipped when their respective env vars are absent.

```
Local dev flow (backend-only):

  curl / REST client
       │
       ▼
  Execution Service  (npm run dev, localhost:3000)
       │
       ▼
  Local Postgres  (execution records, pipeline state)
       │
       ▼
  Local filesystem  (artifacts/, repo/)
```

---

## What Is Required vs Optional

| Component | Backend-only | Full local orchestration | Notes |
|---|---|---|---|
| Node.js 20+ | Yes | Yes | Backend runtime |
| Local Postgres 15+ | Yes | Yes | Execution records and pipeline state |
| LLM provider credentials | No (test script only) | Yes (for role execution) | Planner, Sprint Controller, Implementer, Verifier all call LLM |
| Local n8n | No | Yes | Pipeline notifications and Slack adapter workflows |
| Slack app + tunnel | No | Optional | Required only for slash command / button flows |
| Git PAT + repo URL | No | Optional | Service no-ops on missing repo vars |

---

## 1. Prerequisites

Install the following on your local machine:

1. **Node.js 20+** and **npm** — `node --version` to confirm
2. **PostgreSQL 15+** running as a local service
3. **git** — required for any pipeline role that commits artifacts
4. Optional: **n8n** (npm package or desktop app) for orchestration
5. Optional: **ngrok** or similar tunnel if Slack must reach local n8n webhooks

---

## 2. Environment Setup

### 2.1 Copy the env template

From `platform/backend-api/`:

```bat
copy .env.example .env
```

### 2.2 Edit `.env` for local dev

Minimum values for backend-only mode:

```dotenv
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Postgres — create this database before running migrations (see Section 3)
DATABASE_URL=postgresql://user:password@localhost:5432/ai_orchestrator_dev_state

# Governance content path — relative to platform/backend-api/
GOVERNANCE_PATH=../governance

# Local artifact storage
ARTIFACT_BASE_PATH=./artifacts

# Repo clone path — use a local path instead of the container default (/mnt/repo)
GIT_CLONE_PATH=./repo

# Leave empty for backend-only mode — service skips notification when unset
N8N_CALLBACK_URL=

# Leave empty for backend-only mode — service skips git sync when unset
GIT_REPO_URL=
GIT_PAT=

# Leave empty for local no-auth mode — middleware passes through when API_KEY is unset
API_KEY=
```

LLM provider — add at least one if you intend to run role scripts (Planner, Sprint Controller, Implementer, Verifier):

```dotenv
# Option A: Azure OpenAI or OpenAI-compatible
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=gpt-4.1

# Option B: Anthropic
LLM_ANTHROPIC_API_KEY=<key>

# Option C: GitHub Models (uses your GIT_PAT by default — no extra key needed if GIT_PAT is set)
LLM_GITHUB_MODELS_API_KEY=
```

---

## 3. Database Setup

### 3.1 Create the local database

```bat
createdb ai_orchestrator_dev_state
```

Or using psql:

```sql
CREATE DATABASE ai_orchestrator_dev_state;
```

### 3.2 Run migrations

From `platform/backend-api/`:

```bat
npm install
npm run db:migrate
```

This applies all versioned Drizzle migrations from `platform/backend-api/drizzle/`.

---

## 4. Start the Backend

From `platform/backend-api/`:

```bat
npm run dev
```

This starts `tsx watch src/server.ts` — the server restarts automatically on file changes.

**Expected startup output:**

```
Execution service started { port: 3000, environment: "development" }
```

---

## 5. Smoke Tests

### 5.1 Health check

```bat
curl http://localhost:3000/health
```

Expected:

```json
{ "status": "ok" }
```

The `/health` endpoint is unauthenticated and exempt from API key middleware.

### 5.2 List registered scripts and role bindings

```bat
curl http://localhost:3000/scripts
```

Returns all registered scripts and role-to-script bindings. Confirm `test.echo`, `role.planner`, `role.sprint-controller`, `role.implementer`, and `role.verifier` appear.

### 5.3 Execute test echo script (no LLM required)

Use this first to verify the full execution pipeline — request validation, script runner, DB write — without needing LLM credentials:

```bat
curl -X POST http://localhost:3000/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"target\":{\"type\":\"script\",\"name\":\"test.echo\",\"version\":\"2026.04.18\"},\"input\":{\"message\":\"hello-local\"}}"
```

Expected response contains `"ok": true` and an echoed copy of the input.

### 5.4 Retrieve the execution record

Copy the `execution_id` from the previous response and query it:

```bat
curl http://localhost:3000/executions/<execution_id>
```

### 5.5 Create a pipeline run (requires LLM credentials for role execution)

```bat
curl -X POST http://localhost:3000/pipeline ^
  -H "Content-Type: application/json" ^
  -d "{\"entry_point\":\"planner\",\"execution_mode\":\"next\",\"input\":{\"description\":\"local test feature\"},\"metadata\":{\"source\":\"api\"}}"
```

Returns `202 Accepted` with a `pipeline_id`. Role execution is asynchronous — check status with:

```bat
curl http://localhost:3000/pipeline/<pipeline_id>
```

---

## 6. API Key Behavior in Local Dev

| `API_KEY` set? | Behavior |
|---|---|
| Not set | All routes pass through — no auth required |
| Set | `x-api-key: <value>` header required on all non-health requests |

When `API_KEY` is set, include the header:

```bat
curl http://localhost:3000/pipeline/<id> ^
  -H "x-api-key: <your_key>"
```

---

## 7. Optional: Full Local Orchestration with n8n

If you want pipeline notifications and want to test the orchestration layer locally:

### 7.1 Start local n8n

```bat
npx n8n
```

n8n runs on `http://localhost:5678` by default.

### 7.2 Set the callback URL in `.env`

```dotenv
N8N_CALLBACK_URL=http://localhost:5678/webhook
```

### 7.3 Import and activate workflows

In the n8n UI, import and activate:

- `platform/workflow/slack-ingress.json`
- `platform/workflow/slack-action-handler.json`
- `platform/workflow/pipeline-notifier.json`

### 7.4 Set required n8n env vars

n8n reads `EXECUTION_API_BASE_URL` and `EXECUTION_API_KEY` via `$env` expressions in workflow nodes. Set these in the n8n environment or `.env` before starting n8n:

| Variable | Local value |
|---|---|
| `EXECUTION_API_BASE_URL` | `http://localhost:3000` |
| `EXECUTION_API_KEY` | Same value as `API_KEY` on the backend |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` |
| `N8N_BLOCK_RUNNER_ENV_ACCESS` | `false` |

---

## 8. Optional: Slack End-to-End

For slash commands and interactive buttons pointing at local n8n:

1. Create a Slack app from `platform/workflow/slack-app-manifest.json` (see [governance-operator-runbook.md](governance-operator-runbook.md#L295)).
2. Start a tunnel to expose local n8n webhooks publicly (e.g. ngrok pointing at port 5678).
3. Update manifest URLs to your tunnel host before creating the Slack app.
4. Install the Slack app to your workspace and test a slash command.

---

## 9. Debugging Reference

### Service starts but requests fail with 401 or 403

`API_KEY` is set. Add `-H "x-api-key: <value>"` to requests, or unset `API_KEY` for local dev.

### Execution request returns validation error

Confirm `target.type` is `"script"` or `"role"`, `target.version` is an explicit version string (not `latest`), and `input` is a JSON object. Validation schema is in `platform/backend-api/src/services/validation.service.ts`.

### Role execution fails with "no provider configured"

No LLM credentials are set. Add at least one provider to `.env` (Azure OpenAI, Anthropic, or GitHub Models). Provider resolution order is `openai-compat` → `anthropic` → `github-models`.

### Pipeline creates but roles do not execute

Role execution is async — execution errors appear in server console, not in the `POST /pipeline` response. Watch `npm run dev` terminal output for `execution failed` log lines.

### Pipeline notifier logs "N8N_CALLBACK_URL not configured — skipping notification"

Expected in backend-only mode. Set `N8N_CALLBACK_URL` and start local n8n to enable notifications.

### Git sync logs "GIT_REPO_URL not configured, skipping sync"

Expected when `GIT_REPO_URL` is empty. Set `GIT_REPO_URL` and `GIT_PAT` only when testing project bootstrap, git commit, or PR creation flows.

### Governance service fails to load prompts or rules

Confirm `GOVERNANCE_PATH=../governance` (relative to `platform/backend-api/`). Verify `platform/governance/manifest.json` exists and `version` is set.

---

## 10. Local Profile Reference

### Profile A — Fast backend debug

Use when developing API logic, role scripts, or execution pipeline behavior.

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/ai_orchestrator_dev_state
GOVERNANCE_PATH=../governance
ARTIFACT_BASE_PATH=./artifacts
GIT_CLONE_PATH=./repo
# All other vars empty
```

Test with `test.echo` script. No LLM, no n8n, no Slack needed.

---

### Profile B — Role execution debug

Use when testing Planner, Sprint Controller, Implementer, or Verifier role behavior end-to-end.

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/ai_orchestrator_dev_state
GOVERNANCE_PATH=../governance
ARTIFACT_BASE_PATH=./artifacts
GIT_CLONE_PATH=./repo
GIT_REPO_URL=https://github.com/rnettles/ai-delivery-platform.git
GIT_PAT=<pat>
# Add one LLM provider:
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
```

---

### Profile C — Full local orchestration

Use when testing pipeline notifications, n8n workflow logic, or Slack integration without Azure.

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/ai_orchestrator_dev_state
GOVERNANCE_PATH=../governance
ARTIFACT_BASE_PATH=./artifacts
GIT_CLONE_PATH=./repo
GIT_REPO_URL=https://github.com/rnettles/ai-delivery-platform.git
GIT_PAT=<pat>
N8N_CALLBACK_URL=http://localhost:5678/webhook
# LLM provider (any)
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
```

Start n8n separately with `EXECUTION_API_BASE_URL=http://localhost:3000`.
