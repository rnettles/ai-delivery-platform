# n8n Workflow Definitions
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the n8n orchestration pattern for the Execution Service canonical interface.

It includes:

- Node-by-node flow
- Contract-compliant request/response handling
- Retry and error strategy

This document is implementation-grade.

---

# 2. Core Principle

> n8n orchestrates control flow only. All governed logic executes through `POST /execute`.

---

# 3. Standard Planner Workflow

## 3.1 Flow Overview

```
Webhook (Slack/Event)
→ Build /execute request (target: role@version)
→ HTTP: POST /execute (planner)
→ LLM node (if requested by contract output)
→ HTTP: POST /execute (render)
→ HTTP: POST /execute (validate)
→ End
```

---

# 4. Node-by-Node Definition

## Node 1 — Webhook

### Type
Webhook

### Purpose
Entry point from Slack or external trigger.

### Output

```json
{
  "workflow_id": "generated",
  "request_id": "generated",
  "input_text": "user message"
}
```

---

## Node 2 — Execute Planner Contract

### Type
HTTP Request

### Endpoint
POST /execute

### Input

```json
{
  "request_id": "req-001",
  "correlation_id": "{{ $json.workflow_id }}",
  "target": {
    "type": "role",
    "name": "planner",
    "version": "2026.04.18"
  },
  "input": {
    "text": "{{ $json.input_text }}"
  },
  "metadata": {
    "workflow_id": "{{ $json.workflow_id }}",
    "caller": "n8n"
  }
}
```

### Output

```json
{
  "ok": true,
  "execution_id": "exec-001",
  "artifacts": [],
  "output": {
    "prompt": "...",
    "template": "phase_plan"
  }
}
```

---

## Node 3 — LLM Execution (If Required)

### Type
OpenAI / Azure OpenAI Node

### Input

```text
{{ $json.output.prompt }}
```

### Output

```json
{
  "llm_output": { ... }
}
```

---

## Node 4 — Execute Render Step

### Type
HTTP Request

### Endpoint
POST /execute

### Input

```json
{
  "request_id": "req-002",
  "correlation_id": "{{ $json.workflow_id }}",
  "target": {
    "type": "script",
    "name": "render_template",
    "version": "2026.04.18"
  },
  "input": {
    "template": "phase_plan",
    "data": "{{ $json.llm_output }}"
  },
  "metadata": {
    "workflow_id": "{{ $json.workflow_id }}",
    "caller": "n8n"
  }
}
```

---

## Node 5 — Execute Validation Step

### Type
HTTP Request

### Endpoint
POST /execute

### Input

```json
{
  "request_id": "req-003",
  "correlation_id": "{{ $json.workflow_id }}",
  "target": {
    "type": "script",
    "name": "validate_artifacts",
    "version": "2026.04.18"
  },
  "input": {
    "artifacts": "{{ $json.artifacts }}"
  },
  "metadata": {
    "workflow_id": "{{ $json.workflow_id }}",
    "caller": "n8n"
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

Retry only when:

- Network failure
- 5xx server error
- Timeout

Do not retry when:

- Validation errors
- Schema errors
- Governance violations

---

# 6. Error Handling

## 6.1 Pattern

```
If Node Fails
→ Capture Error
→ Log execution_id + request_id
→ Stop Execution
```

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

- workflow_id / correlation_id
- request_id per call
- target name + explicit version
- structured input payload
- artifact references / execution_id

---

# 8. Prohibited Patterns

- Using specialized execution endpoints for governed behavior
- Omitting explicit target version
- Embedding business logic in n8n nodes
- Treating transient workflow context as authoritative state