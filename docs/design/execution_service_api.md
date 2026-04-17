# Execution Service API Specification
## Governed AI Software Development Orchestration System

---

# 1. Purpose

This document defines the strict API contract between:

- n8n (orchestration layer)
- Execution Service (deterministic runtime engine)

This API is the only integration boundary for executing:

- Governance-driven logic
- Helper scripts
- Artifact generation
- State transitions

---

# 2. Standard Request Envelope

```json
{
  "workflow_id": "string",
  "request_id": "string",
  "role": "string",
  "project_config_path": "string",
  "payload": {}
}
```

---

# 3. Standard Response Envelope

```json
{
  "ok": true,
  "script": "string",
  "workflow_id": "string",
  "request_id": "string",
  "state_hint": "string|null",
  "governance_version": "string",
  "artifacts": [],
  "data": {},
  "errors": []
}
```

---

# 4. Error Format

```json
{
  "code": "STRING_CODE",
  "message": "Human readable message",
  "details": {}
}
```

---

# 5. Endpoints

## POST /load-project-config

### Request
```json
{
  "workflow_id": "wf-001",
  "request_id": "req-001",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {}
}
```

### Response
```json
{
  "ok": true,
  "script": "load_project_config",
  "workflow_id": "wf-001",
  "request_id": "req-001",
  "state_hint": null,
  "governance_version": "a1b2c3d",
  "artifacts": [],
  "data": {
    "resolved": {
      "project_root": "/mnt/repo",
      "workspace_root": "/mnt/repo/project_workspace",
      "docs_root": "/mnt/repo/docs",
      "governance_root": "/mnt/repo/ai_dev_stack/ai_guidance"
    }
  },
  "errors": []
}
```

---

## POST /resolve-paths

### Request
```json
{
  "workflow_id": "wf-001",
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
  "script": "resolve_paths",
  "workflow_id": "wf-001",
  "request_id": "req-002",
  "state_hint": null,
  "governance_version": "a1b2c3d",
  "artifacts": [],
  "data": {
    "paths": {
      "feature_intake": "/mnt/repo/project_workspace/intake/features/FEAT-001"
    }
  },
  "errors": []
}
```

---

## POST /build-execution-contract

### Request
```json
{
  "workflow_id": "wf-001",
  "request_id": "req-003",
  "role": "planner",
  "project_config_path": "/mnt/repo/project_config.json",
  "payload": {}
}
```

### Response
```json
{
  "ok": true,
  "script": "build_execution_contract",
  "workflow_id": "wf-001",
  "request_id": "req-003",
  "state_hint": "planning",
  "governance_version": "a1b2c3d",
  "artifacts": [],
  "data": {
    "execution_contract": {
      "prompt": "...",
      "rules": [],
      "templates": []
    }
  },
  "errors": []
}
```

---

# 6. Guiding Principle

> n8n orchestrates. Execution service executes. Governance defines behavior.
