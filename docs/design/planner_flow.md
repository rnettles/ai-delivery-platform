# End-to-End Example: Planner Flow
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document demonstrates a complete planner flow:

Slack input -> n8n orchestration -> Execution Service -> Artifact creation -> Optional snapshot projection

This example is implementation-grade.

---

# 2. Scenario

User submits:

> "Plan Phase 1 for implementing the execution service"

---

# 3. Step-by-Step Flow

## Step 1 - Slack Input

```json
{
  "text": "Plan Phase 1 for execution service"
}
```

---

## Step 2 - n8n Webhook Trigger

```json
{
  "workflow_id": "wf-2026-001",
  "request_id": "req-001",
  "input_text": "Plan Phase 1 for execution service"
}
```

---

## Step 3 - n8n -> Execution Service (`POST /execute` planner)

### Request

```json
{
  "request_id": "req-001",
  "correlation_id": "wf-2026-001",
  "target": {
    "type": "role",
    "name": "planner",
    "version": "2026.04.18"
  },
  "input": {
    "text": "Plan Phase 1 for execution service"
  },
  "metadata": {
    "workflow_id": "wf-2026-001",
    "caller": "n8n"
  }
}
```

### Response (simplified)

```json
{
  "ok": true,
  "execution_id": "exec-001",
  "output": {
    "plan": {
      "phase": "Phase 1",
      "tasks": ["..."],
      "checks": ["..."]
    }
  }
}
```

---

## Step 4 - Execution Service Internal Processing

Any LLM use required by planner logic occurs inside governed scripts/roles within the Execution Service boundary.
n8n does not call LLM providers directly.

---

## Step 5 - n8n -> Execution Service (`POST /execute` follow-up target)

### Response (simplified)

```json
{
  "ok": true,
  "execution_id": "exec-002",
  "artifacts": [
    "/mnt/repo/project_workspace/artifacts/phases/PHASE-001.md"
  ]
}
```

---

## Step 6 - n8n -> Execution Service (`POST /execute` validation target)

### Response (simplified)

```json
{
  "ok": true,
  "execution_id": "exec-003",
  "output": {
    "valid": true
  }
}
```

---

## Step 7 - Optional Derived Snapshot Projection

A projection layer may emit convenience snapshot files from artifacts.

Example (non-authoritative):

```text
project_workspace/state/current_phase.json
```

Snapshot files are derived views and must be reconstructable from artifacts.

---

# 4. Final Outputs

## Artifacts Created

```text
project_workspace/artifacts/phases/PHASE-001.md
```

## Derived Views (Optional)

```text
project_workspace/state/current_phase.json
```

---

# 5. End Result

The system has:

- Accepted a Slack request
- Executed governed planner logic through one contract boundary
- Created persistent artifacts as authoritative outputs
- Optionally projected derived snapshot views

---

# 6. Key Takeaway

> Input -> Orchestration -> Canonical Execute -> Artifacts -> Optional Derived Views