# Local Execution Environment Runbook
## AI Delivery Platform — Local Development and Debug Guide

**Audience:** Developers running and debugging the execution service outside containers  
**Last updated:** 2026-04-22 (REST Client + API surface + project create syntax)  
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

  REST Client (.http files)  or  PowerShell (Invoke-RestMethod)
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

From PowerShell at the repo root:

```powershell
Set-Location platform/backend-api
Copy-Item .env.example .env
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

```powershell
createdb ai_orchestrator_dev_state
```

Or using psql:

```sql
CREATE DATABASE ai_orchestrator_dev_state;
```

### 3.2 Run migrations

From PowerShell at the repo root:

```powershell
Set-Location platform/backend-api
npm install
npm run db:migrate
```

This applies all versioned Drizzle migrations from `platform/backend-api/drizzle/`.

---

## 4. Start the Backend

From PowerShell at the repo root:

```powershell
Set-Location platform/backend-api
npm run dev
```

This starts `tsx watch src/server.ts` — the server restarts automatically on file changes.

**Expected startup output:**

```
Execution service started { port: 3000, environment: "development" }
```

---

## 5. Smoke Tests

PowerShell note: prefer `Invoke-RestMethod` for JSON API calls. In many Windows environments, `curl` maps to a PowerShell alias and can mis-handle quoted JSON request bodies.

### 5.1 Health check

```powershell
Invoke-RestMethod http://localhost:3000/health | ConvertTo-Json -Depth 10
```

Expected:

```json
{ "status": "ok" }
```

The `/health` endpoint is unauthenticated and exempt from API key middleware.

### 5.2 List registered scripts and role bindings

```powershell
Invoke-RestMethod http://localhost:3000/scripts | ConvertTo-Json -Depth 10
```

Returns all registered scripts and role-to-script bindings. Confirm `test.echo`, `role.planner`, `role.sprint-controller`, `role.implementer`, and `role.verifier` appear.

### 5.3 Execute test echo script (no LLM required)

Use this first to verify the full execution pipeline — request validation, script runner, DB write — without needing LLM credentials:

```powershell
Invoke-RestMethod -Method POST http://localhost:3000/execute `
  -ContentType "application/json" `
  -Body '{"target":{"type":"script","name":"test.echo","version":"2026.04.18"},"input":{"message":"hello-local"}}' |
  ConvertTo-Json -Depth 10
```

Expected response contains `"ok": true` and an echoed copy of the input.

### 5.4 Retrieve the execution record

Copy the `execution_id` from the previous response and query it:

```powershell
Invoke-RestMethod http://localhost:3000/executions/<execution_id> | ConvertTo-Json -Depth 10
```

### 5.5 Create a pipeline run (requires LLM credentials for role execution)

```powershell
Invoke-RestMethod -Method POST http://localhost:3000/pipeline `
  -ContentType "application/json" `
  -Body '{"entry_point":"planner","execution_mode":"next","input":{"description":"local test feature"},"metadata":{"source":"api"}}' |
  ConvertTo-Json -Depth 10
```

Returns `202 Accepted` with a `pipeline_id`. Role execution is asynchronous — check status with:

```powershell
Invoke-RestMethod http://localhost:3000/pipeline/<pipeline_id> | ConvertTo-Json -Depth 10
```

### 5.6 Using the TypeScript CLI (`adp`)

The repository includes a TypeScript CLI at `platform/cli/` as a convenience wrapper over the REST API. It manages an active context file (`.adp-cli.state.json`) so you don't have to copy-paste IDs between commands.

#### Setup

```powershell
Set-Location platform/cli
npm install
```

#### Set active channel and create a pipeline

```powershell
npx tsx src/index.ts active-set --channel-id <slack_channel_id>
npx tsx src/index.ts pipeline-create --entry-point planner --execution-mode next --description "stage the next phase"
```

`pipeline-create` automatically saves the returned `pipeline_id` as active context. Subsequent commands resolve it without `--pipeline-id`:

```powershell
npx tsx src/index.ts pipeline-summary   # uses active pipeline_id
npx tsx src/index.ts pipeline-approve   # uses active pipeline_id
```

Pass `--no-set-active` to suppress auto-save when running multiple parallel pipelines on the same channel:

