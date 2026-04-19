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

# 3. Standard Governed Workflow

## 3.1 Flow Overview

```
Webhook (Slack/Event)
→ Interpret command to canonical target (role or script @ version)
→ Build canonical /execute request
→ HTTP: POST /execute
→ Route on structured response (artifacts, approvals, errors, next action)
→ Optional follow-up HTTP: POST /execute (canonical contract only)
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

## Node 2 — Execute Governed Target

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
    "name": "{{ $json.resolved_target_name }}",
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
  "resolved_target": {
    "type": "role",
    "name": "{{ $json.resolved_target_name }}",
    "version": "2026.04.18"
  },
  "artifacts": ["..."],
  "output": {"...": "..."}
  }
}
```

---
## Node 3 — Route Contract Response
## Node 3 — LLM Execution (If Required)

If / Switch
OpenAI / Azure OpenAI Node
### Purpose
Branch only on structured execution response fields (for example: `ok`, error category, approval_required, next_target).

### Input

```json
{
  "ok": true,
  "execution_id": "exec-001",
  "artifacts": ["..."],
  "output": {"...": "..."}
}
```

### Rule

```text
n8n MUST NOT invoke LLM providers directly in governed workflow paths.
LLM usage is internal to governed roles/scripts executed by the Execution Service.
```

---

## Node 4 — Optional Follow-up Execute

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
    "type": "{{ $json.next_target.type }}",
    "name": "{{ $json.next_target.name }}",
    "version": "{{ $json.next_target.version }}"
  },
  "input": "{{ $json.next_input }}",
  "metadata": {
    "workflow_id": "{{ $json.workflow_id }}",
    "caller": "n8n"
  }
}
```

---

## Node 5 — Approval/Completion Routing

### Type
If / Switch / Notification

### Purpose
Handle approval checkpoints and completion notifications using execution identifiers and correlation metadata.

---

# 5. Retry Strategy

## 5.1 Retry Rules

| Node Type | Retry Count | Strategy |
|----------|------------|----------|
| HTTP Nodes | 3 | Exponential backoff |
| Routing Nodes | 0 | Deterministic branch |
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

### Input
If Node Fails
→ Capture Error
→ Log execution_id + request_id
→ Stop Execution
```text
{{ $json.output.prompt }}
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
- Directly invoking LLM providers in governed execution paths
- Omitting explicit target version
- Embedding business logic in n8n nodes
- Assembling planner-only bespoke execution flows
- Treating transient workflow context as authoritative state