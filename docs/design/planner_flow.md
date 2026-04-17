# End-to-End Example: Planner Flow
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document demonstrates a **complete end-to-end execution** of the Planner flow:

Slack input  
→ n8n orchestration  
→ Execution Service  
→ Artifact creation  
→ State update  

This example is **implementation-grade** and shows how all components interact.

---

# 2. Scenario

User submits a request in Slack:

> "Plan Phase 1 for implementing the execution service"

---

# 3. Step-by-Step Flow

---

## Step 1 — Slack Input

### Input

```json
{
  "text": "Plan Phase 1 for execution service"
}
```

---

## Step 2 — n8n Webhook Trigger

n8n receives webhook event and constructs initial payload:

```json
{
  "workflow_id": "wf-2026-001",
  "request_id": "req-001",
  "input_text": "Plan Phase 1 for execution service"
}
```

---

## Step 3 — n8n → Execution Service: load-project-config

### Request

```json
{
  "workflow_id": "wf-2026-001",
  "request_id": "req-001",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {}
}
```

### Response

```json
{
  "ok": true,
  "data": {
    "resolved": {
      "workspace_root": "/mnt/repo/project_workspace"
    }
  }
}
```

---

## Step 4 — n8n → Execution Service: resolve-paths

### Request

```json
{
  "workflow_id": "wf-2026-001",
  "request_id": "req-002",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {
    "feature_id": "FEAT-001"
  }
}
```

### Response

```json
{
  "ok": true,
  "data": {
    "paths": {
      "phase_artifact": "/mnt/repo/project_workspace/artifacts/phases/PHASE-001.md"
    }
  }
}
```

---

## Step 5 — n8n → Execution Service: build-execution-contract

### Response (simplified)

```json
{
  "data": {
    "execution_contract": {
      "prompt": "Generate a Phase Plan...",
      "templates": ["phase_plan"]
    }
  }
}
```

---

## Step 6 — n8n → LLM

### Input

Prompt from execution contract:

```text
Generate a Phase Plan for implementing the execution service.
```

### Output

```json
{
  "phase_id": "PHASE-001",
  "name": "Execution Service Implementation",
  "objectives": [
    "Deploy execution service",
    "Integrate with n8n"
  ],
  "deliverables": [
    "Execution service deployed",
    "API endpoints working"
  ]
}
```

---

## Step 7 — n8n → Execution Service: render-template

### Request

```json
{
  "workflow_id": "wf-2026-001",
  "request_id": "req-004",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {
    "template": "phase_plan",
    "output_path": "/mnt/repo/project_workspace/artifacts/phases/PHASE-001.md",
    "data": {
      "phase_id": "PHASE-001",
      "name": "Execution Service Implementation"
    }
  }
}
```

### Result

Artifact created:

```text
/mnt/repo/project_workspace/artifacts/phases/PHASE-001.md
```

---

## Step 8 — n8n → Execution Service: validate-artifacts

### Response

```json
{
  "ok": true,
  "data": {
    "valid": true
  }
}
```

---

## Step 9 — State Update

Execution Service updates:

```text
project_workspace/state/current_phase.json
```

### Contents

```json
{
  "phase_id": "PHASE-001",
  "status": "planning"
}
```

---

# 4. Final Outputs

## Artifacts Created

```text
project_workspace/
└── artifacts/
    └── phases/
        └── PHASE-001.md
```

---

## State Updated

```text
project_workspace/state/current_phase.json
```

---

# 5. End Result

The system has:

- Accepted a Slack request
- Generated a governed phase plan
- Created a persistent artifact
- Updated system state

---

# 6. Key Takeaway

> This flow demonstrates the full governed loop:
>
> Input → Orchestration → Execution → Artifact → State