```powershell
npx tsx src/index.ts pipeline-create --entry-point planner --no-set-active
```

To override the saved `pipeline_id` for a single command, pass `--pipeline-id <id>` explicitly on that command.

---

## 6. REST Client Quick Reference

The repository includes a VS Code [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) collection under `platform/backend-api/requests/`. This is the recommended approach for interactive API testing — requests are version-controlled and serve as living documentation.

### 6.1 Setup

1. Install the **REST Client** extension (`humao.rest-client`) in VS Code.
2. Open `.vscode/settings.json` and set `rest-client.environmentVariables` values for `local` and `dev`.
3. Open any `.http` file. Use `Ctrl+Shift+P` → **Rest Client: Switch Environment** to choose `local` or `dev`.
4. Click **Send Request** above any request block.

### 6.2 Environment configuration files

| File | Committed | Purpose |
|---|---|---|
| `.vscode/settings.json` | **No (gitignored in this repo)** | REST Client environment variables (`baseUrl`, `apiKey`, `pipelineId`, etc.) |
| `platform/backend-api/requests/*.http` | Yes | Request collections by domain (execution, pipeline, coordination, projects) |

After creating a pipeline, copy the returned `pipeline_id` into `.vscode/settings.json` → `rest-client.environmentVariables.<env>.pipelineId` so downstream requests (approve, cancel, status, handoff) pick it up automatically.

