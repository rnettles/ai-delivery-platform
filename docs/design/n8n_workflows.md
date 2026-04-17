# n8n Workflow Definitions
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the **exact n8n workflow structure** for orchestrating the execution service.

It includes:

- Node-by-node flow
- Inputs and outputs per node
- Retry and error handling strategy

This document is **implementation-grade** and should be used directly when building workflows.

---

# 2. Core Principle

> n8n orchestrates flow only.  
> All logic lives in the execution service.

---

# 3. Standard Planner Workflow

## 3.1 Flow Overview

```
Webhook (Slack/Event)
→ HTTP: load-project-config
→ HTTP: resolve-paths
→ HTTP: build-execution-contract
→ LLM Node
→ HTTP: render-template
→ HTTP: validate-artifacts
→ End
```

---

# 4. Node-by-Node Definition

---

## Node 1 — Webhook

### Type
Webhook

### Purpose
Entry point from Slack or external trigger

### Output

```json
{
  "workflow_id": "generated",
  "request_id": "generated",
  "input_text": "user message"
}
```

---

## Node 2 — Load Project Config

### Type
HTTP Request

### Endpoint
POST /load-project-config

### Input

```json
{
  "workflow_id": "{{ $json.workflow_id }}",
  "request_id": "req-001",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {}
}
```

### Output

```json
{
  "data": {
    "resolved": { ... }
  }
}
```

---

## Node 3 — Resolve Paths

### Type
HTTP Request

### Endpoint
POST /resolve-paths

### Input

```json
{
  "workflow_id": "{{ $json.workflow_id }}",
  "request_id": "req-002",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {
    "feature_id": "FEAT-001"
  }
}
```

### Output

```json
{
  "data": {
    "paths": { ... }
  }
}
```

---

## Node 4 — Build Execution Contract

### Type
HTTP Request

### Endpoint
POST /build-execution-contract

### Input

```json
{
  "workflow_id": "{{ $json.workflow_id }}",
  "request_id": "req-003",
  "role": "planner",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {}
}
```

### Output

```json
{
  "data": {
    "execution_contract": {
      "prompt": "...",
      "rules": [],
      "templates": []
    }
  }
}
```

---

## Node 5 — LLM Execution

### Type
OpenAI / Azure OpenAI Node

### Input

```text
{{ $json.data.execution_contract.prompt }}
```

### Output

```json
{
  "llm_output": { ... }
}
```

---

## Node 6 — Render Template

### Type
HTTP Request

### Endpoint
POST /render-template

### Input

```json
{
  "workflow_id": "{{ $json.workflow_id }}",
  "request_id": "req-004",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {
    "template": "phase_plan",
    "data": "{{ $json.llm_output }}"
  }
}
```

### Output

```json
{
  "artifacts": [ ".../phase_plan.md" ]
}
```

---

## Node 7 — Validate Artifacts

### Type
HTTP Request

### Endpoint
POST /validate-artifacts

### Input

```json
{
  "workflow_id": "{{ $json.workflow_id }}",
  "request_id": "req-005",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {
    "paths": "{{ $json.artifacts }}"
  }
}
```

### Output

```json
{
  "data": {
    "valid": true
  }
}
```

---

# 5. Retry Strategy

## 5.1 Retry Rules

| Node Type | Retry Count | Strategy |
|----------|------------|----------|
| HTTP Nodes | 3 | Exponential backoff |
| LLM Node | 2 | Retry on timeout |
| Webhook | 0 | Fail fast |

---

## 5.2 Retry Conditions

Retry ONLY when:

- Network failure
- 5xx server error
- Timeout

DO NOT retry when:

- Validation errors
- Schema errors
- Governance violations

---

# 6. Error Handling

## 6.1 Pattern

```
If Node Fails
→ Capture Error
→ Log
→ Stop Execution
```

---

## 6.2 Standard Error Output

```json
{
  "ok": false,
  "errors": [
    {
      "code": "EXECUTION_ERROR",
      "message": "description"
    }
  ]
}
```

---

# 7. Data Passing Strategy

n8n must pass forward:

- workflow_id
- request_id
- resolved paths
- execution_contract
- llm_output
- artifacts

---

# 8. Naming Conventions

| Element | Format |
|--------|-------|
| workflow_id | wf-<timestamp> |
| request_id | req-<step> |
| feature_id | FEAT-### |
| phase_id | PHASE-### |

---

# 9. Guiding Principle

> n8n defines sequence, not logic.  
> Every decision must come from execution service or governance.
