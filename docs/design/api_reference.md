# API Reference — AI Delivery Platform
## Execution Service — Complete Endpoint Catalogue

---

> **Audience:** This document is the authoritative reference for all HTTP endpoints exposed by the
> Execution Service backend. It is written for human engineers, GUI developers, and LLMs assisting
> in UI/UX specification work. Every endpoint is described with its purpose, request contract,
> response shape, error codes, and usage notes.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Global Response Conventions](#2-global-response-conventions)
3. [Health Endpoints](#3-health-endpoints)
4. [Execution Endpoints](#4-execution-endpoints)
5. [Pipeline Endpoints](#5-pipeline-endpoints)
6. [Coordination Endpoints](#6-coordination-endpoints)
7. [Project Endpoints](#7-project-endpoints)
8. [Git & Admin Endpoints](#8-git--admin-endpoints)
9. [Error Reference](#9-error-reference)

---

## 1. Authentication

All endpoints (except `/health` and `/health/dry-run`) require the header:

```
x-api-key: <shared-secret>
```

The key is configured via the `API_KEY` environment variable on the server.
Requests missing a valid key receive `401 UNAUTHORIZED`.

---

## 2. Global Response Conventions

| Convention | Detail |
|---|---|
| Content type | `application/json` for all responses |
| Request ID | Every request that modifies state is assigned a `request_id` (UUID). Included in execution responses. |
| Timestamps | ISO 8601 strings, e.g. `"2025-04-19T14:00:00.000Z"` |
| Envelope | Most success responses are bare JSON objects or arrays. Execution responses wrap output in a standard envelope (see §4). |

---

## 3. Health Endpoints

### 3.1 `GET /health`

**Purpose:** Liveness probe. Confirms the service is running. Used by load-balancers and monitoring.

**Authentication:** Not required.

**Request:** No parameters.

**Success Response `200`:**

```json
{ "status": "ok" }
```

---

### 3.2 `GET /health/dry-run`

**Purpose:** Returns the current dry-run mode flag and active scenario snapshot. Used during
development/testing to confirm which LLM scenario is active without calling a real LLM.

**Authentication:** Not required.

**Request:** No parameters.

**Success Response `200`:**

```json
{
  "dry_run": true,
  "scenario": {
    "name": "happy-path",
    "description": "..."
  }
}
```

When `dry_run` is `false`, `scenario` is `null`.

---

## 4. Execution Endpoints

The Execution Service exposes three execution-related operations: submit a governed execution
request, inspect a past record, and replay one.

---

### 4.1 `POST /execute`

**Purpose:** Submit a governed execution request. Selects a script or role by name and version,
runs it deterministically, and returns the full result envelope. This is the primary integration
point for n8n, CLI, and all agent-driven flows.

**Request Body:**

```json
{
  "request_id": "optional-client-uuid",
  "correlation_id": "pipeline-or-workflow-id",
  "target": {
    "type": "script | role",
    "name": "role-planner | role-sprint-controller | ...",
    "version": "2026.04.19"
  },
  "input": {
    "pipeline_id": "pipe-abc123",
    "previous_artifacts": ["artifacts/pipe-abc123/1_plan.json"]
  },
  "metadata": {
    "workflow_id": "n8n-wf-001",
    "caller": "n8n | ui | cli | agent"
  }
}
```

| Field | Required | Description |
|---|---|---|
| `target.type` | Yes | `"script"` for utility scripts, `"role"` for governed AI roles |
| `target.name` | Yes | Name of the registered script or role |
| `target.version` | Yes | Explicit semver-style version string; floating aliases (e.g. `latest`) are prohibited |
| `input` | Yes | Structured JSON input passed directly to the script/role |
| `correlation_id` | No | Ties this execution to a pipeline or workflow for traceability |
| `request_id` | No | Client-supplied idempotency key |
| `metadata` | No | Arbitrary key/value context for observability |

**Success Response `200`:**

```json
{
  "ok": true,
  "execution_id": "exec-uuid",
  "request_id": "optional-client-uuid",
  "correlation_id": "pipeline-or-workflow-id",
  "target": {
    "type": "role",
    "name": "role-planner",
    "version": "2026.04.19"
  },
  "artifacts": ["artifacts/pipe-abc123/1_plan.json"],
  "output": { ... },
  "errors": []
}
```

**Failure Response `500`** (execution ran but failed):

```json
{
  "ok": false,
  "execution_id": "exec-uuid",
  "target": { ... },
  "artifacts": [],
  "output": null,
  "errors": [
    { "code": "EXECUTION_ERROR", "message": "Role failed: ...", "details": {} }
  ]
}
```

**Error codes specific to this endpoint:**

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body failed schema validation |
| `SCRIPT_NOT_FOUND` | 400 | `target.name` is not registered |
| `VERSION_RESOLUTION_ERROR` | 400 | `target.version` does not match |
| `EXECUTION_ERROR` | 500 | Script/role threw an error at runtime |
| `UNAUTHORIZED` | 401 | Missing or invalid `x-api-key` |

---

### 4.2 `GET /scripts`

**Purpose:** Discovery endpoint. Lists all registered scripts and roles with their versions,
descriptions, and schemas. Used by UIs and agents to populate dropdowns and validate inputs
before calling `/execute`.

**Request:** No parameters.

**Success Response `200`:**

```json
{
  "scripts": [
    {
      "type": "script",
      "name": "health-check",
      "version": "1.0.0",
      "description": "Validates system health",
      "input_schema": { ... },
      "output_schema": { ... },
      "tags": ["infra", "diagnostics"]
    }
  ],
  "roles": [
    {
      "type": "role",
      "name": "planner",
      "version": "2026.04.19",
      "script": { "name": "role-planner", "version": "2026.04.19" }
    }
  ]
}
```

---

### 4.3 `GET /executions`

**Purpose:** Query the execution history. Supports filtering by correlation, target, and status.
Used by dashboards and operators to review what has run and whether it succeeded.

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `correlation_id` | string | No | Filter to executions tied to a specific pipeline/workflow |
| `target_name` | string | No | Filter by script or role name |
| `status` | `"completed" \| "failed"` | No | Filter by terminal status |
| `limit` | integer | No | Maximum number of records to return |

**Success Response `200`:**

```json
{
  "records": [
    {
      "ok": true,
      "execution_id": "exec-uuid",
      "request_id": "...",
      "correlation_id": "pipe-abc123",
      "target": { "type": "role", "name": "planner", "version": "2026.04.19" },
      "artifacts": ["artifacts/pipe-abc123/1_plan.json"],
      "output": { ... },
      "errors": [],
      "status": "completed",
      "started_at": "2025-04-19T14:00:00.000Z",
      "completed_at": "2025-04-19T14:01:23.000Z",
      "duration_ms": 83000,
      "input": { ... },
      "metadata": { ... },
      "replay_of_execution_id": null,
      "git_sync": {
        "repo_path": "/mnt/repo",
        "head_commit": "abc123",
        "is_repo_accessible": true
      }
    }
  ]
}
```

---

### 4.4 `GET /executions/:executionId`

**Purpose:** Fetch a single execution record by its ID. Returns the full record including input,
output, artifacts, git state at the time of execution, and timing data.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `executionId` | UUID of the execution record |

**Success Response `200`:** Same shape as a single record from §4.3.

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `NOT_FOUND` | 404 | No execution record with that ID |

---

### 4.5 `POST /executions/:executionId/replay`

**Purpose:** Re-run an existing execution using the same input envelope and target version.
Useful for debugging, recovering from transient failures, or manually re-driving a step.
The replay creates a new execution record with `replay_of_execution_id` set.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `executionId` | UUID of the execution to replay |

**Request Body:** Empty — the original input is re-used verbatim.

**Success/Failure Response:** Same envelope as `POST /execute` (§4.1).

---

## 5. Pipeline Endpoints

Pipelines are the top-level orchestration unit. A pipeline moves through a sequence of AI roles
(Planner → Sprint-Controller → Implementer → Verifier), each producing artifacts consumed by the
next. Human approval gates may pause the pipeline between roles.

**Pipeline lifecycle statuses:**

| Status | Meaning |
|---|---|
| `running` | A role is currently executing |
| `awaiting_approval` | Waiting for a human operator to approve before the next role runs |
| `awaiting_pr_review` | Waiting for a GitHub PR review (end of a sprint) |
| `paused_takeover` | An operator has taken manual control |
| `failed` | The current role execution failed |
| `complete` | All roles finished successfully |
| `cancelled` | The pipeline was cancelled by an operator |

---

### 5.1 `POST /pipeline`

**Purpose:** Create and start a new pipeline run. The service immediately returns with a
`pipeline_id`; role execution begins asynchronously. The caller does not need to poll for role
completion — Slack notifications report progress.

**Request Body:**

```json
{
  "entry_point": "planner",
  "execution_mode": "next-flow",
  "sprint_branch": "sprint/my-feature",
  "input": {
    "slack_channel": "C123ABC",
    "slack_user": "U456DEF"
  },
  "metadata": {
    "source": "slack",
    "slack_channel": "C123ABC",
    "slack_user": "U456DEF"
  }
}
```

| Field | Required | Description |
|---|---|---|
| `entry_point` | Yes | Which role starts the pipeline: `"planner"`, `"sprint-controller"`, `"implementer"`, `"verifier"` |
| `execution_mode` | No | Controls downstream chaining. See table below. |
| `sprint_branch` | No | Git branch for the sprint. Required when `entry_point` is `"verifier"`. |
| `input` | No | Freeform input passed to the entry role |
| `metadata` | No | Slack or source context stored on the pipeline |

**Execution modes:**

| Mode | Behavior |
|---|---|
| `"next"` | Run only the entry role, then stop. Human approval gate activates. |
| `"next-flow"` | Chain into role-specific downstream. Human gates remain active between roles. |
| `"full-sprint"` | Fully autonomous. All human gates bypassed; runs to `awaiting_pr_review`. |

**Success Response `202`:**

```json
{
  "pipeline_id": "pipe-abc123",
  "entry_point": "planner",
  "current_step": "planner",
  "status": "running",
  "steps": [],
  "metadata": { "source": "slack", "slack_channel": "C123ABC" },
  "implementer_attempts": 0,
  "created_at": "2025-04-19T14:00:00.000Z",
  "updated_at": "2025-04-19T14:00:00.000Z"
}
```

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_ENTRY_POINT` | 400 | `entry_point` is not one of the valid roles |

---

### 5.2 `GET /pipeline/:pipelineId`

**Purpose:** Fetch the full state of a pipeline run, including all step records, artifact paths,
timing data, and current status. This is the primary read endpoint for dashboards.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `pipelineId` | ID of the pipeline run |

**Success Response `200`:**

```json
{
  "pipeline_id": "pipe-abc123",
  "entry_point": "planner",
  "current_step": "sprint-controller",
  "status": "awaiting_approval",
  "steps": [
    {
      "role": "planner",
      "execution_id": "exec-uuid",
      "status": "complete",
      "gate_outcome": "auto",
      "artifact_paths": ["artifacts/pipe-abc123/1_plan.json"],
      "actor": "system",
      "started_at": "2025-04-19T14:00:00.000Z",
      "completed_at": "2025-04-19T14:01:23.000Z"
    }
  ],
  "metadata": { "source": "slack", "slack_channel": "C123ABC" },
  "project_id": "proj-uuid",
  "sprint_branch": "sprint/my-feature",
  "pr_number": 42,
  "pr_url": "https://github.com/org/repo/pull/42",
  "implementer_attempts": 1,
  "created_at": "2025-04-19T14:00:00.000Z",
  "updated_at": "2025-04-19T14:05:00.000Z"
}
```

**Step record fields:**

| Field | Description |
|---|---|
| `role` | Which role this step ran (`planner`, `sprint-controller`, `implementer`, `verifier`) |
| `execution_id` | Reference back to the execution record in §4 |
| `status` | `running`, `complete`, `failed`, or `not_applicable` |
| `gate_outcome` | `approved`, `human_complete`, `skipped`, `auto`, or `null` |
| `artifact_paths` | Relative paths to all artifacts produced by this step |
| `actor` | `"system"` or the Slack user who approved/skipped |
| `justification` | Populated when a step was skipped |
| `error_message` | Populated when a step failed |

---

### 5.3 `GET /pipeline/:pipelineId/artifact`

**Purpose:** Retrieve the raw content of a pipeline artifact by its path. Returns JSON artifacts
parsed as objects and text artifacts as plain text. Used by UIs to display plan documents,
sprint state, verification reports, etc.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `pipelineId` | ID of the pipeline that owns the artifact |

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `path` | Yes | Relative artifact path, e.g. `artifacts/pipe-abc123/1_plan.json` |

**Success Response `200`:**
- JSON files → parsed JSON object (`Content-Type: application/json`)
- All other files → plain text string (`Content-Type: text/plain`)

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `ARTIFACT_PATH_REQUIRED` | 400 | `path` query parameter is missing |
| `INVALID_ARTIFACT_PATH` | 400 | Path escapes the artifact base directory (path traversal guard) |
| `ARTIFACT_PIPELINE_MISMATCH` | 403 | Artifact path does not belong to the specified pipeline |
| `ARTIFACT_NOT_FOUND` | 404 | File does not exist at the resolved path |

---

### 5.4 `GET /pipeline/:pipelineId/status-summary`

**Purpose:** Return a compact status summary for a specific pipeline. Useful for status badges
and quick-look cards in a dashboard, without returning the full step list.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `pipelineId` | ID of the pipeline run |

**Success Response `200`:** A summary object with high-level status fields.

---

### 5.5 `GET /pipeline/status-summary/current`

**Purpose:** Return the status summary of the most recently active pipeline. Optionally filtered
by Slack channel. Used by the Slack bot and dashboard "current sprint" widgets.

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `channel_id` | No | Filter to the most recent pipeline for this Slack channel ID |

**Success Response `200`:** Same shape as §5.4.

---

### 5.6 `GET /pipeline/status-summary/by-channel`

**Purpose:** List pipeline status summaries for a specific Slack channel, optionally filtered by
status and limited in count. Designed for channel-scoped dashboards.

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `channel_id` | Yes | Slack channel ID to scope the query |
| `limit` | No | Maximum number of pipelines to return |
| `status` | No | Comma-separated list of `PipelineStatus` values to filter by |

**Success Response `200`:**

```json
{
  "pipelines": [ { ... }, { ... } ]
}
```

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `CHANNEL_ID_REQUIRED` | 400 | `channel_id` is missing |

---

### 5.7 `GET /pipeline/staged/phases`

**Purpose:** List the staged delivery phases (from the plan artifact) scoped across the repo.
Optional channel/project filters narrow results to a specific delivery context. Used to show
the overall programme of work in a UI.

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `channel_id` | No | Filter to phases visible in this Slack channel |
| `project_id` | No | Filter to phases for this project |
| `limit` | No | Maximum number of phases to return |

**Success Response `200`:** Array of staged phase objects.

---

### 5.8 `GET /pipeline/staged/sprints`

**Purpose:** List the staged sprints from the plan artifact. Same scoping options as phases.
Used to show planned sprints in a project view.

**Query Parameters:** Same as §5.7.

**Success Response `200`:** Array of staged sprint objects.

---

### 5.9 `GET /pipeline/staged/tasks`

**Purpose:** List the staged tasks from the sprint plan artifact. Same scoping options as phases.
Used to show planned tasks in a sprint board view.

**Query Parameters:** Same as §5.7.

**Success Response `200`:** Array of staged task objects.

---

### 5.10 `GET /pipeline/:pipelineId/staged/phases`

**Purpose:** List staged phases from a specific pipeline's artifacts. Pipeline-scoped variant of
§5.7. Useful when a UI needs to show the phases planned within a particular pipeline run.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `pipelineId` | Pipeline to scope the query to |

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `limit` | No | Maximum number of phases to return |

**Success Response `200`:** Array of staged phase objects.

---

### 5.11 `GET /pipeline/:pipelineId/staged/sprints`

**Purpose:** Pipeline-scoped variant of §5.8.

**Path Parameters / Query Parameters:** Same structure as §5.10.

**Success Response `200`:** Array of staged sprint objects.

---

### 5.12 `GET /pipeline/:pipelineId/staged/tasks`

**Purpose:** Pipeline-scoped variant of §5.9.

**Path Parameters / Query Parameters:** Same structure as §5.10.

**Success Response `200`:** Array of staged task objects.

---

### 5.13 `POST /pipeline/:pipelineId/approve`

**Purpose:** Approve the pending human gate on a pipeline. When approved, the next role starts
executing immediately (asynchronously). The actor identity is taken from `req.body.actor` or the
`x-actor` header; this is stored in the step record for audit purposes.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `pipelineId` | ID of the pipeline awaiting approval |

**Request Body:**

```json
{ "actor": "U456DEF" }
```

Or pass the actor via header: `x-actor: U456DEF`

**Success Response `200`:** Updated `PipelineRun` object (same shape as §5.2).

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `PIPELINE_NOT_FOUND` | 404 | Pipeline does not exist |
| `INVALID_STATE` | 409 | Pipeline is not in `awaiting_approval` status |

---

### 5.14 `POST /pipeline/:pipelineId/cancel`

**Purpose:** Cancel a pipeline. Stops execution and sets status to `cancelled`. Sends a Slack
notification. The actor is recorded in the pipeline metadata.

**Path Parameters / Body:** Same as §5.13.

**Success Response `200`:** Updated `PipelineRun` object.

---

### 5.15 `POST /pipeline/:pipelineId/takeover`

**Purpose:** Mark the pipeline as under manual human control (`paused_takeover`). The operator
takes responsibility for the current step. Sends a Slack notification.

**Path Parameters / Body:** Same as §5.13.

**Success Response `200`:** Updated `PipelineRun` object.

---

### 5.16 `POST /pipeline/:pipelineId/retry`

**Purpose:** Retry the current failed step. Re-executes the current role from scratch and sends
a Slack notification. The actor is recorded.

**Path Parameters / Body:** Same as §5.13.

**Success Response `200`:** Updated `PipelineRun` object.

---

### 5.17 `POST /pipeline/:pipelineId/ops/retry`

**Purpose:** Create an asynchronous admin retry operation. Unlike §5.16, this queues a managed
recovery job tracked by the admin-ops subsystem. Returns immediately with the job details.
Use §5.18 to poll for completion.

**Path Parameters / Body:** Same as §5.13.

**Success Response `202`:**

```json
{
  "ok": true,
  "operation": { "job_id": "job-uuid", "action": "retry", "status": "queued", ... },
  "status_url": "/pipeline/pipe-abc123/ops/job-uuid"
}
```

---

### 5.18 `GET /pipeline/:pipelineId/ops/:operationId`

**Purpose:** Poll the status of an async pipeline admin operation (created by §5.17).

**Path Parameters:**

| Parameter | Description |
|---|---|
| `pipelineId` | Pipeline the operation is scoped to |
| `operationId` | Job ID returned by §5.17 |

**Success Response `200`:**

```json
{
  "ok": true,
  "operation": {
    "job_id": "job-uuid",
    "action": "retry",
    "status": "succeeded",
    "actor": "operator",
    "queued_at": "2025-04-19T14:00:00.000Z",
    "started_at": "2025-04-19T14:00:01.000Z",
    "completed_at": "2025-04-19T14:00:15.000Z",
    "outcome": { ... },
    "telemetry": { "attempted_steps": [ ... ] }
  }
}
```

---

### 5.19 `POST /pipeline/:pipelineId/handoff`

**Purpose:** Signal that a human is completing the current step and handing off control back to
the system. Optionally includes an artifact path produced by the human. The pipeline advances
and the next role begins executing.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `pipelineId` | Pipeline to hand off |

**Request Body:**

```json
{
  "actor": "U456DEF",
  "artifact_path": "artifacts/pipe-abc123/human_review.json"
}
```

| Field | Required | Description |
|---|---|---|
| `actor` | Yes (via body or `x-actor` header) | Identity of the person completing the step |
| `artifact_path` | No | Path to an artifact the human has produced |

**Success Response `200`:** Updated `PipelineRun` object.

---

### 5.20 `POST /pipeline/:pipelineId/skip`

**Purpose:** Skip the current step with a mandatory justification. The step is marked as
`not_applicable` and the pipeline advances. The justification is stored in the step record.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `pipelineId` | Pipeline whose current step will be skipped |

**Request Body:**

```json
{
  "actor": "U456DEF",
  "justification": "Sprint already implemented manually."
}
```

| Field | Required | Description |
|---|---|---|
| `actor` | Yes (via body or `x-actor` header) | Operator identity |
| `justification` | Yes | Non-empty human-readable reason for skipping |

**Success Response `200`:** Updated `PipelineRun` object.

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `JUSTIFICATION_REQUIRED` | 400 | `justification` field is missing or blank |

---

### 5.21 `POST /pipeline/cli-notify`

**Purpose:** Send a freeform CLI notification message to a Slack channel without creating a
full pipeline. Used by CLI tooling to report command status (INFO, WARNING, ERROR) to operators
in real time.

**Request Body:**

```json
{
  "status": "INFO",
  "command": "adp-plan",
  "message": "Plan generation started.",
  "channel_id": "C123ABC",
  "metadata": {}
}
```

| Field | Required | Description |
|---|---|---|
| `status` | No | `"INFO"` (default), `"WARNING"`, or `"ERROR"` |
| `command` | No | Slash command that triggered the notification |
| `message` | No | Human-readable status message |
| `channel_id` | No | Slack channel to notify; falls back to `CLI_NOTIFICATION_CHANNEL` env var |
| `metadata` | No | Additional key/value pairs forwarded to the notifier |

**Success Response `202`:**

```json
{ "ok": true, "notified": true, "channel": "C123ABC" }
```

When no channel is configured:

```json
{ "ok": true, "skipped": true, "reason": "CLI_NOTIFICATION_CHANNEL is not configured" }
```

---

## 6. Coordination Endpoints

The Coordination API provides a lightweight, in-memory key-value store for sharing transient
runtime context between orchestration components (n8n workflows, agents, sessions). Data stored
here is **not** authoritative — artifacts are. Entries expire and are archived, not permanently
deleted.

**Coordination entry schema:**

```json
{
  "coordination_id": "coord-uuid",
  "kind": "workflow | agent | session",
  "scope": "pipe-abc123",
  "data": { ... },
  "metadata": { ... },
  "status": "active | archived",
  "expires_at": "2025-04-20T14:00:00.000Z",
  "created_at": "...",
  "updated_at": "..."
}
```

---

### 6.1 `POST /coordination`

**Purpose:** Create a new coordination entry. Entries act as shared context bags — for example,
a workflow may write session tokens or in-progress state here so that other agents can read it
during the same execution window.

**Request Body:**

```json
{
  "coordination_id": "optional-client-id",
  "kind": "workflow",
  "scope": "pipe-abc123",
  "data": { "task_index": 3 },
  "metadata": { "caller": "sprint-controller" },
  "expires_at": "2025-04-20T14:00:00.000Z"
}
```

| Field | Required | Description |
|---|---|---|
| `kind` | Yes | `"workflow"`, `"agent"`, or `"session"` |
| `scope` | Yes | Logical scope key (e.g. pipeline ID) |
| `data` | Yes | Arbitrary JSON payload |
| `coordination_id` | No | Client-assigned ID; auto-generated if omitted |
| `metadata` | No | Arbitrary context metadata |
| `expires_at` | No | ISO 8601 expiry timestamp |

**Success Response `201`:** Full `CoordinationEntry` object.

---

### 6.2 `GET /coordination/:coordinationId`

**Purpose:** Fetch a single coordination entry by its ID. Returns the current data and status.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `coordinationId` | UUID of the coordination entry |

**Success Response `200`:** Full `CoordinationEntry` object.

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `NOT_FOUND` | 404 | No entry with that ID |

---

### 6.3 `PATCH /coordination/:coordinationId`

**Purpose:** Partially update a coordination entry. Only the fields provided are changed; all
others are preserved. Useful for accumulating state across multiple steps (e.g. incrementing a
task counter).

**Path Parameters:**

| Parameter | Description |
|---|---|
| `coordinationId` | UUID of the coordination entry |

**Request Body:**

```json
{
  "data": { "task_index": 4 },
  "metadata": { "last_updated_by": "implementer" },
  "expires_at": "2025-04-21T14:00:00.000Z",
  "status": "active"
}
```

All fields are optional. Only supplied fields are merged.

**Success Response `200`:** Updated `CoordinationEntry` object.

---

### 6.4 `POST /coordination/query`

**Purpose:** Query coordination entries by kind, scope, and/or status. Used by orchestrators
to find entries relevant to an ongoing workflow without knowing their IDs.

**Request Body:**

```json
{
  "kind": "workflow",
  "scope": "pipe-abc123",
  "status": "active",
  "limit": 10
}
```

All fields are optional filters.

**Success Response `200`:**

```json
{ "entries": [ { ... }, { ... } ] }
```

---

### 6.5 `DELETE /coordination/:coordinationId`

**Purpose:** Archive a coordination entry. The entry is not physically deleted — it transitions
to `status: "archived"`. This preserves audit history while removing it from active queries.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `coordinationId` | UUID of the coordination entry to archive |

**Success Response `200`:** The archived `CoordinationEntry` object (with `status: "archived"`).

---

## 7. Project Endpoints

Projects represent the repositories that pipelines operate against. A project has a name,
a Git repo URL, a default branch, and one or more associated Slack channel IDs.

**Project schema:**

```json
{
  "project_id": "proj-uuid",
  "name": "my-service",
  "repo_url": "https://github.com/org/my-service",
  "default_branch": "main",
  "created_at": "...",
  "updated_at": "..."
}
```

---

### 7.1 `GET /projects`

**Purpose:** List all registered projects. Optionally includes associated channel IDs.
Used by UIs to populate project selectors.

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `include_channels` | No | `"true"`, `"1"`, or `"yes"` to embed channel IDs in each project |

**Success Response `200`:** Array of project objects.

---

### 7.2 `GET /projects/by-channel`

**Purpose:** List all projects associated with a specific Slack channel. Used by the Slack bot
to determine which projects a channel can operate on.

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `channel_id` | Yes | Slack channel ID |

**Success Response `200`:** Array of project objects.

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `CHANNEL_ID_REQUIRED` | 400 | `channel_id` is missing |

---

### 7.3 `GET /projects/:projectId`

**Purpose:** Fetch a single project by its ID, including all associated channel IDs.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `projectId` | UUID of the project |

**Success Response `200`:** Project object with a `channels` array.

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `PROJECT_NOT_FOUND` | 404 | No project with that ID |

---

### 7.4 `POST /projects`

**Purpose:** Register a new project. Creating a project registers the repo URL and optionally
associates it with a Slack channel in one operation.

**Request Body:**

```json
{
  "name": "my-service",
  "repo_url": "https://github.com/org/my-service",
  "default_branch": "main",
  "channel_id": "C123ABC"
}
```

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique project name |
| `repo_url` | Yes | Full HTTPS URL of the Git repository |
| `default_branch` | No | Defaults to repository default if omitted |
| `channel_id` | No | Immediately associates the project with this Slack channel |

**Success Response `201`:** Created project object, optionally including `channel_id`.

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `PROJECT_NAME_REQUIRED` | 400 | `name` is blank |
| `PROJECT_REPO_URL_REQUIRED` | 400 | `repo_url` is blank |
| `PROJECT_ALREADY_EXISTS` | 409 | A project with this name already exists |

---

### 7.5 `POST /projects/:projectId/channels`

**Purpose:** Associate an additional Slack channel with an existing project. A project may be
associated with multiple channels (e.g. one per team).

**Path Parameters:**

| Parameter | Description |
|---|---|
| `projectId` | UUID of the project |

**Request Body:**

```json
{ "channel_id": "C789GHI" }
```

**Success Response `200`:**

```json
{ "project_id": "proj-uuid", "channel_id": "C789GHI" }
```

**Error codes:**

| Code | HTTP | Meaning |
|---|---|---|
| `PROJECT_ID_REQUIRED` | 400 | `projectId` path param is missing |
| `CHANNEL_ID_REQUIRED` | 400 | `channel_id` body field is missing |
| `PROJECT_NOT_FOUND` | 404 | No project with that ID |

---

## 8. Git & Admin Endpoints

These endpoints manage the governance repository clone and provide asynchronous admin operations
for diagnosing and recovering pipelines and workspace state.

---

### 8.1 `POST /git/sync`

**Purpose:** Trigger an on-demand git sync of the configured governance repository. Performs a
clone if the repo is not present, or a pull if it already exists. Returns the resulting git
context. Per ADR-011, the Execution Service is the sole owner of git operations.

**Request:** No parameters.

**Success Response `200`:**

```json
{
  "ok": true,
  "git_sync": {
    "repo_path": "/mnt/repo",
    "head_commit": "abc123def456",
    "is_repo_accessible": true
  }
}
```

---

### 8.2 `GET /git/status`

**Purpose:** Return the current git sync context without triggering a new sync. Useful for
health dashboards to confirm the governance repo is accessible and up to date.

**Request:** No parameters.

**Success Response `200`:** Same shape as §8.1.

---

### 8.3 `POST /admin/ops`

**Purpose:** Create an asynchronous admin operation for diagnosing or recovering the system.
Returns immediately with a job ID. Use §8.4 to poll for completion.

**Request Body:**

```json
{
  "action": "diagnose",
  "actor": "operator",
  "project_id": "proj-uuid",
  "pipeline_id": "pipe-abc123",
  "options": {
    "branch": "sprint/my-feature",
    "base_branch": "main",
    "head_branch": "sprint/my-feature"
  }
}
```

| Field | Required | Description |
|---|---|---|
| `action` | Yes | One of `"diagnose"`, `"reconcile"`, `"reset-workspace"`, `"retry"` |
| `actor` | No | Operator identity; falls back to `x-actor` header or `"operator"` |
| `project_id` | No | Scopes the operation to a specific project |
| `pipeline_id` | No | Scopes the operation to a specific pipeline |
| `options.branch` | No | Branch context for workspace operations |
| `options.base_branch` | No | Base branch for reconcile/merge operations |
| `options.head_branch` | No | Head branch for reconcile/merge operations |

**Admin op actions:**

| Action | Description |
|---|---|
| `diagnose` | Inspect git state, detect issues, and report a human action checklist |
| `reconcile` | Attempt automated git recovery (rebase, pull, reset to remote) |
| `reset-workspace` | Reset the workspace clone to a clean state |
| `retry` | Re-queue the last failed pipeline step via the admin-ops subsystem |

**Success Response `202`:**

```json
{
  "ok": true,
  "operation": {
    "job_id": "job-uuid",
    "action": "diagnose",
    "status": "queued",
    "actor": "operator",
    "queued_at": "2025-04-19T14:00:00.000Z",
    "telemetry": { "attempted_steps": [] },
    "updated_at": "2025-04-19T14:00:00.000Z",
    "version": 1
  },
  "status_url": "/admin/ops/job-uuid"
}
```

---

### 8.4 `GET /admin/ops/:jobId`

**Purpose:** Poll the status and outcome of an admin operation created by §8.3.

**Path Parameters:**

| Parameter | Description |
|---|---|
| `jobId` | Job ID returned by §8.3 |

**Success Response `200`:**

```json
{
  "ok": true,
  "operation": {
    "job_id": "job-uuid",
    "action": "diagnose",
    "status": "succeeded",
    "actor": "operator",
    "queued_at": "...",
    "started_at": "...",
    "completed_at": "...",
    "outcome": {
      "escalation_reason": null,
      "escalation_summary": null,
      "human_action_checklist": [],
      "attempted_steps": [
        { "name": "git-status", "status": "succeeded", "started_at": "...", "completed_at": "..." }
      ],
      "before_git": {
        "repo_path": "/mnt/repo",
        "is_repo_accessible": true,
        "current_branch": "main",
        "shallow": false
      },
      "after_git": { ... },
      "github_requests": []
    },
    "telemetry": { "attempted_steps": [ ... ] },
    "updated_at": "...",
    "version": 3
  }
}
```

**Admin job statuses:**

| Status | Meaning |
|---|---|
| `queued` | Job is waiting to start |
| `running` | Job is actively executing steps |
| `succeeded` | All steps completed without error |
| `failed` | One or more steps failed |
| `blocked` | Manual human action is required before the job can proceed |

---

## 9. Error Reference

All error responses follow this structure:

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

### Global Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid `x-api-key` header |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 400 | Request body or parameters failed schema validation |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### Execution-Specific Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `SCRIPT_NOT_FOUND` | 400 | `target.name` is not registered in the script registry |
| `VERSION_RESOLUTION_ERROR` | 400 | `target.version` does not match any registered version |
| `EXECUTION_ERROR` | 500 | Script or role threw an unhandled error at runtime |

### Pipeline-Specific Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_ENTRY_POINT` | 400 | `entry_point` is not a valid role |
| `INVALID_STATE` | 409 | Pipeline is not in the state required for the requested action |
| `JUSTIFICATION_REQUIRED` | 400 | Skip requires a non-empty justification string |
| `ARTIFACT_PATH_REQUIRED` | 400 | Artifact download requires `path` parameter |
| `INVALID_ARTIFACT_PATH` | 400 | Path escapes the artifact base directory |
| `ARTIFACT_PIPELINE_MISMATCH` | 403 | Artifact does not belong to the specified pipeline |
| `ARTIFACT_NOT_FOUND` | 404 | Artifact file does not exist at the specified path |

### Project-Specific Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `PROJECT_NAME_REQUIRED` | 400 | `name` field is blank |
| `PROJECT_REPO_URL_REQUIRED` | 400 | `repo_url` field is blank |
| `PROJECT_ALREADY_EXISTS` | 409 | A project with this name already exists |
| `PROJECT_NOT_FOUND` | 404 | No project with the given ID |
| `CHANNEL_ID_REQUIRED` | 400 | Required `channel_id` parameter is missing |

---

*This document is maintained alongside the controller implementations. When adding or modifying
endpoints, update this file to reflect the new contract.*