> **Using the TypeScript CLI?** Skip this step — `adp pipeline-create` automatically saves the new `pipeline_id` to `.adp-cli.state.json`. See [Section 5.6](#56-using-the-typescript-cli-adp).

### 6.3 Request file inventory

| File | Endpoints covered |
|---|---|
| `01-health-execution.http` | `GET /health`, `GET /scripts`, `POST /execute`, `GET /executions`, `GET /executions/:id`, `POST /executions/:id/replay` |
| `02-pipeline.http` | `POST /pipeline` (all entry points), `GET /pipeline/:id`, status-summary, approve, cancel, takeover, handoff, skip |
| `03-coordination.http` | Create, get, patch, query, archive coordination entries |
| `04-projects.http` | Register project, assign Slack channel |

### 6.4 Switching between local and dev

The `local` environment targets `http://localhost:3000` with no API key (pass-through mode). The `dev` environment targets the Azure Container App URL with the full API key. Switch environments without changing any request files.

### 6.5 API Surface (current endpoints)

| Area | Method | Path |
|---|---|---|
| Health | GET | `/health` |
| Script catalog | GET | `/scripts` |
| Execute script/role | POST | `/execute` |
| Execution query | GET | `/executions` |
| Execution detail | GET | `/executions/:executionId` |
| Replay execution | POST | `/executions/:executionId/replay` |
| Pipeline create | POST | `/pipeline` |
| Pipeline detail | GET | `/pipeline/:pipelineId` |
| Pipeline status summary | GET | `/pipeline/:pipelineId/status-summary` |
| Current pipeline summary | GET | `/pipeline/status-summary/current` |
| Pipeline approve | POST | `/pipeline/:pipelineId/approve` |
| Pipeline cancel | POST | `/pipeline/:pipelineId/cancel` |
| Pipeline takeover | POST | `/pipeline/:pipelineId/takeover` |
| Pipeline handoff | POST | `/pipeline/:pipelineId/handoff` |
| Pipeline skip | POST | `/pipeline/:pipelineId/skip` |
| Project list | GET | `/projects` |
| Project detail | GET | `/projects/:projectId` |
| Project create | POST | `/projects` |
| Project channel assign | POST | `/projects/:projectId/channels` |
| Git sync trigger | POST | `/git/sync` |
| Git status | GET | `/git/status` |
| Coordination create | POST | `/coordination` |
| Coordination detail | GET | `/coordination/:coordinationId` |
| Coordination patch | PATCH | `/coordination/:coordinationId` |
| Coordination query | POST | `/coordination/query` |
| Coordination archive | DELETE | `/coordination/:coordinationId` |

### 6.6 Create Project Syntax

`POST /projects`

Required body fields:

- `name`
- `repo_url`

Optional fields:

- `default_branch` (defaults to `main` if omitted)
- `channel_id` (registers Slack channel mapping during create)

REST Client example:

```http
POST {{baseUrl}}/projects
Content-Type: application/json
x-api-key: {{apiKey}}

{
  "name": "my-service",
  "repo_url": "https://github.com/your-org/my-service",
  "default_branch": "main",
  "channel_id": "C12345678"
}
```

PowerShell example:

```powershell
Invoke-RestMethod -Method POST http://localhost:3000/projects `
  -ContentType "application/json" `
  -Headers @{ "x-api-key" = "<your_key_if_API_KEY_is_set>" } `
  -Body '{"name":"my-service","repo_url":"https://github.com/your-org/my-service","default_branch":"main","channel_id":"C12345678"}' |
  ConvertTo-Json -Depth 10
```

Expected response: `201 Created` with project data (`project_id`, `name`, `repo_url`, `default_branch`, `clone_path`, timestamps) and `channel_id` when provided.

Common errors:

- `400 PROJECT_NAME_REQUIRED`
- `400 PROJECT_REPO_URL_REQUIRED`
- `409 PROJECT_ALREADY_EXISTS`

### 6.7 Project Read Endpoints

List all projects:

```http
GET {{baseUrl}}/projects
x-api-key: {{apiKey}}
```

List all projects with channel mappings:

```http
GET {{baseUrl}}/projects?include_channels=true
x-api-key: {{apiKey}}
```

Get one project by id (always includes `channel_ids`):

```http
GET {{baseUrl}}/projects/{{projectId}}
x-api-key: {{apiKey}}
```

PowerShell examples:

```powershell
Invoke-RestMethod -Method GET http://localhost:3000/projects |
  ConvertTo-Json -Depth 10
```

```powershell
Invoke-RestMethod -Method GET "http://localhost:3000/projects?include_channels=true" |
  ConvertTo-Json -Depth 10
```

```powershell
Invoke-RestMethod -Method GET http://localhost:3000/projects/<project_id> |
  ConvertTo-Json -Depth 10
```

---

## 7. API Key Behavior in Local Dev

| `API_KEY` set? | Behavior |
|---|---|
| Not set | All routes pass through — no auth required |
| Set | `x-api-key: <value>` header required on all non-health requests |

When `API_KEY` is set, include the header:

```powershell
Invoke-RestMethod http://localhost:3000/pipeline/<id> `
  -Headers @{ "x-api-key" = "<your_key>" } |
  ConvertTo-Json -Depth 10
```

When using the REST Client, the API key is read from `.vscode/settings.json` automatically — no header changes needed when switching environments.

---

## 8. Optional: Full Local Orchestration with n8n

If you want pipeline notifications and want to test the orchestration layer locally:

### 8.1 Start local n8n

```powershell
npx n8n
```

n8n runs on `http://localhost:5678` by default.

### 8.2 Set the callback URL in `.env`

```dotenv
N8N_CALLBACK_URL=http://localhost:5678/webhook
```

### 8.3 Import and activate workflows

In the n8n UI, import and activate:

- `platform/workflow/slack-ingress.json`
- `platform/workflow/slack-action-handler.json`
- `platform/workflow/pipeline-notifier.json`

### 8.4 Set required n8n env vars

n8n reads `EXECUTION_API_BASE_URL` and `EXECUTION_API_KEY` via `$env` expressions in workflow nodes. Set these in the n8n environment or `.env` before starting n8n:

| Variable | Local value |
|---|---|
| `EXECUTION_API_BASE_URL` | `http://localhost:3000` |
| `EXECUTION_API_KEY` | Same value as `API_KEY` on the backend |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` |
| `N8N_BLOCK_RUNNER_ENV_ACCESS` | `false` |

---

## 9. Optional: Slack End-to-End

For slash commands and interactive buttons pointing at local n8n:

1. Create a Slack app from `platform/workflow/slack-app-manifest.json` (see [governance-operator-runbook.md](governance-operator-runbook.md#L295)).
2. Start a tunnel to expose local n8n webhooks publicly (e.g. ngrok pointing at port 5678).
3. Update manifest URLs to your tunnel host before creating the Slack app.
4. Install the Slack app to your workspace and test a slash command.

---

## 10. Debugging Reference

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

## 11. Local Profile Reference

### 11.1 Profile A — Fast backend debug

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

### 11.2 Profile B — Role execution debug

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

### 11.3 Profile C — Full local orchestration

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
